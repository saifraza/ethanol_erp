import { Router, Response } from 'express';
import prisma from '../../config/prisma';
import { authenticate, AuthRequest, authorize } from '../../middleware/auth';
import { asyncHandler } from '../../shared/middleware';
import { NotFoundError, ValidationError, ConflictError } from '../../shared/errors';
import { z } from 'zod';
import { writeAuditMany } from '../../services/complianceAudit';

const router = Router();
router.use(authenticate);

const createSchema = z.object({
  code: z.string().min(1),
  newSection: z.string().min(1),
  oldSection: z.string().nullable().optional(),
  nature: z.string().min(1),
  rateIndividual: z.number().nonnegative(),
  rateOthers: z.number().nonnegative(),
  thresholdSingle: z.number().nonnegative().default(0),
  thresholdAggregate: z.number().nonnegative().default(0),
  panMissingRate: z.number().nonnegative().default(20),
  nonFilerRate: z.number().nonnegative().default(5),
  effectiveFrom: z.string(),
  effectiveTill: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

const updateSchema = createSchema.partial().extend({ reason: z.string().optional() });

const AUDITED_FIELDS = [
  'newSection', 'oldSection', 'nature', 'rateIndividual', 'rateOthers',
  'thresholdSingle', 'thresholdAggregate', 'panMissingRate', 'nonFilerRate',
  'effectiveFrom', 'effectiveTill', 'isActive',
];

router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const where: Record<string, unknown> = {};
  if (req.query.activeOnly !== 'false') where.isActive = true;

  const items = await prisma.tdsSection.findMany({
    where,
    orderBy: [{ newSection: 'asc' }, { code: 'asc' }],
    take: 200,
    select: {
      id: true, code: true, newSection: true, oldSection: true, nature: true,
      rateIndividual: true, rateOthers: true,
      thresholdSingle: true, thresholdAggregate: true,
      panMissingRate: true, nonFilerRate: true,
      effectiveFrom: true, effectiveTill: true, isActive: true,
    },
  });
  res.json(items);
}));

router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const item = await prisma.tdsSection.findUnique({ where: { id: req.params.id } });
  if (!item) throw new NotFoundError('TdsSection', req.params.id);
  res.json(item);
}));

router.post('/', authorize('ADMIN', 'SUPER_ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid request data', parsed.error.flatten());
  const data = parsed.data;

  const existing = await prisma.tdsSection.findUnique({ where: { code: data.code } });
  if (existing) throw new ConflictError(`TDS section ${data.code} already exists`);

  const item = await prisma.tdsSection.create({
    data: {
      code: data.code,
      newSection: data.newSection,
      oldSection: data.oldSection || null,
      nature: data.nature,
      rateIndividual: data.rateIndividual,
      rateOthers: data.rateOthers,
      thresholdSingle: data.thresholdSingle,
      thresholdAggregate: data.thresholdAggregate,
      panMissingRate: data.panMissingRate,
      nonFilerRate: data.nonFilerRate,
      effectiveFrom: new Date(data.effectiveFrom),
      effectiveTill: data.effectiveTill ? new Date(data.effectiveTill) : null,
      isActive: data.isActive ?? true,
    },
  });
  res.status(201).json(item);
}));

router.put('/:id', authorize('ADMIN', 'SUPER_ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid request data', parsed.error.flatten());
  const { reason, ...raw } = parsed.data;

  const existing = await prisma.tdsSection.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new NotFoundError('TdsSection', req.params.id);

  const data: Record<string, unknown> = { ...raw };
  if (raw.effectiveFrom) data.effectiveFrom = new Date(raw.effectiveFrom);
  if (raw.effectiveTill !== undefined) data.effectiveTill = raw.effectiveTill ? new Date(raw.effectiveTill) : null;

  const updated = await prisma.tdsSection.update({ where: { id: req.params.id }, data });

  await writeAuditMany(
    'TdsSection',
    updated.id,
    existing as unknown as Record<string, unknown>,
    updated as unknown as Record<string, unknown>,
    AUDITED_FIELDS,
    req.user?.id || 'system',
    reason,
  );

  res.json(updated);
}));

export default router;
