import { Router, Response } from 'express';
import prisma from '../../config/prisma';
import { authenticate, AuthRequest, authorize } from '../../middleware/auth';
import { asyncHandler } from '../../shared/middleware';
import { ValidationError } from '../../shared/errors';
import { z } from 'zod';
import { writeAuditMany } from '../../services/complianceAudit';

const router = Router();
router.use(authenticate as any);

const explanationSchema = z.object({
  title: z.string().min(1).optional(),
  plainEnglish: z.string().min(1).optional(),
  whatErpDoes: z.string().min(1).optional(),
  whatUserDoes: z.string().min(1).optional(),
  sourceLink: z.string().nullable().optional(),
  category: z.enum(['DIRECT_TAX', 'GST', 'PAYROLL', 'ROC', 'DISTILLERY', 'OTHER']).optional(),
  sortOrder: z.number().int().optional(),
  reason: z.string().optional(),
});

router.get('/summary', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const now = new Date();

  const [config, currentFy, invoiceSeries, hsnList, tdsSections, tcsSections, explanations] = await Promise.all([
    prisma.complianceConfig.findFirst(),
    prisma.fiscalYear.findFirst({ where: { isCurrent: true } }),
    prisma.invoiceSeries.findMany({
      where: { isActive: true },
      orderBy: [{ fyId: 'desc' }, { docType: 'asc' }],
      take: 100,
    }),
    prisma.hsnCode.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
      take: 500,
      include: {
        rates: {
          where: {
            effectiveFrom: { lte: now },
            OR: [{ effectiveTill: null }, { effectiveTill: { gte: now } }],
          },
          orderBy: { effectiveFrom: 'desc' },
        },
      },
    }),
    prisma.tdsSection.findMany({
      where: { isActive: true },
      orderBy: [{ newSection: 'asc' }, { code: 'asc' }],
      take: 200,
    }),
    prisma.tcsSection.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
      take: 200,
    }),
    prisma.taxRuleExplanation.findMany({
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
      take: 500,
    }),
  ]);

  const seriesByDocType: Record<string, typeof invoiceSeries[number]> = {};
  for (const s of invoiceSeries) {
    if (!currentFy || s.fyId === currentFy.id) seriesByDocType[s.docType] = s;
  }

  res.json({
    config,
    currentFy,
    seriesByDocType,
    invoiceSeries,
    hsn: hsnList,
    tdsSections,
    tcsSections,
    explanations,
  });
}));

router.get('/explanations', asyncHandler(async (req: AuthRequest, res: Response) => {
  const where: Record<string, unknown> = {};
  if (req.query.category) where.category = req.query.category as string;

  const items = await prisma.taxRuleExplanation.findMany({
    where,
    orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    take: 500,
    select: {
      id: true, ruleKey: true, title: true, plainEnglish: true,
      whatErpDoes: true, whatUserDoes: true, sourceLink: true,
      category: true, sortOrder: true, updatedAt: true,
    },
  });
  res.json(items);
}));

router.put('/explanations/:ruleKey', authorize('ADMIN', 'SUPER_ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = explanationSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid request data', parsed.error.flatten());
  const { reason, ...raw } = parsed.data;

  const ruleKey = req.params.ruleKey;
  const userId = req.user?.id || 'system';
  const existing = await prisma.taxRuleExplanation.findUnique({ where: { ruleKey } });

  if (!existing) {
    // Upsert-create path — require full fields
    if (!raw.title || !raw.plainEnglish || !raw.whatErpDoes || !raw.whatUserDoes || !raw.category) {
      throw new ValidationError('New explanation requires title, plainEnglish, whatErpDoes, whatUserDoes, category');
    }
    const created = await prisma.taxRuleExplanation.create({
      data: {
        ruleKey,
        title: raw.title,
        plainEnglish: raw.plainEnglish,
        whatErpDoes: raw.whatErpDoes,
        whatUserDoes: raw.whatUserDoes,
        sourceLink: raw.sourceLink || null,
        category: raw.category,
        sortOrder: raw.sortOrder ?? 0,
        updatedBy: userId,
      },
    });
    res.status(201).json(created);
    return;
  }

  const updated = await prisma.taxRuleExplanation.update({
    where: { ruleKey },
    data: { ...raw, updatedBy: userId },
  });

  await writeAuditMany(
    'TaxRuleExplanation',
    updated.id,
    existing as unknown as Record<string, unknown>,
    updated as unknown as Record<string, unknown>,
    ['title', 'plainEnglish', 'whatErpDoes', 'whatUserDoes', 'sourceLink', 'category', 'sortOrder'],
    userId,
    reason,
  );

  res.json(updated);
}));

export default router;
