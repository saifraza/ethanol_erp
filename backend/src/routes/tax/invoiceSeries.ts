import { Router, Response } from 'express';
import prisma from '../../config/prisma';
import { authenticate, AuthRequest, authorize } from '../../middleware/auth';
import { asyncHandler } from '../../shared/middleware';
import { NotFoundError, ValidationError, ConflictError } from '../../shared/errors';
import { z } from 'zod';
import { writeAuditMany } from '../../services/complianceAudit';

const router = Router();
router.use(authenticate as any);

const createSchema = z.object({
  fyId: z.string().min(1),
  docType: z.enum([
    'TAX_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'DELIVERY_CHALLAN',
    'EXPORT_INVOICE', 'RCM_INVOICE', 'JOBWORK_INVOICE',
  ]),
  prefix: z.string().min(1),
  width: z.number().int().min(1).max(12).optional(),
  isActive: z.boolean().optional(),
});

const updateSchema = z.object({
  prefix: z.string().min(1).optional(),
  width: z.number().int().min(1).max(12).optional(),
  isActive: z.boolean().optional(),
});

router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const where: Record<string, unknown> = {};
  if (req.query.fyId) where.fyId = req.query.fyId;
  const items = await prisma.invoiceSeries.findMany({
    where,
    orderBy: [{ fyId: 'desc' }, { docType: 'asc' }],
    take: 500,
    select: {
      id: true, fyId: true, docType: true, prefix: true,
      nextNumber: true, width: true, isActive: true, createdAt: true, updatedAt: true,
    },
  });
  res.json(items);
}));

router.post('/', authorize('ADMIN', 'SUPER_ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid request data', parsed.error.flatten());
  const data = parsed.data;

  const fy = await prisma.fiscalYear.findUnique({ where: { id: data.fyId } });
  if (!fy) throw new NotFoundError('FiscalYear', data.fyId);

  const existing = await prisma.invoiceSeries.findUnique({
    where: { fyId_docType: { fyId: data.fyId, docType: data.docType } },
  });
  if (existing) throw new ConflictError(`Series already exists for ${data.docType} in FY ${fy.code}`);

  const series = await prisma.invoiceSeries.create({ data });
  res.status(201).json(series);
}));

router.put('/:id', authorize('ADMIN', 'SUPER_ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid request data', parsed.error.flatten());

  const existing = await prisma.invoiceSeries.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new NotFoundError('InvoiceSeries', req.params.id);

  const updated = await prisma.invoiceSeries.update({
    where: { id: req.params.id },
    data: parsed.data,
  });

  await writeAuditMany(
    'InvoiceSeries',
    updated.id,
    existing as unknown as Record<string, unknown>,
    updated as unknown as Record<string, unknown>,
    ['prefix', 'width', 'isActive'],
    req.user?.id || 'system',
  );

  res.json(updated);
}));

/**
 * POST /:id/reserve — atomically reserve the next invoice number.
 * Uses Prisma's atomic `increment` which compiles to SQL `nextNumber = nextNumber + 1`.
 * This is safe under concurrent requests: the DB serializes the row-level update.
 */
router.post('/:id/reserve', asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.invoiceSeries.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new NotFoundError('InvoiceSeries', req.params.id);
  if (!existing.isActive) throw new ValidationError('Series is inactive');

  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.invoiceSeries.findUnique({ where: { id: req.params.id } });
    if (!current) throw new NotFoundError('InvoiceSeries', req.params.id);
    const reservedNumber = current.nextNumber;
    await tx.invoiceSeries.update({
      where: { id: req.params.id },
      data: { nextNumber: { increment: 1 } },
    });
    return {
      number: reservedNumber,
      formatted: current.prefix + String(reservedNumber).padStart(current.width, '0'),
      docType: current.docType,
      fyId: current.fyId,
    };
  });

  res.json(result);
}));

export default router;
