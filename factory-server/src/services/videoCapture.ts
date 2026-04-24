import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fetchSnapshot } from './cameraCapture';
import { getCycleDir, appendEvent } from './cycleManifest';

// Same camera IPs as cameraCapture.ts — kept here for module isolation
const CAMERAS = [
  { id: 'cam1', ip: '192.168.0.233' },
  { id: 'cam2', ip: '192.168.0.239' },
];
const CAM_USER = 'admin';
const CAM_PASS = 'admin123';

const VIDEO_ROOT = path.join(__dirname, '..', '..', 'data', 'videos');
const CLIP_DURATION_SEC = 15;                 // 3x bump per Saif 2026-04-18 — 5 sec was too short to see truck movement
const MOTION_CLIP_DURATION_SEC = 5;           // shorter for mid-weighing motion events (truck shift, person walk, settle)
const FFMPEG_TIMEOUT_MS = 25_000;             // 15s clip + handshake + safety margin
const MOTION_FFMPEG_TIMEOUT_MS = 12_000;      // 5s clip + handshake + safety margin
const MIN_CLIP_BYTES = 10_000;
const BURST_COUNT = 10;                       // # stills per camera per arrival/departure event
const BURST_INTERVAL_MS = 1_500;              // 10 stills × 1.5s = covers full 15 sec

// ffmpeg path: prefer env var, fall back to fixed install at C:\mspil\ffmpeg\bin\ffmpeg.exe
// (Windows install path chosen to live alongside our other tooling, NOT in system PATH,
// so we never collide with anything Oracle / WtService might rely on.)
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'C:\\mspil\\ffmpeg\\bin\\ffmpeg.exe';

/**
 * Motion-triggered video capture (called by weightTriggeredCapture state machine).
 * Saves to data/videos/motion/{YYYY-MM-DD}/{ISO_TS}_{event}_cam{N}.mp4
 *
 * Returns relative paths (under data/videos/) of saved files.
 * Fire-and-forget — never throws.
 */
export async function captureMotionClips(
  cycleId: string,
  event: 'arrival' | 'departure',
  triggerWeightKg: number,
): Promise<string[]> {
  const saved: string[] = [];
  const now = new Date();
  const dir = getCycleDir(cycleId);
  try {
    fs.mkdirSync(dir, { recursive: true });

    // Per Saif 2026-04-18: dropped the 15-sec arrival/departure videos — most of
    // the clip was stationary truck (waste). Burst stills cover the 15-sec
    // window in 1.5-sec increments and motion-event captures handle any actual
    // movement during the ramp. Storage drops ~50%, training data unchanged.
    const tasks: Promise<string | null>[] = [];
    for (const cam of CAMERAS) {
      tasks.push(...burstStills(cam, dir, event, triggerWeightKg));
    }

    const results = await Promise.allSettled(tasks);
    results.forEach((r) => {
      if (r.status === 'fulfilled' && r.value) saved.push(r.value);
    });
  } catch (err) {
    console.error(
      '[VIDEO] captureMotionClips outer error:',
      err instanceof Error ? err.message : err,
    );
  }

  if (saved.length > 0) {
    console.log(
      `[VIDEO] ${event} captured ${saved.length} burst still(s) at ${triggerWeightKg} kg [${cycleId}]`,
    );
  }

  // Append to manifest
  appendEvent(cycleId, {
    type: event,
    at: now.toISOString(),
    weight_kg: Math.round(triggerWeightKg),
    files: saved,
  });

  return saved;
}

/**
 * Motion event during weighing (revised 2026-04-18 per Saif):
 * Captures BOTH a short 5-sec video AND one snapshot per camera.
 *
 * Triggered by weight delta detection (not by time) — so this only fires when
 * something is actually MOVING on the scale: truck shifts, person walks on,
 * cargo settles, operator interacts. Stationary trucks produce zero captures
 * (which is the right behavior — duplicate frames have no training value).
 *
 * Files:
 *   {ts}_motion_t{N}_w{kg}_{cam}.mp4   ← 5-sec video × 2 cams
 *   {ts}_motion_t{N}_w{kg}_{cam}.jpg   ← 1 still × 2 cams (taken at trigger moment)
 */
