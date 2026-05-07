/**
 * Factory-led biometric scheduler.
 *
 * Pulls punches from every CachedBiometricDevice (refreshed by
 * masterDataCache from the cloud) into the local AttendancePunch table
 * and pushes the cached employee/labor list back to each device on the
 * configured interval. syncWorker.ts handles the cloud-bound batching.
 *
 * Why factory-led? eSSL devices store ~10k punches in flash and lose
 * older ones. We don't want to depend on that buffer. Pulling every
 * minute into Postgres on the same LAN means a multi-hour internet
 * outage doesn't lose a single punch.
 *
 * Mirrors the cloud-side biometricScheduler.ts behaviour but the data
 * lands in factory-server's local DB first. The cloud version skips
 * devices where factoryManaged=true (handed off to us).
 */

import prisma from '../prisma';
import { config } from '../config';
import { bridge, DeviceRef } from './biometricBridge';

const inFlight = new Set<string>();
let _started = false;
let _lastTickAt: Date | null = null;
let _lastError: string | null = null;

function toRef(d: { ip: string; port: number; password: number }): DeviceRef {
  return { ip: d.ip, port: d.port, password: d.password, timeout: 10 };
}

/** ERP card number string → 32-bit unsigned int the device expects. 0 = no card. */
function parseCardNumber(s: string | null | undefined): number {
  if (!s) return 0;
  const digits = s.replace(/\D/g, '');
  if (!digits) return 0;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) && n > 0 && n <= 4_294_967_295 ? n : 0;
}

export function startBiometricScheduler(): void {
  if (_started) return;
  if (!config.biometricBridgeKey) {
    console.log('[biometric] BIOMETRIC_BRIDGE_KEY not set — scheduler disabled (factory not in biometric mode)');
    return;
  }
  _started = true;
  console.log('[biometric] starting (60s tick)');
  // Wait 30s after boot to let masterDataCache populate, then start ticking.
  setTimeout(() => {
    void tick();
    setInterval(() => { void tick(); }, 60_000);
  }, 30_000);
}

async function tick(): Promise<void> {
  _lastTickAt = new Date();
  try {
    const devices = await prisma.cachedBiometricDevice.findMany();
    if (devices.length === 0) return;

    // Auto time-sync interval (every 60 min). Hard-coded — admins shouldn't
    // need to think about clock drift; device clocks should "just work."
    // Factory-server's clock is the canonical source (Windows NTP keeps it
    // accurate). Pushes its own clock to every device every hour, keeping
    // all devices within ~1 second of each other.
    const TIME_SYNC_INTERVAL_MS = 60 * 60_000;

    for (const d of devices) {
      if (d.autoPullMinutes > 0) {
        const due = !d.lastPullAt || (Date.now() - d.lastPullAt.getTime()) >= d.autoPullMinutes * 60_000;
        const key = `pull|${d.id}`;
        if (due && !inFlight.has(key)) {
          inFlight.add(key);
          autoPull(d).catch(err => {
            console.warn(`[biometric pull ${d.code}] ${err instanceof Error ? err.message : err}`);
          }).finally(() => inFlight.delete(key));
        }
      }
      if (d.autoPushMinutes > 0) {
        const due = !d.lastPushAt || (Date.now() - d.lastPushAt.getTime()) >= d.autoPushMinutes * 60_000;
        const key = `push|${d.id}`;
        if (due && !inFlight.has(key)) {
          inFlight.add(key);
          autoPush(d).catch(err => {
            console.warn(`[biometric push ${d.code}] ${err instanceof Error ? err.message : err}`);
          }).finally(() => inFlight.delete(key));
        }
      }
      // Time sync — independent of pull/push intervals
      const timeSyncDue = !d.lastTimeSyncAt
        || (Date.now() - d.lastTimeSyncAt.getTime()) >= TIME_SYNC_INTERVAL_MS;
      const tsKey = `time|${d.id}`;
      if (timeSyncDue && !inFlight.has(tsKey)) {
        inFlight.add(tsKey);
        autoTimeSync(d).catch(err => {
          console.warn(`[biometric time ${d.code}] ${err instanceof Error ? err.message : err}`);
        }).finally(() => inFlight.delete(tsKey));
      }
    }
    _lastError = null;
  } catch (err) {
    _lastError = err instanceof Error ? err.message : String(err);
    console.warn(`[biometric] tick failed: ${_lastError}`);
  }
}

async function autoTimeSync(d: CachedDevice): Promise<void> {
  // Push factory-server's UTC clock to the device. `set_to` omitted = bridge
  // uses NOW from its own clock, which on the factory PC is NTP-aligned.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${config.biometricBridgeUrl}/devices/time/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bridge-Key': config.biometricBridgeKey },
      body: JSON.stringify({ device: toRef(d) }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`bridge ${res.status}: ${txt.slice(0, 100)}`);
    }
    await prisma.cachedBiometricDevice.update({
      where: { id: d.id },
      data: { lastTimeSyncAt: new Date() },
    });
    console.log(`[biometric time ${d.code}] clock synced`);
  } catch (err) {
    // Non-fatal -- clock drift is bounded by next attempt 60 min later.
    console.warn(`[biometric time ${d.code}] sync failed: ${err instanceof Error ? err.message : err}`);
  } finally {
    clearTimeout(timer);
  }
}

interface CachedDevice {
  id: string;
  code: string;
  ip: string;
  port: number;
  password: number;
  companyId: string | null;
  lastPullAt: Date | null;
  lastPushAt: Date | null;
  lastTimeSyncAt: Date | null;
}

