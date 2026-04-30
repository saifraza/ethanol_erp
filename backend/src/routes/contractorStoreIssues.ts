import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { NotFoundError } from '../shared/errors';
import { z } from 'zod';

const router = Router();
router.use(authenticate);

const WRITE_ROLES = ['ADMIN', 'SUPER_ADMIN', 'STORE_INCHARGE', 'SUPERVISOR'];

const lineSchema = z.object({
  description: z.string().min(1),
  inventoryItemId: z.string().nullable().optional(),
  quantity: z.number().positive(),
  unit: z.string().default('NOS'),
  rate: z.number().min(0),
  returnedQty: z.number().min(0).default(0),
  remarks: z.string().nullable().optional(),
});

const createSchema = z.object({
  contractorId: z.string().min(1),
  issueDate: z.string().optional(),
  chargePercent: z.number().min(0).max(100).default(5),
  purpose: z.string().nullable().optional(),
  remarks: z.string().nullable().optional(),
  division: z.string().optional(),
  lines: z.array(lineSchema).min(1),
});

const updateSchema = createSchema.partial().extend({
  lines: z.array(lineSchema).min(1),
});

function calcTotals(lines: { quantity: number; rate: number }[], chargePercent: number) {
  const subtotal = lines.reduce((sum, l) => sum + l.quantity * l.rate, 0);
  const chargeAmount = Math.round(subtotal * chargePercent) / 100;
  const totalAmount = subtotal + chargeAmount;
  return { subtotal, chargeAmount, totalAmount };
}

// GET / — list with filters
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const take = Math.min(parseInt(req.query.limit as string) || 50, 500);
  const skip = parseInt(req.query.offset as string) || 0;
  const { contractorId, status, dateFrom, dateTo, division } = req.query as Record<string, string | undefined>;

  const where: Record<string, unknown> = { ...getCompanyFilter(req) };
  if (contractorId) where.contractorId = contractorId;
  if (status) where.status = status;
  if (division) where.division = division;
  if (dateFrom || dateTo) {
    where.issueDate = {
      ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
      ...(dateTo ? { lte: new Date(dateTo) } : {}),
    };
  }

  const [issues, total] = await Promise.all([
    prisma.contractorStoreIssue.findMany({
      where,
      take,
      skip,
      orderBy: { issueDate: 'desc' },
      select: {
        id: true,
        issueNo: true,
        issueDate: true,
        contractorId: true,
        contractor: { select: { id: true, name: true } },
        subtotal: true,
        chargePercent: true,
        chargeAmount: true,
        totalAmount: true,
        status: true,
        purpose: true,
        division: true,
        createdAt: true,
        _count: { select: { lines: true } },
      },
    }),
    prisma.contractorStoreIssue.count({ where }),
  ]);

  res.json({ issues, total });
}));

// GET /:id — full detail
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const issue = await prisma.contractorStoreIssue.findUnique({
    where: { id: req.params.id },
    include: {
      contractor: { select: { id: true, name: true, phone: true, gstin: true } },
      lines: { orderBy: { description: 'asc' } },
    },
  });
  if (!issue) throw new NotFoundError('ContractorStoreIssue', req.params.id);
  res.json(issue);
}));

// POST / — create DRAFT
router.post('/', authorize(...WRITE_ROLES), validate(createSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { contractorId, issueDate, chargePercent, purpose, remarks, division, lines } = req.body;
  const pct = chargePercent ?? 5;
  const { subtotal, chargeAmount, totalAmount } = calcTotals(lines, pct);

  const issue = await prisma.contractorStoreIssue.create({
    data: {
      contractorId,
      issueDate: issueDate ? new Date(issueDate) : new Date(),
      chargePercent: pct,
      subtotal,
      chargeAmount,
      totalAmount,
      status: 'DRAFT',
      purpose: purpose ?? null,
      remarks: remarks ?? null,
      division: division ?? 'ETHANOL',
      userId: req.user!.id,
      companyId: getActiveCompanyId(req),
      lines: {
        create: lines.map((l: z.infer<typeof lineSchema>) => ({
          description: l.description,
          inventoryItemId: l.inventoryItemId ?? null,
          quantity: l.quantity,
          unit: l.unit ?? 'NOS',
          rate: l.rate,
          amount: l.quantity * l.rate,
          returnedQty: l.returnedQty ?? 0,
          remarks: l.remarks ?? null,
        })),
      },
    },
    include: {
      contractor: { select: { id: true, name: true } },
      lines: true,
    },
  });

  res.status(201).json(issue);
}));

