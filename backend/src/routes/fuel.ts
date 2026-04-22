import { Router, Response } from 'express';
import { authenticate, AuthRequest, getActiveCompanyId, getCompanyFilter } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { NotFoundError } from '../shared/errors';
import { z } from 'zod';
import prisma from '../config/prisma';
import { writeAudit } from '../utils/auditLog';
import { getEffectiveGstRate, resolveHsnFromString } from '../services/taxRateLookup';

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
  hsnCodeId: z.string().nullable().optional(),
  gstPercent: z.number().nullable().optional(), // legacy fallback only; authoritative rate comes from HSN master
  gstOverridePercent: z.number().nullable().optional(),
  gstOverrideReason: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  remarks: z.string().nullable().optional(),
});

// GET /master — list all fuel items
router.get('/master', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const items = await prisma.inventoryItem.findMany({
    where: { category: 'FUEL', isActive: true, ...getCompanyFilter(req) },
    take: 100,
    orderBy: { name: 'asc' },
    select: {
      id: true, name: true, code: true, unit: true,
      currentStock: true, minStock: true, maxStock: true,
      costPerUnit: true, avgCost: true, totalValue: true,
      defaultRate: true, steamRate: true, calorificValue: true,
      hsnCode: true, hsnCodeId: true, gstPercent: true,
      gstOverridePercent: true, gstOverrideReason: true,
      hsnCodeRef: { select: { id: true, code: true, description: true } },
      location: true, remarks: true, isActive: true, createdAt: true,
    },
  });
  res.json(items);
}));

