import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
const GRAIN_PERCENT = 0.31;
const DEFAULT_SILO = 1500;
const DEFAULT_CUM_UNLOADED = 12000;
const DEFAULT_CUM_CONSUMED = 10500;

function getCurrentYearStart(): number {
  return new Date().getFullYear();
}

function calcGrain(data: any, opening: number, prevCumUnloaded: number, prevCumConsumed: number) {
  const grainConsumed = (data.washConsumed || 0) * GRAIN_PERCENT;
  const grainInProcess = (data.fermentationVolume || 0) * GRAIN_PERCENT;
  const siloClosingStock = opening + (data.grainUnloaded || 0) - grainConsumed;
  const totalGrainAtPlant = siloClosingStock + grainInProcess;
  const cumulativeUnloaded = prevCumUnloaded + (data.grainUnloaded || 0);
  const cumulativeConsumed = prevCumConsumed + grainConsumed;

  return {
    grainConsumed: Math.round(grainConsumed * 100) / 100,
    grainInProcess: Math.round(grainInProcess * 100) / 100,
    siloOpeningStock: Math.round(opening * 100) / 100,
    siloClosingStock: Math.round(siloClosingStock * 100) / 100,
    totalGrainAtPlant: Math.round(totalGrainAtPlant * 100) / 100,
    cumulativeUnloaded: Math.round(cumulativeUnloaded * 100) / 100,
    cumulativeConsumed: Math.round(cumulativeConsumed * 100) / 100,
  };
}

async function getPreviousEntry(date: Date, yearStart: number) {
  return prisma.grainEntry.findFirst({
    where: { yearStart },
    orderBy: { createdAt: 'desc' },
  });
}

async function getLastEntry(yearStart: number) {
  return prisma.grainEntry.findFirst({
    where: { yearStart },
    orderBy: { createdAt: 'desc' },
  });
}

// GET /api/grain
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { year, limit = '30', offset = '0' } = req.query as any;
    const yearStart = year ? parseInt(year) : getCurrentYearStart();
    const entries = await prisma.grainEntry.findMany({
      where: { yearStart },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset),
      include: { user: { select: { name: true } } },
    });
    const total = await prisma.grainEntry.count({ where: { yearStart } });
    res.json({ entries, total, yearStart });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/grain/latest
router.get('/latest', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const yearStart = getCurrentYearStart();
    const latest = await getLastEntry(yearStart);
    res.json({
      latest,
      defaults: {
        siloOpeningStock: latest?.siloClosingStock ?? DEFAULT_SILO,
        cumulativeUnloaded: latest?.cumulativeUnloaded ?? DEFAULT_CUM_UNLOADED,
        cumulativeConsumed: latest?.cumulativeConsumed ?? DEFAULT_CUM_CONSUMED,
        lastUnloaded: latest?.grainUnloaded ?? 0,
        yearStart,
      },
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/grain/summary
router.get('/summary', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const yearStart = getCurrentYearStart();
    const latest = await getLastEntry(yearStart);
    const recentEntries = await prisma.grainEntry.findMany({
      where: { yearStart },
      orderBy: { createdAt: 'desc' },
      take: 7,
      select: { date: true, siloClosingStock: true, grainConsumed: true, grainUnloaded: true, totalGrainAtPlant: true },
    });
    res.json({
      currentSiloStock: latest?.siloClosingStock ?? DEFAULT_SILO,
      totalGrainAtPlant: latest?.totalGrainAtPlant ?? DEFAULT_SILO,
      grainInProcess: latest?.grainInProcess ?? 0,
      cumulativeUnloaded: latest?.cumulativeUnloaded ?? DEFAULT_CUM_UNLOADED,
      cumulativeConsumed: latest?.cumulativeConsumed ?? DEFAULT_CUM_CONSUMED,
      lastUnloaded: latest?.grainUnloaded ?? 0,
      lastEntryDate: latest?.date ?? null,
      recentTrend: recentEntries.reverse(),
      yearStart,
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /api/grain - always creates new entry (multiple per day OK)
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { date, grainUnloaded, washConsumed, fermentationVolume, moisture, starchPercent, damagedPercent, foreignMatter, trucks, avgTruckWeight, supplier, remarks } = req.body;
    const entryDate = new Date(date);
    entryDate.setHours(0, 0, 0, 0);
    const yearStart = entryDate.getFullYear();

    const prev = await getLastEntry(yearStart);
    const opening = prev?.siloClosingStock ?? DEFAULT_SILO;
    const prevCumUnloaded = prev?.cumulativeUnloaded ?? DEFAULT_CUM_UNLOADED;
    const prevCumConsumed = prev?.cumulativeConsumed ?? DEFAULT_CUM_CONSUMED;

    const inputData = { grainUnloaded: grainUnloaded || 0, washConsumed: washConsumed || 0, fermentationVolume: fermentationVolume || 0 };
    const calc = calcGrain(inputData, opening, prevCumUnloaded, prevCumConsumed);

    const entry = await prisma.grainEntry.create({
      data: {
        date: entryDate,
        yearStart,
        grainUnloaded: inputData.grainUnloaded,
        washConsumed: inputData.washConsumed,
        fermentationVolume: inputData.fermentationVolume,
        ...calc,
        moisture: moisture ?? null, starchPercent: starchPercent ?? null,
        damagedPercent: damagedPercent ?? null, foreignMatter: foreignMatter ?? null,
        trucks: trucks ?? null, avgTruckWeight: avgTruckWeight ?? null,
        supplier: supplier || null, remarks: remarks || null,
        userId: req.user!.id,
      },
    });

    res.status(201).json(entry);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /api/grain/:id
router.put('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { grainUnloaded, washConsumed, fermentationVolume, moisture, starchPercent, damagedPercent, foreignMatter, trucks, avgTruckWeight, supplier, remarks } = req.body;
    const existing = await prisma.grainEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Entry not found' });

    const prev = await prisma.grainEntry.findFirst({
      where: { yearStart: existing.yearStart, createdAt: { lt: existing.createdAt } },
      orderBy: { createdAt: 'desc' },
    });
    const opening = prev?.siloClosingStock ?? DEFAULT_SILO;
    const prevCumUnloaded = prev?.cumulativeUnloaded ?? DEFAULT_CUM_UNLOADED;
    const prevCumConsumed = prev?.cumulativeConsumed ?? DEFAULT_CUM_CONSUMED;

    const inputData = {
      grainUnloaded: grainUnloaded ?? existing.grainUnloaded,
      washConsumed: washConsumed ?? existing.washConsumed,
      fermentationVolume: fermentationVolume ?? existing.fermentationVolume,
    };
    const calc = calcGrain(inputData, opening, prevCumUnloaded, prevCumConsumed);

    const entry = await prisma.grainEntry.update({
      where: { id: req.params.id },
      data: { ...inputData, ...calc, moisture, starchPercent, damagedPercent, foreignMatter, trucks, avgTruckWeight, supplier, remarks },
    });

    res.json(entry);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/grain/:id
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.grainEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Entry not found' });
    await prisma.grainEntry.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
