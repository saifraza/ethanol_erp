import { fetchLiveWeight } from './pcMonitor';
import { captureMotionClips, captureMotionEvent } from './videoCapture';
import { generateCycleId, initManifest, finalizeManifest, attachWeighmentDirect } from './cycleManifest';
import { getActiveSession } from './activeScaleSession';

/**
 * Weight-triggered video capture for the training corpus.
 *
 * Two-mode polling (per Saif 2026-04-18 — don't burn cycles when scale is empty):
 *
 *   SLOW mode (default, scale empty): poll every 2 sec
 *   ↓ on weight ≥ ACTIVATE_KG (150)
 *   FAST mode (truck activity): poll every 200 ms, do edge detection
 *   ↓ on weight < RESET_KG (50) sustained for 1 sec
 *   back to SLOW mode
 *
 * Edge detection in FAST mode:
 *   ARRIVAL:   weight rises through RISING_TRIGGER_KG (500)  → fire arrival.mp4
 *   DEPARTURE: weight falls to (capturedMax - FALLING_DELTA_KG)  → fire departure.mp4
 *
 * Captures motion-rich frames (different angles as truck pulls onto / off the scale)
 * which we cannot get from button-trigger.
 *
 * Saved by timestamp under data/videos/motion/{date}/. Association to weighmentId
 * is a Phase B job (timestamp matching). Tonight = data collection only.
 *
 * Per design doc `.claude/skills/wb-vision-anti-cheat.md` Section 12.
 */

// Polling cadence
const SLOW_POLL_MS = 2_000;
const FAST_POLL_MS = 200;

// Mode transition thresholds (with hysteresis to avoid flapping)
const ACTIVATE_KG = 150;        // slow → fast
const RESET_KG = 50;            // fast → slow  (lower than ACTIVATE = hysteresis band)
const FAST_RESET_CONSECUTIVE = 5; // 5×200ms = 1 sec stable below RESET_KG to confirm cycle done

// Capture trigger thresholds (within FAST mode)
const RISING_TRIGGER_KG = 500;
const FALLING_DELTA_KG = 500;
const MIN_CAPTURED_FOR_DEPARTURE = 1000; // require >1 ton on scale before arming departure

// "During weighing" motion-triggered captures (revised 2026-04-18 per Saif).
// Time-based 30-sec capture wasted disk on stationary trucks (some sit for
// 30+ min). Motion-based fires only when scale weight CHANGES — natural
// indicator that something is happening (truck shift, person walks on,
// cargo settles, operator moves equipment). Each motion event captures BOTH
// a 5-sec video AND a still per camera.
//
// MOTION_THRESHOLD_KG: weight delta from last-captured weight required to count as motion
// MIN_MOTION_INTERVAL_MS: cooldown so a single bump doesn't spam many captures
// MAX_MOTION_PER_CYCLE: hard cap per truck (defense against scale oscillation / runaway)
const MOTION_THRESHOLD_KG = 100;
const MIN_MOTION_INTERVAL_MS = 8_000;   // longer than 5-sec clip + small buffer
const MAX_MOTION_PER_CYCLE = 20;

// Stall detection — truck parked on scale with no motion for STALL_TIMEOUT_MS.
// Real case 2026-04-23: a trolley sat on scale for 39 minutes during a shift
// break. The cycle rolled the whole time so multiple truck weighments landed
// inside its time window, and the fuzzy matcher couldn't pick the right one
// → unmatched manifest. Force-close after 10 min no motion so a single
// parked truck doesn't swallow the next truck's weighment.
const STALL_TIMEOUT_MS = 10 * 60_000;

// Logging
const STALE_LOG_INTERVAL_MS = 60_000;

let mode: 'slow' | 'fast' = 'slow';
let timer: ReturnType<typeof setTimeout> | null = null;
let lastWeight = 0;
let capturedMax = 0;
let arrivalFired = false;
let departureFired = false;
let cycleStartAt = 0;
let consecutiveBelowReset = 0;
let lastStaleLogAt = 0;
// Cycle identity — set when arrival fires, cleared on cycle reset
let currentCycleId: string | null = null;
// Motion-detection state (only meaningful between arrivalFired and departureFired)
let lastMotionWeight = 0;  // weight value at time of last motion capture (or at arrival)
let lastMotionAt = 0;      // timestamp of last motion capture
let motionSeq = 0;         // sequence number of motion events this cycle (1, 2, 3...)