async function autoPull(d: CachedDevice): Promise<void> {
  // 30s overlap window so a punch arriving mid-pull isn't missed on the next cycle.
  const since = d.lastPullAt
    ? new Date(d.lastPullAt.getTime() - 30_000).toISOString()
    : undefined;

  let pulled;
  try {
    pulled = await bridge.pullPunches(toRef(d), since, false);
  } catch (err) {
    await prisma.cachedBiometricDevice.update({
      where: { id: d.id },
      data: { lastError: err instanceof Error ? err.message : String(err), lastPullAt: new Date() },
    }).catch(() => {});
    return;
  }

  // Resolve all user_ids in this batch in two queries instead of 2N
  const userIds = [...new Set(pulled.punches.map(p => p.user_id))];
  const [emps, labs] = userIds.length > 0
    ? await Promise.all([
        prisma.cachedEmployee.findMany({
          where: { deviceUserId: { in: userIds } },
          select: { id: true, deviceUserId: true, companyId: true },
        }),
        prisma.cachedLaborWorker.findMany({
          where: { deviceUserId: { in: userIds } },
          select: { id: true, deviceUserId: true, companyId: true },
        }),
      ])
    : [[], []];
  const empByDev = new Map(emps.map(e => [e.deviceUserId!, e]));
  const labByDev = new Map(labs.map(l => [l.deviceUserId!, l]));

  let inserted = 0;
  for (const p of pulled.punches) {
    const emp = empByDev.get(p.user_id);
    const lw = !emp ? labByDev.get(p.user_id) : null;
    const punchAt = new Date(p.punch_at);
    if (isNaN(punchAt.getTime())) continue;

    try {
      // @@unique([deviceCode, deviceUserId, punchAt]) makes this idempotent
      await prisma.attendancePunch.create({
        data: {
          deviceCode: d.code,
          deviceUserId: p.user_id,
          punchAt,
          direction: p.punch === 0 ? 'IN' : p.punch === 1 ? 'OUT' : 'AUTO',
          employeeId: emp?.id ?? null,
          laborWorkerId: lw?.id ?? null,
          companyId: emp?.companyId ?? lw?.companyId ?? d.companyId,
        },
      });
      inserted++;
    } catch (err: unknown) {
      // P2002 = unique violation = already inserted in a prior tick. Ignore.
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('Unique constraint')) {
        console.warn(`[biometric pull ${d.code}] insert failed for user_id=${p.user_id}: ${msg}`);
      }
    }
  }

  await prisma.cachedBiometricDevice.update({
    where: { id: d.id },
    data: { lastPullAt: new Date(), lastError: null },
  });

  if (inserted > 0) {
    console.log(`[biometric pull ${d.code}] ${inserted} new punch(es) ingested locally`);
  }
}

async function autoPush(d: CachedDevice): Promise<void> {
  // Source of truth for who-goes-on-the-device: cached cloud master data.
  // No local employee creation — admins add them via cloud HR UI; we sync via /api/biometric-factory/master-data.
  const where = {
    isActive: true,
    deviceUserId: { not: null },
    ...(d.companyId ? { companyId: d.companyId } : {}),
  };
  const [emps, labs] = await Promise.all([
    prisma.cachedEmployee.findMany({
      where,
      select: { firstName: true, lastName: true, deviceUserId: true, cardNumber: true },
    }),
    prisma.cachedLaborWorker.findMany({
      where,
      select: { firstName: true, lastName: true, deviceUserId: true, cardNumber: true },
    }),
  ]);
  const usable = [
    ...emps.map(e => ({
      deviceUserId: e.deviceUserId!,
      name: `${e.firstName} ${e.lastName ?? ''}`.trim(),
      cardNumber: e.cardNumber,
    })),
    ...labs.map(l => ({
      deviceUserId: l.deviceUserId!,
      name: `${l.firstName} ${l.lastName ?? ''}`.trim(),
      cardNumber: l.cardNumber,
    })),
  ];
  if (usable.length === 0) {
    await prisma.cachedBiometricDevice.update({
      where: { id: d.id },
      data: { lastPushAt: new Date() },
    });
    return;
  }

  const BATCH = 100;
  let pushed = 0;
  let failed = 0;
  for (let i = 0; i < usable.length; i += BATCH) {
    const slice = usable.slice(i, i + BATCH);
    try {
      const r = await bridge.bulkUpsertUsers(toRef(d), slice.map(u => ({
        user_id: u.deviceUserId,
        name: u.name,
        privilege: 0,
        card: parseCardNumber(u.cardNumber),
      })));
      pushed += r.ok;
      failed += r.failed;
    } catch (err) {
      failed += slice.length;
      console.warn(`[biometric push ${d.code}] batch ${i / BATCH + 1}: ${err instanceof Error ? err.message : err}`);
    }
  }

  await prisma.cachedBiometricDevice.update({
    where: { id: d.id },
    data: {
      lastPushAt: new Date(),
      lastError: failed > 0 ? `${failed} of ${usable.length} failed on last push` : null,
    },
  });

  if (pushed > 0 || failed > 0) {
    console.log(`[biometric push ${d.code}] pushed=${pushed} failed=${failed}`);
  }
}

export async function getBiometricSchedulerStatus() {
  // Queue depth = how many punches haven't reached the cloud yet. Healthy
  // factory-server should see this drain to 0 within 1-2 sync cycles.
  const [pending, total, devices] = await Promise.all([
    prisma.attendancePunch.count({ where: { cloudSynced: false } }).catch(() => 0),
    prisma.attendancePunch.count().catch(() => 0),
    prisma.cachedBiometricDevice.count().catch(() => 0),
  ]);
  return {
    started: _started,
    lastTickAt: _lastTickAt?.toISOString() ?? null,
    lastError: _lastError,
    inFlight: inFlight.size,
    queueDepth: pending,
    totalPunches: total,
    devicesCount: devices,
  };
}
