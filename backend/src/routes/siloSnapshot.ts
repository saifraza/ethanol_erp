import { Router, Response } from 'express';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { z } from 'zod';
import prisma from '../config/prisma';

const router = Router();

function r2(n: number) { return Math.round(n * 100) / 100; }

// GET / — List snapshots (paginated)
router.get('/', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const take = Math.min(parseInt(req.query.limit as string) || 30, 100);
  const skip = parseInt(req.query.offset as string) || 0;

  const [snapshots, total] = await Promise.all([
    prisma.siloSnapshot.findMany({
      take, skip,
      orderBy: { date: 'desc' },
    }),
    prisma.siloSnapshot.count(),
  ]);

  // Join with ethanol production by date for yield calculation
  if (snapshots.length > 0) {
    const minDate = snapshots[snapshots.length - 1].date;
    const maxDate = new Date(snapshots[0].date.getTime() + 24 * 3600 * 1000);
    const ethanolEntries = await prisma.ethanolProductEntry.findMany({
      where: { date: { gte: minDate, lt: maxDate } },
      select: { date: true, productionAL: true, productionBL: true },
      orderBy: { date: 'asc' },
    });
    // Group ethanol by date string
    const ethanolByDate = new Map<string, { al: number; bl: number }>();
    for (const e of ethanolEntries) {
      const key = e.date.toISOString().split('T')[0];
      const existing = ethanolByDate.get(key) || { al: 0, bl: 0 };
      existing.al += Math.max(0, e.productionAL || 0);
      existing.bl += Math.max(0, e.productionBL || 0);
      ethanolByDate.set(key, existing);
    }
    const items = snapshots.map(s => {
      const key = s.date.toISOString().split('T')[0];
      const eth = ethanolByDate.get(key);
      const ethanolAL = r2(eth?.al ?? 0);
      const yieldALPerMT = s.grainConsumed > 0 ? r2(ethanolAL / s.grainConsumed) : 0;
      return { ...s, ethanolAL, yieldALPerMT };
    });
    return res.json({ items, total });
  }

  res.json({ items: snapshots, total });
}));

