import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate as any);

// GET / — list with optional date filter
router.get('/', async (req: Request, res: Response) => {
  try {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const where: any = {};
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }

    const sales = await prisma.directSale.findMany({
      where,
      orderBy: { date: 'desc' },
      take: 200,
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todaySales = sales.filter(s => new Date(s.date) >= today);
    const totalToday = todaySales.reduce((s, r) => s + r.amount, 0);
    const totalQtyToday = todaySales.reduce((s, r) => s + r.quantity, 0);
    const totalAll = sales.reduce((s, r) => s + r.amount, 0);
    const unpaid = sales.filter(s => !s.isPaid);

    res.json({
      sales,
      stats: {
        totalEntries: sales.length,
        todayCount: todaySales.length,
        todayAmount: totalToday,
        todayQty: totalQtyToday,
        totalAmount: totalAll,
        unpaidCount: unpaid.length,
        unpaidAmount: unpaid.reduce((s, r) => s + r.amount, 0),
      },
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST / — create entry
router.post('/', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const quantity = parseFloat(b.quantity) || 0;
    const rate = parseFloat(b.rate) || 0;
    const amount = quantity * rate;

    const sale = await prisma.directSale.create({
      data: {
        date: b.date ? new Date(b.date) : new Date(),
        buyerName: b.buyerName,
        buyerPhone: b.buyerPhone || null,
        buyerAddress: b.buyerAddress || null,
        productName: b.productName,
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
        remarks: b.remarks || null,
        userId: (req as any).user.id,
      },
    });

    res.status(201).json(sale);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /:id — update
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const data: any = {};
    if (b.buyerName !== undefined) data.buyerName = b.buyerName;
    if (b.buyerPhone !== undefined) data.buyerPhone = b.buyerPhone;
    if (b.buyerAddress !== undefined) data.buyerAddress = b.buyerAddress;
    if (b.isPaid !== undefined) data.isPaid = b.isPaid;
    if (b.paymentMode !== undefined) data.paymentMode = b.paymentMode;
    if (b.paymentRef !== undefined) data.paymentRef = b.paymentRef;
    if (b.remarks !== undefined) data.remarks = b.remarks;

    const sale = await prisma.directSale.update({
      where: { id: req.params.id },
      data,
    });
    res.json(sale);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /:id
router.delete('/:id', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  try {
    await prisma.directSale.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
