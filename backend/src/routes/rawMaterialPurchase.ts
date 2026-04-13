import { Router, Response } from 'express';
import { authenticate, AuthRequest, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { NotFoundError } from '../shared/errors';
import { z } from 'zod';
import prisma from '../config/prisma';

const router = Router();

// RM Deals page is for actual raw materials only (maize, broken rice, molasses, etc).
// Chemicals, packing, spares, consumables → Stores Deals page.
const RAW_CATEGORIES = ['RAW_MATERIAL'] as const;

// ==========================================================================
//  MATERIALS MASTER — InventoryItem with category IN RAW_MATERIAL, CHEMICAL, PACKING
// ==========================================================================

const materialSchema = z.object({
  name: z.string().min(1),
  category: z.enum(['RAW_MATERIAL', 'CHEMICAL', 'PACKING']).default('RAW_MATERIAL'),
  unit: z.string().optional().default('MT'),
  hsnCode: z.string().nullable().optional(),
  gstPercent: z.number().nullable().optional().default(5),
  defaultRate: z.number().nullable().optional(),
  minStock: z.number().nullable().optional(),
  maxStock: z.number().nullable().optional(),
});

// GET /materials — list all raw material/chemical/packing items
router.get('/materials', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const items = await prisma.inventoryItem.findMany({
    where: { category: { in: [...RAW_CATEGORIES] }, isActive: true },
    take: 200,
    orderBy: { name: 'asc' },
    select: {
      id: true, name: true, code: true, category: true, unit: true,
      currentStock: true, avgCost: true, totalValue: true,
      minStock: true, maxStock: true, hsnCode: true, gstPercent: true,
      defaultRate: true, isActive: true,
    },
  });
  res.json(items);
}));

// POST /materials — create new item
router.post('/materials', authenticate, validate(materialSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;

  // Auto-generate code: RM-001, CH-001, PK-001 based on category
  const prefixMap: Record<string, string> = { RAW_MATERIAL: 'RM', CHEMICAL: 'CH', PACKING: 'PK' };
  const prefix = prefixMap[b.category] || 'RM';
  const count = await prisma.inventoryItem.count({
    where: { code: { startsWith: `${prefix}-` } },
  });
  const code = `${prefix}-${String(count + 1).padStart(3, '0')}`;

  const item = await prisma.inventoryItem.create({
    data: {
      name: b.name,
      code,
      category: b.category || 'RAW_MATERIAL',
      unit: b.unit || 'MT',
      hsnCode: b.hsnCode || null,
      gstPercent: b.gstPercent ?? 5,
      defaultRate: b.defaultRate || null,
      minStock: b.minStock || null,
      maxStock: b.maxStock || null,
    },
  });
  res.status(201).json(item);
}));

// PUT /materials/:id — update item
router.put('/materials/:id', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const item = await prisma.inventoryItem.findUnique({ where: { id: req.params.id } });
  if (!item) throw new NotFoundError('Material item', req.params.id);

  const b = req.body;
  const updated = await prisma.inventoryItem.update({
    where: { id: req.params.id },
    data: {
      name: b.name ?? item.name,
      unit: b.unit ?? item.unit,
      hsnCode: b.hsnCode !== undefined ? b.hsnCode : item.hsnCode,
      gstPercent: b.gstPercent ?? item.gstPercent,
      defaultRate: b.defaultRate !== undefined ? b.defaultRate : item.defaultRate,
      minStock: b.minStock !== undefined ? b.minStock : item.minStock,
      maxStock: b.maxStock !== undefined ? b.maxStock : item.maxStock,
      isActive: b.isActive !== undefined ? b.isActive : item.isActive,
    },
  });
  res.json(updated);
}));


// ==========================================================================
//  DAILY CONSUMPTION — Opening / Received / Consumed / Closing
// ==========================================================================