// PUT /:id — update DRAFT only
router.put('/:id', authorize(...WRITE_ROLES), validate(updateSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.contractorStoreIssue.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new NotFoundError('ContractorStoreIssue', req.params.id);
  if (existing.status !== 'DRAFT') {
    res.status(400).json({ error: 'Only DRAFT issues can be edited' });
    return;
  }

  const { contractorId, issueDate, chargePercent, purpose, remarks, division, lines } = req.body;
  const pct = chargePercent ?? existing.chargePercent;
  const { subtotal, chargeAmount, totalAmount } = calcTotals(lines, pct);

  const issue = await prisma.$transaction(async (tx) => {
    await tx.contractorStoreIssueLine.deleteMany({ where: { issueId: req.params.id } });
    return tx.contractorStoreIssue.update({
      where: { id: req.params.id },
      data: {
        contractorId: contractorId ?? existing.contractorId,
        issueDate: issueDate ? new Date(issueDate) : existing.issueDate,
        chargePercent: pct,
        subtotal,
        chargeAmount,
        totalAmount,
        purpose: purpose !== undefined ? purpose : existing.purpose,
        remarks: remarks !== undefined ? remarks : existing.remarks,
        division: division ?? existing.division,
        lines: {
          create: lines.map((l: z.infer<typeof lineSchema>) => ({
            description: l.description,
            inventoryItemId: l.inventoryItemId ?? null,
            quantity: l.quantity,
            unit: l.unit ?? 'NOS',
            rate: l.rate,
            amount: l.quantity * l.rate,
            returnedQty: l.returnedQty ?? 0,
            remarks: l.remarks ?? null,
          })),
        },
      },
      include: {
        contractor: { select: { id: true, name: true } },
        lines: true,
      },
    });
  });

  res.json(issue);
}));

// POST /:id/confirm — DRAFT → CONFIRMED
router.post('/:id/confirm', authorize(...WRITE_ROLES), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.contractorStoreIssue.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new NotFoundError('ContractorStoreIssue', req.params.id);
  if (existing.status !== 'DRAFT') {
    res.status(400).json({ error: 'Only DRAFT issues can be confirmed' });
    return;
  }

  const issue = await prisma.contractorStoreIssue.update({
    where: { id: req.params.id },
    data: {
      status: 'CONFIRMED',
      confirmedBy: req.user!.id,
      confirmedAt: new Date(),
    },
    include: {
      contractor: { select: { id: true, name: true } },
      lines: true,
    },
  });

  res.json(issue);
}));

// POST /:id/return — mark CONFIRMED → RETURNED
router.post('/:id/return', authorize(...WRITE_ROLES), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.contractorStoreIssue.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new NotFoundError('ContractorStoreIssue', req.params.id);
  if (existing.status !== 'CONFIRMED') {
    res.status(400).json({ error: 'Only CONFIRMED issues can be returned' });
    return;
  }

  const issue = await prisma.contractorStoreIssue.update({
    where: { id: req.params.id },
    data: {
      status: 'RETURNED',
      returnedAt: new Date(),
      returnRemarks: req.body.returnRemarks ?? null,
    },
    include: {
      contractor: { select: { id: true, name: true } },
      lines: true,
    },
  });

  res.json(issue);
}));

// DELETE /:id — delete DRAFT only
router.delete('/:id', authorize(...WRITE_ROLES), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.contractorStoreIssue.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new NotFoundError('ContractorStoreIssue', req.params.id);
  if (existing.status !== 'DRAFT') {
    res.status(400).json({ error: 'Only DRAFT issues can be deleted' });
    return;
  }

  await prisma.contractorStoreIssue.delete({ where: { id: req.params.id } });
  res.json({ success: true });
}));

export default router;
