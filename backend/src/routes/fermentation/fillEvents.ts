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

  // Enrich with batch metadata (fermentationEndTime = when SG hit 1.0, finalAlcohol, setupGravity)
  const pairs = rows.filter(r => r.batchNo != null).map(r => ({ batchNo: r.batchNo!, fermenterNo: r.fermenterNo }));
  const batches = pairs.length
    ? await prisma.fermentationBatch.findMany({
        where: { OR: pairs.map(p => ({ batchNo: p.batchNo, fermenterNo: p.fermenterNo })) },
        select: { batchNo: true, fermenterNo: true, fermentationEndTime: true, finalAlcohol: true, setupGravity: true, finalRsGravity: true },
      
    take: 500,
  })
    : [];
  const bMap = new Map(batches.map(b => [`${b.batchNo}_${b.fermenterNo}`, b]));

  const enriched = rows.map(r => {
    const b = r.batchNo != null ? bMap.get(`${r.batchNo}_${r.fermenterNo}`) : null;
    const fillEnd = r.endTime;
    const fermEnd = b?.fermentationEndTime ?? null;
    const fillHours = fillEnd ? (fillEnd.getTime() - r.startTime.getTime()) / 3_600_000 : null;
    const reactionHours = fillEnd && fermEnd ? (fermEnd.getTime() - fillEnd.getTime()) / 3_600_000 : null;
    const cycleHours = fermEnd ? (fermEnd.getTime() - r.startTime.getTime()) / 3_600_000 : null;
    return {
      ...r,
      fermentationEndTime: fermEnd,
      setupGravity: b?.setupGravity ?? null,
      finalRsGravity: b?.finalRsGravity ?? null,
      finalAlcohol: b?.finalAlcohol ?? null,
      fillHours: fillHours != null ? Number(fillHours.toFixed(2)) : null,
      reactionHours: reactionHours != null ? Number(reactionHours.toFixed(2)) : null,
      cycleHours: cycleHours != null ? Number(cycleHours.toFixed(2)) : null,
    };
  });

  res.json(enriched);
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
