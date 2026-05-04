import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { NotFoundError, ValidationError } from '../shared/errors';
import { z } from 'zod';

const router = Router();
router.use(authenticate);

const WRITE_ROLES = ['ADMIN', 'SUPER_ADMIN', 'STORE_INCHARGE', 'SUPERVISOR', 'MANAGER'];

// ────────────────────────────────────────────────────────────────
// Schemas
// ────────────────────────────────────────────────────────────────

const lineSchema = z.object({
  description: z.string().min(1),
  hsnSac: z.string().nullable().optional(),
  quantity: z.number().positive(),
  unit: z.string().default('NOS'),
  rate: z.number().min(0),
  discountPercent: z.number().min(0).max(100).default(0),
  gstPercent: z.number().min(0).max(40).default(18),
  remarks: z.string().nullable().optional(),
});

const createSchema = z.object({
  contractorId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  siteLocation: z.string().nullable().optional(),
  supplyType: z.enum(['INTRA_STATE', 'INTER_STATE']).default('INTRA_STATE'),
  placeOfSupply: z.string().nullable().optional(),
  retentionPercent: z.number().min(0).max(50).default(0),
  paymentTerms: z.string().nullable().optional(),
  creditDays: z.number().int().min(0).max(365).default(30),
  remarks: z.string().nullable().optional(),
  division: z.string().optional(),
  lines: z.array(lineSchema).min(1),
});

const updateSchema = createSchema.partial().extend({
  lines: z.array(lineSchema).min(1),
});

const progressSchema = z.object({
  percent: z.number().min(0).max(100),
  workDone: z.string().min(1),
  photoUrl: z.string().nullable().optional(),
  remarks: z.string().nullable().optional(),
});

// ────────────────────────────────────────────────────────────────
// Tax helpers
// ────────────────────────────────────────────────────────────────

const r2 = (n: number) => Math.round(n * 100) / 100;

type LineInput = z.infer<typeof lineSchema>;

interface ComputedLine {
  description: string;
  hsnSac: string | null;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
  discountPercent: number;
  discountAmount: number;
  taxableAmount: number;
  gstPercent: number;
  cgstPercent: number;
  cgstAmount: number;
  sgstPercent: number;
  sgstAmount: number;
  igstPercent: number;
  igstAmount: number;
  totalGst: number;
  lineTotal: number;
  remarks: string | null;
}

function computeLine(l: LineInput, supplyType: 'INTRA_STATE' | 'INTER_STATE'): ComputedLine {
  const amount = r2(l.quantity * l.rate);
  const discountAmount = r2(amount * (l.discountPercent / 100));
  const taxableAmount = r2(amount - discountAmount);
  const gst = r2(taxableAmount * (l.gstPercent / 100));
  const half = r2(gst / 2);

  const cgstPercent = supplyType === 'INTRA_STATE' ? l.gstPercent / 2 : 0;
  const sgstPercent = supplyType === 'INTRA_STATE' ? l.gstPercent / 2 : 0;
  const igstPercent = supplyType === 'INTER_STATE' ? l.gstPercent : 0;

  const cgstAmount = supplyType === 'INTRA_STATE' ? half : 0;
  const sgstAmount = supplyType === 'INTRA_STATE' ? r2(gst - half) : 0;
  const igstAmount = supplyType === 'INTER_STATE' ? gst : 0;

  const totalGst = r2(cgstAmount + sgstAmount + igstAmount);
  const lineTotal = r2(taxableAmount + totalGst);

  return {
    description: l.description,
    hsnSac: l.hsnSac ?? null,
    quantity: l.quantity,
    unit: l.unit ?? 'NOS',
    rate: l.rate,
    amount,
    discountPercent: l.discountPercent,
    discountAmount,
    taxableAmount,
    gstPercent: l.gstPercent,
    cgstPercent,
    cgstAmount,
    sgstPercent,
    sgstAmount,
    igstPercent,
    igstAmount,
    totalGst,
    lineTotal,
    remarks: l.remarks ?? null,
  };
}

interface HeaderTotals {
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  totalCgst: number;
  totalSgst: number;
  totalIgst: number;
  totalGst: number;
  grandTotal: number;
  retentionAmount: number;
  tdsAmount: number;
}

