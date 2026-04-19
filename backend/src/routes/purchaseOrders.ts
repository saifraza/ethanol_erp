import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { z } from 'zod';
import { getEffectiveGstRate, computeGstSplit } from '../services/taxRateLookup';
import { calculateTds } from '../services/tdsCalculator';
import { DEFAULT_RM_TERM_KEYS, termByKey } from '../data/poTerms';

const poLineSchema = z.object({
  inventoryItemId: z.string().optional().nullable(),
  materialId: z.string().optional().nullable(),
  description: z.string().optional().default(''),
  hsnCode: z.string().optional().default(''),
  hsnCodeId: z.string().optional().nullable(),
  quantity: z.coerce.number().nonnegative(),
  unit: z.string().optional().default('KG'),
  rate: z.coerce.number().nonnegative(),
  isRateInclusive: z.boolean().optional().default(false),
  discountPercent: z.coerce.number().nonnegative().optional().default(0),
  gstPercent: z.coerce.number().nonnegative().optional(),
  isRCM: z.boolean().optional().default(false),
});

const createPOSchema = z.object({
  vendorId: z.string().optional().default(''),
  contractorId: z.string().optional(),
  poDate: z.string().optional(),
  deliveryDate: z.string().optional().nullable(),
  supplyType: z.enum(['INTRA_STATE', 'INTER_STATE']).optional().default('INTRA_STATE'),
  placeOfSupply: z.string().optional().default(''),
  paymentTerms: z.string().optional().default(''),
  creditDays: z.coerce.number().int().nonnegative().optional().default(0),
  deliveryAddress: z.string().optional().default(''),
  transportMode: z.string().optional().default(''),
  transportBy: z.string().optional().default(''),
  remarks: z.string().optional().default(''),
  freightCharge: z.coerce.number().nonnegative().optional().default(0),
  otherCharges: z.coerce.number().nonnegative().optional().default(0),
  roundOff: z.coerce.number().optional().default(0),
  lines: z.array(poLineSchema).min(1),
  termsAccepted: z.array(z.string()).optional(),
  overrideTdsSectionId: z.string().optional().nullable(),
  poType: z.enum(['GOODS', 'SERVICE', 'CONTRACTOR', 'RENT', 'UTILITY', 'OTHER']).optional().default('GOODS'),
  dealType: z.enum(['STANDARD', 'OPEN']).optional().default('STANDARD'),
});

const updatePOSchema = z.object({
  vendorId: z.string().optional(),
  contractorId: z.string().optional().nullable(),
  poDate: z.string().optional(),
  deliveryDate: z.string().optional().nullable(),
  supplyType: z.enum(['INTRA_STATE', 'INTER_STATE']).optional(),
  placeOfSupply: z.string().optional(),
  paymentTerms: z.string().optional(),
  creditDays: z.coerce.number().int().nonnegative().optional(),
  deliveryAddress: z.string().optional(),
  transportMode: z.string().optional(),
  transportBy: z.string().optional(),
  remarks: z.string().optional(),
  freightCharge: z.coerce.number().nonnegative().optional(),
  otherCharges: z.coerce.number().nonnegative().optional(),
  roundOff: z.coerce.number().optional(),
  lines: z.array(poLineSchema).optional(),
  termsAccepted: z.array(z.string()).optional(),
  overrideTdsSectionId: z.string().optional().nullable(),
  poType: z.enum(['GOODS', 'SERVICE', 'CONTRACTOR', 'RENT', 'UTILITY', 'OTHER']).optional(),
  dealType: z.enum(['STANDARD', 'OPEN']).optional(),
});
import { generatePOPdf } from '../utils/pdfGenerator';
// RAG indexing removed — only compliance docs go to RAG
import { renderDocumentPdf } from '../services/documentRenderer';
import { sendEmail } from '../services/messaging';
import { nextDocNo } from '../utils/docSequence';
import { getCompanyForPdf } from '../utils/pdfCompanyHelper';
import { writeAudit, auditDiff } from '../utils/auditLog';

const router = Router();
router.use(authenticate as any);

// ──────────────────────────────────────────────────────────────────────────
// Shared tax line processing — single source of truth for PO GST.
//
// Rate resolution precedence (per line):
//   1. Explicit hsnCodeId on line → HSN master effective rate
//   2. inventoryItem.hsnCodeId → master rate
//   3. inventoryItem.gstOverridePercent (with reason) → override
//   4. inventoryItem.gstPercent (legacy scalar) → fallback
//   5. line.gstPercent (client-supplied, last resort)
//
// Supports inclusive/exclusive math via POLine.isRateInclusive.
// ──────────────────────────────────────────────────────────────────────────
interface ProcessedPOLine {
  inventoryItemId: string | null;
  materialId: null;
  description: string;
  hsnCode: string;
  hsnCodeId: string | null;
  quantity: number;
  unit: string;
  rate: number;
  isRateInclusive: boolean;
  discountPercent: number;
  discountAmount: number;
  gstPercent: number;
  rateSnapshotGst: number;
  amount: number;
  taxableAmount: number;
  cgstPercent: number;
  cgstAmount: number;
  sgstPercent: number;
  sgstAmount: number;
  igstPercent: number;
  igstAmount: number;
  totalGst: number;
  lineTotal: number;
  isRCM: boolean;
  pendingQty: number;
  receivedQty: number;
}
type LineInput = Record<string, unknown>;
interface ItemRow {
  id: string;
  name: string | null;
  unit: string | null;
  hsnCode: string | null;
  hsnCodeId: string | null;
  gstPercent: number;
  gstOverridePercent: number | null;
  gstOverrideReason: string | null;
}
async function processPOLines(params: {
  lines: LineInput[];
  supplyType: 'INTRA_STATE' | 'INTER_STATE';
  poDate: Date;
}): Promise<ProcessedPOLine[]> {
  const { lines, supplyType, poDate } = params;
  const itemIds = lines
    .map((l) => (l.materialId as string | undefined) || (l.inventoryItemId as string | undefined))
    .filter((id): id is string => Boolean(id));
  const itemsMap: Record<string, ItemRow> = {};
  if (itemIds.length > 0) {
    const items = await prisma.inventoryItem.findMany({
      where: { id: { in: itemIds } },
      select: {
        id: true, name: true, unit: true, hsnCode: true, hsnCodeId: true,
        gstPercent: true, gstOverridePercent: true, gstOverrideReason: true,
      },
    });
    items.forEach((m) => { itemsMap[m.id] = m; });
  }

  const out: ProcessedPOLine[] = [];
  for (const line of lines) {
    const itemId = (line.materialId as string | null) || (line.inventoryItemId as string | null) || null;
    const mat = itemId ? itemsMap[itemId] ?? null : null;

    // Prefer explicit hsnCodeId on line, then item's FK
    const hsnCodeId = (line.hsnCodeId as string | null | undefined) ?? mat?.hsnCodeId ?? null;

    // Legacy code string: prefer line's string, then item's
    const hsnCode = (line.hsnCode as string | undefined) || mat?.hsnCode || '';

    // Resolve authoritative GST rate
    const legacyGst = mat?.gstPercent ?? (line.gstPercent != null ? Number(line.gstPercent) : null);
    const resolved = await getEffectiveGstRate({
      hsnCodeId,
      on: poDate,
      itemOverridePercent: mat?.gstOverridePercent,
      itemOverrideReason: mat?.gstOverrideReason,
      legacyGstPercent: legacyGst,
    });

    const quantity = parseFloat(String(line.quantity ?? 0)) || 0;
    const rate = parseFloat(String(line.rate ?? 0)) || 0;
    const discountPercent = parseFloat(String(line.discountPercent ?? 0)) || 0;
    const isRateInclusive = !!line.isRateInclusive;
    const gstPercent = resolved.rate;

    // amount = qty × rate (always stored as the raw line total pre-split)
    const amount = quantity * rate;
    const discountAmount = amount * (discountPercent / 100);
    const preSplit = amount - discountAmount;

    // Inclusive: preSplit IS the total (tax embedded); back-solve taxable
    // Exclusive: preSplit IS taxable; tax goes on top
    const split = computeGstSplit({
      amount: preSplit,
      gstPercent,
      supplyType,
      isInclusive: isRateInclusive,
    });

    const cgstPercent = supplyType === 'INTRA_STATE' ? gstPercent / 2 : 0;
    const sgstPercent = supplyType === 'INTRA_STATE' ? gstPercent / 2 : 0;
    const igstPercent = supplyType === 'INTER_STATE' ? gstPercent : 0;

    out.push({
      inventoryItemId: itemId,
      materialId: null, // deprecated FK — points to Material, not InventoryItem
      description: (line.description as string | undefined) || mat?.name || '',
      hsnCode,
      hsnCodeId,
      quantity,
      unit: (line.unit as string | undefined) || mat?.unit || 'KG',
      rate,
      isRateInclusive,
      discountPercent,
      discountAmount,
      gstPercent,
      rateSnapshotGst: gstPercent, // audit: what was master at booking time
      amount,
      taxableAmount: split.taxableAmount,
      cgstPercent,
      cgstAmount: split.cgstAmount,
      sgstPercent,
      sgstAmount: split.sgstAmount,
      igstPercent,
      igstAmount: split.igstAmount,
      totalGst: split.totalGst,
      lineTotal: split.lineTotal,
      isRCM: !!line.isRCM,
      pendingQty: quantity,
      receivedQty: 0,
    });
  }
  return out;
}

