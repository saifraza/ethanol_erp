import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/auth';

const router = Router();
router.use(authenticate as any);

// ═══════════════════════════════════════════════
// GET /pending — Shipments awaiting payment confirmation
// ═══════════════════════════════════════════════
router.get('/pending', async (req: Request, res: Response) => {
  try {
    const take = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const skip = parseInt(req.query.offset as string) || 0;

    const shipments = await prisma.shipment.findMany({
      where: { paymentStatus: 'PENDING' },
      orderBy: { date: 'desc' },
      take,
      skip,
      select: {
        id: true,
        shipmentNo: true,
        vehicleNo: true,
        customerName: true,
        productName: true,
        destination: true,
        weightTare: true,
        weightGross: true,
        weightNet: true,
        bags: true,
        weightPerBag: true,
        paymentTerms: true,
        paymentStatus: true,
        status: true,
        date: true,
        gateInTime: true,
        challanNo: true,
        invoiceRef: true,
        ewayBill: true,
        dispatchRequestId: true,
        dispatchRequest: {
          select: {
            drNo: true,
            order: {
              select: {
                orderNo: true,
                paymentTerms: true,
                grandTotal: true,
                customer: { select: { id: true, name: true, phone: true } },
                lines: { select: { productName: true, rate: true, gstPercent: true, unit: true } },
              },
            },
          },
        },
      },
    });

    // Calculate expected amount for each shipment from order rate
    const enriched = shipments.map((s: any) => {
      const netMT = s.weightNet ? s.weightNet / 1000 : 0;
      const line = s.dispatchRequest?.order?.lines?.[0];
      const rate = line?.rate || 0;
      const gstPct = line?.gstPercent || 5;
      const taxable = netMT * rate;
      const gst = taxable * gstPct / 100;
      const expectedAmount = Math.round((taxable + gst) * 100) / 100;

      return {
        ...s,
        netMT: Math.round(netMT * 1000) / 1000,
        rate,
        gstPercent: gstPct,
        expectedAmount,
        customerPhone: s.dispatchRequest?.order?.customer?.phone,
        orderNo: s.dispatchRequest?.order?.orderNo,
      };
    });

    res.json({ pending: enriched, total: enriched.length });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════
// GET /dashboard — Today's payment summary
// ═══════════════════════════════════════════════
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Pending payments (all time)
    const pendingCount = await prisma.shipment.count({
      where: { paymentStatus: 'PENDING' },
    });

    // Today's confirmed payments
    const todayPayments = await prisma.shipment.findMany({
      where: {
        paymentConfirmedAt: { gte: today, lt: tomorrow },
        paymentStatus: 'CONFIRMED',
      },
      select: {
        id: true,
        paymentAmount: true,
        paymentMode: true,
        paymentRef: true,
        paymentConfirmedAt: true,
        customerName: true,
        vehicleNo: true,
        productName: true,
        weightNet: true,
      },
    });

    const todayTotal = todayPayments.reduce((sum: number, s: any) => sum + (s.paymentAmount || 0), 0);

    // Mode breakdown
    const modeBreakdown: Record<string, { count: number; amount: number }> = {};
    todayPayments.forEach((s: any) => {
      const mode = s.paymentMode || 'UNKNOWN';
      if (!modeBreakdown[mode]) modeBreakdown[mode] = { count: 0, amount: 0 };
      modeBreakdown[mode].count++;
      modeBreakdown[mode].amount += s.paymentAmount || 0;
    });

    // Recent confirmed (last 20)
    const recentConfirmed = await prisma.shipment.findMany({
      where: { paymentStatus: 'CONFIRMED', paymentConfirmedAt: { not: null } },
      orderBy: { paymentConfirmedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        shipmentNo: true,
        vehicleNo: true,
        customerName: true,
        productName: true,
        weightNet: true,
        paymentAmount: true,
        paymentMode: true,
        paymentRef: true,
        paymentConfirmedAt: true,
      },
    });

    res.json({
      pendingCount,
      todayCollections: {
        count: todayPayments.length,
        total: Math.round(todayTotal * 100) / 100,
        breakdown: modeBreakdown,
      },
      recentConfirmed,
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════
// POST /:id/confirm-payment — Accounts team confirms payment
// ═══════════════════════════════════════════════
router.post('/:id/confirm-payment', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id } });
    if (!shipment) { res.status(404).json({ error: 'Shipment not found' }); return; }

    if (shipment.paymentStatus !== 'PENDING') {
      res.status(400).json({ error: 'Payment already confirmed or not required' });
      return;
    }

    const mode = b.paymentMode || 'CASH';
    const validModes = ['CASH', 'UPI', 'NEFT', 'RTGS', 'CHEQUE', 'BANK_TRANSFER'];
    if (!validModes.includes(mode)) {
      res.status(400).json({ error: `Invalid payment mode. Use: ${validModes.join(', ')}` });
      return;
    }

    if (!b.paymentAmount || parseFloat(b.paymentAmount) <= 0) {
      res.status(400).json({ error: 'Payment amount is required' });
      return;
    }

    const updated = await prisma.shipment.update({
      where: { id: req.params.id },
      data: {
        paymentStatus: 'CONFIRMED',
        paymentMode: mode,
        paymentRef: b.paymentRef || null,
        paymentAmount: parseFloat(b.paymentAmount),
        paymentConfirmedAt: new Date(),
        paymentConfirmedBy: (req as any).user?.id || null,
      },
    });
    res.json({ success: true, shipment: updated });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