function computeHeader(
  computed: ComputedLine[],
  retentionPercent: number,
  tdsPercent: number,
): HeaderTotals {
  const subtotal = r2(computed.reduce((s, l) => s + l.amount, 0));
  const discountAmount = r2(computed.reduce((s, l) => s + l.discountAmount, 0));
  const taxableAmount = r2(computed.reduce((s, l) => s + l.taxableAmount, 0));
  const totalCgst = r2(computed.reduce((s, l) => s + l.cgstAmount, 0));
  const totalSgst = r2(computed.reduce((s, l) => s + l.sgstAmount, 0));
  const totalIgst = r2(computed.reduce((s, l) => s + l.igstAmount, 0));
  const totalGst = r2(totalCgst + totalSgst + totalIgst);
  const grandTotal = r2(taxableAmount + totalGst);
  const retentionAmount = r2(grandTotal * (retentionPercent / 100));
  const tdsAmount = r2(taxableAmount * (tdsPercent / 100));
  return {
    subtotal,
    discountAmount,
    taxableAmount,
    totalCgst,
    totalSgst,
    totalIgst,
    totalGst,
    grandTotal,
    retentionAmount,
    tdsAmount,
  };
}

// ────────────────────────────────────────────────────────────────
// GET / — list
// ────────────────────────────────────────────────────────────────

router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const take = Math.min(parseInt(req.query.limit as string) || 50, 500);
  const skip = parseInt(req.query.offset as string) || 0;
  const { contractorId, status, dateFrom, dateTo, division } = req.query as Record<string, string | undefined>;

  const where: Record<string, unknown> = { ...getCompanyFilter(req) };
  if (contractorId) where.contractorId = contractorId;
  if (status && status !== 'ALL') where.status = status;
  if (division) where.division = division;
  if (dateFrom || dateTo) {
    where.startDate = {
      ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
      ...(dateTo ? { lte: new Date(dateTo) } : {}),
    };
  }

  const [orders, total, allForStats] = await Promise.all([
    prisma.workOrder.findMany({
      where,
      take,
      skip,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        woNo: true,
        title: true,
        contractorId: true,
        contractor: { select: { id: true, name: true, contractorCode: true } },
        startDate: true,
        endDate: true,
        siteLocation: true,
        subtotal: true,
        taxableAmount: true,
        totalGst: true,
        grandTotal: true,
        retentionAmount: true,
        tdsAmount: true,
        billedAmount: true,
        paidAmount: true,
        balanceAmount: true,
        progressPercent: true,
        status: true,
        division: true,
        createdAt: true,
        _count: { select: { lines: true, bills: true, progress: true } },
      },
    }),
    prisma.workOrder.count({ where }),
    prisma.workOrder.findMany({
      where: { ...getCompanyFilter(req) },
      select: { status: true, grandTotal: true, billedAmount: true, paidAmount: true, balanceAmount: true },
      take: 500,
    }),
  ]);

  const stats = {
    total: allForStats.length,
    draft: allForStats.filter((w) => w.status === 'DRAFT').length,
    approved: allForStats.filter((w) => w.status === 'APPROVED').length,
    inProgress: allForStats.filter((w) => w.status === 'IN_PROGRESS').length,
    completed: allForStats.filter((w) => w.status === 'COMPLETED').length,
    closed: allForStats.filter((w) => w.status === 'CLOSED').length,
    totalValue: r2(allForStats.reduce((s, w) => s + w.grandTotal, 0)),
    totalBilled: r2(allForStats.reduce((s, w) => s + w.billedAmount, 0)),
    totalUnbilled: r2(allForStats.reduce((s, w) => s + Math.max(0, w.balanceAmount), 0)),
  };

  res.json({ orders, total, stats });
}));

// ────────────────────────────────────────────────────────────────
// GET /:id — full detail
// ────────────────────────────────────────────────────────────────

