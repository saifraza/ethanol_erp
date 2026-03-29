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

// ═══════════════════════════════════════════════
// GET /incoming/pending — Unpaid invoices (receivables)
// ═══════════════════════════════════════════════
router.get('/incoming/pending', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const invoices = await prisma.invoice.findMany({
    where: { status: { in: ['UNPAID', 'PARTIAL'] } },
    take: 500,
    orderBy: { invoiceDate: 'asc' },
    select: {
      id: true, invoiceNo: true, invoiceDate: true, dueDate: true,
      productName: true, quantity: true, unit: true,
      totalAmount: true, paidAmount: true, balanceAmount: true, status: true,
      customer: { select: { id: true, name: true } },
    },
  });

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const items = invoices.map(inv => {
    const invDate = new Date(inv.invoiceDate);
    const dueDate = inv.dueDate ? new Date(inv.dueDate) : new Date(invDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    const diffMs = today.getTime() - dueDate.getTime();
    const daysOverdue = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    let urgency: 'green' | 'amber' | 'red' = 'green';
    if (daysOverdue > 0) urgency = 'red';
    else if (daysOverdue >= -7) urgency = 'amber';

    return {
      invoiceId: inv.id,
      invoiceNo: inv.invoiceNo,
      invoiceDate: inv.invoiceDate.toISOString(),
      dueDate: dueDate.toISOString(),
      daysOverdue,
      urgency,
      customerId: inv.customer.id,
      customerName: inv.customer.name,
      productName: inv.productName,
      quantity: inv.quantity,
      unit: inv.unit,
      totalAmount: inv.totalAmount,
      paidAmount: inv.paidAmount,
      balanceAmount: inv.balanceAmount,
      status: inv.status,
    };
  });

  // Sort by dueDate ascending (most urgent first)
  items.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  res.json({ items });
}));

// ═══════════════════════════════════════════════
// GET /incoming/pending-summary — Receivables KPIs + aging
// ═══════════════════════════════════════════════
router.get('/incoming/pending-summary', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const invoices = await prisma.invoice.findMany({
    where: { status: { in: ['UNPAID', 'PARTIAL'] } },
    take: 500,
    select: {
      invoiceDate: true, dueDate: true, balanceAmount: true,
    },
  });

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekFromNow = new Date(today);
  weekFromNow.setDate(weekFromNow.getDate() + 7);

  let totalReceivable = 0;
  let overdueAmount = 0;
  let dueThisWeek = 0;
  const aging = { current: 0, d1_15: 0, d16_30: 0, d31_60: 0, d60plus: 0 };
  const agingCount = { current: 0, d1_15: 0, d16_30: 0, d31_60: 0, d60plus: 0 };

  for (const inv of invoices) {
    const balance = inv.balanceAmount || 0;
    totalReceivable += balance;

    const invDate = new Date(inv.invoiceDate);
    const dueDate = inv.dueDate ? new Date(inv.dueDate) : new Date(invDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    const diffMs = today.getTime() - dueDate.getTime();
    const daysOver = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (daysOver > 60) { aging.d60plus += balance; agingCount.d60plus++; }
    else if (daysOver > 30) { aging.d31_60 += balance; agingCount.d31_60++; }
    else if (daysOver > 15) { aging.d16_30 += balance; agingCount.d16_30++; }
    else if (daysOver > 0) { aging.d1_15 += balance; agingCount.d1_15++; }
    else { aging.current += balance; agingCount.current++; }

    if (daysOver > 0) overdueAmount += balance;
    if (dueDate >= today && dueDate <= weekFromNow) dueThisWeek += balance;
  }

  // Collected this month
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const collectedAgg = await prisma.payment.aggregate({
    where: { paymentDate: { gte: monthStart } },
    _sum: { amount: true },
  });

  res.json({
    totalReceivable,
    overdueAmount,
    dueThisWeek,
    collectedThisMonth: collectedAgg._sum.amount || 0,
    aging,
    agingCount,
  });
}));

// Parse payment terms string to extract days
function parsePaymentTermsDays(terms: string | null | undefined): number | null {
  if (!terms) return null;
  const upper = terms.toUpperCase().replace(/\s+/g, '');
  // Match patterns: NET30, NET-30, Net 30, NET_30, Net30Days
  const match = upper.match(/NET[_-]?(\d+)/);
  if (match) return parseInt(match[1], 10);
  // ADVANCE or COD = 0 days
  if (upper === 'ADVANCE' || upper === 'COD') return 0;
  // "30 DAYS", "45 Days"
  const daysMatch = upper.match(/(\d+)\s*DAYS?/);
  if (daysMatch) return parseInt(daysMatch[1], 10);
  return null;
}

