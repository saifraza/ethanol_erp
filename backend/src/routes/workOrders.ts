import { Router, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { NotFoundError, ValidationError } from '../shared/errors';
import { renderDocumentPdf } from '../services/documentRenderer';
import { sendThreadEmail, syncAndListReplies, latestThreadFor } from '../services/emailService';
import { z } from 'zod';
import { DEFAULT_MANPOWER_TERMS } from '../data/manpowerWoTerms';

const router = Router();
router.use(authenticate);

const WRITE_ROLES = ['ADMIN', 'SUPER_ADMIN', 'STORE_INCHARGE', 'SUPERVISOR', 'MANAGER'];

const canWrite = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) { res.status(403).json({ error: 'Insufficient permissions' }); return; }
  if (WRITE_ROLES.includes(req.user.role) || req.user.role === 'SUPER_ADMIN') { next(); return; }
  if (req.user.allowedModules) {
    const modules = req.user.allowedModules.split(',').map((m) => m.trim());
    if (modules.includes('work-orders')) { next(); return; }
  }
  res.status(403).json({ error: 'Insufficient permissions' });
};

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
  // Manpower supply lines — optional fields, only set when lineKind = 'MANPOWER'
  lineKind: z.enum(['GENERAL', 'MANPOWER']).default('GENERAL'),
  skillCategory: z.string().nullable().optional(),
  shiftHours: z.number().int().refine((v) => v === 8 || v === 12, { message: 'shiftHours must be 8 or 12' }).nullable().optional(),
  personCount: z.number().int().positive().nullable().optional(),
  shiftCount: z.number().int().positive().nullable().optional(),
});

const rateCardEntrySchema = z.object({
  category: z.string().min(1), // SKILLED | SEMI_SKILLED | UNSKILLED | SUPERVISOR (or free text)
  label: z.string().min(1), // human label e.g. "Skilled — Welder"
  rate8h: z.number().min(0),
  rate12h: z.number().min(0),
});