// GET /consumption?date=YYYY-MM-DD
router.get('/consumption', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const dateStr = req.query.date as string;
  const date = dateStr ? new Date(dateStr) : new Date();
  date.setHours(0, 0, 0, 0);

  // Get all RAW_MATERIAL items
  const items = await prisma.inventoryItem.findMany({
    where: { category: 'RAW_MATERIAL', isActive: true },
    select: { id: true, name: true, code: true, unit: true, currentStock: true },
    orderBy: { name: 'asc' },
  });

  // Existing entries for this date
  const entries = await prisma.rawMaterialConsumption.findMany({
    where: { date },
    select: { id: true, materialItemId: true, openingStock: true, received: true, consumed: true, closingStock: true, remarks: true },
  });
  const entryMap = new Map(entries.map(e => [e.materialItemId, e]));

  // Previous day closing for opening defaults
  const prevDate = new Date(date);
  prevDate.setDate(prevDate.getDate() - 1);
  const prevEntries = await prisma.rawMaterialConsumption.findMany({
    where: { date: prevDate },
    select: { materialItemId: true, closingStock: true },
  });
  const prevMap = new Map(prevEntries.map(e => [e.materialItemId, e.closingStock]));

  // Today's GRN receipts per item
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + 1);
  const todayReceipts = await prisma.stockMovement.groupBy({
    by: ['itemId'],
    where: {
      movementType: 'GRN_RECEIPT',
      direction: 'IN',
      date: { gte: date, lt: nextDate },
      itemId: { in: items.map(f => f.id) },
    },
    _sum: { quantity: true },
  });
  const receiptMap = new Map(todayReceipts.map(r => [r.itemId, r._sum.quantity || 0]));

  const rows = items.map(item => {
    const entry = entryMap.get(item.id);
    const prevClosing = prevMap.get(item.id) ?? item.currentStock;
    const autoReceived = receiptMap.get(item.id) || 0;
    const received = entry?.received ?? autoReceived;

    return {
      materialItemId: item.id,
      materialName: item.name,
      materialCode: item.code,
      unit: item.unit,
      id: entry?.id || null,
      openingStock: entry?.openingStock ?? prevClosing,
      received,
      autoReceived,
      consumed: entry?.consumed ?? 0,
      closingStock: entry?.closingStock ?? (prevClosing - (entry?.consumed ?? 0) + received),
      remarks: entry?.remarks ?? '',
    };
  });

  res.json({ date: date.toISOString().split('T')[0], rows });
}));

// POST /consumption — save daily entries (upsert)
router.post('/consumption', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { date: dateStr, rows } = req.body;
  if (!dateStr || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'date and rows[] required' });
  }

  const date = new Date(dateStr);
  date.setHours(0, 0, 0, 0);

  const results = [];

  for (const row of rows) {
    const consumed = parseFloat(row.consumed) || 0;
    const received = parseFloat(row.received) || 0;
    const openingStock = parseFloat(row.openingStock) || 0;
    const closingStock = Math.max(0, openingStock + received - consumed);

    const entry = await prisma.rawMaterialConsumption.upsert({
      where: {
        date_materialItemId: { date, materialItemId: row.materialItemId },
      },
      update: {
        openingStock, received, consumed, closingStock,
        remarks: row.remarks || '',
        userId: req.user!.id,
      },
      create: {
        date,
        materialItemId: row.materialItemId,
        openingStock, received, consumed, closingStock,
        remarks: row.remarks || '',
        userId: req.user!.id,
      },
    });

    // Stock movement for consumption tracking
    if (consumed > 0) {
      try {
        const defaultWh = await prisma.warehouse.findFirst({
          where: { isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true },
        });
        if (defaultWh) {
          const existingMv = await prisma.stockMovement.findFirst({
            where: { refType: 'RM_CONSUMPTION', refId: entry.id, itemId: row.materialItemId },
          });

          if (existingMv) {
            const delta = consumed - existingMv.quantity;
            if (Math.abs(delta) > 0.001) {
              await prisma.stockMovement.update({
                where: { id: existingMv.id },
                data: { quantity: consumed, totalValue: consumed * (existingMv.costRate || 0) },
              });
              await prisma.inventoryItem.update({
                where: { id: row.materialItemId },
                data: { currentStock: { decrement: delta } },
              });
            }
          } else {
            const matItem = await prisma.inventoryItem.findUnique({
              where: { id: row.materialItemId },
              select: { avgCost: true, unit: true },
            });
            await prisma.stockMovement.create({
              data: {
                itemId: row.materialItemId,
                movementType: 'RM_CONSUMPTION',
                direction: 'OUT',
                quantity: consumed,
                unit: matItem?.unit || 'MT',
                costRate: matItem?.avgCost || 0,
                totalValue: consumed * (matItem?.avgCost || 0),
                warehouseId: defaultWh.id,
                refType: 'RM_CONSUMPTION',
                refId: entry.id,
                refNo: `RM-${dateStr}`,
                narration: 'Daily raw material consumption',
                userId: req.user!.id,
              },
            });
            await prisma.inventoryItem.update({
              where: { id: row.materialItemId },
              data: { currentStock: { decrement: consumed } },
            });
          }
        }
      } catch (_e) {
        // Don't fail daily entry if inventory sync fails
      }
    }

    results.push(entry);
  }

  res.json({ ok: true, count: results.length });
}));


// ==========================================================================
//  DEALS — PurchaseOrders for raw materials
// ==========================================================================