// GET / — list POs with filters (status, vendorId), pagination
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const status = req.query.status as string | undefined;
    const vendorId = req.query.vendorId as string | undefined;
    const category = req.query.category as string | undefined; // FUEL, RAW_MATERIAL, etc.
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);

    const where: any = { ...getCompanyFilter(req) };
    if (status) {
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
      where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
    }
    if (vendorId) where.vendorId = vendorId;
    // Filter by inventory item category on PO lines (not vendor category — those don't match)
    // FUEL = any PO with a line whose inventoryItem.category is 'FUEL'
    // RAW_MATERIAL = lines with category 'RAW_MATERIAL' or 'CHEMICAL' or 'GRAIN'
    // GENERAL = everything else (no fuel/raw material lines)
    if (category === 'FUEL') {
      where.lines = { some: { inventoryItem: { category: 'FUEL' } } };
    } else if (category === 'RAW_MATERIAL') {
      where.lines = { some: { inventoryItem: { category: { in: ['RAW_MATERIAL', 'CHEMICAL', 'GRAIN'] } } } };
    } else if (category === 'GENERAL') {
      where.AND = [
        { NOT: { lines: { some: { inventoryItem: { category: 'FUEL' } } } } },
        { NOT: { lines: { some: { inventoryItem: { category: { in: ['RAW_MATERIAL', 'CHEMICAL', 'GRAIN'] } } } } } },
      ];
    }

    const pos = await prisma.purchaseOrder.findMany({
      where,
      include: {
        vendor: { select: { id: true, name: true, email: true } },
        contractor: { select: { id: true, name: true, contractorCode: true, contractorType: true } },
        lines: true,
        grns: { select: { id: true, status: true } },
        vendorInvoices: { select: { id: true, status: true, totalAmount: true, payments: { select: { amount: true, tdsDeducted: true } } } },
      },
      orderBy: [{ poNo: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    });

    const total = await prisma.purchaseOrder.count({ where });

    const posWithCounts = pos.map((po: any) => {
      const invoices = po.vendorInvoices || [];
      const totalInvoiced = invoices.reduce((s: number, inv: any) => s + (inv.totalAmount || 0), 0);
      const totalPaid = invoices.reduce((s: number, inv: any) =>
        s + (inv.payments || []).reduce((ps: number, p: any) => ps + (p.amount || 0) + (p.tdsDeducted || 0), 0), 0);
      const paymentStatus = totalInvoiced === 0 ? 'NO_INVOICE' : totalPaid >= totalInvoiced ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'UNPAID';
      // Received value = sum of (receivedQty × rate + GST) across PO lines.
      // This is the real financial exposure — what we've actually received and owe for.
      // Contract grandTotal stays available as po.grandTotal for reference, but the list
      // now displays received value so an un-received PO shows ₹0 instead of the full
      // contract amount (user feedback 2026-04-09).
      const receivedValue = Math.round(
        (po.lines || []).reduce((s: number, l: any) => {
          const base = (l.receivedQty || 0) * (l.rate || 0);
          return s + base + (base * (l.gstPercent || 0)) / 100;
        }, 0) * 100,
      ) / 100;
      return {
        ...po,
        linesCount: po.lines?.length || 0,
        grnCount: po.grns?.length || 0,
        invoiceCount: invoices.length,
        totalInvoiced,
        totalPaid,
        paymentStatus,
        receivedValue,
      };
    });

    res.json({ pos: posWithCounts, total, page, limit });
}));

