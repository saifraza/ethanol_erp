/**
 * HTTP client for the local biometric-bridge (Python pyzk wrapper).
 *
 * The factory-server scheduler uses this to pull punches from each
 * eSSL device and push the employee/labor list back. Both the scheduler
 * and the bridge run on the same factory PC, so this hits 127.0.0.1:5005
 * by default — no network hop.
 *
 * Configured via:
 *   BIOMETRIC_BRIDGE_URL   — defaults to http://127.0.0.1:5005
 *   BIOMETRIC_BRIDGE_KEY   — must match the bridge's .env
 *
 * Mirrors backend/src/services/biometricBridge.ts but with only the
 * endpoints the scheduler needs. Keep the wire-shape in sync.
 */

import { config } from '../config';

const BRIDGE_URL = config.biometricBridgeUrl;
const BRIDGE_KEY = config.biometricBridgeKey;

export interface DeviceRef {
  ip: string;
  port?: number;
  password?: number;
  timeout?: number;
}

export interface BridgePunch {
  user_id: string;
  punch_at: string; // ISO UTC
  status: number;
  punch: number;
}

async function call<T>(path: string, body: unknown, timeoutMs = 15_000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BRIDGE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bridge-Key': BRIDGE_KEY,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`bridge ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json() as Promise<T>;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`bridge timeout after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

export async function bridgeHealth(): Promise<{ ok: boolean; service: string; key_set: boolean }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(`${BRIDGE_URL}/health`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`bridge ${res.status}`);
    return (await res.json()) as { ok: boolean; service: string; key_set: boolean };
  } finally {
    clearTimeout(t);
  }
}

export const bridge = {
  async pullPunches(
    device: DeviceRef,
    since?: string,
    clear_after = false,
  ): Promise<{ count: number; punches: BridgePunch[] }> {
    return call('/devices/punches/pull', { device, since, clear_after }, 60_000);
  },
  async bulkUpsertUsers(
    device: DeviceRef,
    users: Array<{ user_id: string; name: string; privilege?: number; card?: number }>,
  ): Promise<{ total: number; ok: number; failed: number }> {
    const usersWithDevice = users.map(u => ({ device, ...u }));
    return call('/devices/users/bulk-upsert', { device, users: usersWithDevice }, 120_000);
  },
  async deleteUser(
    device: DeviceRef,
    user_id: string,
  ): Promise<{ ok: boolean; deleted_uid?: number; skipped?: string }> {
    return call('/devices/users/delete', { device, user_id });
  },
};