const dealSchema = z.object({
  vendorId: z.string().optional(),
  vendorName: z.string().optional(),
  vendorPhone: z.string().optional(),
  materialItemId: z.string().min(1),
  rate: z.number().min(0),
  quantityType: z.enum(['OPEN', 'FIXED', 'JOB_WORK']).default('OPEN'),
  quantity: z.number().optional(),
  quantityUnit: z.enum(['MT', 'KG', 'KL', 'LTR', 'NOS', 'TRUCKS']).default('MT'),
  paymentTerms: z.string().optional(),
  origin: z.string().optional(),
  deliveryPoint: z.string().optional(),
  transportBy: z.string().optional(),
  deliverySchedule: z.string().optional(),
  validUntil: z.string().optional(),
  remarks: z.string().optional(),
});

// GET /deals — list raw material deals with running balance
router.get('/deals', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const deals = await prisma.purchaseOrder.findMany({
    where: {
      ...getCompanyFilter(req),
      dealType: { in: ['OPEN', 'STANDARD', 'JOB_WORK'] },
      status: { in: ['APPROVED', 'SENT', 'PARTIAL_RECEIVED', 'RECEIVED', 'CLOSED'] },
      lines: { some: { inventoryItem: { category: { in: [...RAW_CATEGORIES] } } } },
    },
    take: 100,
    orderBy: { poDate: 'desc' },
    select: {
      id: true, poNo: true, dealType: true, status: true, poDate: true, deliveryDate: true, remarks: true, truckCap: true,
      vendor: { select: { id: true, name: true, phone: true } },
      lines: {
        select: {
          id: true, description: true, rate: true, unit: true, inventoryItemId: true,
          receivedQty: true, quantity: true,
          inventoryItem: { select: { category: true, name: true } },
        },
      },
      grns: {
        select: { id: true, grnNo: true, totalQty: true, totalAmount: true, grnDate: true },
        orderBy: { grnDate: 'desc' },
      },
      _count: { select: { grns: true } },
    },
  });

  // Add running balance for each deal
  const result = await Promise.all(deals.map(async (deal) => {
    // Sum across raw-material-category lines only
    const rawLines = deal.lines.filter(l =>
      l.inventoryItem?.category && RAW_CATEGORIES.includes(l.inventoryItem.category as typeof RAW_CATEGORIES[number])
    );
    const linesToSum = rawLines.length > 0 ? rawLines : deal.lines;
    const totalReceived = linesToSum.reduce((s, l) => s + (l.receivedQty || 0), 0);
    const totalValue = linesToSum.reduce((s, l) => s + (l.receivedQty || 0) * (l.rate || 0), 0);

    // Direct payments (no invoiceId) referencing this deal
    const directPayments = await prisma.vendorPayment.findMany({
      where: {
        vendorId: deal.vendor.id,
        invoiceId: null,
        OR: [
          { remarks: { contains: `PO-${deal.poNo} ` } },
          { remarks: { endsWith: `PO-${deal.poNo}` } },
          { remarks: { contains: `PO-${deal.poNo}|` } },
          { remarks: { contains: `PO-${deal.poNo} |` } },
        ],
      },
      select: { amount: true },
    });
    let totalPaid = directPayments.reduce((s, p) => s + p.amount, 0);

    // Invoice-based payments from GRNs
    const grnIds = deal.grns.map(g => g.id);
    if (grnIds.length > 0) {
      const invoices = await prisma.vendorInvoice.findMany({
        where: { grnId: { in: grnIds } },
        select: { paidAmount: true },
      });
      totalPaid += invoices.reduce((s, inv) => s + (inv.paidAmount || 0), 0);
    }

    // GrainTruck count for this deal
    let grainTruckCount = 0;
    try {
      grainTruckCount = await prisma.grainTruck.count({ where: { poId: deal.id } });
    } catch {
      // poId FK may not exist yet
    }

    return {
      ...deal,
      totalReceived: Math.round(totalReceived * 100) / 100,
      totalValue: Math.round(totalValue * 100) / 100,
      totalPaid: Math.round(totalPaid * 100) / 100,
      outstanding: Math.round((totalValue - totalPaid) * 100) / 100,
      truckCount: (deal as Record<string, unknown>)._count
        ? ((deal as Record<string, unknown>)._count as Record<string, number>).grns
        : deal.grns.length,
      grainTruckCount,
    };
  }));

  res.json(result);
}));

