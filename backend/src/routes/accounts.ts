import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { NotFoundError } from '../shared/errors';
import prisma from '../config/prisma';
import { onShipmentPaymentConfirmed } from '../services/autoJournal';

const router = Router();
router.use(authenticate as any);

// ═══════════════════════════════════════════════
// GET /pending — Shipments awaiting payment confirmation
// ═══════════════════════════════════════════════
router.get('/pending', asyncHandler(async (req: AuthRequest, res: Response) => {
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
      irn: true,
      irnStatus: true,
      ewayBillStatus: true,
      dispatchRequestId: true,
      dispatchRequest: {
        select: {
          drNo: true,
          order: {
            select: {
              id: true,
              orderNo: true,
              paymentTerms: true,
              grandTotal: true,
              customer: { select: { id: true, name: true, phone: true, gstNo: true } },
              lines: { select: { productName: true, rate: true, gstPercent: true, unit: true, quantity: true } },
            },
          },
        },
      },
    },
  });

  const enriched = shipments.map((s: any) => {
    const netMT = s.weightNet ? s.weightNet / 1000 : 0;
    const line = s.dispatchRequest?.order?.lines?.[0];
    const rate = line?.rate || 0;
    const gstPct = line?.gstPercent || 5;
    const taxable = netMT * rate;
    const gst = taxable * gstPct / 100;
    const expectedAmount = Math.round((taxable + gst) * 100) / 100;

    return {
      id: s.id,
      shipmentNo: s.shipmentNo,
      vehicleNo: s.vehicleNo,
      customerName: s.customerName,
      productName: s.productName,
      destination: s.destination,
      weightTare: s.weightTare,
      weightGross: s.weightGross,
      weightNet: s.weightNet,
      netMT: Math.round(netMT * 1000) / 1000,
      bags: s.bags,
      paymentTerms: s.paymentTerms,
      status: s.status,
      date: s.date,
      gateInTime: s.gateInTime,
      invoiceRef: s.invoiceRef,
      ewayBill: s.ewayBill,
      irn: s.irn,
      irnStatus: s.irnStatus,
      ewayBillStatus: s.ewayBillStatus,
      rate,
      gstPercent: gstPct,
      expectedAmount,
      customerPhone: s.dispatchRequest?.order?.customer?.phone,
      customerGstin: s.dispatchRequest?.order?.customer?.gstNo,
      orderNo: s.dispatchRequest?.order?.orderNo,
      orderId: s.dispatchRequest?.order?.id,
      drNo: s.dispatchRequest?.drNo,
    };
  });

  res.json({ pending: enriched, total: enriched.length });
}));

// ═══════════════════════════════════════════════
// GET /dashboard — Summary stats
// ═══════════════════════════════════════════════
router.get('/dashboard', asyncHandler(async (req: AuthRequest, res: Response) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [pendingCount, todayPayments, recentConfirmed] = await Promise.all([
    prisma.shipment.count({ where: { paymentStatus: 'PENDING' } }),
    prisma.shipment.findMany({
      where: { paymentConfirmedAt: { gte: today, lt: tomorrow }, paymentStatus: 'CONFIRMED' },
      select: { id: true, paymentAmount: true, paymentMode: true },
    }),
    prisma.shipment.findMany({
      where: { paymentStatus: 'CONFIRMED', paymentConfirmedAt: { not: null } },
      orderBy: { paymentConfirmedAt: 'desc' },
      take: 30,
      select: {
        id: true, shipmentNo: true, vehicleNo: true, customerName: true,
        productName: true, weightNet: true, destination: true,
        paymentAmount: true, paymentMode: true, paymentRef: true,
        paymentConfirmedAt: true, paymentConfirmedBy: true,
        invoiceRef: true, ewayBill: true, status: true, date: true,
      },
    }),
  ]);

  const todayTotal = todayPayments.reduce((sum: number, s: any) => sum + (s.paymentAmount || 0), 0);
  const modeBreakdown: Record<string, { count: number; amount: number }> = {};
  todayPayments.forEach((s: any) => {
    const mode = s.paymentMode || 'OTHER';
    if (!modeBreakdown[mode]) modeBreakdown[mode] = { count: 0, amount: 0 };
    modeBreakdown[mode].count++;
    modeBreakdown[mode].amount += s.paymentAmount || 0;
  });

  res.json({
    pendingCount,
    todayCollections: { count: todayPayments.length, total: Math.round(todayTotal * 100) / 100, breakdown: modeBreakdown },
    recentConfirmed,
  });
}));

