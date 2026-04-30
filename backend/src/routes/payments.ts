import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { z } from 'zod';

const createPaymentSchema = z.object({
  customerId: z.string().min(1),
  invoiceId: z.string().optional().nullable(),
  paymentDate: z.string().optional(),
  amount: z.coerce.number().positive(),
  mode: z.string().optional().default('BANK_TRANSFER'),
  reference: z.string().optional().default(''),
  confirmedBy: z.string().optional().default(''),
  remarks: z.string().optional().nullable(),
});
import { onSalePaymentReceived } from '../services/autoJournal';
import { Prisma } from '@prisma/client';

const router = Router();

router.use(authenticate);

// GET / — List payments with filters
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const customerId = req.query.customerId as string;
  const from = req.query.from as string;
  const to = req.query.to as string;

  let where: any = { ...getCompanyFilter(req) };

  if (customerId) where.customerId = customerId;

  if (from || to) {
    where.paymentDate = {};
    if (from) where.paymentDate.gte = new Date(from + 'T00:00:00.000Z');
    if (to) where.paymentDate.lte = new Date(to + 'T23:59:59.999Z');
  }

  const payments = await prisma.payment.findMany({
    where,
    include: {
      customer: {
        select: { id: true, name: true },
      },
      invoice: {
        select: { id: true, invoiceNo: true },
      },
    },
    orderBy: { paymentDate: 'desc' },
    take: 50,
  });
  res.json({ payments });
}));

// GET /ledger/:customerId — Customer ledger
router.get('/ledger/:customerId', asyncHandler(async (req: AuthRequest, res: Response) => {
  const customerId = req.params.customerId;

  // Cap limit to prevent unbounded queries
  const limit = Math.min(parseInt((req.query.limit as string) || '200'), 1000);
  const invoices = await prisma.invoice.findMany({
    where: { customerId },
    include: {
      payments: true,
    },
    orderBy: { invoiceDate: 'asc' },
    take: limit,
  });

  const payments = await prisma.payment.findMany({
    where: { customerId },
    orderBy: { paymentDate: 'asc' },
    take: limit,
  });

  // Combine timeline
  const timeline: any[] = [];
  let runningBalance = 0;

  invoices.forEach((inv) => {
    timeline.push({
      type: 'INVOICE',
      date: inv.invoiceDate,
      amount: inv.totalAmount,
      ref: inv.invoiceNo,
      invoiceId: inv.id,
    });
    runningBalance += inv.totalAmount;
  });

  payments.forEach((pmt) => {
    timeline.push({
      type: 'PAYMENT',
      date: pmt.paymentDate,
      amount: pmt.amount,
      ref: pmt.reference,
      paymentId: pmt.id,
    });
    runningBalance -= pmt.amount;
  });

  // Sort by date
  timeline.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Calculate running balance
  runningBalance = 0;
  timeline.forEach((item) => {
    if (item.type === 'INVOICE') {
      runningBalance += item.amount;
    } else {
      runningBalance -= item.amount;
    }
    item.balance = runningBalance;
  });

  res.json({ customerId, timeline });
}));

