import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';

const router = Router();
const DEFAULT_SILO = 0;
const DEFAULT_CUM_UNLOADED = 0;
const DEFAULT_CUM_CONSUMED = 0;

function getCurrentYearStart(): number {
  return new Date().getFullYear();
}

async function getGrainPcts() {
  const s = await prisma.settings.findFirst();
  return {
    fermPct: (s?.grainPercent ?? 31) / 100,
    pfPct: (s?.pfGrainPercent ?? 15) / 100,
  };
}

function calcGrain(data: any, opening: number, prevCumUnloaded: number, prevCumConsumed: number, prevWashConsumed: number, fermPct: number, pfPct: number) {
  const washDiff = Math.max(0, (data.washConsumed || 0) - prevWashConsumed);
  const grainConsumed = washDiff * fermPct;

  const fermVol = (data.f1Level || 0) + (data.f2Level || 0) + (data.f3Level || 0) + (data.f4Level || 0) + (data.beerWellLevel || 0);
  const pfVol = (data.pf1Level || 0) + (data.pf2Level || 0);
  const iltFltVol = (data.iltLevel || 0) + (data.fltLevel || 0);
  const grainInFermenters = fermVol * fermPct;
  const grainInPF = pfVol * pfPct;
  const grainInIltFlt = iltFltVol * fermPct;
  const grainInProcess = grainInFermenters + grainInPF + grainInIltFlt;

  const totalFermVol = fermVol + pfVol + iltFltVol;
  const siloClosingStock = opening + (data.grainUnloaded || 0) - grainConsumed;
  const totalGrainAtPlant = siloClosingStock + grainInProcess;
  const cumulativeUnloaded = prevCumUnloaded + (data.grainUnloaded || 0);
  const cumulativeConsumed = prevCumConsumed + grainConsumed;

  return {
    fermentationVolume: Math.round(totalFermVol * 100) / 100,
    grainConsumed: Math.round(grainConsumed * 100) / 100,
    grainInProcess: Math.round(grainInProcess * 100) / 100,
    siloOpeningStock: Math.round(opening * 100) / 100,
    siloClosingStock: Math.round(siloClosingStock * 100) / 100,
    totalGrainAtPlant: Math.round(totalGrainAtPlant * 100) / 100,
    cumulativeUnloaded: Math.round(cumulativeUnloaded * 100) / 100,
    cumulativeConsumed: Math.round(cumulativeConsumed * 100) / 100,
  };
}

async function getLastEntry(yearStart: number, beforeDate?: Date) {
  return prisma.grainEntry.findFirst({
    where: {
      yearStart,
      ...(beforeDate ? { date: { lt: beforeDate } } : {}),
    },
    orderBy: { date: 'desc' },
  });
}