router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const wo = await prisma.workOrder.findUnique({
    where: { id: req.params.id },
    include: {
      contractor: { select: { id: true, name: true, contractorCode: true, gstin: true, phone: true, panType: true, tdsSection: true, tdsPercent: true } },
      lines: { orderBy: { lineNo: 'asc' } },
      progress: { orderBy: { reportedAt: 'desc' } },
      bills: {
        orderBy: { billDate: 'desc' },
        select: {
          id: true,
          billNo: true,
          billDate: true,
          subtotal: true,
          totalAmount: true,
          netPayable: true,
          paidAmount: true,
          balanceAmount: true,
          status: true,
          vendorBillNo: true,
        },
      },
    },
  });
  if (!wo) throw new NotFoundError('WorkOrder', req.params.id);
  res.json(wo);
}));

// ────────────────────────────────────────────────────────────────
// POST / — create DRAFT
// ────────────────────────────────────────────────────────────────

router.post('/', authorize(...WRITE_ROLES), validate(createSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = req.body as z.infer<typeof createSchema>;

  const contractor = await prisma.contractor.findUnique({ where: { id: body.contractorId } });
  if (!contractor) throw new NotFoundError('Contractor', body.contractorId);

  const computed = body.lines.map((l) => computeLine(l, body.supplyType));
  const header = computeHeader(computed, body.retentionPercent ?? 0, contractor.tdsPercent);

  const wo = await prisma.workOrder.create({
    data: {
      contractorId: body.contractorId,
      title: body.title,
      description: body.description ?? null,
      startDate: body.startDate ? new Date(body.startDate) : null,
      endDate: body.endDate ? new Date(body.endDate) : null,
      siteLocation: body.siteLocation ?? null,
      supplyType: body.supplyType,
      placeOfSupply: body.placeOfSupply ?? null,
      subtotal: header.subtotal,
      discountAmount: header.discountAmount,
      taxableAmount: header.taxableAmount,
      totalCgst: header.totalCgst,
      totalSgst: header.totalSgst,
      totalIgst: header.totalIgst,
      totalGst: header.totalGst,
      grandTotal: header.grandTotal,
      retentionPercent: body.retentionPercent ?? 0,
      retentionAmount: header.retentionAmount,
      tdsSection: contractor.tdsSection,
      tdsPercent: contractor.tdsPercent,
      tdsAmount: header.tdsAmount,
      balanceAmount: header.grandTotal,
      status: 'DRAFT',
      paymentTerms: body.paymentTerms ?? null,
      creditDays: body.creditDays ?? 30,
      remarks: body.remarks ?? null,
      division: body.division ?? 'ETHANOL',
      userId: req.user!.id,
      companyId: getActiveCompanyId(req),
      lines: {
        create: computed.map((c, idx) => ({ ...c, lineNo: idx + 1 })),
      },
    },
    include: {
      contractor: { select: { id: true, name: true, contractorCode: true } },
      lines: { orderBy: { lineNo: 'asc' } },
    },
  });

  res.status(201).json(wo);
}));

// ────────────────────────────────────────────────────────────────
// PUT /:id — update DRAFT only
// ────────────────────────────────────────────────────────────────

