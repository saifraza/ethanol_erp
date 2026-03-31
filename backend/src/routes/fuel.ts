import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
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
  code: z.string().min(1),
  unit: z.string().default('MT'),
  steamRate: z.number().positive().optional(),
  calorificValue: z.number().positive().optional(),
  minStock: z.number().min(0).default(0),
  maxStock: z.number().positive().optional(),
  defaultRate: z.number().min(0).default(0),
  hsnCode: z.string().optional(),
  gstPercent: z.number().min(0).default(5),
  location: z.string().optional(),
  remarks: z.string().optional(),
});

// GET /master — list all fuel items
router.get('/master', asyncHandler(async (req: AuthRequest, res: Response) => {
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
router.post('/master', validate(fuelMasterSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const item = await prisma.inventoryItem.create({
    data: {
      name: b.name,
      code: b.code,
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
router.put('/master/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
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

// DELETE /master/:id — soft delete
router.delete('/master/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
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
router.get('/consumption', asyncHandler(async (req: AuthRequest, res: Response) => {
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

  // Build response: one row per fuel type
  const rows = fuelItems.map(fuel => {
    const entry = entryMap.get(fuel.id);
    const prevClosing = prevMap.get(fuel.id) ?? fuel.currentStock;

    return {
      fuelItemId: fuel.id,
      fuelName: fuel.name,
      fuelCode: fuel.code,
      unit: fuel.unit,
      steamRate: fuel.steamRate || 0,
      // Entry data (or defaults)
      id: entry?.id || null,
      openingStock: entry?.openingStock ?? prevClosing,
      received: entry?.received ?? 0,
      consumed: entry?.consumed ?? 0,
      closingStock: entry?.closingStock ?? (prevClosing - (entry?.consumed ?? 0) + (entry?.received ?? 0)),
      steamGenerated: entry?.steamGenerated ?? 0,
      remarks: entry?.remarks ?? '',
    };
  });

  res.json({ date: date.toISOString().split('T')[0], rows });
}));

// POST /consumption — save daily entries (upsert all rows)
router.post('/consumption', asyncHandler(async (req: AuthRequest, res: Response) => {
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

    const entry = await prisma.fuelConsumption.upsert({
      where: {
        date_fuelItemId: { date, fuelItemId: row.fuelItemId },
      },
      update: {
        openingStock,
        received,
        consumed,
        closingStock: Math.max(0, closingStock),
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
        closingStock: Math.max(0, closingStock),
        steamGenerated: Math.round(steamGenerated * 100) / 100,
        remarks: row.remarks || '',
        userId: req.user!.id,
      },
    });
    results.push(entry);
  }

  res.json({ ok: true, count: results.length });
}));


// ==========================================================================
//  SUMMARY — KPIs
// ==========================================================================

router.get('/summary', asyncHandler(async (req: AuthRequest, res: Response) => {
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

export default router;
