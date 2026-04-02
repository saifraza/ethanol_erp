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

// Partial schema for PUT (all fields optional)
const traderUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional(),
  aadhaarNo: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  bankName: z.string().optional(),
  bankAccount: z.string().optional(),
  bankIfsc: z.string().optional(),
  pan: z.string().optional(),
  category: z.string().optional(),
  tdsApplicable: z.boolean().optional(),
  tdsSection: z.string().optional(),
  tdsPercent: z.number().optional(),
  creditLimit: z.number().optional(),
  remarks: z.string().optional(),
}).strict();

// GET / — list all traders with balance from PO-based purchases (not VendorInvoice)
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

  // Fix #1+#6: Batch queries instead of N+1 per trader
  const traderIds = traders.map(t => t.id);

  // Total payments (advances + settlements) per trader
  const paymentsByVendor = await prisma.vendorPayment.groupBy({
    by: ['vendorId'],
    where: { vendorId: { in: traderIds } },
    _sum: { amount: true },
  });
  const paymentMap = new Map(paymentsByVendor.map(p => [p.vendorId, p._sum.amount || 0]));

  // Total purchase value per trader from PO lines (not VendorInvoice — traders don't create invoices)
  const poLines = await prisma.pOLine.findMany({
    where: { po: { vendorId: { in: traderIds } } },
    select: { po: { select: { vendorId: true } }, receivedQty: true, rate: true },
  });
  const purchaseMap = new Map<string, number>();
  for (const line of poLines) {
    const vid = line.po.vendorId;
    const amount = (line.receivedQty || 0) * (line.rate || 0);
    purchaseMap.set(vid, (purchaseMap.get(vid) || 0) + amount);
  }

  // PO count per trader
  const poCounts = await prisma.purchaseOrder.groupBy({
    by: ['vendorId'],
    where: { vendorId: { in: traderIds } },
    _count: true,
  });
  const poCountMap = new Map(poCounts.map(p => [p.vendorId, p._count]));

  const withBalance = traders.map(t => {
    const totalPaid = paymentMap.get(t.id) || 0;
    const totalPurchased = Math.round((purchaseMap.get(t.id) || 0) * 100) / 100;
    return {
      ...t,
      totalPaid: Math.round(totalPaid * 100) / 100,
      totalPurchased,
      balance: Math.round((totalPaid - totalPurchased) * 100) / 100, // positive = advance remaining
      poCount: poCountMap.get(t.id) || 0,
    };
  });

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

// POST / — create trader (Fix #4: catch unique constraint and retry with timestamp suffix)
router.post('/', validate(traderSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const count = await prisma.vendor.count({ where: { isAgent: true } });
  let vendorCode = `TRD-${String(count + 1).padStart(3, '0')}`;

  let trader;
  try {
    trader = await prisma.vendor.create({
      data: {
        name: b.name,
        vendorCode,
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
  } catch (err: unknown) {
    // Retry with timestamp suffix on duplicate vendorCode
    if ((err as { code?: string }).code === 'P2002') {
      vendorCode = `TRD-${Date.now().toString(36).toUpperCase()}`;
      trader = await prisma.vendor.create({
        data: {
          name: b.name, vendorCode, category: b.category || 'TRADER', isAgent: true,
          phone: b.phone || null, aadhaarNo: b.aadhaarNo || null,
          address: b.address || null, city: b.city || null, state: b.state || null,
          bankName: b.bankName || null, bankAccount: b.bankAccount || null, bankIfsc: b.bankIfsc || null,
          pan: b.pan || null, tdsApplicable: b.tdsApplicable || false, tdsSection: b.tdsSection || null,
          tdsPercent: b.tdsPercent || 0, creditLimit: b.creditLimit || 0, paymentTerms: 'ADVANCE',
          remarks: b.remarks || null, isActive: true,
        },
      });
    } else {
      throw err;
    }
  }
  res.status(201).json(trader);
}));

// PUT /:id — update trader (Fix #3: Zod validation, Fix #7: isAgent guard)
router.put('/:id', validate(traderUpdateSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.vendor.findUnique({ where: { id: req.params.id }, select: { isAgent: true } });
  if (!existing || !existing.isAgent) return res.status(404).json({ error: 'Trader not found' });

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

// DELETE /:id — soft delete (Fix #7: isAgent guard)
router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.vendor.findUnique({ where: { id: req.params.id }, select: { isAgent: true } });
  if (!existing || !existing.isAgent) return res.status(404).json({ error: 'Trader not found' });
  await prisma.vendor.update({ where: { id: req.params.id }, data: { isActive: false } });
  res.json({ ok: true });
}));

// GET /:id/ledger — trader ledger (purchases + advances + running balance)
router.get('/:id/ledger', asyncHandler(async (req: AuthRequest, res: Response) => {
  const traderId = req.params.id;

  // Verify trader exists and is an agent
  const traderCheck = await prisma.vendor.findUnique({ where: { id: traderId }, select: { isAgent: true } });
  if (!traderCheck || !traderCheck.isAgent) return res.status(404).json({ error: 'Trader not found' });

  const payments = await prisma.vendorPayment.findMany({
    where: { vendorId: traderId },
    orderBy: { paymentDate: 'asc' },
    select: { id: true, paymentDate: true, amount: true, mode: true, reference: true, isAdvance: true, remarks: true },
  });

  const purchases = await prisma.purchaseOrder.findMany({
    where: { vendorId: traderId },
    orderBy: { poDate: 'asc' },
    select: {
      id: true, poNo: true, poDate: true, status: true, grandTotal: true, remarks: true,
      lines: { select: { description: true, quantity: true, rate: true, unit: true, receivedQty: true } },
      grns: { select: { id: true, grnNo: true, totalQty: true, totalAmount: true, status: true, grnDate: true } },
    },
  });

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
    // Use GRN date if available (actual receipt date), else PO date
    const grnDate = po.grns[0]?.grnDate;
    ledger.push({
      date: grnDate || po.poDate,
      type: 'PURCHASE',
      description: `PO-${po.poNo}: ${line?.description || '?'} — ${qty} ${line?.unit || 'KG'} @ ${rate}`,
      debit: amount,
      credit: 0,
      refId: po.id,
      refNo: `PO-${po.poNo}`,
    });
  }

  ledger.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

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

  // Fix #2: Auto-journal for advance — use ADVANCE_TO_SUPPLIERS (asset) not TRADE_PAYABLE (liability)
  try {
    const { createAdvanceJournal } = await import('../services/autoJournal');
    if (typeof createAdvanceJournal === 'function') {
      await createAdvanceJournal(prisma as Parameters<typeof createAdvanceJournal>[0], {
        id: payment.id,
        amount: b.amount,
        mode: b.mode || 'CASH',
        reference: b.reference || '',
        vendorId: trader.id,
        userId: req.user!.id,
        paymentDate: payment.paymentDate,
      });
    } else {
      // Fallback to regular payment journal if advance journal not yet implemented
      const { onVendorPaymentMade } = await import('../services/autoJournal');
      await onVendorPaymentMade(prisma as Parameters<typeof onVendorPaymentMade>[0], {
        id: payment.id, amount: b.amount, mode: b.mode || 'CASH', reference: b.reference || '',
        tdsDeducted: 0, vendorId: trader.id, userId: req.user!.id, paymentDate: payment.paymentDate,
      });
    }
  } catch { /* best effort */ }

  res.status(201).json(payment);
}));

export default router;