/** Start the background loop. Idempotent — calling twice is a no-op. */
export function startWeightTriggeredCapture(): void {
  if (timer) {
    console.log('[WT-CAP] already started, ignoring');
    return;
  }
  console.log(
    `[WT-CAP] starting (dual-mode): slow=${SLOW_POLL_MS}ms idle, fast=${FAST_POLL_MS}ms active. ` +
    `activate≥${ACTIVATE_KG}kg, arrival≥${RISING_TRIGGER_KG}kg, ` +
    `departure≤(max-${FALLING_DELTA_KG}kg), reset<${RESET_KG}kg`,
  );
  scheduleNext();
}

/** Stop the loop (used in tests / graceful shutdown). */
export function stopWeightTriggeredCapture(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
    console.log('[WT-CAP] stopped');
  }
}

function scheduleNext(): void {
  if (timer) clearTimeout(timer);
  const delay = mode === 'fast' ? FAST_POLL_MS : SLOW_POLL_MS;
  timer = setTimeout(tick, delay);
}

async function tick(): Promise<void> {
  let w: number | null;
  try {
    w = await fetchLiveWeight('web');
  } catch {
    scheduleNext();
    return;
  }

  if (w == null) {
    const now = Date.now();
    if (now - lastStaleLogAt > STALE_LOG_INTERVAL_MS) {
      console.log(`[WT-CAP] scale weight unavailable (stale/disconnected) — mode=${mode}, holding`);
      lastStaleLogAt = now;
    }
    scheduleNext();
    return;
  }

  // ── SLOW mode: just watch for activity ────────────────────────────────────
  if (mode === 'slow') {
    if (w >= ACTIVATE_KG) {
      console.log(`[WT-CAP] activity detected at ${w}kg → fast mode`);
      mode = 'fast';
      // Run the fast-mode logic on this same reading so we don't miss a fast ramp
      processFastTick(w);
    }
    lastWeight = w;
    scheduleNext();
    return;
  }

  // ── FAST mode: edge detection ──────────────────────────────────────────────
  processFastTick(w);

  // ── Stall detection — force-close a cycle that's been motionless too long ──
  // Keeps parked trucks (lunch break / plant stop) from eating the next
  // truck's weighment match window. See STALL_TIMEOUT_MS comment above.
  if (
    arrivalFired &&
    !departureFired &&
    currentCycleId &&
    lastMotionAt > 0 &&
    Date.now() - lastMotionAt >= STALL_TIMEOUT_MS
  ) {
    const stallMin = Math.round((Date.now() - lastMotionAt) / 60_000);
    console.log(
      `[WT-CAP] STALL TIMEOUT (${stallMin} min no motion) — force-closing cycle=${currentCycleId} at ${w}kg`,
    );
    // Last-chance direct session attach (same guard as the normal close path)
    const stallSession = getActiveSession();
    if (stallSession && stallSession.setAt > cycleStartAt) {
      attachWeighmentDirect(currentCycleId, stallSession);
    }
    finalizeManifest(currentCycleId, new Date(), capturedMax, motionSeq);
    // Mark cycle finished. Motion/departure checks for this cycle are now
    // short-circuited (departureFired=true). Natural `w < RESET_KG` will
    // still clean up the mode and reset state when the truck actually drives off.
    departureFired = true;
    currentCycleId = null;
  }

  // Cycle done? (sustained below RESET_KG = scale fully cleared)
  if (w < RESET_KG) {
    consecutiveBelowReset++;
    if (consecutiveBelowReset >= FAST_RESET_CONSECUTIVE) {
      const ageSec = cycleStartAt > 0 ? Math.round((Date.now() - cycleStartAt) / 1000) : 0;
      console.log(
        `[WT-CAP] cycle done → slow mode. capturedMax=${capturedMax}kg, ` +
        `arrival=${arrivalFired}, departure=${departureFired}, age=${ageSec}s`,
      );
      // Last-chance session check — only if set during THIS cycle
      if (currentCycleId && cycleStartAt > 0) {
        const finalSession = getActiveSession();
        if (finalSession && finalSession.setAt > cycleStartAt) {
          attachWeighmentDirect(currentCycleId, finalSession);
        }
      }
      // Finalize manifest BEFORE resetting state — so capturedMax/motionSeq
      // make it into the on-disk JSON and the 60-sec enrichment can fire.
      if (currentCycleId && arrivalFired) {
        finalizeManifest(currentCycleId, new Date(), capturedMax, motionSeq);
      }
      mode = 'slow';
      consecutiveBelowReset = 0;
      arrivalFired = false;
      departureFired = false;
      capturedMax = 0;
      cycleStartAt = 0;
      lastMotionWeight = 0;
      lastMotionAt = 0;
      motionSeq = 0;
      currentCycleId = null;
    }
  } else {
    consecutiveBelowReset = 0;
  }

  lastWeight = w;
  scheduleNext();
}

