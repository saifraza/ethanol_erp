import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';

const router = Router();
router.use(authenticate as any);

// GET / — list orders with optional filters
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const status = req.query.status as string | undefined;
  const product = req.query.product as string | undefined;

  const where: any = {};
  if (status && status !== 'ALL') where.status = status;
  if (product) where.productName = product;

  const orders = await prisma.directSale.findMany({
    where,
    orderBy: { date: 'desc' },
    take: 500,
    select: {
      id: true, entryNo: true, date: true,
      customerId: true, buyerName: true, buyerPhone: true, buyerAddress: true,
      productName: true, rate: true, unit: true,
      validFrom: true, validTo: true, status: true,
      quantity: true, totalSuppliedQty: true, totalSuppliedAmt: true,
      remarks: true, createdAt: true,
      customer: { select: { id: true, name: true, gstNo: true, phone: true, state: true } },
    },
  });

  // Auto-expire past-due ACTIVE orders
  const now = new Date();
  const expired: string[] = [];
  for (const o of orders) {
    if (o.status === 'ACTIVE' && o.validTo && new Date(o.validTo) < now) {
      expired.push(o.id);
      o.status = 'EXPIRED';
    }
  }
  if (expired.length > 0) {
    await prisma.directSale.updateMany({
      where: { id: { in: expired } },
      data: { status: 'EXPIRED' },
    });
  }

  const active = orders.filter(o => o.status === 'ACTIVE');
  const twoDaysFromNow = new Date(now.getTime() + 2 * 86400000);
  const expiringSoon = active.filter(o => o.validTo && new Date(o.validTo) <= twoDaysFromNow);

  res.json({
    orders,
    stats: {
      total: orders.length,
      active: active.length,
      expiringSoon: expiringSoon.length,
      totalSuppliedAmt: orders.reduce((s, o) => s + (o.totalSuppliedAmt || 0), 0),
    },
  });
}));

// GET /active — active orders for a product (for weighbridge matching)
router.get('/active', asyncHandler(async (req: AuthRequest, res: Response) => {
  const product = req.query.product as string | undefined;
  const now = new Date();

  const where: any = {
    status: 'ACTIVE',
    validFrom: { lte: now },
    OR: [{ validTo: null }, { validTo: { gte: now } }],
  };
  if (product) where.productName = product;

  const orders = await prisma.directSale.findMany({
    where,
    orderBy: { date: 'desc' },
    select: {
      id: true, entryNo: true, buyerName: true, productName: true,
      rate: true, unit: true, validFrom: true, validTo: true,
      quantity: true, totalSuppliedQty: true,
      customer: { select: { id: true, name: true } },
    },
  });

  res.json({ orders });
}));

// GET /:id/dispatches — shipments linked to this order
router.get('/:id/dispatches', asyncHandler(async (req: AuthRequest, res: Response) => {
  const shipments = await prisma.shipment.findMany({
    where: { directSaleId: req.params.id },
    orderBy: { date: 'desc' },
    take: 200,
    select: {
      id: true, shipmentNo: true, date: true, vehicleNo: true, customerName: true,
      weightTare: true, weightGross: true, weightNet: true, bags: true,
      status: true, gateInTime: true, grossTime: true, releaseTime: true,
      productName: true, invoiceRef: true, remarks: true,
    },
  });

  const atGate = shipments.filter(s => ['GATE_IN', 'TARE_WEIGHED', 'LOADING'].includes(s.status));
  const dispatched = shipments.filter(s => !['GATE_IN', 'TARE_WEIGHED', 'LOADING'].includes(s.status));

  res.json({
    shipments,
    pipeline: {
      atWeighbridge: atGate.length,
      atWeighbridgeVehicles: atGate.map(s => s.vehicleNo).join(', '),
      totalDispatches: shipments.length,
      dispatched: dispatched.length,
    },
  });
}));

// POST / — create new scrap sales order
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;

  // Auto-fill buyer from Customer master
  let buyerName = b.buyerName || '';
  let buyerPhone = b.buyerPhone || null;
  let buyerAddress = b.buyerAddress || null;
  if (b.customerId) {
    const cust = await prisma.customer.findUnique({
      where: { id: b.customerId },
      select: { name: true, phone: true, address: true, state: true },
    });
    if (cust) {
      buyerName = buyerName || cust.name;
      buyerPhone = buyerPhone || cust.phone;
      buyerAddress = buyerAddress || [cust.address, cust.state].filter(Boolean).join(', ');
    }
  }

  const order = await prisma.directSale.create({
    data: {
      date: b.date ? new Date(b.date) : new Date(),
      customerId: b.customerId || null,
      buyerName,
      buyerPhone,
      buyerAddress,
      productName: b.productName,
      rate: parseFloat(b.rate) || 0,
      unit: b.unit || 'KG',
      quantity: parseFloat(b.quantity) || 0,
      validFrom: b.validFrom ? new Date(b.validFrom) : new Date(),
      validTo: b.validTo ? new Date(b.validTo) : null,
      status: 'ACTIVE',
      remarks: b.remarks || null,
      userId: req.user!.id,
    },
  });

  res.status(201).json(order);
}));

// PUT /:id — update order
router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const data: any = {};
  if (b.customerId !== undefined) data.customerId = b.customerId || null;
  if (b.buyerName !== undefined) data.buyerName = b.buyerName;
  if (b.buyerPhone !== undefined) data.buyerPhone = b.buyerPhone;
  if (b.buyerAddress !== undefined) data.buyerAddress = b.buyerAddress;
  if (b.productName !== undefined) data.productName = b.productName;
  if (b.rate !== undefined) data.rate = parseFloat(b.rate) || 0;
  if (b.unit !== undefined) data.unit = b.unit;
  if (b.quantity !== undefined) data.quantity = parseFloat(b.quantity) || 0;
  if (b.validFrom !== undefined) data.validFrom = new Date(b.validFrom);
  if (b.validTo !== undefined) data.validTo = b.validTo ? new Date(b.validTo) : null;
  if (b.status !== undefined) data.status = b.status;
  if (b.remarks !== undefined) data.remarks = b.remarks;

  const order = await prisma.directSale.update({
    where: { id: req.params.id },
    data,
  });
  res.json(order);
}));

// DELETE /:id
router.delete('/:id', authorize('ADMIN') as any, asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.directSale.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

export default router;
