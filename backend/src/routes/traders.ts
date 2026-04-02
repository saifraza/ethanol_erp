import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { z } from 'zod';

const router = Router();
router.use(authenticate as any);

// ── Trader = Vendor with isAgent=true ──
// Thin wrapper for procurement agents/traders who buy on behalf of the company

const traderSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  aadhaarNo: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  bankName: z.string().optional(),
  bankAccount: z.string().optional(),
  bankIfsc: z.string().optional(),
  pan: z.string().optional(),
  category: z.string().optional().default('TRADER'),
  tdsApplicable: z.boolean().optional().default(false),
  tdsSection: z.string().optional(),
  tdsPercent: z.number().optional().default(0),
  creditLimit: z.number().optional().default(0),
  remarks: z.string().optional(),
});

// GET / — list all traders
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const traders = await prisma.vendor.findMany({
    where: { isAgent: true, isActive: true },
    orderBy: { name: 'asc' },
    take: 200,
    select: {
      id: true, name: true, vendorCode: true, phone: true, aadhaarNo: true,
      address: true, city: true, state: true, category: true,
      bankName: true, bankAccount: true, bankIfsc: true, pan: true,
      tdsApplicable: true, tdsSection: true, tdsPercent: true,
      creditLimit: true, remarks: true, createdAt: true,
    },
  });

  // Get balance for each trader (advances given minus purchases settled)
  const withBalance = await Promise.all(traders.map(async (t) => {
    const payments = await prisma.vendorPayment.aggregate({
      where: { vendorId: t.id },
      _sum: { amount: true },
    });
    const invoiced = await prisma.vendorInvoice.aggregate({
      where: { vendorId: t.id },
      _sum: { netPayable: true, paidAmount: true },
    });
    const poCount = await prisma.purchaseOrder.count({ where: { vendorId: t.id } });
    return {
      ...t,
      totalPaid: payments._sum.amount || 0,
      totalInvoiced: invoiced._sum.netPayable || 0,
      totalSettled: invoiced._sum.paidAmount || 0,
      balance: (payments._sum.amount || 0) - (invoiced._sum.paidAmount || 0),
      poCount,
    };
  }));

  res.json(withBalance);
}));

// GET /:id — single trader with details
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const trader = await prisma.vendor.findUnique({
    where: { id: req.params.id },
  });
  if (!trader || !trader.isAgent) return res.status(404).json({ error: 'Trader not found' });
  res.json(trader);
}));

// POST / — create trader
router.post('/', validate(traderSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const count = await prisma.vendor.count({ where: { isAgent: true } });
  const trader = await prisma.vendor.create({
    data: {
      name: b.name,
      vendorCode: `TRD-${String(count + 1).padStart(3, '0')}`,
      category: b.category || 'TRADER',
      isAgent: true,
      phone: b.phone || null,
      aadhaarNo: b.aadhaarNo || null,
      address: b.address || null,
      city: b.city || null,
      state: b.state || null,
      bankName: b.bankName || null,
      bankAccount: b.bankAccount || null,
      bankIfsc: b.bankIfsc || null,
      pan: b.pan || null,
      tdsApplicable: b.tdsApplicable || false,
      tdsSection: b.tdsSection || null,
      tdsPercent: b.tdsPercent || 0,
      creditLimit: b.creditLimit || 0,
      paymentTerms: 'ADVANCE',
      remarks: b.remarks || null,
      isActive: true,
    },
  });
  res.status(201).json(trader);
}));

// PUT /:id — update trader
router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const trader = await prisma.vendor.update({
    where: { id: req.params.id },
    data: {
      name: b.name !== undefined ? b.name : undefined,
      phone: b.phone !== undefined ? b.phone : undefined,
      aadhaarNo: b.aadhaarNo !== undefined ? b.aadhaarNo : undefined,
      address: b.address !== undefined ? b.address : undefined,
      city: b.city !== undefined ? b.city : undefined,
      state: b.state !== undefined ? b.state : undefined,
      bankName: b.bankName !== undefined ? b.bankName : undefined,
      bankAccount: b.bankAccount !== undefined ? b.bankAccount : undefined,
      bankIfsc: b.bankIfsc !== undefined ? b.bankIfsc : undefined,
      pan: b.pan !== undefined ? b.pan : undefined,
      category: b.category !== undefined ? b.category : undefined,
      tdsApplicable: b.tdsApplicable !== undefined ? b.tdsApplicable : undefined,
      tdsSection: b.tdsSection !== undefined ? b.tdsSection : undefined,
      tdsPercent: b.tdsPercent !== undefined ? b.tdsPercent : undefined,
      creditLimit: b.creditLimit !== undefined ? b.creditLimit : undefined,
      remarks: b.remarks !== undefined ? b.remarks : undefined,
    },
  });
  res.json(trader);
}));

