import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { NotFoundError } from '../shared/errors';
import { z } from 'zod';
import prisma from '../config/prisma';

const router = Router();

// ==========================================================================
//  FUEL MASTER — InventoryItem with category='FUEL'
// ==========================================================================

const fuelMasterSchema = z.object({
  name: z.string().min(1),
  code: z.string().optional(),
  unit: z.string().optional().default('MT'),
  steamRate: z.number().nullable().optional(),
  calorificValue: z.number().nullable().optional(),
  minStock: z.number().nullable().optional().default(0),
  maxStock: z.number().nullable().optional(),
  defaultRate: z.number().nullable().optional().default(0),
  hsnCode: z.string().nullable().optional(),
  gstPercent: z.number().nullable().optional().default(5),
  location: z.string().nullable().optional(),
  remarks: z.string().nullable().optional(),
});

// GET /master — list all fuel items
router.get('/master', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const items = await prisma.inventoryItem.findMany({
    where: { category: 'FUEL', isActive: true },
    take: 100,
    orderBy: { name: 'asc' },
    select: {
      id: true, name: true, code: true, unit: true,
      currentStock: true, minStock: true, maxStock: true,
      costPerUnit: true, avgCost: true, totalValue: true,
      defaultRate: true, steamRate: true, calorificValue: true,
      hsnCode: true, gstPercent: true, location: true,
      remarks: true, isActive: true, createdAt: true,
    },
  });
  res.json(items);
}));

// POST /master — create fuel item
router.post('/master', authenticate, validate(fuelMasterSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;

  // Auto-generate code if not provided: FUEL-001, FUEL-002, etc.
  let code = b.code;
  if (!code) {
    const count = await prisma.inventoryItem.count({ where: { category: 'FUEL' } });
    code = `FUEL-${String(count + 1).padStart(3, '0')}`;
  }

  const item = await prisma.inventoryItem.create({
    data: {
      name: b.name,
      code,
      category: 'FUEL',
      unit: b.unit || 'MT',
      steamRate: b.steamRate || null,
      calorificValue: b.calorificValue || null,
      minStock: b.minStock || 0,
      maxStock: b.maxStock || null,
      defaultRate: b.defaultRate || 0,
      hsnCode: b.hsnCode || null,
      gstPercent: b.gstPercent ?? 5,
      location: b.location || null,
      remarks: b.remarks || null,
    },
  });
  res.status(201).json(item);
}));

// PUT /master/:id — update fuel item
router.put('/master/:id', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const item = await prisma.inventoryItem.findUnique({ where: { id: req.params.id } });
  if (!item) throw new NotFoundError('Fuel item', req.params.id);

  const b = req.body;
  const updated = await prisma.inventoryItem.update({
    where: { id: req.params.id },
    data: {
      name: b.name ?? item.name,
      code: b.code ?? item.code,
      unit: b.unit ?? item.unit,
      steamRate: b.steamRate !== undefined ? b.steamRate : item.steamRate,
      calorificValue: b.calorificValue !== undefined ? b.calorificValue : item.calorificValue,
      minStock: b.minStock ?? item.minStock,
      maxStock: b.maxStock !== undefined ? b.maxStock : item.maxStock,
      defaultRate: b.defaultRate ?? item.defaultRate,
      hsnCode: b.hsnCode !== undefined ? b.hsnCode : item.hsnCode,
      gstPercent: b.gstPercent ?? item.gstPercent,
      location: b.location !== undefined ? b.location : item.location,
      remarks: b.remarks !== undefined ? b.remarks : item.remarks,
    },
  });
  res.json(updated);
}));

// GET /warehouses — for location dropdown
router.get('/warehouses', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const warehouses = await prisma.warehouse.findMany({
    where: { isActive: true },
    take: 50,
    select: { id: true, code: true, name: true },
    orderBy: { name: 'asc' },
  });
  res.json(warehouses);
}));

// DELETE /master/:id — soft delete
router.delete('/master/:id', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.inventoryItem.update({
    where: { id: req.params.id },
    data: { isActive: false },
  });
  res.json({ ok: true });
}));


// ==========================================================================
//  DAILY FUEL CONSUMPTION
// ==========================================================================

