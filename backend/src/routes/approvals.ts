import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';

const router = Router();
router.use(authenticate as any);

// GET / — list approvals (filter by status, type)
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const status = req.query.status as string || undefined;
  const type = req.query.type as string || undefined;
  const take = Math.min(parseInt(req.query.limit as string) || 50, 200);

  const where: Record<string, unknown> = {};
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
  const count = await prisma.approval.count({ where: { status: 'PENDING' } });
  res.json({ count });
}));

// GET /:id — single approval with entity details
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const approval = await prisma.approval.findUnique({ where: { id: req.params.id } });
  if (!approval) return res.status(404).json({ error: 'Approval not found' });
  res.json(approval);
}));

// PUT /:id — approve or reject (admin only)
router.put('/:id', authorize('ADMIN') as any, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { status, reviewNote } = req.body;
  if (!['APPROVED', 'REJECTED'].includes(status)) {
    return res.status(400).json({ error: 'Status must be APPROVED or REJECTED' });
  }

  const approval = await prisma.approval.findUnique({ where: { id: req.params.id } });
  if (!approval) return res.status(404).json({ error: 'Approval not found' });
  if (approval.status !== 'PENDING') return res.status(400).json({ error: `Already ${approval.status}` });

  const updated = await prisma.approval.update({
    where: { id: req.params.id },
    data: {
      status,
      reviewedBy: req.user!.id,
      reviewedAt: new Date(),
      reviewNote: reviewNote || null,
    },
  });

  res.json(updated);
}));

export default router;
