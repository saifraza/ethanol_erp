/**
 * Silo Snapshot Job — Auto-computes grain silo stock daily at 9 AM IST
 *
 * Uses OPC tank level readings + wash flow meter + GrainTruck weighments
 * to compute grain consumed from silos via conservation of mass:
 *
 *   grain_in_system = (F1+F2+F3+F4+BW+ILT+FLT) × grain%
 *   grain_consumed  = wash_distilled × grain% + Δ(grain_in_system)
 *   silo_closing    = silo_opening + grain_received - grain_consumed
 *
 * Runs via setInterval, checks every 60s if IST hour=9 and no snapshot for today.
 */

import prisma from '../config/prisma';

const CHECK_INTERVAL_MS = 60 * 1000; // check every 60s
const INITIAL_DELAY_MS = 3 * 60 * 1000; // wait 3 min after startup
let jobInterval: NodeJS.Timeout | null = null;
let lastRunDate = ''; // YYYY-MM-DD IST — prevents duplicate runs

// OPC tag → tank mapping
const TANK_TAGS: Record<string, string> = {
  LT130201: 'f1',
  LT130202: 'f2',
  LT130301: 'f3',
  LT130302: 'f4',
  LT130401: 'beerWell',
  LT130101: 'pf1',
  LT130102: 'pf2',
  LT_120103: 'ilt',
  LT_120102: 'flt',
};
const WASH_FEED_TAG = 'MG_140101';
const WASH_FEED_FALLBACK = 'FCV_140101';
const LEVEL_PROPERTY = 'IO_VALUE';

