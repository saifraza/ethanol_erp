import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate as any);

// GET /latest — get defaults for new entry (opening stock, cumulative production/dispatch)
router.get('/latest', async (req: Request, res: Response) => {
  try {
    const beforeId = req.query.beforeId as string | undefined;

    // Settings for baselines
    const settings = await prisma.settings.findFirst();
    const ddgsBaseProduction = (settings as any)?.ddgsBaseProduction ?? 3160;
    const ddgsBaseStock = (settings as any)?.ddgsBaseStock ?? 1956.01;

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
    const dispAgg = await prisma.dDGSDispatchTruck.aggregate({ _sum: { weightNet: true } });
    const cumulativeDispatch = dispAgg._sum.weightNet || 0;

    res.json({
      defaults: {
        openingStock: latest?.closingStock ?? ddgsBaseStock,
        cumulativeProduction,
        cumulativeDispatch,
        ddgsBaseProduction,
        totalProduction: ddgsBaseProduction + cumulativeProduction,
      },
      previous: latest || null,
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET / — history
router.get('/', async (_req: Request, res: Response) => {
  try {
    const entries = await prisma.dDGSStockEntry.findMany({
      orderBy: { date: 'desc' }, take: 100
    });
    res.json({ entries });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST / — create/update stock entry
router.post('/', async (req: Request, res: Response) => {
  try {
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
      userId: (req as any).user.id,
    };

    // Upsert by date+yearStart
    const entry = await prisma.dDGSStockEntry.upsert({
      where: { date_yearStart: { date, yearStart } },
      create: data,
      update: data,
    });
    res.status(201).json(entry);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /:id
router.delete('/:id', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  try {
    await prisma.dDGSStockEntry.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
