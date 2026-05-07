/**
 * Fingerprint Replicator — keeps every factory-managed biometric device in
 * sync, fingerprint-template wise.
 *
 * Operator pain point this solves:
 *   "I enrolled a finger on the CM device, the worker walks to the MSPIL
 *    gate, taps, and the MSPIL device says 'unknown user'."
 *
 * The cloud autoPush already pushes the *user record* to every device, but
 * the actual fingerprint template only lives on the device where the admin
 * enrolled it. This service walks every factory-managed device, asks "what
 * fingers do you have for which users?", computes the union, then copies
 * any missing template from a device that has it to the device that's
 * missing it.
 *
 * Design notes:
 *   - Cadence: every 10 minutes by default. Slow on purpose — enrollment
 *     is a once-per-employee event, latency of a few minutes is fine, and
 *     a tighter loop would hammer the eSSL devices' single-connection slot.
 *   - Concurrency vs autoPull/autoPush: each operation opens an exclusive
 *     pyzk connection to the device. If the replicator's templates/list
 *     collides with an autoPush, the bridge returns 502 "Device unreachable"
 *     and we skip that device this tick. No data loss — retried in 10 min.
 *   - "User not on dst" errors are silent: the user might have been
 *     created seconds ago and autoPush hasn't run yet. Next tick will work.
 *   - Idempotent: if a finger already exists on dst, the source-list filter
 *     simply doesn't pick it as a destination. Safe to run any number of
 *     times.
 */

import prisma from '../prisma';
import { config } from '../config';
import { bridge, DeviceRef } from './biometricBridge';

const TICK_MS = 10 * 60_000;
const FIRST_TICK_DELAY_MS = 90_000; // wait for autoPush to settle on boot

let _started = false;
let _lastTickAt: Date | null = null;
let _lastError: string | null = null;
let _lastCopied = 0;
let _lastFailed = 0;
let _lastDeviceCount = 0;
let _ticking = false;

interface CachedDevice {
  id: string;
  code: string;
  ip: string;
  port: number;
  password: number;
}

function toRef(d: CachedDevice): DeviceRef {
  return { ip: d.ip, port: d.port, password: d.password, timeout: 10 };
}

export function startFingerprintReplicator(): void {
  if (_started) return;
  if (!config.biometricBridgeKey) {
    console.log('[fingerprint replicator] BIOMETRIC_BRIDGE_KEY not set — disabled');
    return;
  }
  _started = true;
  console.log(`[fingerprint replicator] starting (${TICK_MS / 60_000}min tick)`);
  setTimeout(() => {
    void replicateTick();
    setInterval(() => { void replicateTick(); }, TICK_MS);
  }, FIRST_TICK_DELAY_MS);
}

async function replicateTick(): Promise<void> {
  if (_ticking) return; // overlap guard if a previous tick is still running
  _ticking = true;
  _lastTickAt = new Date();
  try {
    const devices = await prisma.cachedBiometricDevice.findMany({
      select: { id: true, code: true, ip: true, port: true, password: true },
    });
    _lastDeviceCount = devices.length;
    if (devices.length < 2) {
      _lastError = null;
      return;
    }

    // 1) Snapshot enrolled fingers per device (parallel)
    const states = await Promise.all(devices.map(async (d) => {
      try {
        const r = await bridge.templatesList(toRef(d));
        return { device: d, templates: r.templates ?? {}, ok: true as const };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { device: d, templates: {} as Record<string, number[]>, ok: false as const, error: msg };
      }
    }));

    const reachable = states.filter(s => s.ok);
    if (reachable.length < 2) {
      _lastError = `only ${reachable.length} of ${devices.length} devices reachable this tick`;
      return;
    }

    // 2) Collect every user_id that appears on at least one device
    const userIds = new Set<string>();
    for (const s of reachable) for (const uid of Object.keys(s.templates)) userIds.add(uid);

    let copied = 0;
    let failed = 0;
    let attempted = 0;

    // Mutable per-device snapshot — updated as we copy so we don't re-attempt
    // the same finger on the same destination if the user has many.
    const fingersByDeviceUser = new Map<string, Map<string, Set<number>>>();
    for (const s of reachable) {
      const m = new Map<string, Set<number>>();
      for (const [uid, fingers] of Object.entries(s.templates)) {
        m.set(uid, new Set(fingers));
      }
      fingersByDeviceUser.set(s.device.code, m);
    }

    for (const userId of userIds) {
      // Union of fingers across all reachable devices for this user
      const union = new Set<number>();
      for (const s of reachable) {
        const fs = fingersByDeviceUser.get(s.device.code)?.get(userId);
        if (fs) for (const f of fs) union.add(f);
      }

      for (const finger of union) {
        // A source = device that has this finger for this user
        const src = reachable.find(s => fingersByDeviceUser.get(s.device.code)?.get(userId)?.has(finger));
        if (!src) continue;

        // Destinations = reachable devices that don't have this finger yet
        const dsts = reachable.filter(s =>
          s.device.code !== src.device.code &&
          !fingersByDeviceUser.get(s.device.code)?.get(userId)?.has(finger)
        );

        for (const dst of dsts) {
          attempted++;
          try {
            const r = await bridge.templatesCopy(toRef(src.device), toRef(dst.device), userId, [finger]);
            if (r.ok) {
              copied++;
              // Reflect the new state locally so subsequent fingers for this user
              // pick up the right "who has what"
              const map = fingersByDeviceUser.get(dst.device.code)!;
              if (!map.has(userId)) map.set(userId, new Set());
              map.get(userId)!.add(finger);
              console.log(`[fingerprint replicator] copied user=${userId} finger=${finger} ${src.device.code} -> ${dst.device.code}`);
            } else {
              failed++;
              if (r.reason !== 'no_templates_on_src') {
                console.warn(`[fingerprint replicator] copy returned ok=false for user=${userId} finger=${finger} ${src.device.code} -> ${dst.device.code}: ${r.reason ?? r.error}`);
              }
            }
          } catch (err) {
            failed++;
            const msg = err instanceof Error ? err.message : String(err);
            // "not on dst — upsert first" = the user record was just created on
            // cloud and autoPush hasn't propagated yet. Silent — retry next tick.
            if (!msg.includes('upsert first')) {
              console.warn(`[fingerprint replicator] user=${userId} finger=${finger} ${src.device.code}->${dst.device.code}: ${msg}`);
            }
          }
        }
      }
    }

    _lastCopied = copied;
    _lastFailed = failed;
    _lastError = null;
    if (attempted > 0) {
      console.log(`[fingerprint replicator] tick done: copied=${copied} failed=${failed} attempted=${attempted} devices=${reachable.length}`);
    }
  } catch (err) {
    _lastError = err instanceof Error ? err.message : String(err);
    console.warn(`[fingerprint replicator] tick failed: ${_lastError}`);
  } finally {
    _ticking = false;
  }
}

export function getFingerprintReplicatorStatus() {
  return {
    started: _started,
    lastTickAt: _lastTickAt?.toISOString() ?? null,
    lastError: _lastError,
    lastCopied: _lastCopied,
    lastFailed: _lastFailed,
    deviceCount: _lastDeviceCount,
    tickIntervalMinutes: TICK_MS / 60_000,
  };
}
