import { Router, Response } from 'express';
import { AuthRequest, authenticate, getCompanyFilter } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { NotFoundError } from '../shared/errors';
import prisma from '../config/prisma';

const router = Router();
router.use(authenticate);

// Account codes used throughout
const ACCOUNT_CODES = {
  CASH: '1001',
  BANK: '1002',
  TRADE_RECEIVABLE: '1100',
  TRADE_PAYABLE: '2001',
  GST_OUTPUT_CGST: '2100',
  GST_OUTPUT_SGST: '2101',
  GST_OUTPUT_IGST: '2102',
  GST_INPUT_CGST: '1200',
  GST_INPUT_SGST: '1201',
  GST_INPUT_IGST: '1202',
  TDS_PAYABLE: '2200',
  TCS_PAYABLE_206C: '2250',
} as const;

// ═══════════════════════════════════════════════
// Helper: get account by code
// ═══════════════════════════════════════════════
async function getAccountByCode(code: string): Promise<{ id: string; code: string; name: string; openingBalance: number }> {
  const account = await prisma.account.findUnique({
    where: { code },
    select: { id: true, code: true, name: true, openingBalance: true },
  });
  if (!account) throw new NotFoundError('Account', code);
  return account;
}

// ═══════════════════════════════════════════════
// Helper: build ledger with running balance
// ═══════════════════════════════════════════════
async function buildLedger(
  accountId: string,
  openingBalance: number,
  from?: string,
  to?: string,
  take = 200
): Promise<{
  entries: Array<{
    date: Date;
    entryNo: number;
    narration: string;
    debit: number;
    credit: number;
    balance: number;
    journalId: string;
    refType: string | null;
  }>;
  closingBalance: number;
}> {
  const dateFilter: Record<string, unknown> = {};
  if (from) dateFilter.gte = new Date(from);
  if (to) dateFilter.lte = new Date(to);

  const lines = await prisma.journalLine.findMany({
    where: {
      accountId,
      ...(Object.keys(dateFilter).length > 0
        ? { journal: { date: dateFilter } }
        : {}),
    },
    take,
    orderBy: { journal: { date: 'asc' } },
    select: {
      debit: true,
      credit: true,
      journal: {
        select: {
          id: true,
          entryNo: true,
          date: true,
          narration: true,
          refType: true,
        },
      },
    },
  });

  let balance = openingBalance;
  const entries = lines.map(l => {
    balance = balance + l.debit - l.credit;
    return {
      date: l.journal.date,
      entryNo: l.journal.entryNo,
      narration: l.journal.narration,
      debit: l.debit,
      credit: l.credit,
      balance: Math.round(balance * 100) / 100,
      journalId: l.journal.id,
      refType: l.journal.refType,
    };
  });

  return { entries, closingBalance: Math.round(balance * 100) / 100 };
}

