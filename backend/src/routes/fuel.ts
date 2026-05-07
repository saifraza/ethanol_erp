import { Router, Response } from 'express';
import { authenticate, AuthRequest, getActiveCompanyId, getCompanyFilter } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { NotFoundError } from '../shared/errors';
import { z } from 'zod';
import prisma from '../config/prisma';
import { writeAudit } from '../utils/auditLog';
import { getEffectiveGstRate, resolveHsnFromString } from '../services/taxRateLookup';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const router = Router();

// Multer setup for fuel-invoice uploads. Files share the same on-disk
// directory as VendorInvoice uploads (uploads/vendor-invoices/) so the
// existing /uploads static serve and any future Smart-Upload cleanup
// applies uniformly. Same 10MB limit as vendorInvoices.ts.
const fuelInvoiceUploadDir = path.join(__dirname, '../../uploads/vendor-invoices');
if (!fs.existsSync(fuelInvoiceUploadDir)) fs.mkdirSync(fuelInvoiceUploadDir, { recursive: true });

const fuelInvoiceUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, fuelInvoiceUploadDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

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
  
    take: 500,
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
  
    take: 500,
  });

  const entryMap = new Map(entries.map(e => [e.fuelItemId, e]));

  // Get previous day's closing stock for opening stock defaults
  const prevDate = new Date(date);
  prevDate.setDate(prevDate.getDate() - 1);
  const prevEntries = await prisma.fuelConsumption.findMany({
    where: { date: prevDate, fuelItemId: { in: fuelItemIds } },
    select: { fuelItemId: true, closingStock: true },
  
    take: 500,
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
  
    take: 500,
  });

  const lowStock = fuelItems.filter(f => f.currentStock < f.minStock);

  // Today's consumption (scoped via fuel item IDs)
  const fuelItemIds = fuelItems.map(f => f.id);
  const todayEntries = await prisma.fuelConsumption.findMany({
    where: { date, fuelItemId: { in: fuelItemIds } },
    select: { consumed: true, steamGenerated: true, received: true },
  
    take: 500,
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
  
    take: 500,
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

    // Direct VendorPayments tagged to this PO via the new purchaseOrderId FK.
    // Invoice-linked payments (paid against a vendor bill) come in separately
    // below, so we filter them out here to avoid double-counting.
    const directPayments = await prisma.vendorPayment.findMany({
      where: {
        purchaseOrderId: deal.id,
        invoiceId: null,
      },
      select: { amount: true },
      take: 500,
    });
    let totalPaid = directPayments.reduce((s, p) => s + p.amount, 0);

    // Add invoice-based payments (from vendorPayments route which links to invoiceId)
    const grnIds = deal.grns.map(g => g.id);
    if (grnIds.length > 0) {
      const invoices = await prisma.vendorInvoice.findMany({
        where: { grnId: { in: grnIds } },
        select: { paidAmount: true },
      
    take: 500,
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

  // Create VendorPayment linked to the PO via FK (canonical join).
  // Remarks still carry `PO-{n}` for human readability + legacy queries on
  // VendorPayment that haven't been switched yet.
  const payment = await prisma.vendorPayment.create({
    data: {
      vendorId: deal.vendorId,
      purchaseOrderId: deal.id,
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

  // Direct payments: pulled by FK. Backfill at boot already migrated legacy rows.
  const dealRow = await prisma.purchaseOrder.findUnique({
    where: { id: req.params.id },
    select: { id: true },
  });
  const directPayments = dealRow ? await prisma.vendorPayment.findMany({
    where: { purchaseOrderId: dealRow.id },
    take: 200,
    orderBy: { paymentDate: 'desc' },
    select: {
      id: true, paymentNo: true, paymentDate: true, amount: true,
      mode: true, reference: true, remarks: true,
    },
  }) : [];

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

// ==========================================================================
//  FUEL PAYMENTS — every PO with a FUEL-category line, with running balance.
//  Powers the Payments tab in the Fuel module. Mirrors the Payments Out
//  ledger but scoped to fuel POs (any dealType, any status).
// ==========================================================================

router.get('/payments', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  // Category filter — defaults to FUEL for back-compat (existing fuel UI).
  // Store / non-fuel callers pass a comma-separated list of inventory item
  // categories: `?category=RAW_MATERIAL,CHEMICAL,PACKING,SPARE,CONSUMABLE,GENERAL`
  // (URL prefix stays /fuel/payments for now — Phase 6 cleanup will rename).
  const rawCategory = (typeof req.query.category === 'string' ? req.query.category : '').trim();
  const categories = rawCategory
    ? rawCategory.split(',').map(c => c.trim().toUpperCase()).filter(Boolean)
    : ['FUEL'];

  const fuelPos = await prisma.purchaseOrder.findMany({
    where: {
      ...getCompanyFilter(req),
      lines: { some: { inventoryItem: { category: { in: categories } } } },
      status: { not: 'DRAFT' },
    },
    take: 500,
    orderBy: { poDate: 'desc' },
    select: {
      id: true, poNo: true, poDate: true, status: true, dealType: true,
      grandTotal: true, paymentTerms: true, creditDays: true,
      vendor: { select: { id: true, name: true, phone: true, bankName: true, bankAccount: true, bankIfsc: true } },
      lines: {
        select: {
          quantity: true, receivedQty: true, rate: true, gstPercent: true, description: true,
          inventoryItem: { select: { id: true, name: true, unit: true, category: true } },
        },
      },
      _count: { select: { grns: true, vendorInvoices: true } },
    },
  });

  // Aggregate invoiced totals per PO in a single query (cheaper than N round-trips).
  const fuelPoIds = fuelPos.map(p => p.id);
  const invoiceTotalsRaw = fuelPoIds.length > 0 ? await prisma.vendorInvoice.groupBy({
    by: ['poId'],
    where: { poId: { in: fuelPoIds } },
    _sum: { totalAmount: true },
  }) : [];
  const invoicedByPo = new Map<string, number>();
  for (const row of invoiceTotalsRaw) {
    if (row.poId) invoicedByPo.set(row.poId, row._sum.totalAmount || 0);
  }

  const result = await Promise.all(fuelPos.map(async (po) => {
    // Pick the first line whose inventory item matches the requested category
    // for the row label + unit. Legacy fallback: any line if none match.
    const matchingLines = po.lines.filter(l => l.inventoryItem && categories.includes(l.inventoryItem.category));
    const linesToSum = matchingLines.length > 0 ? matchingLines : po.lines;
    const fuelLabel = matchingLines[0]?.inventoryItem?.name || matchingLines[0]?.description || po.lines[0]?.description || 'Item';
    const fuelUnit = matchingLines[0]?.inventoryItem?.unit || po.lines[0]?.inventoryItem?.unit || 'MT';

    const totalReceived = linesToSum.reduce((s, l) => s + (l.receivedQty || 0), 0);
    const receivedValue = Math.round(linesToSum.reduce((s, l) => {
      const base = (l.receivedQty || 0) * (l.rate || 0);
      return s + base + base * ((l.gstPercent || 0) / 100);
    }, 0) * 100) / 100;
    const isOpen = po.dealType === 'OPEN';
    const plannedValue = Math.round(linesToSum.reduce((s, l) => {
      const q = l.quantity >= 900000 ? (l.receivedQty || 0) : l.quantity;
      const base = q * (l.rate || 0);
      return s + base + base * ((l.gstPercent || 0) / 100);
    }, 0) * 100) / 100;
    const poTotal = po.grandTotal > 0 ? po.grandTotal : (isOpen ? receivedValue : Math.max(plannedValue, receivedValue));

    const confirmedPayments = await prisma.vendorPayment.findMany({
      where: { purchaseOrderId: po.id, paymentStatus: 'CONFIRMED' },
      select: { amount: true, paymentDate: true },
      take: 500,
    });
    const totalPaid = confirmedPayments.reduce((s, p) => s + p.amount, 0);
    const lastPaymentDate = confirmedPayments.reduce<Date | null>((latest, p) => {
      if (!latest || p.paymentDate > latest) return p.paymentDate;
      return latest;
    }, null);

    const pendingBankAgg = await prisma.vendorPayment.aggregate({
      where: { purchaseOrderId: po.id, paymentStatus: 'INITIATED' },
      _sum: { amount: true },
    });
    const pendingBank = pendingBankAgg._sum.amount || 0;

    const pendingCashAgg = await prisma.cashVoucher.aggregate({
      where: { status: 'ACTIVE', purpose: { contains: `PO-${po.poNo}` } },
      _sum: { amount: true },
    });
    const pendingCash = pendingCashAgg._sum.amount || 0;

    const invoicedTotal = Math.round((invoicedByPo.get(po.id) || 0) * 100) / 100;

    // Outstanding fallback chain — figure out the right "what we owe" basis.
    // 1. If GRNs exist, use receivedValue (only pay for what arrived).
    // 2. Else if invoices have totals, use the invoiced total (vendor-billed POs without weighbridge).
    // 3. Else fall back to the planned PO total so a brand-new PO doesn't render as "✓ Paid".
    // Without this chain a manual PO with 0 GRNs and 0 invoiced total
    // shows outstanding=0 → looks settled even when nothing was paid.
    let payableBasis: number;
    let basisSource: 'RECEIVED' | 'INVOICED' | 'PLANNED';
    if (receivedValue > 0) {
      payableBasis = receivedValue;
      basisSource = 'RECEIVED';
    } else if (invoicedTotal > 0) {
      payableBasis = invoicedTotal;
      basisSource = 'INVOICED';
    } else {
      payableBasis = poTotal;
      basisSource = 'PLANNED';
    }
    const outstanding = Math.max(0, Math.round((payableBasis - totalPaid - pendingBank - pendingCash) * 100) / 100);

    return {
      id: po.id,
      poNo: po.poNo,
      poDate: po.poDate,
      status: po.status,
      dealType: po.dealType,
      paymentTerms: po.paymentTerms,
      creditDays: po.creditDays,
      vendor: po.vendor,
      fuelName: fuelLabel,
      fuelUnit,
      totalReceived: Math.round(totalReceived * 100) / 100,
      poTotal: Math.round(poTotal * 100) / 100,
      receivedValue,
      totalPaid: Math.round(totalPaid * 100) / 100,
      pendingBank: Math.round(pendingBank * 100) / 100,
      pendingCash: Math.round(pendingCash * 100) / 100,
      outstanding,
      payableBasis: Math.round(payableBasis * 100) / 100,
      basisSource,
      lastPaymentDate,
      grnCount: po._count.grns,
      invoiceCount: po._count.vendorInvoices,
      invoicedTotal,
      isFullyPaid: payableBasis > 0 && (totalPaid + pendingBank + pendingCash) >= payableBasis - 0.01,
    };
  }));

  res.json(result);
}));

// ==========================================================================
//  FUEL INVOICE UPLOAD — attach a vendor bill PDF/image to a fuel PO.
//  Lightweight: no AI extraction, no 3-way match. Just stores the file and
//  creates a minimal VendorInvoice row (status=PENDING) so the file is
//  visible to accounts and downloadable from the PO. Accounts can later
//  promote it to a fully-booked invoice via /vendor-invoices flows.
// ==========================================================================

// Accepts up to 20 files in a single request under either field name —
// `files` (preferred for multi-pick) or `file` (legacy single-pick).
// Frontend currently always sends under `files`, but accepting both keeps
// the endpoint backward-compatible with any half-deployed clients.
router.post(
  '/payments/:poId/invoice',
  authenticate,
  fuelInvoiceUpload.fields([
    { name: 'files', maxCount: 20 },
    { name: 'file', maxCount: 1 },
  ]),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const filesByField = (req.files || {}) as Record<string, Express.Multer.File[]>;
    const uploaded: Express.Multer.File[] = [
      ...(filesByField.files || []),
      ...(filesByField.file || []),
    ];
    if (uploaded.length === 0) { res.status(400).json({ error: 'No files uploaded' }); return; }

    const cleanupAll = () => {
      for (const f of uploaded) {
        try { fs.unlinkSync(f.path); } catch { /* best effort */ }
      }
    };

    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.poId },
      select: { id: true, poNo: true, vendorId: true, companyId: true, division: true, lines: { select: { inventoryItem: { select: { category: true } } } } },
    });
    if (!po) {
      cleanupAll();
      res.status(404).json({ error: 'PO not found' });
      return;
    }
    // Validate the PO carries an inventory line in one of the expected
    // categories. Caller passes ?category= (or body.category) — same
    // comma-separated convention as the row listing. Default 'FUEL' for
    // back-compat with existing fuel UI.
    const rawCategory = (typeof req.query.category === 'string' && req.query.category) || (typeof req.body?.category === 'string' && req.body.category) || '';
    const allowedCategories = rawCategory
      ? rawCategory.split(',').map((c: string) => c.trim().toUpperCase()).filter(Boolean)
      : ['FUEL'];
    const matchesCategory = po.lines.some((l) => l.inventoryItem && allowedCategories.includes(l.inventoryItem.category));
    if (!matchesCategory) {
      cleanupAll();
      res.status(400).json({ error: `PO has no line in the requested category (${allowedCategories.join(', ')}).` });
      return;
    }

    // Bulk fallback fields (apply to every file when per-file `meta` not provided).
    const remarks = (typeof req.body?.remarks === 'string' ? req.body.remarks : '').slice(0, 500) || null;
    const fallbackInvNo = (typeof req.body?.vendorInvNo === 'string' ? req.body.vendorInvNo : '').slice(0, 50) || null;

    // Per-file metadata. JSON-encoded array, length should match files order.
    // Each entry: { vendorInvNo?, vendorInvDate? (ISO), totalAmount? (number) }
    interface PerFileMeta { vendorInvNo?: string | null; vendorInvDate?: string | null; totalAmount?: number | null }
    let metaList: PerFileMeta[] = [];
    if (typeof req.body?.meta === 'string' && req.body.meta.trim().length > 0) {
      try {
        const parsed = JSON.parse(req.body.meta);
        if (Array.isArray(parsed)) metaList = parsed as PerFileMeta[];
      } catch { /* malformed — ignore, use fallback */ }
    }

    // Optional payment to record once invoices are created.
    interface PaymentMeta { amount?: number; mode?: string; reference?: string; remarks?: string }
    let paymentMeta: PaymentMeta | null = null;
    if (typeof req.body?.payment === 'string' && req.body.payment.trim().length > 0) {
      try {
        const parsed = JSON.parse(req.body.payment) as PaymentMeta;
        if (parsed && typeof parsed.amount === 'number' && parsed.amount > 0) paymentMeta = parsed;
      } catch { /* malformed — ignore */ }
    }

    interface PerFileResult {
      ok: boolean;
      deduped: boolean;
      fileName: string;
      invoice?: { id: string; filePath: string | null; originalFileName: string | null; createdAt: Date; totalAmount: number; vendorInvNo: string | null };
      error?: string;
    }
    const results: PerFileResult[] = [];
    const newlyCreatedInvoiceIds: string[] = [];

    for (let i = 0; i < uploaded.length; i++) {
      const f = uploaded[i];
      const meta = metaList[i] || {};
      try {
        const fileBuffer = fs.readFileSync(f.path);
        const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        const filePath = `vendor-invoices/${f.filename}`;

        const existing = await prisma.vendorInvoice.findFirst({
          where: { poId: po.id, fileHash },
          select: { id: true, filePath: true, originalFileName: true, createdAt: true, totalAmount: true, vendorInvNo: true },
        });
        if (existing) {
          try { fs.unlinkSync(f.path); } catch { /* best effort */ }
          results.push({ ok: true, deduped: true, fileName: f.originalname, invoice: existing });
          continue;
        }

        const totalAmount = typeof meta.totalAmount === 'number' && isFinite(meta.totalAmount) && meta.totalAmount > 0
          ? Math.round(meta.totalAmount * 100) / 100
          : 0;
        const vendorInvNo = (meta.vendorInvNo || '').toString().slice(0, 50) || fallbackInvNo;
        const vendorInvDate = meta.vendorInvDate ? new Date(meta.vendorInvDate) : null;

        const invoice = await prisma.vendorInvoice.create({
          data: {
            vendorId: po.vendorId,
            poId: po.id,
            vendorInvNo,
            vendorInvDate,
            invoiceDate: new Date(),
            productName: '',
            status: 'PENDING',
            // Header totals — when totalAmount given we mirror it into balanceAmount
            // so the existing accounts ledger / outstanding views light up correctly.
            totalAmount,
            balanceAmount: totalAmount,
            filePath,
            fileHash,
            originalFileName: f.originalname,
            remarks,
            userId: req.user!.id,
            companyId: po.companyId ?? getActiveCompanyId(req),
            division: po.division ?? 'ETHANOL',
          },
          select: { id: true, filePath: true, originalFileName: true, createdAt: true, totalAmount: true, vendorInvNo: true },
        });
        results.push({ ok: true, deduped: false, fileName: f.originalname, invoice });
        newlyCreatedInvoiceIds.push(invoice.id);
      } catch (err: unknown) {
        try { fs.unlinkSync(f.path); } catch { /* best effort */ }
        const msg = err instanceof Error ? err.message : 'Upload failed';
        results.push({ ok: false, deduped: false, fileName: f.originalname, error: msg });
      }
    }

    // Optional payment alongside the upload. Linked to a single invoice via
    // invoiceId only when exactly one new invoice was created in this batch
    // (clean attribution); otherwise the payment hangs off the PO via FK.
    let createdPayment: { id: string; amount: number; paymentNo: number; mode: string; reference: string | null } | null = null;
    if (paymentMeta && paymentMeta.amount && paymentMeta.amount > 0) {
      const mode = (paymentMeta.mode || 'CASH').toString().slice(0, 20);
      const reference = (paymentMeta.reference || '').toString().slice(0, 100) || '';
      const payRemarks = (paymentMeta.remarks || '').toString().slice(0, 500)
        || `Fuel deal PO-${po.poNo}${newlyCreatedInvoiceIds.length === 1 ? ' (1 invoice attached)' : newlyCreatedInvoiceIds.length > 1 ? ` (${newlyCreatedInvoiceIds.length} invoices attached)` : ''}`;
      const linkedInvoiceId = newlyCreatedInvoiceIds.length === 1 ? newlyCreatedInvoiceIds[0] : null;

      const payment = await prisma.vendorPayment.create({
        data: {
          vendorId: po.vendorId,
          purchaseOrderId: po.id,
          invoiceId: linkedInvoiceId,
          paymentDate: new Date(),
          amount: Math.round(paymentMeta.amount * 100) / 100,
          mode,
          reference,
          paymentStatus: reference ? 'CONFIRMED' : 'INITIATED',
          confirmedAt: reference ? new Date() : null,
          isAdvance: false,
          remarks: payRemarks,
          userId: req.user!.id,
          companyId: po.companyId ?? getActiveCompanyId(req),
        },
        select: { id: true, amount: true, paymentNo: true, mode: true, reference: true, paymentStatus: true },
      });

      // When linked to a single invoice, bump its paid/balance figures so the
      // accounts ledger reflects the partial/full pay-down. Status mirrors
      // the existing PaymentsOut convention (PARTIAL_PAID vs PAID).
      if (linkedInvoiceId) {
        const inv = await prisma.vendorInvoice.findUnique({
          where: { id: linkedInvoiceId },
          select: { totalAmount: true, paidAmount: true },
        });
        if (inv) {
          const newPaid = Math.round(((inv.paidAmount || 0) + payment.amount) * 100) / 100;
          const total = inv.totalAmount || 0;
          const newBalance = Math.max(0, Math.round((total - newPaid) * 100) / 100);
          const newStatus = total > 0 && newPaid >= total - 0.01 ? 'PAID' : newPaid > 0 ? 'PARTIAL_PAID' : 'PENDING';
          await prisma.vendorInvoice.update({
            where: { id: linkedInvoiceId },
            data: { paidAmount: newPaid, balanceAmount: newBalance, status: newStatus },
          });
        }
      }

      // Auto-journal — same path the standalone fuel/Pay button uses.
      if (payment.paymentStatus === 'CONFIRMED') {
        try {
          const { onVendorPaymentMade } = await import('../services/autoJournal');
          await onVendorPaymentMade(prisma as Parameters<typeof onVendorPaymentMade>[0], {
            id: payment.id, amount: payment.amount, mode, reference,
            tdsDeducted: 0, vendorId: po.vendorId, userId: req.user!.id, paymentDate: new Date(),
          });
        } catch { /* best-effort */ }
      }

      createdPayment = { id: payment.id, amount: payment.amount, paymentNo: payment.paymentNo, mode: payment.mode, reference: payment.reference };
    }

    const created = results.filter((r) => r.ok && !r.deduped).length;
    const deduped = results.filter((r) => r.ok && r.deduped).length;
    const failed = results.filter((r) => !r.ok).length;
    res.status(created > 0 || createdPayment ? 201 : 200).json({
      ok: failed === 0,
      results,
      payment: createdPayment,
      summary: { created, deduped, failed },
    });
  }),
);

router.get(
  '/payments/:poId/invoices',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const invoices = await prisma.vendorInvoice.findMany({
      where: { poId: req.params.poId },
      take: 200,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, vendorInvNo: true, vendorInvDate: true, invoiceDate: true,
        totalAmount: true, paidAmount: true, status: true,
        filePath: true, originalFileName: true, remarks: true, createdAt: true,
      },
    });
    res.json(invoices);
  }),
);