// ═══════════════════════════════════════════════
// GET /outgoing/pending — POs awaiting invoice/payment
// ═══════════════════════════════════════════════
router.get('/outgoing/pending', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const pos = await prisma.purchaseOrder.findMany({
    where: {
      status: { in: ['PARTIAL_RECEIVED', 'RECEIVED', 'CLOSED'] },
    },
    select: {
      id: true, poNo: true, poDate: true, grandTotal: true, status: true, paymentTerms: true, creditDays: true,
      vendor: { select: { id: true, name: true, creditDays: true, paymentTerms: true, tdsApplicable: true, tdsPercent: true, tdsSection: true } },
      grns: {
        where: { status: 'CONFIRMED' },
        orderBy: { grnDate: 'desc' },
        take: 1,
        select: { id: true, grnNo: true, grnDate: true, totalAmount: true },
      },
      vendorInvoices: {
        where: { status: { not: 'CANCELLED' } },
        select: { id: true, vendorInvNo: true, invoiceDate: true, netPayable: true, paidAmount: true, balanceAmount: true, status: true },
      },
    },
    orderBy: { poDate: 'desc' },
    take: 500,
  });

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  interface PendingPayable {
    poId: string;
    poNo: number;
    poDate: string;
    poAmount: number;
    poStatus: string;
    vendorId: string;
    vendorName: string;
    grnId: string | null;
    grnNo: number | null;
    grnDate: string | null;
    paymentTerms: string | null;
    creditDays: number;
    dueDate: string | null;
    daysOverdue: number | null;
    urgency: 'green' | 'amber' | 'red' | 'none';
    invoiceStatus: 'NO_INVOICE' | 'PENDING' | 'PARTIAL_PAID' | 'PAID';
    invoices: Array<{ id: string; vendorInvNo: string | null; netPayable: number; paidAmount: number; balanceAmount: number; status: string }>;
    totalInvoiced: number;
    totalPaid: number;
    balance: number;
    tdsApplicable: boolean;
    tdsPercent: number;
    tdsSection: string | null;
  }

  const pending: PendingPayable[] = [];

  for (const po of pos) {
    const invoices = po.vendorInvoices || [];
    const totalInvoiced = invoices.reduce((s, inv) => s + (inv.netPayable || 0), 0);
    const totalPaid = invoices.reduce((s, inv) => s + (inv.paidAmount || 0), 0);
    const balance = invoices.reduce((s, inv) => s + (inv.balanceAmount || 0), 0);

    // Skip if all invoices fully paid and at least one invoice exists
    if (invoices.length > 0 && balance <= 0) continue;

    // If no invoices at all, the full PO amount is pending
    const grn = po.grns[0] || null;
    // Parse payment terms: PO terms take priority, then vendor terms, fallback 30
    const creditDays = parsePaymentTermsDays(po.paymentTerms) ?? parsePaymentTermsDays(po.vendor.paymentTerms) ?? 30;
    const paymentTerms = po.paymentTerms || po.vendor.paymentTerms || null;

    let dueDate: Date | null = null;
    let daysOverdue: number | null = null;
    let urgency: 'green' | 'amber' | 'red' | 'none' = 'none';

    if (grn) {
      dueDate = new Date(grn.grnDate);
      dueDate.setDate(dueDate.getDate() + creditDays);
      const diffMs = today.getTime() - dueDate.getTime();
      daysOverdue = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (daysOverdue > 0) urgency = 'red';
      else if (daysOverdue >= -7) urgency = 'amber';
      else urgency = 'green';
    }

    let invoiceStatus: PendingPayable['invoiceStatus'] = 'NO_INVOICE';
    if (invoices.length > 0) {
      const allPaid = invoices.every(inv => inv.status === 'PAID');
      const anyPartial = invoices.some(inv => inv.status === 'PARTIAL_PAID');
      if (allPaid) invoiceStatus = 'PAID';
      else if (anyPartial || totalPaid > 0) invoiceStatus = 'PARTIAL_PAID';
      else invoiceStatus = 'PENDING';
    }

    pending.push({
      poId: po.id,
      poNo: po.poNo,
      poDate: po.poDate.toISOString(),
      poAmount: po.grandTotal,
      poStatus: po.status,
      vendorId: po.vendor.id,
      vendorName: po.vendor.name,
      grnId: grn?.id || null,
      grnNo: grn?.grnNo || null,
      grnDate: grn?.grnDate?.toISOString() || null,
      paymentTerms,
      creditDays,
      dueDate: dueDate?.toISOString() || null,
      daysOverdue,
      urgency,
      invoiceStatus,
      invoices: invoices.map(inv => ({
        id: inv.id,
        vendorInvNo: inv.vendorInvNo,
        netPayable: inv.netPayable,
        paidAmount: inv.paidAmount,
        balanceAmount: inv.balanceAmount,
        status: inv.status,
      })),
      totalInvoiced,
      totalPaid,
      balance: invoices.length > 0 ? balance : po.grandTotal,
      tdsApplicable: po.vendor.tdsApplicable,
      tdsPercent: po.vendor.tdsPercent,
      tdsSection: po.vendor.tdsSection || null,
    });
  }

  // Sort by dueDate ascending (most urgent first), nulls last
  pending.sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
  });

  res.json({ items: pending });
}));