// ═══════════════════════════════════════════════
// Helper: bucket days since a date
// ═══════════════════════════════════════════════
function agingBucket(invoiceDate: Date): string {
  const days = Math.floor((Date.now() - new Date(invoiceDate).getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

// ═══════════════════════════════════════════════
// GET /receivables-aging — Aging of trade receivables
// ═══════════════════════════════════════════════
router.get('/receivables-aging', asyncHandler(async (req: AuthRequest, res: Response) => {
  const invoices = await prisma.invoice.findMany({
    where: { ...getCompanyFilter(req), status: { in: ['UNPAID', 'PARTIAL'] } },
    take: 500,
    select: {
      id: true,
      invoiceNo: true,
      invoiceDate: true,
      totalAmount: true,
      paidAmount: true,
      balanceAmount: true,
      status: true,
      customerId: true,
      customer: { select: { id: true, name: true } },
    },
  });

  const customerMap: Record<string, {
    customerId: string;
    customerName: string;
    buckets: Record<string, number>;
    total: number;
  }> = {};

  const totals: Record<string, number> = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  let grandTotal = 0;

  for (const inv of invoices) {
    const bucket = agingBucket(inv.invoiceDate);
    const outstanding = inv.balanceAmount;

    if (!customerMap[inv.customerId]) {
      customerMap[inv.customerId] = {
        customerId: inv.customerId,
        customerName: inv.customer.name,
        buckets: { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 },
        total: 0,
      };
    }

    customerMap[inv.customerId].buckets[bucket] += outstanding;
    customerMap[inv.customerId].total += outstanding;
    totals[bucket] += outstanding;
    grandTotal += outstanding;
  }

  // Round all values
  const customers = Object.values(customerMap).map(c => ({
    ...c,
    buckets: Object.fromEntries(Object.entries(c.buckets).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    total: Math.round(c.total * 100) / 100,
  }));

  res.json({
    customers,
    totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    grandTotal: Math.round(grandTotal * 100) / 100,
  });
}));

// ═══════════════════════════════════════════════
// GET /payables-aging — Aging of trade payables
// ═══════════════════════════════════════════════
router.get('/payables-aging', asyncHandler(async (req: AuthRequest, res: Response) => {
  const invoices = await prisma.vendorInvoice.findMany({
    where: { ...getCompanyFilter(req), balanceAmount: { gt: 0 } },
    take: 500,
    select: {
      id: true,
      invoiceNo: true,
      invoiceDate: true,
      totalAmount: true,
      paidAmount: true,
      balanceAmount: true,
      status: true,
      vendorId: true,
      vendor: { select: { id: true, name: true } },
    },
  });

  const vendorMap: Record<string, {
    vendorId: string;
    vendorName: string;
    buckets: Record<string, number>;
    total: number;
  }> = {};

  const totals: Record<string, number> = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  let grandTotal = 0;

  for (const inv of invoices) {
    const bucket = agingBucket(inv.invoiceDate);
    const outstanding = inv.balanceAmount;

    if (!vendorMap[inv.vendorId]) {
      vendorMap[inv.vendorId] = {
        vendorId: inv.vendorId,
        vendorName: inv.vendor.name,
        buckets: { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 },
        total: 0,
      };
    }

    vendorMap[inv.vendorId].buckets[bucket] += outstanding;
    vendorMap[inv.vendorId].total += outstanding;
    totals[bucket] += outstanding;
    grandTotal += outstanding;
  }

  const vendors = Object.values(vendorMap).map(v => ({
    ...v,
    buckets: Object.fromEntries(Object.entries(v.buckets).map(([k, val]) => [k, Math.round(val * 100) / 100])),
    total: Math.round(v.total * 100) / 100,
  }));

  res.json({
    vendors,
    totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    grandTotal: Math.round(grandTotal * 100) / 100,
  });
}));

// ═══════════════════════════════════════════════
// GET /gst-summary — GST summary for GSTR-3B filing
// ═══════════════════════════════════════════════
router.get('/gst-summary', asyncHandler(async (req: AuthRequest, res: Response) => {
  const from = req.query.from as string;
  const to = req.query.to as string;

  if (!from || !to) {
    res.status(400).json({ error: 'from and to query parameters are required (YYYY-MM-DD)' });
    return;
  }

  const dateFilter = { gte: new Date(from), lte: new Date(to) };

  // Get all GST account IDs
  const gstAccounts = await prisma.account.findMany({
    where: {
      code: {
        in: [
          ACCOUNT_CODES.GST_OUTPUT_CGST, ACCOUNT_CODES.GST_OUTPUT_SGST, ACCOUNT_CODES.GST_OUTPUT_IGST,
          ACCOUNT_CODES.GST_INPUT_CGST, ACCOUNT_CODES.GST_INPUT_SGST, ACCOUNT_CODES.GST_INPUT_IGST,
        ],
      },
    },
    select: { id: true, code: true, name: true },
  
    take: 500,
  });

  const accountIdMap: Record<string, string> = {};
  for (const a of gstAccounts) {
    accountIdMap[a.code] = a.id;
  }

  // Aggregate journal lines for each GST account in the period
  const aggregateForAccount = async (accountId: string | undefined): Promise<{ debit: number; credit: number }> => {
    if (!accountId) return { debit: 0, credit: 0 };
    const agg = await prisma.journalLine.aggregate({
      where: {
        accountId,
        journal: { date: dateFilter },
      },
      _sum: { debit: true, credit: true },
    });
    return {
      debit: agg._sum.debit || 0,
      credit: agg._sum.credit || 0,
    };
  };

  const [outCgst, outSgst, outIgst, inCgst, inSgst, inIgst] = await Promise.all([
    aggregateForAccount(accountIdMap[ACCOUNT_CODES.GST_OUTPUT_CGST]),
    aggregateForAccount(accountIdMap[ACCOUNT_CODES.GST_OUTPUT_SGST]),
    aggregateForAccount(accountIdMap[ACCOUNT_CODES.GST_OUTPUT_IGST]),
    aggregateForAccount(accountIdMap[ACCOUNT_CODES.GST_INPUT_CGST]),
    aggregateForAccount(accountIdMap[ACCOUNT_CODES.GST_INPUT_SGST]),
    aggregateForAccount(accountIdMap[ACCOUNT_CODES.GST_INPUT_IGST]),
  ]);

  // Output GST is credit-side (liability), Input GST is debit-side (asset)
  const outputCgst = outCgst.credit - outCgst.debit;
  const outputSgst = outSgst.credit - outSgst.debit;
  const outputIgst = outIgst.credit - outIgst.debit;
  const totalOutput = outputCgst + outputSgst + outputIgst;

  const inputCgst = inCgst.debit - inCgst.credit;
  const inputSgst = inSgst.debit - inSgst.credit;
  const inputIgst = inIgst.debit - inIgst.credit;
  const totalInput = inputCgst + inputSgst + inputIgst;

  const netPayable = totalOutput - totalInput;

  const round = (v: number): number => Math.round(v * 100) / 100;

  res.json({
    period: { from, to },
    output: {
      cgst: round(outputCgst),
      sgst: round(outputSgst),
      igst: round(outputIgst),
      total: round(totalOutput),
    },
    input: {
      cgst: round(inputCgst),
      sgst: round(inputSgst),
      igst: round(inputIgst),
      total: round(totalInput),
    },
    netPayable: round(netPayable),
  });
}));

// ═══════════════════════════════════════════════
// GET /cash-book — Cash account ledger with running balance
// ═══════════════════════════════════════════════
router.get('/cash-book', asyncHandler(async (req: AuthRequest, res: Response) => {
  const account = await getAccountByCode(ACCOUNT_CODES.CASH);
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const take = Math.min(parseInt(req.query.limit as string) || 200, 500);

  const ledger = await buildLedger(account.id, account.openingBalance, from, to, take);

  res.json({
    account: { id: account.id, code: account.code, name: account.name },
    openingBalance: account.openingBalance,
    ...ledger,
  });
}));

// ═══════════════════════════════════════════════
// GET /bank-book — Bank account ledger with running balance (supports multiple bank accounts)
// ═══════════════════════════════════════════════
router.get('/bank-book', asyncHandler(async (req: AuthRequest, res: Response) => {
  const accountId = req.query.accountId as string | undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const take = Math.min(parseInt(req.query.limit as string) || 200, 500);

  // If accountId provided, use that; otherwise default to primary bank (1002)
  let account: { id: string; code: string; name: string; openingBalance: number };
  if (accountId) {
    const found = await prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, code: true, name: true, openingBalance: true },
    });
    if (!found) throw new NotFoundError('Account', accountId);
    account = found;
  } else {
    account = await getAccountByCode(ACCOUNT_CODES.BANK);
  }

  const ledger = await buildLedger(account.id, account.openingBalance, from, to, take);

  res.json({
    account: { id: account.id, code: account.code, name: account.name },
    openingBalance: account.openingBalance,
    ...ledger,
  });
}));

// GET /bank-accounts — List all bank-type accounts for bank book selector
// ═══════════════════════════════════════════════
router.get('/bank-accounts', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const accounts = await prisma.account.findMany({
    where: {
      ...getCompanyFilter(_req),
      OR: [
        { subType: 'BANK' },
        { code: { startsWith: '100' } }, // 1001=Cash, 1002+=Bank accounts
      ],
      code: { not: '1001' }, // exclude cash (that's the cash book)
    },
    select: { id: true, code: true, name: true, openingBalance: true },
    orderBy: { code: 'asc' },
    take: 50,
  });
  res.json(accounts);
}));