/** Edge-detection logic — runs only in fast mode (or on slow→fast transition). */
function processFastTick(w: number): void {
  // Arrival: weight rising through RISING_TRIGGER_KG
  if (!arrivalFired && lastWeight < RISING_TRIGGER_KG && w >= RISING_TRIGGER_KG) {
    arrivalFired = true;
    cycleStartAt = Date.now();
    lastMotionWeight = w;       // baseline for motion detection
    lastMotionAt = Date.now();  // arrival counts as "just captured" — start cooldown
    motionSeq = 0;
    currentCycleId = generateCycleId();
    initManifest(currentCycleId, new Date());
    // Don't check active session at arrival — operator hasn't selected this
    // truck yet. Session is either null or stale from the previous truck.
    console.log(`[WT-CAP] ARRIVAL trigger at ${w}kg (was ${lastWeight}kg) cycle=${currentCycleId}`);
    captureMotionClips(currentCycleId, 'arrival', w).catch((err) =>
      console.error('[WT-CAP] arrival capture error:', err instanceof Error ? err.message : err),
    );
  }

  // Track running max as the "loaded" weight
  if (arrivalFired && w > capturedMax) {
    capturedMax = w;
  }

  // Mid-weighing motion detection: capture when weight CHANGES significantly
  // (truck shift / person walks on / cargo settles). Skip if not yet arrived
  // or already departed, hard cap to prevent runaway.
  if (
    arrivalFired &&
    !departureFired &&
    motionSeq < MAX_MOTION_PER_CYCLE
  ) {
    const delta = Math.abs(w - lastMotionWeight);
    const sinceLast = Date.now() - lastMotionAt;
    if (delta >= MOTION_THRESHOLD_KG && sinceLast >= MIN_MOTION_INTERVAL_MS && currentCycleId) {
      motionSeq++;
      lastMotionWeight = w;
      lastMotionAt = Date.now();
      // Re-check active session — only accept if set AFTER this cycle started
      // (otherwise it's a stale session from the previous truck)
      const motionSession = getActiveSession();
      if (motionSession && currentCycleId && motionSession.setAt > cycleStartAt) {
        attachWeighmentDirect(currentCycleId, motionSession);
      }
      console.log(
        `[WT-CAP] MOTION #${motionSeq} at ${w}kg (Δ=${Math.round(delta)}kg from prior) cycle=${currentCycleId}`,
      );
      captureMotionEvent(currentCycleId, motionSeq, w, delta).catch((err) =>
        console.error('[WT-CAP] motion event error:', err instanceof Error ? err.message : err),
      );
    }
  }

  // Departure: weight falling through (capturedMax - FALLING_DELTA_KG)
  if (
    arrivalFired &&
    !departureFired &&
    capturedMax >= MIN_CAPTURED_FOR_DEPARTURE
  ) {
    const threshold = capturedMax - FALLING_DELTA_KG;
    if (lastWeight > threshold && w <= threshold && currentCycleId) {
      departureFired = true;
      // Session check before departure — only if set during THIS cycle
      const depSession = getActiveSession();
      if (depSession && currentCycleId && depSession.setAt > cycleStartAt) {
        attachWeighmentDirect(currentCycleId, depSession);
      }
      console.log(
        `[WT-CAP] DEPARTURE trigger at ${w}kg (capturedMax=${capturedMax}kg, threshold=${threshold}kg, motionEvents=${motionSeq}) cycle=${currentCycleId}`,
      );
      captureMotionClips(currentCycleId, 'departure', w).catch((err) =>
        console.error('[WT-CAP] departure capture error:', err instanceof Error ? err.message : err),
      );
    }
  }
}
