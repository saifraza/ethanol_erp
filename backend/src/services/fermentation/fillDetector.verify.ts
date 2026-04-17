/**
 * Self-contained validator for fillDetector.
 * Run: cd backend && npx tsx src/services/fermentation/fillDetector.verify.ts
 *
 * Uses real lab readings (level column) from production for batches 44/38/37/41/21.
 * Asserts the detector finds expected fill events and skips the noise.
 */

import { detectFillEvents, type Point } from './fillDetector';

type Assertion = () => { pass: boolean; msg: string };
const results: Array<{ name: string; pass: boolean; msg: string }> = [];

function test(name: string, fn: Assertion) {
  try {
    const r = fn();
    results.push({ name, ...r });
  } catch (err) {
    results.push({ name, pass: false, msg: `THREW: ${(err as Error).message}` });
  }
}

const pt = (t: string, v: number): Point => ({ time: new Date(t), value: v });

// ── Batch 44 (F-1): 22h fill, 14.3% → 66%. HIGH-confidence textbook run.
test('batch 44 (F-1) — textbook 22h fill to 66% plateau', () => {
  const level: Point[] = [
    pt('2026-04-14T13:35:10Z', 14.33),
    pt('2026-04-14T18:09:56Z', 19.45),
    pt('2026-04-14T20:15:00Z', 22.01),
    pt('2026-04-14T21:55:26Z', 23.6),
    pt('2026-04-15T00:04:59Z', 28.55),
    pt('2026-04-15T01:48:43Z', 34.2),
    pt('2026-04-15T03:58:41Z', 42.42),
    pt('2026-04-15T06:14:58Z', 46.91),
    pt('2026-04-15T08:02:40Z', 48.7),
    pt('2026-04-15T10:15:54Z', 53.23),
    pt('2026-04-15T11:42:56Z', 61.62),
    pt('2026-04-15T12:45:44Z', 66.01),
    pt('2026-04-15T16:01:07Z', 65.69),
    pt('2026-04-15T18:03:06Z', 65.38),
    pt('2026-04-15T20:06:06Z', 65.03),
    pt('2026-04-15T22:07:21Z', 64.75),
    pt('2026-04-16T00:10:13Z', 64.54),
  ];
  const events = detectFillEvents({
    fermenterNo: 1,
    level,
    temp: [],
    source: 'LAB',
    // Sparse lab data — relax sustain + flat windows to lab cadence
    config: { startSustainedMinutes: 120, endFlatWindowMinutes: 180, endFlatBandPct: 1.5 },
  });
  if (events.length !== 1) return { pass: false, msg: `expected 1 event, got ${events.length}` };
  const e = events[0];
  const durOk = e.durationHours! > 20 && e.durationHours! < 26;
  const startOk = e.startLevel < 16;
  const peakOk = e.peakLevel >= 65;
  return {
    pass: durOk && startOk && peakOk,
    msg: `event: start=${e.startLevel}% peak=${e.peakLevel}% dur=${e.durationHours}h conf=${e.confidence} endOk=${e.crossChecks.endOk}`,
  };
});

// ── Batch 38 (F-3): lab data is sparse here (only 2 points), detector should NOT hallucinate
test('batch 38 (F-3) — sparse data (only start + long-after end), should not hallucinate', () => {
  const level: Point[] = [
    pt('2026-04-07T00:15:09Z', 59.48),
    pt('2026-04-11T06:12:03Z', 0.81),
  ];
  const events = detectFillEvents({
    fermenterNo: 3,
    level,
    temp: [],
    source: 'LAB',
  });
  // Starts at 59.48 (above startLevelMax=20). Can never trigger fill start. Expected: 0 events.
  return {
    pass: events.length === 0,
    msg: `events=${events.length} (expected 0 — start level too high)`,
  };
});

