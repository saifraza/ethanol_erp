/**
 * Device user_id allocator — finds an available numeric ID for biometric
 * devices, avoiding collisions with both Employee.deviceUserId and
 * LaborWorker.deviceUserId.
 *
 * Strategy:
 *   1. Try the preferred candidate (empCode "MS-XXX" for employees, workerCode
 *      "LW-XXX" for labor) — that gives the device the same human-readable id
 *      as the ERP when there's no clash.
 *   2. On collision, allocate from a high range (≥ 10001) so we never overwrite
 *      a manually-enrolled fingerprint slot on the device. Max existing
 *      numeric deviceUserId + 1 (or 10001, whichever is larger) wins.
 *
 * Why this exists: when bulk-importing 305 device users via "Create All as
 * Employees", deviceUserIds 1-150 got grabbed by the new employee rows. Then
 * MSPIL-006 (empNo=6) was blocked from auto-assign because "6" was taken by
 * a duplicate import — so MSPIL-006 never got pushed to the device. Without
 * this allocator, the system silently dropped real employees off the device
 * roster and required manual cleanup.
 */
import prisma from '../config/prisma';

export type AllocatorKind = 'EMPLOYEE' | 'LABOR';

const HIGH_RANGE_START = 10001;

/** Returns an available deviceUserId or null if even the high-range hunt fails
 *  (which would indicate something is very wrong — millions of records). */
export async function findAvailableDeviceUserId(
  preferred: string,
  excludeKind: AllocatorKind,
  excludeId: string,
): Promise<string | null> {
  // 1. Try preferred — succeeds if no other Employee or LaborWorker holds it
  const collisionEmp = await prisma.employee.findFirst({
    where: {
      deviceUserId: preferred,
      ...(excludeKind === 'EMPLOYEE' ? { NOT: { id: excludeId } } : {}),
    },
    select: { id: true },
  });
  const collisionLabor = await prisma.laborWorker.findFirst({
    where: {
      deviceUserId: preferred,
      ...(excludeKind === 'LABOR' ? { NOT: { id: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (!collisionEmp && !collisionLabor) return preferred;

  // 2. Fallback: max existing numeric + 1, but at least HIGH_RANGE_START
  const [emps, labors] = await Promise.all([
    prisma.employee.findMany({
      where: { deviceUserId: { not: null } },
      select: { deviceUserId: true },
    }),
    prisma.laborWorker.findMany({
      where: { deviceUserId: { not: null } },
      select: { deviceUserId: true },
    }),
  ]);
  const numerics: number[] = [];
  for (const r of [...emps, ...labors]) {
    if (!r.deviceUserId) continue;
    // Pull the first numeric run out of the id — handles "457", "L42",
    // "MS-457", "LW-001" all the same way for max-numeric calculation.
    const m = r.deviceUserId.match(/(\d+)/);
    const n = m ? parseInt(m[1], 10) : NaN;
    if (Number.isFinite(n) && n > 0) numerics.push(n);
  }
  const max = numerics.length > 0 ? Math.max(...numerics) : 0;
  const next = String(Math.max(HIGH_RANGE_START, max + 1));

  // Safety: confirm 'next' isn't somehow already taken (race) — try once
  const recheckEmp = await prisma.employee.findFirst({ where: { deviceUserId: next }, select: { id: true } });
  const recheckLabor = await prisma.laborWorker.findFirst({ where: { deviceUserId: next }, select: { id: true } });
  if (!recheckEmp && !recheckLabor) return next;

  // Extreme fallback: increment until free (max 100 attempts)
  for (let i = 1; i <= 100; i++) {
    const cand = String(parseInt(next, 10) + i);
    const e = await prisma.employee.findFirst({ where: { deviceUserId: cand }, select: { id: true } });
    const l = await prisma.laborWorker.findFirst({ where: { deviceUserId: cand }, select: { id: true } });
    if (!e && !l) return cand;
  }
  return null;
}
