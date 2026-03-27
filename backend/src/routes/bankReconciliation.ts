import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { NotFoundError } from '../shared/errors';
import { z } from 'zod';
import prisma from '../config/prisma';
import { randomUUID } from 'crypto';

const router = Router();

// ═══════════════════════════════════════════════
// Zod Schemas
// ═══════════════════════════════════════════════

const importSchema = z.object({
  accountId: z.string().min(1),
  transactions: z.array(z.object({
    date: z.string().min(1),
    description: z.string().min(1),
    refNo: z.string().optional(),
    debit: z.number().min(0).default(0),
    credit: z.number().min(0).default(0),
    balance: z.number().default(0),
  })).min(1),
});

const matchSchema = z.object({
  bankTransactionId: z.string().min(1).optional(),
  journalEntryId: z.string().min(1),
});

const autoMatchSchema = z.object({
  accountId: z.string().min(1),
});

// ═══════════════════════════════════════════════
// GET / — List bank transactions (paginated, filterable)
// ═══════════════════════════════════════════════
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const take = Math.min(parseInt(req.query.limit as string) || 50, 500);
  const skip = parseInt(req.query.offset as string) || 0;
  const accountId = req.query.accountId as string | undefined;
  const isReconciled = req.query.isReconciled as string | undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  const where: Record<string, unknown> = {};
  if (accountId) where.accountId = accountId;
  if (isReconciled === 'true') where.isReconciled = true;
  if (isReconciled === 'false') where.isReconciled = false;
  if (from || to) {
    where.date = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }

  const [items, total] = await Promise.all([
    prisma.bankTransaction.findMany({
      where,
      take,
      skip,
      orderBy: { date: 'desc' },
      select: {
        id: true,
        accountId: true,
        date: true,
        description: true,
        refNo: true,
        debit: true,
        credit: true,
        balance: true,
        isReconciled: true,
        reconciledWith: true,
        importBatch: true,
        createdAt: true,
        account: { select: { id: true, code: true, name: true } },
      },
    }),
    prisma.bankTransaction.count({ where }),
  ]);

  // Enrich reconciled items with journal entry details
  const reconciledJournalIds = items
    .filter(i => i.reconciledWith)
    .map(i => i.reconciledWith as string);

  const journalMap = new Map<string, { id: string; entryNo: number; date: Date; narration: string }>();
  if (reconciledJournalIds.length > 0) {
    const journals = await prisma.journalEntry.findMany({
      where: { id: { in: reconciledJournalIds } },
      select: { id: true, entryNo: true, date: true, narration: true },
    });
    for (const j of journals) journalMap.set(j.id, j);
  }

  const enriched = items.map(i => ({
    ...i,
    journalEntryId: i.reconciledWith || null,
    journalEntry: i.reconciledWith ? journalMap.get(i.reconciledWith) || null : null,
  }));

  res.json({ items: enriched, total });
}));

// ═══════════════════════════════════════════════
// GET /summary/:accountId — Reconciliation summary
// ═══════════════════════════════════════════════
router.get('/summary/:accountId', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { accountId } = req.params;

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) throw new NotFoundError('Account', accountId);

  // Book balance: sum of debits - credits from journal lines for this account
  const journalAgg = await prisma.journalLine.aggregate({
    where: { accountId },
    _sum: { debit: true, credit: true },
  });
  const bookBalance = (journalAgg._sum.debit || 0) - (journalAgg._sum.credit || 0) + account.openingBalance;

  // Bank balance: latest balance from bank transactions, or sum of credits - debits
  const latestTxn = await prisma.bankTransaction.findFirst({
    where: { accountId },
    orderBy: { date: 'desc' },
    select: { balance: true },
  });
  const bankAgg = await prisma.bankTransaction.aggregate({
    where: { accountId },
    _sum: { debit: true, credit: true },
  });
  const bankBalance = latestTxn?.balance ?? ((bankAgg._sum.credit || 0) - (bankAgg._sum.debit || 0));

  const [unreconciledCount, matchedCount, totalCount] = await Promise.all([
    prisma.bankTransaction.count({ where: { accountId, isReconciled: false } }),
    prisma.bankTransaction.count({ where: { accountId, isReconciled: true } }),
    prisma.bankTransaction.count({ where: { accountId } }),
  ]);

  res.json({
    accountId,
    accountName: account.name,
    accountCode: account.code,
    bookBalance: Math.round(bookBalance * 100) / 100,
    bankBalance: Math.round((typeof bankBalance === 'number' ? bankBalance : 0) * 100) / 100,
    difference: Math.round((bookBalance - (typeof bankBalance === 'number' ? bankBalance : 0)) * 100) / 100,
    unreconciledCount,
    matchedCount,
    totalCount,
  });
}));

