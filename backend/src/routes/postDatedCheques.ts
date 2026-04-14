import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { AuthRequest, authenticate, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';

// ── Zod Schemas ─────────────────────────────────────────────

const createPDCSchema = z.object({
  direction: z.enum(['INCOMING', 'OUTGOING']).default('OUTGOING'),
  chequeNumber: z.string().min(1, 'Cheque number is required'),
  chequeDate: z.coerce.date(),
  maturityDate: z.coerce.date(),
  amount: z.coerce.number().positive('Amount must be positive'),
  bankName: z.string().default(''),
  branchName: z.string().nullish(),
  accountNo: z.string().nullish(),
  partyType: z.enum(['VENDOR', 'CUSTOMER']).default('VENDOR'),
  partyId: z.string().min(1, 'Party is required'),
  partyName: z.string().min(1, 'Party name is required'),
  purpose: z.string().nullish(),
  linkedInvoiceId: z.string().nullish(),
  linkedPoId: z.string().nullish(),
  remarks: z.string().nullish(),
});

const updatePDCSchema = z.object({
  chequeNumber: z.string().min(1).optional(),
  chequeDate: z.coerce.date().optional(),
  maturityDate: z.coerce.date().optional(),
  amount: z.coerce.number().positive().optional(),
  bankName: z.string().optional(),
  branchName: z.string().nullish(),
  accountNo: z.string().nullish(),
  purpose: z.string().nullish(),
  remarks: z.string().nullish(),
});

const depositSchema = z.object({
  depositDate: z.coerce.date().optional(),
});

const clearSchema = z.object({
  clearDate: z.coerce.date().optional(),
});

const dishonourSchema = z.object({
  reason: z.string().default('Insufficient funds'),
});

const router = Router();
router.use(authenticate as any);

// ═══════════════════════════════════════════════
// GET / — List PDCs with filters
// ═══════════════════════════════════════════════
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const direction = req.query.direction as string | undefined;
  const status = req.query.status as string | undefined;
  const partyType = req.query.partyType as string | undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const take = Math.min(parseInt(req.query.limit as string) || 100, 500);

  const where: Record<string, unknown> = { ...getCompanyFilter(req) };
  if (direction) where.direction = direction;
  if (status) where.status = status;
  if (partyType) where.partyType = partyType;
  if (from || to) {
    where.maturityDate = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }

  const items = await prisma.postDatedCheque.findMany({
    where,
    orderBy: { maturityDate: 'asc' },
    take,
  });

  res.json({ items });
}));

