/**
 * Fermenter Phase Detector — auto-detect phase from OPC live data
 *
 * Uses level trend (slope) + temperature to determine fermenter state:
 *   EMPTY    — level <5%, stable
 *   STEAMING — level <10%, temp >40°C (CIP/steaming)
 *   FILLING  — level rising >2%/hr
 *   REACTION — level >50%, stable (±1%/hr), normal temp
 *   DRAINING — level dropping < -2%/hr
 *   UNKNOWN  — insufficient data or ambiguous
 *
 * Requires at least 30 min of OPC data to calculate slope.
 * Results cached for 5 min to avoid hammering the OPC DB.
 */

// ── Tag-to-Fermenter Mapping ──

const FERMENTER_TAGS: {
  fermenterNo: number;
  label: string;
  levelTag: string;
  tempTag: string;
}[] = [
  { fermenterNo: 1, label: 'F-1', levelTag: 'LT130201', tempTag: 'TE130201' },
  { fermenterNo: 2, label: 'F-2', levelTag: 'LT130202', tempTag: 'TE130202' },
  { fermenterNo: 3, label: 'F-3', levelTag: 'LT130301', tempTag: 'TE130301' },
  { fermenterNo: 4, label: 'F-4', levelTag: 'LT130302', tempTag: 'TE130302' },
];

// Temp tag → fermenter number (for alarm lookups)
export const TEMP_TAG_TO_FERMENTER: Record<string, number> = {
  TE130201: 1, TE130202: 2, TE130301: 3, TE130302: 4,
};

export type DetectedPhase = 'EMPTY' | 'STEAMING' | 'FILLING' | 'REACTION' | 'DRAINING' | 'UNKNOWN';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface FermenterState {
  fermenterNo: number;
  label: string;
  currentLevel: number;
  currentTemp: number;
  slope: number;          // %/hr — positive = filling, negative = draining
  detectedPhase: DetectedPhase;
  confidence: Confidence;
  alarmEnabled: boolean;  // should temp alarms fire for this fermenter?
  dataAge: number;        // seconds since last OPC reading
  updatedAt: Date;
}

// Phases where temp alarms should fire
const ALARM_PHASES: DetectedPhase[] = ['FILLING', 'REACTION', 'UNKNOWN'];

// ── Cache ──
let _cache: FermenterState[] = [];
let _cacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

// ── OPC Prisma Client (lazy) ──
let _opcPrisma: any = null;
function getOpc(): any {
  if (!_opcPrisma) {
    if (!process.env.DATABASE_URL_OPC) return null;
    const { PrismaClient } = require('@prisma/opc-client');
    _opcPrisma = new PrismaClient();
  }
  return _opcPrisma;
}

// ── Core Detection ──

function detectPhaseFromData(level: number, temp: number, slope: number, dataAge: number): { phase: DetectedPhase; confidence: Confidence } {
  // If data is stale (>15 min), low confidence
  if (dataAge > 15 * 60) {
    return { phase: 'UNKNOWN', confidence: 'LOW' };
  }

  // STEAMING/CIP: low level + high temp
  if (level < 10 && temp > 40) {
    return { phase: 'STEAMING', confidence: 'HIGH' };
  }

  // EMPTY: very low level, stable
  if (level < 5 && Math.abs(slope) < 1) {
    return { phase: 'EMPTY', confidence: 'HIGH' };
  }

  // DRAINING: level dropping significantly
  if (slope < -2) {
    return { phase: 'DRAINING', confidence: slope < -5 ? 'HIGH' : 'MEDIUM' };
  }

  // FILLING: level rising
  if (slope > 2) {
    return { phase: 'FILLING', confidence: slope > 5 ? 'HIGH' : 'MEDIUM' };
  }

  // REACTION: high level, stable, normal temp range
  if (level > 50 && Math.abs(slope) < 2 && temp >= 25 && temp <= 40) {
    return { phase: 'REACTION', confidence: 'HIGH' };
  }

  // Medium level, stable — could be partial fill or settling
  if (level > 10 && Math.abs(slope) < 2) {
    // If temp is in fermentation range, likely reaction
    if (temp >= 28 && temp <= 38) {
      return { phase: 'REACTION', confidence: 'MEDIUM' };
    }
    return { phase: 'UNKNOWN', confidence: 'LOW' };
  }

  return { phase: 'UNKNOWN', confidence: 'LOW' };
}

async function getLatestReading(opc: any, tag: string, property: string): Promise<{ value: number; scannedAt: Date } | null> {
  try {
    const reading = await opc.opcReading.findFirst({
      where: { tag, property },
      orderBy: { scannedAt: 'desc' },
      select: { value: true, scannedAt: true },
    });
    return reading;
  } catch { return null; }
}