router.put('/:id', authorize(...WRITE_ROLES), validate(updateSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new NotFoundError('WorkOrder', req.params.id);
  if (existing.status !== 'DRAFT') throw new ValidationError('Only DRAFT work orders can be edited');

  const contractor = await prisma.contractor.findUnique({ where: { id: req.body.contractorId ?? existing.contractorId } });
  if (!contractor) throw new NotFoundError('Contractor', req.body.contractorId ?? existing.contractorId);

  const supplyType = (req.body.supplyType ?? existing.supplyType) as 'INTRA_STATE' | 'INTER_STATE';
  const retentionPercent = req.body.retentionPercent ?? existing.retentionPercent;

  const computed = (req.body.lines as LineInput[]).map((l) => computeLine(l, supplyType));
  const header = computeHeader(computed, retentionPercent, contractor.tdsPercent);

  const wo = await prisma.$transaction(async (tx) => {
    await tx.workOrderLine.deleteMany({ where: { woId: req.params.id } });
    return tx.workOrder.update({
      where: { id: req.params.id },
      data: {
        contractorId: contractor.id,
        title: req.body.title ?? existing.title,
        description: req.body.description !== undefined ? req.body.description : existing.description,
        startDate: req.body.startDate ? new Date(req.body.startDate) : existing.startDate,
        endDate: req.body.endDate ? new Date(req.body.endDate) : existing.endDate,
        siteLocation: req.body.siteLocation !== undefined ? req.body.siteLocation : existing.siteLocation,
        supplyType,
        placeOfSupply: req.body.placeOfSupply !== undefined ? req.body.placeOfSupply : existing.placeOfSupply,
        subtotal: header.subtotal,
        discountAmount: header.discountAmount,
        taxableAmount: header.taxableAmount,
        totalCgst: header.totalCgst,
        totalSgst: header.totalSgst,
        totalIgst: header.totalIgst,
        totalGst: header.totalGst,
        grandTotal: header.grandTotal,
        retentionPercent,
        retentionAmount: header.retentionAmount,
        tdsSection: contractor.tdsSection,
        tdsPercent: contractor.tdsPercent,
        tdsAmount: header.tdsAmount,
        balanceAmount: r2(header.grandTotal - existing.billedAmount),
        paymentTerms: req.body.paymentTerms !== undefined ? req.body.paymentTerms : existing.paymentTerms,
        creditDays: req.body.creditDays ?? existing.creditDays,
        remarks: req.body.remarks !== undefined ? req.body.remarks : existing.remarks,
        division: req.body.division ?? existing.division,
        lines: {
          create: computed.map((c, idx) => ({ ...c, lineNo: idx + 1 })),
        },
      },
      include: {
        contractor: { select: { id: true, name: true, contractorCode: true } },
        lines: { orderBy: { lineNo: 'asc' } },
      },
    });
  });

  res.json(wo);
}));

// ────────────────────────────────────────────────────────────────
// Lifecycle transitions
// ────────────────────────────────────────────────────────────────

async function transition(
  id: string,
  from: string[],
  to: string,
  extra: Record<string, unknown>,
): Promise<unknown> {
  const existing = await prisma.workOrder.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('WorkOrder', id);
  if (!from.includes(existing.status)) {
    throw new ValidationError(`WorkOrder must be in ${from.join('/')} to transition to ${to} (current: ${existing.status})`);
  }
  return prisma.workOrder.update({
    where: { id },
    data: { status: to, ...extra },
    include: {
      contractor: { select: { id: true, name: true } },
      lines: { orderBy: { lineNo: 'asc' } },
    },
  });
}

router.post('/:id/approve', authorize(...WRITE_ROLES), asyncHandler(async (req: AuthRequest, res: Response) => {
  const wo = await transition(req.params.id, ['DRAFT'], 'APPROVED', {
    approvedBy: req.user!.id,
    approvedAt: new Date(),
  });
  res.json(wo);
}));

router.post('/:id/start', authorize(...WRITE_ROLES), asyncHandler(async (req: AuthRequest, res: Response) => {
  const wo = await transition(req.params.id, ['APPROVED'], 'IN_PROGRESS', {
    startedAt: new Date(),
  });
  res.json(wo);
}));

router.post('/:id/complete', authorize(...WRITE_ROLES), asyncHandler(async (req: AuthRequest, res: Response) => {
  const wo = await transition(req.params.id, ['IN_PROGRESS'], 'COMPLETED', {
    completedAt: new Date(),
    progressPercent: 100,
  });
  res.json(wo);
}));

router.post('/:id/close', authorize(...WRITE_ROLES), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new NotFoundError('WorkOrder', req.params.id);
  if (existing.balanceAmount > 0.01) {
    throw new ValidationError(`Cannot close — unbilled balance ${existing.balanceAmount}. Bill or cancel remaining scope first.`);
  }
  const wo = await transition(req.params.id, ['COMPLETED'], 'CLOSED', { closedAt: new Date() });
  res.json(wo);
}));