// Running ledger for a single fuel PO. Same shape PaymentsOut uses on its
// vendor ledger so the UI can lay it out identically. Each row carries a
// running balance: invoiced – paid (so positive = vendor still owed).
router.get(
  '/payments/:poId/ledger',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.poId },
      select: {
        id: true, poNo: true, grandTotal: true, status: true,
        vendor: { select: { id: true, name: true, phone: true } },
        lines: { select: { quantity: true, receivedQty: true, rate: true, gstPercent: true } },
      },
    });
    if (!po) { res.status(404).json({ error: 'PO not found' }); return; }

    const receivedValue = Math.round(po.lines.reduce((s, l) => {
      const base = (l.receivedQty || 0) * l.rate;
      return s + base + base * ((l.gstPercent || 0) / 100);
    }, 0) * 100) / 100;
    const plannedValue = Math.round(po.lines.reduce((s, l) => {
      const q = l.quantity >= 900000 ? (l.receivedQty || 0) : l.quantity;
      const base = q * (l.rate || 0);
      return s + base + base * ((l.gstPercent || 0) / 100);
    }, 0) * 100) / 100;
    const poTotal = po.grandTotal > 0 ? po.grandTotal : Math.max(plannedValue, receivedValue);

    const [invoices, payments] = await Promise.all([
      prisma.vendorInvoice.findMany({
        where: { poId: po.id },
        select: { id: true, vendorInvNo: true, invoiceDate: true, totalAmount: true, status: true, originalFileName: true, filePath: true, createdAt: true },
        take: 500,
      }),
      prisma.vendorPayment.findMany({
        where: { purchaseOrderId: po.id },
        select: { id: true, paymentNo: true, paymentDate: true, amount: true, mode: true, reference: true, paymentStatus: true, invoiceId: true },
        take: 500,
      }),
    ]);

    type LedgerRow =
      | { type: 'INVOICE'; date: Date; id: string; vendorInvNo: string | null; amount: number; status: string; fileName: string | null; filePath: string | null }
      | { type: 'PAYMENT'; date: Date; id: string; paymentNo: number; amount: number; mode: string; reference: string | null; paymentStatus: string; invoiceId: string | null };

    const rows: LedgerRow[] = [
      ...invoices.map<LedgerRow>((inv) => ({
        type: 'INVOICE',
        date: inv.invoiceDate || inv.createdAt,
        id: inv.id,
        vendorInvNo: inv.vendorInvNo,
        amount: inv.totalAmount || 0,
        status: inv.status,
        fileName: inv.originalFileName,
        filePath: inv.filePath,
      })),
      ...payments.map<LedgerRow>((p) => ({
        type: 'PAYMENT',
        date: p.paymentDate,
        id: p.id,
        paymentNo: p.paymentNo,
        amount: p.amount,
        mode: p.mode,
        reference: p.reference,
        paymentStatus: p.paymentStatus,
        invoiceId: p.invoiceId,
      })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());

    let running = 0;
    const ledger = rows.map((r) => {
      // Invoices add to "owed", payments subtract. Running > 0 = vendor still owed.
      running += r.type === 'INVOICE' ? r.amount : -r.amount;
      return { ...r, runningBalance: Math.round(running * 100) / 100 };
    });

    const totalInvoiced = invoices.reduce((s, i) => s + (i.totalAmount || 0), 0);
    const totalPaid = payments
      .filter((p) => p.paymentStatus === 'CONFIRMED')
      .reduce((s, p) => s + p.amount, 0);
    const pendingBank = payments
      .filter((p) => p.paymentStatus === 'INITIATED')
      .reduce((s, p) => s + p.amount, 0);

    // Same fallback chain as /api/fuel/payments — without it a manual PO
    // (no GRNs) with bills uploaded but totals not yet filled in pins to
    // outstanding=0 and renders as "✓ Settled" while nothing is paid.
    let payableBasis: number;
    let basisSource: 'RECEIVED' | 'INVOICED' | 'PLANNED';
    if (receivedValue > 0) {
      payableBasis = receivedValue;
      basisSource = 'RECEIVED';
    } else if (totalInvoiced > 0) {
      payableBasis = totalInvoiced;
      basisSource = 'INVOICED';
    } else {
      payableBasis = poTotal;
      basisSource = 'PLANNED';
    }
    const outstanding = Math.max(0, Math.round((payableBasis - totalPaid - pendingBank) * 100) / 100);

    res.json({
      poNo: po.poNo,
      vendor: po.vendor,
      poTotal: Math.round(poTotal * 100) / 100,
      receivedValue,
      totalInvoiced: Math.round(totalInvoiced * 100) / 100,
      totalPaid: Math.round(totalPaid * 100) / 100,
      pendingBank: Math.round(pendingBank * 100) / 100,
      outstanding,
      payableBasis: Math.round(payableBasis * 100) / 100,
      basisSource,
      ledger,
    });
  }),
);