// POST /deals — create a new raw material deal
router.post('/deals', authenticate, validate(dealSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;

  // Resolve vendor — use existing ID or auto-create from name
  let vendorId = b.vendorId;

  if (vendorId) {
    const exists = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } });
    if (!exists) {
      return res.status(400).json({ error: `Vendor not found: ${vendorId}` });
    }
  }

  if (!vendorId && b.vendorName) {
    const existing = await prisma.vendor.findFirst({
      where: { name: { equals: b.vendorName, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) {
      vendorId = existing.id;
    } else {
      const count = await prisma.vendor.count();
      const newVendor = await prisma.vendor.create({
        data: {
          name: b.vendorName,
          vendorCode: `VND-${String(count + 1).padStart(4, '0')}`,
          category: 'RAW_MATERIAL',
          phone: b.vendorPhone || '',
          isActive: true,
        },
      });
      vendorId = newVendor.id;
    }
  }

  if (!vendorId) return res.status(400).json({ error: 'Select a vendor or enter a supplier name' });

  // Get material item details
  const materialItem = await prisma.inventoryItem.findUnique({
    where: { id: b.materialItemId },
    select: { id: true, name: true, unit: true, hsnCode: true, gstPercent: true, category: true },
  });
  if (!materialItem) return res.status(404).json({ error: 'Material item not found' });
  if (!RAW_CATEGORIES.includes(materialItem.category as typeof RAW_CATEGORIES[number])) {
    return res.status(400).json({ error: `Item "${materialItem.name}" is not a raw material/chemical/packing item (category=${materialItem.category})` });
  }

  const isJobWork = b.quantityType === 'JOB_WORK';
  const isOpen = b.quantityType !== 'FIXED' || isJobWork;
  const isTrucks = b.quantityUnit === 'TRUCKS';
  if (!isOpen && !isTrucks && (!b.quantity || b.quantity <= 0)) {
    return res.status(400).json({ error: 'Fixed deals require a positive quantity' });
  }

  const qty = isOpen ? 999999 : (isTrucks ? 999999 : (b.quantity || 0));
  const creditDaysMap: Record<string, number> = { ADVANCE: 0, COD: 0, NET2: 2, NET7: 7, NET10: 10, NET15: 15, NET30: 30 };
  const creditDays = creditDaysMap[b.paymentTerms || 'NET15'] ?? 15;

  // Build remarks with delivery details
  const remarkParts = [b.remarks || ''];
  if (b.origin) remarkParts.push(`Origin: ${b.origin}`);
  if (b.deliveryPoint) remarkParts.push(`Delivery: ${b.deliveryPoint}`);
  if (b.transportBy) remarkParts.push(`Transport: ${b.transportBy}`);
  if (b.deliverySchedule) remarkParts.push(`Schedule: ${b.deliverySchedule}`);
  if (isTrucks && b.quantity) remarkParts.push(`FIXED_TRUCKS:${b.quantity}`);

  // Calculate PO totals
  const lineAmount = Math.round(qty * b.rate * 100) / 100;
  const gstPercent = materialItem.gstPercent ?? 0;
  const gstAmount = Math.round(lineAmount * gstPercent / 100 * 100) / 100;
  const isIntraState = true; // MP to MP
  const cgst = isIntraState ? Math.round(gstAmount / 2 * 100) / 100 : 0;
  const sgst = isIntraState ? Math.round(gstAmount / 2 * 100) / 100 : 0;
  const igst = isIntraState ? 0 : gstAmount;
  const isRealQty = qty < 900000;
  const subtotal = isRealQty ? lineAmount : 0;
  const totalGst = isRealQty ? gstAmount : 0;
  const grandTotal = isRealQty ? Math.round((lineAmount + gstAmount) * 100) / 100 : 0;

  const po = await prisma.purchaseOrder.create({
    data: {
      vendorId,
      companyId: getActiveCompanyId(req),
      dealType: isJobWork ? 'JOB_WORK' : (isOpen ? 'OPEN' : 'STANDARD'),
      status: 'APPROVED',
      poDate: new Date(),
      deliveryDate: b.validUntil ? (() => { const d = new Date(b.validUntil + 'T23:59:00+05:30'); return d; })() : null,
      paymentTerms: b.paymentTerms || 'NET15',
      creditDays,
      deliveryAddress: b.deliveryPoint || 'Factory Gate',
      transportBy: b.transportBy || 'BY_SUPPLIER',
      remarks: remarkParts.filter(Boolean).join(' | '),
      truckCap: isTrucks && b.quantity ? Math.round(b.quantity) : null,
      subtotal,
      totalCgst: isRealQty ? cgst : 0,
      totalSgst: isRealQty ? sgst : 0,
      totalIgst: isRealQty ? igst : 0,
      totalGst,
      grandTotal,
      userId: req.user!.id,
      lines: {
        create: [{
          inventoryItemId: materialItem.id,
          description: materialItem.name,
          hsnCode: materialItem.hsnCode || '',
          quantity: qty,
          unit: materialItem.unit || 'MT',
          rate: b.rate,
          amount: isRealQty ? lineAmount : 0,
          pendingQty: qty,
          gstPercent,
          cgstAmount: isRealQty ? cgst : 0,
          sgstAmount: isRealQty ? sgst : 0,
          igstAmount: isRealQty ? igst : 0,
          taxableAmount: isRealQty ? lineAmount : 0,
          lineTotal: isRealQty ? Math.round((lineAmount + gstAmount) * 100) / 100 : 0,
        }],
      },
    },
    include: {
      vendor: { select: { name: true } },
      lines: { select: { id: true, description: true, rate: true, unit: true } },
    },
  });

  res.status(201).json(po);
}));