// GET /aging — AR aging report
router.get('/aging', asyncHandler(async (req: AuthRequest, res: Response) => {
  // Cap limit to prevent unbounded queries
  const limit = Math.min(parseInt((req.query.limit as string) || '200'), 1000);
  const outstanding = await prisma.invoice.findMany({
    where: {
      status: { in: ['UNPAID', 'PARTIAL'] },
    },
    include: {
      customer: {
        select: { id: true, name: true },
      },
    },
    take: limit,
  });

  const now = new Date();
  const agingBuckets: { [key: string]: any } = {
    '0-7': { days: '0-7', total: 0, invoiceCount: 0, customers: {} },
    '8-15': { days: '8-15', total: 0, invoiceCount: 0, customers: {} },
    '16-30': { days: '16-30', total: 0, invoiceCount: 0, customers: {} },
    '30+': { days: '30+', total: 0, invoiceCount: 0, customers: {} },
  };

  outstanding.forEach((inv) => {
    const daysDue = Math.floor(
      (now.getTime() - new Date(inv.invoiceDate).getTime()) / (1000 * 60 * 60 * 24)
    );
    let bucket = '30+';
    if (daysDue <= 7) bucket = '0-7';
    else if (daysDue <= 15) bucket = '8-15';
    else if (daysDue <= 30) bucket = '16-30';

    agingBuckets[bucket].total += inv.balanceAmount;
    agingBuckets[bucket].invoiceCount += 1;

    const custId = inv.customerId;
    if (!agingBuckets[bucket].customers[custId]) {
      agingBuckets[bucket].customers[custId] = {
        customerId: custId,
        customerName: inv.customer.name,
        amount: 0,
        invoiceCount: 0,
      };
    }
    agingBuckets[bucket].customers[custId].amount += inv.balanceAmount;
    agingBuckets[bucket].customers[custId].invoiceCount += 1;
  });

  // Convert customers objects to arrays
  Object.keys(agingBuckets).forEach((key) => {
    agingBuckets[key].customers = Object.values(agingBuckets[key].customers);
  });

  res.json(Object.values(agingBuckets));
}));

// POST / — Record payment
router.post('/', validate(createPaymentSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const amount = parseFloat(b.amount) || 0;

  // Validate: prevent overpayment on invoice
  if (b.invoiceId) {
    const invoice = await prisma.invoice.findUnique({ where: { id: b.invoiceId } });
    if (!invoice) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }
    if (invoice.status === 'PAID') {
      res.status(400).json({ error: 'Invoice is already fully paid' });
      return;
    }
    if (amount > invoice.balanceAmount) {
      res.status(400).json({
        error: `Payment amount (${amount}) exceeds invoice balance (${invoice.balanceAmount})`,
        code: 'OVERPAYMENT',
      });
      return;
    }
  }

  // Wrap in transaction to ensure atomicity
  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Create payment
    const payment = await tx.payment.create({
      data: {
        customerId: b.customerId,
        invoiceId: b.invoiceId || null,
        paymentDate: b.paymentDate ? new Date(b.paymentDate) : new Date(),
        amount,
        mode: b.mode || 'BANK_TRANSFER',
        reference: b.reference || '',
        confirmedBy: b.confirmedBy || '',
        remarks: b.remarks || null,
        userId: req.user!.id,
        companyId: getActiveCompanyId(req),
      },
    });

    // If invoiceId: update invoice
    if (b.invoiceId) {
      const invoice = await tx.invoice.findUnique({
        where: { id: b.invoiceId },
      });

      if (invoice) {
        // Re-check overpayment inside transaction (race condition safety)
        if (amount > invoice.balanceAmount) {
          throw new Error(`Payment amount (${amount}) exceeds invoice balance (${invoice.balanceAmount})`);
        }
        const newPaidAmount = invoice.paidAmount + amount;
        const newBalanceAmount = invoice.totalAmount - newPaidAmount;
        let newStatus = 'UNPAID';

        if (newBalanceAmount <= 0) {
          newStatus = 'PAID';
        } else if (newPaidAmount > 0) {
          newStatus = 'PARTIAL';
        }

        await tx.invoice.update({
          where: { id: b.invoiceId },
          data: {
            paidAmount: newPaidAmount,
            balanceAmount: Math.max(0, newBalanceAmount),
            status: newStatus,
          },
        });
      }
    }

    // Fetch the created payment with full details
    return await tx.payment.findUnique({
      where: { id: payment.id },
      include: {
        customer: {
          select: { id: true, name: true },
        },
        invoice: {
          select: { id: true, invoiceNo: true },
        },
      },
    });
  });

  // Auto-journal: Dr Bank/Cash, Cr Receivable
  onSalePaymentReceived(prisma, {
    id: result!.id,
    amount,
    mode: b.mode || 'BANK_TRANSFER',
    reference: b.reference,
    paymentDate: b.paymentDate ? new Date(b.paymentDate) : new Date(),
    customerId: b.customerId,
    invoiceId: b.invoiceId,
    userId: req.user!.id,
  }).catch(() => {});

  res.status(201).json(result);
}));

export default router;
