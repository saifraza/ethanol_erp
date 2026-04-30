import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize, AuthRequest, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { z } from 'zod';

const router = Router();
router.use(authenticate as any);

// ── Trader = Vendor with isAgent=true ──
// Simple master for procurement agents/traders who buy on behalf of the company

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
  productTypes: z.string().optional(), // Comma-separated: "FUEL,RAW_MATERIAL"
  creditLimit: z.number().optional().default(0),
  remarks: z.string().optional(),
});

const traderUpdateSchema = traderSchema.partial().strict();

// GET / — list all traders with purchase stats
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const traders = await prisma.vendor.findMany({
    where: { isAgent: true, isActive: true, ...getCompanyFilter(req) },
    orderBy: { name: 'asc' },
    take: 200,
    select: {
      id: true, name: true, vendorCode: true, phone: true, aadhaarNo: true,
      address: true, city: true, state: true, pan: true,
      bankName: true, bankAccount: true, bankIfsc: true,
      productTypes: true, creditLimit: true, remarks: true, createdAt: true,
    },
  });

  const traderIds = traders.map(t => t.id);

  // Batch: PO count per trader
  const poCounts = await prisma.purchaseOrder.groupBy({
    by: ['vendorId'],
    where: { vendorId: { in: traderIds }, ...getCompanyFilter(req) },
    _count: true,
  });
  const poCountMap = new Map(poCounts.map(p => [p.vendorId, p._count]));

  // Batch: total payments per trader
  const payments = await prisma.vendorPayment.groupBy({
    by: ['vendorId'],
    where: { vendorId: { in: traderIds }, ...getCompanyFilter(req) },
    _sum: { amount: true },
  });
  const paymentMap = new Map(payments.map(p => [p.vendorId, p._sum.amount || 0]));

  // Batch: total purchase value from PO lines
  const poLines = await prisma.pOLine.findMany({
    where: { po: { vendorId: { in: traderIds }, ...getCompanyFilter(req) } },
    select: { po: { select: { vendorId: true } }, receivedQty: true, rate: true },
  
    take: 500,
  });
  const purchaseMap = new Map<string, number>();
  for (const line of poLines) {
    const vid = line.po.vendorId;
    purchaseMap.set(vid, (purchaseMap.get(vid) || 0) + (line.receivedQty || 0) * (line.rate || 0));
  }

  const result = traders.map(t => ({
    ...t,
    poCount: poCountMap.get(t.id) || 0,
    totalPaid: Math.round((paymentMap.get(t.id) || 0) * 100) / 100,
    totalPurchased: Math.round((purchaseMap.get(t.id) || 0) * 100) / 100,
    balance: Math.round(((purchaseMap.get(t.id) || 0) - (paymentMap.get(t.id) || 0)) * 100) / 100,
  }));

  res.json(result);
}));

// GET /:id — single trader
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const trader = await prisma.vendor.findUnique({ where: { id: req.params.id } });
  if (!trader || !trader.isAgent) return res.status(404).json({ error: 'Trader not found' });
  res.json(trader);
}));

// POST / — create trader
router.post('/', validate(traderSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const count = await prisma.vendor.count({ where: { isAgent: true, ...getCompanyFilter(req) } });
  let vendorCode = `TRD-${String(count + 1).padStart(3, '0')}`;

  let trader;
  try {
    trader = await prisma.vendor.create({
      data: {
        name: b.name, vendorCode, category: b.category || 'TRADER', isAgent: true,
        phone: b.phone || null, aadhaarNo: b.aadhaarNo || null,
        address: b.address || null, city: b.city || null, state: b.state || null,
        bankName: b.bankName || null, bankAccount: b.bankAccount || null, bankIfsc: b.bankIfsc || null,
        pan: b.pan || null, productTypes: b.productTypes || null, creditLimit: b.creditLimit || 0, paymentTerms: 'ADVANCE',
        remarks: b.remarks || null, isActive: true,
        companyId: getActiveCompanyId(req),
      },
    });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2002') {
      vendorCode = `TRD-${Date.now().toString(36).toUpperCase()}`;
      trader = await prisma.vendor.create({
        data: {
          name: b.name, vendorCode, category: b.category || 'TRADER', isAgent: true,
          phone: b.phone || null, aadhaarNo: b.aadhaarNo || null,
          address: b.address || null, city: b.city || null, state: b.state || null,
          bankName: b.bankName || null, bankAccount: b.bankAccount || null, bankIfsc: b.bankIfsc || null,
          pan: b.pan || null, productTypes: b.productTypes || null, creditLimit: b.creditLimit || 0, paymentTerms: 'ADVANCE',
          remarks: b.remarks || null, isActive: true,
          companyId: getActiveCompanyId(req),
        },
      });
    } else throw err;
  }
  res.status(201).json(trader);
}));