// GET /:id — single PO with full pipeline (lines, GRNs, invoices, payments)
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: {
        vendor: true,
        lines: {
          include: {
            inventoryItem: { select: { id: true, name: true, code: true, unit: true, category: true } },
          },
        },
        grns: {
          include: { lines: true },
          orderBy: { grnDate: 'desc' },
        },
        vendorInvoices: {
          include: {
            payments: { orderBy: { paymentDate: 'desc' } },
          },
          orderBy: { invoiceDate: 'desc' },
        },
      },
    });
    if (!po) return res.status(404).json({ error: 'PO not found' });

    // Calculate pipeline summary
    const totalOrdered = po.lines.reduce((s, l) => s + l.quantity, 0);
    const totalReceived = po.lines.reduce((s, l) => s + (l.receivedQty || 0), 0);
    const totalPending = po.lines.reduce((s, l) => s + (l.pendingQty || l.quantity - (l.receivedQty || 0)), 0);
    const totalInvoiced = (po.vendorInvoices || []).reduce((s: number, inv: any) => s + (inv.totalAmount || 0), 0);
    let totalPaid = (po.vendorInvoices || []).reduce((s: number, inv: any) =>
      s + (inv.payments || []).reduce((ps: number, p: any) => ps + (p.amount || 0), 0), 0);
    const totalTDS = (po.vendorInvoices || []).reduce((s: number, inv: any) =>
      s + (inv.payments || []).reduce((ps: number, p: any) => ps + (p.tdsDeducted || 0), 0), 0);

    // Also count direct PO payments (not linked to invoices — from Pay on PO flow)
    const directPayments = await prisma.vendorPayment.findMany({
      where: {
        vendorId: po.vendorId,
        invoiceId: null,
        OR: [
          { remarks: { contains: `PO-${po.poNo} ` } },
          { remarks: { endsWith: `PO-${po.poNo}` } },
        ],
      },
      orderBy: { paymentDate: 'desc' },
      select: { id: true, amount: true, mode: true, reference: true, paymentDate: true, tdsDeducted: true, remarks: true, paymentStatus: true, adviceSentAt: true, adviceSentTo: true, hasGst: true, bankReceiptPath: true, bankReceiptScannedAt: true },
    });
    const directPaidTotal = directPayments.reduce((s, p) => s + p.amount, 0);
    totalPaid += directPaidTotal;

    // Pending cash vouchers (ACTIVE, not yet settled)
    const pendingCashVouchers = await prisma.cashVoucher.findMany({
      where: { status: 'ACTIVE', purpose: { contains: `PO-${po.poNo}` } },
      select: { id: true, voucherNo: true, amount: true, status: true },
    });
    const pendingCashTotal = pendingCashVouchers.reduce((s, v) => s + v.amount, 0);

    // PO amount is ALWAYS based on received weight — not ordered qty
    const receivedValue = Math.round(po.lines.reduce((s: number, l: any) => {
      const base = (l.receivedQty || 0) * (l.rate || 0);
      return s + base + base * (l.gstPercent || 0) / 100;
    }, 0) * 100) / 100;
    const orderedAmount = po.grandTotal || 0; // keep for reference only

    // Balance: invoice balance when invoices exist, else received value minus payments
    const invoiceBalance = totalInvoiced - totalPaid - totalTDS;
    const effectiveBalance = totalInvoiced > 0 ? invoiceBalance : Math.max(0, receivedValue - totalPaid);

    const pipeline = {
      ordered: { qty: totalOrdered, amount: orderedAmount },
      received: { qty: totalReceived, pending: totalPending, grnCount: po.grns.length, amount: receivedValue },
      invoiced: { amount: totalInvoiced, count: (po.vendorInvoices || []).length },
      paid: { amount: totalPaid, tds: totalTDS, balance: effectiveBalance, directPayments, pendingCash: pendingCashTotal, pendingCashVouchers },
    };

    res.json({ ...po, pipeline });
}));

// POST / — create PO with lines in a transaction
router.post('/', validate(createPOSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body;
    const poType = (b.poType as string) || 'GOODS';
    const dealType = (b.dealType as string) || 'STANDARD';

    let resolvedVendorId = b.vendorId;
    const contractorId = b.contractorId || null;

    if (!resolvedVendorId) {
      res.status(400).json({ error: 'Vendor is required' });
      return;
    }

    if (poType === 'GOODS') {
      const missingItem = (b.lines || []).some((l: Record<string, unknown>) => !l.inventoryItemId && !l.materialId);
      if (missingItem) {
        res.status(400).json({ error: 'Every PO line must have an inventory item selected' });
        return;
      }
    } else {
      const missingDesc = (b.lines || []).some((l: Record<string, unknown>) => !(l.description as string || '').trim());
      if (missingDesc) {
        res.status(400).json({ error: 'Every line on a non-goods PO must have a description' });
        return;
      }
    }

    const poDate = b.poDate ? new Date(b.poDate) : new Date();
    const supplyType = (b.supplyType || 'INTRA_STATE') as 'INTRA_STATE' | 'INTER_STATE';
    const processedLines = await processPOLines({ lines: b.lines || [], supplyType, poDate });

    const subtotal = processedLines.reduce((s, l) => s + l.taxableAmount, 0);
    const totalCgst = processedLines.reduce((s, l) => s + l.cgstAmount, 0);
    const totalSgst = processedLines.reduce((s, l) => s + l.sgstAmount, 0);
    const totalIgst = processedLines.reduce((s, l) => s + l.igstAmount, 0);
    const totalGst = totalCgst + totalSgst + totalIgst;
    const freightCharge = parseFloat(b.freightCharge) || 0;
    const otherCharges = parseFloat(b.otherCharges) || 0;
    const roundOff = parseFloat(b.roundOff) || 0;
    const grandTotal = subtotal + totalGst + freightCharge + otherCharges + roundOff;

    const tdsBase = subtotal + freightCharge + otherCharges + roundOff;
    const tds = await calculateTds(resolvedVendorId, tdsBase, { overrideSectionId: b.overrideTdsSectionId });

    const hasRmLine = processedLines.some((l) => !!l.inventoryItemId);
    let termsAccepted: string[] = b.termsAccepted ?? [];
    if (!b.termsAccepted && hasRmLine) {
      const ids = processedLines.map((l) => l.inventoryItemId).filter((x): x is string => !!x);
      if (ids.length > 0) {
        const cats = await prisma.inventoryItem.findMany({
          where: { id: { in: ids } },
          select: { category: true },
        });
        if (cats.some((c) => c.category === 'RAW_MATERIAL')) {
          termsAccepted = [...DEFAULT_RM_TERM_KEYS];
        }
      }
    }

    const companyId = getActiveCompanyId(req);
    const poNo = await nextDocNo('PurchaseOrder', 'poNo', companyId);
    const po = await prisma.purchaseOrder.create({
      data: {
        poNo,
        vendorId: resolvedVendorId,
        contractorId,
        poDate,
        deliveryDate: b.deliveryDate ? new Date(b.deliveryDate) : null,
        supplyType,
        placeOfSupply: b.placeOfSupply || '',
        paymentTerms: b.paymentTerms || '',
        creditDays: b.creditDays ? parseInt(b.creditDays) : 0,
        deliveryAddress: b.deliveryAddress || '',
        transportMode: b.transportMode || '',
        transportBy: b.transportBy || '',
        remarks: b.remarks || '',
        subtotal,
        totalCgst,
        totalSgst,
        totalIgst,
        totalGst,
        freightCharge,
        otherCharges,
        roundOff,
        grandTotal,
        tdsApplicable: tds.shouldDeduct,
        tdsSection: tds.sectionCode || null,
        tdsPercent: tds.rate,
        tdsAmount: tds.tdsAmount,
        tdsReasonSnapshot: { reason: tds.reason, baseRate: tds.baseRate, sectionLabel: tds.sectionLabel },
        tdsComputedAt: new Date(),
        overrideTdsSectionId: b.overrideTdsSectionId || null,
        termsAccepted,
        poType,
        dealType,
        status: poType === 'CONTRACTOR' && dealType === 'OPEN' ? 'APPROVED' : 'DRAFT',
        userId: req.user!.id,
        companyId,
        lines: {
          create: processedLines,
        },
      },
      include: { lines: true, contractor: { select: { id: true, name: true, contractorCode: true } } },
    });

    res.status(201).json(po);
}));

