import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize, AuthRequest, getCompanyFilter } from '../middleware/auth';

const router = Router();

router.use(authenticate as any);

// GET /latest — defaults for new entry (opening stock, cumulative receipt/dispatch)
router.get('/latest', async (req: Request, res: Response) => {
  try {
    const beforeId = req.query.beforeId as string | undefined;

    const where = beforeId ? { id: { not: beforeId } } : {};
    const latest = await prisma.sugarStockEntry.findFirst({
      where, orderBy: { date: 'desc' },
    });

    const recvAgg = await prisma.sugarStockEntry.aggregate({ _sum: { receiptFromMillToday: true } });
    const cumulativeReceipt = recvAgg._sum.receiptFromMillToday || 0;

    const dispAgg = await prisma.sugarDispatchTruck.aggregate({ where: { ...getCompanyFilter(req as AuthRequest) }, _sum: { weightNet: true } });
    const cumulativeDispatch = dispAgg._sum.weightNet || 0;

    res.json({
      defaults: {
        openingStock: latest?.closingStock ?? 0,
        cumulativeReceipt,
        cumulativeDispatch,
      },
      previous: latest || null,
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET / — history (most recent 100 stock entries)
router.get('/', async (_req: Request, res: Response) => {
  try {
    const entries = await prisma.sugarStockEntry.findMany({
      orderBy: { date: 'desc' },
      take: 100,
      select: {
        id: true, date: true, yearStart: true, openingStock: true,
        receiptFromMillToday: true, dispatchToday: true, closingStock: true,
        bags: true, weightPerBag: true, remarks: true, createdAt: true, updatedAt: true,
      },
    });
    res.json({ entries });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST / — create/update stock entry (upsert by date+yearStart)
router.post('/', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const date = new Date(b.date);
    const yearStart = b.yearStart || date.getFullYear();

    const data = {
      date,
      yearStart,
      openingStock: parseFloat(b.openingStock) || 0,
      receiptFromMillToday: parseFloat(b.receiptFromMillToday) || 0,
      dispatchToday: parseFloat(b.dispatchToday) || 0,
      closingStock: parseFloat(b.closingStock) || 0,
      bags: parseInt(b.bags) || 0,
      weightPerBag: parseFloat(b.weightPerBag) || 50,
      remarks: b.remarks || null,
      userId: (req as AuthRequest).user!.id,
    };

    const entry = await prisma.sugarStockEntry.upsert({
      where: { date_yearStart: { date, yearStart } },
      create: data,
      update: data,
    });
    res.status(201).json(entry);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /:id (admin only)
router.delete('/:id', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  try {
    await prisma.sugarStockEntry.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
