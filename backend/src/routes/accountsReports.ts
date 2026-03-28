import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { NotFoundError } from '../shared/errors';
import prisma from '../config/prisma';

const router = Router();

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
    where: { status: { in: ['UNPAID', 'PARTIAL'] } },
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
    where: { balanceAmount: { gt: 0 } },
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
// GET /bank-book — Bank account ledger with running balance
// ═══════════════════════════════════════════════
router.get('/bank-book', asyncHandler(async (req: AuthRequest, res: Response) => {
  const account = await getAccountByCode(ACCOUNT_CODES.BANK);
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
    where: { status: { in: ['UNPAID', 'PARTIAL'] } },
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
    where: { balanceAmount: { gt: 0 } },
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

export default router;
