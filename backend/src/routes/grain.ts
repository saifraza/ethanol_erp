import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize, getActiveCompanyId, getCompanyFilter } from '../middleware/auth';

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
    fermPct: (s?.grainPercent ?? 32) / 100,
    pfPct: (s?.pfGrainPercent ?? 15) / 100,
    millingLossPct: ((s as any)?.millingLossPercent ?? 2.5) / 100,
  };
}

function r2(n: number) { return Math.round(n * 100) / 100; }

function resolveLevel(value: number | null | undefined, fallback: number | null | undefined = 0) {
  return value ?? fallback ?? 0;
}

// Mass-balance grain calculation
// Flow: Silo → Milling → Flour Silo → ILT/FLT → PF → Fermenters/BW → Distillation
// Grain consumed from silo = Δflour + Δ(grain in process) + grain distilled
// If nothing changed between readings, grain consumed = 0
function calcGrain(data: any, opening: number, prevCumUnloaded: number, prevCumConsumed: number, prevWashConsumed: number, fermPct: number, pfPct: number, prevEntry: any = null) {
  const isOpeningSnapshot = !prevEntry;
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

  // The first row is an opening snapshot, not a delta from zero.
  const washDiff = isOpeningSnapshot ? 0 : Math.max(0, (data.washConsumed||0) - prevWashConsumed);
  const grainDistilled = washDiff * fermPct;

  // Grain consumed = wash distilled × grain% (production consumption).
  // Tank delta adjusts silo closing separately (same as siloSnapshotJob).
  const deltaGrainInProcess = isOpeningSnapshot ? 0 : grainInProcess - prevGrainInProcess;
  const deltaFlour = isOpeningSnapshot ? 0 : flourTotal - prevFlourTotal;
  const grainConsumed = isOpeningSnapshot ? 0 : r2(grainDistilled);

  // Milling loss on received grain
  const grainReceived = data.grainUnloaded || 0;  // to silo (excluding quarantine)
  const totalReceived = data.totalReceived || grainReceived;  // all truck net weight (incl quarantine)

  // Silo closing uses full mass balance with tank/flour delta
  const siloOutflow = isOpeningSnapshot ? 0 : Math.max(0, grainDistilled + deltaGrainInProcess + deltaFlour);
  const siloClosingStock = opening + grainReceived - siloOutflow;
  const totalGrainAtPlant = grainInProcess + flourTotal;
  const cumulativeUnloaded = prevCumUnloaded + totalReceived;  // total grain received at factory (incl quarantine)
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

async function getLiveCumulativeUnloaded(yearStart: number, companyFilter: { companyId?: string } = {}) {
  const baseline = await prisma.grainEntry.findFirst({
    where: { yearStart },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });
  if (!baseline) return DEFAULT_CUM_UNLOADED;

  const nextYear = new Date(Date.UTC(yearStart + 1, 0, 1));
  const trucks = await prisma.grainTruck.aggregate({
    _sum: { weightNet: true },
    where: {
      ...companyFilter,
      date: {
        gt: baseline.createdAt,
        lt: nextYear,
      },
    },
  });

  return r2((baseline.cumulativeUnloaded ?? DEFAULT_CUM_UNLOADED) + (trucks._sum.weightNet ?? 0));
}

async function getLiveSiloEstimate(yearStart: number, companyFilter: { companyId?: string } = {}) {
  const latest = await getLastEntry(yearStart);
  if (!latest) {
    return {
      latestSavedSiloClosing: DEFAULT_SILO,
      pendingTruckToSilo: 0,
      liveSiloEstimate: DEFAULT_SILO,
      pendingTruckCount: 0,
      pendingInvalidTruckCount: 0,
    };
  }

  const nextYear = new Date(Date.UTC(yearStart + 1, 0, 1));
  const trucks = await prisma.grainTruck.findMany({
    where: {
      ...companyFilter,
      date: {
        gt: latest.createdAt,
        lt: nextYear,
      },
    },
    select: {
      weightNet: true,
      quarantineWeight: true,
    },
  });

  const pendingTruckToSilo = r2(trucks.reduce((sum, truck) => {
    const toSilo = (truck.weightNet ?? 0) - (truck.quarantineWeight ?? 0);
    return sum + Math.max(toSilo, 0);
  }, 0));
  const pendingInvalidTruckCount = trucks.filter(truck => (truck.quarantineWeight ?? 0) > (truck.weightNet ?? 0)).length;
  const latestSavedSiloClosing = latest.siloClosingStock ?? DEFAULT_SILO;

  return {
    latestSavedSiloClosing: r2(latestSavedSiloClosing),
    pendingTruckToSilo,
    liveSiloEstimate: r2(latestSavedSiloClosing + pendingTruckToSilo),
    pendingTruckCount: trucks.length,
    pendingInvalidTruckCount,
  };
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
    const cf = getCompanyFilter(req);
    const liveCumulativeUnloaded = await getLiveCumulativeUnloaded(yearStart, cf);
    const liveSilo = await getLiveSiloEstimate(yearStart, cf);
    res.json({
      latest,
      defaults: {
        siloOpeningStock: latest?.siloClosingStock ?? DEFAULT_SILO,
        liveSiloEstimate: liveSilo.liveSiloEstimate,
        latestSavedSiloClosing: liveSilo.latestSavedSiloClosing,
        pendingTruckToSilo: liveSilo.pendingTruckToSilo,
        pendingTruckCount: liveSilo.pendingTruckCount,
        pendingInvalidTruckCount: liveSilo.pendingInvalidTruckCount,
        totalGrainAtPlant: latest?.totalGrainAtPlant ?? DEFAULT_SILO,
        cumulativeUnloaded: liveCumulativeUnloaded,
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

// PATCH /api/grain/latest-levels — update just level fields on latest entry
router.patch('/latest-levels', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const yearStart = getCurrentYearStart();
    const latest = await getLastEntry(yearStart);
    if (!latest) return res.status(404).json({ error: 'No grain entry found' });
    const data: any = {};
    const b = req.body;
    for (const f of ['beerWellLevel', 'f1Level', 'f2Level', 'f3Level', 'f4Level', 'pf1Level', 'pf2Level', 'iltLevel', 'fltLevel']) {
      if (b[f] !== undefined) data[f] = b[f] != null ? parseFloat(b[f]) : null;
    }
    const updated = await prisma.grainEntry.update({ where: { id: latest.id }, data });
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/grain/summary
router.get('/summary', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const yearStart = getCurrentYearStart();
    const latest = await getLastEntry(yearStart);
    const cf = getCompanyFilter(req);
    const liveCumulativeUnloaded = await getLiveCumulativeUnloaded(yearStart, cf);
    const liveSilo = await getLiveSiloEstimate(yearStart, cf);
    const recentEntries = await prisma.grainEntry.findMany({
      where: { yearStart },
      orderBy: { date: 'desc' },
      take: 7,
      select: { date: true, siloClosingStock: true, grainConsumed: true, grainUnloaded: true, totalGrainAtPlant: true },
    });
    res.json({
      currentSiloStock: latest?.siloClosingStock ?? DEFAULT_SILO,
      liveSiloEstimate: liveSilo.liveSiloEstimate,
      latestSavedSiloClosing: liveSilo.latestSavedSiloClosing,
      pendingTruckToSilo: liveSilo.pendingTruckToSilo,
      pendingTruckCount: liveSilo.pendingTruckCount,
      pendingInvalidTruckCount: liveSilo.pendingInvalidTruckCount,
      totalGrainAtPlant: latest?.totalGrainAtPlant ?? DEFAULT_SILO,
      grainInProcess: latest?.grainInProcess ?? 0,
      cumulativeUnloaded: liveCumulativeUnloaded,
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
    const { date, grainUnloaded, totalReceived, washConsumed, washConsumedAt, fermentationVolumeAt,
      f1Level, f2Level, f3Level, f4Level, beerWellLevel, pf1Level, pf2Level, iltLevel, fltLevel,
      quarantineStock, flourSilo1Level, flourSilo2Level,
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
      totalReceived: totalReceived || 0,
      washConsumed: washConsumed ?? prev?.washConsumed ?? 0,
      f1Level: resolveLevel(f1Level, prev?.f1Level),
      f2Level: resolveLevel(f2Level, prev?.f2Level),
      f3Level: resolveLevel(f3Level, prev?.f3Level),
      f4Level: resolveLevel(f4Level, prev?.f4Level),
      beerWellLevel: resolveLevel(beerWellLevel, prev?.beerWellLevel),
      pf1Level: resolveLevel(pf1Level, prev?.pf1Level),
      pf2Level: resolveLevel(pf2Level, prev?.pf2Level),
      iltLevel: resolveLevel(iltLevel, prev?.iltLevel),
      fltLevel: resolveLevel(fltLevel, prev?.fltLevel),
      flourSilo1Level: resolveLevel(flourSilo1Level, prev?.flourSilo1Level),
      flourSilo2Level: resolveLevel(flourSilo2Level, prev?.flourSilo2Level),
    };
    const prevWash = prev?.washConsumed ?? 0;
    const calc = calcGrain(inputData, opening, prevCumUnloaded, prevCumConsumed, prevWash, fermPct, pfPct, prev);

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

    // Create/update/delete StockMovement for grain consumption (mirrors fuel pattern)
    try {
      // Deterministic grain item: first RAW_MATERIAL by code (RM-001 preferred)
      const grainItem = await prisma.inventoryItem.findFirst({
        where: { category: 'RAW_MATERIAL', isActive: true },
        orderBy: { code: 'asc' },
        select: { id: true, avgCost: true, unit: true },
      });
      const defaultWh = await prisma.warehouse.findFirst({
        where: { isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true },
      });
      if (grainItem && defaultWh) {
        const dateStr = entryDate.toISOString().slice(0, 10);
        const existingMv = await prisma.stockMovement.findFirst({
          where: { refType: 'GRAIN_CONSUMPTION', refId: entry.id, itemId: grainItem.id },
        });

        if (calc.grainConsumed > 0 && existingMv) {
          // Re-save: adjust by delta
          const delta = calc.grainConsumed - existingMv.quantity;
          if (Math.abs(delta) > 0.001) {
            await prisma.stockMovement.update({
              where: { id: existingMv.id },
              data: { quantity: calc.grainConsumed, totalValue: calc.grainConsumed * (existingMv.costRate || 0) },
            });
            await prisma.inventoryItem.update({
              where: { id: grainItem.id },
              data: { currentStock: { decrement: delta } },
            });
          }
        } else if (calc.grainConsumed > 0 && !existingMv) {
          // First save: create movement + decrement stock
          await prisma.stockMovement.create({
            data: {
              itemId: grainItem.id,
              movementType: 'GRAIN_CONSUMPTION',
              direction: 'OUT',
              quantity: calc.grainConsumed,
              unit: grainItem.unit || 'MT',
              costRate: grainItem.avgCost || 0,
              totalValue: calc.grainConsumed * (grainItem.avgCost || 0),
              warehouseId: defaultWh.id,
              refType: 'GRAIN_CONSUMPTION',
              refId: entry.id,
              refNo: `GRAIN-${dateStr}`,
              narration: 'Daily grain consumption',
              userId: req.user!.id,
              companyId: getActiveCompanyId(req),
            },
          });
          await prisma.inventoryItem.update({
            where: { id: grainItem.id },
            data: { currentStock: { decrement: calc.grainConsumed } },
          });
        } else if (calc.grainConsumed <= 0 && existingMv) {
          // Consumption dropped to zero — reverse old movement and restore stock
          await prisma.inventoryItem.update({
            where: { id: grainItem.id },
            data: { currentStock: { increment: existingMv.quantity } },
          });
          await prisma.stockMovement.delete({ where: { id: existingMv.id } });
        }
      }
    } catch (_e) {
      // Don't fail the daily entry if inventory sync fails
    }

    res.status(201).json(entry);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /api/grain/:id — ADMIN only
router.put('/:id', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { grainUnloaded, totalReceived, washConsumed, washConsumedAt, fermentationVolumeAt,
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
    const { fermPct, pfPct } = await getGrainPcts();

    const inputData = {
      grainUnloaded: grainUnloaded ?? existing.grainUnloaded,
      totalReceived: totalReceived ?? (existing as any).totalReceived ?? 0,
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
    const calc = calcGrain(inputData, opening, prevCumUnloaded, prevCumConsumed, prevWash, fermPct, pfPct, prev);

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

    // Update/create/delete StockMovement for grain consumption (admin edit)
    try {
      const grainItem = await prisma.inventoryItem.findFirst({
        where: { category: 'RAW_MATERIAL', isActive: true },
        orderBy: { code: 'asc' },
        select: { id: true, avgCost: true, unit: true },
      });
      const defaultWh = await prisma.warehouse.findFirst({
        where: { isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true },
      });
      if (grainItem && defaultWh) {
        const dateStr = existing.date.toISOString().slice(0, 10);
        const existingMv = await prisma.stockMovement.findFirst({
          where: { refType: 'GRAIN_CONSUMPTION', refId: entry.id, itemId: grainItem.id },
        });

        if (calc.grainConsumed > 0 && existingMv) {
          const delta = calc.grainConsumed - existingMv.quantity;
          if (Math.abs(delta) > 0.001) {
            await prisma.stockMovement.update({
              where: { id: existingMv.id },
              data: { quantity: calc.grainConsumed, totalValue: calc.grainConsumed * (existingMv.costRate || 0) },
            });
            await prisma.inventoryItem.update({
              where: { id: grainItem.id },
              data: { currentStock: { decrement: delta } },
            });
          }
        } else if (calc.grainConsumed > 0 && !existingMv) {
          await prisma.stockMovement.create({
            data: {
              itemId: grainItem.id,
              movementType: 'GRAIN_CONSUMPTION',
              direction: 'OUT',
              quantity: calc.grainConsumed,
              unit: grainItem.unit || 'MT',
              costRate: grainItem.avgCost || 0,
              totalValue: calc.grainConsumed * (grainItem.avgCost || 0),
              warehouseId: defaultWh.id,
              refType: 'GRAIN_CONSUMPTION',
              refId: entry.id,
              refNo: `GRAIN-${dateStr}`,
              narration: 'Daily grain consumption (admin edit)',
              userId: req.user!.id,
              companyId: getActiveCompanyId(req),
            },
          });
          await prisma.inventoryItem.update({
            where: { id: grainItem.id },
            data: { currentStock: { decrement: calc.grainConsumed } },
          });
        } else if (calc.grainConsumed <= 0 && existingMv) {
          // Consumption dropped to zero — reverse and delete old movement
          await prisma.inventoryItem.update({
            where: { id: grainItem.id },
            data: { currentStock: { increment: existingMv.quantity } },
          });
          await prisma.stockMovement.delete({ where: { id: existingMv.id } });
        }
      }
    } catch (_e) {
      // Don't fail the entry update if inventory sync fails
    }

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