// PUT /:id/status — status transitions
router.put('/:id/status', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { newStatus } = req.body;
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
    });
    if (!po) return res.status(404).json({ error: 'PO not found' });

    // Validate status transitions
    const validTransitions: Record<string, string[]> = {
      'DRAFT': ['APPROVED', 'CANCELLED'],
      'APPROVED': ['SENT', 'CLOSED', 'CANCELLED'],
      'SENT': ['PARTIAL_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'],
      'PARTIAL_RECEIVED': ['RECEIVED', 'CLOSED', 'CANCELLED'],
      'RECEIVED': ['CLOSED'],
      'CLOSED': ['ARCHIVED'],
      'CANCELLED': ['ARCHIVED'],
    };

    if (!validTransitions[po.status] || !validTransitions[po.status].includes(newStatus)) {
      return res.status(400).json({ error: `Invalid status transition from ${po.status} to ${newStatus}` });
    }

    const updateData: any = { status: newStatus };
    if (newStatus === 'APPROVED') {
      updateData.approvedBy = req.user!.id;
      updateData.approvedAt = new Date();
    }

    const updated = await prisma.purchaseOrder.update({
      where: { id: req.params.id },
      data: updateData,
      include: { lines: true },
    });

    writeAudit('PurchaseOrder', po.id, 'STATUS_CHANGE', { status: { from: po.status, to: newStatus } }, req.user!.id);
    res.json(updated);
}));

// PUT /:id — update PO details and lines (only if DRAFT)
// PATCH /:id/payment-terms — narrow update allowed even on approved POs
router.patch('/:id/payment-terms', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { paymentTerms, creditDays } = req.body as { paymentTerms?: string; creditDays?: number };
    const po = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
    if (!po) return res.status(404).json({ error: 'PO not found' });
    if (po.status === 'CANCELLED' || po.status === 'ARCHIVED') {
      return res.status(400).json({ error: `Cannot update payment terms on ${po.status} PO` });
    }
    const termDays: Record<string, number> = { 'Advance 100%': 0, 'Advance 50% + Balance on Delivery': 0, 'Against Delivery': 0, 'Net 7': 7, 'Net 15': 15, 'Net 30': 30, 'Net 45': 45, 'Net 60': 60, 'Net 90': 90 };
    const newTerms = paymentTerms ?? po.paymentTerms;
    const newDays = creditDays ?? (paymentTerms && termDays[paymentTerms] !== undefined ? termDays[paymentTerms] : po.creditDays);
    const updated = await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: { paymentTerms: newTerms, creditDays: newDays },
      select: { id: true, poNo: true, paymentTerms: true, creditDays: true, status: true },
    });
    writeAudit('PurchaseOrder', po.id, 'PAYMENT_TERMS', {
      paymentTerms: { from: po.paymentTerms, to: newTerms },
      creditDays: { from: po.creditDays, to: newDays },
    }, req.user!.id);
    res.json(updated);
}));

router.put('/:id', validate(updatePOSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: { lines: true },
    });
    if (!po) return res.status(404).json({ error: 'PO not found' });
    if (po.status !== 'DRAFT') {
      return res.status(400).json({ error: 'Can only update PO in DRAFT status' });
    }

    const b = req.body;

    // If lines are provided, rebuild them via shared helper
    if (b.lines && Array.isArray(b.lines)) {
      const supplyType = (b.supplyType || po.supplyType) as 'INTRA_STATE' | 'INTER_STATE';
      const poDate = b.poDate ? new Date(b.poDate) : po.poDate;
      const processedLines = await processPOLines({ lines: b.lines, supplyType, poDate });

      const subtotal = processedLines.reduce((s, l) => s + l.taxableAmount, 0);
      const totalCgst = processedLines.reduce((s, l) => s + l.cgstAmount, 0);
      const totalSgst = processedLines.reduce((s, l) => s + l.sgstAmount, 0);
      const totalIgst = processedLines.reduce((s, l) => s + l.igstAmount, 0);
      const totalGst = totalCgst + totalSgst + totalIgst;
      // parseFloat(undefined) → NaN. Use explicit undefined guard so omitting a
      // header charge in PUT body doesn't poison the grand total.
      const freightCharge = b.freightCharge !== undefined ? Number(b.freightCharge) : po.freightCharge;
      const otherCharges = b.otherCharges !== undefined ? Number(b.otherCharges) : po.otherCharges;
      const roundOff = b.roundOff !== undefined ? Number(b.roundOff) : po.roundOff;
      const grandTotal = subtotal + totalGst + freightCharge + otherCharges + roundOff;

      // TDS base: gross contract value (excluding GST) — matches 194C/194Q law.
      // Respect per-PO override: user-supplied override beats stored; else keep existing.
      const tdsBase = subtotal + freightCharge + otherCharges + roundOff;
      const effOverride = b.overrideTdsSectionId !== undefined ? b.overrideTdsSectionId : po.overrideTdsSectionId;
      const tds = await calculateTds(b.vendorId || po.vendorId, tdsBase, { overrideSectionId: effOverride });

      // Delete old lines and update PO atomically
      const updated = await prisma.$transaction(async (tx) => {
        await tx.pOLine.deleteMany({ where: { poId: po.id } });
        return tx.purchaseOrder.update({
          where: { id: po.id },
          data: {
            vendorId: b.vendorId || po.vendorId,
            poDate,
            deliveryDate: b.deliveryDate ? new Date(b.deliveryDate) : po.deliveryDate,
            supplyType, placeOfSupply: b.placeOfSupply ?? po.placeOfSupply,
            paymentTerms: b.paymentTerms ?? po.paymentTerms,
            creditDays: b.creditDays !== undefined ? parseInt(b.creditDays) : po.creditDays,
            deliveryAddress: b.deliveryAddress ?? po.deliveryAddress,
            transportMode: b.transportMode ?? po.transportMode,
            remarks: b.remarks ?? po.remarks,
            subtotal, totalCgst, totalSgst, totalIgst, totalGst,
            freightCharge, otherCharges, roundOff, grandTotal,
            tdsApplicable: tds.shouldDeduct,
            tdsSection: tds.sectionCode || null,
            tdsPercent: tds.rate,
            tdsAmount: tds.tdsAmount,
            tdsReasonSnapshot: { reason: tds.reason, baseRate: tds.baseRate, sectionLabel: tds.sectionLabel },
            tdsComputedAt: new Date(),
            overrideTdsSectionId: effOverride === null ? null : (effOverride ?? po.overrideTdsSectionId),
            termsAccepted: b.termsAccepted !== undefined ? b.termsAccepted : po.termsAccepted,
            lines: { create: processedLines },
          },
          include: { lines: true },
        });
      });
      auditDiff('PurchaseOrder', po.id, 'EDIT', po as any, { vendorId: b.vendorId || po.vendorId, subtotal, grandTotal, remarks: b.remarks ?? po.remarks, paymentTerms: b.paymentTerms ?? po.paymentTerms, linesCount: processedLines.length }, ['vendorId', 'subtotal', 'grandTotal', 'remarks', 'paymentTerms', 'linesCount'], req.user!.id);
      return res.json(updated);
    }

    // Header-only update (no lines provided)
    const updated = await prisma.purchaseOrder.update({
      where: { id: req.params.id },
      data: {
        vendorId: b.vendorId !== undefined ? b.vendorId : undefined,
        poDate: b.poDate !== undefined ? new Date(b.poDate) : undefined,
        deliveryDate: b.deliveryDate !== undefined ? new Date(b.deliveryDate) : undefined,
        supplyType: b.supplyType !== undefined ? b.supplyType : undefined,
        placeOfSupply: b.placeOfSupply !== undefined ? b.placeOfSupply : undefined,
        paymentTerms: b.paymentTerms !== undefined ? b.paymentTerms : undefined,
        creditDays: b.creditDays !== undefined ? parseInt(b.creditDays) : undefined,
        deliveryAddress: b.deliveryAddress !== undefined ? b.deliveryAddress : undefined,
        transportMode: b.transportMode !== undefined ? b.transportMode : undefined,
        transportBy: b.transportBy !== undefined ? b.transportBy : undefined,
        remarks: b.remarks !== undefined ? b.remarks : undefined,
      },
      include: { lines: true },
    });
    auditDiff('PurchaseOrder', po.id, 'EDIT', po as any, updated as any, ['vendorId', 'paymentTerms', 'remarks', 'deliveryAddress', 'transportMode'], req.user!.id);

    res.json(updated);
}));