// ═══════════════════════════════════════════════
// GET /summary — KPIs
// ═══════════════════════════════════════════════
router.get('/summary', asyncHandler(async (req: AuthRequest, res: Response) => {
  const direction = req.query.direction as string | undefined;
  const dirFilter = direction ? { direction } : {};

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekFromNow = new Date(today);
  weekFromNow.setDate(weekFromNow.getDate() + 7);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [activeAgg, weekAgg, overdueAgg, clearedAgg] = await Promise.all([
    // Total Active (issued + deposited)
    prisma.postDatedCheque.aggregate({
      where: { ...dirFilter, status: { in: ['ISSUED', 'DEPOSITED'] } },
      _sum: { amount: true },
      _count: true,
    }),
    // Maturing this week
    prisma.postDatedCheque.aggregate({
      where: { ...dirFilter, status: { in: ['ISSUED', 'DEPOSITED'] }, maturityDate: { gte: today, lte: weekFromNow } },
      _sum: { amount: true },
      _count: true,
    }),
    // Overdue (past maturity, not cleared/cancelled)
    prisma.postDatedCheque.aggregate({
      where: { ...dirFilter, status: { in: ['ISSUED'] }, maturityDate: { lt: today } },
      _sum: { amount: true },
      _count: true,
    }),
    // Cleared this month
    prisma.postDatedCheque.aggregate({
      where: { ...dirFilter, status: 'CLEARED', clearDate: { gte: monthStart } },
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  res.json({
    active: { amount: activeAgg._sum.amount || 0, count: activeAgg._count },
    maturingThisWeek: { amount: weekAgg._sum.amount || 0, count: weekAgg._count },
    overdue: { amount: overdueAgg._sum.amount || 0, count: overdueAgg._count },
    clearedThisMonth: { amount: clearedAgg._sum.amount || 0, count: clearedAgg._count },
  });
}));

// ═══════════════════════════════════════════════
// POST / — Create PDC
// ═══════════════════════════════════════════════
router.post('/', validate(createPDCSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;

  const pdc = await prisma.postDatedCheque.create({
    data: {
      direction: b.direction,
      chequeNumber: b.chequeNumber,
      chequeDate: b.chequeDate,
      maturityDate: b.maturityDate,
      amount: b.amount,
      bankName: b.bankName,
      branchName: b.branchName ?? null,
      accountNo: b.accountNo ?? null,
      partyType: b.partyType,
      partyId: b.partyId,
      partyName: b.partyName,
      purpose: b.purpose ?? null,
      linkedInvoiceId: b.linkedInvoiceId ?? null,
      linkedPoId: b.linkedPoId ?? null,
      remarks: b.remarks ?? null,
      userId: req.user!.id,
      companyId: getActiveCompanyId(req),
    },
  });

  res.status(201).json(pdc);
}));

// ═══════════════════════════════════════════════
// PUT /:id — Update (only ISSUED)
// ═══════════════════════════════════════════════
router.put('/:id', validate(updatePDCSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.postDatedCheque.findUnique({ where: { id: req.params.id } });
  if (!existing) { res.status(404).json({ error: 'PDC not found' }); return; }
  if (existing.status !== 'ISSUED') { res.status(400).json({ error: 'Can only edit cheques in ISSUED status' }); return; }

  const b = req.body;
  const updated = await prisma.postDatedCheque.update({
    where: { id: req.params.id },
    data: {
      chequeNumber: b.chequeNumber ?? existing.chequeNumber,
      chequeDate: b.chequeDate ?? existing.chequeDate,
      maturityDate: b.maturityDate ?? existing.maturityDate,
      amount: b.amount ?? existing.amount,
      bankName: b.bankName ?? existing.bankName,
      branchName: b.branchName ?? existing.branchName,
      accountNo: b.accountNo ?? existing.accountNo,
      purpose: b.purpose ?? existing.purpose,
      remarks: b.remarks ?? existing.remarks,
    },
  });

  res.json(updated);
}));

// ═══════════════════════════════════════════════
// PUT /:id/deposit — Mark as deposited
// ═══════════════════════════════════════════════
router.put('/:id/deposit', validate(depositSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.postDatedCheque.findUnique({ where: { id: req.params.id } });
  if (!existing) { res.status(404).json({ error: 'PDC not found' }); return; }
  if (existing.status !== 'ISSUED') { res.status(400).json({ error: 'Can only deposit cheques in ISSUED status' }); return; }

  const updated = await prisma.postDatedCheque.update({
    where: { id: req.params.id },
    data: {
      status: 'DEPOSITED',
      depositDate: req.body.depositDate ?? new Date(),
    },
  });

  res.json(updated);
}));

// ═══════════════════════════════════════════════
// PUT /:id/clear — Mark as cleared + create payment
// ═══════════════════════════════════════════════
router.put('/:id/clear', validate(clearSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.postDatedCheque.findUnique({ where: { id: req.params.id } });
  if (!existing) { res.status(404).json({ error: 'PDC not found' }); return; }
  if (!['ISSUED', 'DEPOSITED'].includes(existing.status)) { res.status(400).json({ error: 'Can only clear cheques in ISSUED or DEPOSITED status' }); return; }

  const updated = await prisma.postDatedCheque.update({
    where: { id: req.params.id },
    data: {
      status: 'CLEARED',
      clearDate: req.body.clearDate ?? new Date(),
      depositDate: existing.depositDate || new Date(),
    },
  });

  // If outgoing (vendor), create VendorPayment
  if (existing.direction === 'OUTGOING' && existing.linkedInvoiceId) {
    try {
      await prisma.vendorPayment.create({
        data: {
          vendorId: existing.partyId,
          invoiceId: existing.linkedInvoiceId,
          amount: existing.amount,
          mode: 'CHEQUE',
          reference: existing.chequeNumber,
          paymentDate: updated.clearDate || new Date(),
          userId: req.user!.id,
          companyId: getActiveCompanyId(req),
        },
      });
      // Update invoice balance
      const invoice = await prisma.vendorInvoice.findUnique({ where: { id: existing.linkedInvoiceId } });
      if (invoice) {
        const newPaid = (invoice.paidAmount || 0) + existing.amount;
        const newBalance = (invoice.netPayable || 0) - newPaid;
        await prisma.vendorInvoice.update({
          where: { id: existing.linkedInvoiceId },
          data: {
            paidAmount: newPaid,
            balanceAmount: Math.max(0, newBalance),
            status: newBalance <= 0 ? 'PAID' : 'PARTIAL_PAID',
          },
        });
      }
    } catch { /* invoice may not exist */ }
  }

  // If incoming (customer), create Payment
  if (existing.direction === 'INCOMING' && existing.linkedInvoiceId) {
    try {
      await prisma.payment.create({
        data: {
          customerId: existing.partyId,
          invoiceId: existing.linkedInvoiceId,
          amount: existing.amount,
          mode: 'CHEQUE',
          reference: existing.chequeNumber,
          paymentDate: updated.clearDate || new Date(),
          userId: req.user!.id,
          companyId: getActiveCompanyId(req),
        },
      });
      // Update customer invoice balance
      const invoice = await prisma.invoice.findUnique({ where: { id: existing.linkedInvoiceId } });
      if (invoice) {
        const newPaid = (invoice.paidAmount || 0) + existing.amount;
        const newBalance = (invoice.totalAmount || 0) - newPaid;
        await prisma.invoice.update({
          where: { id: existing.linkedInvoiceId },
          data: {
            paidAmount: newPaid,
            balanceAmount: Math.max(0, newBalance),
            status: newBalance <= 0 ? 'PAID' : 'PARTIAL',
          },
        });
      }
    } catch { /* invoice may not exist */ }
  }

  res.json(updated);
}));