// ═══════════════════════════════════════════════
// POST /import — Import bank statement transactions
// ═══════════════════════════════════════════════
router.post('/import', validate(importSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { accountId, transactions } = req.body;

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) throw new NotFoundError('Account', accountId);

  const importBatch = randomUUID();

  const data = transactions.map((t: {
    date: string;
    description: string;
    refNo?: string;
    debit: number;
    credit: number;
    balance: number;
  }) => ({
    accountId,
    date: new Date(t.date),
    description: t.description,
    refNo: t.refNo || null,
    debit: t.debit,
    credit: t.credit,
    balance: t.balance,
    importBatch,
    isReconciled: false,
  }));

  const result = await prisma.bankTransaction.createMany({ data });

  res.status(201).json({
    count: result.count,
    importBatch,
    accountId,
  });
}));

// ═══════════════════════════════════════════════
// GET /journal-suggestions — Suggest journal entries for matching a bank txn
// ═══════════════════════════════════════════════
router.get('/journal-suggestions', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { accountId, amount, date } = req.query;

  const where: Record<string, unknown> = {};
  if (accountId) where.accountId = accountId as string;

  // Find journal lines with matching amount (±1% tolerance) and nearby date (±7 days)
  const txnAmount = parseFloat(amount as string) || 0;
  const txnDate = date ? new Date(date as string) : new Date();
  const toleranceMs = 7 * 24 * 60 * 60 * 1000;

  // Get already-matched journal IDs to exclude
  const matched = await prisma.bankTransaction.findMany({
    where: { isReconciled: true, reconciledWith: { not: null } },
    select: { reconciledWith: true },
    take: 500,
  });
  const matchedIds = new Set(matched.map(m => m.reconciledWith).filter(Boolean) as string[]);

  const lines = await prisma.journalLine.findMany({
    where: accountId ? { accountId: accountId as string } : {},
    take: 200,
    select: {
      debit: true,
      credit: true,
      journal: { select: { id: true, entryNo: true, date: true, narration: true, refId: true } },
    },
  });

  const suggestions = lines
    .filter(l => !matchedIds.has(l.journal.id))
    .filter(l => {
      const lineAmount = Math.max(l.debit, l.credit);
      if (txnAmount > 0 && Math.abs(lineAmount - txnAmount) / txnAmount > 0.01) return false;
      const lineDate = new Date(l.journal.date).getTime();
      return Math.abs(lineDate - txnDate.getTime()) <= toleranceMs;
    })
    .map(l => ({
      id: l.journal.id,
      entryNo: l.journal.entryNo,
      date: l.journal.date,
      narration: l.journal.narration,
      amount: Math.max(l.debit, l.credit),
      refId: l.journal.refId,
    }))
    // Deduplicate by journal id
    .filter((v, i, arr) => arr.findIndex(x => x.id === v.id) === i)
    .slice(0, 20);

  res.json(suggestions);
}));

// ═══════════════════════════════════════════════
// POST /:id/match — Match a specific bank txn to a journal entry (frontend-friendly URL)
// ═══════════════════════════════════════════════
router.post('/:id/match', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { journalEntryId } = req.body;
  if (!journalEntryId) {
    res.status(400).json({ error: 'journalEntryId is required' });
    return;
  }

  const bankTxn = await prisma.bankTransaction.findUnique({ where: { id: req.params.id } });
  if (!bankTxn) throw new NotFoundError('BankTransaction', req.params.id);

  const journalEntry = await prisma.journalEntry.findUnique({ where: { id: journalEntryId } });
  if (!journalEntry) throw new NotFoundError('JournalEntry', journalEntryId);

  if (bankTxn.isReconciled) {
    res.status(400).json({ error: 'Bank transaction is already reconciled' });
    return;
  }

  const updated = await prisma.bankTransaction.update({
    where: { id: req.params.id },
    data: { isReconciled: true, reconciledWith: journalEntryId },
  });

  res.json({ success: true, bankTransaction: updated });
}));

// ═══════════════════════════════════════════════
// POST /match — Manual match (body-based, kept for backward compat)
// ═══════════════════════════════════════════════
router.post('/match', validate(matchSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { bankTransactionId, journalEntryId } = req.body;
  if (!bankTransactionId) {
    res.status(400).json({ error: 'bankTransactionId is required' });
    return;
  }

  const bankTxn = await prisma.bankTransaction.findUnique({ where: { id: bankTransactionId } });
  if (!bankTxn) throw new NotFoundError('BankTransaction', bankTransactionId);

  const journalEntry = await prisma.journalEntry.findUnique({ where: { id: journalEntryId } });
  if (!journalEntry) throw new NotFoundError('JournalEntry', journalEntryId);

  if (bankTxn.isReconciled) {
    res.status(400).json({ error: 'Bank transaction is already reconciled' });
    return;
  }

  const updated = await prisma.bankTransaction.update({
    where: { id: bankTransactionId },
    data: { isReconciled: true, reconciledWith: journalEntryId },
  });

  res.json({ success: true, bankTransaction: updated });
}));