// DELETE /:id — delete only if DRAFT
router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
    });
    if (!po) return res.status(404).json({ error: 'PO not found' });
    if (po.status !== 'DRAFT') {
      return res.status(400).json({ error: 'Can only delete PO in DRAFT status' });
    }

    await prisma.purchaseOrder.delete({
      where: { id: req.params.id },
    });

    res.json({ ok: true });
}));

// GET /:id/audit — audit trail for a PO
router.get('/:id/audit', asyncHandler(async (req: AuthRequest, res: Response) => {
  const logs = await prisma.auditLog.findMany({
    where: { entity: 'PurchaseOrder', entityId: req.params.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  // Resolve user names
  const userIds = [...new Set(logs.map(l => l.userId))];
  const users = userIds.length > 0 ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));
  res.json(logs.map(l => ({ ...l, userName: userMap[l.userId] || l.userId, changes: JSON.parse(l.changes) })));
}));

// GET /:id/pdf — Generate PO PDF with letterhead
router.get('/:id/pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: {
        vendor: true,
        lines: true,
        grns: { include: { lines: true } },
      },
    });

    if (!po) { res.status(404).json({ error: 'PO not found' }); return; }

    // Aggregate GRN lines by poLineId → received / accepted / rejected per PO line
    const grnAgg: Record<string, { received: number; accepted: number; rejected: number }> = {};
    for (const g of (po.grns || [])) {
      for (const gl of (g.lines || [])) {
        if (!gl.poLineId) continue;
        const a = grnAgg[gl.poLineId] || (grnAgg[gl.poLineId] = { received: 0, accepted: 0, rejected: 0 });
        a.received += gl.receivedQty || 0;
        a.accepted += gl.acceptedQty || 0;
        a.rejected += gl.rejectedQty || 0;
      }
    }

    const poData = {
      poNo: po.poNo,
      poDate: po.poDate,
      deliveryDate: po.deliveryDate || po.poDate,
      vendor: po.vendor,
      supplyType: po.supplyType,
      placeOfSupply: po.placeOfSupply,
      paymentTerms: po.paymentTerms,
      creditDays: po.creditDays,
      deliveryAddress: po.deliveryAddress,
      transportMode: po.transportMode,
      remarks: po.remarks,
      lines: po.lines.map((l: any) => {
        // PO amounts are ALWAYS based on received qty (user rule: "we always calc PO amount based on what we received")
        const agg = grnAgg[l.id] || { received: 0, accepted: 0, rejected: 0 };
        const hasReceipts = (l.receivedQty || 0) > 0 || agg.received > 0;
        const receivedQty = l.receivedQty || agg.received || 0;
        // QTY column: show received if any receipts, else show ordered
        const displayQty = hasReceipts ? receivedQty : (l.quantity >= 900000 ? 0 : l.quantity);
        // Amounts: always from received qty when receipts exist
        const lineAmount = hasReceipts ? (receivedQty * l.rate) : (l.quantity < 900000 ? l.quantity * l.rate : 0);
        const taxable = lineAmount * (1 - (l.discountPercent || 0) / 100);
        const gstAmt = taxable * (l.gstPercent || 0) / 100;
        const isIntra = po.supplyType !== 'INTER_STATE';
        const orderedQty = l.quantity >= 900000 ? 0 : l.quantity;
        const overDelivered = agg.received > orderedQty && orderedQty > 0;
        return {
          description: l.description,
          hsnCode: l.hsnCode || '',
          quantity: displayQty,
          orderedQty,
          receivedQty: Math.round(agg.received * 100) / 100,
          acceptedQty: Math.round(agg.accepted * 100) / 100,
          rejectedQty: Math.round(agg.rejected * 100) / 100,
          overDelivered,
          unit: l.unit,
          rate: l.rate,
          discountPercent: l.discountPercent || 0,
          gstPercent: l.gstPercent || 0,
          isRCM: l.isRCM || false,
          amount: Math.round(lineAmount * 100) / 100,
          taxableAmount: Math.round(taxable * 100) / 100,
          cgst: l.cgstAmount || (isIntra ? Math.round(gstAmt / 2 * 100) / 100 : 0),
          sgst: l.sgstAmount || (isIntra ? Math.round(gstAmt / 2 * 100) / 100 : 0),
          igst: l.igstAmount || (isIntra ? 0 : Math.round(gstAmt * 100) / 100),
          lineTotal: l.lineTotal && l.lineTotal > 0 ? l.lineTotal : Math.round((taxable + gstAmt) * 100) / 100,
        };
      }),
      // Always use received qty for totals — "PO amount = what we received"
      subtotal: (() => {
        const calc = Math.round(po.lines.reduce((s: number, l: any) => {
          const hasReceipts = (l.receivedQty || 0) > 0;
          const qty = hasReceipts ? (l.receivedQty || 0) : (l.quantity >= 900000 ? 0 : l.quantity);
          return s + qty * l.rate;
        }, 0) * 100) / 100;
        return calc > 0 ? calc : (po.subtotal || 0);
      })(),
      totalGst: (() => {
        return Math.round(po.lines.reduce((s: number, l: any) => {
          const hasReceipts = (l.receivedQty || 0) > 0;
          const qty = hasReceipts ? (l.receivedQty || 0) : (l.quantity >= 900000 ? 0 : l.quantity);
          return s + qty * l.rate * (l.gstPercent || 0) / 100;
        }, 0) * 100) / 100;
      })(),
      freightCharge: po.freightCharge,
      otherCharges: po.otherCharges,
      roundOff: po.roundOff,
      grandTotal: (() => {
        const calc = Math.round(po.lines.reduce((s: number, l: any) => {
          const hasReceipts = (l.receivedQty || 0) > 0;
          const qty = hasReceipts ? (l.receivedQty || 0) : (l.quantity >= 900000 ? 0 : l.quantity);
          const base = qty * l.rate;
          return s + base + base * (l.gstPercent || 0) / 100;
        }, 0) * 100) / 100;
        return calc > 0 ? calc : (po.grandTotal || 0);
      })(),
      preparedBy: 'Purchase Department',
      approvedBy: 'Sibtay Hasnain Zaidi',
      authorizedSignatory: 'OP Pandey — Unit Head',
      company: await getCompanyForPdf(po.companyId),
      // Print T&C clauses ticked on the PO
      contractTerms: (po.termsAccepted || [])
        .map((k) => termByKey(k))
        .filter((t): t is NonNullable<ReturnType<typeof termByKey>> => !!t)
        .map((t) => ({ group: t.group, label: t.label })),
      // Flat list of GRN receipts against this PO — same view as OPEN-PO lines, now for all POs
      grns: (po.grns || [])
        .filter((g: any) => g.status !== 'CANCELLED')
        .slice()
        .sort((a: any, b: any) => new Date(a.grnDate).getTime() - new Date(b.grnDate).getTime())
        .flatMap((g: any) =>
          (g.lines || []).map((gl: any) => ({
            grnNo: g.grnNo,
            grnDate: g.grnDate,
            vehicleNo: g.vehicleNo || '',
            invoiceNo: g.invoiceNo || '',
            description: gl.description || '',
            receivedQty: Math.round((gl.receivedQty || 0) * 100) / 100,
            acceptedQty: Math.round((gl.acceptedQty || 0) * 100) / 100,
            rejectedQty: Math.round((gl.rejectedQty || 0) * 100) / 100,
            unit: gl.unit || '',
            rate: Math.round((gl.rate || 0) * 100) / 100,
            amount: Math.round((gl.amount || 0) * 100) / 100,
          }))
        ),
      grnTotals: (() => {
        const nonCancelled = (po.grns || []).filter((g: any) => g.status !== 'CANCELLED');
        const totalQty = nonCancelled.reduce((s: number, g: any) =>
          s + (g.lines || []).reduce((ls: number, l: any) => ls + (l.acceptedQty || 0), 0), 0);
        const totalAmt = nonCancelled.reduce((s: number, g: any) =>
          s + (g.lines || []).reduce((ls: number, l: any) => ls + (l.amount || 0), 0), 0);
        return {
          count: nonCancelled.length,
          qty: Math.round(totalQty * 100) / 100,
          amount: Math.round(totalAmt * 100) / 100,
        };
      })(),
    };
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await renderDocumentPdf({
        docType: 'PURCHASE_ORDER',
        data: poData,
        verifyId: po.id,
      });
    } catch (renderErr) {
      console.error('[PO PDF] Puppeteer render failed, falling back to PDFKit:', (renderErr as Error).message);
      pdfBuffer = await generatePOPdf(poData);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="PO-${po.poNo}.pdf"`);
    res.send(pdfBuffer);
}));

// POST /:id/send-email — Send PO PDF to vendor via email
router.post('/:id/send-email', asyncHandler(async (req: AuthRequest, res: Response) => {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: { vendor: true, lines: true },
    });
    if (!po) { res.status(404).json({ error: 'PO not found' }); return; }

    const toEmail = req.body.to || po.vendor.email;
    if (!toEmail) { res.status(400).json({ error: 'No email address. Add vendor email or provide "to" in request.' }); return; }

    const poLabel = `PO-${String(po.poNo).padStart(4, '0')}`;
    const pdfBuffer = await generatePOPdf({
      poNo: po.poNo, poDate: po.poDate, deliveryDate: po.deliveryDate || po.poDate,
      vendor: po.vendor, supplyType: po.supplyType, placeOfSupply: po.placeOfSupply,
      paymentTerms: po.paymentTerms, creditDays: po.creditDays,
      deliveryAddress: po.deliveryAddress, transportMode: po.transportMode, remarks: po.remarks,
      lines: po.lines.map((l: any) => ({
        description: l.description, hsnCode: l.hsnCode || '', quantity: l.quantity, unit: l.unit,
        rate: l.rate, discountPercent: l.discountPercent || 0, gstPercent: l.gstPercent || 0,
        isRCM: l.isRCM || false, amount: l.amount || l.quantity * l.rate,
        taxableAmount: l.taxableAmount || (l.quantity * l.rate * (1 - (l.discountPercent || 0) / 100)),
        cgst: l.cgstAmount || l.cgst || 0, sgst: l.sgstAmount || l.sgst || 0,
        igst: l.igstAmount || l.igst || 0, lineTotal: l.lineTotal || 0,
      })),
      subtotal: po.subtotal, totalGst: po.totalGst, freightCharge: po.freightCharge,
      otherCharges: po.otherCharges, roundOff: po.roundOff, grandTotal: po.grandTotal,
    });

    const subject = req.body.subject || `${poLabel} — Purchase Order from MSPIL`;
    const body = req.body.body || `Dear ${po.vendor.name},\n\nPlease find attached Purchase Order ${poLabel} dated ${new Date(po.poDate).toLocaleDateString('en-IN')}.\n\nTotal Amount: Rs.${po.grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}\nDelivery Date: ${new Date(po.deliveryDate || po.poDate).toLocaleDateString('en-IN')}\nPayment Terms: ${po.paymentTerms || 'As agreed'}\n\nKindly acknowledge receipt and confirm delivery schedule.\n\nRegards,\nMahakaushal Sugar & Power Industries Ltd.\nVillage Bachai, Dist. Narsinghpur (M.P.)`;

    const result = await sendEmail({
      to: toEmail, subject, text: body,
      attachments: [{ filename: `${poLabel}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }],
    });

    if (result.success) {
      res.json({ ok: true, messageId: result.messageId, sentTo: toEmail });
    } else {
      res.status(500).json({ error: result.error || 'Email send failed' });
    }
}));

