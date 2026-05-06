/**
 * Background scheduler for biometric devices.
 *
 * Each BiometricDevice has two configurable intervals (in minutes, 0=disabled):
 *   - autoPullMinutes  → pulls new punches from device, writes AttendancePunch
 *   - autoPushMinutes  → pushes ERP employee list to device (bulk-upsert)
 *
 * On server boot, startBiometricScheduler() schedules a tick every 60 seconds.
 * Each tick: query devices, find which are due, kick off async work. In-flight
 * jobs are tracked in a Set so a slow device can't get double-fired.
 *
 * Errors are logged but never crash the loop. Production-safe.
 */
import prisma from '../config/prisma';
import { bridge, DeviceRef } from './biometricBridge';

// Track running ops so a slow device doesn't get double-fired
const inFlight = new Set<string>();

/** ERP card number string → device-side 32-bit unsigned int. 0 = no card. */
function parseCardNumber(s: string | null | undefined): number {
  if (!s) return 0;
  const digits = s.replace(/\D/g, '');
  if (!digits) return 0;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) && n > 0 && n <= 4_294_967_295 ? n : 0;
}

function toRef(d: { ip: string; port: number; password: number }): DeviceRef {
  return { ip: d.ip, port: d.port, password: d.password, timeout: 10 };
}

