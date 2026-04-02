import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { z } from 'zod';

const router = Router();
router.use(authenticate as any);

// ── Trader = Vendor with isAgent=true ──
// Simple master for procurement agents/traders who buy on behalf of the company

const traderSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  aadhaarNo: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  bankName: z.string().optional(),
  bankAccount: z.string().optional(),
  bankIfsc: z.string().optional(),
  pan: z.string().optional(),
  category: z.string().optional().default('TRADER'),
  creditLimit: z.number().optional().default(0),
  remarks: z.string().optional(),
});

const traderUpdateSchema = traderSchema.partial().strict();

// GET / — list all traders with purchase stats
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const traders = await prisma.vendor.findMany({
    where: { isAgent: true, isActive: true },
    orderBy: { name: 'asc' },
    take: 200,
    select: {
      id: true, name: true, vendorCode: true, phone: true, aadhaarNo: true,
      address: true, city: true, state: true, pan: true,
      bankName: true, bankAccount: true, bankIfsc: true,
      creditLimit: true, remarks: true, createdAt: true,
    },
  });

  const traderIds = traders.map(t => t.id);

  // Batch: PO count per trader
  const poCounts = await prisma.purchaseOrder.groupBy({
    by: ['vendorId'],
    where: { vendorId: { in: traderIds } },
    _count: true,
  });
  const poCountMap = new Map(poCounts.map(p => [p.vendorId, p._count]));

  // Batch: total payments per trader
  const payments = await prisma.vendorPayment.groupBy({
    by: ['vendorId'],
    where: { vendorId: { in: traderIds } },
    _sum: { amount: true },
  });
  const paymentMap = new Map(payments.map(p => [p.vendorId, p._sum.amount || 0]));

  // Batch: total purchase value from PO lines
  const poLines = await prisma.pOLine.findMany({
    where: { po: { vendorId: { in: traderIds } } },
    select: { po: { select: { vendorId: true } }, receivedQty: true, rate: true },
  });
  const purchaseMap = new Map<string, number>();
  for (const line of poLines) {
    const vid = line.po.vendorId;
    purchaseMap.set(vid, (purchaseMap.get(vid) || 0) + (line.receivedQty || 0) * (line.rate || 0));
  }

  const result = traders.map(t => ({
    ...t,
    poCount: poCountMap.get(t.id) || 0,
    totalPaid: Math.round((paymentMap.get(t.id) || 0) * 100) / 100,
    totalPurchased: Math.round((purchaseMap.get(t.id) || 0) * 100) / 100,
    balance: Math.round(((paymentMap.get(t.id) || 0) - (purchaseMap.get(t.id) || 0)) * 100) / 100,
  }));

  res.json(result);
}));

// GET /:id — single trader
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const trader = await prisma.vendor.findUnique({ where: { id: req.params.id } });
  if (!trader || !trader.isAgent) return res.status(404).json({ error: 'Trader not found' });
  res.json(trader);
}));

// POST / — create trader
router.post('/', validate(traderSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const count = await prisma.vendor.count({ where: { isAgent: true } });
  let vendorCode = `TRD-${String(count + 1).padStart(3, '0')}`;

  let trader;
  try {
    trader = await prisma.vendor.create({
      data: {
        name: b.name, vendorCode, category: b.category || 'TRADER', isAgent: true,
        phone: b.phone || null, aadhaarNo: b.aadhaarNo || null,
        address: b.address || null, city: b.city || null, state: b.state || null,
        bankName: b.bankName || null, bankAccount: b.bankAccount || null, bankIfsc: b.bankIfsc || null,
        pan: b.pan || null, creditLimit: b.creditLimit || 0, paymentTerms: 'ADVANCE',
        remarks: b.remarks || null, isActive: true,
      },
    });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2002') {
      vendorCode = `TRD-${Date.now().toString(36).toUpperCase()}`;
      trader = await prisma.vendor.create({
        data: {
          name: b.name, vendorCode, category: b.category || 'TRADER', isAgent: true,
          phone: b.phone || null, aadhaarNo: b.aadhaarNo || null,
          address: b.address || null, city: b.city || null, state: b.state || null,
          bankName: b.bankName || null, bankAccount: b.bankAccount || null, bankIfsc: b.bankIfsc || null,
          pan: b.pan || null, creditLimit: b.creditLimit || 0, paymentTerms: 'ADVANCE',
          remarks: b.remarks || null, isActive: true,
        },
      });
    } else throw err;
  }
  res.status(201).json(trader);
}));

// PUT /:id — update trader
router.put('/:id', validate(traderUpdateSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.vendor.findUnique({ where: { id: req.params.id }, select: { isAgent: true } });
  if (!existing || !existing.isAgent) return res.status(404).json({ error: 'Trader not found' });

  const b = req.body;
  const trader = await prisma.vendor.update({
    where: { id: req.params.id },
    data: {
      name: b.name, phone: b.phone, aadhaarNo: b.aadhaarNo,
      address: b.address, city: b.city, state: b.state,
      bankName: b.bankName, bankAccount: b.bankAccount, bankIfsc: b.bankIfsc,
      pan: b.pan, category: b.category, creditLimit: b.creditLimit, remarks: b.remarks,
    },
  });
  res.json(trader);
}));

// DELETE /:id — soft delete
router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.vendor.findUnique({ where: { id: req.params.id }, select: { isAgent: true } });
  if (!existing || !existing.isAgent) return res.status(404).json({ error: 'Trader not found' });
  await prisma.vendor.update({ where: { id: req.params.id }, data: { isActive: false } });
  res.json({ ok: true });
}));

export default router;