// ═══════════════════════════════════════════════
// GET /:id/history — Full order + shipment history for a shipment
// ═══════════════════════════════════════════════
router.get('/:id/history', asyncHandler(async (req: AuthRequest, res: Response) => {
  const shipment = await prisma.shipment.findUnique({
    where: { id: req.params.id },
    select: {
      id: true, shipmentNo: true, vehicleNo: true, customerName: true,
      productName: true, destination: true,
      weightTare: true, weightGross: true, weightNet: true,
      bags: true, weightPerBag: true,
      paymentTerms: true, paymentStatus: true, paymentMode: true,
      paymentRef: true, paymentAmount: true, paymentConfirmedAt: true,
      status: true, date: true,
      gateInTime: true, tareTime: true, loadStartTime: true,
      grossTime: true, releaseTime: true, exitTime: true,
      challanNo: true, invoiceRef: true,
      irn: true, irnStatus: true, irnDate: true,
      ewayBill: true, ewayBillDate: true, ewayBillStatus: true, ewayBillValid: true,
      grBiltyNo: true, grBiltyDate: true, grReceivedBack: true,
      driverName: true, driverMobile: true, transporterName: true,
      remarks: true, createdAt: true,
      dispatchRequest: {
        select: {
          id: true, drNo: true, quantity: true, unit: true, createdAt: true,
          order: {
            select: {
              id: true, orderNo: true, paymentTerms: true, status: true,
              grandTotal: true, createdAt: true,
              customer: { select: { id: true, name: true, phone: true, gstNo: true, city: true } },
              lines: { select: { productName: true, rate: true, gstPercent: true, quantity: true, unit: true, amount: true } },
            },
          },
        },
      },
      documents: { select: { id: true, docType: true, fileName: true, createdAt: true } },
    },
  });

  if (!shipment) throw new NotFoundError('Shipment', req.params.id);

  // Build timeline from timestamps
  const timeline: { time: string; event: string; detail?: string }[] = [];
  const s = shipment as any;
  if (s.createdAt) timeline.push({ time: s.createdAt, event: 'Shipment Created', detail: `Vehicle ${s.vehicleNo} registered` });
  if (s.gateInTime) timeline.push({ time: `${s.date?.toISOString?.().split('T')[0] || ''}T${s.gateInTime}`, event: 'Gate In', detail: `Driver: ${s.driverName || 'N/A'}` });
  if (s.tareTime) timeline.push({ time: `${s.date?.toISOString?.().split('T')[0] || ''}T${s.tareTime}`, event: 'Tare Weighed', detail: `${s.weightTare ? (s.weightTare / 1000).toFixed(2) + ' MT' : ''}` });
  if (s.grossTime) timeline.push({ time: `${s.date?.toISOString?.().split('T')[0] || ''}T${s.grossTime}`, event: 'Gross Weighed', detail: `Net: ${s.weightNet ? (s.weightNet / 1000).toFixed(3) + ' MT' : ''}` });
  if (s.invoiceRef) timeline.push({ time: s.irnDate || s.createdAt, event: 'Invoice Generated', detail: s.invoiceRef });
  if (s.paymentConfirmedAt) timeline.push({ time: s.paymentConfirmedAt, event: 'Payment Confirmed', detail: `${s.paymentMode} — ₹${s.paymentAmount?.toLocaleString('en-IN')}` });
  if (s.ewayBill) timeline.push({ time: s.ewayBillDate || s.createdAt, event: 'E-Way Bill Generated', detail: s.ewayBill });
  if (s.releaseTime) timeline.push({ time: `${s.date?.toISOString?.().split('T')[0] || ''}T${s.releaseTime}`, event: 'Vehicle Released' });
  if (s.exitTime) timeline.push({ time: `${s.date?.toISOString?.().split('T')[0] || ''}T${s.exitTime}`, event: 'Gate Exit' });

  res.json({ shipment, timeline });
}));

