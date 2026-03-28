import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import prisma from '../config/prisma';

const router = Router();

// ═══════════════════════════════════════════════
// Shared types
// ═══════════════════════════════════════════════

interface UnifiedPayment {
  id: string;
  date: Date;
  payee: string;
  payeeType: 'VENDOR' | 'TRANSPORTER' | 'CASH' | 'CUSTOMER';
  amount: number;
  mode: string;
  reference: string | null;
  remarks: string | null;
  source: string; // model name
  sourceRef: string | null; // invoice/shipment ref
  createdAt: Date;
}

// ═══════════════════════════════════════════════
// GET /outgoing — All outgoing payments merged
// ═══════════════════════════════════════════════
router.get('/outgoing', asyncHandler(async (req: AuthRequest, res: Response) => {
  const take = Math.min(parseInt(req.query.limit as string) || 50, 500);
  const skip = parseInt(req.query.offset as string) || 0;
  const type = req.query.type as string | undefined;
  const mode = req.query.mode as string | undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  const dateFilter = {
    ...(from ? { gte: new Date(from) } : {}),
    ...(to ? { lte: new Date(to) } : {}),
  };
  const hasDateFilter = from || to;

  const results: UnifiedPayment[] = [];

  // 1. Vendor Payments
  if (!type || type === 'VENDOR') {
    const vendorWhere: Record<string, unknown> = {};
    if (hasDateFilter) vendorWhere.paymentDate = dateFilter;
    if (mode) vendorWhere.mode = mode;

    const vendorPayments = await prisma.vendorPayment.findMany({
      where: vendorWhere,
      take: 200,
      orderBy: { paymentDate: 'desc' },
      select: {
        id: true, paymentDate: true, amount: true, mode: true, reference: true,
        remarks: true, tdsDeducted: true, isAdvance: true, createdAt: true,
        vendor: { select: { name: true } },
        invoice: { select: { invoiceNo: true } },
      },
    });

    for (const p of vendorPayments) {
      results.push({
        id: p.id,
        date: p.paymentDate,
        payee: p.vendor.name,
        payeeType: 'VENDOR',
        amount: p.amount,
        mode: p.mode,
        reference: p.reference,
        remarks: [p.remarks, p.tdsDeducted > 0 ? `TDS: ₹${p.tdsDeducted}` : null, p.isAdvance ? 'ADVANCE' : null].filter(Boolean).join(' | ') || null,
        source: 'VendorPayment',
        sourceRef: p.invoice?.invoiceNo ? `INV-${p.invoice.invoiceNo}` : null,
        createdAt: p.createdAt,
      });
    }
  }

  // 2. Transporter Payments
  if (!type || type === 'TRANSPORTER') {
    const tpWhere: Record<string, unknown> = {};
    if (hasDateFilter) tpWhere.paymentDate = dateFilter;
    if (mode) tpWhere.mode = mode;

    const transporterPayments = await prisma.transporterPayment.findMany({
      where: tpWhere,
      take: 200,
      orderBy: { paymentDate: 'desc' },
      select: {
        id: true, paymentDate: true, amount: true, mode: true, reference: true,
        remarks: true, transporterName: true, paymentType: true, createdAt: true,
        shipment: { select: { shipmentNo: true } },
      },
    });

    for (const p of transporterPayments) {
      results.push({
        id: p.id,
        date: p.paymentDate,
        payee: p.transporterName,
        payeeType: 'TRANSPORTER',
        amount: p.amount,
        mode: p.mode,
        reference: p.reference,
        remarks: [p.paymentType, p.remarks].filter(Boolean).join(' | ') || null,
        source: 'TransporterPayment',
        sourceRef: p.shipment?.shipmentNo ? `SHP-${String(p.shipment.shipmentNo)}` : null,
        createdAt: p.createdAt,
      });
    }
  }

  // 3. Cash Vouchers (type=PAYMENT only, not receipts)
  if (!type || type === 'CASH') {
    try {
      let cvQuery = `SELECT id, date, amount, "paymentMode", "paymentRef", "payeeName", purpose, category, status, "createdAt" FROM "CashVoucher" WHERE type = 'PAYMENT'`;
      const cvParams: unknown[] = [];
      let paramIdx = 1;
      if (from) { cvQuery += ` AND date >= $${paramIdx++}`; cvParams.push(new Date(from)); }
      if (to) { cvQuery += ` AND date <= $${paramIdx++}`; cvParams.push(new Date(to)); }
      if (mode) { cvQuery += ` AND "paymentMode" = $${paramIdx++}`; cvParams.push(mode); }
      cvQuery += ` ORDER BY date DESC LIMIT 200`;

      const cashVouchers = await prisma.$queryRawUnsafe(cvQuery, ...cvParams) as Array<{
        id: string; date: Date; amount: number; paymentMode: string; paymentRef: string | null;
        payeeName: string; purpose: string; category: string; status: string; createdAt: Date;
      }>;

      for (const c of cashVouchers) {
        results.push({
          id: c.id,
          date: c.date,
          payee: c.payeeName,
          payeeType: 'CASH',
          amount: c.amount,
          mode: c.paymentMode,
          reference: c.paymentRef,
          remarks: [c.category, c.purpose, c.status !== 'ACTIVE' ? c.status : null].filter(Boolean).join(' | ') || null,
          source: 'CashVoucher',
          sourceRef: null,
          createdAt: c.createdAt,
        });
      }
    } catch {
      // CashVoucher table may not exist yet
    }
  }

  // Sort by date descending, then paginate
  results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const paginated = results.slice(skip, skip + take);

  res.json({ items: paginated, total: results.length });
}));

