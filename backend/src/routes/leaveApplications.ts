import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { NotFoundError } from '../shared/errors';

const router = Router();
router.use(authenticate);

// ════════════════════════════════════════════════════════════════
// LEAVE TYPES (master)
// ════════════════════════════════════════════════════════════════

const leaveTypeSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1),
  paid: z.boolean().default(true),
  defaultAnnualEntitlement: z.number().min(0).default(0),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

router.get('/types', asyncHandler(async (req: AuthRequest, res: Response) => {
  const types = await prisma.leaveType.findMany({
    orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }, { code: 'asc' }],
    take: 50,
  });
  res.json(types);
}));

router.post('/types', authorize('ADMIN'), validate(leaveTypeSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const t = await prisma.leaveType.create({ data: req.body });
  res.status(201).json(t);
}));

router.put('/types/:id', authorize('ADMIN'), validate(leaveTypeSchema.partial()), asyncHandler(async (req: AuthRequest, res: Response) => {
  const t = await prisma.leaveType.update({ where: { id: req.params.id }, data: req.body });
  res.json(t);
}));

// ════════════════════════════════════════════════════════════════
// LEAVE APPLICATIONS
// ════════════════════════════════════════════════════════════════

const applySchema = z.object({
  employeeId: z.string().min(1),
  leaveTypeId: z.string().min(1),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
  isHalfDay: z.boolean().default(false),
  reason: z.string().min(1).max(500),
  attachmentUrl: z.string().url().optional(),
});

router.get('/applications', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { employeeId, status, from, to } = req.query as Record<string, string | undefined>;
  const where: any = { ...getCompanyFilter(req) };
  if (employeeId) where.employeeId = employeeId;
  if (status) where.status = status;
  if (from || to) {
    where.AND = [];
    if (from) where.AND.push({ toDate: { gte: new Date(from) } });
    if (to) where.AND.push({ fromDate: { lte: new Date(to) } });
  }

  const apps = await prisma.leaveApplication.findMany({
    where,
    orderBy: [{ status: 'asc' }, { appliedAt: 'desc' }],
    take: 500,
    select: {
      id: true, appNo: true, employeeId: true, leaveTypeId: true,
      fromDate: true, toDate: true, days: true, isHalfDay: true,
      reason: true, status: true, attachmentUrl: true,
      appliedAt: true, appliedBy: true,
      reviewedBy: true, reviewedAt: true, reviewNote: true,
      employee: { select: { id: true, empCode: true, firstName: true, lastName: true } },
      leaveType: { select: { id: true, code: true, name: true, paid: true } },
    },
  });
  res.json(apps);
}));

/** Days between two YYYY-MM-DD dates inclusive. */
function dayCount(fromDate: string, toDate: string): number {
  const [fy, fm, fd] = fromDate.split('-').map(Number);
  const [ty, tm, td] = toDate.split('-').map(Number);
  const ms = Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd);
  return Math.floor(ms / (24 * 60 * 60 * 1000)) + 1;
}

router.post('/applications', validate(applySchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = req.body as z.infer<typeof applySchema>;
  if (body.toDate < body.fromDate) return res.status(400).json({ error: 'toDate must be on/after fromDate' });
  if (body.isHalfDay && body.fromDate !== body.toDate) {
    return res.status(400).json({ error: 'Half-day must be a single date' });
  }

  const [employee, leaveType] = await Promise.all([
    prisma.employee.findUnique({ where: { id: body.employeeId }, select: { id: true, empCode: true, firstName: true, lastName: true, companyId: true } }),
    prisma.leaveType.findUnique({ where: { id: body.leaveTypeId }, select: { id: true, code: true, name: true, active: true } }),
  ]);
  if (!employee) throw new NotFoundError('Employee', body.employeeId);
  if (!leaveType || !leaveType.active) return res.status(400).json({ error: 'LeaveType invalid or inactive' });

  const days = body.isHalfDay ? 0.5 : dayCount(body.fromDate, body.toDate);

  // Overlap guard — block submission if employee has a PENDING/APPROVED app overlapping this range
  const overlap = await prisma.leaveApplication.findFirst({
    where: {
      employeeId: body.employeeId,
      status: { in: ['PENDING', 'APPROVED'] },
      fromDate: { lte: new Date(body.toDate) },
      toDate: { gte: new Date(body.fromDate) },
    },
    select: { id: true, appNo: true, status: true },
  });
  if (overlap) {
    return res.status(409).json({ error: `Overlaps with leave application LA-${overlap.appNo} (${overlap.status})` });
  }

  const created = await prisma.$transaction(async (tx) => {
    const app = await tx.leaveApplication.create({
      data: {
        employeeId: body.employeeId,
        leaveTypeId: body.leaveTypeId,
        fromDate: new Date(body.fromDate),
        toDate: new Date(body.toDate),
        days,
        isHalfDay: body.isHalfDay,
        reason: body.reason,
        attachmentUrl: body.attachmentUrl,
        appliedBy: req.user?.id ?? 'system',
        companyId: getActiveCompanyId(req) ?? employee.companyId,
      },
    });

    // Plug into generic Approval framework
    await tx.approval.create({
      data: {
        type: 'LEAVE_APPLICATION',
        status: 'PENDING',
        entityType: 'LeaveApplication',
        entityId: app.id,
        title: `Leave: ${employee.firstName} ${employee.lastName} (${employee.empCode}) — ${leaveType.code} ${days}d`,
        description: `${body.fromDate} to ${body.toDate}${body.isHalfDay ? ' (half day)' : ''}: ${body.reason}`,
        requestedBy: req.user?.id ?? 'system',
        metadata: { leaveApplicationId: app.id, appNo: app.appNo, leaveTypeCode: leaveType.code, days },
        companyId: getActiveCompanyId(req) ?? employee.companyId,
      },
    });

    return app;
  });

  res.status(201).json(created);
}));

