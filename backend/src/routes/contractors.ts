import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { NotFoundError } from '../shared/errors';
import { z } from 'zod';

const router = Router();
router.use(authenticate);

// PAN 4th character determines entity type
function detectPanType(pan: string): { panType: string; tdsPercent: number } {
  const fourthChar = pan.charAt(3).toUpperCase();
  const panType = fourthChar === 'P' ? 'INDIVIDUAL' : 'COMPANY';
  const tdsPercent = panType === 'INDIVIDUAL' ? 1 : 2;
  return { panType, tdsPercent };
}

const createSchema = z.object({
  name: z.string().min(1),
  tradeName: z.string().optional(),
  pan: z.string().length(10).transform(v => v.toUpperCase()),
  gstin: z.string().length(15).optional().nullable(),
  gstState: z.string().optional().nullable(),
  aadhaarNo: z.string().optional().nullable(),
  contractorType: z.enum(['CIVIL', 'ELECTRICAL', 'MANPOWER', 'TRANSPORT', 'DAILY_WORK', 'OTHER']).default('OTHER'),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  address: z.string().optional().nullable(),
  bankName: z.string().optional().nullable(),
  bankBranch: z.string().optional().nullable(),
  bankAccount: z.string().optional().nullable(),
  bankIfsc: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
});

const updateSchema = createSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// GET / — list contractors
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const where: Record<string, unknown> = { ...getCompanyFilter(req) };
  if (req.query.active === 'true') where.isActive = true;
  if (req.query.type) where.contractorType = req.query.type;

  const contractors = await prisma.contractor.findMany({
    where,
    orderBy: { name: 'asc' },
    take: 500,
    select: {
      id: true, contractorCode: true, name: true, tradeName: true,
      pan: true, panType: true, gstin: true, contractorType: true,
      phone: true, tdsSection: true, tdsPercent: true, isActive: true,
      bankAccount: true, bankIfsc: true, bankName: true,
      _count: { select: { bills: true, payments: true } },
    },
  });

  // Compute outstanding per contractor
  const outstanding = await prisma.contractorBill.groupBy({
    by: ['contractorId'],
    where: { status: { in: ['CONFIRMED', 'PARTIAL_PAID'] }, ...getCompanyFilter(req) },
    _sum: { balanceAmount: true },
  });
  const outMap = new Map(outstanding.map(o => [o.contractorId, o._sum.balanceAmount || 0]));

  const result = contractors.map(c => ({
    ...c,
    outstanding: outMap.get(c.id) || 0,
  }));

  res.json({ contractors: result });
}));

// GET /outstanding — outstanding grouped by contractor
router.get('/outstanding', asyncHandler(async (req: AuthRequest, res: Response) => {
  const bills = await prisma.contractorBill.findMany({
    where: { status: { in: ['CONFIRMED', 'PARTIAL_PAID'] }, balanceAmount: { gt: 0 }, ...getCompanyFilter(req) },
    select: {
      id: true, billNo: true, billDate: true, description: true,
      netPayable: true, paidAmount: true, balanceAmount: true, status: true,
      contractor: { select: { id: true, name: true, contractorCode: true, contractorType: true } },
    },
    orderBy: { billDate: 'asc' },
    take: 500,
  });

  // Group by contractor
  const grouped: Record<string, { contractor: { id: string; name: string; contractorCode: string; contractorType: string }; bills: typeof bills; total: number }> = {};
  for (const bill of bills) {
    const cid = bill.contractor.id;
    if (!grouped[cid]) {
      grouped[cid] = { contractor: bill.contractor, bills: [], total: 0 };
    }
    grouped[cid].bills.push(bill);
    grouped[cid].total += bill.balanceAmount;
  }

  res.json({ outstanding: Object.values(grouped) });
}));

