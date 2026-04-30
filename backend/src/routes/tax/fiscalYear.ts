import { Router, Response } from 'express';
import prisma from '../../config/prisma';
import { authenticate, AuthRequest, authorize } from '../../middleware/auth';
import { asyncHandler } from '../../shared/middleware';
import { NotFoundError, ValidationError, ConflictError } from '../../shared/errors';
import { z } from 'zod';
import { writeAudit } from '../../services/complianceAudit';

const router = Router();
router.use(authenticate);

const createSchema = z.object({
  code: z.string().regex(/^\d{4}-\d{2}$/, 'FY code must be YYYY-YY'),
  startDate: z.string(),
  endDate: z.string(),
  isCurrent: z.boolean().optional(),
});

router.get('/', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const items = await prisma.fiscalYear.findMany({
    orderBy: { startDate: 'desc' },
    take: 100,
    select: {
      id: true, code: true, startDate: true, endDate: true,
      isCurrent: true, isClosed: true, closedAt: true, closedBy: true, createdAt: true,
    },
  });
  res.json(items);
}));

router.get('/current', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const fy = await prisma.fiscalYear.findFirst({
    where: { isCurrent: true },
    select: {
      id: true, code: true, startDate: true, endDate: true,
      isCurrent: true, isClosed: true, closedAt: true, closedBy: true,
    },
  });
  if (!fy) throw new NotFoundError('FiscalYear', 'current');
  res.json(fy);
}));

router.post('/', authorize('ADMIN', 'SUPER_ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid request data', parsed.error.flatten());
  const { code, startDate, endDate, isCurrent } = parsed.data;

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (end <= start) throw new ValidationError('endDate must be after startDate');

  const existing = await prisma.fiscalYear.findUnique({ where: { code } });
  if (existing) throw new ConflictError(`FiscalYear ${code} already exists`);

  const overlap = await prisma.fiscalYear.findFirst({
    where: {
      OR: [
        { startDate: { lte: end }, endDate: { gte: start } },
      ],
    },
    select: { id: true, code: true },
  });
  if (overlap) throw new ConflictError(`Overlaps with FY ${overlap.code}`);

  const fy = await prisma.$transaction(async (tx) => {
    if (isCurrent) {
      await tx.fiscalYear.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
    }
    return tx.fiscalYear.create({
      data: { code, startDate: start, endDate: end, isCurrent: !!isCurrent },
    });
  });

  await writeAudit('FiscalYear', fy.id, 'created', null, fy.code, req.user?.id || 'system');
  res.status(201).json(fy);
}));

router.post('/:id/close', authorize('ADMIN', 'SUPER_ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.fiscalYear.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new NotFoundError('FiscalYear', req.params.id);
  if (existing.isClosed) throw new ConflictError('FiscalYear already closed');

  const userId = req.user?.id || 'system';
  const fy = await prisma.fiscalYear.update({
    where: { id: req.params.id },
    data: { isClosed: true, closedAt: new Date(), closedBy: userId },
  });

  await writeAudit('FiscalYear', fy.id, 'isClosed', 'false', 'true', userId);
  res.json(fy);
}));

router.post('/:id/set-current', authorize('ADMIN', 'SUPER_ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.fiscalYear.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new NotFoundError('FiscalYear', req.params.id);

  const fy = await prisma.$transaction(async (tx) => {
    await tx.fiscalYear.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
    return tx.fiscalYear.update({ where: { id: req.params.id }, data: { isCurrent: true } });
  });

  await writeAudit('FiscalYear', fy.id, 'isCurrent', 'false', 'true', req.user?.id || 'system');
  res.json(fy);
}));

export default router;