// ═══════════════════════════════════════════════════════
// PAY ON PO — Running account payments (partial OK)
// ═══════════════════════════════════════════════════════

// GET /:id/payments — payment ledger for this PO
router.get('/:id/payments', asyncHandler(async (req: AuthRequest, res: Response) => {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: req.params.id },
    select: { id: true, poNo: true, grandTotal: true, lines: { select: { quantity: true, receivedQty: true, rate: true, gstPercent: true } } },
  });
  if (!po) return res.status(404).json({ error: 'PO not found' });

  // Calculate receivable from RECEIVED quantity only (not full PO)
  const receivable = Math.round(po.lines.reduce((s, l) => {
    const base = (l.receivedQty || 0) * l.rate;
    return s + base + base * (l.gstPercent || 0) / 100;
  }, 0) * 100) / 100;
  const poTotal = po.grandTotal > 0 ? po.grandTotal : receivable;

  // Find all payments referencing this PO
  const payments = await prisma.vendorPayment.findMany({
    where: {
      OR: [
        { remarks: { contains: `PO-${po.poNo} ` } },
        { remarks: { endsWith: `PO-${po.poNo}` } },
      ],
    },
    orderBy: { paymentDate: 'asc' },
    select: { id: true, paymentDate: true, amount: true, mode: true, reference: true, remarks: true, isAdvance: true, paymentStatus: true, paymentNo: true, bankReceiptPath: true, adviceSentAt: true },
  });

  let running = 0;
  const ledger = payments.map(p => {
    running += p.amount;
    return { ...p, runningTotal: Math.round(running * 100) / 100 };
  });

  // Count pending cash vouchers
  const pendingCash = await prisma.cashVoucher.findMany({
    where: { status: 'ACTIVE', purpose: { contains: `PO-${po.poNo}` } },
    select: { id: true, voucherNo: true, amount: true, date: true },
  });
  const pendingCashTotal = pendingCash.reduce((s, v) => s + v.amount, 0);

  res.json({
    poNo: po.poNo,
    poTotal,
    receivedValue: receivable,
    totalPaid: Math.round(running * 100) / 100,
    pendingCash: Math.round(pendingCashTotal * 100) / 100,
    pendingCashVouchers: pendingCash,
    remaining: Math.round(Math.max(0, receivable - running - pendingCashTotal) * 100) / 100,
    isFullyPaid: (running + pendingCashTotal) >= receivable - 0.01,
    payments: ledger,
  });
}));

