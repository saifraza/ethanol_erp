import { Router, Response } from 'express';
import prisma from '../../config/prisma';
import { authenticate, AuthRequest, authorize } from '../../middleware/auth';
import { asyncHandler } from '../../shared/middleware';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { z } from 'zod';
import { writeAudit, writeAuditMany } from '../../services/complianceAudit';
import { getHsnRateImpact } from '../../services/taxRateLookup';

const router = Router();
router.use(authenticate);

// GET /:id/impact — blast radius for a rate change
router.get('/:id/impact', asyncHandler(async (req: AuthRequest, res: Response) => {
  const impact = await getHsnRateImpact(req.params.id);
  res.json(impact);
}));

const rateSchema = z.object({
  cgst: z.number().nonnegative().default(0),
  sgst: z.number().nonnegative().default(0),
  igst: z.number().nonnegative().default(0),
  cess: z.number().nonnegative().default(0),
  isExempt: z.boolean().optional(),
  isOutsideGst: z.boolean().optional(),
  conditionNote: z.string().nullable().optional(),
  effectiveFrom: z.string(),
  effectiveTill: z.string().nullable().optional(),
});

const createHsnSchema = z.object({
  code: z.string().min(1),
  description: z.string().min(1),
  uqc: z.string().min(1),
  category: z.enum(['FINISHED_GOOD', 'RAW_MATERIAL', 'BYPRODUCT', 'SERVICE']),
  rate: rateSchema,
});

const updateRateSchema = z.object({
  cgst: z.number().nonnegative().optional(),
  sgst: z.number().nonnegative().optional(),
  igst: z.number().nonnegative().optional(),
  cess: z.number().nonnegative().optional(),
  isExempt: z.boolean().optional(),
  isOutsideGst: z.boolean().optional(),
  conditionNote: z.string().nullable().optional(),
  effectiveFrom: z.string().optional(),
  effectiveTill: z.string().nullable().optional(),
  reason: z.string().optional(),
});

router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const where: Record<string, unknown> = { isActive: true };
  if (req.query.category) where.category = req.query.category as string;

  const items = await prisma.hsnCode.findMany({
    where,
    orderBy: { code: 'asc' },
    take: 500,
    select: {
      id: true, code: true, description: true, uqc: true, category: true, isActive: true,
      rates: {
        where: { OR: [{ effectiveTill: null }, { effectiveTill: { gte: new Date() } }] },
        orderBy: { effectiveFrom: 'desc' },
        select: {
          id: true, cgst: true, sgst: true, igst: true, cess: true,
          isExempt: true, isOutsideGst: true, conditionNote: true,
          effectiveFrom: true, effectiveTill: true,
        },
      },
    },
  });
  res.json(items);
}));

router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const item = await prisma.hsnCode.findUnique({
    where: { id: req.params.id },
    include: { rates: { orderBy: { effectiveFrom: 'desc' } } },
  });
  if (!item) throw new NotFoundError('HsnCode', req.params.id);
  res.json(item);
}));

router.post('/', authorize('ADMIN', 'SUPER_ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = createHsnSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid request data', parsed.error.flatten());
  const { rate, ...hsnData } = parsed.data;

  const created = await prisma.$transaction(async (tx) => {
    const hsn = await tx.hsnCode.create({ data: hsnData });
    await tx.gstRate.create({
      data: {
        hsnId: hsn.id,
        cgst: rate.cgst,
        sgst: rate.sgst,
        igst: rate.igst,
        cess: rate.cess,
        isExempt: rate.isExempt || false,
        isOutsideGst: rate.isOutsideGst || false,
        conditionNote: rate.conditionNote || null,
        effectiveFrom: new Date(rate.effectiveFrom),
        effectiveTill: rate.effectiveTill ? new Date(rate.effectiveTill) : null,
      },
    });
    return tx.hsnCode.findUnique({ where: { id: hsn.id }, include: { rates: true } });
  });

  await writeAudit('HsnCode', created!.id, 'created', null, created!.code, req.user?.id || 'system');
  res.status(201).json(created);
}));

router.post('/:id/rates', authorize('ADMIN', 'SUPER_ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = rateSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid request data', parsed.error.flatten());
  const data = parsed.data;

  const hsn = await prisma.hsnCode.findUnique({ where: { id: req.params.id } });
  if (!hsn) throw new NotFoundError('HsnCode', req.params.id);

  const newEffectiveFrom = new Date(data.effectiveFrom);
  const cutoffTill = new Date(newEffectiveFrom.getTime() - 24 * 60 * 60 * 1000);

  const rate = await prisma.$transaction(async (tx) => {
    // Close any active rate with matching conditionNote
    await tx.gstRate.updateMany({
      where: {
        hsnId: hsn.id,
        conditionNote: data.conditionNote || null,
        effectiveTill: null,
      },
      data: { effectiveTill: cutoffTill },
    });
    return tx.gstRate.create({
      data: {
        hsnId: hsn.id,
        cgst: data.cgst,
        sgst: data.sgst,
        igst: data.igst,
        cess: data.cess,
        isExempt: data.isExempt || false,
        isOutsideGst: data.isOutsideGst || false,
        conditionNote: data.conditionNote || null,
        effectiveFrom: newEffectiveFrom,
        effectiveTill: data.effectiveTill ? new Date(data.effectiveTill) : null,
      },
    });
  });

  await writeAudit('GstRate', rate.id, 'created', null, `${rate.igst}%`, req.user?.id || 'system');
  res.status(201).json(rate);
}));

router.put('/rates/:rateId', authorize('ADMIN', 'SUPER_ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = updateRateSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid request data', parsed.error.flatten());
  const { reason, ...raw } = parsed.data;

  const existing = await prisma.gstRate.findUnique({ where: { id: req.params.rateId } });
  if (!existing) throw new NotFoundError('GstRate', req.params.rateId);

  const data: Record<string, unknown> = { ...raw };
  if (raw.effectiveFrom) data.effectiveFrom = new Date(raw.effectiveFrom);
  if (raw.effectiveTill !== undefined) data.effectiveTill = raw.effectiveTill ? new Date(raw.effectiveTill) : null;

  const updated = await prisma.gstRate.update({ where: { id: req.params.rateId }, data });

  await writeAuditMany(
    'GstRate',
    updated.id,
    existing as unknown as Record<string, unknown>,
    updated as unknown as Record<string, unknown>,
    ['cgst', 'sgst', 'igst', 'cess', 'isExempt', 'isOutsideGst', 'conditionNote', 'effectiveFrom', 'effectiveTill'],
    req.user?.id || 'system',
    reason,
  );

  res.json(updated);
}));

export default router;