export async function captureMotionEvent(
  cycleId: string,
  motionSeq: number,
  weightKg: number,
  deltaKg: number,
): Promise<string[]> {
  const saved: string[] = [];
  const now = new Date();
  const dir = getCycleDir(cycleId);
  try {
    fs.mkdirSync(dir, { recursive: true });

    const tasks: Promise<string | null>[] = [];

    // 5-sec video per camera (motion-length, not full 15 sec)
    for (const cam of CAMERAS) {
      const filename = `motion_t${motionSeq}_w${Math.round(weightKg)}_${cam.id}.mp4`;
      const filepath = path.join(dir, filename);
      tasks.push(
        runFfmpegCapture(cam, filepath, MOTION_CLIP_DURATION_SEC, MOTION_FFMPEG_TIMEOUT_MS).then((ok) =>
          ok ? filename : null,
        ),
      );
    }

    // 1 HD still per camera at the motion-trigger moment.
    // Pulled from RTSP main stream via ffmpeg -frames:v 1 → 2560×1440 (4MP),
    // not snapshot.cgi (firmware-locked at 1080p). Per Saif 2026-04-18 — give
    // the model the highest-resolution training frames possible at the most
    // information-rich moments (motion events).
    for (const cam of CAMERAS) {
      const filename = `motion_t${motionSeq}_w${Math.round(weightKg)}_${cam.id}.jpg`;
      const filepath = path.join(dir, filename);
      tasks.push(
        runFfmpegSingleFrame(cam, filepath).then((ok) => (ok ? filename : null)),
      );
    }

    const results = await Promise.allSettled(tasks);
    results.forEach((r) => {
      if (r.status === 'fulfilled' && r.value) saved.push(r.value);
    });
  } catch (err) {
    console.error(
      '[VIDEO] captureMotionEvent error:',
      err instanceof Error ? err.message : err,
    );
  }

  if (saved.length > 0) {
    const v = saved.filter((s) => s.endsWith('.mp4')).length;
    const j = saved.filter((s) => s.endsWith('.jpg')).length;
    console.log(`[VIDEO] motion #${motionSeq} captured ${v} video + ${j} still(s) at ${weightKg} kg [${cycleId}]`);
  }

  appendEvent(cycleId, {
    type: 'motion',
    seq: motionSeq,
    at: now.toISOString(),
    weight_kg: Math.round(weightKg),
    delta_kg: Math.round(deltaKg),
    files: saved,
  });

  return saved;
}

/**
 * Schedule BURST_COUNT HD frame extractions for one camera, spaced BURST_INTERVAL_MS apart.
 * Returns one Promise per frame (resolved with relative-to-cycle filename or null).
 * Failures are silent — each frame independently.
 *
 * Per Saif 2026-04-18: bursts pull 2560×1440 from RTSP main stream (not 1080p
 * snapshot.cgi). Each ffmpeg call ~500-800ms; with 1.5s spacing they don't
 * overlap. Storage per burst still goes from ~200 KB to ~700 KB — accepted
 * because we want maximum-quality training frames.
 */
function burstStills(
  cam: { id: string; ip: string },
  dir: string,
  event: string,
  weightKg: number,
): Promise<string | null>[] {
  const out: Promise<string | null>[] = [];
  for (let i = 0; i < BURST_COUNT; i++) {
    const delay = i * BURST_INTERVAL_MS;
    out.push(
      new Promise((resolve) => {
        setTimeout(async () => {
          const filename = `${event}_w${Math.round(weightKg)}_${cam.id}_burst${i + 1}.jpg`;
          const filepath = path.join(dir, filename);
          const ok = await runFfmpegSingleFrame(cam, filepath);
          resolve(ok ? filename : null);
        }, delay);
      }),
    );
  }
  return out;
}

/**
 * Internal: pull a single 2560×1440 frame from RTSP main stream and save as JPEG.
 * Used for HD stills at motion-trigger moments. Takes ~500-800ms per camera
 * (handshake + 1 frame). Quality 2 ≈ ~700 KB JPEG.
 */