// GET /consumption?date=YYYY-MM-DD
router.get('/consumption', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const dateStr = req.query.date as string;
  const date = dateStr ? new Date(dateStr) : new Date();
  // Normalize to start of day
  date.setHours(0, 0, 0, 0);

  // Get all fuel items
  const fuelItems = await prisma.inventoryItem.findMany({
    where: { category: 'FUEL', isActive: true },
    select: {
      id: true, name: true, code: true, unit: true,
      currentStock: true, steamRate: true, calorificValue: true,
    },
    orderBy: { name: 'asc' },
  });

  // Get existing consumption entries for this date
  const entries = await prisma.fuelConsumption.findMany({
    where: { date },
    select: {
      id: true, fuelItemId: true, openingStock: true,
      received: true, consumed: true, closingStock: true,
      steamGenerated: true, remarks: true,
    },
  });

  const entryMap = new Map(entries.map(e => [e.fuelItemId, e]));

  // Get previous day's closing stock for opening stock defaults
  const prevDate = new Date(date);
  prevDate.setDate(prevDate.getDate() - 1);
  const prevEntries = await prisma.fuelConsumption.findMany({
    where: { date: prevDate },
    select: { fuelItemId: true, closingStock: true },
  });
  const prevMap = new Map(prevEntries.map(e => [e.fuelItemId, e.closingStock]));

  // Get today's GRN receipts for each fuel item (auto-received from weighbridge)
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + 1);
  const todayReceipts = await prisma.stockMovement.groupBy({
    by: ['itemId'],
    where: {
      movementType: 'GRN_RECEIPT',
      direction: 'IN',
      date: { gte: date, lt: nextDate },
      itemId: { in: fuelItems.map(f => f.id) },
    },
    _sum: { quantity: true },
  });
  const receiptMap = new Map(todayReceipts.map(r => [r.itemId, r._sum.quantity || 0]));

  // Build response: one row per fuel type
  const rows = fuelItems.map(fuel => {
    const entry = entryMap.get(fuel.id);
    const prevClosing = prevMap.get(fuel.id) ?? fuel.currentStock;
    // Auto-received from weighbridge GRNs (if no manual entry yet)
    const autoReceived = receiptMap.get(fuel.id) || 0;
    const received = entry?.received ?? autoReceived;

    return {
      fuelItemId: fuel.id,
      fuelName: fuel.name,
      fuelCode: fuel.code,
      unit: fuel.unit,
      steamRate: fuel.steamRate || 0,
      // Entry data (or defaults)
      id: entry?.id || null,
      openingStock: entry?.openingStock ?? prevClosing,
      received,
      autoReceived,  // show how much came from weighbridge
      consumed: entry?.consumed ?? 0,
      closingStock: entry?.closingStock ?? (prevClosing - (entry?.consumed ?? 0) + received),
      steamGenerated: entry?.steamGenerated ?? 0,
      remarks: entry?.remarks ?? '',
    };
  });

  res.json({ date: date.toISOString().split('T')[0], rows });
}));

// POST /consumption — save daily entries (upsert all rows)
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
    const closingStock = openingStock + received - consumed;

    // Get steam rate from fuel master
    const fuel = await prisma.inventoryItem.findUnique({
      where: { id: row.fuelItemId },
      select: { steamRate: true },
    });
    const steamGenerated = consumed * (fuel?.steamRate || 0);

    const finalClosingStock = Math.max(0, closingStock);

    const entry = await prisma.fuelConsumption.upsert({
      where: {
        date_fuelItemId: { date, fuelItemId: row.fuelItemId },
      },
      update: {
        openingStock,
        received,
        consumed,
        closingStock: finalClosingStock,
        steamGenerated: Math.round(steamGenerated * 100) / 100,
        remarks: row.remarks || '',
        userId: req.user!.id,
      },
      create: {
        date,
        fuelItemId: row.fuelItemId,
        openingStock,
        received,
        consumed,
        closingStock: finalClosingStock,
        steamGenerated: Math.round(steamGenerated * 100) / 100,
        remarks: row.remarks || '',
        userId: req.user!.id,
      },
    });

    // Sync closing stock to master InventoryItem so dashboard/reports stay consistent
    try {
      await prisma.inventoryItem.update({
        where: { id: row.fuelItemId },
        data: { currentStock: finalClosingStock },
      });
    } catch (_e) {
      // Don't fail the daily entry if inventory sync fails
    }

    results.push(entry);
  }

  res.json({ ok: true, count: results.length });
}));


// ==========================================================================
//  SUMMARY — KPIs
// ==========================================================================

router.get('/summary', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const dateStr = req.query.date as string;
  const date = dateStr ? new Date(dateStr) : new Date();
  date.setHours(0, 0, 0, 0);

  // Fuel items count and total stock
  const fuelItems = await prisma.inventoryItem.findMany({
    where: { category: 'FUEL', isActive: true },
    select: { id: true, name: true, currentStock: true, minStock: true, unit: true },
  });

  const lowStock = fuelItems.filter(f => f.currentStock < f.minStock);

  // Today's consumption
  const todayEntries = await prisma.fuelConsumption.findMany({
    where: { date },
    select: { consumed: true, steamGenerated: true, received: true },
  });

  const totalConsumed = todayEntries.reduce((s, e) => s + e.consumed, 0);
  const totalSteam = todayEntries.reduce((s, e) => s + e.steamGenerated, 0);
  const totalReceived = todayEntries.reduce((s, e) => s + e.received, 0);

  res.json({
    fuelTypes: fuelItems.length,
    lowStockCount: lowStock.length,
    lowStockItems: lowStock.map(f => f.name),
    todayConsumed: Math.round(totalConsumed * 100) / 100,
    todayReceived: Math.round(totalReceived * 100) / 100,
    todaySteam: Math.round(totalSteam * 100) / 100,
  });
}));

