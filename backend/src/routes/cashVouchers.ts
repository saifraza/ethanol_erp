import { Router, Response } from 'express';
import { authenticate, AuthRequest, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { NotFoundError } from '../shared/errors';
import { z } from 'zod';
import prisma from '../config/prisma';

const router = Router();
router.use(authenticate as any);

// ── Zod Schemas ─────────────────────────────────────────────

const voucherTypeEnum = z.enum(['PAYMENT', 'RECEIPT', 'ADVANCE', 'REFUND']);
const categoryEnum = z.enum(['LABOUR', 'TRANSPORT', 'REPAIR', 'MATERIAL', 'FUEL', 'OFFICE', 'MISC']);
const paymentModeEnum = z.enum(['CASH', 'UPI', 'BANK_TRANSFER']);

const createSchema = z.object({
  payeeName: z.string().min(1, 'Payee name is required'),
  payeePhone: z.string().optional(),
  purpose: z.string().min(1, 'Purpose is required'),
  amount: z.number().positive('Amount must be positive'),
  type: voucherTypeEnum.default('PAYMENT'),
  category: categoryEnum.default('MISC'),
  paymentMode: paymentModeEnum.default('CASH'),
  paymentRef: z.string().optional(),
  authorizedBy: z.string().min(1, 'Authorized by is required'),
  date: z.string().datetime().optional(),
});

const updateSchema = z.object({
  payeeName: z.string().min(1).optional(),
  purpose: z.string().min(1).optional(),
  category: categoryEnum.optional(),
  authorizedBy: z.string().min(1).optional(),
  payeePhone: z.string().optional(),
  paymentRef: z.string().optional(),
});

const settleSchema = z.object({
  settlementNote: z.string().min(1, 'Settlement note is required'),
  linkedInvoiceId: z.string().optional(),
});

// ── Category → Expense Account Code mapping ─────────────────

const CATEGORY_EXPENSE_CODE: Record<string, string> = {
  LABOUR: '4020',
  TRANSPORT: '4010',
  REPAIR: '4030',
  MATERIAL: '4001',
  FUEL: '4010',    // Fuel expense
  OFFICE: '4040',
  MISC: '4040',
};

const ADVANCE_ACCOUNT_CODE = '1600'; // Advance to Suppliers

// ── GET / — List vouchers (paginated) ───────────────────────

router.get(
  '/',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const take = Math.min(parseInt(req.query.limit as string) || 50, 500);
    const skip = parseInt(req.query.offset as string) || 0;

    const where: Record<string, unknown> = { ...getCompanyFilter(req) };
    if (req.query.status) where.status = req.query.status;
    if (req.query.type) where.type = req.query.type;
    if (req.query.category) where.category = req.query.category;

    if (req.query.from || req.query.to) {
      where.date = {};
      if (req.query.from) (where.date as Record<string, unknown>).gte = new Date(req.query.from as string);
      if (req.query.to) (where.date as Record<string, unknown>).lte = new Date(req.query.to as string);
    }

    const [items, total] = await Promise.all([
      prisma.cashVoucher.findMany({
        where,
        take,
        skip,
        orderBy: { date: 'desc' },
        select: {
          id: true,
          voucherNo: true,
          date: true,
          type: true,
          payeeName: true,
          payeePhone: true,
          purpose: true,
          category: true,
          amount: true,
          paymentMode: true,
          paymentRef: true,
          authorizedBy: true,
          status: true,
          settlementDate: true,
          settlementNote: true,
          linkedInvoiceId: true,
          journalEntryId: true,
          createdAt: true,
        },
      }),
      prisma.cashVoucher.count({ where }),
    ]);

    res.json({ items, total });
  }),
);

// ── GET /summary — Dashboard KPIs ──────────────────────────