function nowIST(): Date {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

function istDateStr(d?: Date): string {
  const ist = d || nowIST();
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`;
}

function getShiftBoundaries() {
  const now = new Date();
  const ist = nowIST();
  const istHour = ist.getUTCHours();

  // Most recent 9 AM IST boundary
  const shiftEnd = new Date(ist);
  if (istHour < 9) {
    shiftEnd.setUTCDate(shiftEnd.getUTCDate() - 1);
  }
  shiftEnd.setUTCHours(9, 0, 0, 0);
  const shiftEndUTC = new Date(shiftEnd.getTime() - 5.5 * 3600 * 1000);

  // 24h earlier
  const shiftStartUTC = new Date(shiftEndUTC.getTime() - 24 * 3600 * 1000);

  return { shiftStartUTC, shiftEndUTC, now };
}

function getOpcPrisma() {
  if (!process.env.DATABASE_URL_OPC) {
    throw new Error('DATABASE_URL_OPC not configured');
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PrismaClient } = require('@prisma/opc-client');
  return new PrismaClient();
}

interface TankLevels {
  f1: number; f2: number; f3: number; f4: number;
  beerWell: number; pf1: number; pf2: number;
  ilt: number; flt: number;
  dataAge: number | null;
}

async function readTankLevels(opc: any): Promise<TankLevels> {
  const tagNames = Object.keys(TANK_TAGS);
  const readings = await opc.opcReading.findMany({
    where: { tag: { in: tagNames }, property: LEVEL_PROPERTY },
    orderBy: { scannedAt: 'desc' },
    take: tagNames.length * 2,
    select: { tag: true, value: true, scannedAt: true },
  });

  // Keep latest per tag
  const latestByTag = new Map<string, { value: number; scannedAt: Date }>();
  for (const r of readings) {
    if (!latestByTag.has(r.tag)) {
      latestByTag.set(r.tag, { value: r.value, scannedAt: r.scannedAt });
    }
  }

  const levels: any = { f1: 0, f2: 0, f3: 0, f4: 0, beerWell: 0, pf1: 0, pf2: 0, ilt: 0, flt: 0, dataAge: null };
  let oldestReading: Date | null = null;

  for (const [tag, field] of Object.entries(TANK_TAGS)) {
    const reading = latestByTag.get(tag);
    if (reading) {
      levels[field] = reading.value; // still in % — convert later
      if (!oldestReading || reading.scannedAt < oldestReading) {
        oldestReading = reading.scannedAt;
      }
    }
  }

  if (oldestReading) {
    levels.dataAge = Math.round((Date.now() - oldestReading.getTime()) / 1000);
  }

  return levels as TankLevels;
}

async function readWashDistilled(opc: any, startUTC: Date, endUTC: Date): Promise<number> {
  // Try MG_140101 PRV_HR first (DCS totalizer — most accurate)
  let readings = await opc.opcHourlyReading.findMany({
    where: { tag: WASH_FEED_TAG, property: 'PRV_HR', hour: { gte: startUTC, lt: endUTC } },
    orderBy: { hour: 'asc' },
    select: { avg: true },
  });

  if (readings.length === 0) {
    // Fallback: FCV_140101 PV (control valve flow rate × 1 hr)
    readings = await opc.opcHourlyReading.findMany({
      where: { tag: WASH_FEED_FALLBACK, property: 'PV', hour: { gte: startUTC, lt: endUTC } },
      orderBy: { hour: 'asc' },
      select: { avg: true },
    });
  }

  if (readings.length === 0) return 0;
  return readings.reduce((sum: number, r: { avg: number }) => sum + r.avg, 0);
}

async function getCapacities(): Promise<Record<string, number>> {
  const s = await prisma.settings.findFirst();
  return {
    f1: (s as any)?.fermenter1Cap ?? 2300,
    f2: (s as any)?.fermenter2Cap ?? 2300,
    f3: (s as any)?.fermenter3Cap ?? 2300,
    f4: (s as any)?.fermenter4Cap ?? 2300,
    beerWell: (s as any)?.beerWellCap ?? 430,
    pf1: 430,
    pf2: 430,
    ilt: (s as any)?.iltCap ?? 190,
    flt: (s as any)?.fltCap ?? 440,
  };
}

async function getGrainPct(): Promise<number> {
  const s = await prisma.settings.findFirst();
  return ((s as any)?.grainPercent ?? 32) / 100;
}

function r2(n: number) { return Math.round(n * 100) / 100; }

export async function computeSnapshot(opts?: { force?: boolean }): Promise<void> {
  const force = opts?.force ?? false;
  const opc = getOpcPrisma();

  try {
    const { shiftStartUTC, shiftEndUTC } = getShiftBoundaries();
    const grainPct = await getGrainPct();
    const caps = await getCapacities();

    // Shift date: the date of the shift END (9 AM today)
    const shiftDateIST = new Date(shiftEndUTC.getTime() + 5.5 * 3600 * 1000);
    const shiftDate = new Date(Date.UTC(
      shiftDateIST.getUTCFullYear(),
      shiftDateIST.getUTCMonth(),
      shiftDateIST.getUTCDate(),
      0, 0, 0, 0,
    ));

    // Idempotency: skip if AUTO snapshot already exists (unless force=true)
    const existing = await prisma.siloSnapshot.findUnique({ where: { date: shiftDate } });
    if (existing && !force) {
      console.log(`[Silo Snapshot] Already exists for ${istDateStr(shiftDateIST)}, skipping (use force to override)`);
      return;
    }

    // 1. Read tank levels from OPC (% values)
    const pctLevels = await readTankLevels(opc);

    // 2. Convert % → KL
    const f1Level = r2((pctLevels.f1 / 100) * caps.f1);
    const f2Level = r2((pctLevels.f2 / 100) * caps.f2);
    const f3Level = r2((pctLevels.f3 / 100) * caps.f3);
    const f4Level = r2((pctLevels.f4 / 100) * caps.f4);
    const beerWellLevel = r2((pctLevels.beerWell / 100) * caps.beerWell);
    const pf1Level = r2((pctLevels.pf1 / 100) * caps.pf1);
    const pf2Level = r2((pctLevels.pf2 / 100) * caps.pf2);
    const iltLevel = r2((pctLevels.ilt / 100) * caps.ilt);
    const fltLevel = r2((pctLevels.flt / 100) * caps.flt);
    const totalVolumeKL = r2(f1Level + f2Level + f3Level + f4Level + beerWellLevel + pf1Level + pf2Level + iltLevel + fltLevel);

    // 3. Read 24h wash distilled from flow meter
    const washDistilledKL = r2(await readWashDistilled(opc, shiftStartUTC, shiftEndUTC));

    // 4. Previous snapshot — exclude today's entry so baseline→auto works same day
    const prev = await prisma.siloSnapshot.findFirst({
      where: { date: { lt: shiftDate } },
      orderBy: { date: 'desc' },
    });

    // If existing is BASELINE and we're forcing, use baseline's siloClosing as opening
    const baselineOpening = (existing?.source === 'BASELINE') ? existing.siloClosing : null;
    const hasPrev = !!(existing?.source === 'BASELINE' ? existing : prev);

    // Flour silos — carry forward from previous or existing baseline
    const flourSrc = existing ?? prev;
    const flourSilo1Level = flourSrc?.flourSilo1Level ?? 0;
    const flourSilo2Level = flourSrc?.flourSilo2Level ?? 0;
    const flourTotal = r2(flourSilo1Level + flourSilo2Level);
    const prevFlourTotal = prev?.flourTotal ?? flourTotal; // no prev → delta=0
    const deltaFlour = hasPrev ? r2(flourTotal - prevFlourTotal) : 0;

    // 5. Grain math
    const grainInSystem = r2(totalVolumeKL * grainPct);
    const grainDistilled = r2(washDistilledKL * grainPct);

    // For delta, compare against previous day's snapshot (or baseline's captured grainInSystem)
    // If no previous snapshot exists at all, delta must be 0 — we can't assume all tank
    // contents were consumed today. User must set a baseline first for meaningful data.
    const prevGrainInSystem = existing?.source === 'BASELINE'
      ? existing.grainInSystem  // baseline captured tank levels at time of setting
      : (prev?.grainInSystem ?? grainInSystem); // no prev → assume same → delta=0
    const deltaGrainInSystem = hasPrev ? r2(grainInSystem - prevGrainInSystem) : 0;

    // Grain consumed = wash distilled × grain% (what was actually used in production).
    // Tank delta (grain entering/leaving fermenters) adjusts silo closing separately.
    // Previous formula folded delta into consumed, causing consumed=0 when tanks drained
    // faster than distillation — confusing for plant managers.
    const grainConsumed = r2(grainDistilled);
    const siloOpening = baselineOpening ?? prev?.siloClosing ?? 0;

    // 6. Grain received from trucks within shift window (avoids double-counting)
    const truckAgg = await prisma.grainTruck.aggregate({
      _sum: { weightNet: true },
      _count: true,
      where: {
        createdAt: { gte: shiftStartUTC, lt: shiftEndUTC },
        cancelled: false,
      },
    });
    const grainReceivedMT = r2((truckAgg._sum?.weightNet) ?? 0); // weightNet already in MT
    const truckCount = truckAgg._count ?? 0;

    // 7. Silo closing — uses full mass balance: consumed + tank delta + flour delta
    // silo_closing = opening + received - (distilled + Δtanks + Δflour), clamped so outflow ≥ 0
    const siloOutflow = r2(Math.max(0, grainDistilled + deltaGrainInSystem + deltaFlour));
    const siloClosing = r2(siloOpening + grainReceivedMT - siloOutflow);

    // 8. Cumulatives
    const cumReceived = r2((prev?.cumReceived ?? 0) + grainReceivedMT);
    const cumConsumed = r2((prev?.cumConsumed ?? 0) + grainConsumed);

    const snapshotData = {
      source: 'AUTO' as const,
      f1Level, f2Level, f3Level, f4Level,
      beerWellLevel, pf1Level, pf2Level, iltLevel, fltLevel,
      totalVolumeKL,
      flourSilo1Level, flourSilo2Level, flourTotal,
      washDistilledKL,
      grainPctUsed: grainPct,
      grainInSystem,
      deltaGrainInSystem,
      grainDistilled,
      grainConsumed,
      grainReceivedMT,
      truckCount,
      siloOpening,
      siloClosing,
      cumReceived,
      cumConsumed,
      opcDataAge: pctLevels.dataAge,
    };

    // 9. Save — upsert so manual trigger overwrites baseline/stale auto
    await prisma.siloSnapshot.upsert({
      where: { date: shiftDate },
      create: { date: shiftDate, ...snapshotData },
      update: snapshotData,
    });

    console.log(`[Silo Snapshot] ${existing ? 'Updated' : 'Created'} for ${istDateStr(shiftDateIST)}: closing=${siloClosing} MT, consumed=${grainConsumed} MT, received=${grainReceivedMT} MT, wash=${washDistilledKL} KL`);
  } finally {
    await opc.$disconnect();
  }
}

async function checkAndRun(): Promise<void> {
  try {
    const ist = nowIST();
    const istHour = ist.getUTCHours();
    const todayStr = istDateStr(ist);

    // Only run at 9 AM IST, once per day
    if (istHour !== 9 || lastRunDate === todayStr) return;

    console.log('[Silo Snapshot] 9 AM IST — running daily snapshot...');
    await computeSnapshot();
    lastRunDate = todayStr; // set AFTER success so failure allows retry
  } catch (err) {
    console.error('[Silo Snapshot] Failed:', (err as Error).message);
  }
}

export function startSiloSnapshotJob(): void {
  if (jobInterval) return;
  setTimeout(() => {
    checkAndRun().catch(() => {});
    jobInterval = setInterval(() => {
      checkAndRun().catch(() => {});
    }, CHECK_INTERVAL_MS);
  }, INITIAL_DELAY_MS);
  console.log('[Silo Snapshot] Started (checks every 60s for 9 AM IST trigger, first check in 3 min)');
}