// ==========================================================================
//  OPEN DEALS (running account for fuel vendors)
// ==========================================================================

const openDealSchema = z.object({
  vendorId: z.string().optional(),
  vendorName: z.string().optional(),
  vendorPhone: z.string().optional(),
  fuelItemId: z.string().min(1),
  rate: z.number().min(0),
  quantityType: z.string().optional().default('OPEN'),  // OPEN or FIXED
  quantity: z.number().optional(),                       // qty in MT or trucks
  quantityUnit: z.string().optional().default('MT'),     // MT or TRUCKS
  paymentTerms: z.string().optional(),
  origin: z.string().optional(),
  deliveryPoint: z.string().optional(),
  transportBy: z.string().optional(),
  deliverySchedule: z.string().optional(),
  remarks: z.string().optional(),
});

// GET /deals — list fuel deals (both open and fixed)
router.get('/deals', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const deals = await prisma.purchaseOrder.findMany({
    where: {
      dealType: { in: ['OPEN', 'STANDARD'] },
      status: { in: ['APPROVED', 'SENT', 'PARTIAL_RECEIVED'] },
      // Only fuel deals — check if any line has a fuel inventory item
      lines: { some: { inventoryItem: { category: 'FUEL' } } },
    },
    take: 100,
    orderBy: { poDate: 'desc' },
    select: {
      id: true, poNo: true, dealType: true, status: true, poDate: true, remarks: true,
      vendor: { select: { id: true, name: true, phone: true } },
      lines: {
        select: {
          id: true, description: true, rate: true, unit: true, inventoryItemId: true,
          receivedQty: true, quantity: true,
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
    const line = deal.lines[0];
    const totalReceived = line?.receivedQty || 0;
    const totalValue = totalReceived * (line?.rate || 0);

    // Get total payments: direct VendorPayments referencing this deal + invoice payments
    // Use exact PO number match with word boundary to avoid cross-contamination
    // (e.g. PO-1 matching PO-10, PO-100)
    const directPayments = await prisma.vendorPayment.findMany({
      where: {
        vendorId: deal.vendor.id,
        OR: [
          { remarks: { contains: `PO-${deal.poNo} ` } },          // "PO-123 " with trailing space
          { remarks: { endsWith: `PO-${deal.poNo}` } },           // "PO-123" at end of string
        ],
      },
      select: { amount: true },
    });
    let totalPaid = directPayments.reduce((s, p) => s + p.amount, 0);

    // Also check invoice-based payments on this deal's GRNs
    const grnIds = deal.grns.map(g => g.id);
    if (grnIds.length > 0) {
      const invoices = await prisma.vendorInvoice.findMany({
        where: { grnId: { in: grnIds } },
        select: { paidAmount: true },
      });
      totalPaid += invoices.reduce((s, inv) => s + (inv.paidAmount || 0), 0);
    }

    return {
      ...deal,
      totalReceived: Math.round(totalReceived * 100) / 100,
      totalValue: Math.round(totalValue * 100) / 100,
      totalPaid: Math.round(totalPaid * 100) / 100,
      outstanding: Math.round((totalValue - totalPaid) * 100) / 100,
      truckCount: (deal as any)._count?.grns ?? deal.grns.length,
    };
  }));

  res.json(result);
}));