// ═══════════════════════════════════════════════
// POST /auto-match — Auto-match unreconciled transactions
// ═══════════════════════════════════════════════
router.post('/auto-match', validate(autoMatchSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { accountId } = req.body;

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) throw new NotFoundError('Account', accountId);

  // Get unreconciled bank transactions
  const unreconciled = await prisma.bankTransaction.findMany({
    where: { accountId, isReconciled: false },
    take: 500,
    select: {
      id: true,
      date: true,
      refNo: true,
      debit: true,
      credit: true,
      description: true,
    },
  });

  if (unreconciled.length === 0) {
    res.json({ matchedCount: 0, unmatchedCount: 0, unmatched: [] });
    return;
  }

  // Get unmatched journal lines for this account (those not yet linked to any bank txn)
  const reconciledJournalIds = await prisma.bankTransaction.findMany({
    where: { accountId, isReconciled: true, reconciledWith: { not: null } },
    select: { reconciledWith: true },
    take: 500,
  });
  const matchedJournalIdSet = new Set(
    reconciledJournalIds.map(r => r.reconciledWith).filter(Boolean) as string[]
  );

  const journalLines = await prisma.journalLine.findMany({
    where: { accountId },
    take: 500,
    select: {
      id: true,
      journalId: true,
      debit: true,
      credit: true,
      journal: {
        select: {
          id: true,
          date: true,
          refId: true,
          narration: true,
        },
      },
    },
  });

  // Filter out already-matched journal entries
  const unmatchedLines = journalLines.filter(l => !matchedJournalIdSet.has(l.journal.id));

  let matchedCount = 0;
  const updates: { bankTxnId: string; journalId: string }[] = [];
  const usedJournalIds = new Set<string>();

  for (const txn of unreconciled) {
    const txnAmount = txn.debit > 0 ? txn.debit : txn.credit;
    if (txnAmount === 0) continue;

    // Strategy 1: Match by refNo/UTR (exact match on journal refId or narration containing refNo)
    if (txn.refNo) {
      const refMatch = unmatchedLines.find(l =>
        !usedJournalIds.has(l.journal.id) &&
        (l.journal.refId === txn.refNo || l.journal.narration?.includes(txn.refNo!))
      );
      if (refMatch) {
        updates.push({ bankTxnId: txn.id, journalId: refMatch.journal.id });
        usedJournalIds.add(refMatch.journal.id);
        matchedCount++;
        continue;
      }
    }

    // Strategy 2: Match by amount + date (within 2 days tolerance)
    const txnDate = new Date(txn.date).getTime();
    const toleranceMs = 2 * 24 * 60 * 60 * 1000; // 2 days

    const amountMatch = unmatchedLines.find(l => {
      if (usedJournalIds.has(l.journal.id)) return false;
      // Bank debit = book credit (payment out), bank credit = book debit (receipt in)
      const lineAmount = txn.debit > 0 ? l.credit : l.debit;
      if (Math.abs(lineAmount - txnAmount) > 0.01) return false;
      const lineDate = new Date(l.journal.date).getTime();
      return Math.abs(txnDate - lineDate) <= toleranceMs;
    });

    if (amountMatch) {
      updates.push({ bankTxnId: amountMatch.id, journalId: amountMatch.journal.id });
      usedJournalIds.add(amountMatch.journal.id);
      matchedCount++;
    }
  }

  // Apply matches in a transaction
  if (updates.length > 0) {
    await prisma.$transaction(
      updates.map(u =>
        prisma.bankTransaction.update({
          where: { id: u.bankTxnId },
          data: { isReconciled: true, reconciledWith: u.journalId },
        })
      )
    );
  }

  const unmatchedTxns = unreconciled.filter(
    txn => !updates.some(u => u.bankTxnId === txn.id)
  );

  res.json({
    matchedCount,
    unmatchedCount: unmatchedTxns.length,
    unmatched: unmatchedTxns,
  });
}));

// ═══════════════════════════════════════════════
// POST /unmatch/:id — Unmatch a reconciled transaction
// ═══════════════════════════════════════════════
router.post('/unmatch/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const bankTxn = await prisma.bankTransaction.findUnique({ where: { id: req.params.id } });
  if (!bankTxn) throw new NotFoundError('BankTransaction', req.params.id);

  if (!bankTxn.isReconciled) {
    res.status(400).json({ error: 'Transaction is not reconciled' });
    return;
  }

  const updated = await prisma.bankTransaction.update({
    where: { id: req.params.id },
    data: {
      isReconciled: false,
      reconciledWith: null,
    },
  });

  res.json({ success: true, bankTransaction: updated });
}));

export default router;
