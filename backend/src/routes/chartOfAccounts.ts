import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { NotFoundError, ValidationError } from '../shared/errors';
import { z } from 'zod';
import prisma from '../config/prisma';

const router = Router();

// Types for Prisma results (used when Prisma client types unavailable)
interface JournalLineResult { debit: number; credit: number }
interface AccountWithLines {
  id: string; code: string; name: string; type: string; subType: string | null;
  openingBalance: number; journalLines: JournalLineResult[];
}

// ── Zod Schemas ──

const accountTypes = ['ASSET', 'LIABILITY', 'INCOME', 'EXPENSE', 'EQUITY'] as const;
const accountSubTypes = [
  'CURRENT_ASSET', 'FIXED_ASSET', 'BANK', 'CASH',
  'CURRENT_LIABILITY', 'LONG_TERM_LIABILITY',
  'DIRECT_INCOME', 'INDIRECT_INCOME',
  'DIRECT_EXPENSE', 'INDIRECT_EXPENSE',
  'CAPITAL', 'RESERVES',
] as const;

// ── Auto Code Generation ──
const TYPE_CODE_PREFIX: Record<string, number> = {
  ASSET: 1000, LIABILITY: 2000, INCOME: 3000, EXPENSE: 4000, EQUITY: 5000,
};

async function generateAccountCode(type: string, tx?: any): Promise<string> {
  const db = tx || prisma;
  const base = TYPE_CODE_PREFIX[type] || 1000;
  const max = base + 999;
  const last = await db.account.findFirst({
    where: { code: { gte: String(base), lte: String(max) } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });
  if (!last) return String(base + 1);
  const num = parseInt(last.code, 10);
  if (isNaN(num)) return String(base + 1);
  return String(num + 1);
}

const createAccountSchema = z.object({
  code: z.string().max(20).optional(),
  name: z.string().min(1).max(200),
  type: z.enum(accountTypes),
  subType: z.enum(accountSubTypes).optional().nullable(),
  parentId: z.string().optional().nullable(),
  openingBalance: z.number().default(0),
});

const updateAccountSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  subType: z.enum(accountSubTypes).optional().nullable(),
  parentId: z.string().optional().nullable(),
  openingBalance: z.number().optional(),
  isActive: z.boolean().optional(),
});

// ── GET /next-code?type=ASSET — Preview next auto-generated code ──
router.get('/next-code', asyncHandler(async (req: AuthRequest, res: Response) => {
  const type = (req.query.type as string) || 'ASSET';
  const code = await generateAccountCode(type);
  res.json({ code, type });
}));

// ── GET / — List all accounts (tree-friendly) ──
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const type = req.query.type as string | undefined;
  const active = req.query.active !== 'false'; // default: only active

  const where: Record<string, unknown> = {};
  if (type) where.type = type;
  if (active) where.isActive = true;

  const accounts = await prisma.account.findMany({
    where,
    orderBy: { code: 'asc' },
    take: 500,
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      subType: true,
      parentId: true,
      isSystem: true,
      isActive: true,
      openingBalance: true,
      createdAt: true,
    },
  });

  res.json(accounts);
}));

// ── GET /tree — Hierarchical tree structure ──
router.get('/tree', asyncHandler(async (req: AuthRequest, res: Response) => {
  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    orderBy: { code: 'asc' },
    take: 500,
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      subType: true,
      parentId: true,
      isSystem: true,
      openingBalance: true,
    },
  });

  // Build tree from flat list
  interface TreeNode {
    id: string;
    code: string;
    name: string;
    type: string;
    subType: string | null;
    parentId: string | null;
    isSystem: boolean;
    openingBalance: number;
    children: TreeNode[];
  }

  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const a of accounts) {
    map.set(a.id, { ...a, children: [] });
  }

  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  res.json(roots);
}));

// ── GET /balances — Account balances (opening + journal movements) ──
router.get('/balances', asyncHandler(async (req: AuthRequest, res: Response) => {
  const fromStr = req.query.from as string | undefined;
  const toStr = req.query.to as string | undefined;

  const from = fromStr ? new Date(fromStr) : undefined;
  const to = toStr ? new Date(toStr) : undefined;

  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    orderBy: { code: 'asc' },
    take: 500,
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      subType: true,
      openingBalance: true,
      journalLines: {
        where: {
          journal: {
            date: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
            isReversed: false,
          },
        },
        select: { debit: true, credit: true },
      },
    },
  });

  const result = (accounts as AccountWithLines[]).map((a: AccountWithLines) => {
    const totalDebit = a.journalLines.reduce((s: number, l: JournalLineResult) => s + l.debit, 0);
    const totalCredit = a.journalLines.reduce((s: number, l: JournalLineResult) => s + l.credit, 0);
    // For ASSET/EXPENSE: balance = opening + debit - credit
    // For LIABILITY/INCOME/EQUITY: balance = opening + credit - debit
    const isDebitNormal = a.type === 'ASSET' || a.type === 'EXPENSE';
    const closingBalance = isDebitNormal
      ? a.openingBalance + totalDebit - totalCredit
      : a.openingBalance + totalCredit - totalDebit;

    return {
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      subType: a.subType,
      openingBalance: a.openingBalance,
      totalDebit,
      totalCredit,
      closingBalance: Math.round(closingBalance * 100) / 100,
    };
  });

  res.json(result);
}));