async function getReadingAt(opc: any, tag: string, property: string, minutesAgo: number): Promise<{ value: number; scannedAt: Date } | null> {
  const cutoff = new Date(Date.now() - minutesAgo * 60 * 1000);
  const cutoffEnd = new Date(cutoff.getTime() + 10 * 60 * 1000); // 10 min window

  try {
    const reading = await opc.opcReading.findFirst({
      where: { tag, property, scannedAt: { gte: cutoff, lte: cutoffEnd } },
      orderBy: { scannedAt: 'asc' },
      select: { value: true, scannedAt: true },
    });
    return reading;
  } catch { return null; }
}

async function detectSingleFermenter(opc: any, config: typeof FERMENTER_TAGS[0]): Promise<FermenterState> {
  const now = Date.now();
  const prop = 'IO_VALUE';

  // Get latest level and temp
  const [latestLevel, latestTemp] = await Promise.all([
    getLatestReading(opc, config.levelTag, prop),
    getLatestReading(opc, config.tempTag, prop),
  ]);

  const currentLevel = latestLevel?.value ?? 0;
  const currentTemp = latestTemp?.value ?? 0;
  const dataAge = latestLevel ? (now - new Date(latestLevel.scannedAt).getTime()) / 1000 : Infinity;

  // Calculate slope: try 30 min ago first, then fall back to oldest recent reading
  let slope = 0;
  let prev = await getReadingAt(opc, config.levelTag, prop, 30);

  // Fallback: if no reading at 30 min mark, get the oldest of last 20 readings
  if (!prev) {
    try {
      const recentReadings = await opc.opcReading.findMany({
        where: { tag: config.levelTag, property: prop },
        orderBy: { scannedAt: 'desc' },
        take: 20,
        select: { value: true, scannedAt: true },
      });
      if (recentReadings.length >= 2) {
        prev = recentReadings[recentReadings.length - 1]; // oldest of recent
      }
    } catch { /* ignore */ }
  }

  if (prev && latestLevel) {
    const timeDiffHours = (new Date(latestLevel.scannedAt).getTime() - new Date(prev.scannedAt).getTime()) / 3600000;
    if (timeDiffHours > 0.05) { // at least 3 min apart
      slope = (currentLevel - prev.value) / timeDiffHours;
    }
  }

  const { phase, confidence } = detectPhaseFromData(currentLevel, currentTemp, slope, dataAge);

  return {
    fermenterNo: config.fermenterNo,
    label: config.label,
    currentLevel: Math.round(currentLevel * 100) / 100,
    currentTemp: Math.round(currentTemp * 100) / 100,
    slope: Math.round(slope * 100) / 100,
    detectedPhase: phase,
    confidence,
    alarmEnabled: ALARM_PHASES.includes(phase),
    dataAge: Math.round(dataAge),
    updatedAt: new Date(),
  };
}

// ── Public API ──

/** Get detected phases for all 4 fermenters (cached 5 min) */
export async function getAllFermenterPhases(): Promise<FermenterState[]> {
  // Return cache if fresh
  if (_cache.length > 0 && Date.now() - _cacheTime < CACHE_TTL_MS) {
    return _cache;
  }

  const opc = getOpc();
  if (!opc) {
    return FERMENTER_TAGS.map(f => ({
      fermenterNo: f.fermenterNo,
      label: f.label,
      currentLevel: 0,
      currentTemp: 0,
      slope: 0,
      detectedPhase: 'UNKNOWN' as DetectedPhase,
      confidence: 'LOW' as Confidence,
      alarmEnabled: true, // default to alarm-enabled when no data
      dataAge: Infinity,
      updatedAt: new Date(),
    }));
  }

  try {
    const states = await Promise.all(FERMENTER_TAGS.map(f => detectSingleFermenter(opc, f)));
    _cache = states;
    _cacheTime = Date.now();
    return states;
  } catch (err) {
    console.error('[PhaseDetector] Error:', (err as Error).message);
    return _cache.length > 0 ? _cache : [];
  }
}

/** Check if a specific fermenter temp tag should alarm */
export async function shouldAlarmForTag(tempTag: string): Promise<{ alarm: boolean; phase: DetectedPhase; confidence: Confidence; level: number }> {
  const fermNo = TEMP_TAG_TO_FERMENTER[tempTag];
  if (!fermNo) return { alarm: true, phase: 'UNKNOWN', confidence: 'LOW', level: 0 }; // not a fermenter tag — alarm by default

  const phases = await getAllFermenterPhases();
  const state = phases.find(s => s.fermenterNo === fermNo);
  if (!state) return { alarm: true, phase: 'UNKNOWN', confidence: 'LOW', level: 0 };

  return {
    alarm: state.alarmEnabled,
    phase: state.detectedPhase,
    confidence: state.confidence,
    level: state.currentLevel,
  };
}