function runFfmpegSingleFrame(
  cam: { id: string; ip: string },
  filepath: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const url = `rtsp://${CAM_USER}:${CAM_PASS}@${cam.ip}:554/cam/realmonitor?channel=1&subtype=0`;
    let proc;
    try {
      proc = spawn(
        FFMPEG_PATH,
        [
          '-y',
          '-rtsp_transport', 'tcp',
          '-i', url,
          '-frames:v', '1',
          '-q:v', '2',           // high-quality JPEG
          '-loglevel', 'error',
          filepath,
        ],
        { windowsHide: true },
      );
    } catch (err) {
      console.error(
        `[VIDEO] ${cam.id} ffmpeg single-frame spawn failed:`,
        err instanceof Error ? err.message : err,
      );
      resolve(false);
      return;
    }
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      try { proc.kill('SIGKILL'); } catch { /* already dead */ }
      console.error(`[VIDEO] ${cam.id} single-frame timeout`);
    }, 8_000);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (killed || code !== 0) {
        try { fs.unlinkSync(filepath); } catch { /* ignore */ }
        resolve(false);
        return;
      }
      let size = 0;
      try { size = fs.statSync(filepath).size; } catch { /* ignore */ }
      if (size < 5_000) {
        try { fs.unlinkSync(filepath); } catch { /* ignore */ }
        resolve(false);
        return;
      }
      resolve(true);
    });
    proc.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/**
 * Internal: spawn ffmpeg, pull RTSP main stream, save mp4. Returns true on success.
 * Used by both motion-triggered and any future weighmentId-tagged capture paths.
 */
function runFfmpegCapture(
  cam: { id: string; ip: string },
  filepath: string,
  durationSec: number = CLIP_DURATION_SEC,
  timeoutMs: number = FFMPEG_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    const url = `rtsp://${CAM_USER}:${CAM_PASS}@${cam.ip}:554/cam/realmonitor?channel=1&subtype=0`;

    let proc;
    try {
      proc = spawn(
        FFMPEG_PATH,
        [
          '-y',
          '-rtsp_transport', 'tcp',
          '-i', url,
          '-t', String(durationSec),
          '-c', 'copy',          // stream-copy, no transcode — minimal CPU
          '-tag:v', 'hvc1',      // macOS QuickTime needs hvc1 tag for HEVC (default is hev1)
          '-loglevel', 'error',
          filepath,
        ],
        { windowsHide: true },
      );
    } catch (err) {
      console.error(
        `[VIDEO] ${cam.id} ffmpeg spawn failed (binary missing?):`,
        err instanceof Error ? err.message : err,
      );
      resolve(false);
      return;
    }

    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      try { proc.kill('SIGKILL'); } catch { /* already dead */ }
      console.error(`[VIDEO] ${cam.id} ffmpeg timeout — killed after ${timeoutMs}ms`);
    }, timeoutMs);

    let stderr = '';
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });

    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (killed || code !== 0) {
        console.error(
          `[VIDEO] ${cam.id} ffmpeg exit ${code}${stderr ? ' err=' + stderr.slice(0, 200) : ''}`,
        );
        try { fs.unlinkSync(filepath); } catch { /* file may not exist */ }
        resolve(false);
        return;
      }

      let size = 0;
      try { size = fs.statSync(filepath).size; } catch { /* ignore */ }
      if (size < MIN_CLIP_BYTES) {
        console.error(`[VIDEO] ${cam.id} clip too small (${size} bytes), discarding`);
        try { fs.unlinkSync(filepath); } catch { /* ignore */ }
        resolve(false);
        return;
      }

      console.log(
        `[VIDEO] ${cam.id} saved ${path.basename(filepath)} (${Math.round(size / 1024)} KB)`,
      );
      resolve(true);
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      console.error(
        `[VIDEO] ${cam.id} ffmpeg runtime error:`,
        err instanceof Error ? err.message : err,
      );
      resolve(false);
    });
  });
}