// ── GET /:id — Single account detail ──
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const account = await prisma.account.findUnique({
    where: { id: req.params.id },
    include: {
      parent: { select: { id: true, code: true, name: true } },
      children: { select: { id: true, code: true, name: true, type: true }, orderBy: { code: 'asc' } },
    },
  });
  if (!account) throw new NotFoundError('Account', req.params.id);
  res.json(account);
}));

// ── POST / — Create account (auto-generates code if not provided) ──
router.post('/', validate(createAccountSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const userCode = req.body.code?.trim();

  // Validate parent exists if provided (can do outside transaction)
  if (req.body.parentId) {
    const parent = await prisma.account.findUnique({ where: { id: req.body.parentId } });
    if (!parent) throw new NotFoundError('Parent Account', req.body.parentId);
    if (parent.type !== req.body.type) {
      throw new ValidationError(`Parent account type (${parent.type}) must match child type (${req.body.type})`);
    }
  }

  // Retry loop to handle rare code conflicts
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const code = userCode || await generateAccountCode(req.body.type);

      const existing = await prisma.account.findUnique({ where: { code } });
      if (existing) throw new ValidationError(`Account code "${code}" already exists`);

      const account = await prisma.account.create({
        data: {
          code,
          name: req.body.name,
          type: req.body.type,
          subType: req.body.subType || null,
          parentId: req.body.parentId || null,
          openingBalance: req.body.openingBalance || 0,
        },
      });
      return res.status(201).json(account);
    } catch (err: any) {
      if (err.code === 'P2002' && attempt < 2) continue;
      throw err;
    }
  }
}));

// ── PUT /:id — Update account ──
router.put('/:id', validate(updateAccountSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const account = await prisma.account.findUnique({ where: { id: req.params.id } });
  if (!account) throw new NotFoundError('Account', req.params.id);

  // System accounts: only name and active status can change
  if (account.isSystem) {
    const allowed = ['name', 'isActive'];
    const keys = Object.keys(req.body);
    const forbidden = keys.filter(k => !allowed.includes(k));
    if (forbidden.length > 0) {
      throw new ValidationError(`System accounts can only update: ${allowed.join(', ')}`);
    }
  }

  const updated = await prisma.account.update({
    where: { id: req.params.id },
    data: req.body,
  });
  res.json(updated);
}));

// ── DELETE /:id — Soft-deactivate (never hard delete) ──
router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const account = await prisma.account.findUnique({ where: { id: req.params.id } });
  if (!account) throw new NotFoundError('Account', req.params.id);

  if (account.isSystem) {
    throw new ValidationError('Cannot delete system accounts');
  }

  // Check if account has journal lines
  const lineCount = await prisma.journalLine.count({ where: { accountId: req.params.id } });
  if (lineCount > 0) {
    throw new ValidationError(`Cannot delete account with ${lineCount} journal entries. Deactivate instead.`);
  }

  await prisma.account.update({
    where: { id: req.params.id },
    data: { isActive: false },
  });
  res.json({ success: true, message: 'Account deactivated' });
}));

