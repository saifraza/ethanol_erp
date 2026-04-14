/**
 * Backfill silo snapshots from 2600 MT baseline on April 9.
 * Uses actual OPC wash data fetched from production API.
 *
 * Usage: cd backend && node scripts/backfill_silo_snapshots.js
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ---- ACTUAL DATA (from OPC PRV_HR + grain trucks) ----
const BASELINE_DATE = '2026-04-09';
const BASELINE_SILO_MT = 2600;

// Wash distilled from OPC MG_140101 PRV_HR (per shift 9AM→9AM)
const WASH_BY_SHIFT = {
  '2026-04-10': 738.76,   // Shift Apr 9 9AM → Apr 10 9AM
  '2026-04-11': 926.79,   // Shift Apr 10 9AM → Apr 11 9AM
  '2026-04-12': 1645.05,  // Shift Apr 11 9AM → Apr 12 9AM
};

function r2(n) { return Math.round(n * 100) / 100; }

async function run() {
  const s = await prisma.settings.findFirst();
  const grainPct = (s?.grainPercent ?? 31) / 100;
  console.log('Grain %:', (grainPct * 100).toFixed(1) + '%');

  // Get today's snapshot for OPC tank data (to preserve on rewrite)
  const todaySnap = await prisma.siloSnapshot.findUnique({
    where: { date: new Date('2026-04-12T00:00:00.000Z') },
  });

  // Delete all existing snapshots in range
  const allDates = [BASELINE_DATE, '2026-04-10', '2026-04-11', '2026-04-12'];
  for (const d of allDates) {
    await prisma.siloSnapshot.deleteMany({ where: { date: new Date(d + 'T00:00:00.000Z') } });
  }
  console.log('Deleted existing snapshots for', allDates.join(', '));

  // Create baseline
  const baselineDate = new Date(BASELINE_DATE + 'T00:00:00.000Z');
  await prisma.siloSnapshot.create({
    data: {
      date: baselineDate,
      source: 'BASELINE',
      grainPctUsed: grainPct,
      grainInSystem: todaySnap?.grainInSystem ?? 0,
      siloOpening: BASELINE_SILO_MT,
      siloClosing: BASELINE_SILO_MT,
      cumReceived: 0,
      cumConsumed: 0,
      remarks: 'Baseline — 2600 MT known silo stock',
    },
  });
  console.log('\n=== Baseline:', BASELINE_DATE, '=', BASELINE_SILO_MT, 'MT ===');

  let prevSnap = await prisma.siloSnapshot.findUnique({ where: { date: baselineDate } });

  for (const dateStr of ['2026-04-10', '2026-04-11', '2026-04-12']) {
    const shiftDate = new Date(dateStr + 'T00:00:00.000Z');
    const shiftEndUTC = new Date(dateStr + 'T03:30:00.000Z');
    const shiftStartUTC = new Date(shiftEndUTC.getTime() - 24 * 3600 * 1000);

    // Grain trucks
    const agg = await prisma.grainTruck.aggregate({
      _sum: { weightNet: true }, _count: true,
      where: { createdAt: { gte: shiftStartUTC, lt: shiftEndUTC }, cancelled: false },
    });
    const receivedMT = r2(agg._sum?.weightNet ?? 0);
    const truckCount = agg._count ?? 0;

    // Wash from OPC data
    const washDistilledKL = r2(WASH_BY_SHIFT[dateStr] || 0);
    const grainDistilled = r2(washDistilledKL * grainPct);
    const grainConsumed = r2(Math.max(0, grainDistilled));

    const siloOpening = prevSnap.siloClosing;
    const siloClosing = r2(siloOpening + receivedMT - grainConsumed);
    const cumReceived = r2((prevSnap.cumReceived ?? 0) + receivedMT);
    const cumConsumed = r2((prevSnap.cumConsumed ?? 0) + grainConsumed);

    // For today, preserve OPC tank level data
    const tankData = dateStr === '2026-04-12' && todaySnap ? {
      f1Level: todaySnap.f1Level, f2Level: todaySnap.f2Level,
      f3Level: todaySnap.f3Level, f4Level: todaySnap.f4Level,
      beerWellLevel: todaySnap.beerWellLevel,
      pf1Level: todaySnap.pf1Level, pf2Level: todaySnap.pf2Level,
      iltLevel: todaySnap.iltLevel, fltLevel: todaySnap.fltLevel,
      totalVolumeKL: todaySnap.totalVolumeKL,
      grainInSystem: todaySnap.grainInSystem,
      opcDataAge: todaySnap.opcDataAge,
    } : {};

    const snap = await prisma.siloSnapshot.create({
      data: {
        date: shiftDate,
        source: 'AUTO',
        ...tankData,
        washDistilledKL,
        grainPctUsed: grainPct,
        grainInSystem: tankData.grainInSystem ?? (todaySnap?.grainInSystem ?? 0),
        deltaGrainInSystem: 0,
        grainDistilled,
        grainConsumed,
        grainReceivedMT: receivedMT,
        truckCount,
        siloOpening,
        siloClosing,
        cumReceived,
        cumConsumed,
        remarks: dateStr === '2026-04-12' ? 'Recomputed with baseline + OPC wash' : 'Backfilled from OPC wash + truck data',
      },
    });

    console.log(`\n${dateStr}: ${siloOpening.toFixed(1)} + ${receivedMT} (${truckCount} trucks) - ${grainConsumed} (wash=${washDistilledKL} KL) = ${siloClosing.toFixed(1)} MT`);
    prevSnap = snap;
  }

  console.log(`\n=== Final silo stock: ${prevSnap.siloClosing} MT ===`);
}

run()
  .catch(e => { console.error('FATAL:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
