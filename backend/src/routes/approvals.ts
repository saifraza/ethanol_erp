import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { resolveNotifications } from '../services/notify';
import { applyLeaveDecision } from './leaveApplications';

const router = Router();
router.use(authenticate);

// GET / — list approvals (filter by status, type)
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const status = req.query.status as string || undefined;
  const type = req.query.type as string || undefined;
  const take = Math.min(parseInt(req.query.limit as string) || 50, 200);

  const where: Record<string, unknown> = { ...getCompanyFilter(req) };
  if (status) where.status = status;
  if (type) where.type = type;

  const approvals = await prisma.approval.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take,
  });

  res.json(approvals);
}));

// GET /count — pending approval count (for bell badge)
router.get('/count', asyncHandler(async (req: AuthRequest, res: Response) => {
  const count = await prisma.approval.count({ where: { status: 'PENDING', ...getCompanyFilter(req) } });
  res.json({ count });
}));

// GET /:id — single approval with entity details
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const approval = await prisma.approval.findUnique({ where: { id: req.params.id } });
  if (!approval) return res.status(404).json({ error: 'Approval not found' });
  res.json(approval);
}));

// PUT /:id — approve or reject (admin only)
router.put('/:id', authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { status, reviewNote } = req.body;
  if (!['APPROVED', 'REJECTED'].includes(status)) {
    return res.status(400).json({ error: 'Status must be APPROVED or REJECTED' });
  }

  // Atomic: only update if still PENDING (prevents race between two admins)
  const result = await prisma.approval.updateMany({
    where: { id: req.params.id, status: 'PENDING' },
    data: {
      status,
      reviewedBy: req.user!.id,
      reviewedAt: new Date(),
      reviewNote: reviewNote || null,
    },
  });

  if (result.count === 0) {
    const existing = await prisma.approval.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Approval not found' });
    return res.status(400).json({ error: `Already ${existing.status}` });
  }

  const updated = await prisma.approval.findUnique({ where: { id: req.params.id } });
  // Resolve any linked notification (bell badge clears immediately)
  if (updated) {
    await resolveNotifications('Approval', updated.id);

    // Entity-specific side effects
    if (updated.entityType === 'LeaveApplication') {
      await applyLeaveDecision(
        updated.entityId,
        status as 'APPROVED' | 'REJECTED',
        req.user!.id,
        reviewNote || null,
      );
    }
  }
  res.json(updated);
}));

export default router;