// ═══════════════════════════════════════════════
// GET /customer-ledger/:customerId — Customer-wise ledger
// ═══════════════════════════════════════════════
router.get('/customer-ledger/:customerId', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { customerId } = req.params;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, name: true, gstNo: true, city: true },
  });
  if (!customer) throw new NotFoundError('Customer', customerId);

  const dateFilter: Record<string, Date> = {};
  if (from) dateFilter.gte = new Date(from);
  if (to) dateFilter.lte = new Date(to);

  // Invoices (debit entries)
  const invoices = await prisma.invoice.findMany({
    where: {
      ...getCompanyFilter(req),
      customerId,
      ...(Object.keys(dateFilter).length > 0 ? { invoiceDate: dateFilter } : {}),
    },
    take: 500,
    orderBy: { invoiceDate: 'asc' },
    select: {
      id: true,
      invoiceNo: true,
      invoiceDate: true,
      totalAmount: true,
      paidAmount: true,
      balanceAmount: true,
      productName: true,
      status: true,
    },
  });

  // Payments (credit entries)
  const payments = await prisma.payment.findMany({
    where: {
      ...getCompanyFilter(req),
      customerId,
      ...(Object.keys(dateFilter).length > 0 ? { paymentDate: dateFilter } : {}),
    },
    take: 500,
    orderBy: { paymentDate: 'asc' },
    select: {
      id: true,
      paymentNo: true,
      paymentDate: true,
      amount: true,
      mode: true,
      reference: true,
    },
  });

  // Merge and sort chronologically
  interface LedgerEntry {
    date: Date;
    type: 'INVOICE' | 'PAYMENT';
    ref: string;
    description: string;
    debit: number;
    credit: number;
    balance: number;
  }

  const entries: LedgerEntry[] = [];

  for (const inv of invoices) {
    entries.push({
      date: inv.invoiceDate,
      type: 'INVOICE',
      ref: `INV-${inv.invoiceNo}`,
      description: inv.productName || 'Sale',
      debit: inv.totalAmount,
      credit: 0,
      balance: 0,
    });
  }

  for (const pmt of payments) {
    entries.push({
      date: pmt.paymentDate,
      type: 'PAYMENT',
      ref: `PMT-${pmt.paymentNo}`,
      description: `${pmt.mode}${pmt.reference ? ` (${pmt.reference})` : ''}`,
      debit: 0,
      credit: pmt.amount,
      balance: 0,
    });
  }

  entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Running balance
  let balance = 0;
  for (const entry of entries) {
    balance = balance + entry.debit - entry.credit;
    entry.balance = Math.round(balance * 100) / 100;
  }

  res.json({
    customer,
    entries,
    closingBalance: Math.round(balance * 100) / 100,
  });
}));