// POST /deals — create a new open deal
router.post('/deals', authenticate, validate(openDealSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;

  // Resolve vendor — use existing ID or auto-create from name
  let vendorId = b.vendorId;

  // If vendorId provided, verify it exists
  if (vendorId) {
    const exists = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } });
    if (!exists) {
      return res.status(400).json({ error: `Vendor not found: ${vendorId}` });
    }
  }

  // If no vendorId but have vendorName, find or create
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
          category: 'FUEL',
          phone: b.vendorPhone || '',
          isActive: true,
        },
      });
      vendorId = newVendor.id;
    }
  }

  if (!vendorId) return res.status(400).json({ error: 'Select a vendor or enter a trader name' });

  // Get fuel item details
  const fuelItem = await prisma.inventoryItem.findUnique({
    where: { id: b.fuelItemId },
    select: { id: true, name: true, unit: true, hsnCode: true, gstPercent: true },
  });
  if (!fuelItem) return res.status(404).json({ error: 'Fuel item not found' });

  const isOpen = b.quantityType !== 'FIXED';
  const isTrucks = b.quantityUnit === 'TRUCKS';
  // For TRUCKS deals: store the truck count in remarks (PO line qty stays in MT/KG for GRN compatibility)
  // An open deal uses 999999 as "unlimited"; a fixed TRUCKS deal also uses 999999 qty
  // because the limit is on truck count, not weight (tracked via grns._count)
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

  const po = await prisma.purchaseOrder.create({
    data: {
      vendorId,
      dealType: isOpen ? 'OPEN' : 'STANDARD',
      status: 'APPROVED',
      poDate: new Date(),
      paymentTerms: b.paymentTerms || 'NET15',
      creditDays,
      deliveryAddress: b.deliveryPoint || 'Factory Gate',
      transportBy: b.transportBy || 'BY_SUPPLIER',
      remarks: remarkParts.filter(Boolean).join(' | '),
      userId: req.user!.id,
      lines: {
        create: [{
          inventoryItemId: fuelItem.id,
          description: fuelItem.name,
          hsnCode: fuelItem.hsnCode || '',
          quantity: qty,
          unit: fuelItem.unit || 'MT',
          rate: b.rate,
          amount: isOpen ? 0 : Math.round(qty * b.rate * 100) / 100,
          pendingQty: qty,
          gstPercent: fuelItem.gstPercent || 5,
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

// PUT /deals/:id — update rate, remarks, or close deal
router.put('/deals/:id', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const deal = await prisma.purchaseOrder.findUnique({
    where: { id: req.params.id },
    include: { lines: true },
  });
  if (!deal || !['OPEN', 'STANDARD'].includes(deal.dealType)) return res.status(404).json({ error: 'Deal not found' });

  const b = req.body;

  // Update rate on the PO line
  if (b.rate !== undefined && deal.lines[0]) {
    await prisma.pOLine.update({
      where: { id: deal.lines[0].id },
      data: { rate: b.rate },
    });
  }

  // Update PO fields (status, remarks, payment terms)
  const poUpdate: Record<string, unknown> = {};
  if (b.status) poUpdate.status = b.status;
  if (b.remarks !== undefined) poUpdate.remarks = b.remarks;
  if (b.paymentTerms) poUpdate.paymentTerms = b.paymentTerms;
  if (Object.keys(poUpdate).length > 0) {
    await prisma.purchaseOrder.update({ where: { id: req.params.id }, data: poUpdate });
  }

  res.json({ ok: true });
}));

// DELETE /deals/:id — delete a deal (only if no GRNs received)
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

// GET /deals/:id/trucks — all trucks/GRNs for this deal
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
  res.json(grns);
}));

// ==========================================================================
//  FUEL PAYMENTS (records VendorPayment — shows in main payment system too)
// ==========================================================================

const fuelPaymentSchema = z.object({
  dealId: z.string().min(1),
  amount: z.number().positive(),
  mode: z.string().default('CASH'), // CASH, UPI, BANK_TRANSFER, NEFT, RTGS
  reference: z.string().optional(), // UTR / UPI ref / cheque no
  remarks: z.string().optional(),
});

// POST /deals/:id/payment — record payment against a deal
router.post('/deals/:id/payment', authenticate, validate(fuelPaymentSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const dealId = req.params.id;

  // Get the deal to find vendor
  const deal = await prisma.purchaseOrder.findUnique({
    where: { id: dealId },
    select: { vendorId: true, poNo: true, dealType: true },
  });
  if (!deal || deal.dealType !== 'OPEN') return res.status(404).json({ error: 'Open deal not found' });

  // Create VendorPayment (no invoice — direct against deal)
  const payment = await prisma.vendorPayment.create({
    data: {
      vendorId: deal.vendorId,
      paymentDate: new Date(),
      amount: b.amount,
      mode: b.mode || 'CASH',
      reference: b.reference || '',
      isAdvance: false,
      remarks: `Fuel deal PO-${deal.poNo} | ${b.remarks || ''}`.trim(),
      userId: req.user!.id,
    },
  });

  res.status(201).json(payment);
}));

// GET /deals/:id/payments — list payments for a deal
router.get('/deals/:id/payments', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const deal = await prisma.purchaseOrder.findUnique({
    where: { id: req.params.id },
    select: { vendorId: true, poNo: true },
  });
  if (!deal) return res.status(404).json({ error: 'Deal not found' });

  // Get all payments for this vendor that reference this deal
  const payments = await prisma.vendorPayment.findMany({
    where: {
      vendorId: deal.vendorId,
      remarks: { contains: `PO-${deal.poNo}` },
    },
    take: 200,
    orderBy: { paymentDate: 'desc' },
    select: {
      id: true, paymentNo: true, paymentDate: true, amount: true,
      mode: true, reference: true, remarks: true,
    },
  });

  res.json(payments);
}));

export default router;
