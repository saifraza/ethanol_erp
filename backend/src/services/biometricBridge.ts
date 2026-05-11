/**
 * Wrapper around the biometric-bridge HTTP service (pyzk-based).
 *
 * The cloud backend never talks to fingerprint devices directly. It calls
 * this small wrapper service running on plant LAN (factory-server in prod,
 * dev Mac during testing). All device communication happens there.
 *
 * Configuration:
 *   BIOMETRIC_BRIDGE_URL — defaults to http://localhost:5005 (dev)
 *   BIOMETRIC_BRIDGE_KEY — must match BIOMETRIC_BRIDGE_KEY on bridge side
 */

const BRIDGE_URL = process.env.BIOMETRIC_BRIDGE_URL || 'http://localhost:5005';
const BRIDGE_KEY = process.env.BIOMETRIC_BRIDGE_KEY || '';

/** Subset of BiometricDevice columns the bridge needs to dial out. */
export interface DeviceRef {
  ip: string;
  port?: number;
  password?: number;
  timeout?: number;
}

export interface BridgeUser {
  uid: number;
  user_id: string;
  name: string;
  privilege: number;
  card: number;
  group_id: string;
}

export interface BridgePunch {
  user_id: string;
  punch_at: string; // ISO UTC
  status: number;
  punch: number;
}

export interface DeviceInfoResp {
  firmware: string | null;
  serial: string | null;
  platform: string | null;
  name: string | null;
  time: string | null;
  user_count: number | null;
  log_count: number | null;
}

async function call<T>(path: string, body: any, timeoutMs = 15_000): Promise<T> {
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
  } finally { clearTimeout(t); }
}

export const bridge = {
  async deviceInfo(device: DeviceRef): Promise<DeviceInfoResp> {
    return call<DeviceInfoResp>('/devices/info', { device });
  },
  async listUsers(device: DeviceRef): Promise<{ count: number; users: BridgeUser[] }> {
    return call('/devices/users/list', { device }, 30_000);
  },
  async upsertUser(device: DeviceRef, user: { user_id: string; name: string; privilege?: number; card?: number; uid?: number }): Promise<{ ok: boolean; uid?: number; user_id: string; error?: string }> {
    return call('/devices/users/upsert', { device, ...user });
  },
  async bulkUpsertUsers(
    device: DeviceRef,
    users: Array<{ user_id: string; name: string; privilege?: number; card?: number }>,
  ): Promise<{ total: number; ok: number; failed: number; results: Array<{ ok: boolean; user_id: string; uid?: number; error?: string }> }> {
    // Re-shape: bridge expects each user to carry the device too (Pydantic schema).
    const usersWithDevice = users.map(u => ({ device, ...u }));
    return call('/devices/users/bulk-upsert', { device, users: usersWithDevice }, 120_000);
  },
  async deleteUser(device: DeviceRef, user_id: string): Promise<{ ok: boolean; deleted_uid?: number; skipped?: string }> {
    return call('/devices/users/delete', { device, user_id });
  },
  async enrollUser(device: DeviceRef, user_id: string, finger_id: number = 1): Promise<{ ok: boolean; uid: number }> {
    return call('/devices/users/enroll', { device, user_id, finger_id });
  },
  async pullPunches(device: DeviceRef, since?: string, clear_after = false): Promise<{ count: number; punches: BridgePunch[] }> {
    return call('/devices/punches/pull', { device, since, clear_after }, 60_000);
  },
  async syncTime(device: DeviceRef, set_to?: string): Promise<{ ok: boolean; set_to: string; device_time: string | null }> {
    return call('/devices/time/sync', { device, set_to });
  },
  async clearPunches(device: DeviceRef): Promise<{ ok: boolean; error?: string }> {
    return call('/devices/punches/clear', { device }, 30_000);
  },
  async copyTemplate(src: DeviceRef, dst: DeviceRef, user_id: string, finger_ids?: number[]): Promise<{ ok: boolean; copied_fingers?: number[]; reason?: string }> {
    return call('/devices/templates/copy', { src_device: src, dst_device: dst, user_id, finger_ids }, 60_000);
  },
  /** Map of user_id → enrolled finger ids for every user on the device. Used by
   *  the enrollment-progress page to compute who still owes a fingerprint.
   *  Bridge returns the map under `templates` (not `users` — easy mix-up). */
  async listTemplates(device: DeviceRef): Promise<{ ok: boolean; user_count: number; templates: Record<string, number[]> }> {
    return call('/devices/templates/list', { device }, 120_000);
  },
};
