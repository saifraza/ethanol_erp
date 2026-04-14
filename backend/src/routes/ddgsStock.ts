import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize, AuthRequest, getCompanyFilter } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';

const router = Router();

router.use(authenticate as any);

// GET /latest — get defaults for new entry (opening stock, cumulative production/dispatch)
router.get('/latest', asyncHandler(async (req: AuthRequest, res: Response) => {
  const beforeId = req.query.beforeId as string | undefined;

  // Settings for baselines
  const settings = await prisma.settings.findFirst();
  const ddgsBaseProduction = (settings as Record<string, unknown>)?.ddgsBaseProduction ?? 3160;
  const ddgsBaseStock = (settings as Record<string, unknown>)?.ddgsBaseStock ?? 1956.01;

  // Latest entry
  const where = beforeId ? { id: { not: beforeId } } : {};
  const latest = await prisma.dDGSStockEntry.findFirst({
    where, orderBy: { date: 'desc' }
  });

  // Cumulative production from all DDGSProductionEntry records
  const prodAgg = await prisma.dDGSProductionEntry.aggregate({ _sum: { totalProduction: true } });
  const erpProduction = prodAgg._sum.totalProduction || 0;

  // Also check DDGSStockEntry for legacy data
  const stockProdAgg = await prisma.dDGSStockEntry.aggregate({ _sum: { productionToday: true } });
  const stockProduction = stockProdAgg._sum.productionToday || 0;

  const cumulativeProduction = Math.max(erpProduction, stockProduction);

  // Cumulative dispatch from DDGSDispatchTruck
  const dispAgg = await prisma.dDGSDispatchTruck.aggregate({ where: { ...getCompanyFilter(req) }, _sum: { weightNet: true } });
  const cumulativeDispatch = dispAgg._sum.weightNet || 0;

  res.json({
    defaults: {
      openingStock: latest?.closingStock ?? ddgsBaseStock,
      cumulativeProduction,
      cumulativeDispatch,
      ddgsBaseProduction,
      totalProduction: (ddgsBaseProduction as number) + cumulativeProduction,
    },
    previous: latest || null,
  });
}));

// GET / — history (stock entries + auto-generated from production data)
router.get('/', asyncHandler(async (_req: AuthRequest, res: Response) => {
  // Saved stock entries
  const entries = await prisma.dDGSStockEntry.findMany({
    orderBy: { date: 'desc' }, take: 100,
  });
  const entryDates = new Set(entries.map(e => e.date.toISOString().slice(0, 10)));

  // Also get production data grouped by shiftDate for days without a stock entry
  const prodEntries = await prisma.dDGSProductionEntry.findMany({
    orderBy: { shiftDate: 'desc' },
    take: 500,
    select: { shiftDate: true, bags: true, totalProduction: true },
  });

  // Group production by shiftDate
  const prodByDate = new Map<string, { bags: number; production: number }>();
  for (const p of prodEntries) {
    const dateKey = p.shiftDate.slice(0, 10);
    if (entryDates.has(dateKey)) continue; // skip if we already have a stock entry
    const existing = prodByDate.get(dateKey) || { bags: 0, production: 0 };
    existing.bags += p.bags || 0;
    existing.production += p.totalProduction || 0;
    prodByDate.set(dateKey, existing);
  }

  // Create synthetic stock entries for production-only days
  const synthetic = Array.from(prodByDate.entries()).map(([dateStr, data]) => ({
    id: `prod-${dateStr}`,
    date: new Date(dateStr),
    yearStart: new Date(dateStr).getFullYear(),
    openingStock: 0,
    productionToday: Math.round(data.production * 1000) / 1000,
    dispatchToday: 0,
    closingStock: 0,
    bags: data.bags,
    weightPerBag: 50,
    remarks: 'Auto-generated from production entries',
    synthetic: true,
  }));

  // Merge and sort
  const all = [...entries.map(e => ({ ...e, synthetic: false })), ...synthetic]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 100);

  res.json({ entries: all });
}));

// POST / — create/update stock entry
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const date = new Date(b.date);
  const yearStart = b.yearStart || date.getFullYear();

  const data = {
    date,
    yearStart,
    openingStock: parseFloat(b.openingStock) || 0,
    productionToday: parseFloat(b.productionToday) || 0,
    dispatchToday: parseFloat(b.dispatchToday) || 0,
    closingStock: parseFloat(b.closingStock) || 0,
    bags: parseInt(b.bags) || 0,
    weightPerBag: parseFloat(b.weightPerBag) || 50,
    remarks: b.remarks || null,
    userId: req.user!.id,
  };

  // Upsert by date+yearStart
  const entry = await prisma.dDGSStockEntry.upsert({
    where: { date_yearStart: { date, yearStart } },
    create: data,
    update: data,
  });
  res.status(201).json(entry);
}));

// DELETE /:id
router.delete('/:id', authorize('ADMIN') as any, asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.dDGSStockEntry.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

export default router;
