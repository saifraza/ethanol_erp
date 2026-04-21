import prisma from '../../../config/prisma';
import type { AIFeature } from '../types';

export const searchInvoices: AIFeature = {
  id: 'chat.tool.search_invoices',
  kind: 'CHAT_TOOL',
  module: 'sales',
  title: 'Search Invoices (Sales)',
  description: 'Search outgoing sales invoices by customer name, invoice number, or date range. Returns invoice summary with payment status. Use when user asks about sales invoices, customer billing, or "what we sent to X".',
  parameters: [
    { name: 'customerName', type: 'string', required: false, description: 'Optional fuzzy customer name match' },
    { name: 'invoiceNo', type: 'string', required: false, description: 'Optional exact invoice number (digits)' },
    { name: 'from', type: 'date', required: false, description: 'Optional date range start YYYY-MM-DD' },
    { name: 'to', type: 'date', required: false, description: 'Optional date range end YYYY-MM-DD' },
    { name: 'unpaidOnly', type: 'boolean', required: false, description: 'Only show invoices with balance > 0' },
  ],
  examplePrompt: 'Show me unpaid invoices for HPCL this month',
  async execute(args) {
    const where: Record<string, unknown> = { status: { not: 'CANCELLED' } };
    if (args.customerName) where.customer = { name: { contains: String(args.customerName), mode: 'insensitive' } };
    if (args.invoiceNo) where.invoiceNo = parseInt(String(args.invoiceNo), 10);
    if (args.from || args.to) {
      const range: Record<string, Date> = {};
      if (args.from) range.gte = new Date(String(args.from));
      if (args.to) range.lte = new Date(String(args.to) + 'T23:59:59.999Z');
      where.invoiceDate = range;
    }
    if (args.unpaidOnly) where.balanceAmount = { gt: 0 };

    const invoices = await prisma.invoice.findMany({
      where,
      select: {
        invoiceNo: true, invoiceDate: true, totalAmount: true, paidAmount: true,
        customer: { select: { name: true, gstNo: true } },
        irn: true, status: true,
      },
      take: 25,
      orderBy: { invoiceDate: 'desc' },
    });

    return {
      count: invoices.length,
      totalAmount: invoices.reduce((s, i) => s + i.totalAmount, 0),
      totalPaid: invoices.reduce((s, i) => s + i.paidAmount, 0),
      totalOutstanding: invoices.reduce((s, i) => s + (i.totalAmount - i.paidAmount), 0),
      invoices: invoices.map(i => ({
        invoiceNo: `INV-${i.invoiceNo}`,
        date: i.invoiceDate.toISOString().slice(0, 10),
        customer: i.customer?.name,
        gstin: i.customer?.gstNo,
        total: i.totalAmount,
        paid: i.paidAmount,
        balance: i.totalAmount - i.paidAmount,
        status: i.status,
        hasIrn: !!i.irn,
      })),
    };
  },
};
