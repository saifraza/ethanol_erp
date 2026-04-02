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
  // Document links (vendor payments only)
  poId?: string | null;
  grnId?: string | null;
  invoiceFilePath?: string | null;
  invoiceAmount?: number | null;
  tdsDeducted?: number;
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
        invoice: { select: { invoiceNo: true, vendorInvNo: true, poId: true, grnId: true, filePath: true, totalAmount: true } },
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
        remarks: [p.remarks, p.tdsDeducted > 0 ? `TDS: \u20B9${p.tdsDeducted}` : null, p.isAdvance ? 'ADVANCE' : null].filter(Boolean).join(' | ') || null,
        source: 'VendorPayment',
        sourceRef: p.invoice?.invoiceNo ? `INV-${p.invoice.invoiceNo}` : null,
        createdAt: p.createdAt,
        // Document links for vendor payments
        poId: p.invoice?.poId || null,
        grnId: p.invoice?.grnId || null,
        invoiceFilePath: p.invoice?.filePath || null,
        invoiceAmount: p.invoice?.totalAmount || null,
        tdsDeducted: p.tdsDeducted || 0,
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

  // 3. Contractor Payments
  if (!type || type === 'CONTRACTOR') {
    const cpWhere: Record<string, unknown> = { paymentStatus: { not: 'CANCELLED' } };
    if (hasDateFilter) cpWhere.paymentDate = dateFilter;
    if (mode) cpWhere.paymentMode = mode;

    const contractorPayments = await prisma.contractorPayment.findMany({
      where: cpWhere,
      take: 200,
      orderBy: { paymentDate: 'desc' },
      select: {
        id: true, paymentDate: true, amount: true, paymentMode: true, paymentRef: true,
        remarks: true, tdsDeducted: true, isAdvance: true, createdAt: true,
        contractor: { select: { name: true } },
        bill: { select: { billNo: true } },
      },
    });

    for (const p of contractorPayments) {
      results.push({
        id: p.id,
        date: p.paymentDate,
        payee: p.contractor.name,
        payeeType: 'VENDOR',
        amount: p.amount,
        mode: p.paymentMode,
        reference: p.paymentRef,
        remarks: ['CONTRACTOR', p.tdsDeducted > 0 ? `TDS: \u20B9${p.tdsDeducted}` : null, p.remarks].filter(Boolean).join(' | ') || null,
        source: 'ContractorPayment',
        sourceRef: p.bill ? `BILL-${p.bill.billNo}` : null,
        createdAt: p.createdAt,
        tdsDeducted: p.tdsDeducted || 0,
      });
    }
  }

  // 4. Cash Vouchers (type=PAYMENT only, not receipts)
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
          amount: Number(c.amount),
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

  const [vendorAgg, transporterAgg, contractorAgg, cashAgg] = await Promise.all([
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
    prisma.contractorPayment.aggregate({
      where: { paymentDate: { gte: monthStart }, paymentStatus: { not: 'CANCELLED' } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*)::int as count FROM "CashVoucher" WHERE type = 'PAYMENT' AND date >= $1`,
      monthStart
    ).then((rows: unknown) => {
      const r = (rows as Array<{ total: number; count: number }>)[0];
      return { _sum: { amount: Number(r?.total) || 0 }, _count: Number(r?.count) || 0 };
    }).catch(() => ({ _sum: { amount: 0 }, _count: 0 })),
  ]);

  const vendorTotal = vendorAgg._sum.amount || 0;
  const transporterTotal = transporterAgg._sum.amount || 0;
  const contractorTotal = contractorAgg._sum.amount || 0;
  const cashTotal = cashAgg._sum.amount || 0;

  res.json({
    totalThisMonth: vendorTotal + transporterTotal + contractorTotal + cashTotal,
    vendors: { total: vendorTotal, count: vendorAgg._count },
    transporters: { total: transporterTotal, count: transporterAgg._count },
    contractors: { total: contractorTotal, count: contractorAgg._count },
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
      status: { in: ['APPROVED', 'SENT', 'PARTIAL_RECEIVED', 'RECEIVED', 'CLOSED'] },
    },
    select: {
      id: true, poNo: true, poDate: true, grandTotal: true, subtotal: true, totalGst: true, status: true, paymentTerms: true, creditDays: true,
      dealType: true,
      vendor: { select: { id: true, name: true, creditDays: true, paymentTerms: true, tdsApplicable: true, tdsPercent: true, tdsSection: true, bankName: true, bankAccount: true, bankIfsc: true, phone: true } },
      lines: { select: { description: true, receivedQty: true, rate: true, gstPercent: true, quantity: true } },
      grns: {
        where: { status: { not: 'CANCELLED' } },  // Include DRAFT + CONFIRMED (not just CONFIRMED)
        orderBy: { grnDate: 'desc' },
        select: { id: true, grnNo: true, grnDate: true, totalAmount: true, totalQty: true, status: true },
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
    poSubtotal: number;
    poGst: number;
    poStatus: string;
    dealType: string;
    vendorId: string;
    vendorName: string;
    grnId: string | null;
    grnNo: number | null;
    grnDate: string | null;
    grnCount: number;
    grnTotalValue: number;
    paymentTerms: string | null;
    creditDays: number;
    dueDate: string | null;
    daysOverdue: number | null;
    urgency: 'green' | 'amber' | 'red' | 'none';
    invoiceStatus: 'NO_INVOICE' | 'PENDING' | 'PARTIAL_PAID' | 'PAID';
    paymentStatus: 'NO_GRN' | 'GRN_RECEIVED' | 'INVOICED' | 'PARTIAL_PAID' | 'PAID';
    invoices: Array<{ id: string; vendorInvNo: string | null; netPayable: number; paidAmount: number; balanceAmount: number; status: string }>;
    totalInvoiced: number;
    totalPaid: number;
    balance: number;
    tdsApplicable: boolean;
    tdsPercent: number;
    tdsSection: string | null;
    material: string | null;
    vendorBank: string | null;
    vendorAccount: string | null;
    vendorIfsc: string | null;
    vendorPhone: string | null;
  }

  const pending: PendingPayable[] = [];

  for (const po of pos) {
    const invoices = po.vendorInvoices || [];
    const grns = po.grns || [];
    const totalInvoiced = invoices.reduce((s, inv) => s + (inv.netPayable || 0), 0);
    let totalPaid = invoices.reduce((s, inv) => s + (inv.paidAmount || 0), 0);
    const invoiceBalance = invoices.reduce((s, inv) => s + (inv.balanceAmount || 0), 0);

    // For non-invoiced POs (esp. fuel deals): also count direct VendorPayments
    // These are matched by remarks containing "PO-{poNo}" (same pattern as fuel.ts)
    if (invoices.length === 0) {
      const directPayments = await prisma.vendorPayment.findMany({
        where: {
          vendorId: po.vendor.id,
          invoiceId: null,
          OR: [
            { remarks: { contains: `PO-${po.poNo} ` } },
            { remarks: { endsWith: `PO-${po.poNo}` } },
            { remarks: { contains: `PO-${po.poNo}|` } },
          ],
        },
        select: { amount: true },
      });
      totalPaid += directPayments.reduce((s, p) => s + p.amount, 0);

      // Also count cash vouchers linked to this deal
      try {
        const cashPaid = await prisma.$queryRawUnsafe(
          `SELECT COALESCE(SUM(amount), 0) as total FROM "CashVoucher" WHERE type = 'PAYMENT' AND "payeeName" = $1 AND purpose LIKE $2`,
          po.vendor.name, `%PO-${po.poNo}%`
        ) as Array<{ total: number }>;
        totalPaid += Number(cashPaid[0]?.total) || 0; // $queryRawUnsafe returns numeric as string
      } catch { /* CashVoucher table may not exist */ }
    }

    // Skip if fully paid
    if (invoices.length > 0 && invoiceBalance <= 0) continue;
    if (invoices.length === 0 && totalPaid > 0) {
      const effectiveAmt = (po.dealType === 'OPEN')
        ? grns.reduce((s, g) => s + (g.totalAmount || 0), 0)
        : po.grandTotal;
      if (totalPaid >= effectiveAmt && effectiveAmt > 0) continue; // Fully paid, skip
    }

    // For OPEN/fuel deals: use GRN totals as the real PO value (grandTotal=0 for open deals)
    const isOpenDeal = po.dealType === 'OPEN';
    const grnTotalValue = grns.reduce((s, g) => s + (g.totalAmount || 0), 0);
    const effectivePoAmount = isOpenDeal ? grnTotalValue : po.grandTotal;

    // Skip POs with no GRNs and no invoices and not OPEN deals
    if (grns.length === 0 && invoices.length === 0 && !isOpenDeal) {
      // Standard PO with no goods received and no invoices — not yet payable
      if (!['PARTIAL_RECEIVED', 'RECEIVED', 'CLOSED'].includes(po.status)) continue;
    }

    const latestGrn = grns[0] || null;
    const creditDays = parsePaymentTermsDays(po.paymentTerms) ?? parsePaymentTermsDays(po.vendor.paymentTerms) ?? 30;
    const paymentTerms = po.paymentTerms || po.vendor.paymentTerms || null;

    let dueDate: Date | null = null;
    let daysOverdue: number | null = null;
    let urgency: 'green' | 'amber' | 'red' | 'none' = 'none';

    if (latestGrn) {
      dueDate = new Date(latestGrn.grnDate);
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

    // Payment status — clearer lifecycle tracking
    let paymentStatus: PendingPayable['paymentStatus'] = 'NO_GRN';
    if (grns.length === 0) paymentStatus = 'NO_GRN';
    else if (invoices.length === 0 && totalPaid === 0) paymentStatus = 'GRN_RECEIVED';
    else if (invoices.length === 0 && totalPaid > 0) {
      // Direct PO payments (no invoice): check if fully paid
      const effectiveAmt = (po.dealType === 'OPEN')
        ? grns.reduce((s, g) => s + (g.totalAmount || 0), 0)
        : po.grandTotal;
      paymentStatus = (totalPaid >= effectiveAmt - 0.01 && effectiveAmt > 0) ? 'PAID' : 'PARTIAL_PAID';
    }
    else if (totalPaid > 0 && invoiceBalance > 0) paymentStatus = 'PARTIAL_PAID';
    else if (invoices.length > 0 && totalPaid === 0) paymentStatus = 'INVOICED';
    else paymentStatus = 'GRN_RECEIVED';

    // Calculate received value (what's actually been delivered) — cap payable at this amount
    const receivedValue = Math.round((po as any).lines?.reduce((s: number, l: any) => {
      const base = (l.receivedQty || 0) * (l.rate || 0);
      return s + base + base * (l.gstPercent || 0) / 100;
    }, 0) * 100) / 100 || grnTotalValue;

    // Count pending cash vouchers (committed but not confirmed)
    let pendingCash = 0;
    try {
      const pendingCVs = await prisma.cashVoucher.findMany({
        where: { status: 'ACTIVE', purpose: { contains: `PO-${po.poNo}` } },
        select: { amount: true },
      });
      pendingCash = pendingCVs.reduce((s, v) => s + v.amount, 0);
    } catch { /* ignore */ }

    // Balance: payable = received value - paid - pending cash (NOT full PO amount)
    const payableBase = invoices.length > 0 ? invoiceBalance : receivedValue;
    const balance = invoices.length > 0 ? invoiceBalance : Math.max(0, payableBase - totalPaid - pendingCash);

    pending.push({
      poId: po.id,
      poNo: po.poNo,
      poDate: po.poDate.toISOString(),
      poAmount: effectivePoAmount,
      poSubtotal: isOpenDeal ? grnTotalValue : (po.subtotal || 0),
      poGst: isOpenDeal ? 0 : (po.totalGst || 0),
      poStatus: po.status,
      dealType: po.dealType || 'STANDARD',
      vendorId: po.vendor.id,
      vendorName: po.vendor.name,
      grnId: latestGrn?.id || null,
      grnNo: latestGrn?.grnNo || null,
      grnDate: latestGrn?.grnDate?.toISOString() || null,
      grnCount: grns.length,
      grnTotalValue: Math.round(grnTotalValue * 100) / 100,
      paymentTerms,
      creditDays,
      dueDate: dueDate?.toISOString() || null,
      daysOverdue,
      urgency,
      invoiceStatus,
      paymentStatus,
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
      balance,
      tdsApplicable: po.vendor.tdsApplicable,
      tdsPercent: po.vendor.tdsPercent,
      tdsSection: po.vendor.tdsSection || null,
      material: (po as any).lines?.[0]?.description || null,
      vendorBank: po.vendor.bankName || null,
      vendorAccount: po.vendor.bankAccount || null,
      vendorIfsc: po.vendor.bankIfsc || null,
      vendorPhone: po.vendor.phone || null,
    });
  }

  // ── Contractor bills (confirmed, unpaid) ──
  const contractorBills = await prisma.contractorBill.findMany({
    where: { status: { in: ['CONFIRMED', 'PARTIAL_PAID'] }, balanceAmount: { gt: 0 } },
    select: {
      id: true, billNo: true, billDate: true, description: true,
      subtotal: true, totalAmount: true, tdsAmount: true, tdsPercent: true,
      netPayable: true, paidAmount: true, balanceAmount: true, status: true,
      contractor: {
        select: {
          id: true, name: true, contractorCode: true, tdsPercent: true, tdsSection: true,
          bankName: true, bankAccount: true, bankIfsc: true, phone: true,
        },
      },
    },
    orderBy: { billDate: 'asc' },
    take: 200,
  });

  for (const cb of contractorBills) {
    pending.push({
      poId: cb.id, // reuse field as source ID
      poNo: cb.billNo,
      poDate: cb.billDate.toISOString(),
      poAmount: cb.totalAmount,
      poSubtotal: cb.subtotal,
      poGst: cb.totalAmount - cb.subtotal,
      poStatus: cb.status,
      dealType: 'CONTRACTOR',
      vendorId: cb.contractor.id,
      vendorName: cb.contractor.name,
      grnId: null,
      grnNo: null,
      grnDate: cb.billDate.toISOString(),
      grnCount: 0,
      grnTotalValue: cb.totalAmount,
      paymentTerms: 'COD',
      creditDays: 0,
      dueDate: cb.billDate.toISOString(),
      daysOverdue: Math.floor((today.getTime() - new Date(cb.billDate).getTime()) / (1000 * 60 * 60 * 24)),
      urgency: Math.floor((today.getTime() - new Date(cb.billDate).getTime()) / (1000 * 60 * 60 * 24)) > 7 ? 'red' : 'amber',
      invoiceStatus: 'PENDING',
      paymentStatus: cb.paidAmount > 0 ? 'PARTIAL_PAID' : 'INVOICED',
      invoices: [{
        id: cb.id,
        vendorInvNo: `BILL-${cb.billNo}`,
        netPayable: cb.netPayable,
        paidAmount: cb.paidAmount,
        balanceAmount: cb.balanceAmount,
        status: cb.status,
      }],
      totalInvoiced: cb.netPayable,
      totalPaid: cb.paidAmount,
      balance: cb.balanceAmount,
      tdsApplicable: true,
      tdsPercent: cb.contractor.tdsPercent,
      tdsSection: cb.contractor.tdsSection || '194C',
      material: cb.description,
      vendorBank: cb.contractor.bankName || null,
      vendorAccount: cb.contractor.bankAccount || null,
      vendorIfsc: cb.contractor.bankIfsc || null,
      vendorPhone: cb.contractor.phone || null,
    } as PendingPayable);
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
  const aging = { overdue: 0, thisWeek: 0, d7_15: 0, d15_30: 0, d30plus: 0 };
  const agingCount = { overdue: 0, thisWeek: 0, d7_15: 0, d15_30: 0, d30plus: 0 };

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

      // daysOver > 0 means overdue, daysOver < 0 means days remaining
      const daysLeft = -daysOver; // positive = days until due

      if (daysOver > 0) { aging.overdue += balance; agingCount.overdue++; overdueAmount += balance; }
      else if (daysLeft <= 7) { aging.thisWeek += balance; agingCount.thisWeek++; }
      else if (daysLeft <= 15) { aging.d7_15 += balance; agingCount.d7_15++; }
      else if (daysLeft <= 30) { aging.d15_30 += balance; agingCount.d15_30++; }
      else { aging.d30plus += balance; agingCount.d30plus++; }

      dueThisWeek = aging.thisWeek; // sync from bucket
    } else {
      aging.d30plus += balance;
      agingCount.d30plus++;
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