// GET /latest — Latest snapshot + live estimate (snapshot + pending trucks since)
router.get('/latest', authenticate, asyncHandler(async (_req: AuthRequest, res: Response) => {
  const snapshot = await prisma.siloSnapshot.findFirst({
    orderBy: { date: 'desc' },
  });

  if (!snapshot) {
    return res.json({ snapshot: null, live: null });
  }

  // Pending trucks since last snapshot
  // Previous snapshot + its ethanol data for "last complete day" yield
  const [truckAgg, ethanolEntries, prevSnapshot] = await Promise.all([
    prisma.grainTruck.aggregate({
      _sum: { weightNet: true },
      _count: true,
      where: {
        createdAt: { gt: snapshot.date },
        cancelled: false,
      },
    }),
    // Match ethanol production for same date (daily dip reading)
    prisma.ethanolProductEntry.findMany({
      where: {
        date: {
          gte: snapshot.date,
          lt: new Date(snapshot.date.getTime() + 24 * 3600 * 1000),
        },
      },
      select: { productionBL: true, productionAL: true, avgStrength: true },
    }),
    // Previous day's snapshot for fallback yield
    prisma.siloSnapshot.findFirst({
      where: { date: { lt: snapshot.date } },
      orderBy: { date: 'desc' },
    }),
  ]);
  const pendingTrucksMT = r2((truckAgg._sum?.weightNet) ?? 0);
  const pendingTruckCount = truckAgg._count ?? 0;

  // Ethanol yield: AL produced per MT grain consumed
  const ethanolProductionBL = ethanolEntries.reduce((s, e) => s + Math.max(0, e.productionBL || 0), 0);
  const ethanolProductionAL = ethanolEntries.reduce((s, e) => s + Math.max(0, e.productionAL || 0), 0);
  const ethanolAvgStrength = ethanolEntries.filter(e => e.avgStrength > 0).length > 0
    ? ethanolEntries.filter(e => e.avgStrength > 0).reduce((s, e) => s + e.avgStrength, 0) / ethanolEntries.filter(e => e.avgStrength > 0).length
    : 0;

  // Yield always uses previous day's data — today's production is incomplete
  // until tomorrow's dip reading is entered
  let yieldALPerMT = 0;
  let yieldProductionAL = 0;
  let yieldGrainConsumed = 0;
  if (prevSnapshot && prevSnapshot.grainConsumed > 0) {
    const prevEthanol = await prisma.ethanolProductEntry.findMany({
      where: {
        date: {
          gte: prevSnapshot.date,
          lt: new Date(prevSnapshot.date.getTime() + 24 * 3600 * 1000),
        },
      },
      select: { productionAL: true },
    });
    const prevAL = prevEthanol.reduce((s, e) => s + Math.max(0, e.productionAL || 0), 0);
    if (prevAL > 0) {
      yieldALPerMT = r2(prevAL / prevSnapshot.grainConsumed);
      yieldProductionAL = prevAL;
      yieldGrainConsumed = prevSnapshot.grainConsumed;
    }
  }

  const siloEstimate = r2(snapshot.siloClosing + pendingTrucksMT);
  const snapshotAgeMs = Date.now() - snapshot.date.getTime();
  const snapshotAgeH = Math.floor(snapshotAgeMs / 3600000);
  const snapshotAgeM = Math.floor((snapshotAgeMs % 3600000) / 60000);

  res.json({
    snapshot,
    ethanol: {
      productionBL: r2(ethanolProductionBL),
      productionAL: r2(ethanolProductionAL),
      avgStrength: r2(ethanolAvgStrength),
      yieldALPerMT,
      yieldProductionAL: r2(yieldProductionAL),
      yieldGrainConsumed: r2(yieldGrainConsumed),
    },
    live: {
      siloEstimate,
      pendingTrucksMT,
      pendingTruckCount,
      snapshotAge: `${snapshotAgeH}h ${snapshotAgeM}m`,
    },
  });
}));

// GET /live-tanks — Current OPC tank levels (% and KL) for gauge display
router.get('/live-tanks', authenticate, asyncHandler(async (_req: AuthRequest, res: Response) => {
  if (!process.env.DATABASE_URL_OPC) {
    return res.json({ tanks: [], opcOnline: false });
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PrismaClient } = require('@prisma/opc-client');
  const opc = new PrismaClient();

  try {
    const TAGS: Record<string, { label: string; capField: string }> = {
      LT130101: { label: 'PF1', capField: 'pfCap' },
      LT130102: { label: 'PF2', capField: 'pfCap' },
      LT130201: { label: 'F1', capField: 'fermenter1Cap' },
      LT130202: { label: 'F2', capField: 'fermenter2Cap' },
      LT130301: { label: 'F3', capField: 'fermenter3Cap' },
      LT130302: { label: 'F4', capField: 'fermenter4Cap' },
      LT130401: { label: 'Beer Well', capField: 'beerWellCap' },
      LT_120103: { label: 'ILT', capField: 'iltCap' },
      LT_120102: { label: 'FLT', capField: 'fltCap' },
    };

    const settings = await prisma.settings.findFirst();
    const caps: Record<string, number> = {
      pfCap: (settings as any)?.pfCap ?? 430,
      fermenter1Cap: (settings as any)?.fermenter1Cap ?? 2300,
      fermenter2Cap: (settings as any)?.fermenter2Cap ?? 2300,
      fermenter3Cap: (settings as any)?.fermenter3Cap ?? 2300,
      fermenter4Cap: (settings as any)?.fermenter4Cap ?? 2300,
      beerWellCap: (settings as any)?.beerWellCap ?? 430,
      iltCap: (settings as any)?.iltCap ?? 190,
      fltCap: (settings as any)?.fltCap ?? 440,
    };

    const tagNames = Object.keys(TAGS);
    const readings = await opc.opcReading.findMany({
      where: { tag: { in: tagNames }, property: 'IO_VALUE' },
      orderBy: { scannedAt: 'desc' },
      take: tagNames.length * 2,
      select: { tag: true, value: true, scannedAt: true },
    });

    const latestByTag = new Map<string, { value: number; scannedAt: Date }>();
    for (const r of readings) {
      if (!latestByTag.has(r.tag)) {
        latestByTag.set(r.tag, { value: r.value, scannedAt: r.scannedAt });
      }
    }

    const tanks = Object.entries(TAGS).map(([tag, { label, capField }]) => {
      const reading = latestByTag.get(tag);
      const pct = reading?.value ?? 0;
      const cap = caps[capField] ?? 0;
      const kl = r2((pct / 100) * cap);
      return {
        tag,
        label,
        pct: r2(pct),
        kl,
        capacityKL: cap,
        updatedAt: reading?.scannedAt?.toISOString() ?? null,
      };
    });

    const oldestReading = readings.length > 0
      ? Math.min(...readings.map((r: { scannedAt: Date }) => r.scannedAt.getTime()))
      : null;
    const opcOnline = oldestReading ? (Date.now() - oldestReading) < 10 * 60 * 1000 : false;

    res.json({ tanks, opcOnline });
  } finally {
    await opc.$disconnect();
  }
}));