// ═══════════════════════════════════════════════
// GET /outgoing/pending-summary — KPIs + aging for pending payables
// ═══════════════════════════════════════════════
router.get('/outgoing/pending-summary', asyncHandler(async (_req: AuthRequest, res: Response) => {
  // Get pending POs (same logic as above, lighter query)
  const pos = await prisma.purchaseOrder.findMany({
    where: {
      status: { in: ['PARTIAL_RECEIVED', 'RECEIVED', 'CLOSED'] },
    },
    select: {
      grandTotal: true, paymentTerms: true,
      vendor: { select: { paymentTerms: true } },
      grns: {
        where: { status: 'CONFIRMED' },
        orderBy: { grnDate: 'desc' },
        take: 1,
        select: { grnDate: true },
      },
      vendorInvoices: {
        where: { status: { not: 'CANCELLED' } },
        select: { netPayable: true, paidAmount: true, balanceAmount: true, status: true },
      },
    },
    take: 500,
  });

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekFromNow = new Date(today);
  weekFromNow.setDate(weekFromNow.getDate() + 7);

  let totalPayable = 0;
  let overdueAmount = 0;
  let dueThisWeek = 0;
  const aging = { current: 0, d1_15: 0, d16_30: 0, d31_60: 0, d60plus: 0 };
  const agingCount = { current: 0, d1_15: 0, d16_30: 0, d31_60: 0, d60plus: 0 };

  for (const po of pos) {
    const invoices = po.vendorInvoices || [];
    const balance = invoices.length > 0
      ? invoices.reduce((s, inv) => s + (inv.balanceAmount || 0), 0)
      : po.grandTotal;

    if (invoices.length > 0 && balance <= 0) continue;

    totalPayable += balance;

    const grn = po.grns[0] || null;
    const creditDays = parsePaymentTermsDays(po.paymentTerms) ?? parsePaymentTermsDays(po.vendor.paymentTerms) ?? 30;

    if (grn) {
      const dueDate = new Date(grn.grnDate);
      dueDate.setDate(dueDate.getDate() + creditDays);
      const diffMs = today.getTime() - dueDate.getTime();
      const daysOver = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (daysOver > 60) { aging.d60plus += balance; agingCount.d60plus++; }
      else if (daysOver > 30) { aging.d31_60 += balance; agingCount.d31_60++; }
      else if (daysOver > 15) { aging.d16_30 += balance; agingCount.d16_30++; }
      else if (daysOver > 0) { aging.d1_15 += balance; agingCount.d1_15++; }
      else { aging.current += balance; agingCount.current++; }

      if (daysOver > 0) overdueAmount += balance;

      // Due this week: due date is between today and 7 days from now
      if (dueDate >= today && dueDate <= weekFromNow) dueThisWeek += balance;
    } else {
      aging.current += balance;
      agingCount.current++;
    }
  }

  // Paid this month
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const paidAgg = await prisma.vendorPayment.aggregate({
    where: { paymentDate: { gte: monthStart } },
    _sum: { amount: true },
  });

  res.json({
    totalPayable,
    overdueAmount,
    dueThisWeek,
    paidThisMonth: paidAgg._sum.amount || 0,
    aging,
    agingCount,
  });
}));

export default router;