// ═══════════════════════════════════════════════
// GET /vendor-ledger/:vendorId — Vendor-wise ledger
// ═══════════════════════════════════════════════
router.get('/vendor-ledger/:vendorId', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { vendorId } = req.params;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: { id: true, name: true, gstin: true, city: true },
  });
  if (!vendor) throw new NotFoundError('Vendor', vendorId);

  const dateFilter: Record<string, Date> = {};
  if (from) dateFilter.gte = new Date(from);
  if (to) dateFilter.lte = new Date(to);

  // Vendor invoices (debit entries — we owe them)
  const invoices = await prisma.vendorInvoice.findMany({
    where: {
      ...getCompanyFilter(req),
      vendorId,
      ...(Object.keys(dateFilter).length > 0 ? { invoiceDate: dateFilter } : {}),
    },
    take: 500,
    orderBy: { invoiceDate: 'asc' },
    select: {
      id: true,
      invoiceNo: true,
      invoiceDate: true,
      totalAmount: true,
      paidAmount: true,
      balanceAmount: true,
      productName: true,
      status: true,
    },
  });

  // Vendor payments (credit entries — reducing what we owe)
  const payments = await prisma.vendorPayment.findMany({
    where: {
      ...getCompanyFilter(req),
      vendorId,
      ...(Object.keys(dateFilter).length > 0 ? { paymentDate: dateFilter } : {}),
    },
    take: 500,
    orderBy: { paymentDate: 'asc' },
    select: {
      id: true,
      paymentNo: true,
      paymentDate: true,
      amount: true,
      mode: true,
      reference: true,
    },
  });

  interface LedgerEntry {
    date: Date;
    type: 'INVOICE' | 'PAYMENT';
    ref: string;
    description: string;
    debit: number;
    credit: number;
    balance: number;
  }

  const entries: LedgerEntry[] = [];

  for (const inv of invoices) {
    entries.push({
      date: inv.invoiceDate,
      type: 'INVOICE',
      ref: `VINV-${inv.invoiceNo}`,
      description: inv.productName || 'Purchase',
      debit: inv.totalAmount,
      credit: 0,
      balance: 0,
    });
  }

  for (const pmt of payments) {
    entries.push({
      date: pmt.paymentDate,
      type: 'PAYMENT',
      ref: `VPMT-${pmt.paymentNo}`,
      description: `${pmt.mode}${pmt.reference ? ` (${pmt.reference})` : ''}`,
      debit: 0,
      credit: pmt.amount,
      balance: 0,
    });
  }

  entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let balance = 0;
  for (const entry of entries) {
    balance = balance + entry.debit - entry.credit;
    entry.balance = Math.round(balance * 100) / 100;
  }

  res.json({
    vendor,
    entries,
    closingBalance: Math.round(balance * 100) / 100,
  });
}));

// ═══════════════════════════════════════════════
// GET /outstanding-receivables — Receivable summary
// ═══════════════════════════════════════════════
router.get('/outstanding-receivables', asyncHandler(async (req: AuthRequest, res: Response) => {
  const invoices = await prisma.invoice.findMany({
    where: { ...getCompanyFilter(req), status: { in: ['UNPAID', 'PARTIAL'] } },
    take: 500,
    select: {
      id: true,
      invoiceNo: true,
      invoiceDate: true,
      dueDate: true,
      totalAmount: true,
      balanceAmount: true,
      status: true,
      customerId: true,
      customer: { select: { id: true, name: true } },
    },
  });

  const now = Date.now();
  let totalReceivable = 0;
  let overdueAmount = 0;

  const customerBreakdown: Record<string, {
    customerId: string;
    customerName: string;
    outstanding: number;
    overdue: number;
    invoiceCount: number;
  }> = {};

  for (const inv of invoices) {
    totalReceivable += inv.balanceAmount;

    const isOverdue = inv.dueDate && new Date(inv.dueDate).getTime() < now;
    if (isOverdue) overdueAmount += inv.balanceAmount;

    if (!customerBreakdown[inv.customerId]) {
      customerBreakdown[inv.customerId] = {
        customerId: inv.customerId,
        customerName: inv.customer.name,
        outstanding: 0,
        overdue: 0,
        invoiceCount: 0,
      };
    }

    customerBreakdown[inv.customerId].outstanding += inv.balanceAmount;
    if (isOverdue) customerBreakdown[inv.customerId].overdue += inv.balanceAmount;
    customerBreakdown[inv.customerId].invoiceCount++;
  }

  const customers = Object.values(customerBreakdown)
    .map(c => ({
      ...c,
      outstanding: Math.round(c.outstanding * 100) / 100,
      overdue: Math.round(c.overdue * 100) / 100,
    }))
    .sort((a, b) => b.outstanding - a.outstanding);

  res.json({
    totalReceivable: Math.round(totalReceivable * 100) / 100,
    overdueAmount: Math.round(overdueAmount * 100) / 100,
    invoiceCount: invoices.length,
    customers,
  });
}));

// ═══════════════════════════════════════════════
// GET /outstanding-payables — Payable summary
// ═══════════════════════════════════════════════
router.get('/outstanding-payables', asyncHandler(async (req: AuthRequest, res: Response) => {
  const invoices = await prisma.vendorInvoice.findMany({
    where: { ...getCompanyFilter(req), balanceAmount: { gt: 0 } },
    take: 500,
    select: {
      id: true,
      invoiceNo: true,
      invoiceDate: true,
      dueDate: true,
      totalAmount: true,
      balanceAmount: true,
      status: true,
      vendorId: true,
      vendor: { select: { id: true, name: true } },
    },
  });

  const now = Date.now();
  let totalPayable = 0;
  let overdueAmount = 0;

  const vendorBreakdown: Record<string, {
    vendorId: string;
    vendorName: string;
    outstanding: number;
    overdue: number;
    invoiceCount: number;
  }> = {};

  for (const inv of invoices) {
    totalPayable += inv.balanceAmount;

    const isOverdue = inv.dueDate && new Date(inv.dueDate).getTime() < now;
    if (isOverdue) overdueAmount += inv.balanceAmount;

    if (!vendorBreakdown[inv.vendorId]) {
      vendorBreakdown[inv.vendorId] = {
        vendorId: inv.vendorId,
        vendorName: inv.vendor.name,
        outstanding: 0,
        overdue: 0,
        invoiceCount: 0,
      };
    }

    vendorBreakdown[inv.vendorId].outstanding += inv.balanceAmount;
    if (isOverdue) vendorBreakdown[inv.vendorId].overdue += inv.balanceAmount;
    vendorBreakdown[inv.vendorId].invoiceCount++;
  }

  const vendors = Object.values(vendorBreakdown)
    .map(v => ({
      ...v,
      outstanding: Math.round(v.outstanding * 100) / 100,
      overdue: Math.round(v.overdue * 100) / 100,
    }))
    .sort((a, b) => b.outstanding - a.outstanding);

  res.json({
    totalPayable: Math.round(totalPayable * 100) / 100,
    overdueAmount: Math.round(overdueAmount * 100) / 100,
    invoiceCount: invoices.length,
    vendors,
  });
}));

