/**
 * Fermenter Fill Event Detector — pure functions, no I/O.
 *
 * A filling event is a continuous period where a fermenter's level rises from
 * <20% to a sustained plateau ≥40%, during which temp stays <40°C.
 *
 * Replaces the brittle `slope > 2%/hr` rule in fermenterPhaseDetector.ts.
 * See plan: ~/.claude/plans/piped-wishing-goblet.md
 */

export type Point = { time: Date; value: number };

export type FillSource = 'OPC' | 'LAB' | 'HYBRID';
export type FillConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface FillCrossChecks {
  tempOk: boolean;      // temp stayed <40°C throughout fill
  pfDropped: boolean;   // pre-ferm tank dropped ≥10% in same window
  labWithin2h: boolean; // lab reading logged within 2h of endTime
  startOk: boolean;     // startLevel <10%
  endOk: boolean;       // peakLevel ≥60%
}

export interface FillEvent {
  fermenterNo: number;
  startTime: Date;
  endTime: Date | null;           // null → in-progress
  startLevel: number;
  peakLevel: number;
  durationHours: number | null;   // null → in-progress
  confidence: FillConfidence;
  source: FillSource;
  crossChecks: FillCrossChecks;
}

export interface DetectorConfig {
  startLevelMax: number;         // default 20
  startSlopeMinPctHr: number;    // default 1
  startSustainedMinutes: number; // default 30
  endSlopeMaxPctHr: number;      // default 0.5
  endPeakMin: number;            // default 40
  endFlatBandPct: number;        // default 1 (max-min within end window)
  endFlatWindowMinutes: number;  // default 30
  tempCipThreshold: number;      // default 40
  minFillHours: number;          // default 2
  maxFillHours: number;          // default 72 — bail if elapsed exceeds (multi-batch stitch guard)
  smoothWindow: number;          // default 5
  maxPlausibleLevel: number;     // default 110 — drop readings above this (sensor fault / typo)
}