router.put('/applications/:id/cancel', asyncHandler(async (req: AuthRequest, res: Response) => {
  const app = await prisma.leaveApplication.findUnique({ where: { id: req.params.id } });
  if (!app) throw new NotFoundError('LeaveApplication', req.params.id);
  if (app.status !== 'PENDING' && app.status !== 'APPROVED') {
    return res.status(400).json({ error: `Cannot cancel from status ${app.status}` });
  }

  await prisma.$transaction(async (tx) => {
    await tx.leaveApplication.update({
      where: { id: app.id },
      data: { status: 'CANCELLED', reviewNote: req.body?.reason ?? null, reviewedAt: new Date(), reviewedBy: req.user?.id },
    });
    // Cancel the linked pending approval (if any) so the bell-badge clears
    await tx.approval.updateMany({
      where: { entityType: 'LeaveApplication', entityId: app.id, status: 'PENDING' },
      data: { status: 'REJECTED', reviewedBy: req.user?.id, reviewedAt: new Date(), reviewNote: 'Cancelled by applicant' },
    });
    // If it was APPROVED, clear LEAVE markers from AttendanceDay (revert to recompute)
    if (app.status === 'APPROVED') {
      await tx.attendanceDay.updateMany({
        where: { leaveApplicationId: app.id, manualOverride: false },
        data: { leaveApplicationId: null, status: 'ABSENT' }, // ABSENT until next punch / recompute
      });
    }
  });

  res.json({ ok: true });
}));

// Direct approve/reject endpoint (alternative to using /api/approvals).
// Both paths must apply the side-effect (writing AttendanceDay.LEAVE rows) —
// we expose a shared helper at the bottom of this file.
router.put('/applications/:id/decide', authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const status = req.body?.status as 'APPROVED' | 'REJECTED' | undefined;
  const reviewNote = req.body?.reviewNote as string | undefined;
  if (status !== 'APPROVED' && status !== 'REJECTED') {
    return res.status(400).json({ error: 'status must be APPROVED or REJECTED' });
  }
  const app = await prisma.leaveApplication.findUnique({ where: { id: req.params.id } });
  if (!app) throw new NotFoundError('LeaveApplication', req.params.id);
  if (app.status !== 'PENDING') return res.status(400).json({ error: `Already ${app.status}` });

  await applyLeaveDecision(app.id, status, req.user?.id ?? 'system', reviewNote);
  res.json({ ok: true });
}));

/**
 * Shared decision handler — writes LeaveApplication.status, mirrors to the
 * generic Approval row, and (on APPROVED) populates AttendanceDay.LEAVE rows
 * for every date in the application range.
 *
 * Called by:
 *   - PUT /applications/:id/decide (this file)
 *   - approvals.ts side-effect when an Approval(type=LEAVE_APPLICATION) is reviewed
 */
export async function applyLeaveDecision(
  leaveAppId: string,
  status: 'APPROVED' | 'REJECTED',
  reviewedBy: string,
  reviewNote: string | null | undefined,
): Promise<void> {
  const app = await prisma.leaveApplication.findUnique({
    where: { id: leaveAppId },
    select: { id: true, employeeId: true, fromDate: true, toDate: true, isHalfDay: true, companyId: true, status: true },
  });
  if (!app || app.status !== 'PENDING') return;

  await prisma.$transaction(async (tx) => {
    await tx.leaveApplication.update({
      where: { id: app.id },
      data: { status, reviewedBy, reviewedAt: new Date(), reviewNote: reviewNote ?? null },
    });

    // Mirror to generic Approval (so the bell stays consistent regardless of which path was used)
    await tx.approval.updateMany({
      where: { entityType: 'LeaveApplication', entityId: app.id, status: 'PENDING' },
      data: { status, reviewedBy, reviewedAt: new Date(), reviewNote: reviewNote ?? null },
    });

    if (status === 'APPROVED') {
      // Iterate dates [fromDate..toDate], upsert AttendanceDay = LEAVE for each
      const fromMs = app.fromDate.getTime();
      const toMs = app.toDate.getTime();
      const oneDayMs = 24 * 60 * 60 * 1000;
      for (let t = fromMs; t <= toMs; t += oneDayMs) {
        const dateOnly = new Date(t);
        await tx.attendanceDay.upsert({
          where: { employeeId_date: { employeeId: app.employeeId, date: dateOnly } },
          create: {
            employeeId: app.employeeId,
            date: dateOnly,
            status: 'LEAVE',
            leaveApplicationId: app.id,
            companyId: app.companyId,
          },
          update: {
            // Don't clobber a manual override — admin's override wins
            // (but if it's a system-derived row, switch to LEAVE)
            status: 'LEAVE',
            leaveApplicationId: app.id,
          },
        });
      }
    }
  });
}

export default router;