router.post('/:id/cancel', authorize(...WRITE_ROLES), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.workOrder.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { bills: true } } },
  });
  if (!existing) throw new NotFoundError('WorkOrder', req.params.id);
  if (existing._count.bills > 0) {
    throw new ValidationError('Cannot cancel — bills exist against this work order. Cancel each bill first.');
  }
  if (!['DRAFT', 'APPROVED', 'IN_PROGRESS'].includes(existing.status)) {
    throw new ValidationError(`Cannot cancel from ${existing.status}`);
  }
  const wo = await prisma.workOrder.update({
    where: { id: req.params.id },
    data: {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancelReason: req.body.reason ?? null,
    },
  });
  res.json(wo);
}));

// ────────────────────────────────────────────────────────────────
// DELETE /:id — delete DRAFT only
// ────────────────────────────────────────────────────────────────

router.delete('/:id', authorize(...WRITE_ROLES), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.workOrder.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { bills: true } } },
  });
  if (!existing) throw new NotFoundError('WorkOrder', req.params.id);
  if (existing.status !== 'DRAFT') throw new ValidationError('Only DRAFT work orders can be deleted');
  if (existing._count.bills > 0) throw new ValidationError('Cannot delete — bills are linked to this work order');

  await prisma.workOrder.delete({ where: { id: req.params.id } });
  res.json({ success: true });
}));

// ────────────────────────────────────────────────────────────────
// POST /:id/progress — record progress entry
// ────────────────────────────────────────────────────────────────

router.post('/:id/progress', authorize(...WRITE_ROLES), validate(progressSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const wo = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
  if (!wo) throw new NotFoundError('WorkOrder', req.params.id);
  if (!['APPROVED', 'IN_PROGRESS', 'COMPLETED'].includes(wo.status)) {
    throw new ValidationError('Progress can only be reported on APPROVED / IN_PROGRESS / COMPLETED work orders');
  }

  const body = req.body as z.infer<typeof progressSchema>;

  const result = await prisma.$transaction(async (tx) => {
    const entry = await tx.workOrderProgress.create({
      data: {
        woId: req.params.id,
        percent: body.percent,
        workDone: body.workDone,
        photoUrl: body.photoUrl ?? null,
        reportedBy: req.user!.id,
        remarks: body.remarks ?? null,
      },
    });
    // Auto-promote APPROVED → IN_PROGRESS on first progress entry
    const nextStatus = wo.status === 'APPROVED' ? 'IN_PROGRESS' : wo.status;
    await tx.workOrder.update({
      where: { id: req.params.id },
      data: {
        progressPercent: body.percent,
        status: nextStatus,
        startedAt: wo.startedAt ?? (nextStatus === 'IN_PROGRESS' ? new Date() : null),
      },
    });
    return entry;
  });

  res.status(201).json(result);
}));

// ────────────────────────────────────────────────────────────────
// POST /:id/recompute — refresh billed/paid roll-ups from linked bills
// (called by ContractorBill confirm/payment hooks; also exposed for
// admin re-sync)
// ────────────────────────────────────────────────────────────────

// Refresh billed/paid roll-ups from linked bills (used by recompute endpoint
// and ContractorBill confirm/pay hooks). Safe no-op if WO doesn't exist.
export async function recomputeWorkOrderTotals(woId: string): Promise<void> {
  const existing = await prisma.workOrder.findUnique({ where: { id: woId } });
  if (!existing) return;

  const bills = await prisma.contractorBill.findMany({
    where: { workOrderId: woId, status: { not: 'CANCELLED' } },
    select: { subtotal: true, paidAmount: true, status: true },
  });

  const billedAmount = r2(bills.filter((b) => b.status !== 'DRAFT').reduce((s, b) => s + b.subtotal, 0));
  const paidAmount = r2(bills.reduce((s, b) => s + b.paidAmount, 0));
  const balanceAmount = r2(existing.grandTotal - billedAmount);

  await prisma.workOrder.update({
    where: { id: woId },
    data: { billedAmount, paidAmount, balanceAmount },
  });
}

router.post('/:id/recompute', authorize(...WRITE_ROLES), asyncHandler(async (req: AuthRequest, res: Response) => {
  await recomputeWorkOrderTotals(req.params.id);
  const wo = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
  if (!wo) throw new NotFoundError('WorkOrder', req.params.id);
  res.json(wo);
}));

export default router;