// ── POST /seed — Seed default Chart of Accounts (one-time) ──
router.post('/seed', asyncHandler(async (req: AuthRequest, res: Response) => {
  const existingCount = await prisma.account.count();
  if (existingCount > 0) {
    res.status(400).json({ error: `Chart of Accounts already has ${existingCount} accounts. Seed only works on empty table.` });
    return;
  }

  const defaultAccounts: { code: string; name: string; type: string; subType?: string; isSystem: boolean }[] = [
    // ASSETS (1xxx)
    { code: '1001', name: 'Cash in Hand', type: 'ASSET', subType: 'CASH', isSystem: true },
    { code: '1002', name: 'SBI Current Account', type: 'ASSET', subType: 'BANK', isSystem: true },
    { code: '1003', name: 'HDFC Current Account', type: 'ASSET', subType: 'BANK', isSystem: true },
    { code: '1100', name: 'Accounts Receivable (Control)', type: 'ASSET', subType: 'CURRENT_ASSET', isSystem: true },
    { code: '1200', name: 'GST Input Credit (CGST)', type: 'ASSET', subType: 'CURRENT_ASSET', isSystem: true },
    { code: '1201', name: 'GST Input Credit (SGST)', type: 'ASSET', subType: 'CURRENT_ASSET', isSystem: true },
    { code: '1202', name: 'GST Input Credit (IGST)', type: 'ASSET', subType: 'CURRENT_ASSET', isSystem: true },
    { code: '1300', name: 'TDS Receivable', type: 'ASSET', subType: 'CURRENT_ASSET', isSystem: true },
    { code: '1400', name: 'Inventory - Raw Materials', type: 'ASSET', subType: 'CURRENT_ASSET', isSystem: false },
    { code: '1401', name: 'Inventory - Ethanol', type: 'ASSET', subType: 'CURRENT_ASSET', isSystem: false },
    { code: '1402', name: 'Inventory - DDGS', type: 'ASSET', subType: 'CURRENT_ASSET', isSystem: false },
    { code: '1500', name: 'Plant & Machinery', type: 'ASSET', subType: 'FIXED_ASSET', isSystem: false },
    { code: '1501', name: 'Land & Building', type: 'ASSET', subType: 'FIXED_ASSET', isSystem: false },
    { code: '1502', name: 'Furniture & Fixtures', type: 'ASSET', subType: 'FIXED_ASSET', isSystem: false },
    { code: '1503', name: 'Vehicles', type: 'ASSET', subType: 'FIXED_ASSET', isSystem: false },
    { code: '1600', name: 'Advance to Suppliers', type: 'ASSET', subType: 'CURRENT_ASSET', isSystem: false },
    { code: '1700', name: 'Security Deposits', type: 'ASSET', subType: 'CURRENT_ASSET', isSystem: false },

    // LIABILITIES (2xxx)
    { code: '2001', name: 'Accounts Payable (Control)', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', isSystem: true },
    { code: '2100', name: 'GST Output Tax (CGST)', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', isSystem: true },
    { code: '2101', name: 'GST Output Tax (SGST)', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', isSystem: true },
    { code: '2102', name: 'GST Output Tax (IGST)', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', isSystem: true },
    { code: '2200', name: 'TDS Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', isSystem: true },
    { code: '2300', name: 'Employee Payables', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', isSystem: false },
    { code: '2400', name: 'Loans - Bank', type: 'LIABILITY', subType: 'LONG_TERM_LIABILITY', isSystem: false },
    { code: '2500', name: 'Advance from Customers', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', isSystem: false },

    // INCOME (3xxx)
    { code: '3001', name: 'Ethanol Sales', type: 'INCOME', subType: 'DIRECT_INCOME', isSystem: true },
    { code: '3002', name: 'DDGS Sales', type: 'INCOME', subType: 'DIRECT_INCOME', isSystem: true },
    { code: '3003', name: 'Other Income', type: 'INCOME', subType: 'INDIRECT_INCOME', isSystem: false },
    { code: '3004', name: 'Interest Income', type: 'INCOME', subType: 'INDIRECT_INCOME', isSystem: false },
    { code: '3005', name: 'Scrap Sales', type: 'INCOME', subType: 'INDIRECT_INCOME', isSystem: false },

    // EXPENSE (4xxx)
    { code: '4001', name: 'Raw Material - Grain', type: 'EXPENSE', subType: 'DIRECT_EXPENSE', isSystem: true },
    { code: '4002', name: 'Raw Material - Chemicals', type: 'EXPENSE', subType: 'DIRECT_EXPENSE', isSystem: false },
    { code: '4003', name: 'Utilities - Power', type: 'EXPENSE', subType: 'DIRECT_EXPENSE', isSystem: false },
    { code: '4004', name: 'Utilities - Steam/Coal', type: 'EXPENSE', subType: 'DIRECT_EXPENSE', isSystem: false },
    { code: '4005', name: 'Utilities - Water', type: 'EXPENSE', subType: 'DIRECT_EXPENSE', isSystem: false },
    { code: '4010', name: 'Freight & Transport', type: 'EXPENSE', subType: 'DIRECT_EXPENSE', isSystem: false },
    { code: '4020', name: 'Salary & Wages', type: 'EXPENSE', subType: 'INDIRECT_EXPENSE', isSystem: false },
    { code: '4030', name: 'Repairs & Maintenance', type: 'EXPENSE', subType: 'INDIRECT_EXPENSE', isSystem: false },
    { code: '4040', name: 'Administrative Expenses', type: 'EXPENSE', subType: 'INDIRECT_EXPENSE', isSystem: false },
    { code: '4050', name: 'Depreciation', type: 'EXPENSE', subType: 'INDIRECT_EXPENSE', isSystem: false },
    { code: '4060', name: 'Insurance', type: 'EXPENSE', subType: 'INDIRECT_EXPENSE', isSystem: false },
    { code: '4070', name: 'Bank Charges', type: 'EXPENSE', subType: 'INDIRECT_EXPENSE', isSystem: false },
    { code: '4080', name: 'Legal & Professional Fees', type: 'EXPENSE', subType: 'INDIRECT_EXPENSE', isSystem: false },

    // EQUITY (5xxx)
    { code: '5001', name: 'Capital Account', type: 'EQUITY', subType: 'CAPITAL', isSystem: true },
    { code: '5002', name: 'Retained Earnings', type: 'EQUITY', subType: 'RESERVES', isSystem: true },
  ];

  const created = await prisma.$transaction(
    defaultAccounts.map((a) =>
      prisma.account.create({ data: a })
    )
  );

  res.status(201).json({ message: `Seeded ${created.length} accounts`, count: created.length });
}));

export default router;
