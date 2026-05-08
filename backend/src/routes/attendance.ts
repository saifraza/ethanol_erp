import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { NotFoundError } from '../shared/errors';

const router = Router();
router.use(authenticate);

// IST = UTC + 5:30
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function nowIST(): Date { return new Date(Date.now() + IST_OFFSET_MS); }

/** Given a JS Date (UTC instant), return the calendar Y/M/D in IST. */
function istYMD(d: Date): { y: number; m: number; day: number } {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return { y: ist.getUTCFullYear(), m: ist.getUTCMonth() + 1, day: ist.getUTCDate() };
}

/** Build a UTC instant from an IST date string "YYYY-MM-DD" + "HH:MM" time. */
function istToUtc(dateStr: string, hhmm: string): Date {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  // IST instant = UTC + 5:30 → UTC = IST - 5:30
  return new Date(Date.UTC(y, mo - 1, d, hh, mm) - IST_OFFSET_MS);
}

/** YYYY-MM-DD string in IST for a Date. */
function istDateStr(d: Date): string {
  const { y, m, day } = istYMD(d);
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Iterate dates [from, to] inclusive (both as YYYY-MM-DD IST strings). */
function* iterDates(from: string, to: string): Generator<string> {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  let cur = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  while (cur <= end) {
    const dt = new Date(cur);
    yield `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
    cur += 24 * 60 * 60 * 1000;
  }
}

// ════════════════════════════════════════════════════════════════
// SHIFTS
// ════════════════════════════════════════════════════════════════

const shiftSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'HH:MM 24h'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'HH:MM 24h'),
  graceMinutes: z.number().int().min(0).max(120).default(15),
  earlyOutMinutes: z.number().int().min(0).max(120).default(15),
  hours: z.number().positive().max(24).default(8),
  active: z.boolean().default(true),
});

router.get('/shifts', asyncHandler(async (req: AuthRequest, res: Response) => {
  const shifts = await prisma.shift.findMany({
    where: { ...getCompanyFilter(req) },
    orderBy: [{ active: 'desc' }, { code: 'asc' }],
    take: 100,
  });
  res.json(shifts);
}));

router.post('/shifts', authorize('ADMIN'), validate(shiftSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const shift = await prisma.shift.create({
    data: { ...req.body, companyId: getActiveCompanyId(req) },
  });
  res.status(201).json(shift);
}));

router.put('/shifts/:id', authorize('ADMIN'), validate(shiftSchema.partial()), asyncHandler(async (req: AuthRequest, res: Response) => {
  const shift = await prisma.shift.update({ where: { id: req.params.id }, data: req.body });
  res.json(shift);
}));

router.delete('/shifts/:id', authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  // Soft delete — preserve history
  await prisma.shift.update({ where: { id: req.params.id }, data: { active: false } });
  res.json({ ok: true });
}));

// ════════════════════════════════════════════════════════════════
// PUNCHES
// ════════════════════════════════════════════════════════════════

const punchSchema = z.object({
  employeeId: z.string().min(1),
  punchAt: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)),
  direction: z.enum(['IN', 'OUT', 'AUTO']).default('AUTO'),
  notes: z.string().optional(),
  source: z.enum(['DEVICE', 'MANUAL', 'IMPORT']).default('MANUAL'),
});

router.get('/punches', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { employeeId, from, to, source } = req.query as Record<string, string | undefined>;
  const where: any = { ...getCompanyFilter(req) };
  if (employeeId) where.employeeId = employeeId;
  if (source) where.source = source;
  if (from || to) {
    where.punchAt = {};
    if (from) where.punchAt.gte = new Date(from);
    if (to) where.punchAt.lte = new Date(to);
  }

  const take = Math.min(parseInt(req.query.limit as string) || 200, 1000);
  const punches = await prisma.attendancePunch.findMany({
    where,
    orderBy: { punchAt: 'desc' },
    take,
    select: {
      id: true, employeeId: true, punchAt: true, direction: true, source: true,
      deviceId: true, notes: true, createdAt: true,
      employee: { select: { id: true, empCode: true, firstName: true, lastName: true } },
    },
  });

  // Enrich with device code + location so the daily page can show
  // "Main gate" instead of a raw cuid. The deviceId field is a string
  // (no Prisma relation), so do the lookup separately.
  const deviceIds = [...new Set(punches.map(p => p.deviceId).filter((x): x is string => Boolean(x)))];
  const devices = deviceIds.length > 0
    ? await prisma.biometricDevice.findMany({
        where: { id: { in: deviceIds } },
        select: { id: true, code: true, name: true, location: true },
      })
    : [];
  const devMap = new Map(devices.map(d => [d.id, d]));
  const enriched = punches.map(p => ({
    ...p,
    deviceCode: p.deviceId ? devMap.get(p.deviceId)?.code ?? null : null,
    deviceLocation: p.deviceId ? devMap.get(p.deviceId)?.location ?? null : null,
    deviceName: p.deviceId ? devMap.get(p.deviceId)?.name ?? null : null,
  }));
  res.json(enriched);
}));

/**
 * Labor-side equivalent of /punches. Same enrichment shape, but joins
 * LaborWorker instead of Employee. Mirrors the employee endpoint so the
 * frontend can render with the same component shell.
 *
 * Filters: laborWorkerId, from, to (ISO instants).
 */
router.get('/labor-punches', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { laborWorkerId, from, to, source } = req.query as Record<string, string | undefined>;
  const where: any = { ...getCompanyFilter(req), laborWorkerId: { not: null } };
  if (laborWorkerId) where.laborWorkerId = laborWorkerId;
  if (source) where.source = source;
  if (from || to) {
    where.punchAt = {};
    if (from) where.punchAt.gte = new Date(from);
    if (to) where.punchAt.lte = new Date(to);
  }

  const take = Math.min(parseInt(req.query.limit as string) || 200, 1000);
  const punches = await prisma.attendancePunch.findMany({
    where,
    orderBy: { punchAt: 'desc' },
    take,
    select: {
      id: true, laborWorkerId: true, punchAt: true, direction: true, source: true,
      deviceId: true, notes: true, createdAt: true,
      laborWorker: { select: { id: true, workerCode: true, firstName: true, lastName: true } },
    },
  });

  // deviceId stores the device CODE (e.g. "MSPIL"), not a cuid — see
  // biometricFactory.ts where punches are inserted. Look up by code.
  const deviceCodes = [...new Set(punches.map(p => p.deviceId).filter((x): x is string => Boolean(x)))];
  const devices = deviceCodes.length > 0
    ? await prisma.biometricDevice.findMany({
        where: { code: { in: deviceCodes } },
        select: { code: true, name: true, location: true },
      })
    : [];
  const devMap = new Map(devices.map(d => [d.code, d]));
  const enriched = punches.map(p => ({
    ...p,
    deviceCode: p.deviceId ?? null,
    deviceLocation: p.deviceId ? devMap.get(p.deviceId)?.location ?? null : null,
    deviceName: p.deviceId ? devMap.get(p.deviceId)?.name ?? null : null,
  }));
  res.json(enriched);
}));

/**
 * Daily labor attendance: one row per active labor worker for the given date
 * (default = today IST), with first IN, last OUT, and total hours derived
 * from the dedup'd same-day punches. Used by the HR Labor Attendance page
 * and the Manpower Supply WO tab widget.
 *
 * Only labor with at least one punch in the day window are returned.
 *
 * Filters: date (YYYY-MM-DD, IST), workOrderId (when embedded in WO tab —
 * filters to labor whose Employee.contractorId matches the contract's vendor;
 * deferred until LaborWorker.contractorId / workOrderId is wired through).
 */
router.get('/labor-daily', asyncHandler(async (req: AuthRequest, res: Response) => {
  const dateStr = (req.query.date as string) || istDateStr(new Date());
  // Day window in IST → UTC
  const dayStartUtc = istToUtc(dateStr, '00:00');
  const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 60 * 60_000);

  const punches = await prisma.attendancePunch.findMany({
    where: {
      ...getCompanyFilter(req),
      laborWorkerId: { not: null },
      punchAt: { gte: dayStartUtc, lt: dayEndUtc },
    },
    orderBy: { punchAt: 'asc' },
    select: {
      id: true, punchAt: true, direction: true, deviceId: true,
      laborWorker: { select: { id: true, workerCode: true, firstName: true, lastName: true } },
    },
  });

  // Group by labor + dedup same-device re-taps within 30s
  const DEDUP_MS = 30_000;
  const byLabor = new Map<string, typeof punches>();
  for (const p of punches) {
    if (!p.laborWorker) continue;
    const arr = byLabor.get(p.laborWorker.id) ?? [];
    const prev = arr[arr.length - 1];
    if (prev && prev.deviceId === p.deviceId
        && p.punchAt.getTime() - prev.punchAt.getTime() < DEDUP_MS) {
      continue;
    }
    arr.push(p);
    byLabor.set(p.laborWorker.id, arr);
  }

  // Device code → location map for nicer rendering
  const deviceCodes = [...new Set(punches.map(p => p.deviceId).filter((x): x is string => Boolean(x)))];
  const devices = deviceCodes.length > 0
    ? await prisma.biometricDevice.findMany({
        where: { code: { in: deviceCodes } },
        select: { code: true, name: true, location: true },
      })
    : [];
  const devMap = new Map(devices.map(d => [d.code, d]));

  const rows = [...byLabor.entries()].map(([laborWorkerId, arr]) => {
    const first = arr[0];
    const last = arr[arr.length - 1];
    const hoursWorked = arr.length > 1
      ? Math.round(((last.punchAt.getTime() - first.punchAt.getTime()) / 3_600_000) * 10) / 10
      : 0;
    return {
      laborWorkerId,
      workerCode: first.laborWorker!.workerCode,
      firstName: first.laborWorker!.firstName,
      lastName: first.laborWorker!.lastName,
      firstIn: first.punchAt.toISOString(),
      lastOut: arr.length > 1 ? last.punchAt.toISOString() : null,
      punchCount: arr.length,
      hoursWorked,
      firstDevice: first.deviceId ? (devMap.get(first.deviceId)?.location ?? first.deviceId) : null,
      lastDevice: last.deviceId ? (devMap.get(last.deviceId)?.location ?? last.deviceId) : null,
    };
  }).sort((a, b) => a.workerCode.localeCompare(b.workerCode));

  res.json({ date: dateStr, rows });
}));

router.post('/punches', validate(punchSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { employeeId, punchAt, direction, notes, source } = req.body as z.infer<typeof punchSchema>;
  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, empCode: true } });
  if (!employee) throw new NotFoundError('Employee', employeeId);

  const punch = await prisma.attendancePunch.create({
    data: {
      employeeId,
      punchAt: new Date(punchAt),
      direction,
      source,
      rawEmpCode: employee.empCode,
      notes,
      createdBy: req.user?.id,
      companyId: getActiveCompanyId(req),
    },
  });

  // Recompute the affected day immediately so the UI reflects the new punch
  await recomputeDay(employeeId, istDateStr(punch.punchAt), getActiveCompanyId(req));

  res.status(201).json(punch);
}));

router.delete('/punches/:id', authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const punch = await prisma.attendancePunch.findUnique({ where: { id: req.params.id } });
  if (!punch) throw new NotFoundError('Punch', req.params.id);
  await prisma.attendancePunch.delete({ where: { id: req.params.id } });
  // Recompute the affected AttendanceDay only for employee punches; labor doesn't roll up to AttendanceDay
  if (punch.employeeId) {
    await recomputeDay(punch.employeeId, istDateStr(punch.punchAt), punch.companyId);
  }
  res.json({ ok: true });
}));

// ════════════════════════════════════════════════════════════════
// DAY RECOMPUTE — derive AttendanceDay from punches + leave + shift
// ════════════════════════════════════════════════════════════════

/**
 * Compute and upsert AttendanceDay for one (employee, date IST).
 *
 * Status precedence: existing override > approved leave > weekly_off > punches.
 */
async function recomputeDay(employeeId: string, dateStr: string, companyId: string | null): Promise<void> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, defaultShiftId: true, defaultShift: true },
  });
  if (!employee) return;

  // Window: from start of date IST to end of date IST. (Overnight shifts handled
  // pragmatically — single calendar-day bucketing; manual override for edge cases.)
  const dayStartUtc = istToUtc(dateStr, '00:00');
  const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 60 * 60 * 1000 - 1);

  const rawPunches = await prisma.attendancePunch.findMany({
    where: { employeeId, punchAt: { gte: dayStartUtc, lte: dayEndUtc } },
    orderBy: { punchAt: 'asc' },
    select: { id: true, punchAt: true, deviceId: true },
  });
  // Dedupe re-taps: same employee, same device, within 30s of the prior
  // accepted punch -> drop. eSSL devices register every successful match
  // so a worker pressing twice (or the device beeping a confirmation)
  // produces 2-3 rows in 5-10s. The raw rows stay in AttendancePunch
  // (preserve audit trail / device data); the daily computation just
  // ignores the dupes when deriving first-in / last-out / count.
  const DEDUP_WINDOW_MS = 30_000;
  const punches: typeof rawPunches = [];
  for (const p of rawPunches) {
    const last = punches[punches.length - 1];
    if (
      last &&
      last.deviceId === p.deviceId &&
      p.punchAt.getTime() - last.punchAt.getTime() < DEDUP_WINDOW_MS
    ) {
      continue;
    }
    punches.push(p);
  }

  // Existing day — preserve manual overrides
  const dateOnly = new Date(dayStartUtc); // stored as DATE, time portion irrelevant
  const existing = await prisma.attendanceDay.findUnique({
    where: { employeeId_date: { employeeId, date: dateOnly } },
  });
  if (existing?.manualOverride) return; // do not overwrite manual override

  // Leave check — APPROVED LeaveApplication covering this date?
  const dStr = dateStr;
  const [dy, dm, dd] = dStr.split('-').map(Number);
  const dateMidnight = new Date(Date.UTC(dy, dm - 1, dd));
  const leaveApp = await prisma.leaveApplication.findFirst({
    where: {
      employeeId,
      status: 'APPROVED',
      fromDate: { lte: dateMidnight },
      toDate: { gte: dateMidnight },
    },
    select: { id: true },
  });

  // Weekly off — Sunday by default. (Plant rule may differ; configurable in
  // a later iteration via Shift.weeklyOffDays JSON.)
  const dow = new Date(Date.UTC(dy, dm - 1, dd)).getUTCDay(); // 0 = Sunday
  const isSunday = dow === 0;

  // Compute status from punches (already deduped above — see DEDUP_WINDOW_MS block)
  let status: string;
  let firstPunchAt: Date | null = null;
  let lastPunchAt: Date | null = null;
  let hoursWorked: number | null = null;
  let lateMinutes: number | null = null;
  let earlyOutMinutes: number | null = null;

  if (leaveApp) {
    status = 'LEAVE';
  } else if (punches.length === 0) {
    status = isSunday ? 'WEEKLY_OFF' : 'ABSENT';
  } else {
    firstPunchAt = punches[0].punchAt;
    lastPunchAt = punches[punches.length - 1].punchAt;
    hoursWorked = punches.length >= 2
      ? Math.max(0, (lastPunchAt.getTime() - firstPunchAt.getTime()) / 3_600_000)
      : 0;

    const shift = employee.defaultShift;
    if (shift && shift.startTime && shift.endTime) {
      const overnight = shift.endTime <= shift.startTime;
      const shiftStartUtc = istToUtc(dStr, shift.startTime);
      const shiftEndUtc = istToUtc(dStr, shift.endTime);
      if (overnight) {
        // For overnight shifts we cannot reliably late/early-detect with calendar
        // bucketing — mark PRESENT if any punches landed in window.
        status = 'PRESENT';
      } else {
        const lateMs = firstPunchAt.getTime() - shiftStartUtc.getTime() - shift.graceMinutes * 60_000;
        const earlyMs = shiftEndUtc.getTime() - lastPunchAt.getTime() - shift.earlyOutMinutes * 60_000;
        lateMinutes = lateMs > 0 ? Math.round(lateMs / 60_000) : 0;
        earlyOutMinutes = earlyMs > 0 ? Math.round(earlyMs / 60_000) : 0;

        if (hoursWorked < shift.hours / 2) status = 'HALF_DAY';
        else if (lateMinutes > 0 && earlyOutMinutes > 0) status = 'HALF_DAY';
        else if (lateMinutes > 0) status = 'LATE';
        else if (earlyOutMinutes > 0) status = 'EARLY_OUT';
        else status = 'PRESENT';
      }
    } else {
      // No shift assigned — only PRESENT/HALF_DAY signal
      status = (hoursWorked !== null && hoursWorked > 0 && hoursWorked < 4) ? 'HALF_DAY' : 'PRESENT';
    }
  }

  await prisma.attendanceDay.upsert({
    where: { employeeId_date: { employeeId, date: dateOnly } },
    create: {
      employeeId,
      date: dateOnly,
      shiftId: employee.defaultShiftId,
      status,
      firstPunchAt,
      lastPunchAt,
      hoursWorked,
      lateMinutes,
      earlyOutMinutes,
      leaveApplicationId: leaveApp?.id ?? null,
      companyId,
    },
    update: {
      shiftId: employee.defaultShiftId,
      status,
      firstPunchAt,
      lastPunchAt,
      hoursWorked,
      lateMinutes,
      earlyOutMinutes,
      leaveApplicationId: leaveApp?.id ?? null,
    },
  });
}

router.post('/recompute', authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { from, to, employeeIds } = req.body as { from: string; to: string; employeeIds?: string[] };
  if (!from || !to) return res.status(400).json({ error: 'from, to (YYYY-MM-DD IST) required' });

  // Limit scope — protect against accidental whole-DB recompute
  const days = [...iterDates(from, to)];
  if (days.length > 62) return res.status(400).json({ error: 'Range too large (max 62 days). Run in chunks.' });

  const empWhere: any = { ...getCompanyFilter(req), isActive: true };
  if (employeeIds && employeeIds.length) empWhere.id = { in: employeeIds };
  const employees = await prisma.employee.findMany({
    where: empWhere,
    select: {
      id: true, defaultShiftId: true,
      defaultShift: { select: { startTime: true, endTime: true, graceMinutes: true, earlyOutMinutes: true, hours: true } },
      companyId: true,
    },
    take: 5000,
  });

  // ── Pre-fetch ALL data for the range in 3 queries (was 5 × N×D before) ──
  const fromDay = days[0];
  const toDay = days[days.length - 1];
  const startUtc = istToUtc(fromDay, '00:00');
  const endUtc = new Date(istToUtc(toDay, '00:00').getTime() + 24 * 60 * 60 * 1000);
  const empIds = employees.map(e => e.id);

  const [allPunches, approvedLeaves, existingDays] = await Promise.all([
    prisma.attendancePunch.findMany({
      where: { employeeId: { in: empIds }, punchAt: { gte: startUtc, lt: endUtc } },
      select: { employeeId: true, punchAt: true, deviceId: true },
      orderBy: { punchAt: 'asc' },
    }),
    prisma.leaveApplication.findMany({
      where: {
        employeeId: { in: empIds },
        status: 'APPROVED',
        fromDate: { lte: new Date(toDay) },
        toDate: { gte: new Date(fromDay) },
      },
      select: { id: true, employeeId: true, fromDate: true, toDate: true },
    }),
    prisma.attendanceDay.findMany({
      where: { employeeId: { in: empIds }, date: { gte: new Date(fromDay), lte: new Date(toDay) } },
      select: { id: true, employeeId: true, date: true, manualOverride: true },
    }),
  ]);

  // Index for fast lookup, dedupe re-taps on same employee+device within
  // 30s. Keep raw rows in DB but ignore dupes here. Punches are already
  // sorted asc, so we just compare to the immediately-previous entry.
  const DEDUP_WINDOW_MS = 30_000;
  const punchesByEmpDate = new Map<string, Date[]>(); // key: empId|YYYY-MM-DD
  const lastByEmpDate = new Map<string, { at: Date; deviceId: string | null }>();
  for (const p of allPunches) {
    const k = `${p.employeeId}|${istDateStr(p.punchAt)}`;
    const last = lastByEmpDate.get(k);
    if (last && last.deviceId === p.deviceId && p.punchAt.getTime() - last.at.getTime() < DEDUP_WINDOW_MS) {
      continue; // re-tap on same device within 30s; ignore for daily roll-up
    }
    const arr = punchesByEmpDate.get(k);
    if (arr) arr.push(p.punchAt); else punchesByEmpDate.set(k, [p.punchAt]);
    lastByEmpDate.set(k, { at: p.punchAt, deviceId: p.deviceId });
  }

  const overrideSet = new Set<string>(); // empId|YYYY-MM-DD
  for (const d of existingDays) {
    if (d.manualOverride) overrideSet.add(`${d.employeeId}|${d.date.toISOString().slice(0, 10)}`);
  }

  // Build the upsert ops list — every (employee, day) pair in scope.
  //
  // We skip:
  //  - Future dates (haven't happened — marking ABSENT is wrong)
  //  - Dates with NO org-wide activity (no punch from anyone, no leave covering)
  //    — these are "system wasn't running yet" days; auto-marking everyone
  //    ABSENT for pre-launch dates would falsely accuse the workforce
  //  - Cells with manual override (admin's word wins)
  const todayIST = istDateStr(nowIST());

  // Collect the set of dates with ANY org-wide activity (punch or approved leave)
  const activeDates = new Set<string>();
  for (const p of allPunches) activeDates.add(istDateStr(p.punchAt));
  for (const la of approvedLeaves) {
    const fromMs = la.fromDate.getTime();
    const toMs = la.toDate.getTime();
    for (let t = fromMs; t <= toMs; t += 24 * 60 * 60 * 1000) {
      const d = new Date(t);
      activeDates.add(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
    }
  }

  type Upsert = { employeeId: string; date: Date; payload: any };
  const ops: Upsert[] = [];

  for (const emp of employees) {
    for (const dateStr of days) {
      if (dateStr > todayIST) continue;        // skip future dates
      if (!activeDates.has(dateStr)) continue; // skip days with no system activity (pre-launch)
      const key = `${emp.id}|${dateStr}`;
      if (overrideSet.has(key)) continue; // never clobber manual overrides

      const [dy, dm, dd] = dateStr.split('-').map(Number);
      const dateOnly = new Date(Date.UTC(dy, dm - 1, dd));
      const dow = dateOnly.getUTCDay();
      const isSunday = dow === 0;

      // Leave applies?
      const leaveApp = approvedLeaves.find(la =>
        la.employeeId === emp.id &&
        la.fromDate.getTime() <= dateOnly.getTime() &&
        la.toDate.getTime() >= dateOnly.getTime(),
      );

      const dayPunches = punchesByEmpDate.get(key) || [];
      let status: string;
      let firstPunchAt: Date | null = null, lastPunchAt: Date | null = null;
      let hoursWorked: number | null = null;
      let lateMinutes: number | null = null, earlyOutMinutes: number | null = null;

      if (leaveApp) {
        status = 'LEAVE';
      } else if (dayPunches.length === 0) {
        status = isSunday ? 'WEEKLY_OFF' : 'ABSENT';
      } else {
        firstPunchAt = dayPunches[0];
        lastPunchAt = dayPunches[dayPunches.length - 1];
        hoursWorked = dayPunches.length >= 2
          ? Math.max(0, (lastPunchAt.getTime() - firstPunchAt.getTime()) / 3_600_000)
          : 0;
        const shift = emp.defaultShift;
        if (shift && shift.startTime && shift.endTime) {
          const overnight = shift.endTime <= shift.startTime;
          if (overnight) {
            status = 'PRESENT';
          } else {
            const shiftStartUtc = istToUtc(dateStr, shift.startTime);
            const shiftEndUtc = istToUtc(dateStr, shift.endTime);
            const lateMs = firstPunchAt.getTime() - shiftStartUtc.getTime() - shift.graceMinutes * 60_000;
            const earlyMs = shiftEndUtc.getTime() - lastPunchAt.getTime() - shift.earlyOutMinutes * 60_000;
            lateMinutes = lateMs > 0 ? Math.round(lateMs / 60_000) : 0;
            earlyOutMinutes = earlyMs > 0 ? Math.round(earlyMs / 60_000) : 0;
            if (hoursWorked < shift.hours / 2) status = 'HALF_DAY';
            else if (lateMinutes > 0 && earlyOutMinutes > 0) status = 'HALF_DAY';
            else if (lateMinutes > 0) status = 'LATE';
            else if (earlyOutMinutes > 0) status = 'EARLY_OUT';
            else status = 'PRESENT';
          }
        } else {
          status = (hoursWorked !== null && hoursWorked > 0 && hoursWorked < 4) ? 'HALF_DAY' : 'PRESENT';
        }
      }

      ops.push({
        employeeId: emp.id,
        date: dateOnly,
        payload: {
          shiftId: emp.defaultShiftId,
          status,
          firstPunchAt,
          lastPunchAt,
          hoursWorked,
          lateMinutes,
          earlyOutMinutes,
          leaveApplicationId: leaveApp?.id ?? null,
        },
      });
    }
  }

  // Execute upserts in batched transactions of 200 — much faster than serial
  const BATCH = 200;
  let updated = 0;
  for (let i = 0; i < ops.length; i += BATCH) {
    const chunk = ops.slice(i, i + BATCH);
    await prisma.$transaction(
      chunk.map(o => prisma.attendanceDay.upsert({
        where: { employeeId_date: { employeeId: o.employeeId, date: o.date } },
        create: {
          employeeId: o.employeeId,
          date: o.date,
          ...o.payload,
          companyId: getActiveCompanyId(req),
        },
        update: o.payload,
      })),
    );
    updated += chunk.length;
  }

  res.json({ ok: true, employees: employees.length, days: days.length, updated });
}));

// ════════════════════════════════════════════════════════════════
// DAYS — list + override
// ════════════════════════════════════════════════════════════════

router.get('/days', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { from, to, employeeId, status } = req.query as Record<string, string | undefined>;
  const where: any = { ...getCompanyFilter(req) };
  if (employeeId) where.employeeId = employeeId;
  if (status) where.status = status;
  if (from || to) {
    where.date = {};
    if (from) where.date.gte = new Date(from);
    if (to) where.date.lte = new Date(to);
  }
  const days = await prisma.attendanceDay.findMany({
    where,
    orderBy: [{ date: 'desc' }, { employeeId: 'asc' }],
    take: 5000,
    select: {
      id: true, employeeId: true, date: true, status: true, shiftId: true,
      firstPunchAt: true, lastPunchAt: true, hoursWorked: true,
      lateMinutes: true, earlyOutMinutes: true,
      leaveApplicationId: true, manualOverride: true, overrideReason: true,
      employee: { select: { id: true, empCode: true, firstName: true, lastName: true, departmentId: true } },
      shift: { select: { id: true, code: true, name: true } },
    },
  });
  res.json(days);
}));

const overrideSchema = z.object({
  status: z.enum(['PRESENT', 'ABSENT', 'HALF_DAY', 'LATE', 'EARLY_OUT', 'LEAVE', 'WEEKLY_OFF', 'HOLIDAY']),
  reason: z.string().min(1),
  shiftId: z.string().optional().nullable(),
});

router.put('/days/:id', authorize('ADMIN'), validate(overrideSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { status, reason, shiftId } = req.body as z.infer<typeof overrideSchema>;
  const day = await prisma.attendanceDay.update({
    where: { id: req.params.id },
    data: {
      status,
      shiftId: shiftId ?? undefined,
      manualOverride: true,
      overrideReason: reason,
      overrideBy: req.user?.id,
      overrideAt: nowIST(),
    },
  });
  res.json(day);
}));

router.post('/days/:id/clear-override', authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.attendanceDay.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new NotFoundError('AttendanceDay', req.params.id);
  await prisma.attendanceDay.update({
    where: { id: req.params.id },
    data: { manualOverride: false, overrideReason: null, overrideBy: null, overrideAt: null },
  });
  await recomputeDay(existing.employeeId, istDateStr(existing.date), existing.companyId);
  res.json({ ok: true });
}));

// ════════════════════════════════════════════════════════════════
// MONTHLY SUMMARY — for the grid view + payroll feed
// ════════════════════════════════════════════════════════════════

router.get('/monthly', asyncHandler(async (req: AuthRequest, res: Response) => {
  const year = parseInt(req.query.year as string);
  const month = parseInt(req.query.month as string);
  if (!year || !month || month < 1 || month > 12) {
    return res.status(400).json({ error: 'year + month required' });
  }
  const fromDate = new Date(Date.UTC(year, month - 1, 1));
  const toDate = new Date(Date.UTC(year, month, 0));
  const daysInMonth = toDate.getUTCDate();

  const where: any = { ...getCompanyFilter(req), date: { gte: fromDate, lte: toDate } };
  const departmentId = req.query.departmentId as string | undefined;

  const empWhere: any = { ...getCompanyFilter(req), isActive: true };
  if (departmentId) empWhere.departmentId = departmentId;

  const [employees, days] = await Promise.all([
    prisma.employee.findMany({
      where: empWhere,
      orderBy: { empNo: 'asc' },
      take: 1000,
      select: {
        id: true, empCode: true, firstName: true, lastName: true,
        department: { select: { id: true, name: true } },
        defaultShift: { select: { id: true, code: true, name: true } },
      },
    }),
    prisma.attendanceDay.findMany({
      where,
      select: {
        id: true, employeeId: true, date: true, status: true,
        hoursWorked: true, lateMinutes: true, earlyOutMinutes: true,
        manualOverride: true,
      },
    }),
  ]);

  // Index days by employeeId → day-of-month → record
  const grid: Record<string, Record<number, typeof days[number]>> = {};
  for (const d of days) {
    const dayNum = d.date.getUTCDate();
    if (!grid[d.employeeId]) grid[d.employeeId] = {};
    grid[d.employeeId][dayNum] = d;
  }

  const result = employees.map(emp => {
    const row = grid[emp.id] || {};
    let present = 0, absent = 0, leave = 0, halfDay = 0, late = 0, weeklyOff = 0, holiday = 0;
    for (let i = 1; i <= daysInMonth; i++) {
      const r = row[i];
      if (!r) continue;
      switch (r.status) {
        case 'PRESENT': present++; break;
        case 'ABSENT': absent++; break;
        case 'LEAVE': leave++; break;
        case 'HALF_DAY': halfDay++; present += 0.5; break;
        case 'LATE': late++; present++; break;
        case 'EARLY_OUT': late++; present++; break;
        case 'WEEKLY_OFF': weeklyOff++; break;
        case 'HOLIDAY': holiday++; break;
      }
    }
    return {
      employee: emp,
      days: row,
      summary: { present, absent, leave, halfDay, late, weeklyOff, holiday, totalDays: daysInMonth },
    };
  });

  res.json({ year, month, daysInMonth, rows: result });
}));

// ════════════════════════════════════════════════════════════════
// DEVICE PUSH — eSSL X990 / similar webhook
// (Phase 2 will sync from factory-server. This is the cloud-side entrypoint
//  used both by factory-server bridge and any direct on-LAN device.)
// ════════════════════════════════════════════════════════════════

const devicePushSchema = z.object({
  deviceId: z.string().min(1),
  punches: z.array(z.object({
    empCode: z.string().min(1),
    punchAt: z.string(), // ISO instant
    direction: z.enum(['IN', 'OUT', 'AUTO']).default('AUTO'),
  })).min(1).max(500),
});

router.post('/device-push', validate(devicePushSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { deviceId, punches } = req.body as z.infer<typeof devicePushSchema>;

  // Resolve empCodes → ids in one query
  const empCodes = [...new Set(punches.map(p => p.empCode))];
  const employees = await prisma.employee.findMany({
    where: { empCode: { in: empCodes } },
    select: { id: true, empCode: true, companyId: true },
  });
  const byCode = new Map(employees.map(e => [e.empCode, e]));

  let created = 0;
  const skipped: string[] = [];
  const affectedDays = new Set<string>(); // "empId|YYYY-MM-DD"

  for (const p of punches) {
    const emp = byCode.get(p.empCode);
    if (!emp) { skipped.push(p.empCode); continue; }
    await prisma.attendancePunch.create({
      data: {
        employeeId: emp.id,
        punchAt: new Date(p.punchAt),
        direction: p.direction,
        source: 'DEVICE',
        deviceId,
        rawEmpCode: p.empCode,
        companyId: emp.companyId,
      },
    });
    created++;
    affectedDays.add(`${emp.id}|${istDateStr(new Date(p.punchAt))}`);
  }

  // Recompute affected days (deduped)
  for (const k of affectedDays) {
    const [empId, dateStr] = k.split('|');
    const emp = employees.find(e => e.id === empId);
    await recomputeDay(empId, dateStr, emp?.companyId ?? null);
  }

  res.status(201).json({ created, skipped, affectedDays: affectedDays.size });
}));

// ════════════════════════════════════════════════════════════════
// RESET — wipe all attendance data (cloud-side). Destructive! Admin only.
// Used at go-live to clear pre-launch test punches and historical imports
// so the production tracking starts on day 1 with a clean slate.
//
// POST /api/attendance/reset  body: { confirm: 'WIPE', before?: 'YYYY-MM-DD' }
// If `before` is set, only deletes data prior to that date.
// ════════════════════════════════════════════════════════════════

router.post('/reset', authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { confirm, before } = (req.body || {}) as { confirm?: string; before?: string };
  if (confirm !== 'WIPE') {
    return res.status(400).json({ error: "Pass {confirm: 'WIPE'} to proceed. Destructive action — this deletes attendance data." });
  }

  const punchWhere: any = { ...getCompanyFilter(req) };
  const dayWhere: any = { ...getCompanyFilter(req) };
  if (before) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) return res.status(400).json({ error: 'before must be YYYY-MM-DD' });
    const cutoff = new Date(before);
    punchWhere.punchAt = { lt: cutoff };
    dayWhere.date = { lt: cutoff };
  }

  const punches = await prisma.attendancePunch.deleteMany({ where: punchWhere });
  const days = await prisma.attendanceDay.deleteMany({ where: dayWhere });

  // Reset device sync cursors so the next pull starts fresh (only on full wipe)
  if (!before) {
    await prisma.biometricDevice.updateMany({
      data: { lastPunchSyncAt: null, lastSyncAt: null, lastSyncStatus: null, lastSyncError: null },
    });
  }

  res.json({ punchesDeleted: punches.count, daysDeleted: days.count, before: before ?? null });
}));

export default router;