router.get(
  '/summary',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const [unsettled, monthPayments, byStatus, byCategory] = await Promise.all([
      prisma.cashVoucher.aggregate({
        where: { status: 'ACTIVE' },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.cashVoucher.aggregate({
        where: {
          date: { gte: monthStart },
          type: { in: ['PAYMENT', 'ADVANCE'] },
          status: { not: 'CANCELLED' },
        },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.cashVoucher.groupBy({
        by: ['status'],
        _count: true,
        _sum: { amount: true },
      }),
      prisma.cashVoucher.groupBy({
        by: ['category'],
        where: { status: { not: 'CANCELLED' } },
        _count: true,
        _sum: { amount: true },
      }),
    ]);

    res.json({
      unsettledAmount: unsettled._sum.amount ?? 0,
      unsettledCount: unsettled._count,
      monthTotal: monthPayments._sum.amount ?? 0,
      monthCount: monthPayments._count,
      byStatus: byStatus.map((s) => ({
        status: s.status,
        count: s._count,
        amount: s._sum.amount ?? 0,
      })),
      byCategory: byCategory.map((c) => ({
        category: c.category,
        count: c._count,
        amount: c._sum.amount ?? 0,
      })),
    });
  }),
);

// ── POST / — Create voucher + journal entry ─────────────────

router.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { date, ...rest } = req.body;

    const voucher = await prisma.cashVoucher.create({
      data: {
        ...rest,
        date: date ? new Date(date) : new Date(),
        userId: req.user!.id,
        companyId: getActiveCompanyId(req),
      },
    });

    // Create auto-journal: Dr Advance to Suppliers (1600), Cr Cash/Bank
    const creditCode = voucher.paymentMode === 'CASH' ? '1001' : '1002';

    const [debitAcct, creditAcct] = await Promise.all([
      prisma.account.findUnique({ where: { code: ADVANCE_ACCOUNT_CODE } }),
      prisma.account.findUnique({ where: { code: creditCode } }),
    ]);

    if (debitAcct && creditAcct) {
      const journal = await prisma.journalEntry.create({
        data: {
          date: voucher.date,
          narration: `Cash voucher #${voucher.voucherNo}: ${voucher.purpose} - ${voucher.payeeName}`,
          refType: 'CASH_VOUCHER',
          refId: voucher.id,
          isAutoGenerated: true,
          userId: req.user!.id,
          companyId: getActiveCompanyId(req),
          lines: {
            create: [
              { accountId: debitAcct.id, debit: voucher.amount, credit: 0, costCenter: 'ADMIN' },
              { accountId: creditAcct.id, debit: 0, credit: voucher.amount, costCenter: 'ADMIN' },
            ],
          },
        },
      });

      await prisma.cashVoucher.update({
        where: { id: voucher.id },
        data: { journalEntryId: journal.id },
      });

      res.status(201).json({ ...voucher, journalEntryId: journal.id });
      return;
    }

    res.status(201).json(voucher);
  }),
);

// ── PUT /:id — Update voucher (ACTIVE only) ────────────────

router.put(
  '/:id',
  validate(updateSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const existing = await prisma.cashVoucher.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundError('CashVoucher', req.params.id);
    if (existing.status !== 'ACTIVE') {
      res.status(400).json({ error: 'Only ACTIVE vouchers can be updated' });
      return;
    }

    const updated = await prisma.cashVoucher.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(updated);
  }),
);

// ── PUT /:id/settle — Settle voucher with reclassification ─