// GET /gst-documents — Document-level GST breakdown
router.get('/gst-documents', asyncHandler(async (req: AuthRequest, res: Response) => {
  const from = req.query.from as string;
  const to = req.query.to as string;
  if (!from || !to) { res.status(400).json({ error: 'from and to required' }); return; }
  const dateFilter = { gte: new Date(from), lte: new Date(to + 'T23:59:59.999Z') };
  const [salesInvoices, vendorInvoices, contractorBills] = await Promise.all([
    prisma.invoice.findMany({ where: { ...getCompanyFilter(req), invoiceDate: dateFilter, status: { not: 'CANCELLED' } }, select: { id: true, invoiceNo: true, invoiceDate: true, productName: true, supplyType: true, amount: true, gstPercent: true, gstAmount: true, cgstAmount: true, sgstAmount: true, igstAmount: true, totalAmount: true, customer: { select: { name: true, gstNo: true, state: true } } }, orderBy: { invoiceDate: 'desc' }, take: 500 }),
    prisma.vendorInvoice.findMany({ where: { ...getCompanyFilter(req), invoiceDate: dateFilter, status: { not: 'CANCELLED' } }, select: { id: true, invoiceNo: true, invoiceDate: true, supplyType: true, subtotal: true, gstPercent: true, totalGst: true, cgstAmount: true, sgstAmount: true, igstAmount: true, isRCM: true, itcEligible: true, itcClaimed: true, vendor: { select: { name: true, gstin: true } } }, orderBy: { invoiceDate: 'desc' }, take: 500 }),
    prisma.contractorBill.findMany({ where: { billDate: dateFilter, status: { not: 'CANCELLED' } }, select: { id: true, billNo: true, billDate: true, description: true, subtotal: true, cgstAmount: true, sgstAmount: true, igstAmount: true, totalAmount: true, itcEligible: true, itcClaimed: true, contractor: { select: { name: true, gstin: true } } }, orderBy: { billDate: 'desc' }, take: 500 }),
  ]);
  res.json({ salesInvoices, vendorInvoices, contractorBills });
}));