// GET /:id — single contractor with stats
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const contractor = await prisma.contractor.findUnique({
    where: { id: req.params.id },
    include: {
      _count: { select: { bills: true, payments: true } },
    },
  });
  if (!contractor) throw new NotFoundError('Contractor', req.params.id);

  const outstanding = await prisma.contractorBill.aggregate({
    where: { contractorId: req.params.id, status: { in: ['CONFIRMED', 'PARTIAL_PAID'] } },
    _sum: { balanceAmount: true },
  });

  res.json({ ...contractor, outstanding: outstanding._sum.balanceAmount || 0 });
}));

function vendorDataFromContractor(c: { name: string; tradeName?: string | null; contractorType: string; pan: string; gstin?: string | null; gstState?: string | null; phone?: string | null; email?: string | null; address?: string | null; bankName?: string | null; bankBranch?: string | null; bankAccount?: string | null; bankIfsc?: string | null; tdsSection: string; tdsPercent: number; companyId?: string | null }) {
  return {
    name: c.name,
    tradeName: c.tradeName || null,
    category: `CONTRACTOR_${c.contractorType}`,
    pan: c.pan,
    gstin: c.gstin || null,
    gstState: c.gstState || null,
    phone: c.phone || null,
    email: c.email || null,
    address: c.address || null,
    bankName: c.bankName || null,
    bankBranch: c.bankBranch || null,
    bankAccount: c.bankAccount || null,
    bankIfsc: c.bankIfsc || null,
    tdsApplicable: true,
    tdsSection: c.tdsSection,
    tdsPercent: c.tdsPercent,
    companyId: c.companyId || null,
  };
}

// POST / — create contractor + auto-create synced vendor
router.post('/', validate(createSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { panType, tdsPercent } = detectPanType(req.body.pan);

  const last = await prisma.contractor.findFirst({ orderBy: { contractorCode: 'desc' }, select: { contractorCode: true } });
  const nextNum = last ? parseInt(last.contractorCode.replace('CON-', ''), 10) + 1 : 1;
  const contractorCode = `CON-${String(nextNum).padStart(3, '0')}`;
  const companyId = getActiveCompanyId(req);

  const contractorData = { ...req.body, contractorCode, panType, tdsPercent, tdsSection: '194C', companyId };

  // Auto-create vendor mirror
  const vendorCode = `CON-V-${contractorCode}`;
  const vendor = await prisma.vendor.create({
    data: { vendorCode, ...vendorDataFromContractor({ ...contractorData, tdsSection: '194C', tdsPercent }) },
  });

  const contractor = await prisma.contractor.create({
    data: { ...contractorData, vendorId: vendor.id },
  });

  res.status(201).json(contractor);
}));

// PUT /:id — update contractor + sync vendor
router.put('/:id', validate(updateSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.contractor.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new NotFoundError('Contractor', req.params.id);

  const data: Record<string, unknown> = { ...req.body };

  if (req.body.pan && req.body.pan !== existing.pan) {
    const { panType, tdsPercent } = detectPanType(req.body.pan);
    data.panType = panType;
    data.tdsPercent = tdsPercent;
  }

  const contractor = await prisma.contractor.update({
    where: { id: req.params.id },
    data,
  });

  // Sync to linked vendor
  if (contractor.vendorId) {
    await prisma.vendor.update({
      where: { id: contractor.vendorId },
      data: vendorDataFromContractor(contractor as Parameters<typeof vendorDataFromContractor>[0]),
    }).catch(() => {});
  }

  res.json(contractor);
}));