// PUT /deals/:id — full edit: rate, vendor, material, delivery details, close
router.put('/deals/:id', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const deal = await prisma.purchaseOrder.findUnique({
    where: { id: req.params.id },
    include: { lines: true, grns: { select: { id: true }, take: 1 } },
  });
  if (!deal || !['OPEN', 'STANDARD', 'JOB_WORK'].includes(deal.dealType)) return res.status(404).json({ error: 'Deal not found' });

  const b = req.body;
  const hasGrns = deal.grns.length > 0;

  // Block vendor/material change if GRNs already received
  if (hasGrns && b.vendorId && b.vendorId !== deal.vendorId) {
    return res.status(400).json({ error: 'Cannot change vendor after receipts have been recorded' });
  }
  if (hasGrns && b.materialItemId && deal.lines[0]?.inventoryItemId && b.materialItemId !== deal.lines[0].inventoryItemId) {
    return res.status(400).json({ error: 'Cannot change material after receipts have been recorded' });
  }

  const line = deal.lines[0];
  if (line) {
    let inventoryItemId = line.inventoryItemId;
    let description = line.description;
    let unit = line.unit;
    let hsnCode = line.hsnCode || '';
    let gstPercent = line.gstPercent || 0;
    const rate = b.rate !== undefined ? (parseFloat(String(b.rate)) || 0) : line.rate;

    if (b.materialItemId && b.materialItemId !== line.inventoryItemId) {
      const materialItem = await prisma.inventoryItem.findUnique({
        where: { id: b.materialItemId },
        select: { id: true, name: true, unit: true, hsnCode: true, gstPercent: true, category: true },
      });
      if (!materialItem) return res.status(404).json({ error: 'Material item not found' });
      if (!RAW_CATEGORIES.includes(materialItem.category as typeof RAW_CATEGORIES[number])) {
        return res.status(400).json({ error: `Item "${materialItem.name}" is not a raw material/chemical/packing item (category=${materialItem.category})` });
      }
      inventoryItemId = materialItem.id;
      description = materialItem.name;
      unit = materialItem.unit || unit;
      hsnCode = materialItem.hsnCode || '';
      gstPercent = materialItem.gstPercent ?? 0;
    }

    const isRealQty = line.quantity < 900000;
    const amount = isRealQty ? Math.round(line.quantity * rate * 100) / 100 : 0;
    const totalGst = isRealQty ? Math.round(amount * gstPercent / 100 * 100) / 100 : 0;
    const cgstAmount = isRealQty ? Math.round(totalGst / 2 * 100) / 100 : 0;
    const sgstAmount = isRealQty ? Math.round(totalGst / 2 * 100) / 100 : 0;
    const igstAmount = 0;
    const lineTotal = isRealQty ? Math.round((amount + totalGst) * 100) / 100 : 0;

    await prisma.$transaction([
      prisma.pOLine.update({
        where: { id: line.id },
        data: {
          inventoryItemId,
          description,
          unit,
          hsnCode,
          gstPercent,
          rate,
          amount,
          taxableAmount: amount,
          cgstAmount,
          sgstAmount,
          igstAmount,
          totalGst,
          lineTotal,
        },
      }),
      prisma.purchaseOrder.update({
        where: { id: deal.id },
        data: {
          subtotal: amount,
          totalCgst: cgstAmount,
          totalSgst: sgstAmount,
          totalIgst: igstAmount,
          totalGst,
          grandTotal: lineTotal,
        },
      }),
    ]);
  }

  // Update PO fields
  const poUpdate: Record<string, unknown> = {};
  if (b.status) {
    const validStatuses = ['APPROVED', 'PARTIAL_RECEIVED', 'RECEIVED', 'CLOSED'];
    if (!validStatuses.includes(b.status)) {
      return res.status(400).json({ error: `Invalid status: ${b.status}. Allowed: ${validStatuses.join(', ')}` });
    }
    if (b.status === 'CLOSED') {
      const confirmedGrns = await prisma.goodsReceipt.count({ where: { poId: deal.id, status: 'CONFIRMED' } });
      if (confirmedGrns === 0) {
        return res.status(400).json({ error: 'Cannot close deal with no confirmed receipts' });
      }
    }
    poUpdate.status = b.status;
  }
  if (b.remarks !== undefined) poUpdate.remarks = b.remarks;
  if (b.paymentTerms) {
    poUpdate.paymentTerms = b.paymentTerms;
    const creditDaysMap: Record<string, number> = { ADVANCE: 0, COD: 0, NET2: 2, NET7: 7, NET10: 10, NET15: 15, NET30: 30 };
    poUpdate.creditDays = creditDaysMap[b.paymentTerms] ?? 15;
  }
  if (b.validUntil !== undefined) {
    poUpdate.deliveryDate = b.validUntil ? new Date(b.validUntil + 'T23:59:00+05:30') : null;
  }
  if (b.deliveryPoint !== undefined) poUpdate.deliveryAddress = b.deliveryPoint || 'Factory Gate';
  if (b.transportBy !== undefined) poUpdate.transportBy = b.transportBy || 'BY_SUPPLIER';
  if (b.truckCap !== undefined) poUpdate.truckCap = b.truckCap ? Math.round(b.truckCap) : null;
  if (b.vendorId && !hasGrns) poUpdate.vendorId = b.vendorId;

  if (Object.keys(poUpdate).length > 0) {
    await prisma.purchaseOrder.update({ where: { id: req.params.id }, data: poUpdate });
  }

  res.json({ ok: true });
}));