// GET /tds-summary — TDS deductions for Form 26Q
router.get('/tds-summary', asyncHandler(async (req: AuthRequest, res: Response) => {
  const from = req.query.from as string;
  const to = req.query.to as string;
  if (!from || !to) { res.status(400).json({ error: 'from and to required' }); return; }
  const dateFilter = { gte: new Date(from), lte: new Date(to + 'T23:59:59.999Z') };
  const [vendorPayments, contractorPayments] = await Promise.all([
    prisma.vendorPayment.findMany({
      where: { ...getCompanyFilter(req), paymentDate: dateFilter, tdsDeducted: { gt: 0 } },
      select: {
        id: true, paymentNo: true, paymentDate: true, amount: true, tdsDeducted: true, tdsSection: true, reference: true,
        vendor: { select: { name: true, pan: true, gstin: true } },
        invoice: { select: { id: true, invoiceNo: true, vendorInvNo: true, poId: true, po: { select: { id: true, poNo: true } } } },
      },
      orderBy: { paymentDate: 'desc' },
      take: 500,
    }),
    prisma.contractorPayment.findMany({
      where: { paymentDate: dateFilter, tdsDeducted: { gt: 0 } },
      select: {
        id: true, paymentDate: true, amount: true, tdsDeducted: true, paymentRef: true,
        bill: { select: { id: true, billNo: true, vendorBillNo: true, tdsPercent: true, contractor: { select: { name: true, pan: true, gstin: true, tdsSection: true } } } },
      },
      orderBy: { paymentDate: 'desc' },
      take: 500,
    }),
  ]);
  const sectionTotals: Record<string, { section: string; count: number; totalPayment: number; totalTds: number }> = {};
  for (const vp of vendorPayments) { const sec = vp.tdsSection || '194C'; if (!sectionTotals[sec]) sectionTotals[sec] = { section: sec, count: 0, totalPayment: 0, totalTds: 0 }; sectionTotals[sec].count++; sectionTotals[sec].totalPayment += vp.amount; sectionTotals[sec].totalTds += vp.tdsDeducted; }
  for (const cp of contractorPayments) { const sec = cp.bill?.contractor?.tdsSection || '194C'; if (!sectionTotals[sec]) sectionTotals[sec] = { section: sec, count: 0, totalPayment: 0, totalTds: 0 }; sectionTotals[sec].count++; sectionTotals[sec].totalPayment += cp.amount; sectionTotals[sec].totalTds += cp.tdsDeducted; }
  const getQuarter = (d: Date): string => { const m = d.getMonth(); if (m >= 3 && m <= 5) return 'Q1 (Apr-Jun)'; if (m >= 6 && m <= 8) return 'Q2 (Jul-Sep)'; if (m >= 9 && m <= 11) return 'Q3 (Oct-Dec)'; return 'Q4 (Jan-Mar)'; };
  const quarterTotals: Record<string, { quarter: string; totalTds: number; count: number }> = {};
  for (const vp of vendorPayments) { const q = getQuarter(vp.paymentDate); if (!quarterTotals[q]) quarterTotals[q] = { quarter: q, totalTds: 0, count: 0 }; quarterTotals[q].totalTds += vp.tdsDeducted; quarterTotals[q].count++; }
  for (const cp of contractorPayments) { const q = getQuarter(cp.paymentDate); if (!quarterTotals[q]) quarterTotals[q] = { quarter: q, totalTds: 0, count: 0 }; quarterTotals[q].totalTds += cp.tdsDeducted; quarterTotals[q].count++; }
  const tdsAccount = await prisma.account.findFirst({ where: { code: ACCOUNT_CODES.TDS_PAYABLE }, select: { id: true } });
  let tdsPayableBalance = 0;      // Net movement WITHIN selected period (period scoped)
  let tdsPayableAllTime = 0;      // Full all-time carry-forward (what we currently owe govt)
  if (tdsAccount) {
    const [periodAgg, allTimeAgg] = await Promise.all([
      prisma.journalLine.aggregate({
        where: { accountId: tdsAccount.id, journal: { date: dateFilter } },
        _sum: { debit: true, credit: true },
      }),
      prisma.journalLine.aggregate({
        where: { accountId: tdsAccount.id, journal: { date: { lte: dateFilter.lte } } },
        _sum: { debit: true, credit: true },
      }),
    ]);
    tdsPayableBalance = (periodAgg._sum.credit || 0) - (periodAgg._sum.debit || 0);
    tdsPayableAllTime = (allTimeAgg._sum.credit || 0) - (allTimeAgg._sum.debit || 0);
  }
  const round = (v: number): number => Math.round(v * 100) / 100;
  const deductees: Array<{
    name: string; pan: string | null; section: string; date: Date;
    paymentAmount: number; tdsAmount: number; source: string;
    paymentId: string; paymentNo: number | null; paymentRef: string | null;
    invoiceId: string | null; invoiceNo: number | null; vendorInvNo: string | null;
    poId: string | null; poNo: number | null;
    billId: string | null; billNo: number | null; vendorBillNo: string | null;
  }> = [];
  for (const vp of vendorPayments) {
    deductees.push({
      name: vp.vendor?.name || 'Unknown',
      pan: vp.vendor?.pan || null,
      section: vp.tdsSection || '194C',
      date: vp.paymentDate,
      paymentAmount: vp.amount,
      tdsAmount: vp.tdsDeducted,
      source: 'VENDOR',
      paymentId: vp.id,
      paymentNo: vp.paymentNo ?? null,
      paymentRef: vp.reference || null,
      invoiceId: vp.invoice?.id || null,
      invoiceNo: vp.invoice?.invoiceNo ?? null,
      vendorInvNo: vp.invoice?.vendorInvNo || null,
      poId: vp.invoice?.po?.id || null,
      poNo: vp.invoice?.po?.poNo ?? null,
      billId: null, billNo: null, vendorBillNo: null,
    });
  }
  for (const cp of contractorPayments) {
    deductees.push({
      name: cp.bill?.contractor?.name || 'Unknown',
      pan: cp.bill?.contractor?.pan || null,
      section: cp.bill?.contractor?.tdsSection || '194C',
      date: cp.paymentDate,
      paymentAmount: cp.amount,
      tdsAmount: cp.tdsDeducted,
      source: 'CONTRACTOR',
      paymentId: cp.id,
      paymentNo: null,
      paymentRef: cp.paymentRef || null,
      invoiceId: null, invoiceNo: null, vendorInvNo: null,
      poId: null, poNo: null,
      billId: cp.bill?.id || null,
      billNo: cp.bill?.billNo ?? null,
      vendorBillNo: cp.bill?.vendorBillNo || null,
    });
  }
  // ── PO-stage projection: open POs with TDS configured (vendor.tdsApplicable OR PO.overrideTdsSection) ──
  const projectedPOs = await prisma.purchaseOrder.findMany({
    where: { ...getCompanyFilter(req), poDate: dateFilter, status: { notIn: ['CANCELLED', 'CLOSED'] } },
    select: {
      id: true, poNo: true, poDate: true, grandTotal: true, subtotal: true, status: true,
      tdsApplicable: true, tdsAmount: true,
      vendor: { select: { id: true, name: true, pan: true, tdsApplicable: true, tdsSection: true, tdsPercent: true, tdsSectionRef: { select: { newSection: true, rateOthers: true, rateIndividual: true } } } },
      overrideTdsSection: { select: { newSection: true, rateOthers: true } },
    },
    orderBy: { poDate: 'desc' },
    take: 500,
  });
  const projectedTdsPOs = projectedPOs.filter(p => p.tdsApplicable || p.tdsAmount > 0 || p.vendor?.tdsApplicable || p.vendor?.tdsSection || p.vendor?.tdsSectionRef);
  const projection = projectedTdsPOs.map(p => ({
    poId: p.id, poNo: p.poNo, poDate: p.poDate, vendor: p.vendor?.name, status: p.status,
    grandTotal: round(p.grandTotal),
    section: p.overrideTdsSection?.newSection || p.vendor?.tdsSectionRef?.newSection || p.vendor?.tdsSection || null,
    rate: p.overrideTdsSection?.rateOthers || p.vendor?.tdsSectionRef?.rateOthers || p.vendor?.tdsPercent || 0,
    expectedTds: round(p.tdsAmount || ((p.subtotal || 0) * ((p.overrideTdsSection?.rateOthers || p.vendor?.tdsSectionRef?.rateOthers || p.vendor?.tdsPercent || 0) / 100))),
  })).filter(p => p.expectedTds > 0);

  // ── Vendor-master health: how many vendors are missing TDS configuration ──
  const totalActiveVendors = await prisma.vendor.count({ where: { ...getCompanyFilter(req), isActive: true } });
  const vendorsWithTds = await prisma.vendor.count({ where: { ...getCompanyFilter(req), isActive: true, OR: [{ tdsApplicable: true }, { tdsSection: { not: null } }, { tdsSectionId: { not: null } }] } });

  res.json({
    period: { from, to },
    bySections: Object.values(sectionTotals).map(s => ({ ...s, totalPayment: round(s.totalPayment), totalTds: round(s.totalTds) })),
    byQuarter: Object.values(quarterTotals).map(q => ({ ...q, totalTds: round(q.totalTds) })),
    deductees: deductees.sort((a, b) => b.date.getTime() - a.date.getTime()),
    tdsPayableBalance: round(tdsPayableBalance),
    tdsPayableAllTime: round(tdsPayableAllTime),
    totalDeducted: round(deductees.reduce((s, d) => s + d.tdsAmount, 0)),
    projection,
    projectionTotal: round(projection.reduce((s, p) => s + p.expectedTds, 0)),
    vendorHealth: { totalActive: totalActiveVendors, withTdsConfig: vendorsWithTds, missingTdsConfig: totalActiveVendors - vendorsWithTds },
  });
}));