// POST /master — create fuel item
router.post('/master', authenticate, validate(fuelMasterSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;

  // Prevent duplicate fuel names (case-insensitive, ignores spaces)
  const normalized = b.name.trim().toLowerCase().replace(/\s+/g, ' ');
  const existing = await prisma.inventoryItem.findFirst({
    where: { category: 'FUEL', isActive: true, name: { equals: normalized, mode: 'insensitive' }, ...getCompanyFilter(req) },
    select: { id: true, name: true, code: true },
  });
  if (existing) {
    return res.status(409).json({
      error: `Fuel "${existing.name}" already exists (${existing.code}). Edit the existing one instead of creating a duplicate.`,
    });
  }

  // Auto-generate code if not provided: FUEL-001, FUEL-002, etc.
  let code = b.code;
  if (!code) {
    const count = await prisma.inventoryItem.count({ where: { category: 'FUEL', ...getCompanyFilter(req) } });
    code = `FUEL-${String(count + 1).padStart(3, '0')}`;
  }

  // Resolve authoritative GST — HSN master wins, override is escape-hatch, legacy scalar is fallback.
  // Auto-match free-text hsnCode → master FK when client didn't pass hsnCodeId.
  let hsnCodeStr: string | null = b.hsnCode || null;
  let resolvedHsnId: string | null = b.hsnCodeId || null;
  if (resolvedHsnId) {
    const h = await prisma.hsnCode.findUnique({ where: { id: resolvedHsnId }, select: { code: true } });
    if (h) hsnCodeStr = h.code;
  } else if (hsnCodeStr) {
    const auto = await resolveHsnFromString(hsnCodeStr);
    if (auto.hsnCodeId) {
      resolvedHsnId = auto.hsnCodeId;
      hsnCodeStr = auto.matchedCode;
    }
  }
  const overridePercent = b.gstOverridePercent != null ? Number(b.gstOverridePercent) : null;
  const overrideReason = b.gstOverrideReason || null;
  if (overridePercent != null && !overrideReason) {
    return res.status(400).json({ error: 'gstOverrideReason is required when gstOverridePercent is set' });
  }
  const resolved = await getEffectiveGstRate({
    hsnCodeId: resolvedHsnId,
    itemOverridePercent: overridePercent,
    itemOverrideReason: overrideReason,
    legacyGstPercent: b.gstPercent ?? null,
  });

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
      hsnCode: hsnCodeStr,
      hsnCodeId: resolvedHsnId,
      gstPercent: resolved.rate,
      gstOverridePercent: overridePercent,
      gstOverrideReason: overrideReason,
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

  // Tax fields: only recompute if inputs changed. HSN master wins.
  // Auto-match free-text hsnCode changes to master FK.
  let autoResolvedId: string | null | undefined;
  const hsnStringChanged = b.hsnCode !== undefined && b.hsnCode !== item.hsnCode;
  if (hsnStringChanged && b.hsnCodeId === undefined) {
    const auto = await resolveHsnFromString(b.hsnCode);
    if (auto.hsnCodeId) autoResolvedId = auto.hsnCodeId;
  }
  const hsnIdChanged =
    (b.hsnCodeId !== undefined && b.hsnCodeId !== item.hsnCodeId) ||
    (autoResolvedId !== undefined && autoResolvedId !== item.hsnCodeId);
  const overrideChanged = b.gstOverridePercent !== undefined || b.gstOverrideReason !== undefined;
  const legacyChanged = b.gstPercent !== undefined;
  let taxPatch: { hsnCode?: string | null; hsnCodeId?: string | null; gstPercent?: number; gstOverridePercent?: number | null; gstOverrideReason?: string | null; } = {};

  if (hsnIdChanged || overrideChanged || legacyChanged) {
    const nextHsnId = b.hsnCodeId !== undefined ? b.hsnCodeId : (autoResolvedId ?? item.hsnCodeId);
    const nextOverride = b.gstOverridePercent !== undefined
      ? (b.gstOverridePercent == null ? null : Number(b.gstOverridePercent))
      : item.gstOverridePercent;
    const nextReason = b.gstOverrideReason !== undefined
      ? (b.gstOverrideReason || null)
      : item.gstOverrideReason;
    if (nextOverride != null && !nextReason) {
      return res.status(400).json({ error: 'gstOverrideReason is required when gstOverridePercent is set' });
    }
    const legacy = b.gstPercent != null ? Number(b.gstPercent) : item.gstPercent;
    const resolved = await getEffectiveGstRate({
      hsnCodeId: nextHsnId,
      itemOverridePercent: nextOverride,
      itemOverrideReason: nextReason,
      legacyGstPercent: legacy,
    });
    taxPatch.hsnCodeId = nextHsnId;
    taxPatch.gstOverridePercent = nextOverride;
    taxPatch.gstOverrideReason = nextReason;
    taxPatch.gstPercent = resolved.rate;
    // Keep legacy hsnCode string in sync when FK changes
    if (hsnIdChanged) {
      if (nextHsnId) {
        const h = await prisma.hsnCode.findUnique({ where: { id: nextHsnId }, select: { code: true } });
        taxPatch.hsnCode = h?.code ?? null;
      } else if (b.hsnCode !== undefined) {
        taxPatch.hsnCode = b.hsnCode;
      }
    } else if (b.hsnCode !== undefined) {
      taxPatch.hsnCode = b.hsnCode;
    }
  } else if (b.hsnCode !== undefined) {
    taxPatch.hsnCode = b.hsnCode;
  }

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
      location: b.location !== undefined ? b.location : item.location,
      remarks: b.remarks !== undefined ? b.remarks : item.remarks,
      ...taxPatch,
    },
  });
  res.json(updated);
}));

