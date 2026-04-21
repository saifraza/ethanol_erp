import prisma from '../../../config/prisma';
import type { AIFeature } from '../types';

export const getOutstandingPayables: AIFeature = {
  id: 'chat.tool.get_outstanding_payables',
  kind: 'CHAT_TOOL',
  module: 'accounts',
  title: 'Get Outstanding Payables',
  description: 'List vendor invoices and contractor bills with outstanding balance (we owe money). Use when user asks "who do we owe", "pending payments", "payables", "outstanding to vendors".',
  parameters: [
    { name: 'vendorName', type: 'string', required: false, description: 'Optional fuzzy vendor name filter' },
    { name: 'minBalance', type: 'number', required: false, description: 'Optional minimum outstanding amount (e.g. 100000 for ₹1L+)' },
  ],
  examplePrompt: 'Who do we owe more than 5 lakhs?',
  async execute(args) {
    const minBalance = args.minBalance ? Number(args.minBalance) : 0;
    const where: Record<string, unknown> = { balanceAmount: { gt: minBalance } };
    if (args.vendorName) where.vendor = { name: { contains: String(args.vendorName), mode: 'insensitive' } };

    const vendorInvoices = await prisma.vendorInvoice.findMany({
      where,
      select: {
        invoiceNo: true, vendorInvNo: true, invoiceDate: true, dueDate: true,
        netPayable: true, paidAmount: true, balanceAmount: true,
        vendor: { select: { name: true, gstin: true } },
      },
      take: 50,
      orderBy: { balanceAmount: 'desc' },
    });

    const byVendor: Record<string, { vendor: string; invoiceCount: number; totalOutstanding: number }> = {};
    for (const v of vendorInvoices) {
      const k = v.vendor?.name || 'Unknown';
      if (!byVendor[k]) byVendor[k] = { vendor: k, invoiceCount: 0, totalOutstanding: 0 };
      byVendor[k].invoiceCount++;
      byVendor[k].totalOutstanding += v.balanceAmount;
    }

    return {
      totalOutstanding: vendorInvoices.reduce((s, i) => s + i.balanceAmount, 0),
      vendorCount: Object.keys(byVendor).length,
      invoiceCount: vendorInvoices.length,
      byVendor: Object.values(byVendor).sort((a, b) => b.totalOutstanding - a.totalOutstanding),
      topInvoices: vendorInvoices.slice(0, 10).map(v => ({
        invoiceNo: `INV-${v.invoiceNo}`,
        vendorInvNo: v.vendorInvNo,
        vendor: v.vendor?.name,
        date: v.invoiceDate.toISOString().slice(0, 10),
        dueDate: v.dueDate?.toISOString().slice(0, 10) || null,
        netPayable: v.netPayable,
        paid: v.paidAmount,
        balance: v.balanceAmount,
      })),
    };
  },
};