// ═══════════════════════════════════════════════
// POST /:id/confirm-payment — Accounts team confirms payment
// ═══════════════════════════════════════════════
router.post('/:id/confirm-payment', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id } });
  if (!shipment) throw new NotFoundError('Shipment', req.params.id);

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
      paymentConfirmedBy: req.user?.id || null,
    },
  });

  // Auto-journal: Dr Bank/Cash, Cr Receivable
  onShipmentPaymentConfirmed(prisma, {
    id: updated.id,
    shipmentNo: updated.shipmentNo,
    paymentAmount: parseFloat(b.paymentAmount),
    paymentMode: mode,
    paymentRef: b.paymentRef,
    userId: req.user?.id || 'system',
  }).catch(() => {});

  res.json({ success: true, shipment: updated });
}));

// ═══════════════════════════════════════════════
// DELETE /:id/payment — Revoke payment confirmation (reset to PENDING)
// ═══════════════════════════════════════════════
router.delete('/:id/payment', asyncHandler(async (req: AuthRequest, res: Response) => {
  const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id } });
  if (!shipment) throw new NotFoundError('Shipment', req.params.id);

  if (shipment.paymentStatus !== 'CONFIRMED') {
    res.status(400).json({ error: 'Can only revoke confirmed payments' });
    return;
  }

  // Don't allow if EWB already generated (payment was used to unlock EWB)
  if (shipment.ewayBill) {
    res.status(400).json({ error: 'Cannot revoke — e-way bill already generated against this payment' });
    return;
  }

  const updated = await prisma.shipment.update({
    where: { id: req.params.id },
    data: {
      paymentStatus: 'PENDING',
      paymentMode: null,
      paymentRef: null,
      paymentAmount: null,
      paymentConfirmedAt: null,
      paymentConfirmedBy: null,
    },
  });

  // Reverse the auto-generated journal entry for this payment
  try {
    const originalEntry = await prisma.journalEntry.findFirst({
      where: { refType: 'RECEIPT', refId: req.params.id, isReversed: false },
      include: { lines: true },
    });

    if (originalEntry) {
      await prisma.$transaction(async (tx: any) => {
        // Create reversal entry with debits/credits swapped
        await tx.journalEntry.create({
          data: {
            date: new Date(),
            narration: `Reversal: ${originalEntry.narration}`,
            refType: originalEntry.refType,
            refId: originalEntry.refId,
            isAutoGenerated: true,
            reversalOf: originalEntry.id,
            userId: req.user?.id || 'system',
            lines: {
              create: originalEntry.lines.map((l: { accountId: string; debit: number; credit: number; narration: string | null; costCenter: string | null }) => ({
                accountId: l.accountId,
                debit: l.credit,
                credit: l.debit,
                narration: l.narration ? `Reversal: ${l.narration}` : 'Reversal',
                costCenter: l.costCenter || 'DISTILLERY',
              })),
            },
          },
        });

        // Mark original as reversed
        await tx.journalEntry.update({
          where: { id: originalEntry.id },
          data: { isReversed: true },
        });
      });
    }
  } catch (err) {
    // Journal reversal failure is non-critical
  }

  res.json({ success: true, shipment: updated });
}));

export default router;