// GET /tcs-summary — TCS collected u/s 206C (scrap, high-value sales)
router.get('/tcs-summary', asyncHandler(async (req: AuthRequest, res: Response) => {
  const from = req.query.from as string;
  const to = req.query.to as string;
  if (!from || !to) { res.status(400).json({ error: 'from and to required' }); return; }
  const dateFilter = { gte: new Date(from), lte: new Date(to + 'T23:59:59.999Z') };
  const round = (v: number): number => Math.round(v * 100) / 100;

  const invoices = await prisma.invoice.findMany({
    where: { ...getCompanyFilter(req), invoiceDate: dateFilter, tcsAmount: { gt: 0 }, status: { not: 'CANCELLED' } },
    select: {
      id: true, invoiceNo: true, invoiceDate: true, amount: true, gstAmount: true,
      tcsPercent: true, tcsAmount: true, tcsSection: true, totalAmount: true, paidAmount: true,
      customer: { select: { name: true, gstNo: true, panNo: true } },
    },
    orderBy: { invoiceDate: 'desc' },
    take: 500,
  });

  // By section
  const sectionTotals: Record<string, { section: string; count: number; totalAmount: number; totalTcs: number }> = {};
  for (const inv of invoices) {
    const sec = inv.tcsSection || 'UNCLASSIFIED';
    if (!sectionTotals[sec]) sectionTotals[sec] = { section: sec, count: 0, totalAmount: 0, totalTcs: 0 };
    sectionTotals[sec].count++;
    sectionTotals[sec].totalAmount += inv.amount;
    sectionTotals[sec].totalTcs += inv.tcsAmount;
  }

  // By quarter
  const getQuarter = (d: Date): string => { const m = d.getMonth(); if (m >= 3 && m <= 5) return 'Q1 (Apr-Jun)'; if (m >= 6 && m <= 8) return 'Q2 (Jul-Sep)'; if (m >= 9 && m <= 11) return 'Q3 (Oct-Dec)'; return 'Q4 (Jan-Mar)'; };
  const quarterTotals: Record<string, { quarter: string; totalTcs: number; count: number }> = {};
  for (const inv of invoices) {
    const q = getQuarter(inv.invoiceDate);
    if (!quarterTotals[q]) quarterTotals[q] = { quarter: q, totalTcs: 0, count: 0 };
    quarterTotals[q].totalTcs += inv.tcsAmount;
    quarterTotals[q].count++;
  }

  // Ledger balance — period-scoped + all-time as-of-to-date
  const tcsAccount = await prisma.account.findFirst({ where: { code: ACCOUNT_CODES.TCS_PAYABLE_206C }, select: { id: true } });
  let tcsPayableBalance = 0;
  let tcsPayableAllTime = 0;
  if (tcsAccount) {
    const [periodAgg, allTimeAgg] = await Promise.all([
      prisma.journalLine.aggregate({ where: { accountId: tcsAccount.id, journal: { date: dateFilter } }, _sum: { debit: true, credit: true } }),
      prisma.journalLine.aggregate({ where: { accountId: tcsAccount.id, journal: { date: { lte: dateFilter.lte } } }, _sum: { debit: true, credit: true } }),
    ]);
    tcsPayableBalance = (periodAgg._sum.credit || 0) - (periodAgg._sum.debit || 0);
    tcsPayableAllTime = (allTimeAgg._sum.credit || 0) - (allTimeAgg._sum.debit || 0);
  }

  res.json({
    period: { from, to },
    bySections: Object.values(sectionTotals).map(s => ({ ...s, totalAmount: round(s.totalAmount), totalTcs: round(s.totalTcs) })),
    byQuarter: Object.values(quarterTotals).map(q => ({ ...q, totalTcs: round(q.totalTcs) })),
    invoices: invoices.map(inv => ({
      id: inv.id, invoiceNo: inv.invoiceNo, invoiceDate: inv.invoiceDate,
      customer: inv.customer?.name || 'Unknown',
      gstin: inv.customer?.gstNo || null,
      pan: inv.customer?.panNo || null,
      taxableAmount: round(inv.amount),
      tcsSection: inv.tcsSection || null,
      tcsPercent: inv.tcsPercent,
      tcsAmount: round(inv.tcsAmount),
      totalAmount: round(inv.totalAmount),
      paidAmount: round(inv.paidAmount),
    })),
    tcsPayableBalance: round(tcsPayableBalance),
    tcsPayableAllTime: round(tcsPayableAllTime),
    totalCollected: round(invoices.reduce((s, i) => s + i.tcsAmount, 0)),
    invoiceCount: invoices.length,
  });
}));