// POST /baseline — Set manual baseline silo stock (first entry)
const baselineSchema = z.object({
  siloClosingMT: z.number().min(0),
  date: z.string().optional(), // ISO date, defaults to today
  remarks: z.string().optional(),
});

router.post('/baseline', authenticate, validate(baselineSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { siloClosingMT, date: dateStr, remarks } = req.body;

  const date = dateStr ? new Date(dateStr) : new Date(Date.UTC(
    new Date().getFullYear(),
    new Date().getMonth(),
    new Date().getDate(),
    0, 0, 0, 0,
  ));

  // Read current OPC levels if available
  let f1Level = 0, f2Level = 0, f3Level = 0, f4Level = 0;
  let beerWellLevel = 0, pf1Level = 0, pf2Level = 0, iltLevel = 0, fltLevel = 0;
  let totalVolumeKL = 0, grainInSystem = 0;

  const grainPct = await getGrainPct();

  if (process.env.DATABASE_URL_OPC) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { PrismaClient } = require('@prisma/opc-client');
      const opc = new PrismaClient();
      const caps = await getCapacities();
      const tagNames = ['LT130201', 'LT130202', 'LT130301', 'LT130302', 'LT130401', 'LT130101', 'LT130102', 'LT_120103', 'LT_120102'];
      const readings = await opc.opcReading.findMany({
        where: { tag: { in: tagNames }, property: 'IO_VALUE' },
        orderBy: { scannedAt: 'desc' },
        take: tagNames.length * 2,
        select: { tag: true, value: true },
      });
      const latest = new Map<string, number>();
      for (const r of readings) {
        if (!latest.has(r.tag)) latest.set(r.tag, r.value);
      }
      f1Level = r2(((latest.get('LT130201') ?? 0) / 100) * caps.f1);
      f2Level = r2(((latest.get('LT130202') ?? 0) / 100) * caps.f2);
      f3Level = r2(((latest.get('LT130301') ?? 0) / 100) * caps.f3);
      f4Level = r2(((latest.get('LT130302') ?? 0) / 100) * caps.f4);
      beerWellLevel = r2(((latest.get('LT130401') ?? 0) / 100) * caps.beerWell);
      pf1Level = r2(((latest.get('LT130101') ?? 0) / 100) * caps.pf1);
      pf2Level = r2(((latest.get('LT130102') ?? 0) / 100) * caps.pf2);
      iltLevel = r2(((latest.get('LT_120103') ?? 0) / 100) * caps.ilt);
      fltLevel = r2(((latest.get('LT_120102') ?? 0) / 100) * caps.flt);
      totalVolumeKL = r2(f1Level + f2Level + f3Level + f4Level + beerWellLevel + pf1Level + pf2Level + iltLevel + fltLevel);
      grainInSystem = r2(totalVolumeKL * grainPct);
      await opc.$disconnect();
    } catch (err) {
      console.warn('[Silo Baseline] OPC read failed, using zeros:', (err as Error).message);
    }
  }

  // Upsert baseline
  const snapshot = await prisma.siloSnapshot.upsert({
    where: { date },
    create: {
      date,
      source: 'BASELINE',
      f1Level, f2Level, f3Level, f4Level,
      beerWellLevel, pf1Level, pf2Level, iltLevel, fltLevel,
      totalVolumeKL,
      grainPctUsed: grainPct,
      grainInSystem,
      siloOpening: siloClosingMT,
      siloClosing: siloClosingMT,
      remarks: remarks || 'Manual baseline',
    },
    update: {
      source: 'BASELINE',
      f1Level, f2Level, f3Level, f4Level,
      beerWellLevel, pf1Level, pf2Level, iltLevel, fltLevel,
      totalVolumeKL,
      grainPctUsed: grainPct,
      grainInSystem,
      siloOpening: siloClosingMT,
      siloClosing: siloClosingMT,
      remarks: remarks || 'Manual baseline (updated)',
    },
  });

  res.status(201).json(snapshot);
}));

