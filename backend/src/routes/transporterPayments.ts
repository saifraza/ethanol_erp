import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { onTransporterPaymentMade } from '../services/autoJournal';

const router = Router();
router.use(authenticate as any);

// GET / — List transporter payments
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const status = req.query.status as string | undefined;
    const shipmentId = req.query.shipmentId as string | undefined;
    const where: any = { ...getCompanyFilter(req) };
    if (status) where.status = status;
    if (shipmentId) where.shipmentId = shipmentId;

    const payments = await prisma.transporterPayment.findMany({
      where,
      include: {
        shipment: {
          select: { id: true, vehicleNo: true, customerName: true, productName: true, weightNet: true, grBiltyNo: true, grReceivedBack: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ payments });
}));

// GET /summary — Payment summary per transporter
router.get('/summary', asyncHandler(async (req: AuthRequest, res: Response) => {
    const payments = await prisma.transporterPayment.findMany({
      where: { ...getCompanyFilter(req) },
      select: {
        transporterName: true,
        transporterId: true,
        amount: true,
        paymentType: true,
        status: true,
      },
    
    take: 500,
  });

    // Group by transporter
    const summary: Record<string, { name: string; totalFreight: number; advance: number; balance: number; paid: number; pending: number }> = {};
    for (const p of payments) {
      const key = p.transporterId || p.transporterName;
      if (!summary[key]) summary[key] = { name: p.transporterName, totalFreight: 0, advance: 0, balance: 0, paid: 0, pending: 0 };
      if (p.paymentType === 'ADVANCE') summary[key].advance += p.amount;
      if (p.paymentType === 'BALANCE') summary[key].balance += p.amount;
      if (p.status === 'PAID') summary[key].paid += p.amount;
      if (p.status === 'PENDING') summary[key].pending += p.amount;
      summary[key].totalFreight += p.amount;
    }

    res.json({ summary: Object.values(summary) });
}));

// POST / — Create transporter payment (advance or balance)
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body;

    // If creating advance, check shipment exists
    const shipment = await prisma.shipment.findUnique({ where: { id: b.shipmentId } });
    if (!shipment) { res.status(404).json({ error: 'Shipment not found' }); return; }

    const amount = parseFloat(b.amount) || 0;
    const mode = b.mode || 'BANK_TRANSFER';
    const status = b.status || 'PENDING';
    const transporterName = b.transporterName || shipment.transporterName || '';

    const payment = await prisma.transporterPayment.create({
      data: {
        shipmentId: b.shipmentId,
        transporterId: b.transporterId || null,
        transporterName,
        paymentType: b.paymentType || 'ADVANCE',
        amount,
        mode,
        reference: b.reference || null,
        freightRate: b.freightRate ? parseFloat(b.freightRate) : null,
        freightTotal: b.freightTotal ? parseFloat(b.freightTotal) : null,
        status,
        remarks: b.remarks || null,
        userId: req.user!.id,
        companyId: getActiveCompanyId(req),
      },
      include: { shipment: { select: { vehicleNo: true, customerName: true } } },
    });

    // Auto-journal for PAID payments (or all if status is paid on creation)
    if (status === 'PAID' && amount > 0) {
      onTransporterPaymentMade(prisma as Parameters<typeof onTransporterPaymentMade>[0], {
        id: payment.id, amount, mode,
        reference: b.reference || null,
        transporterName,
        shipmentId: b.shipmentId,
        userId: req.user!.id,
        paymentDate: new Date(),
      }).catch(() => {});
    }

    res.status(201).json(payment);
}));

// PUT /:id — Update payment (mark as paid, etc.)
router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body;
    const data: any = {};
    if (b.status !== undefined) data.status = b.status;
    if (b.amount !== undefined) data.amount = parseFloat(b.amount);
    if (b.mode !== undefined) data.mode = b.mode;
    if (b.reference !== undefined) data.reference = b.reference;
    if (b.remarks !== undefined) data.remarks = b.remarks;
    if (b.paidAt !== undefined) data.paidAt = new Date(b.paidAt);
    if (b.approvedBy !== undefined) data.approvedBy = b.approvedBy;
    if (b.status === 'PAID' && !b.paidAt) data.paidAt = new Date();

    const existing = await prisma.transporterPayment.findFirst({
      where: { id: req.params.id, ...getCompanyFilter(req) },
    });
    if (!existing) { res.status(404).json({ error: 'Payment not found' }); return; }

    const payment = await prisma.transporterPayment.update({
      where: { id: req.params.id },
      data,
    });

    // Auto-journal when marking as PAID
    if (b.status === 'PAID' && payment.amount > 0) {
      onTransporterPaymentMade(prisma as Parameters<typeof onTransporterPaymentMade>[0], {
        id: payment.id,
        amount: payment.amount,
        mode: payment.mode,
        reference: payment.reference,
        transporterName: payment.transporterName,
        shipmentId: payment.shipmentId,
        userId: req.user!.id,
        paymentDate: payment.paidAt || new Date(),
      }).catch(() => {});
    }

    res.json(payment);
}));

// DELETE /:id
router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const toDelete = await prisma.transporterPayment.findFirst({
      where: { id: req.params.id, ...getCompanyFilter(req) },
    });
    if (!toDelete) { res.status(404).json({ error: 'Payment not found' }); return; }
    await prisma.transporterPayment.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
}));

export default router;