export const DEFAULT_CONFIG: DetectorConfig = {
  startLevelMax: 20,
  startSlopeMinPctHr: 1,
  startSustainedMinutes: 30,
  endSlopeMaxPctHr: 0.5,
  endPeakMin: 40,
  endFlatBandPct: 1,
  endFlatWindowMinutes: 30,
  tempCipThreshold: 40,
  minFillHours: 2,
  maxFillHours: 72,
  smoothWindow: 1, // off by default; set to 5 for dense OPC data
  maxPlausibleLevel: 110,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Rolling centered median smoothing — preserves edges by shrinking window. */
export function smoothMedian(points: Point[], window: number): Point[] {
  if (points.length <= 1 || window <= 1) return points.slice();
  const half = Math.floor(window / 2);
  return points.map((p, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(points.length, i + half + 1);
    const slice = points.slice(lo, hi).map(q => q.value);
    return { time: p.time, value: median(slice) };
  });
}

/** Slope in %/hr between two points. Returns 0 if dt is zero. */
function slopePctPerHour(a: Point, b: Point): number {
  const dtHrs = (b.time.getTime() - a.time.getTime()) / 3_600_000;
  if (dtHrs <= 0) return 0;
  return (b.value - a.value) / dtHrs;
}

/** Slope using the first and last points in a time window (robust vs regression for noisy lab data). */
function slopeOverWindow(points: Point[], fromIdx: number, toIdx: number): number {
  if (toIdx <= fromIdx) return 0;
  return slopePctPerHour(points[fromIdx], points[toIdx]);
}

/** Find index of the last point within [t - windowMs, t]. */
function lastIndexWithin(points: Point[], refIdx: number, windowMs: number): number {
  const refT = points[refIdx].time.getTime();
  let i = refIdx;
  while (i > 0 && refT - points[i - 1].time.getTime() <= windowMs) i--;
  return i;
}

/** Find closest-in-time point (within maxGapMs). Null if nothing close enough. */
function nearestPoint(points: Point[], t: Date, maxGapMs: number): Point | null {
  if (points.length === 0) return null;
  const tMs = t.getTime();
  let bestIdx = 0;
  let bestDiff = Math.abs(points[0].time.getTime() - tMs);
  for (let i = 1; i < points.length; i++) {
    const d = Math.abs(points[i].time.getTime() - tMs);
    if (d < bestDiff) { bestDiff = d; bestIdx = i; }
  }
  return bestDiff <= maxGapMs ? points[bestIdx] : null;
}

function maxInRange(points: Point[], lo: number, hi: number): number {
  let m = -Infinity;
  for (let i = lo; i <= hi && i < points.length; i++) if (points[i].value > m) m = points[i].value;
  return m;
}
function minInRange(points: Point[], lo: number, hi: number): number {
  let m = Infinity;
  for (let i = lo; i <= hi && i < points.length; i++) if (points[i].value < m) m = points[i].value;
  return m;
}

// ── CIP rejection ────────────────────────────────────────────────────────────

function tempExceededDuringWindow(temp: Point[], start: Date, end: Date, threshold: number): boolean {
  const startMs = start.getTime();
  const endMs = end.getTime();
  for (const p of temp) {
    const t = p.time.getTime();
    if (t >= startMs && t <= endMs && p.value > threshold) return true;
  }
  return false;
}

// ── PF drop check ────────────────────────────────────────────────────────────

function pfTankDropped(pf: Point[] | undefined, start: Date, end: Date, minDropPct: number): boolean {
  if (!pf || pf.length === 0) return false;
  const startMs = start.getTime();
  const endMs = end.getTime();
  const inWindow = pf.filter(p => {
    const t = p.time.getTime();
    return t >= startMs && t <= endMs;
  });
  if (inWindow.length < 2) return false;
  const first = inWindow[0].value;
  const min = Math.min(...inWindow.map(p => p.value));
  return first - min >= minDropPct;
}

// ── Lab proximity check ──────────────────────────────────────────────────────

function hasLabReadingWithin(labTimes: Date[] | undefined, end: Date, windowMs: number): boolean {
  if (!labTimes || labTimes.length === 0) return false;
  const endMs = end.getTime();
  return labTimes.some(t => Math.abs(t.getTime() - endMs) <= windowMs);
}

// ── Confidence ───────────────────────────────────────────────────────────────

function scoreConfidence(checks: FillCrossChecks): FillConfidence {
  const score = Object.values(checks).filter(Boolean).length;
  if (score >= 5) return 'HIGH';
  if (score >= 3) return 'MEDIUM';
  return 'LOW';
}

// ── Main detector ────────────────────────────────────────────────────────────

export interface DetectInput {
  fermenterNo: number;
  level: Point[];
  temp?: Point[];
  pfLevel?: Point[];
  labTimes?: Date[];
  source: FillSource;
  config?: Partial<DetectorConfig>;
}

export function detectFillEvents(input: DetectInput): FillEvent[] {
  const cfg: DetectorConfig = { ...DEFAULT_CONFIG, ...(input.config ?? {}) };
  const { fermenterNo, source } = input;
  const temp = input.temp ?? [];

  if (input.level.length < 2) return [];

  // Drop implausible level readings (sensor faults, typos like 480%)
  const filtered = input.level.filter(p =>
    Number.isFinite(p.value) && p.value >= 0 && p.value <= cfg.maxPlausibleLevel,
  );
  // Sort ascending by time
  const rawLevel = [...filtered].sort((a, b) => a.time.getTime() - b.time.getTime());
  const level = smoothMedian(rawLevel, cfg.smoothWindow);

  const startSustMs = cfg.startSustainedMinutes * 60_000;
  const endFlatMs = cfg.endFlatWindowMinutes * 60_000;

  const events: FillEvent[] = [];

  let state: 'idle' | 'filling' = 'idle';
  let startIdx = -1;
  let startValue = 0;
  let peakValue = 0;
  let peakIdx = -1;

  for (let i = 0; i < level.length; i++) {
    const p = level[i];

    if (state === 'idle') {
      if (p.value > cfg.startLevelMax) continue;

      // Find the first forward point at least `startSustainedMinutes` after p.
      // For sparse lab data (gaps of hours), we accept the first point beyond that
      // target up to a hard maxGap of 12h — prevents stitching unrelated events.
      const targetTime = p.time.getTime() + startSustMs;
      const maxGapMs = 12 * 3_600_000;
      let j = i + 1;
      while (j < level.length && level[j].time.getTime() < targetTime) j++;
      if (j >= level.length) continue; // no forward data
      if (level[j].time.getTime() - p.time.getTime() > maxGapMs) continue;

      const slope = slopePctPerHour(p, level[j]);
      if (slope >= cfg.startSlopeMinPctHr && level[j].value > p.value) {
        state = 'filling';
        startIdx = i;
        startValue = p.value;
        peakValue = p.value;
        peakIdx = i;
      }
      continue;
    }

    // state === 'filling'
    if (p.value > peakValue) {
      peakValue = p.value;
      peakIdx = i;
    }

    const startTime = level[startIdx].time;
    const nowTime = p.time;
    const elapsedHrs = (nowTime.getTime() - startTime.getTime()) / 3_600_000;

    // Abort if CIP temp seen during window
    if (tempExceededDuringWindow(temp, startTime, nowTime, cfg.tempCipThreshold)) {
      state = 'idle';
      startIdx = -1;
      peakValue = 0;
      peakIdx = -1;
      continue;
    }

    // Multi-batch stitch guard: if elapsed exceeds maxFillHours, close out at peak
    // and reset. Anything longer than 72h is almost certainly spanning multiple batches.
    if (elapsedHrs > cfg.maxFillHours && peakIdx >= 0 && peakValue >= cfg.endPeakMin) {
      const endTime = level[peakIdx].time;
      const crossChecks: FillCrossChecks = {
        tempOk: !tempExceededDuringWindow(temp, startTime, endTime, cfg.tempCipThreshold),
        pfDropped: pfTankDropped(input.pfLevel, startTime, endTime, 10),
        labWithin2h: hasLabReadingWithin(input.labTimes, endTime, 2 * 3_600_000),
        startOk: startValue < 10,
        endOk: peakValue >= 60,
      };
      events.push({
        fermenterNo,
        startTime,
        endTime,
        startLevel: Number(startValue.toFixed(2)),
        peakLevel: Number(peakValue.toFixed(2)),
        durationHours: Number(((endTime.getTime() - startTime.getTime()) / 3_600_000).toFixed(2)),
        confidence: scoreConfidence(crossChecks),
        source,
        crossChecks,
      });
      state = 'idle';
      startIdx = -1;
      peakValue = 0;
      peakIdx = -1;
      continue;
    }

    // End condition: flat window + peak threshold + min duration
    if (elapsedHrs >= cfg.minFillHours && peakValue >= cfg.endPeakMin) {
      const flatStartIdx = lastIndexWithin(level, i, endFlatMs);
      const windowHi = i;
      const windowLo = flatStartIdx;
      if (windowHi - windowLo >= 1) {
        const mx = maxInRange(level, windowLo, windowHi);
        const mn = minInRange(level, windowLo, windowHi);
        const flat = mx - mn <= cfg.endFlatBandPct;
        const endSlope = Math.abs(slopeOverWindow(level, windowLo, windowHi));
        if (flat && endSlope <= cfg.endSlopeMaxPctHr) {
          // Emit completed fill event. Use the time of the first peak (first max during fill)
          // rather than the flat-window start — the true end-of-fill is when rise stopped.
          const endTime = peakIdx >= 0 ? level[peakIdx].time : level[windowLo].time;
          const crossChecks: FillCrossChecks = {
            tempOk: !tempExceededDuringWindow(temp, startTime, endTime, cfg.tempCipThreshold),
            pfDropped: pfTankDropped(input.pfLevel, startTime, endTime, 10),
            labWithin2h: hasLabReadingWithin(input.labTimes, endTime, 2 * 3_600_000),
            startOk: startValue < 10,
            endOk: peakValue >= 60,
          };
          events.push({
            fermenterNo,
            startTime,
            endTime,
            startLevel: Number(startValue.toFixed(2)),
            peakLevel: Number(peakValue.toFixed(2)),
            durationHours: Number(((endTime.getTime() - startTime.getTime()) / 3_600_000).toFixed(2)),
            confidence: scoreConfidence(crossChecks),
            source,
            crossChecks,
          });
          state = 'idle';
          startIdx = -1;
          peakValue = 0;
          peakIdx = -1;
        }
      }
    }
  }

  // Tail: in-progress fill at series end
  if (state === 'filling' && startIdx >= 0) {
    const startTime = level[startIdx].time;
    const lastTime = level[level.length - 1].time;
    const elapsedHrs = (lastTime.getTime() - startTime.getTime()) / 3_600_000;
    if (elapsedHrs >= cfg.minFillHours && peakValue >= cfg.endPeakMin * 0.5) {
      // Emit as in-progress (endTime=null) so live detector can continue updating
      const crossChecks: FillCrossChecks = {
        tempOk: !tempExceededDuringWindow(temp, startTime, lastTime, cfg.tempCipThreshold),
        pfDropped: pfTankDropped(input.pfLevel, startTime, lastTime, 10),
        labWithin2h: hasLabReadingWithin(input.labTimes, lastTime, 2 * 3_600_000),
        startOk: startValue < 10,
        endOk: peakValue >= 60,
      };
      events.push({
        fermenterNo,
        startTime,
        endTime: null,
        startLevel: Number(startValue.toFixed(2)),
        peakLevel: Number(peakValue.toFixed(2)),
        durationHours: null,
        confidence: scoreConfidence(crossChecks),
        source,
        crossChecks,
      });
    }
  }

  return events;
}

/** Live helper — is this fermenter filling right now, based on recent points? */
export function isFillingNow(
  fermenterNo: number,
  level: Point[],
  temp: Point[],
  cfg: Partial<DetectorConfig> = {},
): { filling: boolean; event: FillEvent | null } {
  const events = detectFillEvents({ fermenterNo, level, temp, source: 'OPC', config: cfg });
  const tail = events[events.length - 1];
  if (tail && tail.endTime === null) return { filling: true, event: tail };
  return { filling: false, event: null };
}
