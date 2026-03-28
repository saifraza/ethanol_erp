import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';

const router = Router();
router.use(authenticate as any);

// GET / — list with optional date filter
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  const where: any = {};
  if (from || to) {
    where.date = {};
    if (from) where.date.gte = new Date(from);
    if (to) where.date.lte = new Date(to);
  }

  const purchases = await prisma.directPurchase.findMany({
    where,
    orderBy: { date: 'desc' },
    take: 200,
  });

  // Summary stats
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayPurchases = purchases.filter(p => new Date(p.date) >= today);
  const totalToday = todayPurchases.reduce((s, p) => s + p.netPayable, 0);
  const totalQtyToday = todayPurchases.reduce((s, p) => s + p.quantity, 0);
  const totalAll = purchases.reduce((s, p) => s + p.netPayable, 0);
  const unpaid = purchases.filter(p => !p.isPaid);

  res.json({
    purchases,
    stats: {
      totalEntries: purchases.length,
      todayCount: todayPurchases.length,
      todayAmount: totalToday,
      todayQty: totalQtyToday,
      totalAmount: totalAll,
      unpaidCount: unpaid.length,
      unpaidAmount: unpaid.reduce((s, p) => s + p.netPayable, 0),
    },
  });
}));

// POST / — create entry
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const quantity = parseFloat(b.quantity) || 0;
  const rate = parseFloat(b.rate) || 0;
  const amount = quantity * rate;
  const deductions = parseFloat(b.deductions) || 0;
  const netPayable = amount - deductions;

  const purchase = await prisma.directPurchase.create({
    data: {
      date: b.date ? new Date(b.date) : new Date(),
      sellerName: b.sellerName,
      sellerPhone: b.sellerPhone || null,
      sellerVillage: b.sellerVillage || null,
      sellerAadhaar: b.sellerAadhaar || null,
      materialName: b.materialName,
      quantity,
      unit: b.unit || 'KG',
      rate,
      amount,
      vehicleNo: b.vehicleNo || null,
      weightSlipNo: b.weightSlipNo || null,
      grossWeight: b.grossWeight ? parseFloat(b.grossWeight) : null,
      tareWeight: b.tareWeight ? parseFloat(b.tareWeight) : null,
      netWeight: b.netWeight ? parseFloat(b.netWeight) : null,
      paymentMode: b.paymentMode || 'CASH',
      paymentRef: b.paymentRef || null,
      isPaid: b.isPaid !== undefined ? b.isPaid : true,
      deductions,
      deductionReason: b.deductionReason || null,
      netPayable,
      remarks: b.remarks || null,
      userId: req.user!.id,
    },
  });

  res.status(201).json(purchase);
}));

// PUT /:id — update
router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const data: any = {};
  if (b.sellerName !== undefined) data.sellerName = b.sellerName;
  if (b.sellerPhone !== undefined) data.sellerPhone = b.sellerPhone;
  if (b.sellerVillage !== undefined) data.sellerVillage = b.sellerVillage;
  if (b.isPaid !== undefined) data.isPaid = b.isPaid;
  if (b.paymentMode !== undefined) data.paymentMode = b.paymentMode;
  if (b.paymentRef !== undefined) data.paymentRef = b.paymentRef;
  if (b.remarks !== undefined) data.remarks = b.remarks;

  const purchase = await prisma.directPurchase.update({
    where: { id: req.params.id },
    data,
  });
  res.json(purchase);
}));

// DELETE /:id
router.delete('/:id', authorize('ADMIN') as any, asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.directPurchase.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

export default router;
