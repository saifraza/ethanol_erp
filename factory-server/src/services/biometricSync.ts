/**
 * Cloud-bound biometric sync.
 *
 * Two functions, both invoked from syncWorker.ts on its existing cadence:
 *   - pushBiometricPunches(): batch-uploads any AttendancePunch rows where
 *     cloudSynced=false, marks them synced on success.
 *   - pullBiometricMasterData(): refreshes CachedEmployee / CachedLaborWorker
 *     / CachedBiometricDevice from the cloud's master-data endpoint.
 *
 * Both endpoints live under /api/biometric-factory and authenticate via the
 * same X-WB-Key the weighbridge sync uses. If the cloud is unreachable, the
 * unsync'd rows simply queue up — no data loss, replays on next cycle.
 */

import prisma from '../prisma';
import { config } from '../config';

const BATCH = 200;

interface PushResp {
  ok: boolean;
  acceptedCount: number;
  accepted: string[];
  failed: Array<{ factoryPunchId: string; error: string }>;
}

export async function pushBiometricPunches(): Promise<{ synced: number; failed: number }> {
  const rows = await prisma.attendancePunch.findMany({
    where: { cloudSynced: false },
    orderBy: { createdAt: 'asc' },
    take: BATCH,
  });
  if (rows.length === 0) return { synced: 0, failed: 0 };

  // Fetch device heartbeats: one per distinct deviceCode, with the latest
  // pull timestamp. Sent alongside punches so the cloud can flag the device
  // as alive even when no new punches happened in this cycle.
  const devices = await prisma.cachedBiometricDevice.findMany({
    select: { code: true, lastPullAt: true },
  });
  const deviceHeartbeats = devices
    .filter(d => d.lastPullAt)
    .map(d => ({ deviceCode: d.code, lastPullAt: d.lastPullAt!.toISOString() }));

  const punches = rows.map(r => ({
    factoryPunchId: r.id,
    deviceCode: r.deviceCode,
    deviceUserId: r.deviceUserId,
    punchAt: r.punchAt.toISOString(),
    direction: (['IN', 'OUT', 'AUTO'] as const).includes(r.direction as 'IN' | 'OUT' | 'AUTO')
      ? (r.direction as 'IN' | 'OUT' | 'AUTO')
      : 'AUTO',
  }));

  try {
    const res = await fetch(`${config.cloudErpUrl}/biometric-factory/punches/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-WB-Key': config.cloudApiKey },
      body: JSON.stringify({ punches, deviceHeartbeats }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.error(`[BIO-SYNC] Cloud ${res.status}: ${txt.slice(0, 200)}`);
      // Stamp error on each row so admin sees what happened
      await prisma.attendancePunch.updateMany({
        where: { id: { in: rows.map(r => r.id) } },
        data: { cloudError: `${res.status}: ${txt.slice(0, 200)}`, syncAttempts: { increment: 1 } },
      });
      return { synced: 0, failed: rows.length };
    }
    const body = await res.json() as PushResp;
    const acceptedSet = new Set(body.accepted ?? []);
    const okIds: string[] = [];
    const errIds: string[] = [];
    for (const r of rows) {
      if (acceptedSet.has(r.id)) okIds.push(r.id);
      else errIds.push(r.id);
    }
    if (okIds.length > 0) {
      await prisma.attendancePunch.updateMany({
        where: { id: { in: okIds } },
        data: { cloudSynced: true, cloudSyncedAt: new Date(), cloudError: null, syncAttempts: { increment: 1 } },
      });
    }
    if (errIds.length > 0) {
      const errMap = new Map(body.failed?.map(f => [f.factoryPunchId, f.error]) ?? []);
      // Stamp the cloud's error message per row when available
      for (const id of errIds) {
        const msg = errMap.get(id) || 'not in cloud accepted list';
        await prisma.attendancePunch.update({
          where: { id },
          data: { cloudError: msg, syncAttempts: { increment: 1 } },
        }).catch(() => {});
      }
    }
    return { synced: okIds.length, failed: errIds.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[BIO-SYNC] Push threw: ${msg}`);
    await prisma.attendancePunch.updateMany({
      where: { id: { in: rows.map(r => r.id) } },
      data: { cloudError: msg, syncAttempts: { increment: 1 } },
    });
    return { synced: 0, failed: rows.length };
  }
}