const createSchema = z.object({
  contractorId: z.string().min(1),
  contractType: z.enum(['GENERAL', 'MANPOWER_SUPPLY']).default('GENERAL'),
  manpowerRateCard: z.array(rateCardEntrySchema).nullable().optional(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  siteLocation: z.string().nullable().optional(),
  supplyType: z.enum(['INTRA_STATE', 'INTER_STATE', 'NON_GST']).default('INTRA_STATE'),
  placeOfSupply: z.string().nullable().optional(),
  retentionPercent: z.number().min(0).max(50).default(0),
  paymentTerms: z.string().nullable().optional(),
  creditDays: z.number().int().min(0).max(365).default(30),
  remarks: z.string().nullable().optional(),
  division: z.string().optional(),
  // 2026-05-07 — editable T&C list. Each section: { title, body (multi-line) }.
  // Pre-filled with DEFAULT_MANPOWER_TERMS for MANPOWER_SUPPLY WOs at the
  // form-load step (frontend); the user can edit/add/remove sections before
  // saving. Render order = array order (PDF numbers them 1..N).
  termsAndConditions: z.array(z.object({
    title: z.string().min(1).max(120),
    body: z.string().max(4000),
  })).max(30).nullable().optional(),
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
  lineKind: 'GENERAL' | 'MANPOWER';
  skillCategory: string | null;
  shiftHours: number | null;
  personCount: number | null;
  shiftCount: number | null;
}

function computeLine(l: LineInput, supplyType: 'INTRA_STATE' | 'INTER_STATE' | 'NON_GST'): ComputedLine {
  const amount = r2(l.quantity * l.rate);
  const discountAmount = r2(amount * (l.discountPercent / 100));
  const taxableAmount = r2(amount - discountAmount);
  const effectiveGstPercent = supplyType === 'NON_GST' ? 0 : l.gstPercent;
  const gst = r2(taxableAmount * (effectiveGstPercent / 100));
  const half = r2(gst / 2);

  const cgstPercent = supplyType === 'INTRA_STATE' ? effectiveGstPercent / 2 : 0;
  const sgstPercent = supplyType === 'INTRA_STATE' ? effectiveGstPercent / 2 : 0;
  const igstPercent = supplyType === 'INTER_STATE' ? effectiveGstPercent : 0;

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
    lineKind: l.lineKind ?? 'GENERAL',
    skillCategory: l.skillCategory ?? null,
    shiftHours: l.shiftHours ?? null,
    personCount: l.personCount ?? null,
    shiftCount: l.shiftCount ?? null,
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

  const { contractType } = req.query as Record<string, string | undefined>;
  const where: Record<string, unknown> = { ...getCompanyFilter(req) };
  if (contractorId) where.contractorId = contractorId;
  if (status && status !== 'ALL') where.status = status;
  if (division) where.division = division;
  if (contractType && contractType !== 'ALL') where.contractType = contractType;
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
        contractType: true,
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
        // manpowerRateCard surfaces in the LaborWorkers form so admins
        // don't re-type rates per worker -- they're derived from the
        // selected WO's rate card by skill category.
        manpowerRateCard: true,
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
      contractor: { select: { id: true, name: true, contractorCode: true, gstin: true, email: true, phone: true, panType: true, tdsSection: true, tdsPercent: true } },
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

router.post('/', canWrite, validate(createSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
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
      contractType: body.contractType,
      manpowerRateCard: body.contractType === 'MANPOWER_SUPPLY'
        ? (body.manpowerRateCard ?? [])
        : Prisma.JsonNull,
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
      // T&C: use what frontend sent. If empty AND it's manpower-supply, fall
      // back to the default 7 sections so a half-finished form still produces
      // a valid PDF. Frontend pre-fills the same default at form-load, so this
      // is just a server-side safety net.
      termsAndConditions: body.termsAndConditions
        ? (body.termsAndConditions as Prisma.InputJsonValue)
        : (body.contractType === 'MANPOWER_SUPPLY'
          ? (DEFAULT_MANPOWER_TERMS as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull),
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

router.put('/:id', canWrite, validate(updateSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new NotFoundError('WorkOrder', req.params.id);
  if (existing.status !== 'DRAFT') throw new ValidationError('Only DRAFT work orders can be edited');

  const contractor = await prisma.contractor.findUnique({ where: { id: req.body.contractorId ?? existing.contractorId } });
  if (!contractor) throw new NotFoundError('Contractor', req.body.contractorId ?? existing.contractorId);

  const supplyType = (req.body.supplyType ?? existing.supplyType) as 'INTRA_STATE' | 'INTER_STATE' | 'NON_GST';
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
        contractType: req.body.contractType ?? existing.contractType,
        manpowerRateCard: req.body.contractType === 'MANPOWER_SUPPLY'
          ? (req.body.manpowerRateCard ?? (existing.manpowerRateCard as Prisma.InputJsonValue) ?? [])
          : (req.body.contractType === 'GENERAL'
            ? Prisma.JsonNull
            : (existing.manpowerRateCard as Prisma.InputJsonValue ?? Prisma.JsonNull)),
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
        termsAndConditions: req.body.termsAndConditions !== undefined
          ? (req.body.termsAndConditions === null
            ? Prisma.JsonNull
            : (req.body.termsAndConditions as Prisma.InputJsonValue))
          : (existing.termsAndConditions as Prisma.InputJsonValue ?? Prisma.JsonNull),
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

router.post('/:id/approve', canWrite, asyncHandler(async (req: AuthRequest, res: Response) => {
  const wo = await transition(req.params.id, ['DRAFT'], 'APPROVED', {
    approvedBy: req.user!.id,
    approvedAt: new Date(),
  });
  res.json(wo);
}));

router.post('/:id/start', canWrite, asyncHandler(async (req: AuthRequest, res: Response) => {
  const wo = await transition(req.params.id, ['APPROVED'], 'IN_PROGRESS', {
    startedAt: new Date(),
  });
  res.json(wo);
}));

router.post('/:id/complete', canWrite, asyncHandler(async (req: AuthRequest, res: Response) => {
  const wo = await transition(req.params.id, ['IN_PROGRESS'], 'COMPLETED', {
    completedAt: new Date(),
    progressPercent: 100,
  });
  res.json(wo);
}));

router.post('/:id/close', canWrite, asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new NotFoundError('WorkOrder', req.params.id);
  if (existing.balanceAmount > 0.01) {
    throw new ValidationError(`Cannot close — unbilled balance ${existing.balanceAmount}. Bill or cancel remaining scope first.`);
  }
  const wo = await transition(req.params.id, ['COMPLETED'], 'CLOSED', { closedAt: new Date() });
  res.json(wo);
}));

router.post('/:id/cancel', canWrite, asyncHandler(async (req: AuthRequest, res: Response) => {
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

router.delete('/:id', canWrite, asyncHandler(async (req: AuthRequest, res: Response) => {
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

router.post('/:id/progress', canWrite, validate(progressSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
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

router.post('/:id/recompute', canWrite, asyncHandler(async (req: AuthRequest, res: Response) => {
  await recomputeWorkOrderTotals(req.params.id);
  const wo = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
  if (!wo) throw new NotFoundError('WorkOrder', req.params.id);
  res.json(wo);
}));

// ────────────────────────────────────────────────────────────────
// GET /:id/pdf — render Work Order PDF
// ────────────────────────────────────────────────────────────────

async function loadWoForPdf(id: string) {
  const wo = await prisma.workOrder.findUnique({
    where: { id },
    include: {
      contractor: {
        select: {
          id: true, name: true, contractorCode: true, gstin: true,
          phone: true, email: true, address: true, panType: true,
          tdsSection: true, tdsPercent: true,
        },
      },
      lines: { orderBy: { lineNo: 'asc' } },
    },
  });
  if (!wo) throw new NotFoundError('WorkOrder', id);

  const creator = wo.userId
    ? await prisma.user.findUnique({ where: { id: wo.userId }, select: { name: true, email: true } })
    : null;

  return {
    woNo: wo.woNo,
    title: wo.title,
    description: wo.description,
    contractType: wo.contractType,
    createdAt: wo.createdAt,
    startDate: wo.startDate,
    endDate: wo.endDate,
    siteLocation: wo.siteLocation,
    supplyType: wo.supplyType,
    placeOfSupply: wo.placeOfSupply,
    status: wo.status,
    division: wo.division,
    creditDays: wo.creditDays,
    paymentTerms: wo.paymentTerms,
    retentionPercent: wo.retentionPercent,
    retentionAmount: wo.retentionAmount,
    tdsSection: wo.tdsSection,
    tdsPercent: wo.tdsPercent,
    tdsAmount: wo.tdsAmount,
    subtotal: wo.subtotal,
    discountAmount: wo.discountAmount,
    taxableAmount: wo.taxableAmount,
    totalCgst: wo.totalCgst,
    totalSgst: wo.totalSgst,
    totalIgst: wo.totalIgst,
    totalGst: wo.totalGst,
    grandTotal: wo.grandTotal,
    remarks: wo.remarks,
    contractor: wo.contractor,
    lines: wo.lines,
    // T&C list — array of { title, body }. Body's newlines are converted
    // to <br/> in the template via the standard `nl2br` helper.
    termsAndConditions: Array.isArray(wo.termsAndConditions)
      ? (wo.termsAndConditions as unknown as Array<{ title: string; body: string }>)
      : [],
    preparedBy: creator?.name || creator?.email || '',
    _raw: wo,
  };
}

router.get('/:id/pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = await loadWoForPdf(req.params.id);
  const remarks = (req.query.remarks as string) || '';
  const pdfData = remarks ? { ...data, remarks: data.remarks ? `${data.remarks}\n\n${remarks}` : remarks } : data;
  const pdf = await renderDocumentPdf({
    docType: 'WORK_ORDER',
    data: pdfData,
    verifyId: req.params.id,
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="WO-${data.woNo}.pdf"`);
  res.send(pdf);
}));

// ────────────────────────────────────────────────────────────────
// GET /:id/email-status — sent/not-sent + thread metadata
// ────────────────────────────────────────────────────────────────

router.get('/:id/email-status', asyncHandler(async (req: AuthRequest, res: Response) => {
  const thread = await latestThreadFor('WORK_ORDER', req.params.id);
  if (!thread) {
    res.json({ sent: false });
    return;
  }
  res.json({
    sent: true,
    threadId: thread.id,
    sentAt: thread.sentAt,
    sentTo: thread.toEmail,
    sentBy: thread.sentBy,
    replyCount: thread.replyCount,
    hasUnreadReply: thread.hasUnreadReply,
  });
}));

// ────────────────────────────────────────────────────────────────
// GET /:id/replies — IMAP sync + return persisted replies
// ────────────────────────────────────────────────────────────────

router.get('/:id/replies', asyncHandler(async (req: AuthRequest, res: Response) => {
  const thread = await latestThreadFor('WORK_ORDER', req.params.id);
  if (!thread) {
    res.json({ replies: [], threadDbId: null, error: 'Email not sent yet' });
    return;
  }

  const result = await syncAndListReplies(thread.id);
  res.json({
    threadDbId: thread.id,
    replies: result.replies.map((r) => ({
      id: r.id,
      messageId: r.providerMessageId,
      from: r.fromEmail,
      fromName: r.fromName,
      subject: r.subject,
      date: r.receivedAt,
      bodyText: r.bodyText,
      bodyHtml: r.bodyHtml,
      attachments: Array.isArray(r.attachments)
        ? (r.attachments as Array<{ filename: string; size: number; contentType: string }>).map((a) => ({
            filename: a.filename, size: a.size, contentType: a.contentType,
          }))
        : [],
    })),
    newCount: result.newCount,
    fetchError: result.fetchError,
  });
}));

// ────────────────────────────────────────────────────────────────
// GET /:id/replies/:replyId/attachment/:filename — download attachment
// ────────────────────────────────────────────────────────────────

router.get('/:id/replies/:replyId/attachment/:filename', asyncHandler(async (req: AuthRequest, res: Response) => {
  const reply = await prisma.emailReply.findUnique({ where: { id: req.params.replyId } });
  if (!reply) throw new NotFoundError('EmailReply', req.params.replyId);
  const filename = decodeURIComponent(req.params.filename);
  const att = Array.isArray(reply.attachments)
    ? (reply.attachments as Array<{ filename: string; contentBase64?: string; contentType?: string }>).find((a) => a.filename === filename)
    : null;
  if (!att || !att.contentBase64) throw new NotFoundError('Attachment', filename);
  const buf = Buffer.from(att.contentBase64, 'base64');
  res.setHeader('Content-Type', att.contentType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
}));

// ────────────────────────────────────────────────────────────────
// POST /:id/send-email — generate PDF + email contractor
// Body: { extraMessage?: string, cc?: string }
// ────────────────────────────────────────────────────────────────

router.post('/:id/send-email', canWrite, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { extraMessage, cc } = req.body as { extraMessage?: string; cc?: string };
  const data = await loadWoForPdf(req.params.id);

  if (!data.contractor.email) {
    res.status(400).json({ error: 'Contractor has no email on file' });
    return;
  }

  const pdfData = extraMessage
    ? { ...data, remarks: data.remarks ? `${data.remarks}\n\n${extraMessage}` : extraMessage }
    : data;
  const pdf = await renderDocumentPdf({ docType: 'WORK_ORDER', data: pdfData, verifyId: req.params.id });

  const typeLabel = data.contractType === 'MANPOWER_SUPPLY' ? 'Manpower Supply Contract' : 'Work Order';
  const subject = `WO-${data.woNo} — ${typeLabel} from MSPIL`;
  const linesSummary = data.lines.map((l: { lineNo: number; description: string; quantity: number; unit: string }) =>
    `  ${l.lineNo}. ${l.description} — ${l.quantity} ${l.unit}`
  ).join('\n');

  const text = `Dear ${data.contractor.name},

Please find attached ${typeLabel} WO-${data.woNo}.

Title: ${data.title}
${data.siteLocation ? `Site: ${data.siteLocation}\n` : ''}
Scope items:
${linesSummary}

Grand Total: Rs. ${data.grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
${extraMessage ? `\n${extraMessage}\n` : ''}
Regards,
${req.user!.name || req.user!.email}
Mahakaushal Sugar and Power Industries Ltd (MSPIL)
`;

  const html = `<p>Dear ${data.contractor.name},</p>
<p>Please find attached <b>${typeLabel} WO-${data.woNo}</b>.</p>
<p><b>Title:</b> ${data.title}</p>
${data.siteLocation ? `<p><b>Site:</b> ${data.siteLocation}</p>` : ''}
<p><b>Scope items:</b></p>
<ol>${data.lines.map((l: { description: string; quantity: number; unit: string }) =>
    `<li>${l.description} — ${l.quantity} ${l.unit}</li>`).join('')}</ol>
<p><b>Grand Total:</b> Rs. ${data.grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
${extraMessage ? `<p>${extraMessage}</p>` : ''}
<p>Regards,<br>${req.user!.name || req.user!.email}<br>Mahakaushal Sugar and Power Industries Ltd (MSPIL)</p>`;

  const result = await sendThreadEmail({
    entityType: 'WORK_ORDER',
    entityId: req.params.id,
    vendorId: null,
    subject,
    to: data.contractor.email,
    cc: cc || undefined,
    bodyText: text,
    bodyHtml: html,
    attachments: [{
      filename: `WO-${data.woNo}.pdf`,
      content: pdf,
      contentType: 'application/pdf',
    }],
    sentBy: req.user!.name || req.user!.email,
    companyId: data._raw.companyId,
  });

  if (!result.success) {
    res.status(502).json({ error: result.error || 'Failed to send email' });
    return;
  }

  res.json({ ok: true, messageId: result.messageId, sentTo: data.contractor.email });
}));

export default router;