// GET /itc-register — Input Tax Credit register
router.get('/itc-register', asyncHandler(async (req: AuthRequest, res: Response) => {
  const from = req.query.from as string;
  const to = req.query.to as string;
  const status = req.query.status as string;
  if (!from || !to) { res.status(400).json({ error: 'from and to required' }); return; }
  const dateFilter = { gte: new Date(from), lte: new Date(to + 'T23:59:59.999Z') };
  const viWhere: any = { ...getCompanyFilter(req), invoiceDate: dateFilter, status: { not: 'CANCELLED' } };
  if (status === 'eligible') { viWhere.itcEligible = true; viWhere.itcClaimed = false; viWhere.itcReversed = false; }
  else if (status === 'claimed') { viWhere.itcClaimed = true; }
  else if (status === 'reversed') { viWhere.itcReversed = true; }
  const cbWhere: any = { billDate: dateFilter, status: { notIn: ['CANCELLED', 'DRAFT'] } };
  if (status === 'eligible') { cbWhere.itcEligible = true; cbWhere.itcClaimed = false; cbWhere.itcReversed = false; }
  else if (status === 'claimed') { cbWhere.itcClaimed = true; }
  else if (status === 'reversed') { cbWhere.itcReversed = true; }
  const [vendorInvoices, contractorBills] = await Promise.all([
    prisma.vendorInvoice.findMany({ where: viWhere, select: { id: true, invoiceNo: true, invoiceDate: true, subtotal: true, cgstAmount: true, sgstAmount: true, igstAmount: true, totalGst: true, isRCM: true, itcEligible: true, itcClaimed: true, itcClaimedDate: true, itcReversed: true, itcReversalReason: true, vendor: { select: { name: true, gstin: true } } }, orderBy: { invoiceDate: 'desc' }, take: 500 }),
    prisma.contractorBill.findMany({ where: cbWhere, select: { id: true, billNo: true, billDate: true, description: true, subtotal: true, cgstAmount: true, sgstAmount: true, igstAmount: true, itcEligible: true, itcClaimed: true, itcClaimedDate: true, itcReversed: true, itcReversalReason: true, contractor: { select: { name: true, gstin: true } } }, orderBy: { billDate: 'desc' }, take: 500 }),
  ]);
  const round = (v: number): number => Math.round(v * 100) / 100;
  const viT = vendorInvoices.reduce((s: any, v: any) => ({ cgst: s.cgst + (v.itcEligible ? (v.cgstAmount || 0) : 0), sgst: s.sgst + (v.itcEligible ? (v.sgstAmount || 0) : 0), igst: s.igst + (v.itcEligible ? (v.igstAmount || 0) : 0) }), { cgst: 0, sgst: 0, igst: 0 });
  const cbT = contractorBills.reduce((s: any, c: any) => ({ cgst: s.cgst + (c.itcEligible ? (c.cgstAmount || 0) : 0), sgst: s.sgst + (c.itcEligible ? (c.sgstAmount || 0) : 0), igst: s.igst + (c.itcEligible ? (c.igstAmount || 0) : 0) }), { cgst: 0, sgst: 0, igst: 0 });
  res.json({ period: { from, to }, vendorInvoices, contractorBills, totals: { eligibleCgst: round(viT.cgst + cbT.cgst), eligibleSgst: round(viT.sgst + cbT.sgst), eligibleIgst: round(viT.igst + cbT.igst), eligibleTotal: round(viT.cgst + cbT.cgst + viT.sgst + cbT.sgst + viT.igst + cbT.igst), claimedCount: vendorInvoices.filter((v: any) => v.itcClaimed).length + contractorBills.filter((c: any) => c.itcClaimed).length, unclaimedCount: vendorInvoices.filter((v: any) => v.itcEligible && !v.itcClaimed).length + contractorBills.filter((c: any) => c.itcEligible && !c.itcClaimed).length } });
}));

// POST /itc-claim — Bulk mark ITC as claimed (transactional, excludes draft/reversed)
router.post('/itc-claim', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { vendorInvoiceIds, contractorBillIds } = req.body;
  if (!vendorInvoiceIds?.length && !contractorBillIds?.length) { res.status(400).json({ error: 'No IDs provided' }); return; }
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    let updated = 0;
    if (vendorInvoiceIds?.length > 0) {
      const r = await tx.vendorInvoice.updateMany({ where: { id: { in: vendorInvoiceIds }, itcEligible: true, itcClaimed: false, itcReversed: false, status: { in: ['VERIFIED', 'APPROVED', 'PAID'] } }, data: { itcClaimed: true, itcClaimedDate: now } });
      updated += r.count;
    }
    if (contractorBillIds?.length > 0) {
      const r = await tx.contractorBill.updateMany({ where: { id: { in: contractorBillIds }, itcEligible: true, itcClaimed: false, itcReversed: false, status: { in: ['CONFIRMED', 'PARTIAL_PAID', 'PAID'] } }, data: { itcClaimed: true, itcClaimedDate: now } });
      updated += r.count;
    }
    return updated;
  });
  res.json({ updated: result });
}));

export default router;