// PUT /:id — update trader
router.put('/:id', validate(traderUpdateSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.vendor.findUnique({ where: { id: req.params.id }, select: { isAgent: true } });
  if (!existing || !existing.isAgent) return res.status(404).json({ error: 'Trader not found' });

  const b = req.body;
  const trader = await prisma.vendor.update({
    where: { id: req.params.id },
    data: {
      name: b.name, phone: b.phone, aadhaarNo: b.aadhaarNo,
      address: b.address, city: b.city, state: b.state,
      bankName: b.bankName, bankAccount: b.bankAccount, bankIfsc: b.bankIfsc,
      pan: b.pan, category: b.category, productTypes: b.productTypes, creditLimit: b.creditLimit, remarks: b.remarks,
    },
  });
  res.json(trader);
}));

// DELETE /:id — soft delete, SUPER_ADMIN only, with reference check
router.delete('/:id', authorize('SUPER_ADMIN') as any, asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.vendor.findUnique({ where: { id: req.params.id }, select: { isAgent: true } });
  if (!existing || !existing.isAgent) return res.status(404).json({ error: 'Trader not found' });
  const { checkVendorReferences } = await import('../utils/referenceCheck');
  const check = await checkVendorReferences(req.params.id);
  if (!check.canDelete) { res.status(409).json({ error: check.message }); return; }
  await prisma.vendor.update({ where: { id: req.params.id }, data: { isActive: false } });
  res.json({ ok: true });
}));

// ── Running PO Endpoints ──

// GET /:id/running-pos — Active running POs for a trader
router.get('/:id/running-pos', asyncHandler(async (req: AuthRequest, res: Response) => {
  const traderId = req.params.id;
  const trader = await prisma.vendor.findUnique({ where: { id: traderId }, select: { isAgent: true } });
  if (!trader || !trader.isAgent) return res.status(404).json({ error: 'Trader not found' });

  const runningPOs = await prisma.purchaseOrder.findMany({
    where: {
      vendorId: traderId,
      dealType: 'OPEN',
      status: { in: ['APPROVED', 'PARTIAL_RECEIVED'] },
      ...getCompanyFilter(req),
    },
    orderBy: { poDate: 'desc' },
    take: 20,
    select: {
      id: true, poNo: true, poDate: true, status: true,
      subtotal: true, totalGst: true, grandTotal: true, remarks: true,
      lines: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, lineNo: true, description: true, quantity: true,
          unit: true, rate: true, amount: true, createdAt: true,
        },
      },
      _count: { select: { grns: true } },
    },
  });

  res.json(runningPOs);
}));