// POST /trigger — Manually trigger a snapshot now (force=true overwrites existing)
router.post('/trigger', authenticate, asyncHandler(async (_req: AuthRequest, res: Response) => {
  const { computeSnapshot } = await import('../services/siloSnapshotJob');
  await computeSnapshot({ force: true });
  const latest = await prisma.siloSnapshot.findFirst({ orderBy: { date: 'desc' } });
  res.json({ message: 'Snapshot triggered', snapshot: latest });
}));

// PUT /flour — Update flour silo levels on the latest snapshot (manual input)
const flourSchema = z.object({
  flourSilo1Level: z.number().min(0),
  flourSilo2Level: z.number().min(0),
});

router.put('/flour', authenticate, validate(flourSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { flourSilo1Level, flourSilo2Level } = req.body;
  const flourTotal = r2(flourSilo1Level + flourSilo2Level);

  const latest = await prisma.siloSnapshot.findFirst({ orderBy: { date: 'desc' } });
  if (!latest) {
    return res.status(404).json({ error: 'No snapshot exists yet — set baseline first' });
  }

  const updated = await prisma.siloSnapshot.update({
    where: { id: latest.id },
    data: { flourSilo1Level, flourSilo2Level, flourTotal },
  });

  res.json(updated);
}));

// PUT /:id — Override/correct a snapshot
const overrideSchema = z.object({
  siloClosing: z.number().optional(),
  remarks: z.string().optional(),
});

router.put('/:id', authenticate, validate(overrideSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { siloClosing, remarks } = req.body;

  const updated = await prisma.siloSnapshot.update({
    where: { id },
    data: {
      ...(siloClosing !== undefined ? { siloClosing, source: 'OVERRIDE' } : {}),
      ...(remarks !== undefined ? { remarks } : {}),
    },
  });

  res.json(updated);
}));

// --- helpers ---
async function getGrainPct(): Promise<number> {
  const s = await prisma.settings.findFirst();
  return ((s as any)?.grainPercent ?? 31) / 100;
}

async function getCapacities(): Promise<Record<string, number>> {
  const s = await prisma.settings.findFirst();
  return {
    f1: (s as any)?.fermenter1Cap ?? 2300,
    f2: (s as any)?.fermenter2Cap ?? 2300,
    f3: (s as any)?.fermenter3Cap ?? 2300,
    f4: (s as any)?.fermenter4Cap ?? 2300,
    beerWell: (s as any)?.beerWellCap ?? 430,
    ilt: (s as any)?.iltCap ?? 190,
    flt: (s as any)?.fltCap ?? 440,
  };
}

export default router;