// ═══════════════════════════════════════════════
// PUT /:id/dishonour — Mark as dishonoured
// ═══════════════════════════════════════════════
router.put('/:id/dishonour', validate(dishonourSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.postDatedCheque.findUnique({ where: { id: req.params.id } });
  if (!existing) { res.status(404).json({ error: 'PDC not found' }); return; }
  if (!['ISSUED', 'DEPOSITED'].includes(existing.status)) { res.status(400).json({ error: 'Cannot dishonour a cheque that is already cleared or cancelled' }); return; }

  const updated = await prisma.postDatedCheque.update({
    where: { id: req.params.id },
    data: {
      status: 'DISHONOURED',
      dishonourDate: new Date(),
      dishonourReason: req.body.reason,
    },
  });

  res.json(updated);
}));

// ═══════════════════════════════════════════════
// DELETE /:id — Cancel PDC
// ═══════════════════════════════════════════════
router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.postDatedCheque.findUnique({ where: { id: req.params.id } });
  if (!existing) { res.status(404).json({ error: 'PDC not found' }); return; }
  if (existing.status === 'CLEARED') { res.status(400).json({ error: 'Cannot cancel a cleared cheque' }); return; }

  const updated = await prisma.postDatedCheque.update({
    where: { id: req.params.id },
    data: { status: 'CANCELLED' },
  });

  res.json(updated);
}));

export default router;
