/**
 * Cloud→factory job runner. Polls the cloud's BiometricJob queue every 3s,
 * claims pending jobs, runs them against the local bridge, posts results
 * back. Mirrors the weighbridge "factory pulls master data" pattern — no
 * inbound dependency on a cloud→factory tunnel.
 *
 * Job types (must stay in sync with backend/src/routes/biometric.ts):
 *   - TEST            → bridge.deviceInfo
 *   - PULL_USERS      → bridge.listUsers
 *   - SYNC_TIME       → bridge.syncTime
 *   - UPSERT_USER     → bridge.upsertUser    (payload.user)
 *   - DELETE_USER     → bridge.deleteUser    (payload.user_id)
 *   - PULL_PUNCHES    → bridge.pullPunches   (payload.since, payload.clear_after)
 *   - SYNC_EMPLOYEES  → bridge.bulkUpsertUsers (payload.users)
 *
 * Failures: errors are returned to the cloud as { status: 'FAILED', error }.
 * The cloud increments `attempts` on every claim — so a job that fails 3
 * times stays CLAIMED and won't be re-picked. Manual retry: admin clicks
 * the button again, which creates a fresh job.
 */

import { config } from '../config';
import { bridge, DeviceRef } from './biometricBridge';

const POLL_INTERVAL_MS = 3000;
let _started = false;
let _lastPollAt: Date | null = null;
let _lastError: string | null = null;
let _executedCount = 0;

interface ClaimedJob {
  id: string;
  type: string;
  deviceId: string;
  payload: string | null;
  attempts: number;
  maxAttempts: number;
  device: { id: string; code: string; ip: string; port: number; password: number } | null;
}

export function startBiometricJobRunner(): void {
  if (_started) return;
  if (!config.biometricBridgeKey) {
    console.log('[biometric-jobs] BIOMETRIC_BRIDGE_KEY not set — job runner disabled');
    return;
  }
  _started = true;
  console.log('[biometric-jobs] starting (3s poll)');
  // 20s warmup so syncWorker / masterDataCache settle first
  setTimeout(() => {
    void poll();
    setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
  }, 20_000);
}

async function poll(): Promise<void> {
  _lastPollAt = new Date();
  let claimed: ClaimedJob[] = [];
  try {
    const res = await fetch(`${config.cloudErpUrl}/biometric-factory/jobs/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-WB-Key': config.cloudApiKey },
      body: JSON.stringify({ max: 5, factoryNode: 'factory-server' }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      _lastError = `claim ${res.status}: ${txt.slice(0, 120)}`;
      return;
    }
    const body = await res.json() as { ok: boolean; jobs: ClaimedJob[] };
    claimed = body.jobs ?? [];
    _lastError = null;
  } catch (err) {
    _lastError = err instanceof Error ? err.message : String(err);
    return;
  }

  if (claimed.length === 0) return;

  for (const job of claimed) {
    if (!job.device) {
      await postResult(job.id, 'FAILED', undefined, 'device row missing');
      continue;
    }
    try {
      const result = await runJob(job, toRef(job.device));
      await postResult(job.id, 'DONE', result, null);
      _executedCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[biometric-jobs] ${job.type} ${job.device.code} FAILED: ${msg}`);
      await postResult(job.id, 'FAILED', undefined, msg);
    }
  }
}

function toRef(d: { ip: string; port: number; password: number }): DeviceRef {
  return { ip: d.ip, port: d.port, password: d.password, timeout: 10 };
}

async function runJob(job: ClaimedJob, ref: DeviceRef): Promise<unknown> {
  const payload = job.payload ? JSON.parse(job.payload) : {};
  switch (job.type) {
    case 'TEST':
      // Reuse the bridge's /devices/info endpoint
      return await callBridge('/devices/info', { device: ref });

    case 'PULL_USERS':
      return await callBridge('/devices/users/list', { device: ref }, 30_000);

    case 'SYNC_TIME':
      return await callBridge('/devices/time/sync', { device: ref, set_to: payload.set_to });

    case 'UPSERT_USER':
      return await callBridge('/devices/users/upsert', { device: ref, ...payload });

    case 'DELETE_USER':
      return await callBridge('/devices/users/delete', { device: ref, user_id: payload.user_id });

    case 'PULL_PUNCHES':
      return await bridge.pullPunches(ref, payload.since, !!payload.clear_after);

    case 'SYNC_EMPLOYEES':
      // Same pipeline as autoPush — admin-triggered full sync to one device
      return await bridge.bulkUpsertUsers(ref, payload.users ?? []);

    default:
      throw new Error(`unknown job type: ${job.type}`);
  }
}

/** Direct bridge call for endpoints not in the lean factory-side bridge module. */
async function callBridge<T = unknown>(path: string, body: unknown, timeoutMs = 15_000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.biometricBridgeUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bridge-Key': config.biometricBridgeKey },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`bridge ${res.status}: ${txt.slice(0, 200)}`);
    }
    return await res.json() as T;
  } finally {
    clearTimeout(t);
  }
}

async function postResult(
  id: string,
  status: 'DONE' | 'FAILED',
  result: unknown | undefined,
  error: string | null,
): Promise<void> {
  try {
    await fetch(`${config.cloudErpUrl}/biometric-factory/jobs/${id}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-WB-Key': config.cloudApiKey },
      body: JSON.stringify({ status, result, error }),
    });
  } catch (err) {
    console.warn(`[biometric-jobs] postResult ${id} failed: ${err instanceof Error ? err.message : err}`);
  }
}

export function getBiometricJobRunnerStatus() {
  return {
    started: _started,
    lastPollAt: _lastPollAt?.toISOString() ?? null,
    lastError: _lastError,
    executedTotal: _executedCount,
  };
}