interface MasterDataResp {
  ok: boolean;
  at: string;
  employees: Array<{
    id: string; empCode: string | null; empNo: number | null;
    firstName: string; lastName: string | null;
    deviceUserId: string | null; cardNumber: string | null;
    companyId: string | null; isActive: boolean;
  }>;
  laborWorkers: Array<{
    id: string; workerCode: string | null; workerNo: number | null;
    firstName: string; lastName: string | null;
    deviceUserId: string | null; cardNumber: string | null;
    companyId: string | null; isActive: boolean;
  }>;
  devices: Array<{
    id: string; code: string; name: string; location: string | null;
    ip: string; port: number; password: number;
    autoPullMinutes: number; autoPushMinutes: number;
    companyId: string | null;
  }>;
}

export async function pullBiometricMasterData(): Promise<{
  employees: number;
  laborWorkers: number;
  devices: number;
}> {
  const res = await fetch(`${config.cloudErpUrl}/biometric-factory/master-data`, {
    headers: { 'X-WB-Key': config.cloudApiKey },
  });
  if (!res.ok) throw new Error(`cloud ${res.status}`);
  const data = await res.json() as MasterDataResp;

  await prisma.$transaction(async (tx) => {
    for (const e of data.employees ?? []) {
      await tx.cachedEmployee.upsert({
        where: { id: e.id },
        create: {
          id: e.id, empCode: e.empCode, empNo: e.empNo,
          firstName: e.firstName, lastName: e.lastName,
          deviceUserId: e.deviceUserId, cardNumber: e.cardNumber,
          companyId: e.companyId, isActive: e.isActive,
        },
        update: {
          empCode: e.empCode, empNo: e.empNo,
          firstName: e.firstName, lastName: e.lastName,
          deviceUserId: e.deviceUserId, cardNumber: e.cardNumber,
          companyId: e.companyId, isActive: e.isActive,
          updatedAt: new Date(),
        },
      });
    }
    for (const l of data.laborWorkers ?? []) {
      await tx.cachedLaborWorker.upsert({
        where: { id: l.id },
        create: {
          id: l.id, workerCode: l.workerCode, workerNo: l.workerNo,
          firstName: l.firstName, lastName: l.lastName,
          deviceUserId: l.deviceUserId, cardNumber: l.cardNumber,
          companyId: l.companyId, isActive: l.isActive,
        },
        update: {
          workerCode: l.workerCode, workerNo: l.workerNo,
          firstName: l.firstName, lastName: l.lastName,
          deviceUserId: l.deviceUserId, cardNumber: l.cardNumber,
          companyId: l.companyId, isActive: l.isActive,
          updatedAt: new Date(),
        },
      });
    }
    for (const d of data.devices ?? []) {
      await tx.cachedBiometricDevice.upsert({
        where: { id: d.id },
        create: {
          id: d.id, code: d.code, name: d.name, location: d.location,
          ip: d.ip, port: d.port, password: d.password,
          autoPullMinutes: d.autoPullMinutes, autoPushMinutes: d.autoPushMinutes,
          companyId: d.companyId,
        },
        update: {
          code: d.code, name: d.name, location: d.location,
          ip: d.ip, port: d.port, password: d.password,
          autoPullMinutes: d.autoPullMinutes, autoPushMinutes: d.autoPushMinutes,
          companyId: d.companyId,
          updatedAt: new Date(),
        },
      });
    }
  });

  return {
    employees: data.employees?.length || 0,
    laborWorkers: data.laborWorkers?.length || 0,
    devices: data.devices?.length || 0,
  };
}