router.put(
  '/:id/settle',
  validate(settleSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const voucher = await prisma.cashVoucher.findUnique({
      where: { id: req.params.id },
    });
    if (!voucher) throw new NotFoundError('CashVoucher', req.params.id);
    if (voucher.status !== 'ACTIVE') {
      res.status(400).json({ error: 'Only ACTIVE vouchers can be settled' });
      return;
    }

    const { settlementNote, linkedInvoiceId } = req.body;

    // Update voucher status
    const settled = await prisma.cashVoucher.update({
      where: { id: voucher.id },
      data: {
        status: 'SETTLED',
        settlementDate: new Date(),
        settlementNote,
        linkedInvoiceId: linkedInvoiceId ?? null,
      },
    });

    // Create reclassification journal: Dr Expense, Cr Advance (1600)
    const expenseCode = CATEGORY_EXPENSE_CODE[voucher.category] ?? '4040';

    const [expenseAcct, advanceAcct] = await Promise.all([
      prisma.account.findUnique({ where: { code: expenseCode } }),
      prisma.account.findUnique({ where: { code: ADVANCE_ACCOUNT_CODE } }),
    ]);

    if (expenseAcct && advanceAcct) {
      await prisma.journalEntry.create({
        data: {
          date: new Date(),
          narration: `Settlement of cash voucher #${voucher.voucherNo}: ${voucher.purpose} - ${voucher.payeeName}`,
          refType: 'CASH_VOUCHER',
          refId: voucher.id,
          isAutoGenerated: true,
          userId: req.user!.id,
          companyId: getActiveCompanyId(req),
          lines: {
            create: [
              { accountId: expenseAcct.id, debit: voucher.amount, credit: 0, costCenter: 'ADMIN' },
              { accountId: advanceAcct.id, debit: 0, credit: voucher.amount, costCenter: 'ADMIN' },
            ],
          },
        },
      });
    }

    // If this voucher was a PO payment (purpose contains "PO-"), create VendorPayment on settlement
    const poMatch = voucher.purpose.match(/PO-(\d+)/);
    if (poMatch) {
      try {
        const poNo = parseInt(poMatch[1]);
        const po = await prisma.purchaseOrder.findFirst({
          where: { poNo },
          select: { id: true, vendorId: true, poNo: true, grandTotal: true, lines: { select: { quantity: true, receivedQty: true, rate: true, gstPercent: true } } },
        });
        if (po) {
          await prisma.vendorPayment.create({
            data: {
              vendorId: po.vendorId,
              paymentDate: new Date(),
              amount: voucher.amount,
              mode: 'CASH',
              reference: `CV-${voucher.voucherNo}`,
              isAdvance: false,
              remarks: `Payment against PO-${po.poNo} | Cash voucher #${voucher.voucherNo} settled`,
              userId: req.user!.id,
              companyId: getActiveCompanyId(req),
            },
          });

          // Check if PO is now fully paid → auto-close
          const receivable = po.grandTotal > 0 ? po.grandTotal : Math.round(po.lines.reduce((s: number, l: { quantity: number; receivedQty: number; rate: number; gstPercent: number }) => {
            const qty = l.quantity >= 900000 ? (l.receivedQty || 0) : l.quantity;
            const base = qty * l.rate;
            return s + base + base * (l.gstPercent || 0) / 100;
          }, 0) * 100) / 100;

          const allPayments = await prisma.vendorPayment.findMany({
            where: { vendorId: po.vendorId, invoiceId: null, OR: [{ remarks: { contains: `PO-${po.poNo} ` } }, { remarks: { endsWith: `PO-${po.poNo}` } }] },
            select: { amount: true },
          });
          const totalPaid = allPayments.reduce((s: number, p: { amount: number }) => s + p.amount, 0);
          if (totalPaid >= receivable - 0.01) {
            await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: 'CLOSED' } });
          }
        }
      } catch (err) {
        console.error('[CashVoucher] Failed to create VendorPayment on PO settlement:', err);
      }
    }

    res.json(settled);
  }),
);

// ── DELETE /:id — Cancel voucher + reverse journal ──────────

router.delete(
  '/:id',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const voucher = await prisma.cashVoucher.findUnique({
      where: { id: req.params.id },
      select: { id: true, voucherNo: true, status: true, journalEntryId: true, purpose: true, payeeName: true },
    });
    if (!voucher) throw new NotFoundError('CashVoucher', req.params.id);
    if (voucher.status === 'CANCELLED') {
      res.status(400).json({ error: 'Voucher is already cancelled' });
      return;
    }

    // Cancel the voucher
    const cancelled = await prisma.cashVoucher.update({
      where: { id: voucher.id },
      data: { status: 'CANCELLED' },
    });

    // Reverse the original journal entry if it exists
    if (voucher.journalEntryId) {
      const originalJournal = await prisma.journalEntry.findUnique({
        where: { id: voucher.journalEntryId },
        include: { lines: { select: { accountId: true, debit: true, credit: true, costCenter: true } } },
      });

      if (originalJournal && !originalJournal.isReversed) {
        await prisma.$transaction([
          prisma.journalEntry.update({
            where: { id: originalJournal.id },
            data: { isReversed: true },
          }),
          prisma.journalEntry.create({
            data: {
              date: new Date(),
              narration: `Reversal of cash voucher #${voucher.voucherNo}: ${voucher.purpose} - ${voucher.payeeName}`,
              refType: 'CASH_VOUCHER',
              refId: voucher.id,
              isAutoGenerated: true,
              reversalOf: originalJournal.id,
              userId: req.user!.id,
              lines: {
                create: originalJournal.lines.map((line) => ({
                  accountId: line.accountId,
                  debit: line.credit,
                  credit: line.debit,
                  costCenter: line.costCenter,
                })),
              },
            },
          }),
        ]);
      }
    }

    res.json(cancelled);
  }),
);

export default router;