// ═══════════════════════════════════════════════
// GET /outgoing/summary — KPIs for outgoing payments
// ═══════════════════════════════════════════════
router.get('/outgoing/summary', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [vendorAgg, transporterAgg, cashAgg] = await Promise.all([
    prisma.vendorPayment.aggregate({
      where: { paymentDate: { gte: monthStart } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.transporterPayment.aggregate({
      where: { paymentDate: { gte: monthStart } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*)::int as count FROM "CashVoucher" WHERE type = 'PAYMENT' AND date >= $1`,
      monthStart
    ).then((rows: unknown) => {
      const r = (rows as Array<{ total: number; count: number }>)[0];
      return { _sum: { amount: r?.total || 0 }, _count: r?.count || 0 };
    }).catch(() => ({ _sum: { amount: 0 }, _count: 0 })),
  ]);

  const vendorTotal = vendorAgg._sum.amount || 0;
  const transporterTotal = transporterAgg._sum.amount || 0;
  const cashTotal = cashAgg._sum.amount || 0;

  res.json({
    totalThisMonth: vendorTotal + transporterTotal + cashTotal,
    vendors: { total: vendorTotal, count: vendorAgg._count },
    transporters: { total: transporterTotal, count: transporterAgg._count },
    cash: { total: cashTotal, count: cashAgg._count },
  });
}));

// ═══════════════════════════════════════════════
// GET /incoming — All incoming payments merged
// ═══════════════════════════════════════════════
router.get('/incoming', asyncHandler(async (req: AuthRequest, res: Response) => {
  const take = Math.min(parseInt(req.query.limit as string) || 50, 500);
  const skip = parseInt(req.query.offset as string) || 0;
  const customerId = req.query.customerId as string | undefined;
  const mode = req.query.mode as string | undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  const where: Record<string, unknown> = {};
  if (customerId) where.customerId = customerId;
  if (mode) where.mode = mode;
  if (from || to) {
    where.paymentDate = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      take,
      skip,
      orderBy: { paymentDate: 'desc' },
      select: {
        id: true, paymentNo: true, paymentDate: true, amount: true, mode: true,
        reference: true, remarks: true, createdAt: true,
        customer: { select: { name: true } },
        invoice: { select: { invoiceNo: true } },
      },
    }),
    prisma.payment.count({ where }),
  ]);

  const items = payments.map(p => ({
    id: p.id,
    paymentNo: p.paymentNo,
    date: p.paymentDate,
    payer: p.customer.name,
    amount: p.amount,
    mode: p.mode,
    reference: p.reference,
    invoiceRef: p.invoice?.invoiceNo || null,
    remarks: p.remarks,
    createdAt: p.createdAt,
  }));

  res.json({ items, total });
}));

// ═══════════════════════════════════════════════
// GET /incoming/summary — KPIs for incoming payments
// ═══════════════════════════════════════════════
router.get('/incoming/summary', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [totalAgg, modeBreakdown] = await Promise.all([
    prisma.payment.aggregate({
      where: { paymentDate: { gte: monthStart } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.payment.groupBy({
      by: ['mode'],
      where: { paymentDate: { gte: monthStart } },
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  const byMode: Record<string, { total: number; count: number }> = {};
  for (const m of modeBreakdown) {
    byMode[m.mode] = { total: m._sum.amount || 0, count: m._count };
  }

  res.json({
    totalThisMonth: totalAgg._sum.amount || 0,
    count: totalAgg._count,
    byMode,
  });
}));

export default router;