// POST /:id/pay — record payment against PO (partial OK, auto-close when fully paid)
router.post('/:id/pay', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { mode, reference, remarks: userRemarks, hasGst } = req.body;
  const amount = parseFloat(req.body.amount);
  if (!amount || !isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Amount must be a positive number' });
  if (typeof hasGst !== 'boolean') return res.status(400).json({ error: 'Select whether this payment includes GST (hasGst true/false).' });

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: req.params.id },
    select: { id: true, poNo: true, vendorId: true, grandTotal: true, status: true, lines: { select: { quantity: true, receivedQty: true, rate: true, gstPercent: true, description: true, inventoryItem: { select: { category: true } } } } },
  });
  if (!po) return res.status(404).json({ error: 'PO not found' });

  // Detect category from inventory item (FUEL, RAW_MATERIAL, CHEMICAL, etc.)
  const itemCategory = po.lines[0]?.inventoryItem?.category || '';
  const FUEL_KEYWORDS = ['coal', 'husk', 'bagasse', 'mustard', 'furnace', 'diesel', 'hsd', 'lfo', 'hfo', 'biomass'];
  const isFuel = itemCategory === 'FUEL' || FUEL_KEYWORDS.some(kw => (po.lines[0]?.description || '').toLowerCase().includes(kw));

  // Calculate receivable — based on RECEIVED quantity only (not full PO value)
  // User can only pay for material that's actually been delivered
  const receivedValue = Math.round(po.lines.reduce((s, l) => {
    const base = (l.receivedQty || 0) * l.rate;
    return s + base + base * (l.gstPercent || 0) / 100;
  }, 0) * 100) / 100;
  const poTotal = po.grandTotal > 0 ? po.grandTotal : Math.round(po.lines.reduce((s, l) => {
    const qty = l.quantity >= 900000 ? (l.receivedQty || 0) : l.quantity;
    const base = qty * l.rate;
    return s + base + base * (l.gstPercent || 0) / 100;
  }, 0) * 100) / 100;
  const receivable = receivedValue; // Cap at received value, not PO total

  // Calculate already paid (confirmed payments)
  const existingPayments = await prisma.vendorPayment.findMany({
    where: {
      vendorId: po.vendorId,
      invoiceId: null,
      OR: [
        { remarks: { contains: `PO-${po.poNo} ` } },
        { remarks: { endsWith: `PO-${po.poNo}` } },
      ],
    },
    select: { amount: true },
  });
  const alreadyPaid = existingPayments.reduce((s, p) => s + p.amount, 0);

  // Count INITIATED (pending bank) payments — committed but UTR not entered yet
  const pendingBankPayments = await prisma.vendorPayment.findMany({
    where: {
      vendorId: po.vendorId,
      paymentStatus: 'INITIATED',
      OR: [
        { remarks: { contains: `PO-${po.poNo} ` } },
        { remarks: { endsWith: `PO-${po.poNo}` } },
      ],
    },
    select: { amount: true },
  });
  const pendingBank = pendingBankPayments.reduce((s, p) => s + p.amount, 0);

  // Count ACTIVE (pending) cash vouchers
  const pendingCashVouchers = await prisma.cashVoucher.findMany({
    where: {
      status: 'ACTIVE',
      purpose: { contains: `PO-${po.poNo}` },
    },
    select: { amount: true },
  });
  const pendingCash = pendingCashVouchers.reduce((s, v) => s + v.amount, 0);

  const totalCommitted = alreadyPaid + pendingBank + pendingCash;
  const remaining = receivable - totalCommitted;

  if (amount > remaining + 0.01) {
    const parts = [];
    if (alreadyPaid > 0) parts.push(`paid ₹${alreadyPaid.toLocaleString('en-IN')}`);
    if (pendingCash > 0) parts.push(`₹${pendingCash.toLocaleString('en-IN')} awaiting cash confirmation`);
    return res.status(400).json({ error: `Payment ₹${amount.toLocaleString('en-IN')} exceeds remaining ₹${remaining.toFixed(2)} (${parts.join(', ')})` });
  }

  const payMode = mode || 'NEFT';

  // CASH payments → create CashVoucher (ACTIVE). VendorPayment created on settlement.
  if (payMode === 'CASH') {
    const vendor = await prisma.vendor.findUnique({ where: { id: po.vendorId }, select: { name: true, phone: true } });
    const voucher = await prisma.cashVoucher.create({
      data: {
        date: new Date(),
        type: 'PAYMENT',
        payeeName: vendor?.name || 'Unknown',
        payeePhone: vendor?.phone || null,
        purpose: `${isFuel ? 'Fuel' : 'Material'} payment against PO-${po.poNo}${userRemarks ? ' | ' + userRemarks : ''}`,
        category: isFuel ? 'FUEL' : 'MATERIAL',
        amount,
        paymentMode: 'CASH',
        authorizedBy: req.user!.name || 'Admin',
        status: 'ACTIVE',
        userId: req.user!.id,
        companyId: getActiveCompanyId(req),
      },
    });

    // Auto-journal for cash advance
    try {
      const { createAdvanceJournal } = await import('../services/autoJournal');
      if (typeof createAdvanceJournal === 'function') {
        const jid = await createAdvanceJournal(prisma as Parameters<typeof createAdvanceJournal>[0], {
          id: voucher.id, amount, mode: 'CASH', reference: `CV-${voucher.voucherNo}`,
          vendorId: po.vendorId, userId: req.user!.id, paymentDate: voucher.date,
        });
        if (jid) await prisma.cashVoucher.update({ where: { id: voucher.id }, data: { journalEntryId: jid } });
      }
    } catch { /* best effort */ }

    return res.json({
      type: 'CASH_VOUCHER',
      voucher,
      message: `Cash voucher #${voucher.voucherNo} created. Go to Cash Vouchers to confirm payment.`,
      totalPaid: Math.round(alreadyPaid * 100) / 100,
      remaining: Math.round(remaining * 100) / 100,
      fullyPaid: false,
    });
  }

  // BANK payments → create VendorPayment with INITIATED status (pending UTR confirmation)
  const vendor = await prisma.vendor.findUnique({
    where: { id: po.vendorId },
    select: { name: true, phone: true, bankName: true, bankAccount: true, bankIfsc: true },
  });

  const payment = await prisma.vendorPayment.create({
    data: {
      vendorId: po.vendorId,
      paymentDate: new Date(),
      amount,
      mode: payMode,
      reference: reference || '', // UTR can be empty — filled later on confirm
      paymentStatus: reference ? 'CONFIRMED' : 'INITIATED', // If UTR provided, auto-confirm
      confirmedAt: reference ? new Date() : null,
      isAdvance: false,
      hasGst,
      remarks: `Payment against PO-${po.poNo}${userRemarks ? ' | ' + userRemarks : ''}`,
      userId: req.user!.id,
      companyId: getActiveCompanyId(req),
    },
  });

  // Auto-journal only if confirmed (has UTR)
  if (payment.paymentStatus === 'CONFIRMED') {
    try {
      const { onVendorPaymentMade } = await import('../services/autoJournal');
      await onVendorPaymentMade(prisma as Parameters<typeof onVendorPaymentMade>[0], {
        id: payment.id, amount, mode: payMode, reference: reference || '',
        tdsDeducted: 0, vendorId: po.vendorId, userId: req.user!.id, paymentDate: payment.paymentDate,
      });
    } catch { /* best effort */ }
  }

  // Auto-close PO when fully paid (only count confirmed payments)
  if (payment.paymentStatus === 'CONFIRMED') {
    const newTotalPaid = alreadyPaid + amount;
    const fullyPaid = newTotalPaid >= receivable - 0.01;
    if (fullyPaid && po.status !== 'CLOSED') {
      await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: 'CLOSED' } });
    }
  }

  res.json({
    type: payment.paymentStatus === 'CONFIRMED' ? 'BANK_PAYMENT' : 'BANK_INITIATED',
    payment,
    vendor: vendor ? { name: vendor.name, phone: vendor.phone, bankName: vendor.bankName, bankAccount: vendor.bankAccount, bankIfsc: vendor.bankIfsc } : null,
    poNo: po.poNo,
    totalPaid: Math.round((alreadyPaid + (payment.paymentStatus === 'CONFIRMED' ? amount : 0)) * 100) / 100,
    remaining: Math.round(Math.max(0, receivable - alreadyPaid - (payment.paymentStatus === 'CONFIRMED' ? amount : 0)) * 100) / 100,
    fullyPaid: payment.paymentStatus === 'CONFIRMED' && (alreadyPaid + amount) >= receivable - 0.01,
  });
}));

