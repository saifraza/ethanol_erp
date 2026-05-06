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

type Op = 'UPSERT' | 'DELETE';

export function fireSyncEmployeeToDevices(employeeId: string, op: Op = 'UPSERT'): void {
  // Detached promise — never throw to the caller
  void runSync(employeeId, op).catch(err => {
    console.warn(`[employeeDeviceSync] ${op} ${employeeId} failed:`, err instanceof Error ? err.message : err);
  });
}

async function runSync(employeeId: string, op: Op): Promise<void> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, empCode: true, empNo: true, firstName: true, lastName: true, isActive: true, deviceUserId: true },
  });
  if (!employee) return;

  // Auto-assign deviceUserId if missing (use empNo as a stable small int)
  if (op === 'UPSERT' && !employee.deviceUserId) {
    const candidate = String(employee.empNo);
    const taken = await prisma.employee.findFirst({
      where: { deviceUserId: candidate, NOT: { id: employee.id } },
      select: { id: true },
    });
    if (!taken) {
      await prisma.employee.update({ where: { id: employee.id }, data: { deviceUserId: candidate } });
      employee.deviceUserId = candidate;
    } else {
      // Collision — admin must resolve via mapping UI; skip device push
      console.warn(`[employeeDeviceSync] deviceUserId collision for ${employee.empCode} (empNo=${employee.empNo}); skipping push`);
      return;
    }
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
        });
      }
    } catch (err: unknown) {
      console.warn(`[employeeDeviceSync] device ${d.code} ${op} ${employee.empCode}: ${err instanceof Error ? err.message : err}`);
    }
  }
}