// DELETE /deals/:id — delete a deal (only if no GRNs)
router.delete('/deals/:id', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const deal = await prisma.purchaseOrder.findUnique({
    where: { id: req.params.id },
    include: { grns: { select: { id: true }, take: 1 }, lines: { select: { id: true } } },
  });
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  if (deal.grns.length > 0) return res.status(400).json({ error: 'Cannot delete — trucks already received against this deal' });

  await prisma.$transaction([
    prisma.pOLine.deleteMany({ where: { poId: deal.id } }),
    prisma.purchaseOrder.delete({ where: { id: deal.id } }),
  ]);
  res.json({ ok: true });
}));


// ==========================================================================
//  TRUCKS / GRNs FOR A DEAL
// ==========================================================================

// GET /deals/:id/trucks — GrainTrucks + GRNs for a deal
router.get('/deals/:id/trucks', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const grns = await prisma.goodsReceipt.findMany({
    where: { poId: req.params.id },
    take: 500,
    orderBy: { grnDate: 'desc' },
    select: {
      id: true, grnNo: true, grnDate: true, vehicleNo: true,
      totalQty: true, totalAmount: true, remarks: true,
      lines: { select: { receivedQty: true, rate: true, unit: true } },
    },
  });

  let grainTrucks: Array<Record<string, unknown>> = [];
  try {
    grainTrucks = await prisma.grainTruck.findMany({
      where: { poId: req.params.id },
      take: 500,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, vehicleNo: true, weightGross: true, weightTare: true, weightNet: true,
        moisture: true, starchPercent: true, damagedPercent: true, foreignMatter: true,
        quarantine: true, quarantineReason: true, supplier: true,
        date: true, createdAt: true, grnId: true, remarks: true,
      },
    }) as unknown as Array<Record<string, unknown>>;
  } catch {
    // poId FK on GrainTruck may not exist yet
  }

  res.json({ grns, grainTrucks });
}));


// ==========================================================================
//  PAYMENTS
// ==========================================================================

const paymentSchema = z.object({
  dealId: z.string().min(1),
  amount: z.number().positive(),
  mode: z.string().default('CASH'),
  reference: z.string().optional(),
  remarks: z.string().optional(),
  paymentDate: z.string().optional(),
  tdsDeducted: z.number().optional().default(0),
  tdsSection: z.string().optional(),
});

// POST /deals/:id/payment — record payment against a raw material deal
router.post('/deals/:id/payment', authenticate, validate(paymentSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const dealId = req.params.id;

  const deal = await prisma.purchaseOrder.findUnique({
    where: { id: dealId },
    include: { grns: { select: { id: true, status: true } }, lines: { select: { receivedQty: true } } },
  });
  if (!deal) return res.status(404).json({ error: 'Deal not found' });

  // Require at least one confirmed GRN before allowing payment
  const confirmedGrns = deal.grns.filter((g: { status: string }) => g.status === 'CONFIRMED');
  const totalReceived = deal.lines.reduce((s: number, l: { receivedQty: number | null }) => s + (l.receivedQty || 0), 0);
  if (confirmedGrns.length === 0 || totalReceived <= 0) {
    return res.status(400).json({ error: 'Cannot make payment before any confirmed receipt. Confirm the GRN first.' });
  }

  const amount = b.amount;
  const tdsDeducted = parseFloat(b.tdsDeducted) || 0;
  const paymentDate = b.paymentDate ? new Date(b.paymentDate) : new Date();

  // Create VendorPayment with PO reference in remarks
  const payment = await prisma.vendorPayment.create({
    data: {
      vendorId: deal.vendorId,
      paymentDate,
      amount,
      mode: b.mode || 'CASH',
      reference: b.reference || '',
      tdsDeducted,
      tdsSection: b.tdsSection || null,
      isAdvance: false,
      remarks: `Raw material deal PO-${deal.poNo}${b.remarks ? ' | ' + b.remarks : ''}`,
      userId: req.user!.id,
    },
  });

  // Auto-journal
  const { onVendorPaymentMade } = await import('../services/autoJournal');
  onVendorPaymentMade(prisma as Parameters<typeof onVendorPaymentMade>[0], {
    id: payment.id,
    amount,
    mode: b.mode || 'CASH',
    reference: b.reference || '',
    tdsDeducted,
    vendorId: deal.vendorId,
    userId: req.user!.id,
    paymentDate,
  }).catch(() => {});

  res.status(201).json(payment);
}));

