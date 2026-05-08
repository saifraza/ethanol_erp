/**
 * Fire-and-forget sync of LaborWorker CRUD events to all active biometric
 * devices. Mirrors employeeDeviceSync.ts but for labor workers.
 *
 * Auto-assigns deviceUserId on first push so a freshly-created labor worker
 * is immediately routable to a device user slot. Uses workerNo prefixed with
 * 'L' to avoid collision with Employee.empNo (which auto-assigns to plain
 * digits) — gives a deviceUserId space like "L1", "L2", "L3".
 */
import prisma from '../config/prisma';
import { bridge } from './biometricBridge';
import { findAvailableDeviceUserId } from './deviceUserIdAllocator';

type Op = 'UPSERT' | 'DELETE';

function parseCardNumber(s: string | null | undefined): number {
  if (!s) return 0;
  const digits = s.replace(/\D/g, '');
  if (!digits) return 0;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) && n > 0 && n <= 4_294_967_295 ? n : 0;
}

export function fireSyncLaborToDevices(laborWorkerId: string, op: Op = 'UPSERT'): void {
  void runSync(laborWorkerId, op).catch(err => {
    console.warn(`[laborWorkerDeviceSync] ${op} ${laborWorkerId} failed:`, err instanceof Error ? err.message : err);
  });
}

async function runSync(laborWorkerId: string, op: Op): Promise<void> {
  const w = await prisma.laborWorker.findUnique({
    where: { id: laborWorkerId },
    select: { id: true, workerCode: true, workerNo: true, firstName: true, lastName: true, isActive: true, deviceUserId: true, cardNumber: true },
  });
  if (!w) return;

  // Auto-assign deviceUserId — derive the numeric part of workerCode and
  // prefix with "L" (e.g. "LW-014" → "L14"). Mirrors employee logic so the
  // device id always matches what's printed on the ERP. ERP-side workerCode
  // stays "LW-014" — only the keypad-typed id is short. Falls back to
  // workerNo if workerCode doesn't match the LW-NNN format.
  if (op === 'UPSERT' && !w.deviceUserId) {
    const codeMatch = w.workerCode?.match(/^LW-(\d+)$/);
    const preferred = codeMatch ? `L${parseInt(codeMatch[1], 10)}` : `L${w.workerNo}`;
    const allocated = await findAvailableDeviceUserId(preferred, 'LABOR', w.id);
    if (!allocated) {
      console.warn(`[laborWorkerDeviceSync] could not allocate deviceUserId for ${w.workerCode}`);
      return;
    }
    await prisma.laborWorker.update({ where: { id: w.id }, data: { deviceUserId: allocated } });
    w.deviceUserId = allocated;
  }

  if (!w.deviceUserId) return;

  // Skip factoryManaged devices — same reasoning as employeeDeviceSync:
  // factory-server's autoPush picks up new labor on its master-data tick.
  const devices = await prisma.biometricDevice.findMany({
    where: { active: true, factoryManaged: false },
    select: { code: true, ip: true, port: true, password: true },
  });
  if (devices.length === 0) return;

  const fullName = `${w.firstName} ${w.lastName ?? ''}`.trim();

  for (const d of devices) {
    const ref = { ip: d.ip, port: d.port, password: d.password, timeout: 10 };
    try {
      if (op === 'DELETE' || !w.isActive) {
        await bridge.deleteUser(ref, w.deviceUserId);
      } else {
        await bridge.upsertUser(ref, {
          user_id: w.deviceUserId,
          name: fullName,
          privilege: 0,
          card: parseCardNumber(w.cardNumber),
        });
      }
    } catch (err: unknown) {
      console.warn(`[laborWorkerDeviceSync] device ${d.code} ${op} ${w.workerCode}: ${err instanceof Error ? err.message : err}`);
    }
  }
}
