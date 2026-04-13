// Store Goods Receipts — manual GRNs created by the store in-charge for
// chemicals, spares, PPE, lab reagents, packing, consumables.
//
// Discriminator: everything that is NOT auto (auto = remarks contains "WB:").
// See .claude/skills/grn-split-auto-vs-store.md for the contract.
//
// This route owns CRUD for the manual flow. The duplicate guard on POST is
// the headline safety feature (see PO-70 incident, 2026-04-08).
//
// Business logic (create lines, PO line updates, PO status rollup, inventory
// sync on confirm, reversal on delete) mirrors backend/src/routes/goodsReceipts.ts.
import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest, authorize, getActiveCompanyId, getCompanyFilter } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { NotFoundError, ValidationError, ForbiddenError, ConflictError } from '../shared/errors';
import { onStockMovement } from '../services/autoJournal';
import prisma from '../config/prisma';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();
router.use(authenticate as any);

// File upload config for store GRN invoice/e-way bill
const uploadDir = path.join(__dirname, '../../uploads/store-grn');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const grnStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`),
});
const grnUpload = multer({ storage: grnStorage, limits: { fileSize: 10 * 1024 * 1024 } });

// Source discriminator — store = NOT auto. Handles null remarks (those are
// also store) because `NOT { remarks: { contains: 'WB:' } }` in Prisma
// evaluates to true when remarks is null.
const STORE_SOURCE_WHERE = {
  NOT: { remarks: { contains: 'WB:' } },
} as const;

const STORE_WRITE_ROLES = ['STORE_INCHARGE', 'PROCUREMENT_MANAGER', 'ADMIN', 'SUPER_ADMIN'];
const storeWriteAuth = authorize(...STORE_WRITE_ROLES) as any;

// ─── Helper: sync GRN lines to inventory (copied from goodsReceipts.ts
// syncGrnToInventory — keep in sync until extracted into a shared service). ───
async function syncStoreGrnToInventory(
  grnId: string,
  grnNo: number,
  lines: Array<{
    inventoryItemId?: string | null;
    materialId?: string | null;
    acceptedQty: number;
    rate: number;
    unit: string;
    batchNo: string;
    storageLocation: string;
  }>,
  warehouseId: string | null,
  userId: string,
): Promise<void> {
  let whId = warehouseId;
  if (!whId) {
    const defaultWh = await prisma.warehouse.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (defaultWh) whId = defaultWh.id;
  }
  if (!whId) return;

  for (const line of lines) {
    const itemId = line.inventoryItemId || line.materialId;
    if (!itemId || line.acceptedQty <= 0) continue;

    const qty = line.acceptedQty;
    const costRate = line.rate;
    const totalValue = Math.round(qty * costRate * 100) / 100;

    await prisma.$transaction(async (tx) => {
      const invItem = await tx.inventoryItem.findUnique({
        where: { id: itemId },
        select: { id: true, name: true, unit: true, currentStock: true, avgCost: true },
      });
      if (!invItem) return;

      const movement = await tx.stockMovement.create({
        data: {
          itemId: invItem.id,
          movementType: 'GRN_RECEIPT',
          direction: 'IN',
          quantity: qty,
          unit: invItem.unit,
          costRate,
          totalValue,
          warehouseId: whId!,
          refType: 'GRN',
          refId: grnId,
          refNo: `GRN-${grnNo}`,
          narration: `Store GRN receipt for ${invItem.name}`,
          userId,
        },
      });

      const existing = await tx.stockLevel.findFirst({
        where: { itemId: invItem.id, warehouseId: whId!, binId: null, batchId: null },
      });
      if (existing) {
        await tx.stockLevel.update({
          where: { id: existing.id },
          data: { quantity: { increment: qty } },
        });
      } else {
        await tx.stockLevel.create({
          data: { itemId: invItem.id, warehouseId: whId!, binId: null, batchId: null, quantity: qty },
        });
      }

      const existingQty = invItem.currentStock;
      const existingAvgCost = invItem.avgCost;
      const newTotalQty = existingQty + qty;
      const newAvgCost = newTotalQty > 0
        ? (existingQty * existingAvgCost + qty * costRate) / newTotalQty
        : costRate;

      await tx.inventoryItem.update({
        where: { id: invItem.id },
        data: {
          currentStock: { increment: qty },
          avgCost: Math.round(newAvgCost * 100) / 100,
          totalValue: Math.round(newTotalQty * newAvgCost * 100) / 100,
        },
      });

      onStockMovement(prisma as Parameters<typeof onStockMovement>[0], {
        id: movement.id,
        movementNo: movement.movementNo,
        movementType: movement.movementType,
        direction: movement.direction,
        totalValue: movement.totalValue,
        itemName: invItem.name,
        userId,
        date: movement.date,
      }).catch(() => {});
    });
  }
}

// ─── Zod schemas ───
const lineSchema = z.object({
  poLineId: z.string().optional().nullable(),
  inventoryItemId: z.string().optional().nullable(),
  materialId: z.string().optional().nullable(),
  description: z.string().optional().default(''),
  receivedQty: z.number().nonnegative(),
  acceptedQty: z.number().nonnegative(),
  unit: z.string().optional().default('kg'),
  rate: z.number().nonnegative(),
  storageLocation: z.string().optional().default(''),
  warehouseCode: z.string().optional().default(''),
  batchNo: z.string().optional().default(''),
  remarks: z.string().optional().default(''),
});

const createSchema = z.object({
  poId: z.string().min(1),
  grnDate: z.string().optional(),
  vehicleNo: z.string().optional(),
  challanNo: z.string().optional(),
  challanDate: z.string().optional(),
  invoiceNo: z.string().optional(),
  invoiceDate: z.string().optional(),
  ewayBill: z.string().optional(),
  invoiceFilePath: z.string().optional().nullable(),
  ewayBillFilePath: z.string().optional().nullable(),
  remarks: z.string().optional(),
  lines: z.array(lineSchema).min(1),
  forceCreate: z.boolean().optional(),
});

const updateSchema = z.object({
  grnDate: z.string().optional(),
  vehicleNo: z.string().optional(),
  challanNo: z.string().optional(),
  challanDate: z.string().optional(),
  invoiceNo: z.string().optional(),
  invoiceDate: z.string().optional(),
  ewayBill: z.string().optional(),
  invoiceFilePath: z.string().optional().nullable(),
  ewayBillFilePath: z.string().optional().nullable(),
  remarks: z.string().optional(),
  lines: z.array(lineSchema).optional(),
});

// ═══════════════════════════════════════════════════════════════════
// GET /pending-pos — running store POs with GRN receipt status
// Shows APPROVED/SENT/PARTIAL_RECEIVED POs (non-weighbridge) so
// the store in-charge can see what's expected and quickly receive.
// ═══════════════════════════════════════════════════════════════════
router.get('/pending-pos', asyncHandler(async (req: AuthRequest, res: Response) => {
  const pos = await prisma.purchaseOrder.findMany({
    where: {
      ...getCompanyFilter(req),
      status: { in: ['APPROVED', 'SENT', 'PARTIAL_RECEIVED'] },
    },
    orderBy: { poDate: 'desc' },
    take: 200,
    include: {
      vendor: { select: { id: true, name: true } },
      lines: {
        select: {
          id: true, description: true, quantity: true,
          receivedQty: true, pendingQty: true, unit: true, rate: true,
          inventoryItem: { select: { id: true, name: true, category: true } },
        },
      },
      grns: {
        where: { ...STORE_SOURCE_WHERE },
        select: {
          id: true, grnNo: true, status: true, grnDate: true,
          totalQty: true, totalAmount: true,
        },
        orderBy: { grnDate: 'desc' },
      },
    },
  });

  // Filter out weighbridge-bound POs (FUEL, RAW_MATERIAL line categories)
  const storePOs = pos.filter(po => {
    const cats = po.lines.map(l => l.inventoryItem?.category || null);
    const isFuel = cats.some(c => c === 'FUEL');
    const isGrain = cats.some(c => c === 'RAW_MATERIAL');
    return !isFuel && !isGrain;
  });

  // Only include POs with pending lines
  const result = storePOs
    .filter(po => po.lines.some(l => l.pendingQty > 0))
    .map(po => {
      const totalOrdered = po.lines.reduce((s: number, l: { quantity: number }) => s + l.quantity, 0);
      const totalReceived = po.lines.reduce((s: number, l: { receivedQty: number }) => s + l.receivedQty, 0);
      const totalPending = po.lines.reduce((s: number, l: { pendingQty: number }) => s + l.pendingQty, 0);
      const draftGrns = po.grns.filter((g: { status: string }) => g.status === 'DRAFT');
      const confirmedGrns = po.grns.filter((g: { status: string }) => g.status === 'CONFIRMED');

      let receiptStatus: string;
      if (confirmedGrns.length > 0 && totalPending > 0) receiptStatus = 'PARTIAL_RECEIVED';
      else if (draftGrns.length > 0) receiptStatus = 'DRAFT_IN_PROGRESS';
      else receiptStatus = 'AWAITING_GOODS';

      return {
        id: po.id,
        poNo: po.poNo,
        poDate: po.poDate,
        deliveryDate: po.deliveryDate,
        status: po.status,
        dealType: po.dealType,
        grandTotal: po.grandTotal,
        vendor: po.vendor,
        totalOrdered,
        totalReceived,
        totalPending,
        receiptStatus,
        draftGrns,
        confirmedGrns,
        lineCount: po.lines.length,
        lines: po.lines.map(l => ({
          id: l.id,
          description: l.description,
          quantity: l.quantity,
          receivedQty: l.receivedQty,
          pendingQty: l.pendingQty,
          unit: l.unit,
          rate: l.rate,
        })),
      };
    });

  res.json(result);
}));

// ═══════════════════════════════════════════════
// GET / — paginated list of store (manual) GRNs
// ═══════════════════════════════════════════════
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
  const offset = parseInt(req.query.offset as string) || 0;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const vendorId = req.query.vendorId as string | undefined;
  const poId = req.query.poId as string | undefined;
  const status = req.query.status as string | undefined;
  const q = (req.query.q as string | undefined)?.trim();

  const where: any = {
    ...getCompanyFilter(req),
    archived: false,
    AND: [STORE_SOURCE_WHERE],
  };
  if (vendorId) where.vendorId = vendorId;
  if (poId) where.poId = poId;
  if (status) where.status = status;
  if (from || to) {
    where.grnDate = {};
    if (from) where.grnDate.gte = new Date(from);
    if (to) where.grnDate.lte = new Date(to);
  }
  if (q) {
    const asInt = parseInt(q, 10);
    const or: any[] = [
      { invoiceNo: { contains: q, mode: 'insensitive' } },
      { challanNo: { contains: q, mode: 'insensitive' } },
      { vehicleNo: { contains: q, mode: 'insensitive' } },
      { vendor: { name: { contains: q, mode: 'insensitive' } } },
    ];
    if (!isNaN(asInt)) or.push({ grnNo: asInt });
    where.AND.push({ OR: or });
  }

  const [items, total] = await Promise.all([
    prisma.goodsReceipt.findMany({
      where,
      orderBy: { grnDate: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        grnNo: true,
        grnDate: true,
        status: true,
        vehicleNo: true,
        invoiceNo: true,
        invoiceDate: true,
        totalQty: true,
        totalAmount: true,
        fullyPaid: true,
        userId: true,
        createdAt: true,
        po: { select: { id: true, poNo: true } },
        vendor: { select: { id: true, name: true } },
        lines: {
          select: {
            id: true,
            description: true,
            receivedQty: true,
            acceptedQty: true,
            unit: true,
            rate: true,
            amount: true,
          },
        },
      },
    }),
    prisma.goodsReceipt.count({ where }),
  ]);

  res.json({ items, total, limit, offset });
}));

// ═══════════════════════════════════════════════
// GET /:id — single store GRN (must NOT match auto filter)
// ═══════════════════════════════════════════════
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const grn = await prisma.goodsReceipt.findFirst({
    where: {
      id: req.params.id,
      AND: [STORE_SOURCE_WHERE],
    },
    include: {
      po: { include: { lines: true } },
      vendor: true,
      lines: {
        include: {
          inventoryItem: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!grn) throw new NotFoundError('Store GRN', req.params.id);

  // Resolve createdBy name
  let createdByName: string | null = null;
  if (grn.userId) {
    const u = await prisma.user.findUnique({
      where: { id: grn.userId },
      select: { name: true, email: true },
    });
    createdByName = u?.name || u?.email || grn.userId;
  }

  // Flatten for the drawer — it reads poNo / vendorName / createdBy / date at the top level.
  // Also enrich each line with the PO line's ordered qty so the "Ordered" column shows a value.
  const poLineMap = new Map<string, number>();
  for (const pl of (grn.po?.lines || []) as any[]) {
    poLineMap.set(pl.id, pl.quantity);
  }
  const flat = {
    ...grn,
    date: grn.grnDate,
    poNo: grn.po ? `PO-${grn.po.poNo}` : null,
    vendorName: grn.vendor?.name || null,
    createdBy: createdByName,
    totalAmount: grn.totalAmount,
    lines: (grn.lines || []).map((ln: any) => ({
      ...ln,
      itemName: ln.inventoryItem?.name || ln.description,
      orderedQty: ln.poLineId ? poLineMap.get(ln.poLineId) ?? null : null,
    })),
  };
  res.json(flat);
}));

// ═══════════════════════════════════════════════
// POST / — create DRAFT store GRN (with duplicate guard)
// ═══════════════════════════════════════════════
router.post('/', storeWriteAuth, validate(createSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body as z.infer<typeof createSchema>;

  // ─── Duplicate guard (PO-70 lesson, 2026-04-08) ───
  const draftsForPO = await prisma.goodsReceipt.findMany({
    where: {
      poId: b.poId,
      status: 'DRAFT',
      archived: false,
      AND: [STORE_SOURCE_WHERE],
    },
    select: { id: true, grnNo: true, createdAt: true, userId: true },
    orderBy: { createdAt: 'desc' },
  });

  if (draftsForPO.length > 0) {
    const role = req.user?.role || '';
    const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
    if (!b.forceCreate || !isAdmin) {
      const existing = draftsForPO.map(d => ({
        id: d.id,
        grnNo: d.grnNo,
        createdAt: d.createdAt,
        createdBy: d.userId,
      }));
      return res.status(409).json({
        error: 'DRAFT_GRN_EXISTS',
        existing,
        message: `GRN-${draftsForPO[0].grnNo} DRAFT already exists for this PO. Edit that instead.`,
      });
    }
  }

  // Get PO for validation
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: b.poId },
    include: { lines: true },
  });
  if (!po) throw new NotFoundError('Purchase Order', b.poId);

  const receivableStatuses = ['APPROVED', 'SENT', 'PARTIAL_RECEIVED'];
  if (!receivableStatuses.includes(po.status)) {
    throw new ValidationError(`PO is ${po.status} — cannot receive against it`);
  }

  // Validate poLineId references
  const validLineIds = new Set(po.lines.map((l: any) => l.id));
  for (const line of b.lines) {
    if (line.poLineId && !validLineIds.has(line.poLineId)) {
      throw new ValidationError(`PO line ${line.poLineId} does not belong to this PO`);
    }
  }

  // Process & validate lines — inherit inventoryItemId from PO line if not provided
  const poLineMap = new Map(po.lines.map((l: any) => [l.id, l]));
  const processedLines = b.lines.map((line) => {
    const receivedQty = Number(line.receivedQty) || 0;
    const acceptedQty = Number(line.acceptedQty) || 0;
    const rejectedQty = Math.max(0, receivedQty - acceptedQty);
    const rate = Number(line.rate) || 0;
    const amount = acceptedQty * rate;
    // Inherit inventoryItemId from PO line if frontend didn't send it
    const poLine = line.poLineId ? poLineMap.get(line.poLineId) : null;
    const itemId = line.inventoryItemId || line.materialId || poLine?.inventoryItemId || poLine?.materialId || null;
    return {
      poLineId: line.poLineId || null,
      inventoryItemId: itemId,
      materialId: null,
      description: line.description || '',
      receivedQty,
      acceptedQty,
      rejectedQty,
      unit: line.unit || 'kg',
      rate,
      amount,
      storageLocation: line.storageLocation || '',
      warehouseCode: line.warehouseCode || '',
      batchNo: line.batchNo || '',
      remarks: line.remarks || '',
    };
  });

  for (const line of processedLines) {
    if (line.acceptedQty > line.receivedQty) {
      throw new ValidationError(
        `Accepted qty (${line.acceptedQty}) cannot exceed received qty (${line.receivedQty})`,
      );
    }
    if (line.poLineId) {
      const poLine = po.lines.find((l: any) => l.id === line.poLineId);
      if (poLine && poLine.pendingQty > 0) {
        const tolerance = poLine.pendingQty * 1.1;
        if (line.acceptedQty > tolerance) {
          throw new ValidationError(
            `Accepted qty (${line.acceptedQty}) exceeds pending qty (${poLine.pendingQty}) + 10% tolerance`,
          );
        }
      }
    }
  }

  const totalAmount = processedLines.reduce((s, l) => s + l.amount, 0);
  const totalQty = processedLines.reduce((s, l) => s + l.acceptedQty, 0);

  // DRAFT creation — PO line receivedQty is NOT updated until approve.
  // This matches skill's DELETE semantics ("DRAFT should NOT have committed qty").
  const remarks = b.forceCreate && draftsForPO.length > 0
    ? `${b.remarks || ''} [FORCE_CREATE by ${req.user?.id} — prior drafts: ${draftsForPO.map(d => `GRN-${d.grnNo}`).join(', ')}]`.trim()
    : (b.remarks || '');

  const grn = await prisma.goodsReceipt.create({
    data: {
      poId: b.poId,
      vendorId: po.vendorId,
      grnDate: b.grnDate ? new Date(b.grnDate) : new Date(),
      vehicleNo: b.vehicleNo || '',
      challanNo: b.challanNo || b.invoiceNo || '',
      challanDate: b.challanDate ? new Date(b.challanDate) : (b.invoiceDate ? new Date(b.invoiceDate) : null),
      invoiceNo: b.invoiceNo || b.challanNo || '',
      invoiceDate: b.invoiceDate ? new Date(b.invoiceDate) : (b.challanDate ? new Date(b.challanDate) : null),
      ewayBill: b.ewayBill || '',
      invoiceFilePath: b.invoiceFilePath || null,
      ewayBillFilePath: b.ewayBillFilePath || null,
      remarks,
      totalAmount,
      totalQty,
      status: 'DRAFT',
      userId: req.user!.id,
      companyId: getActiveCompanyId(req),
      lines: { create: processedLines },
    },
    include: { lines: true, po: true, vendor: true },
  });

  res.status(201).json(grn);
}));

// ═══════════════════════════════════════════════
// PUT /:id — edit DRAFT store GRN
// ═══════════════════════════════════════════════
router.put('/:id', storeWriteAuth, validate(updateSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.goodsReceipt.findFirst({
    where: { id: req.params.id, AND: [STORE_SOURCE_WHERE] },
    include: { lines: true, po: { include: { lines: true } } },
  });
  if (!existing) throw new NotFoundError('Store GRN', req.params.id);
  if (existing.status !== 'DRAFT') {
    throw new ValidationError(`Can only edit DRAFT GRNs (current: ${existing.status})`);
  }

  const b = req.body as z.infer<typeof updateSchema>;

  // Header updates
  const headerData: any = {};
  if (b.grnDate !== undefined) headerData.grnDate = new Date(b.grnDate);
  if (b.vehicleNo !== undefined) headerData.vehicleNo = b.vehicleNo;
  if (b.challanNo !== undefined) headerData.challanNo = b.challanNo;
  if (b.challanDate !== undefined) headerData.challanDate = b.challanDate ? new Date(b.challanDate) : null;
  if (b.invoiceNo !== undefined) headerData.invoiceNo = b.invoiceNo;
  if (b.invoiceDate !== undefined) headerData.invoiceDate = b.invoiceDate ? new Date(b.invoiceDate) : null;
  if (b.ewayBill !== undefined) headerData.ewayBill = b.ewayBill;
  if (b.invoiceFilePath !== undefined) headerData.invoiceFilePath = b.invoiceFilePath;
  if (b.ewayBillFilePath !== undefined) headerData.ewayBillFilePath = b.ewayBillFilePath;
  if (b.remarks !== undefined) headerData.remarks = b.remarks;

  // Line updates (full replace)
  if (b.lines) {
    const po = existing.po as any;
    const validLineIds = new Set((po?.lines || []).map((l: any) => l.id));
    for (const line of b.lines) {
      if (line.poLineId && !validLineIds.has(line.poLineId)) {
        throw new ValidationError(`PO line ${line.poLineId} does not belong to this PO`);
      }
      if (line.acceptedQty > line.receivedQty) {
        throw new ValidationError(
          `Accepted qty (${line.acceptedQty}) cannot exceed received qty (${line.receivedQty})`,
        );
      }
    }

    const poLineMap = new Map<string, any>((po?.lines || []).map((l: any) => [l.id, l]));
    const processedLines = b.lines.map((line) => {
      const receivedQty = Number(line.receivedQty) || 0;
      const acceptedQty = Number(line.acceptedQty) || 0;
      const rate = Number(line.rate) || 0;
      const poLine = line.poLineId ? poLineMap.get(line.poLineId) : null;
      const itemId = line.inventoryItemId || line.materialId || poLine?.inventoryItemId || poLine?.materialId || null;
      return {
        poLineId: line.poLineId || null,
        inventoryItemId: itemId,
        materialId: null,
        description: line.description || '',
        receivedQty,
        acceptedQty,
        rejectedQty: Math.max(0, receivedQty - acceptedQty),
        unit: line.unit || 'kg',
        rate,
        amount: acceptedQty * rate,
        storageLocation: line.storageLocation || '',
        warehouseCode: line.warehouseCode || '',
        batchNo: line.batchNo || '',
        remarks: line.remarks || '',
      };
    });

    headerData.totalAmount = processedLines.reduce((s, l) => s + l.amount, 0);
    headerData.totalQty = processedLines.reduce((s, l) => s + l.acceptedQty, 0);

    await prisma.$transaction(async (tx) => {
      await tx.gRNLine.deleteMany({ where: { grnId: existing.id } });
      await tx.goodsReceipt.update({
        where: { id: existing.id },
        data: {
          ...headerData,
          lines: { create: processedLines },
        },
      });
    });
  } else if (Object.keys(headerData).length > 0) {
    await prisma.goodsReceipt.update({ where: { id: existing.id }, data: headerData });
  }

  const updated = await prisma.goodsReceipt.findUnique({
    where: { id: existing.id },
    include: { lines: true, po: true, vendor: true },
  });
  res.json(updated);
}));

// ═══════════════════════════════════════════════
// POST /:id/approve — DRAFT → CONFIRMED
// Commits PO line receivedQty/pendingQty, rolls up PO status, syncs inventory.
// ═══════════════════════════════════════════════
router.post('/:id/approve', storeWriteAuth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const grn = await prisma.goodsReceipt.findFirst({
    where: { id: req.params.id, AND: [STORE_SOURCE_WHERE] },
    include: { lines: true },
  });
  if (!grn) throw new NotFoundError('Store GRN', req.params.id);
  if (grn.status !== 'DRAFT') {
    throw new ValidationError(`Can only approve DRAFT GRNs (current: ${grn.status})`);
  }

  // Transaction: commit PO line qty + roll up PO status + confirm GRN
  const { updated } = await prisma.$transaction(async (tx) => {
    for (const line of grn.lines) {
      if (line.poLineId) {
        const poLine = await tx.pOLine.findUnique({ where: { id: line.poLineId } });
        if (poLine) {
          const newReceivedQty = poLine.receivedQty + line.acceptedQty;
          const newPendingQty = poLine.quantity - newReceivedQty;
          if (newPendingQty < 0) {
            console.warn(
              `[StoreGRN] Over-receive on PO line ${line.poLineId}: ordered=${poLine.quantity}, now received=${newReceivedQty}`,
            );
          }
          await tx.pOLine.update({
            where: { id: line.poLineId },
            data: {
              receivedQty: newReceivedQty,
              pendingQty: Math.max(0, newPendingQty),
            },
          });
        }
      }
    }

    // Roll up PO status
    if (grn.poId) {
      const poLines = await tx.pOLine.findMany({ where: { poId: grn.poId } });
      const allReceived = poLines.every((l: any) => l.pendingQty === 0);
      const anyPartial = poLines.some((l: any) => l.receivedQty > 0 && l.pendingQty > 0);
      if (allReceived) {
        await tx.purchaseOrder.update({ where: { id: grn.poId }, data: { status: 'RECEIVED' } });
      } else if (anyPartial) {
        await tx.purchaseOrder.update({ where: { id: grn.poId }, data: { status: 'PARTIAL_RECEIVED' } });
      }
    }

    const updated = await tx.goodsReceipt.update({
      where: { id: grn.id },
      data: { status: 'CONFIRMED' },
      include: { lines: true },
    });

    return { updated };
  });

  // Inventory sync — outside the transaction because it uses its own $transaction.
  // On failure, revert GRN to DRAFT (matches legacy goodsReceipts.ts behavior).
  try {
    await syncStoreGrnToInventory(
      updated.id,
      updated.grnNo,
      updated.lines.map((l: any) => ({
        inventoryItemId: l.inventoryItemId || l.materialId,
        acceptedQty: l.acceptedQty,
        rate: l.rate,
        unit: l.unit,
        batchNo: l.batchNo || '',
        storageLocation: l.storageLocation || '',
      })),
      null,
      req.user!.id,
    );
  } catch (syncErr: unknown) {
    console.error(`[StoreGRN] Inventory sync failed on approve for GRN-${updated.grnNo}: ${syncErr}`);
    // Revert GRN and PO line updates
    await prisma.$transaction(async (tx) => {
      await tx.goodsReceipt.update({ where: { id: updated.id }, data: { status: 'DRAFT' } });
      for (const line of grn.lines) {
        if (line.poLineId) {
          const poLine = await tx.pOLine.findUnique({ where: { id: line.poLineId } });
          if (poLine) {
            const revertedReceivedQty = Math.max(0, poLine.receivedQty - line.acceptedQty);
            await tx.pOLine.update({
              where: { id: line.poLineId },
              data: {
                receivedQty: revertedReceivedQty,
                pendingQty: poLine.quantity - revertedReceivedQty,
              },
            });
          }
        }
      }
    });
    return res.status(500).json({
      error: `Approve succeeded but inventory sync failed. Reverted to DRAFT. ${syncErr instanceof Error ? syncErr.message : 'Unknown'}`,
    });
  }

  res.json(updated);
}));

// ═══════════════════════════════════════════════
// DELETE /:id — hard delete DRAFT store GRN
// DRAFT never commits PO qty or inventory, so nothing to reverse.
// Defensive check: if any stock movement exists (legacy data), refuse.
// ═══════════════════════════════════════════════
router.delete('/:id', storeWriteAuth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const grn = await prisma.goodsReceipt.findFirst({
    where: { id: req.params.id, AND: [STORE_SOURCE_WHERE] },
    include: { lines: true },
  });
  if (!grn) throw new NotFoundError('Store GRN', req.params.id);
  if (grn.status !== 'DRAFT') {
    throw new ValidationError('Can only delete GRN in DRAFT status');
  }

  const movementCount = await prisma.stockMovement.count({
    where: { refType: 'GRN', refId: grn.id },
  });
  if (movementCount > 0) {
    throw new ConflictError(
      `Cannot delete DRAFT GRN with ${movementCount} stock movements (legacy data). Cancel instead, or contact admin.`,
    );
  }

  // Defensive PO line reversal: DRAFT should not have committed qty, but if
  // any was committed (legacy or bug), reverse it to keep POLine consistent.
  await prisma.$transaction(async (tx) => {
    for (const line of grn.lines) {
      if (line.poLineId && line.acceptedQty > 0) {
        const poLine = await tx.pOLine.findUnique({ where: { id: line.poLineId } });
        if (poLine && poLine.receivedQty >= line.acceptedQty) {
          // Only reverse if the legacy code had committed it — detect by checking
          // if receivedQty was ever incremented by this line's qty. We can't tell
          // for sure, so we skip the reversal for a normal store DRAFT (which
          // never commits). No-op in the happy path.
        }
      }
    }
    await tx.goodsReceipt.delete({ where: { id: req.params.id } });
  });

  res.json({ ok: true });
}));

// ═══════════════════════════════════════════════
// POST /:id/upload — upload invoice / e-way bill files for a store GRN
// ═══════════════════════════════════════════════
router.post(
  '/:id/upload',
  storeWriteAuth,
  grnUpload.fields([
    { name: 'invoice', maxCount: 1 },
    { name: 'ewayBill', maxCount: 1 },
  ]),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const grn = await prisma.goodsReceipt.findFirst({
      where: { id: req.params.id, AND: [STORE_SOURCE_WHERE] },
    });
    if (!grn) throw new NotFoundError('Store GRN', req.params.id);

    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const update: Record<string, string> = {};

    if (files?.invoice?.[0]) {
      update.invoiceFilePath = `/uploads/store-grn/${files.invoice[0].filename}`;
    }
    if (files?.ewayBill?.[0]) {
      update.ewayBillFilePath = `/uploads/store-grn/${files.ewayBill[0].filename}`;
    }

    if (Object.keys(update).length === 0) {
      throw new ValidationError('No files provided. Send invoice and/or ewayBill fields.');
    }

    const updated = await prisma.goodsReceipt.update({
      where: { id: req.params.id },
      data: update,
      select: { id: true, invoiceFilePath: true, ewayBillFilePath: true },
    });
    res.json(updated);
  }),
);

export default router;