// POST /payments/:paymentId/confirm — enter UTR and confirm a bank payment
router.post('/payments/:paymentId/confirm', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { reference } = req.body;
  if (!reference || !reference.trim()) return res.status(400).json({ error: 'UTR / Reference is required to confirm' });

  const payment = await prisma.vendorPayment.findUnique({ where: { id: req.params.paymentId } });
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.paymentStatus === 'CONFIRMED') return res.status(400).json({ error: 'Payment already confirmed' });

  const updated = await prisma.vendorPayment.update({
    where: { id: payment.id },
    data: { reference: reference.trim(), paymentStatus: 'CONFIRMED', confirmedAt: new Date() },
  });

  // Now create journal entry (was deferred until confirmation)
  try {
    const { onVendorPaymentMade } = await import('../services/autoJournal');
    await onVendorPaymentMade(prisma as Parameters<typeof onVendorPaymentMade>[0], {
      id: updated.id, amount: updated.amount, mode: updated.mode, reference: updated.reference || '',
      tdsDeducted: 0, vendorId: updated.vendorId, userId: req.user!.id, paymentDate: updated.paymentDate,
    });
  } catch { /* best effort */ }

  // Check if PO is now fully paid
  const poMatch = (payment.remarks || '').match(/PO-(\d+)/);
  if (poMatch) {
    const poNo = parseInt(poMatch[1]);
    const po = await prisma.purchaseOrder.findFirst({
      where: { poNo },
      select: { id: true, status: true, grandTotal: true, vendorId: true, lines: { select: { receivedQty: true, rate: true, gstPercent: true, quantity: true } } },
    });
    if (po && po.status !== 'CLOSED') {
      const receivable = Math.round(po.lines.reduce((s, l) => {
        const base = (l.receivedQty || 0) * l.rate;
        return s + base + base * (l.gstPercent || 0) / 100;
      }, 0) * 100) / 100;
      const allPayments = await prisma.vendorPayment.findMany({
        where: { vendorId: po.vendorId, paymentStatus: 'CONFIRMED', invoiceId: null, OR: [{ remarks: { contains: `PO-${poNo} ` } }, { remarks: { endsWith: `PO-${poNo}` } }] },
        select: { amount: true },
      });
      const totalPaid = allPayments.reduce((s, p) => s + p.amount, 0);
      if (totalPaid >= receivable - 0.01) {
        await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: 'CLOSED' } });
      }
    }
  }

  res.json({ ok: true, payment: updated });
}));

export default router;
