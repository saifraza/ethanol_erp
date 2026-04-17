import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../../config/prisma';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { asyncHandler } from '../../shared/middleware';

const router = Router();
router.use(authenticate as any);

const listQuery = z.object({
  fermenterNo: z.coerce.number().int().min(1).max(4).optional(),
  batchNo: z.coerce.number().int().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  activeOnly: z.coerce.boolean().optional(),
  take: z.coerce.number().int().min(1).max(500).default(50),
});

router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const q = listQuery.parse(req.query);
  const rows = await prisma.fermentationFillEvent.findMany({
    where: {
      ...(q.fermenterNo != null ? { fermenterNo: q.fermenterNo } : {}),
      ...(q.batchNo != null ? { batchNo: q.batchNo } : {}),
      ...(q.from || q.to ? { startTime: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
      ...(q.activeOnly ? { endTime: null } : {}),
    },
    orderBy: { startTime: 'desc' },
    take: q.take,
    select: {
      id: true,
      fermenterNo: true,
      batchNo: true,
      startTime: true,
      endTime: true,
      startLevel: true,
      peakLevel: true,
      durationHours: true,
      confidence: true,
      source: true,
      crossChecks: true,
      computedAt: true,
    },
  });
  res.json(rows);
}));

router.get('/active', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const rows = await prisma.fermentationFillEvent.findMany({
    where: { endTime: null },
    orderBy: { startTime: 'desc' },
    take: 10,
    select: {
      id: true,
      fermenterNo: true,
      batchNo: true,
      startTime: true,
      startLevel: true,
      peakLevel: true,
      confidence: true,
      source: true,
    },
  });
  res.json(rows);
}));

export default router;