// Backfill / correct invoice metadata for an already-uploaded file.
// Used when an operator uploaded a bill earlier (when the upload modal
// only took the file) and now wants to fill in the vendor invoice no /
// date / total amount on it. Recomputes balanceAmount + status when total
// changes so the accounts ledger stays consistent.
const editFuelInvoiceSchema = z.object({
  vendorInvNo: z.string().max(50).optional().nullable(),
  vendorInvDate: z.string().optional().nullable(),
  totalAmount: z.coerce.number().min(0).optional(),
  remarks: z.string().max(500).optional().nullable(),
});
router.put(
  '/payments/invoices/:invoiceId',
  authenticate,
  validate(editFuelInvoiceSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const inv = await prisma.vendorInvoice.findUnique({
      where: { id: req.params.invoiceId },
      select: { id: true, totalAmount: true, paidAmount: true, status: true },
    });
    if (!inv) { res.status(404).json({ error: 'Invoice not found' }); return; }

    const b = req.body as z.infer<typeof editFuelInvoiceSchema>;
    const data: Record<string, unknown> = {};
    if (b.vendorInvNo !== undefined) data.vendorInvNo = (b.vendorInvNo || '').trim() || null;
    if (b.vendorInvDate !== undefined) data.vendorInvDate = b.vendorInvDate ? new Date(b.vendorInvDate) : null;
    if (b.remarks !== undefined) data.remarks = (b.remarks || '').trim() || null;

    if (b.totalAmount !== undefined && isFinite(b.totalAmount)) {
      const total = Math.round(b.totalAmount * 100) / 100;
      const paid = inv.paidAmount || 0;
      const balance = Math.max(0, Math.round((total - paid) * 100) / 100);
      const status = total > 0 && paid >= total - 0.01 ? 'PAID' : paid > 0 ? 'PARTIAL_PAID' : (inv.status === 'CANCELLED' ? 'CANCELLED' : 'PENDING');
      data.totalAmount = total;
      data.balanceAmount = balance;
      data.status = status;
    }

    const updated = await prisma.vendorInvoice.update({
      where: { id: inv.id },
      data,
      select: {
        id: true, vendorInvNo: true, vendorInvDate: true, invoiceDate: true,
        totalAmount: true, paidAmount: true, status: true,
        filePath: true, originalFileName: true, remarks: true, createdAt: true,
      },
    });
    res.json(updated);
  }),
);

router.delete(
  '/payments/invoices/:invoiceId',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const inv = await prisma.vendorInvoice.findUnique({
      where: { id: req.params.invoiceId },
      select: { id: true, filePath: true, status: true, paidAmount: true, poId: true },
    });
    if (!inv) { res.status(404).json({ error: 'Invoice not found' }); return; }
    if ((inv.paidAmount || 0) > 0) {
      res.status(400).json({ error: 'Cannot delete — invoice has payments recorded against it.' });
      return;
    }
    await prisma.vendorInvoice.delete({ where: { id: inv.id } });
    if (inv.filePath) {
      const onDisk = path.join(__dirname, '../../uploads', inv.filePath);
      try { fs.unlinkSync(onDisk); } catch { /* file may already be gone */ }
    }
    res.json({ ok: true });
  }),
);

export default router;
