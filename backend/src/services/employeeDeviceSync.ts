/**
 * Fire-and-forget propagation of Employee CRUD events to all active
 * biometric devices. Called after Employee create/update/deactivate.
 *
 * Errors are caught and logged so device-sync never blocks the API response.
 * If the biometric-bridge is down or a device is offline, the change is lost
 * for that device — admin can re-run "Sync Employees" from the UI.
 *
 * Auto-assigns Employee.deviceUserId = empNo (string) on first push if it's
 * still null, so a fresh employee is automatically pushable to devices.
 */
import prisma from '../config/prisma';
import { bridge } from './biometricBridge';
import { findAvailableDeviceUserId } from './deviceUserIdAllocator';

type Op = 'UPSERT' | 'DELETE';

/** Convert string card number to the unsigned 32-bit int the device expects.
 *  Empty / invalid → 0 (no card). Strips non-digits in case of formatted input. */
function parseCardNumber(s: string | null | undefined): number {
  if (!s) return 0;
  const digits = s.replace(/\D/g, '');
  if (!digits) return 0;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) && n > 0 && n <= 4_294_967_295 ? n : 0;
}

export function fireSyncEmployeeToDevices(employeeId: string, op: Op = 'UPSERT'): void {
  // Detached promise — never throw to the caller
  void runSync(employeeId, op).catch(err => {
    console.warn(`[employeeDeviceSync] ${op} ${employeeId} failed:`, err instanceof Error ? err.message : err);
  });
}

async function runSync(employeeId: string, op: Op): Promise<void> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, empCode: true, empNo: true, firstName: true, lastName: true, isActive: true, deviceUserId: true, cardNumber: true },
  });
  if (!employee) return;

  // Auto-assign deviceUserId if missing — try empNo first, fall back to a
  // high-range slot if there's collision so we never silently skip pushing.
  if (op === 'UPSERT' && !employee.deviceUserId) {
    const allocated = await findAvailableDeviceUserId(String(employee.empNo), 'EMPLOYEE', employee.id);
    if (!allocated) {
      console.warn(`[employeeDeviceSync] could not allocate deviceUserId for ${employee.empCode}`);
      return;
    }
    await prisma.employee.update({ where: { id: employee.id }, data: { deviceUserId: allocated } });
    employee.deviceUserId = allocated;
  }

  if (!employee.deviceUserId) return;

  const devices = await prisma.biometricDevice.findMany({
    where: { active: true },
    select: { code: true, ip: true, port: true, password: true },
  });
  if (devices.length === 0) return;

  const fullName = `${employee.firstName} ${employee.lastName}`.trim();

  for (const d of devices) {
    const ref = { ip: d.ip, port: d.port, password: d.password, timeout: 10 };
    try {
      if (op === 'DELETE' || !employee.isActive) {
        await bridge.deleteUser(ref, employee.deviceUserId);
      } else {
        await bridge.upsertUser(ref, {
          user_id: employee.deviceUserId,
          name: fullName,
          privilege: 0,
          card: parseCardNumber(employee.cardNumber),
        });
      }
    } catch (err: unknown) {
      console.warn(`[employeeDeviceSync] device ${d.code} ${op} ${employee.empCode}: ${err instanceof Error ? err.message : err}`);
    }
  }
}
