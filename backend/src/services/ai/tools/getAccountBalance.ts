import prisma from '../../../config/prisma';
import type { AIFeature } from '../types';

export const getAccountBalance: AIFeature = {
  id: 'chat.tool.get_account_balance',
  kind: 'CHAT_TOOL',
  module: 'accounts',
  title: 'Get GL Account Balance',
  description: 'Returns the current Dr/Cr balance of any GL account by name or code. Use when user asks "what is the balance of X account", "TDS payable balance", "how much in HDFC bank", etc.',
  parameters: [
    { name: 'accountQuery', type: 'string', required: true, description: 'Account name fuzzy match or exact 4-digit code (e.g. "HDFC", "TDS Payable", "2200")' },
  ],
  examplePrompt: 'TDS payable balance?',
  async execute(args) {
    const q = String(args.accountQuery).trim();
    const accounts = await prisma.account.findMany({
      where: {
        OR: [
          { code: { equals: q } },
          { name: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true, code: true, name: true, type: true, openingBalance: true },
      take: 10,
    });

    const out: Array<{ code: string; name: string; type: string; opening: number; debits: number; credits: number; balance: number }> = [];
    for (const a of accounts) {
      const agg = await prisma.journalLine.aggregate({
        where: { accountId: a.id },
        _sum: { debit: true, credit: true },
      });
      const debits = agg._sum.debit || 0;
      const credits = agg._sum.credit || 0;
      // For LIABILITY/EQUITY/INCOME: balance = credits - debits + opening (Cr positive)
      // For ASSET/EXPENSE: balance = debits - credits + opening (Dr positive)
      const isCreditNature = a.type === 'LIABILITY' || a.type === 'EQUITY' || a.type === 'INCOME';
      const balance = isCreditNature ? (credits - debits + a.openingBalance) : (debits - credits + a.openingBalance);
      out.push({ code: a.code, name: a.name, type: a.type, opening: a.openingBalance, debits, credits, balance });
    }

    return {
      query: q,
      matchCount: out.length,
      accounts: out,
    };
  },
};
