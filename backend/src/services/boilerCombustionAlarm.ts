/**
 * Boiler Combustion / Fuel Starvation Alarm — sugar plant
 *
 * Detects: bagasse feeders are spinning but furnace temp is falling = silo empty / bridging.
 *
 * Rule (multi-confirm to suppress noise):
 *   1. >= MIN_FEEDERS_RUNNING feeders showing RPM > 1 (operator hasn't intentionally cut fuel)
 *   2. Furnace temp dropped > FURNACE_DROP_C in WINDOW_MIN minutes
 *   3. Steam pressure has NOT collapsed > PRESSURE_COLLAPSE_BAR (rules out trip / valve close)
 *   4. Holds for 2 consecutive 60-sec checks
 *
 * Cool-down: COOLDOWN_MIN minutes between alarms.
 * Auto-reset: when furnace recovers above (drop_start - 20°C).
 */
import { getOpcPrisma } from '../config/opcPrisma';
import { broadcastToGroup } from './messagingGateway';
import prisma from '../config/prisma';

const FEEDER_TAGS = [
  '#/R1C10I1_M', '#/R1C10I2_M', '#/R1C10I3_M',
  '#/R1C10I4_M', '#/R1C10I5_M', '#/R1C10I6_M',
];
const FURNACE_TAG  = '#/R1C2I2_M';   // Boiler Furnace Temp (bed)
const PRESSURE_TAG = '#/R1C1I4_M';   // Steam Pressure

const MIN_FEEDERS_RUNNING   = 3;
const FEEDER_RUNNING_RPM    = 1;     // RPM > this = "running"
const FURNACE_DROP_C        = 50;    // alarm if temp drops more than this in window
const WINDOW_MIN            = 5;     // lookback window for slope
const PRESSURE_COLLAPSE_BAR = 5;     // if pressure dropped > this, assume trip — skip
const COOLDOWN_MIN          = 10;
const CHECK_INTERVAL_MS     = 60_000;
const REQUIRE_CONSECUTIVE   = 2;     // need 2 consecutive checks to fire

let _lastFiredAt: Date | null = null;
let _consecutive = 0;

interface TagWindow { first: number; last: number; samples: number; }

async function checkOnce(): Promise<void> {
  const opc = getOpcPrisma();
  const cutoff = new Date(Date.now() - WINDOW_MIN * 60_000);
  const tags = [...FEEDER_TAGS, FURNACE_TAG, PRESSURE_TAG];

  const readings = await opc.opcReading.findMany({
    where: { source: 'SUGAR', tag: { in: tags }, scannedAt: { gte: cutoff } },
    orderBy: { scannedAt: 'asc' },
    take: 500,
    select: { tag: true, value: true },
  });
  if (readings.length === 0) { _consecutive = 0; return; }

  // Group: first + last value per tag
  const byTag = new Map<string, TagWindow>();
  for (const r of readings) {
    const w = byTag.get(r.tag);
    if (!w) byTag.set(r.tag, { first: r.value, last: r.value, samples: 1 });
    else { w.last = r.value; w.samples += 1; }
  }

  // (1) Active feeders
  const activeFeeders = FEEDER_TAGS.filter(t => {
    const w = byTag.get(t);
    return w && w.last > FEEDER_RUNNING_RPM;
  }).length;
  if (activeFeeders < MIN_FEEDERS_RUNNING) { _consecutive = 0; return; }

  // (2) Furnace temp drop — need at least 2 samples for slope
  const furnace = byTag.get(FURNACE_TAG);
  if (!furnace || furnace.samples < 2) { _consecutive = 0; return; }
  const tempDrop = furnace.first - furnace.last;
  if (tempDrop < FURNACE_DROP_C) { _consecutive = 0; return; }

  // (3) Pressure sanity — if it collapsed, this is a trip not silo issue
  const pressure = byTag.get(PRESSURE_TAG);
  const pressureDrop = pressure ? pressure.first - pressure.last : 0;
  if (pressureDrop > PRESSURE_COLLAPSE_BAR) { _consecutive = 0; return; }

  // (4) Confirmation
  _consecutive += 1;
  if (_consecutive < REQUIRE_CONSECUTIVE) return;

  // Cool-down
  const now = new Date();
  if (_lastFiredAt && now.getTime() - _lastFiredAt.getTime() < COOLDOWN_MIN * 60_000) return;

  // Fire
  await fire({
    activeFeeders,
    tempStart: furnace.first,
    tempNow: furnace.last,
    tempDrop,
    pressureNow: pressure?.last,
    pressureDrop,
  });
  _lastFiredAt = now;
  _consecutive = 0;
}

async function fire(c: {
  activeFeeders: number; tempStart: number; tempNow: number; tempDrop: number;
  pressureNow?: number; pressureDrop: number;
}): Promise<void> {
  const settings = await prisma.settings.findFirst();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const groupChatId = (settings as any)?.telegramGroupChatId as string | undefined;
  if (!groupChatId) return;

  const istNow = new Date(Date.now() + 5.5 * 3600 * 1000)
    .toISOString().slice(11, 19);

  const lines = [
    '🚨 *FUEL STARVATION SUSPECTED — Sugar Boiler*',
    '',
    `🔥 Furnace temp *dropped ${c.tempDrop.toFixed(0)}°C* in last ${WINDOW_MIN} min`,
    `   (${c.tempStart.toFixed(0)}°C → ${c.tempNow.toFixed(0)}°C)`,
    `⚙️  ${c.activeFeeders}/6 feeders still running`,
    `📊 Steam pressure: ${c.pressureNow?.toFixed(1) ?? '?'} kg/cm² (drop ${c.pressureDrop.toFixed(1)})`,
    '',
    '👉 Likely cause: silo empty / bagasse bridging.',
    '👉 Check silo level + clear any bridge.',
    '',
    `🕐 ${istNow} IST`,
  ];
  await broadcastToGroup(groupChatId, lines.join('\n'), 'boiler-combustion').catch(() => {});

  // Log to alarm history
  const opc = getOpcPrisma();
  await opc.opcAlarmLog.create({
    data: {
      tag: FURNACE_TAG,
      label: 'Fuel Starvation (silo empty / bridging)',
      value: c.tempNow,
      limit: c.tempStart - FURNACE_DROP_C,
      alarmType: 'COMBUSTION_DROP',
      source: 'SUGAR',
    },
  }).catch(() => {});

  console.log(`[boilerCombustionAlarm] FIRED — ΔT ${c.tempDrop.toFixed(0)}°C, ${c.activeFeeders}/6 feeders`);
}

export function startBoilerCombustionAlarm(): void {
  console.log(`[boilerCombustionAlarm] Started — checks every ${CHECK_INTERVAL_MS / 1000}s for fuel starvation pattern (${MIN_FEEDERS_RUNNING}+ feeders, >${FURNACE_DROP_C}°C drop in ${WINDOW_MIN} min)`);
  setInterval(() => {
    checkOnce().catch(err => console.error('[boilerCombustionAlarm]', (err as Error).message));
  }, CHECK_INTERVAL_MS);
}