// GET /api/grain
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { year, limit = '30', offset = '0' } = req.query as any;
    const yearStart = year ? parseInt(year) : getCurrentYearStart();
    const entries = await prisma.grainEntry.findMany({
      where: { yearStart },
      orderBy: { date: 'desc' },
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
    const beforeId = req.query.beforeId as string | undefined;
    let beforeDate: Date | undefined;
    if (beforeId) {
      const editEntry = await prisma.grainEntry.findUnique({ where: { id: beforeId } });
      if (editEntry) beforeDate = editEntry.date;
    }
    const latest = await getLastEntry(yearStart, beforeDate);
    res.json({
      latest,
      defaults: {
        siloOpeningStock: latest?.siloClosingStock ?? DEFAULT_SILO,
        totalGrainAtPlant: latest?.totalGrainAtPlant ?? DEFAULT_SILO,
        cumulativeUnloaded: latest?.cumulativeUnloaded ?? DEFAULT_CUM_UNLOADED,
        cumulativeConsumed: latest?.cumulativeConsumed ?? DEFAULT_CUM_CONSUMED,
        lastUnloaded: latest?.grainUnloaded ?? 0,
        yearStart,
      },
      previous: latest ? {
        washConsumed: latest.washConsumed,
        washConsumedAt: latest.washConsumedAt,
        fermentationVolume: latest.fermentationVolume,
        fermentationVolumeAt: latest.fermentationVolumeAt,
        f1Level: latest.f1Level, f2Level: latest.f2Level,
        f3Level: latest.f3Level, f4Level: latest.f4Level,
        beerWellLevel: latest.beerWellLevel,
        pf1Level: latest.pf1Level, pf2Level: latest.pf2Level,
        iltLevel: latest.iltLevel, fltLevel: latest.fltLevel,
        grainConsumed: latest.grainConsumed,
        grainInProcess: latest.grainInProcess,
        date: latest.date,
        createdAt: latest.createdAt,
      } : null,
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
      orderBy: { date: 'desc' },
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

// POST /api/grain
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { date, grainUnloaded, washConsumed, washConsumedAt, fermentationVolumeAt,
      f1Level, f2Level, f3Level, f4Level, beerWellLevel, pf1Level, pf2Level, iltLevel, fltLevel,
      moisture, starchPercent, damagedPercent, foreignMatter, trucks, avgTruckWeight, supplier, remarks } = req.body;
    const entryDate = new Date(date);
    const yearStart = entryDate.getFullYear();

    const prev = await getLastEntry(yearStart);
    const opening = prev?.siloClosingStock ?? DEFAULT_SILO;
    const prevCumUnloaded = prev?.cumulativeUnloaded ?? DEFAULT_CUM_UNLOADED;
    const prevCumConsumed = prev?.cumulativeConsumed ?? DEFAULT_CUM_CONSUMED;
    const { fermPct, pfPct } = await getGrainPcts();

    const inputData = {
      grainUnloaded: grainUnloaded || 0,
      washConsumed: washConsumed || 0,
      f1Level: f1Level || 0, f2Level: f2Level || 0,
      f3Level: f3Level || 0, f4Level: f4Level || 0,
      beerWellLevel: beerWellLevel || 0,
      pf1Level: pf1Level || 0, pf2Level: pf2Level || 0,
      iltLevel: iltLevel || 0, fltLevel: fltLevel || 0,
    };
    const prevWash = prev?.washConsumed ?? 0;
    const calc = calcGrain(inputData, opening, prevCumUnloaded, prevCumConsumed, prevWash, fermPct, pfPct);

    const entry = await prisma.grainEntry.create({
      data: {
        date: entryDate,
        yearStart,
        grainUnloaded: inputData.grainUnloaded,
        washConsumed: inputData.washConsumed,
        washConsumedAt: washConsumedAt ? new Date(washConsumedAt) : null,
        fermentationVolumeAt: fermentationVolumeAt ? new Date(fermentationVolumeAt) : null,
        f1Level: inputData.f1Level, f2Level: inputData.f2Level,
        f3Level: inputData.f3Level, f4Level: inputData.f4Level,
        beerWellLevel: inputData.beerWellLevel,
        pf1Level: inputData.pf1Level, pf2Level: inputData.pf2Level,
        iltLevel: inputData.iltLevel, fltLevel: inputData.fltLevel,
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
    const { grainUnloaded, washConsumed, washConsumedAt, fermentationVolumeAt,
      f1Level, f2Level, f3Level, f4Level, beerWellLevel, pf1Level, pf2Level, iltLevel, fltLevel,
      moisture, starchPercent, damagedPercent, foreignMatter, trucks, avgTruckWeight, supplier, remarks } = req.body;
    const existing = await prisma.grainEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Entry not found' });

    const prev = await prisma.grainEntry.findFirst({
      where: { yearStart: existing.yearStart, date: { lt: existing.date } },
      orderBy: { date: 'desc' },
    });
    const opening = prev?.siloClosingStock ?? DEFAULT_SILO;
    const prevCumUnloaded = prev?.cumulativeUnloaded ?? DEFAULT_CUM_UNLOADED;
    const prevCumConsumed = prev?.cumulativeConsumed ?? DEFAULT_CUM_CONSUMED;
    const { fermPct, pfPct } = await getGrainPcts();

    const inputData = {
      grainUnloaded: grainUnloaded ?? existing.grainUnloaded,
      washConsumed: washConsumed ?? existing.washConsumed,
      f1Level: f1Level ?? existing.f1Level ?? 0,
      f2Level: f2Level ?? existing.f2Level ?? 0,
      f3Level: f3Level ?? existing.f3Level ?? 0,
      f4Level: f4Level ?? existing.f4Level ?? 0,
      beerWellLevel: beerWellLevel ?? existing.beerWellLevel ?? 0,
      pf1Level: pf1Level ?? existing.pf1Level ?? 0,
      pf2Level: pf2Level ?? existing.pf2Level ?? 0,
      iltLevel: iltLevel ?? (existing as any).iltLevel ?? 0,
      fltLevel: fltLevel ?? (existing as any).fltLevel ?? 0,
    };
    const prevWash = prev?.washConsumed ?? 0;
    const calc = calcGrain(inputData, opening, prevCumUnloaded, prevCumConsumed, prevWash, fermPct, pfPct);

    const entry = await prisma.grainEntry.update({
      where: { id: req.params.id },
      data: {
        ...inputData, ...calc,
        washConsumedAt: washConsumedAt ? new Date(washConsumedAt) : undefined,
        fermentationVolumeAt: fermentationVolumeAt ? new Date(fermentationVolumeAt) : undefined,
        moisture, starchPercent, damagedPercent, foreignMatter, trucks, avgTruckWeight, supplier, remarks,
      },
    });

    res.json(entry);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/grain/:id
router.delete('/:id', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.grainEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Entry not found' });
    await prisma.grainEntry.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