// GET /:id/ledger — contractor ledger (bills + payments, running balance)
router.get('/:id/ledger', asyncHandler(async (req: AuthRequest, res: Response) => {
  const contractorId = req.params.id;
  const from = req.query.from ? new Date(req.query.from as string) : undefined;
  const to = req.query.to ? new Date(req.query.to as string) : undefined;

  const dateFilter: Record<string, unknown> = {};
  if (from) dateFilter.gte = from;
  if (to) dateFilter.lte = to;

  const [bills, payments] = await Promise.all([
    prisma.contractorBill.findMany({
      where: {
        contractorId,
        status: { not: 'CANCELLED' },
        ...(from || to ? { billDate: dateFilter } : {}),
      },
      select: {
        id: true, billNo: true, billDate: true, description: true,
        totalAmount: true, tdsAmount: true, netPayable: true, status: true,
      },
      orderBy: { billDate: 'asc' },
      take: 500,
    }),
    prisma.contractorPayment.findMany({
      where: {
        contractorId,
        paymentStatus: { not: 'CANCELLED' },
        ...(from || to ? { paymentDate: dateFilter } : {}),
      },
      select: {
        id: true, amount: true, tdsDeducted: true, paymentMode: true,
        paymentRef: true, paymentDate: true, paymentStatus: true, billId: true,
      },
      orderBy: { paymentDate: 'asc' },
      take: 500,
    }),
  ]);

  // Build timeline entries
  interface LedgerEntry {
    date: Date;
    type: 'BILL' | 'PAYMENT';
    ref: string;
    description: string;
    debit: number;
    credit: number;
    balance: number;
  }

  const entries: LedgerEntry[] = [];

  for (const b of bills) {
    entries.push({
      date: b.billDate,
      type: 'BILL',
      ref: `BILL-${b.billNo}`,
      description: b.description,
      debit: b.netPayable,
      credit: 0,
      balance: 0,
    });
  }

  for (const p of payments) {
    entries.push({
      date: p.paymentDate,
      type: 'PAYMENT',
      ref: `${p.paymentMode} ${p.paymentRef || ''}`.trim(),
      description: p.billId ? `Against bill` : 'Advance payment',
      debit: 0,
      credit: p.amount + p.tdsDeducted,
      balance: 0,
    });
  }

  // Sort by date and compute running balance
  entries.sort((a, b) => a.date.getTime() - b.date.getTime());
  let balance = 0;
  for (const e of entries) {
    balance += e.debit - e.credit;
    e.balance = Math.round(balance * 100) / 100;
  }

  res.json({ ledger: entries, closingBalance: balance });
}));

// GET /:id/running-pos — active OPEN/contractor POs for this contractor
router.get('/:id/running-pos', asyncHandler(async (req: AuthRequest, res: Response) => {
  const pos = await prisma.purchaseOrder.findMany({
    where: {
      contractorId: req.params.id,
      poType: 'CONTRACTOR',
      status: { in: ['DRAFT', 'APPROVED', 'SENT', 'PARTIAL_RECEIVED'] },
    },
    select: {
      id: true, poNo: true, poDate: true, status: true, dealType: true,
      subtotal: true, totalGst: true, grandTotal: true, remarks: true,
      tdsPercent: true, tdsAmount: true,
      lines: {
        select: {
          id: true, lineNo: true, description: true, quantity: true,
          unit: true, rate: true, amount: true, createdAt: true,
        },
        orderBy: { lineNo: 'asc' },
      },
      _count: { select: { contractorBills: true } },
    },
    orderBy: { poDate: 'desc' },
    take: 50,
  });
  res.json({ runningPOs: pos });
}));

// POST /:id/close-po/:poId — close a running contractor PO
router.post('/:id/close-po/:poId', asyncHandler(async (req: AuthRequest, res: Response) => {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: req.params.poId, contractorId: req.params.id },
    include: { lines: true },
  });
  if (!po) throw new NotFoundError('PurchaseOrder', req.params.poId);

  const subtotal = po.lines.reduce((s, l) => s + l.amount, 0);
  const totalGst = po.lines.reduce((s, l) => s + (l.cgstAmount || 0) + (l.sgstAmount || 0) + (l.igstAmount || 0), 0);

  await prisma.purchaseOrder.update({
    where: { id: po.id },
    data: {
      status: 'CLOSED',
      subtotal,
      totalGst,
      grandTotal: subtotal + totalGst + po.freightCharge + po.otherCharges + po.roundOff,
      remarks: `${po.remarks || ''} | Closed manually`.trim(),
    },
  });

  res.json({ success: true });
}));

export default router;
