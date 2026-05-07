/**
 * Machine-to-machine biometric endpoints for the factory-server PC.
 *
 * Auth: X-WB-Key header (timing-safe). Same key the weighbridge sync uses,
 * shared via WB_PUSH_KEY env var on Railway.
 *
 * Two endpoints:
 *   POST /punches/push       — factory pushes a batch of attendance punches
 *   GET  /master-data        — factory pulls Employees + LaborWorkers + Devices
 *
 * Architecture: when BiometricDevice.factoryManaged = true, the factory-server
 * pulls punches from the device into its own Postgres, batches them here every
 * minute, and the cloud's biometricScheduler.ts skips that device entirely. If
 * the factory-server is offline, an admin can flip factoryManaged off and the
 * cloud takes over.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { asyncHandler } from '../shared/middleware';
import prisma from '../config/prisma';

const router = Router();

const WB_PUSH_KEY = process.env.WB_PUSH_KEY || 'mspil-wb-2026';

function checkWBKey(req: Request, res: Response): boolean {
  const key = (req.headers['x-wb-key'] as string) || '';
  if (!key || key.length !== WB_PUSH_KEY.length) {
    res.status(401).json({ error: 'Invalid factory push key' });
    return false;
  }
  const a = Buffer.from(key, 'utf8');
  const b = Buffer.from(WB_PUSH_KEY, 'utf8');
  if (!crypto.timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'Invalid factory push key' });
    return false;
  }
  return true;
}

// ════════════════════════════════════════════════════════════════
// POST /punches/push — factory-server posts a batch of punches
// ════════════════════════════════════════════════════════════════
//
// Idempotent on (deviceId, punchAt, employeeId|laborWorkerId, direction):
// duplicate batches don't double-insert. Returns acceptedCount + the
// composite keys the cloud accepted, so the factory-server can mark
// just those rows as cloudSynced=true.

const punchSchema = z.object({
  factoryPunchId: z.string().min(1), // factory-side PK; we ack by this
  deviceCode: z.string().min(1),
  deviceUserId: z.string().min(1),
  punchAt: z.string(), // ISO
  direction: z.enum(['IN', 'OUT', 'AUTO']).default('AUTO'),
});

const pushSchema = z.object({
  punches: z.array(punchSchema).max(500),
  // Per-device summary: factory-server reports the latest punch timestamp
  // it has from each device, even if the punches array is empty (heartbeat).
  // We use this to update BiometricDevice.lastFactorySyncAt so the cloud
  // scheduler knows which devices the factory is currently driving.
  deviceHeartbeats: z.array(z.object({
    deviceCode: z.string().min(1),
    lastPullAt: z.string(), // ISO
  })).default([]),
});

router.post('/punches/push', asyncHandler(async (req: Request, res: Response) => {
  if (!checkWBKey(req, res)) return;

  const parse = pushSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid payload', issues: parse.error.issues });
    return;
  }
  const body = parse.data;

  const accepted: string[] = [];
  const failed: Array<{ factoryPunchId: string; error: string }> = [];

  // Pre-resolve deviceUserId → Employee/LaborWorker once per batch
  const userIds = [...new Set(body.punches.map(p => p.deviceUserId))];
  const [employees, laborWorkers] = userIds.length > 0
    ? await Promise.all([
        prisma.employee.findMany({
          where: { deviceUserId: { in: userIds } },
          select: { id: true, deviceUserId: true, companyId: true },
        }),
        prisma.laborWorker.findMany({
          where: { deviceUserId: { in: userIds } },
          select: { id: true, deviceUserId: true, companyId: true },
        }),
      ])
    : [[], []];
  const empByDev = new Map(employees.map(e => [e.deviceUserId!, e]));
  const lwByDev = new Map(laborWorkers.map(l => [l.deviceUserId!, l]));

  // Pre-resolve deviceCode → BiometricDevice.companyId for fallback
  const deviceCodes = [...new Set([
    ...body.punches.map(p => p.deviceCode),
    ...body.deviceHeartbeats.map(h => h.deviceCode),
  ])];
  const devices = deviceCodes.length > 0
    ? await prisma.biometricDevice.findMany({
        where: { code: { in: deviceCodes } },
        select: { id: true, code: true, companyId: true },
      })
    : [];
  const devByCode = new Map(devices.map(d => [d.code, d]));

  for (const p of body.punches) {
    const emp = empByDev.get(p.deviceUserId);
    const lw = lwByDev.get(p.deviceUserId);
    const dev = devByCode.get(p.deviceCode);

    // Unmapped users land in AttendancePunch with rawEmpCode set so admins
    // can map them later via the Biometric Devices → User Mapping tab.
    // Both employeeId and laborWorkerId stay null. Same behavior as the
    // cloud-led pull path — keeps the data structure consistent.

    const punchAt = new Date(p.punchAt);
    if (isNaN(punchAt.getTime())) {
      failed.push({ factoryPunchId: p.factoryPunchId, error: 'invalid punchAt' });
      continue;
    }

    try {
      // Dedup: same (deviceCode, deviceUserId, punchAt) shouldn't double.
      // Match the cloud-led scheduler's dedup logic (employee/labor + punchAt + deviceId).
      const existing = await prisma.attendancePunch.findFirst({
        where: emp
          ? { employeeId: emp.id, punchAt, deviceId: p.deviceCode }
          : lw
          ? { laborWorkerId: lw.id, punchAt, deviceId: p.deviceCode }
          : { rawEmpCode: p.deviceUserId, punchAt, deviceId: p.deviceCode },
        select: { id: true },
      });
      if (existing) {
        accepted.push(p.factoryPunchId);
        continue;
      }

      await prisma.attendancePunch.create({
        data: {
          employeeId: emp?.id ?? null,
          laborWorkerId: lw?.id ?? null,
          punchAt,
          direction: p.direction,
          source: 'DEVICE',
          deviceId: p.deviceCode,
          rawEmpCode: p.deviceUserId,
          companyId: (emp?.companyId ?? lw?.companyId) ?? dev?.companyId ?? null,
        },
      });
      accepted.push(p.factoryPunchId);
    } catch (err: unknown) {
      failed.push({
        factoryPunchId: p.factoryPunchId,
        error: err instanceof Error ? err.message : 'insert failed',
      });
    }
  }

  // Heartbeat: bump lastFactorySyncAt for each device the factory reports.
  // Done even if the punches array was empty — that's a "still alive" signal.
  for (const h of body.deviceHeartbeats) {
    const dev = devByCode.get(h.deviceCode);
    if (!dev) continue;
    const ts = new Date(h.lastPullAt);
    if (isNaN(ts.getTime())) continue;
    await prisma.biometricDevice.update({
      where: { id: dev.id },
      data: { lastFactorySyncAt: ts, lastSyncStatus: 'OK' },
    }).catch(() => {});
  }

  res.json({
    ok: true,
    acceptedCount: accepted.length,
    accepted,
    failed,
  });
}));

// ════════════════════════════════════════════════════════════════
// GET /master-data — factory pulls cached Employees + Labor + Devices
// ════════════════════════════════════════════════════════════════
//
// Slim payload: only the fields the factory-server needs to (a) resolve
// punch deviceUserId → Employee/Labor, and (b) push the user list to
// devices on its own schedule.

router.get('/master-data', asyncHandler(async (req: Request, res: Response) => {
  if (!checkWBKey(req, res)) return;

  const [employees, laborWorkers, devices] = await Promise.all([
    prisma.employee.findMany({
      where: { isActive: true },
      select: {
        id: true, empCode: true, empNo: true,
        firstName: true, lastName: true,
        deviceUserId: true, cardNumber: true,
        companyId: true, isActive: true,
      },
      take: 5000,
    }),
    prisma.laborWorker.findMany({
      where: { isActive: true },
      select: {
        id: true, workerCode: true, workerNo: true,
        firstName: true, lastName: true,
        deviceUserId: true, cardNumber: true,
        companyId: true, isActive: true,
      },
      take: 5000,
    }),
    prisma.biometricDevice.findMany({
      where: { active: true, factoryManaged: true },
      select: {
        id: true, code: true, name: true, location: true,
        ip: true, port: true, password: true,
        autoPullMinutes: true, autoPushMinutes: true,
        companyId: true,
      },
    }),
  ]);

  res.json({
    ok: true,
    at: new Date().toISOString(),
    employees,
    laborWorkers,
    devices,
  });
}));

export default router;