// GET /deals/:id/payments — list payments for a deal
router.get('/deals/:id/payments', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const deal = await prisma.purchaseOrder.findUnique({
    where: { id: req.params.id },
    select: { vendorId: true, poNo: true, vendor: { select: { name: true } } },
  });
  if (!deal) return res.status(404).json({ error: 'Deal not found' });

  const directPayments = await prisma.vendorPayment.findMany({
    where: {
      vendorId: deal.vendorId,
      OR: [
        { remarks: { contains: `PO-${deal.poNo} ` } },
        { remarks: { endsWith: `PO-${deal.poNo}` } },
        { remarks: { contains: `PO-${deal.poNo}|` } },
      ],
    },
    take: 200,
    orderBy: { paymentDate: 'desc' },
    select: {
      id: true, paymentNo: true, paymentDate: true, amount: true,
      mode: true, reference: true, remarks: true,
    },
  });

  // Cash vouchers linked to this deal
  let cashPayments: Array<Record<string, unknown>> = [];
  try {
    cashPayments = await prisma.$queryRawUnsafe(
      `SELECT id, "voucherNo" as "paymentNo", date as "paymentDate", amount, 'CASH' as mode, "paymentRef" as reference, remarks, status FROM "CashVoucher" WHERE type = 'PAYMENT' AND status <> 'CANCELLED' AND "payeeName" = $1 AND (purpose LIKE $2 OR remarks LIKE $2) ORDER BY date DESC LIMIT 100`,
      deal.vendor.name, `%PO-${deal.poNo}%`
    ) as Array<Record<string, unknown>>;
  } catch { /* CashVoucher table may not exist */ }

  const allPayments = [
    ...directPayments.map(p => ({ ...p, type: 'BANK' as const })),
    ...cashPayments.map(p => ({ ...p, type: 'CASH_VOUCHER' as const })),
  ].sort((a, b) => new Date(String((b as Record<string, unknown>).paymentDate || 0)).getTime() - new Date(String((a as Record<string, unknown>).paymentDate || 0)).getTime());

  res.json(allPayments);
}));


// ==========================================================================
//  RECEIPTS — Recent raw material GRNs with lab quality data
// ==========================================================================

router.get('/receipts', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const grns = await prisma.goodsReceipt.findMany({
    where: {
      po: { lines: { some: { inventoryItem: { category: { in: [...RAW_CATEGORIES] } } } } },
    },
    take: 100,
    orderBy: { grnDate: 'desc' },
    select: {
      id: true, grnNo: true, grnDate: true, vehicleNo: true,
      totalQty: true, totalAmount: true, status: true, remarks: true,
      po: {
        select: {
          poNo: true,
          vendor: { select: { name: true } },
        },
      },
      lines: {
        select: {
          receivedQty: true, acceptedQty: true, rate: true, unit: true,
          inventoryItem: { select: { name: true, category: true } },
        },
      },
    },
  });

  // Join GrainTruck lab data where grnId matches
  const grnIds = grns.map(g => g.id);
  let grainTruckMap = new Map<string, Record<string, unknown>>();
  if (grnIds.length > 0) {
    try {
      const trucks = await prisma.grainTruck.findMany({
        where: { grnId: { in: grnIds } },
        take: 500,
        select: {
          grnId: true, moisture: true, starchPercent: true,
          damagedPercent: true, foreignMatter: true, quarantine: true,
        },
      });
      grainTruckMap = new Map(
        trucks
          .filter((t): t is typeof t & { grnId: string } => t.grnId !== null)
          .map(t => [t.grnId, {
            moisture: t.moisture,
            starchPercent: t.starchPercent,
            damagedPercent: t.damagedPercent,
            foreignMatter: t.foreignMatter,
            quarantine: t.quarantine,
          }])
      );
    } catch {
      // grnId FK on GrainTruck may not exist yet
    }
  }

  const result = grns.map(grn => ({
    ...grn,
    labData: grainTruckMap.get(grn.id) || null,
  }));

  res.json(result);
}));