function istDateStr(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`;
}

export function startBiometricScheduler(): void {
  console.log('[biometric-scheduler] starting (60s tick)');
  // Wait 30s after boot to let other init complete, then start ticking
  setTimeout(() => {
    tick().catch(err => console.warn('[biometric-scheduler] tick failed:', err));
    setInterval(() => {
      tick().catch(err => console.warn('[biometric-scheduler] tick failed:', err));
    }, 60_000);
  }, 30_000);
}

async function tick(): Promise<void> {
  const now = new Date();
  const devices = await prisma.biometricDevice.findMany({
    where: {
      active: true,
      OR: [
        { autoPullMinutes: { gt: 0 } },
        { autoPushMinutes: { gt: 0 } },
      ],
    },
    select: {
      id: true, code: true, ip: true, port: true, password: true, companyId: true,
      autoPullMinutes: true, autoPushMinutes: true,
      lastAutoPullAt: true, lastAutoPushAt: true, lastPunchSyncAt: true,
    },
  });

  for (const d of devices) {
    if (d.autoPullMinutes > 0) {
      const due = !d.lastAutoPullAt || (now.getTime() - d.lastAutoPullAt.getTime()) >= d.autoPullMinutes * 60_000;
      const key = `pull|${d.id}`;
      if (due && !inFlight.has(key)) {
        inFlight.add(key);
        autoPull(d).catch(err => console.warn(`[scheduler pull ${d.code}] ${err instanceof Error ? err.message : err}`)).finally(() => inFlight.delete(key));
      }
    }
    if (d.autoPushMinutes > 0) {
      const due = !d.lastAutoPushAt || (now.getTime() - d.lastAutoPushAt.getTime()) >= d.autoPushMinutes * 60_000;
      const key = `push|${d.id}`;
      if (due && !inFlight.has(key)) {
        inFlight.add(key);
        autoPush(d).catch(err => console.warn(`[scheduler push ${d.code}] ${err instanceof Error ? err.message : err}`)).finally(() => inFlight.delete(key));
      }
    }
  }
}

interface DeviceRow {
  id: string;
  code: string;
  ip: string;
  port: number;
  password: number;
  companyId: string | null;
  lastPunchSyncAt: Date | null;
}

async function autoPull(d: DeviceRow): Promise<void> {
  const since = d.lastPunchSyncAt
    ? new Date(d.lastPunchSyncAt.getTime() - 30_000).toISOString()
    : undefined;

  let pulled;
  try {
    pulled = await bridge.pullPunches(toRef(d), since, false);
  } catch (err: unknown) {
    await prisma.biometricDevice.update({
      where: { id: d.id },
      data: { lastSyncStatus: 'ERROR', lastSyncError: err instanceof Error ? err.message : String(err), lastAutoPullAt: new Date() },
    }).catch(() => {});
    return;
  }

  // Resolve user_id → Employee OR LaborWorker
  const userIds = [...new Set(pulled.punches.map(p => p.user_id))];
  const [employees, laborWorkers] = userIds.length > 0
    ? await Promise.all([
        prisma.employee.findMany({ where: { deviceUserId: { in: userIds } }, select: { id: true, deviceUserId: true, companyId: true } }),
        prisma.laborWorker.findMany({ where: { deviceUserId: { in: userIds } }, select: { id: true, deviceUserId: true, companyId: true } }),
      ])
    : [[], []];
  const empByDev = new Map(employees.map(e => [e.deviceUserId!, e]));
  const lwByDev = new Map(laborWorkers.map(l => [l.deviceUserId!, l]));

  let inserted = 0;
  for (const p of pulled.punches) {
    const emp = empByDev.get(p.user_id);
    const lw = lwByDev.get(p.user_id);
    if (!emp && !lw) continue;
    const existing = await prisma.attendancePunch.findFirst({
      where: emp
        ? { employeeId: emp.id, punchAt: new Date(p.punch_at), deviceId: d.code }
        : { laborWorkerId: lw!.id, punchAt: new Date(p.punch_at), deviceId: d.code },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.attendancePunch.create({
      data: {
        employeeId: emp?.id ?? null,
        laborWorkerId: lw?.id ?? null,
        punchAt: new Date(p.punch_at),
        direction: p.punch === 0 ? 'IN' : p.punch === 1 ? 'OUT' : 'AUTO',
        source: 'DEVICE',
        deviceId: d.code,
        rawEmpCode: p.user_id,
        companyId: (emp?.companyId ?? lw?.companyId) ?? d.companyId,
      },
    });
    inserted++;
  }

  await prisma.biometricDevice.update({
    where: { id: d.id },
    data: {
      lastPunchSyncAt: new Date(),
      lastAutoPullAt: new Date(),
      lastSyncStatus: 'OK',
      lastSyncError: null,
    },
  });

  if (inserted > 0) {
    console.log(`[scheduler pull ${d.code}] ${inserted} new punch(es) ingested`);
  }
}

async function autoPush(d: DeviceRow): Promise<void> {
  const [employees, laborWorkers] = await Promise.all([
    prisma.employee.findMany({
      where: { isActive: true, ...(d.companyId ? { companyId: d.companyId } : {}) },
      select: { id: true, empCode: true, empNo: true, firstName: true, lastName: true, deviceUserId: true, cardNumber: true },
      take: 5000,
    }),
    prisma.laborWorker.findMany({
      where: { isActive: true, ...(d.companyId ? { companyId: d.companyId } : {}) },
      select: { id: true, workerCode: true, workerNo: true, firstName: true, lastName: true, deviceUserId: true, cardNumber: true },
      take: 5000,
    }),
  ]);

  // Auto-assign deviceUserId for new records
  for (const e of employees) {
    if (!e.deviceUserId) {
      const candidate = String(e.empNo);
      const taken = await prisma.employee.findFirst({
        where: { deviceUserId: candidate, NOT: { id: e.id } },
        select: { id: true },
      });
      if (!taken) {
        await prisma.employee.update({ where: { id: e.id }, data: { deviceUserId: candidate } });
        e.deviceUserId = candidate;
      }
    }
  }
  for (const l of laborWorkers) {
    if (!l.deviceUserId) {
      const candidate = `L${l.workerNo}`;
      const empCol = await prisma.employee.findFirst({ where: { deviceUserId: candidate }, select: { id: true } });
      const lwCol = await prisma.laborWorker.findFirst({ where: { deviceUserId: candidate, NOT: { id: l.id } }, select: { id: true } });
      if (!empCol && !lwCol) {
        await prisma.laborWorker.update({ where: { id: l.id }, data: { deviceUserId: candidate } });
        l.deviceUserId = candidate;
      }
    }
  }

  const usable: Array<{ user_id: string; name: string; card: number }> = [
    ...employees.filter(e => !!e.deviceUserId).map(e => ({
      user_id: e.deviceUserId!,
      name: `${e.firstName} ${e.lastName}`.trim(),
      card: parseCardNumber(e.cardNumber),
    })),
    ...laborWorkers.filter(l => !!l.deviceUserId).map(l => ({
      user_id: l.deviceUserId!,
      name: `${l.firstName} ${l.lastName ?? ''}`.trim(),
      card: parseCardNumber(l.cardNumber),
    })),
  ];

  if (usable.length === 0) {
    await prisma.biometricDevice.update({ where: { id: d.id }, data: { lastAutoPushAt: new Date() } });
    return;
  }

  const BATCH = 100;
  let pushed = 0;
  let failed = 0;

  for (let i = 0; i < usable.length; i += BATCH) {
    const slice = usable.slice(i, i + BATCH);
    try {
      const r = await bridge.bulkUpsertUsers(toRef(d), slice.map(u => ({
        user_id: u.user_id, name: u.name, privilege: 0, card: u.card,
      })));
      pushed += r.ok;
      failed += r.failed;
    } catch (err: unknown) {
      failed += slice.length;
      console.warn(`[scheduler push ${d.code}] batch ${i / BATCH + 1}: ${err instanceof Error ? err.message : err}`);
    }
  }

  await prisma.biometricDevice.update({
    where: { id: d.id },
    data: {
      lastAutoPushAt: new Date(),
      lastSyncAt: new Date(),
      lastSyncStatus: failed === 0 ? 'OK' : 'ERROR',
    },
  });

  if (pushed > 0 || failed > 0) {
    console.log(`[scheduler push ${d.code}] pushed=${pushed} failed=${failed}`);
  }

  // Suppress reminder
  void istDateStr;
}