// GET /:id/ledger — Full trader ledger (deliveries + payments interleaved)
router.get('/:id/ledger', asyncHandler(async (req: AuthRequest, res: Response) => {
  const traderId = req.params.id;
  const trader = await prisma.vendor.findUnique({ where: { id: traderId }, select: { id: true, name: true, isAgent: true } });
  if (!trader || !trader.isAgent) return res.status(404).json({ error: 'Trader not found' });

  // Fetch all PO lines (deliveries) for this trader (OPEN running POs + legacy STANDARD)
  const poLines = await prisma.pOLine.findMany({
    where: { po: { vendorId: traderId, ...getCompanyFilter(req) } },
    orderBy: { createdAt: 'asc' },
    take: 500,
    select: {
      id: true, lineNo: true, description: true, quantity: true,
      unit: true, rate: true, amount: true, createdAt: true,
      po: { select: { poNo: true, poDate: true, status: true } },
    },
  });

  // Fetch all payments for this trader
  const payments = await prisma.vendorPayment.findMany({
    where: { vendorId: traderId, ...getCompanyFilter(req) },
    orderBy: { paymentDate: 'asc' },
    take: 500,
    select: {
      id: true, amount: true, paymentDate: true, mode: true,
      reference: true, remarks: true, createdAt: true,
    },
  });

  // Build interleaved ledger entries sorted by date
  interface LedgerEntry {
    type: 'DELIVERY' | 'PAYMENT';
    date: Date;
    description: string;
    debit: number;   // delivery amount (what we owe)
    credit: number;  // payment amount (what we paid)
    poNo?: number;
    poStatus?: string;
    qty?: number;
    unit?: string;
    rate?: number;
    paymentMode?: string;
    referenceNo?: string;
  }

  const entries: LedgerEntry[] = [];

  for (const line of poLines) {
    entries.push({
      type: 'DELIVERY',
      date: line.createdAt,
      description: line.description,
      debit: line.amount,
      credit: 0,
      poNo: line.po.poNo,
      poStatus: line.po.status,
      qty: line.quantity,
      unit: line.unit,
      rate: line.rate,
    });
  }

  for (const pmt of payments) {
    entries.push({
      type: 'PAYMENT',
      date: pmt.paymentDate || pmt.createdAt,
      description: pmt.remarks || `Payment via ${pmt.mode || 'N/A'}`,
      debit: 0,
      credit: pmt.amount,
      paymentMode: pmt.mode || undefined,
      referenceNo: pmt.reference || undefined,
    });
  }

  // Sort by date ascending
  entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Add running balance (positive = we owe trader)
  let balance = 0;
  const ledger = entries.map(e => {
    balance += e.debit - e.credit;
    return { ...e, balance: Math.round(balance * 100) / 100 };
  });

  // Summary
  const totalDeliveries = Math.round(entries.filter(e => e.type === 'DELIVERY').reduce((s, e) => s + e.debit, 0) * 100) / 100;
  const totalPayments = Math.round(entries.filter(e => e.type === 'PAYMENT').reduce((s, e) => s + e.credit, 0) * 100) / 100;

  res.json({
    trader: { id: trader.id, name: trader.name },
    totalDeliveries,
    totalPayments,
    balance: Math.round((totalDeliveries - totalPayments) * 100) / 100,
    entries: ledger,
  });
}));

// POST /:id/close-po/:poId — Manually close a running PO
router.post('/:id/close-po/:poId', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id: traderId, poId } = req.params;

  const po = await prisma.purchaseOrder.findFirst({
    where: {
      id: poId,
      vendorId: traderId,
      dealType: 'OPEN',
      status: { in: ['APPROVED', 'PARTIAL_RECEIVED'] },
      ...getCompanyFilter(req),
    },
    include: { lines: { select: { amount: true, cgstAmount: true, sgstAmount: true, lineTotal: true } } },
  });
  if (!po) return res.status(404).json({ error: 'Running PO not found or already closed' });

  // Recalculate totals from all lines
  const subtotal = Math.round(po.lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  const totalCgst = Math.round(po.lines.reduce((s, l) => s + l.cgstAmount, 0) * 100) / 100;
  const totalSgst = Math.round(po.lines.reduce((s, l) => s + l.sgstAmount, 0) * 100) / 100;
  const totalGst = Math.round((totalCgst + totalSgst) * 100) / 100;
  const grandTotal = Math.round(po.lines.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100;

  await prisma.purchaseOrder.update({
    where: { id: poId },
    data: {
      status: 'RECEIVED',
      subtotal, totalCgst, totalSgst, totalGst, grandTotal,
      remarks: `Running PO closed | ${po.lines.length} deliveries | ${po.remarks || ''}`,
    },
  });

  res.json({ ok: true, poNo: po.poNo, deliveries: po.lines.length, grandTotal });
}));

export default router;