// ==========================================================================
//  SUMMARY — KPI aggregates
// ==========================================================================

router.get('/summary', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  // Active deals count
  const activeDeals = await prisma.purchaseOrder.count({
    where: {
      ...getCompanyFilter(req),
      status: { in: ['APPROVED', 'PARTIAL_RECEIVED'] },
      lines: { some: { inventoryItem: { category: { in: [...RAW_CATEGORIES] } } } },
    },
  });

  // This month date range
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  // This month received (GRN totalQty)
  const monthGrns = await prisma.goodsReceipt.findMany({
    where: {
      grnDate: { gte: monthStart, lt: monthEnd },
      po: { lines: { some: { inventoryItem: { category: { in: [...RAW_CATEGORIES] } } } } },
    },
    select: { totalQty: true },
  });
  const thisMonthReceived = monthGrns.reduce((s, g) => s + (g.totalQty || 0), 0);

  // This month paid — vendor payments for raw material deals
  const monthPayments = await prisma.vendorPayment.findMany({
    where: {
      paymentDate: { gte: monthStart, lt: monthEnd },
      remarks: { contains: 'Raw material deal PO-' },
    },
    select: { amount: true },
  });
  const thisMonthPaid = monthPayments.reduce((s, p) => s + p.amount, 0);

  // Total outstanding across active deals (simplified aggregate)
  const activeDealsData = await prisma.purchaseOrder.findMany({
    where: {
      ...getCompanyFilter(req),
      status: { in: ['APPROVED', 'PARTIAL_RECEIVED'] },
      lines: { some: { inventoryItem: { category: { in: [...RAW_CATEGORIES] } } } },
    },
    take: 200,
    select: {
      id: true, poNo: true,
      vendor: { select: { id: true } },
      lines: {
        select: { receivedQty: true, rate: true, inventoryItem: { select: { category: true } } },
      },
      grns: { select: { id: true } },
    },
  });

  let totalOutstanding = 0;
  for (const deal of activeDealsData) {
    const rawLines = deal.lines.filter(l =>
      l.inventoryItem?.category && RAW_CATEGORIES.includes(l.inventoryItem.category as typeof RAW_CATEGORIES[number])
    );
    const linesToSum = rawLines.length > 0 ? rawLines : deal.lines;
    const totalValue = linesToSum.reduce((s, l) => s + (l.receivedQty || 0) * (l.rate || 0), 0);

    // Direct payments
    const directPayments = await prisma.vendorPayment.findMany({
      where: {
        vendorId: deal.vendor.id,
        invoiceId: null,
        OR: [
          { remarks: { contains: `PO-${deal.poNo} ` } },
          { remarks: { endsWith: `PO-${deal.poNo}` } },
          { remarks: { contains: `PO-${deal.poNo}|` } },
          { remarks: { contains: `PO-${deal.poNo} |` } },
        ],
      },
      select: { amount: true },
    });
    let totalPaid = directPayments.reduce((s, p) => s + p.amount, 0);

    // Invoice payments
    const grnIds = deal.grns.map(g => g.id);
    if (grnIds.length > 0) {
      const invoices = await prisma.vendorInvoice.findMany({
        where: { grnId: { in: grnIds } },
        select: { paidAmount: true },
      });
      totalPaid += invoices.reduce((s, inv) => s + (inv.paidAmount || 0), 0);
    }

    totalOutstanding += Math.max(0, totalValue - totalPaid);
  }

  // Today's consumption
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayEntries = await prisma.rawMaterialConsumption.findMany({
    where: { date: today },
    select: { consumed: true, received: true },
  });
  const todayConsumed = todayEntries.reduce((s, e) => s + (e.consumed || 0), 0);
  const todayReceived = todayEntries.reduce((s, e) => s + (e.received || 0), 0);

  // Low stock count (RAW_MATERIAL items below minStock — Prisma can't compare two columns)
  const allRmItems = await prisma.inventoryItem.findMany({
    where: { category: 'RAW_MATERIAL', isActive: true },
    select: { name: true, currentStock: true, minStock: true },
  });
  const lowStock = allRmItems.filter(i => i.minStock > 0 && i.currentStock < i.minStock);

  res.json({
    activeDeals,
    totalOutstanding: Math.round(totalOutstanding * 100) / 100,
    thisMonthReceived: Math.round(thisMonthReceived * 100) / 100,
    thisMonthPaid: Math.round(thisMonthPaid * 100) / 100,
    todayConsumed: Math.round(todayConsumed * 100) / 100,
    todayReceived: Math.round(todayReceived * 100) / 100,
    lowStockCount: lowStock.length,
    lowStockItems: lowStock.map(i => i.name),
  });
}));

export default router;