// DELETE /:id — soft delete
router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.vendor.update({ where: { id: req.params.id }, data: { isActive: false } });
  res.json({ ok: true });
}));

// GET /:id/ledger — trader ledger (purchases + advances + running balance)
router.get('/:id/ledger', asyncHandler(async (req: AuthRequest, res: Response) => {
  const traderId = req.params.id;

  // Get all payments (advances + settlements)
  const payments = await prisma.vendorPayment.findMany({
    where: { vendorId: traderId },
    orderBy: { paymentDate: 'asc' },
    select: { id: true, paymentDate: true, amount: true, mode: true, reference: true, isAdvance: true, remarks: true },
  });

  // Get all POs created for this trader (auto-generated from weighbridge)
  const purchases = await prisma.purchaseOrder.findMany({
    where: { vendorId: traderId },
    orderBy: { poDate: 'asc' },
    select: {
      id: true, poNo: true, poDate: true, status: true, grandTotal: true, remarks: true,
      lines: { select: { description: true, quantity: true, rate: true, unit: true, receivedQty: true } },
      grns: { select: { id: true, grnNo: true, totalQty: true, totalAmount: true, status: true } },
    },
  });

  // Build ledger timeline
  const ledger: Array<{
    date: Date;
    type: 'ADVANCE' | 'PAYMENT' | 'PURCHASE';
    description: string;
    debit: number;
    credit: number;
    refId: string;
    refNo: string;
  }> = [];

  for (const p of payments) {
    ledger.push({
      date: p.paymentDate,
      type: p.isAdvance ? 'ADVANCE' : 'PAYMENT',
      description: `${p.isAdvance ? 'Advance' : 'Payment'} via ${p.mode}${p.reference ? ' — ' + p.reference : ''}${p.remarks ? ' | ' + p.remarks : ''}`,
      debit: 0,
      credit: p.amount,
      refId: p.id,
      refNo: p.reference || '',
    });
  }

  for (const po of purchases) {
    const line = po.lines[0];
    const qty = line?.receivedQty || line?.quantity || 0;
    const rate = line?.rate || 0;
    const amount = Math.round(qty * rate * 100) / 100;
    ledger.push({
      date: po.poDate,
      type: 'PURCHASE',
      description: `PO-${po.poNo}: ${line?.description || '?'} — ${qty} ${line?.unit || 'KG'} @ ${rate}`,
      debit: amount,
      credit: 0,
      refId: po.id,
      refNo: `PO-${po.poNo}`,
    });
  }

  // Sort by date
  ledger.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Add running balance (credit - debit = what company owes / trader has as advance)
  let balance = 0;
  const ledgerWithBalance = ledger.map(item => {
    balance += item.credit - item.debit;
    return { ...item, balance: Math.round(balance * 100) / 100 };
  });

  res.json({
    traderId,
    ledger: ledgerWithBalance,
    totalAdvances: payments.filter(p => p.isAdvance).reduce((s, p) => s + p.amount, 0),
    totalPayments: payments.reduce((s, p) => s + p.amount, 0),
    totalPurchases: ledger.filter(l => l.type === 'PURCHASE').reduce((s, l) => s + l.debit, 0),
    balance: Math.round(balance * 100) / 100,
  });
}));

// POST /:id/advance — give advance to trader
const advanceSchema = z.object({
  amount: z.number().positive(),
  mode: z.string().optional().default('CASH'),
  reference: z.string().optional(),
  remarks: z.string().optional(),
  date: z.string().optional(),
});

router.post('/:id/advance', validate(advanceSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const trader = await prisma.vendor.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, isAgent: true } });
  if (!trader || !trader.isAgent) return res.status(404).json({ error: 'Trader not found' });

  const payment = await prisma.vendorPayment.create({
    data: {
      vendorId: trader.id,
      paymentDate: b.date ? new Date(b.date) : new Date(),
      amount: b.amount,
      mode: b.mode || 'CASH',
      reference: b.reference || '',
      isAdvance: true,
      remarks: `Advance to trader ${trader.name}${b.remarks ? ' | ' + b.remarks : ''}`,
      userId: req.user!.id,
    },
  });

  // Auto-journal for advance
  try {
    const { onVendorPaymentMade } = await import('../services/autoJournal');
    await onVendorPaymentMade(prisma as Parameters<typeof onVendorPaymentMade>[0], {
      id: payment.id,
      amount: b.amount,
      mode: b.mode || 'CASH',
      reference: b.reference || '',
      tdsDeducted: 0,
      vendorId: trader.id,
      userId: req.user!.id,
      paymentDate: payment.paymentDate,
    });
  } catch { /* best effort */ }

  res.status(201).json(payment);
}));

export default router;