// GET /warehouses — for location dropdown
router.get('/warehouses', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const warehouses = await prisma.warehouse.findMany({
    where: { isActive: true, ...getCompanyFilter(req) },
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
  const cf = getCompanyFilter(req);
  const fuelItems = await prisma.inventoryItem.findMany({
    where: { category: 'FUEL', isActive: true, ...cf },
    select: {
      id: true, name: true, code: true, unit: true,
      currentStock: true, steamRate: true, calorificValue: true,
    },
    orderBy: { name: 'asc' },
  });

  // Get existing consumption entries for this date (scoped via fuelItem IDs)
  const fuelItemIds = fuelItems.map(f => f.id);
  const entries = await prisma.fuelConsumption.findMany({
    where: { date, fuelItemId: { in: fuelItemIds } },
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
    where: { date: prevDate, fuelItemId: { in: fuelItemIds } },
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

    // NF-5 FIX: Create StockMovement for fuel consumption instead of blind currentStock overwrite.
    // This keeps the inventory ledger reconcilable.
    if (consumed > 0) {
      try {
        const defaultWh = await prisma.warehouse.findFirst({
          where: { isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true },
        });
        if (defaultWh) {
          // Check for existing movement for this date+item (re-save scenario)
          const existingMv = await prisma.stockMovement.findFirst({
            where: { refType: 'FUEL_CONSUMPTION', refId: entry.id, itemId: row.fuelItemId },
          });

          if (existingMv) {
            // Re-save: adjust by delta between old and new consumed quantity
            const delta = consumed - existingMv.quantity;
            if (Math.abs(delta) > 0.001) {
              await prisma.stockMovement.update({
                where: { id: existingMv.id },
                data: { quantity: consumed, totalValue: consumed * (existingMv.costRate || 0) },
              });
              await prisma.inventoryItem.update({
                where: { id: row.fuelItemId },
                data: { currentStock: { decrement: delta } },
              });
            }
          } else {
            // First save: create movement and decrement stock
            const fuelItem = await prisma.inventoryItem.findUnique({
              where: { id: row.fuelItemId },
              select: { avgCost: true, unit: true },
            });
            await prisma.stockMovement.create({
              data: {
                itemId: row.fuelItemId,
                movementType: 'FUEL_CONSUMPTION',
                direction: 'OUT',
                quantity: consumed,
                unit: fuelItem?.unit || 'MT',
                costRate: fuelItem?.avgCost || 0,
                totalValue: consumed * (fuelItem?.avgCost || 0),
                warehouseId: defaultWh.id,
                refType: 'FUEL_CONSUMPTION',
                refId: entry.id,
                refNo: `FUEL-${dateStr}`,
                narration: `Daily fuel consumption`,
                userId: req.user!.id,
                companyId: getActiveCompanyId(req),
              },
            });
            await prisma.inventoryItem.update({
              where: { id: row.fuelItemId },
              data: { currentStock: { decrement: consumed } },
            });
          }
        }
      } catch (_e) {
        // Don't fail the daily entry if inventory sync fails
      }
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
  const cf = getCompanyFilter(req);
  const fuelItems = await prisma.inventoryItem.findMany({
    where: { category: 'FUEL', isActive: true, ...cf },
    select: { id: true, name: true, currentStock: true, minStock: true, unit: true },
  });

  const lowStock = fuelItems.filter(f => f.currentStock < f.minStock);

  // Today's consumption (scoped via fuel item IDs)
  const fuelItemIds = fuelItems.map(f => f.id);
  const todayEntries = await prisma.fuelConsumption.findMany({
    where: { date, fuelItemId: { in: fuelItemIds } },
    select: { consumed: true, steamGenerated: true, received: true },
  });

  const totalConsumed = todayEntries.reduce((s, e) => s + e.consumed, 0);
  const totalSteam = todayEntries.reduce((s, e) => s + e.steamGenerated, 0);
  const totalReceived = todayEntries.reduce((s, e) => s + e.received, 0);

  // Steam requirement = 4 × yesterday's ethanol production (KL)
  // Rule: 1 KL ethanol → 4 MT steam (plant benchmark)
  // Only show for MSPIL — ethanol production is plant data, not company-scoped
  const STEAM_PER_KL_ETHANOL = 4;
  const MSPIL_ID = 'b499264a-8c73-4595-ab9b-7dc58f58c4d2';
  const activeCompany = getActiveCompanyId(req);
  const isMspilContext = !activeCompany || activeCompany === MSPIL_ID;
  let yesterdayEthanolKL = 0;
  if (isMspilContext) {
    const yesterday = new Date(date);
    yesterday.setDate(yesterday.getDate() - 1);
    const yStart = new Date(yesterday); yStart.setHours(0, 0, 0, 0);
    const yEnd = new Date(yesterday); yEnd.setHours(23, 59, 59, 999);
    const yEthanol = await prisma.ethanolProductEntry.findFirst({
      where: { date: { gte: yStart, lte: yEnd } },
      select: { productionBL: true },
      orderBy: { date: 'desc' },
    });
    yesterdayEthanolKL = Math.round(((yEthanol?.productionBL || 0) / 1000) * 100) / 100;
  }
  const steamRequired = Math.round(yesterdayEthanolKL * STEAM_PER_KL_ETHANOL * 100) / 100;
  const steamBalance = Math.round((totalSteam - steamRequired) * 100) / 100;

  // Days of fuel left — based on last 7d avg consumption per fuel
  const sevenDaysAgo = new Date(date); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const recent = await prisma.fuelConsumption.findMany({
    where: { date: { gte: sevenDaysAgo, lte: date }, fuelItemId: { in: fuelItemIds } },
    select: { fuelItemId: true, consumed: true },
  });
  const avgByFuel = new Map<string, number>();
  for (const f of fuelItems) {
    const rows = recent.filter(r => r.fuelItemId === f.id);
    const sum = rows.reduce((s, r) => s + r.consumed, 0);
    const days = Math.max(rows.length, 1);
    avgByFuel.set(f.id, sum / days);
  }
  const fuelDaysLeft = fuelItems.map(f => {
    const avg = avgByFuel.get(f.id) || 0;
    const days = avg > 0 ? Math.floor(f.currentStock / avg) : null;
    return { id: f.id, name: f.name, currentStock: f.currentStock, avgDaily: Math.round(avg * 100) / 100, daysLeft: days };
  });

  res.json({
    fuelTypes: fuelItems.length,
    lowStockCount: lowStock.length,
    lowStockItems: lowStock.map(f => f.name),
    todayConsumed: Math.round(totalConsumed * 100) / 100,
    todayReceived: Math.round(totalReceived * 100) / 100,
    todaySteam: Math.round(totalSteam * 100) / 100,
    yesterdayEthanolKL,
    steamRequired,
    steamBalance,
    fuelDaysLeft,
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
  validUntil: z.string().optional(),     // ISO date — PO won't show at factory after this date
  remarks: z.string().optional(),
});

// GET /deals — list fuel deals (both open and fixed)
router.get('/deals', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const deals = await prisma.purchaseOrder.findMany({
    where: {
      ...getCompanyFilter(req),
      dealType: { in: ['OPEN', 'STANDARD'] },
      status: { in: ['APPROVED', 'SENT', 'PARTIAL_RECEIVED', 'RECEIVED', 'CLOSED'] },
      // Only fuel deals — check if any line has a fuel inventory item
      lines: { some: { inventoryItem: { category: 'FUEL' } } },
    },
    take: 100,
    orderBy: { poDate: 'desc' },
    select: {
      id: true, poNo: true, dealType: true, status: true, poDate: true, deliveryDate: true, remarks: true, paymentTerms: true, truckCap: true, transportBy: true, deliveryAddress: true,
      vendor: { select: { id: true, name: true, phone: true } },
      lines: {
        select: {
          id: true, description: true, rate: true, unit: true, inventoryItemId: true,
          receivedQty: true, quantity: true,
          inventoryItem: { select: { category: true } },
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
    // Sum across ALL fuel-category lines (filter out non-fuel lines in mixed POs)
    const fuelLines = deal.lines.filter(l => l.inventoryItem?.category === 'FUEL');
    const linesToSum = fuelLines.length > 0 ? fuelLines : deal.lines; // fallback for legacy
    const totalReceived = linesToSum.reduce((s, l) => s + (l.receivedQty || 0), 0);
    const receivedValue = linesToSum.reduce((s, l) => s + (l.receivedQty || 0) * (l.rate || 0), 0);
    // For OPEN deals the committed value is indefinite, so show received value.
    // For FIXED deals, show the planned PO committed value (qty × rate) even before receipts.
    const isOpenDeal = deal.dealType === 'OPEN';
    const plannedValue = isOpenDeal ? 0 : linesToSum.reduce((s, l) => {
      const q = l.quantity >= 900000 ? (l.receivedQty || 0) : l.quantity;
      return s + q * (l.rate || 0);
    }, 0);
    const totalValue = isOpenDeal ? receivedValue : Math.max(plannedValue, receivedValue);

    // Get total payments: direct VendorPayments referencing this deal + invoice payments
    // Step 8 fix: Count direct payments (fuel page Pay button) and invoice payments separately
    // to avoid double-counting. Direct payments have no invoiceId; invoice payments have one.
    const directPayments = await prisma.vendorPayment.findMany({
      where: {
        vendorId: deal.vendor.id,
        invoiceId: null, // Only direct payments, not invoice-linked
        OR: [
          { remarks: { contains: `PO-${deal.poNo} ` } },
          { remarks: { endsWith: `PO-${deal.poNo}` } },
        ],
      },
      select: { amount: true },
    });
    let totalPaid = directPayments.reduce((s, p) => s + p.amount, 0);

    // Add invoice-based payments (from vendorPayments route which links to invoiceId)
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

  // Vendor must exist in Vendor Master — no auto-create.
  // Previous auto-create path (2026-04-22 removed) defaulted new vendors to
  // category=FUEL + isAgent=true, which hid their POs from the factory gate
  // dropdown filter. All fuel vendors must now be created via the Vendor
  // Master so they get the right category + tax flags before any PO is cut.
  const vendorId: string | undefined = b.vendorId;
  if (!vendorId) {
    return res.status(400).json({
      error: 'Please select a vendor from Vendor Master. New vendors must be created in Procurement → Vendors first.',
    });
  }
  const exists = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } });
  if (!exists) {
    return res.status(400).json({ error: `Vendor not found: ${vendorId}` });
  }

  // Get fuel item details
  const fuelItem = await prisma.inventoryItem.findUnique({
    where: { id: b.fuelItemId },
    select: { id: true, name: true, unit: true, hsnCode: true, gstPercent: true, category: true },
  });
  if (!fuelItem) return res.status(404).json({ error: 'Fuel item not found' });
  // Step 1 fix: guard that item is actually a fuel item
  if (fuelItem.category !== 'FUEL') return res.status(400).json({ error: `Item "${fuelItem.name}" is not a fuel item (category=${fuelItem.category})` });

  const isOpen = b.quantityType !== 'FIXED';
  const isTrucks = b.quantityUnit === 'TRUCKS';
  // Step 1 fix: fixed non-truck deals must have a positive quantity
  if (!isOpen && !isTrucks && (!b.quantity || b.quantity <= 0)) {
    return res.status(400).json({ error: 'Fixed MT deals require a positive quantity' });
  }
  // For TRUCKS deals: store the truck count in remarks (PO line qty stays in MT/KG for GRN compatibility)
  // An open deal uses 999999 as "unlimited"; a fixed TRUCKS deal also uses 999999 qty
  // because the limit is on truck count, not weight (tracked via grns._count)
  // For truck-based deals: qty=0 (actual qty determined by received weight), tracked by truckCap
  const qty = isOpen ? 999999 : (isTrucks ? 0 : (b.quantity || 0));
  const creditDaysMap: Record<string, number> = { ADVANCE: 0, COD: 0, NET2: 2, NET7: 7, NET10: 10, NET15: 15, NET30: 30 };
  const creditDays = creditDaysMap[b.paymentTerms || 'NET15'] ?? 15;

  // Build remarks with delivery details
  const remarkParts = [b.remarks || ''];
  if (b.origin) remarkParts.push(`Origin: ${b.origin}`);
  if (b.deliveryPoint) remarkParts.push(`Delivery: ${b.deliveryPoint}`);
  if (b.transportBy) remarkParts.push(`Transport: ${b.transportBy}`);
  if (b.deliverySchedule) remarkParts.push(`Schedule: ${b.deliverySchedule}`);
  if (isTrucks && b.quantity) remarkParts.push(`FIXED_TRUCKS:${b.quantity}`);

  // Calculate PO totals for PDF (even for open deals, use qty * rate for display)
  const lineAmount = Math.round(qty * b.rate * 100) / 100;
  const gstPercent = fuelItem.gstPercent ?? 0; // Use item's actual GST (0 is valid for fuel)
  const gstAmount = Math.round(lineAmount * gstPercent / 100 * 100) / 100;
  const isIntraState = true; // MP to MP (same state)
  const cgst = isIntraState ? Math.round(gstAmount / 2 * 100) / 100 : 0;
  const sgst = isIntraState ? Math.round(gstAmount / 2 * 100) / 100 : 0;
  const igst = isIntraState ? 0 : gstAmount;
  // For open deals (qty=999999), set totals to 0 — they'll be computed from actual receipts
  const isRealQty = qty < 900000;
  const subtotal = isRealQty ? lineAmount : 0;
  const totalGst = isRealQty ? gstAmount : 0;
  const grandTotal = isRealQty ? Math.round((lineAmount + gstAmount) * 100) / 100 : 0;

  const po = await prisma.purchaseOrder.create({
    data: {
      vendorId,
      dealType: isOpen ? 'OPEN' : 'STANDARD',
      status: 'APPROVED',
      poDate: new Date(),
      // Store as end-of-day IST (23:59 IST = 18:29 UTC) so PO stays active the whole expiry day
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
          inventoryItemId: fuelItem.id,
          description: fuelItem.name,
          hsnCode: fuelItem.hsnCode || '',
          quantity: qty,
          unit: fuelItem.unit || 'MT',
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

// PUT /deals/:id — update rate, remarks, or close deal
router.put('/deals/:id', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const deal = await prisma.purchaseOrder.findUnique({
    where: { id: req.params.id },
    include: { lines: true },
  });
  if (!deal || !['OPEN', 'STANDARD'].includes(deal.dealType)) return res.status(404).json({ error: 'Deal not found' });

  const b = req.body;

  // Update rate / quantity / quantityType (OPEN ↔ FIXED) on the PO line
  if (deal.lines[0]) {
    const line = deal.lines[0];
    const lineUpdate: Record<string, unknown> = {};
    if (b.rate !== undefined) lineUpdate.rate = b.rate;

    if (b.quantityType !== undefined) {
      if (b.quantityType === 'OPEN') {
        lineUpdate.quantity = 999999;
        lineUpdate.pendingQty = 999999;
      } else if (b.quantityType === 'FIXED') {
        const grns = await prisma.goodsReceipt.count({ where: { poId: deal.id, status: { not: 'DRAFT' } } });
        if (grns > 0) {
          return res.status(400).json({ error: 'Cannot switch to FIXED — trucks already received. Close this deal and create a new FIXED PO.' });
        }
        const qty = Number(b.quantity);
        if (!qty || qty <= 0) return res.status(400).json({ error: 'Enter a valid fixed quantity' });
        const isTrucks = b.quantityUnit === 'TRUCKS';
        // Truck-based: line qty=0 (tracked by truckCap), weight-based: line qty=actual
        lineUpdate.quantity = isTrucks ? 0 : qty;
        lineUpdate.pendingQty = isTrucks ? 0 : qty;
      }
    } else if (b.quantity !== undefined && b.quantityUnit !== 'TRUCKS') {
      const qty = Number(b.quantity);
      if (qty > 0) { lineUpdate.quantity = qty; lineUpdate.pendingQty = qty; }
    }

    if (Object.keys(lineUpdate).length > 0) {
      const rate = (lineUpdate.rate as number | undefined) ?? line.rate;
      const quantity = (lineUpdate.quantity as number | undefined) ?? line.quantity;
      const amount = quantity >= 900000 ? 0 : quantity * rate;
      const gstAmt = amount * (line.gstPercent || 0) / 100;
      lineUpdate.amount = amount;
      lineUpdate.taxableAmount = amount;
      lineUpdate.totalGst = gstAmt;
      lineUpdate.lineTotal = amount + gstAmt;
      await prisma.pOLine.update({ where: { id: line.id }, data: lineUpdate });
    }
  }

  // Update fuel item on PO line (if changed and no GRNs yet)
  if (b.fuelItemId && b.fuelItemId !== deal.lines[0]?.inventoryItemId) {
    const grns = await prisma.goodsReceipt.count({ where: { poId: deal.id, status: { not: 'DRAFT' } } });
    if (grns > 0) {
      return res.status(400).json({ error: 'Cannot change fuel type — trucks already received' });
    }
    const fuelItem = await prisma.inventoryItem.findUnique({
      where: { id: b.fuelItemId },
      select: { id: true, name: true, unit: true, hsnCode: true, gstPercent: true, category: true },
    });
    if (!fuelItem || fuelItem.category !== 'FUEL') return res.status(400).json({ error: 'Invalid fuel item' });
    if (deal.lines[0]) {
      await prisma.pOLine.update({
        where: { id: deal.lines[0].id },
        data: { inventoryItemId: fuelItem.id, description: fuelItem.name, unit: fuelItem.unit || 'MT', hsnCode: fuelItem.hsnCode || '', gstPercent: fuelItem.gstPercent ?? 0 },
      });
    }
  }

  // Update vendor (if changed and no GRNs yet)
  if (b.vendorId && b.vendorId !== deal.vendorId) {
    const grns = await prisma.goodsReceipt.count({ where: { poId: deal.id, status: { not: 'DRAFT' } } });
    if (grns > 0) {
      return res.status(400).json({ error: 'Cannot change vendor — trucks already received' });
    }
    const vendor = await prisma.vendor.findUnique({ where: { id: b.vendorId }, select: { id: true } });
    if (!vendor) return res.status(400).json({ error: 'Vendor not found' });
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
  if (b.quantityType === 'OPEN') { poUpdate.dealType = 'OPEN'; poUpdate.subtotal = 0; poUpdate.totalGst = 0; poUpdate.grandTotal = 0; }
  else if (b.quantityType === 'FIXED') {
    poUpdate.dealType = 'STANDARD';
    const isTrucks = b.quantityUnit === 'TRUCKS';
    if (isTrucks) {
      // Truck-based: totals calculated from received weight, not ordered trucks
      poUpdate.subtotal = 0; poUpdate.totalGst = 0; poUpdate.grandTotal = 0;
      poUpdate.truckCap = Number(b.quantity) || null;
    } else {
      const qty = Number(b.quantity) || 0;
      const rate = Number(b.rate) || deal.lines[0]?.rate || 0;
      const base = qty * rate;
      const gst = base * ((deal.lines[0]?.gstPercent || 0) / 100);
      poUpdate.subtotal = base; poUpdate.totalGst = gst; poUpdate.grandTotal = base + gst;
    }
  } else if (b.rate !== undefined && deal.dealType === 'STANDARD') {
    // Rate changed on a FIXED deal without quantityType switch — recalculate PO header
    const qty = deal.lines[0]?.quantity || 0;
    const rate = Number(b.rate);
    if (qty < 900000) {
      const base = qty * rate;
      const gst = base * ((deal.lines[0]?.gstPercent || 0) / 100);
      poUpdate.subtotal = base; poUpdate.totalGst = gst; poUpdate.grandTotal = base + gst;
    }
  }
  if (b.vendorId && b.vendorId !== deal.vendorId) poUpdate.vendorId = b.vendorId;
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
  if (b.truckCap !== undefined) poUpdate.truckCap = b.truckCap || null;

  if (Object.keys(poUpdate).length > 0) {
    await prisma.purchaseOrder.update({ where: { id: req.params.id }, data: poUpdate });
    // Audit: log each changed field
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [k, v] of Object.entries(poUpdate)) {
      changes[k] = { from: (deal as any)[k], to: v };
    }
    writeAudit('PurchaseOrder', deal.id, 'FUEL_DEAL_EDIT', changes, req.user!.id);
  }

  res.json({ ok: true });
}));

// DELETE /deals/:id — delete a deal (only if no GRNs received)
router.delete('/deals/:id', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const deal = await prisma.purchaseOrder.findUnique({
    where: { id: req.params.id },
    include: { grns: { select: { id: true, status: true } }, lines: { select: { id: true } } },
  });
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  const realGrns = deal.grns.filter(g => g.status !== 'DRAFT');
  if (realGrns.length > 0) return res.status(400).json({ error: 'Cannot delete — trucks already received against this deal' });
  // Clean up any leftover DRAFT (expected) GRNs so the cascade delete works
  if (deal.grns.length > 0) await prisma.goodsReceipt.deleteMany({ where: { poId: deal.id, status: 'DRAFT' } });

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
  mode: z.string().default('CASH'),
  reference: z.string().optional(),
  remarks: z.string().optional(),
  paymentDate: z.string().optional(),
  tdsDeducted: z.number().optional().default(0),
  tdsSection: z.string().optional(),
});

// POST /deals/:id/payment — record payment against a fuel deal
// Uses the shared AP journal flow (same as vendorPayments POST /)
router.post('/deals/:id/payment', authenticate, validate(fuelPaymentSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const dealId = req.params.id;

  const deal = await prisma.purchaseOrder.findUnique({
    where: { id: dealId },
    include: { grns: { select: { id: true, status: true } }, lines: { select: { receivedQty: true } } },
  });
  if (!deal) return res.status(404).json({ error: 'Deal not found' });

  // Step 10 fix: require at least one confirmed GRN before allowing payment
  const confirmedGrns = deal.grns.filter((g: any) => g.status === 'CONFIRMED');
  const totalReceived = deal.lines.reduce((s: number, l: any) => s + (l.receivedQty || 0), 0);
  if (confirmedGrns.length === 0 || totalReceived <= 0) {
    return res.status(400).json({ error: 'Cannot make payment before any confirmed receipt. Confirm the GRN first.' });
  }

  const amount = b.amount;
  const tdsDeducted = parseFloat(b.tdsDeducted) || 0;
  const paymentDate = b.paymentDate ? new Date(b.paymentDate) : new Date();

  // Create VendorPayment with PO reference in remarks (for fuel deal tracking)
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
      remarks: `Fuel deal PO-${deal.poNo}${b.remarks ? ' | ' + b.remarks : ''}`,
      userId: req.user!.id,
    },
  });

  // Auto-journal (same as vendorPayments POST /)
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

  // Get all payments for this vendor that reference this deal (bank + invoice-based)
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

  // Also include cash vouchers linked to this deal
  let cashPayments: Array<Record<string, unknown>> = [];
  try {
    cashPayments = await prisma.$queryRawUnsafe(
      `SELECT id, "voucherNo" as "paymentNo", date as "paymentDate", amount, 'CASH' as mode, "paymentRef" as reference, remarks, status FROM "CashVoucher" WHERE type = 'PAYMENT' AND status <> 'CANCELLED' AND "payeeName" = $1 AND (purpose LIKE $2 OR remarks LIKE $2) ORDER BY date DESC LIMIT 100`,
      deal.vendor.name, `%PO-${deal.poNo}%`
    ) as Array<Record<string, unknown>>;
  } catch { /* CashVoucher table may not exist */ }

  // Merge and return
  const allPayments = [
    ...directPayments.map(p => ({ ...p, type: 'BANK' as const })),
    ...cashPayments.map(p => ({ ...p, type: 'CASH_VOUCHER' as const })),
  ].sort((a, b) => new Date(String((b as Record<string, unknown>).paymentDate || 0)).getTime() - new Date(String((a as Record<string, unknown>).paymentDate || 0)).getTime());

  res.json(allPayments);
}));

export default router;
