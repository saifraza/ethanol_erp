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
    millingLossPct: ((s as any)?.millingLossPercent ?? 2.5) / 100,
  };
}

function r2(n: number) { return Math.round(n * 100) / 100; }

// Mass-balance grain calculation
// Flow: Silo → Milling → Flour Silo → ILT/FLT → PF → Fermenters/BW → Distillation
// Grain consumed from silo = Δflour + Δ(grain in process) + grain distilled
// If nothing changed between readings, grain consumed = 0
function calcGrain(data: any, opening: number, prevCumUnloaded: number, prevCumConsumed: number, prevWashConsumed: number, fermPct: number, pfPct: number, millingLossPct: number = 0, prevEntry: any = null) {
  // Current volumes
  const fermVol = (data.f1Level||0)+(data.f2Level||0)+(data.f3Level||0)+(data.f4Level||0)+(data.beerWellLevel||0);
  const pfVol = (data.pf1Level||0)+(data.pf2Level||0);
  const iltFltVol = (data.iltLevel||0)+(data.fltLevel||0);
  const totalFermVol = fermVol + pfVol + iltFltVol;

  // Current grain in each stage
  const grainInFerm = fermVol * fermPct;
  const grainInPF = pfVol * pfPct;
  const grainInIltFlt = iltFltVol * fermPct;
  const grainInProcess = grainInFerm + grainInPF + grainInIltFlt;
  const flourTotal = (data.flourSilo1Level||0) + (data.flourSilo2Level||0);

  // Previous grain in each stage
  const prevFermVol = prevEntry ? ((prevEntry.f1Level||0)+(prevEntry.f2Level||0)+(prevEntry.f3Level||0)+(prevEntry.f4Level||0)+(prevEntry.beerWellLevel||0)) : 0;
  const prevPfVol = prevEntry ? ((prevEntry.pf1Level||0)+(prevEntry.pf2Level||0)) : 0;
  const prevIltFltVol = prevEntry ? ((prevEntry.iltLevel||0)+(prevEntry.fltLevel||0)) : 0;
  const prevGrainInProcess = prevEntry ? (prevFermVol * fermPct + prevPfVol * pfPct + prevIltFltVol * fermPct) : 0;
  const prevFlourTotal = prevEntry ? ((prevEntry.flourSilo1Level||0)+(prevEntry.flourSilo2Level||0)) : 0;

  // Wash distilled (flow meter diff)
  const washDiff = Math.max(0, (data.washConsumed||0) - prevWashConsumed);
  const grainDistilled = washDiff * fermPct;

  // Mass balance: grain consumed from silo
  // = grain distilled out + net change in all downstream inventory
  // Clamped to 0: silo can never go UP from processing
  // Internal transfers (flour→process) cancel out naturally
  const deltaGrainInProcess = grainInProcess - prevGrainInProcess;
  const deltaFlour = flourTotal - prevFlourTotal;
  const grainConsumed = Math.max(0, grainDistilled + deltaGrainInProcess + deltaFlour);

  // Milling loss on received grain
  const grainReceived = data.grainUnloaded || 0;
  const millingLoss = grainReceived * millingLossPct;
  const effectiveGrain = grainReceived - millingLoss;

  const siloClosingStock = opening + effectiveGrain - grainConsumed;
  const totalGrainAtPlant = grainInProcess + flourTotal;
  const cumulativeUnloaded = prevCumUnloaded + grainReceived;
  const cumulativeConsumed = prevCumConsumed + Math.max(0, grainConsumed);

  return {
    fermentationVolume: r2(totalFermVol),
    grainConsumed: r2(grainConsumed),
    grainInProcess: r2(grainInProcess),
    siloOpeningStock: r2(opening),
    siloClosingStock: r2(siloClosingStock),
    totalGrainAtPlant: r2(totalGrainAtPlant),
    cumulativeUnloaded: r2(cumulativeUnloaded),
    cumulativeConsumed: r2(cumulativeConsumed),
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
        quarantineStock: latest?.quarantineStock ?? 0,
        flourSilo1Level: (latest as any)?.flourSilo1Level ?? 0,
        flourSilo2Level: (latest as any)?.flourSilo2Level ?? 0,
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
        flourSilo1Level: (latest as any).flourSilo1Level ?? 0,
        flourSilo2Level: (latest as any).flourSilo2Level ?? 0,
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
      quarantineStock, flourSilo1Level, flourSilo2Level,
      moisture, starchPercent, damagedPercent, foreignMatter, trucks, avgTruckWeight, supplier, remarks } = req.body;
    const entryDate = new Date(date);
    const yearStart = entryDate.getFullYear();

    const prev = await getLastEntry(yearStart);
    const opening = prev?.siloClosingStock ?? DEFAULT_SILO;
    const prevCumUnloaded = prev?.cumulativeUnloaded ?? DEFAULT_CUM_UNLOADED;
    const prevCumConsumed = prev?.cumulativeConsumed ?? DEFAULT_CUM_CONSUMED;
    const { fermPct, pfPct, millingLossPct } = await getGrainPcts();

    const inputData = {
      grainUnloaded: grainUnloaded || 0,
      washConsumed: washConsumed || 0,
      f1Level: f1Level || 0, f2Level: f2Level || 0,
      f3Level: f3Level || 0, f4Level: f4Level || 0,
      beerWellLevel: beerWellLevel || 0,
      pf1Level: pf1Level || 0, pf2Level: pf2Level || 0,
      iltLevel: iltLevel || 0, fltLevel: fltLevel || 0,
      flourSilo1Level: flourSilo1Level || 0,
      flourSilo2Level: flourSilo2Level || 0,
    };
    const prevWash = prev?.washConsumed ?? 0;
    const calc = calcGrain(inputData, opening, prevCumUnloaded, prevCumConsumed, prevWash, fermPct, pfPct, millingLossPct, prev);

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
        quarantineStock: quarantineStock || 0,
        flourSilo1Level: flourSilo1Level || 0,
        flourSilo2Level: flourSilo2Level || 0,
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

// PUT /api/grain/:id — ADMIN only
router.put('/:id', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { grainUnloaded, washConsumed, washConsumedAt, fermentationVolumeAt,
      f1Level, f2Level, f3Level, f4Level, beerWellLevel, pf1Level, pf2Level, iltLevel, fltLevel,
      quarantineStock, flourSilo1Level, flourSilo2Level,
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
    const { fermPct, pfPct, millingLossPct } = await getGrainPcts();

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
      flourSilo1Level: flourSilo1Level ?? (existing as any).flourSilo1Level ?? 0,
      flourSilo2Level: flourSilo2Level ?? (existing as any).flourSilo2Level ?? 0,
    };
    const prevWash = prev?.washConsumed ?? 0;
    const calc = calcGrain(inputData, opening, prevCumUnloaded, prevCumConsumed, prevWash, fermPct, pfPct, millingLossPct, prev);

    const entry = await prisma.grainEntry.update({
      where: { id: req.params.id },
      data: {
        ...inputData, ...calc,
        quarantineStock: quarantineStock ?? undefined,
        flourSilo1Level: flourSilo1Level ?? undefined,
        flourSilo2Level: flourSilo2Level ?? undefined,
        washConsumedAt: washConsumedAt ? new Date(washConsumedAt) : undefined,
        fermentationVolumeAt: fermentationVolumeAt ? new Date(fermentationVolumeAt) : undefined,
        moisture, starchPercent, damagedPercent, foreignMatter, trucks, avgTruckWeight, supplier, remarks,
      },
    });

    res.json(entry);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /api/grain/seed-baseline — ONE-TIME: wipe test data, create real baseline
router.post('/seed-baseline', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    // 1. Delete ALL grain entries
    const deleted = await prisma.grainEntry.deleteMany();

    // 2. Update settings to correct values
    const settings = await prisma.settings.findFirst();
    if (settings) {
      await prisma.settings.update({
        where: { id: settings.id },
        data: { grainPercent: 32, millingLossPercent: 2.5 } as any,
      });
    }

    // 3. Calculated values (32% grain, 2300 KL fermenters, 190 ILT, 440 FLT)
    const f1 = 1725, f2 = 0, f3 = 1932, f4 = 2093, bw = 1518;       // KL
    const ilt = 133, flt = 396;                                         // KL
    const fermVol = f1 + f2 + f3 + f4 + bw;                            // 7268
    const iltFltVol = ilt + flt;                                        // 529
    const totalVol = fermVol + iltFltVol;                               // 7797
    const grainInFerm = fermVol * 0.32;                                 // 2325.76
    const grainInIltFlt = iltFltVol * 0.32;                             // 169.28
    const grainInProcess = grainInFerm + grainInIltFlt;                 // 2495.04
    const siloStock = 2000;
    const quarantine = 1000;
    const totalAtPlant = grainInProcess;                                // grain in fermenters + ILT/FLT + flour silos (0 at baseline)
    const cumConsumed = 13000;                                          // direct from plant records
    // Back-calculate cumUnloaded from known consumed + current stock
    const cumUnloaded = Math.round((siloStock + quarantine + grainInProcess + cumConsumed) / (1 - 0.025) * 100) / 100;

    // 4. Create baseline entry
    const entry = await prisma.grainEntry.create({
      data: {
        date: new Date('2026-03-10T15:27:00.000Z'),  // 8:57 PM IST
        yearStart: 2026,
        grainUnloaded: 0,
        washConsumed: 24458,
        washConsumedAt: new Date('2026-03-10T15:27:00.000Z'),  // 8:57 PM IST
        f1Level: f1, f2Level: f2, f3Level: f3, f4Level: f4,
        beerWellLevel: bw,
        pf1Level: 0, pf2Level: 0,
        iltLevel: ilt, fltLevel: flt,
        fermentationVolume: Math.round(totalVol * 100) / 100,
        fermentationVolumeAt: new Date('2026-03-10T15:47:00.000Z'),  // 9:17 PM IST
        grainConsumed: 0,
        grainInProcess: Math.round(grainInProcess * 100) / 100,
        siloOpeningStock: siloStock,
        siloClosingStock: siloStock,
        quarantineStock: quarantine,
        flourSilo1Level: 0,
        flourSilo2Level: 0,
        totalGrainAtPlant: Math.round(totalAtPlant * 100) / 100,
        cumulativeUnloaded: cumUnloaded,
        cumulativeConsumed: cumConsumed,
        userId: req.user!.id,
        remarks: 'Baseline — real plant data seeded',
      },
    });

    res.json({ message: `Deleted ${deleted.count} test entries. Baseline created.`, entry });
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
