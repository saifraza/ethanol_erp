import { Router, Response } from 'express';
import prisma from '../../config/prisma';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { asyncHandler } from '../../shared/middleware';

const router = Router();
router.use(authenticate);

router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const take = Math.min(parseInt((req.query.limit as string) || '100', 10) || 100, 500);
  const skip = Math.max(parseInt((req.query.offset as string) || '0', 10) || 0, 0);

  const where: Record<string, unknown> = {};
  if (req.query.entityType) where.entityType = req.query.entityType as string;
  if (req.query.entityId) where.entityId = req.query.entityId as string;

  if (req.query.from || req.query.to) {
    const changedAt: Record<string, Date> = {};
    if (req.query.from) changedAt.gte = new Date(req.query.from as string);
    if (req.query.to) changedAt.lte = new Date(req.query.to as string);
    where.changedAt = changedAt;
  }

  const [items, total] = await Promise.all([
    prisma.complianceAudit.findMany({
      where,
      orderBy: { changedAt: 'desc' },
      take,
      skip,
      select: {
        id: true, entityType: true, entityId: true, field: true,
        oldValue: true, newValue: true, changedBy: true, changedAt: true, reason: true,
      },
    }),
    prisma.complianceAudit.count({ where }),
  ]);

  res.json({ items, total, take, skip });
}));

export default router;