// ── Batch 41 (F-2): starts at 0.95 → 49.65. Low plateau ~48%. Should catch it with MEDIUM conf.
test('batch 41 (F-2) — 21h fill to 49% plateau', () => {
  const level: Point[] = [
    pt('2026-04-10T23:22:56Z', 0.95),
    pt('2026-04-11T10:43:14Z', 28.16),
    pt('2026-04-11T11:48:25Z', 29.28),
    pt('2026-04-11T15:40:12Z', 34.41),
    pt('2026-04-11T20:16:20Z', 49.65),
    pt('2026-04-11T23:41:28Z', 49.33),
    pt('2026-04-12T01:59:45Z', 48.95),
    pt('2026-04-12T03:50:15Z', 48.74),
    pt('2026-04-12T07:57:12Z', 48.28),
    pt('2026-04-12T10:04:47Z', 48.2),
    pt('2026-04-12T12:07:36Z', 48.07),
  ];
  const events = detectFillEvents({
    fermenterNo: 2,
    level,
    temp: [],
    source: 'LAB',
    config: { startSustainedMinutes: 120, endFlatWindowMinutes: 240, endFlatBandPct: 2 },
  });
  if (events.length !== 1) return { pass: false, msg: `expected 1 event, got ${events.length}` };
  const e = events[0];
  const peakOk = e.peakLevel >= 49 && e.peakLevel <= 50;
  return {
    pass: peakOk,
    msg: `start=${e.startLevel}% peak=${e.peakLevel}% dur=${e.durationHours}h conf=${e.confidence}`,
  };
});

// ── CIP rejection: high temp during rise must reject fill
test('CIP rejection — temp >40°C during level rise kills the candidate', () => {
  const level: Point[] = [
    pt('2026-04-10T00:00:00Z', 2),
    pt('2026-04-10T02:00:00Z', 25),
    pt('2026-04-10T04:00:00Z', 55),
    pt('2026-04-10T06:00:00Z', 60),
    pt('2026-04-10T08:00:00Z', 60),
    pt('2026-04-10T10:00:00Z', 60),
  ];
  const temp: Point[] = [pt('2026-04-10T03:00:00Z', 65)]; // CIP water
  const events = detectFillEvents({
    fermenterNo: 1,
    level,
    temp,
    source: 'OPC',
    config: { startSustainedMinutes: 60, endFlatWindowMinutes: 60, endFlatBandPct: 1 },
  });
  return {
    pass: events.length === 0,
    msg: `events=${events.length} (expected 0 — CIP temp rejects fill)`,
  };
});

// ── Minimum duration: level spike over 1h must not count
test('min-duration: 1h rise does not qualify as fill', () => {
  const level: Point[] = [
    pt('2026-04-10T00:00:00Z', 5),
    pt('2026-04-10T00:30:00Z', 45),
    pt('2026-04-10T01:00:00Z', 55),
    pt('2026-04-10T01:15:00Z', 55),
    pt('2026-04-10T01:30:00Z', 55),
  ];
  const events = detectFillEvents({ fermenterNo: 1, level, temp: [], source: 'OPC' });
  return { pass: events.length === 0, msg: `events=${events.length} (expected 0 — <2h)` };
});

// ── In-progress: rising level at series tail must emit endTime=null
test('in-progress: unfinished fill at tail of series emits endTime=null', () => {
  const level: Point[] = [
    pt('2026-04-10T00:00:00Z', 3),
    pt('2026-04-10T01:00:00Z', 15),
    pt('2026-04-10T02:00:00Z', 25),
    pt('2026-04-10T03:00:00Z', 35),
    pt('2026-04-10T04:00:00Z', 45),
  ];
  const events = detectFillEvents({
    fermenterNo: 1,
    level,
    temp: [],
    source: 'OPC',
    config: { startSustainedMinutes: 60, endFlatWindowMinutes: 30, minFillHours: 2 },
  });
  const e = events[0];
  return {
    pass: events.length === 1 && e.endTime === null,
    msg: `events=${events.length} endTime=${e?.endTime} (expected 1, endTime=null)`,
  };
});

// ── Batch 21 anomaly: only endpoint data, should NOT produce 233h fake fill
test('batch 21 anomaly — only endpoint data must not produce 233h fill', () => {
  const level: Point[] = [
    pt('2026-03-15T00:00:00Z', 65),  // already filled (no fill start in series)
    pt('2026-03-25T00:00:00Z', 60),
  ];
  const events = detectFillEvents({ fermenterNo: 1, level, temp: [], source: 'LAB' });
  return {
    pass: events.length === 0,
    msg: `events=${events.length} (expected 0 — no low-level start in window)`,
  };
});

// ── Report ───────────────────────────────────────────────────────────────────
const passed = results.filter(r => r.pass).length;
const failed = results.length - passed;
for (const r of results) {
  const tag = r.pass ? 'PASS' : 'FAIL';
  const line = `[${tag}] ${r.name}  ${r.msg}`;
  if (r.pass) console.log(line);
  else console.error(line);
}
console.log(`\n${passed}/${results.length} passed`);
if (failed > 0) process.exit(1);
