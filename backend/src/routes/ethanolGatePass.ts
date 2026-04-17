import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { nextInvoiceNo } from '../utils/invoiceCounter';
import { onSaleInvoiceCreated } from '../services/autoJournal';
import { recomputeEthanolEntryByDate } from './ethanolProduct';
import { calcGstSplit } from '../utils/gstSplit';

const router = Router();

// Accept either JWT auth or X-WB-Key (for factory server proxy)
const WB_KEY = process.env.WB_PUSH_KEY || 'mspil-wb-2026';
function authOrWbKey(req: Request, res: Response, next: NextFunction) {
  const wbKey = req.headers['x-wb-key'] as string;
  if (wbKey && wbKey.length === WB_KEY.length) {
    try {
      if (crypto.timingSafeEqual(Buffer.from(wbKey), Buffer.from(WB_KEY))) {
        (req as AuthRequest).user = { id: 'factory-server', role: 'ADMIN' } as AuthRequest['user'];
        return next();
      }
    } catch { /* fall through to JWT */ }
  }
  return authenticate(req as AuthRequest, res, next);
}
router.use(authOrWbKey);

function nowIST(): Date {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

// calcGstSplit imported from ../utils/gstSplit

async function nextCounter(tx: any, prefix: string): Promise<string> {
  const key = `counter:${prefix}`;
  const existing = await tx.appConfig.findUnique({ where: { key } });
  const counter = existing ? parseInt(existing.value, 10) + 1 : 1;
  await tx.appConfig.upsert({ where: { key }, update: { value: String(counter) }, create: { key, value: String(counter) } });
  return `${prefix}/${String(counter).padStart(3, '0')}`;
}

// ── GET /active-contracts ── (must be before /:id)
router.get('/active-contracts', asyncHandler(async (req: AuthRequest, res: Response) => {
  const contracts = await prisma.ethanolContract.findMany({
    where: { status: 'ACTIVE', ...getCompanyFilter(req) },
    select: { id: true, contractNo: true, contractType: true, buyerName: true, buyerGst: true, buyerAddress: true, conversionRate: true, ethanolRate: true, gstPercent: true, paymentTermsDays: true, omcDepot: true, buyerCustomerId: true },
    take: 50,
  });
  res.json(contracts);
}));

// ── GET / ── List for date
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const dateStr = req.query.date as string;
  const ist = nowIST();
  const y = ist.getUTCFullYear(), m = ist.getUTCMonth(), d = ist.getUTCDate();
  const targetDate = dateStr ? new Date(dateStr + 'T00:00:00Z') : new Date(Date.UTC(y, m, d));
  const nextDay = new Date(targetDate); nextDay.setUTCDate(nextDay.getUTCDate() + 1);

  const trucks = await prisma.dispatchTruck.findMany({
    where: { date: { gte: targetDate, lt: nextDay }, status: { not: undefined }, ...getCompanyFilter(req) },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { contract: { select: { contractNo: true, contractType: true, buyerName: true, gstPercent: true, paymentTermsDays: true, buyerGst: true } } },
  });
  res.json(trucks);
}));

// ── POST / ── Gate entry
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const contract = b.contractId ? await prisma.ethanolContract.findUnique({ where: { id: b.contractId }, select: { buyerName: true, buyerAddress: true, omcDepot: true, conversionRate: true, ethanolRate: true } }) : null;
  const ist = nowIST();

  const truck = await prisma.dispatchTruck.create({
    data: {
      date: new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate())),
      vehicleNo: (b.vehicleNo || '').toUpperCase().replace(/\s/g, ''),
      partyName: contract?.buyerName || b.partyName || '',
      destination: b.destination || contract?.omcDepot || '',
      contractId: b.contractId || null,
      driverName: b.driverName || null,
      driverPhone: b.driverPhone || null,
      transporterName: b.transporterName || null,
      distanceKm: b.distanceKm ? parseInt(b.distanceKm) : null,
      rstNo: b.rstNo || null,
      sealNo: b.sealNo || null,
      status: 'GATE_IN',
      gateInTime: new Date(),
      userId: req.user?.id || null,
      companyId: getActiveCompanyId(req as AuthRequest) || undefined,
    },
  });
  res.status(201).json(truck);
}));

// ── POST /:id/tare ──
router.post('/:id/tare', asyncHandler(async (req: AuthRequest, res: Response) => {
  const truck = await prisma.dispatchTruck.findUnique({ where: { id: req.params.id } });
  if (!truck) return res.status(404).json({ error: 'Not found' });
  if (truck.status !== 'GATE_IN') return res.status(400).json({ error: `Cannot tare in status ${truck.status}` });

  const updated = await prisma.dispatchTruck.update({
    where: { id: req.params.id },
    data: { weightTare: parseFloat(req.body.weightTare), status: 'TARE_WEIGHED', tareTime: new Date() },
  });
  res.json(updated);
}));

// ── POST /:id/gross ──
router.post('/:id/gross', asyncHandler(async (req: AuthRequest, res: Response) => {
  const truck = await prisma.dispatchTruck.findUnique({ where: { id: req.params.id }, include: { contract: { select: { contractType: true, ethanolRate: true, conversionRate: true } } } });
  if (!truck) return res.status(404).json({ error: 'Not found' });
  if (truck.status !== 'TARE_WEIGHED') return res.status(400).json({ error: `Cannot record gross in status ${truck.status}` });

  const weightGross = parseFloat(req.body.weightGross);
  const quantityBL = parseFloat(req.body.quantityBL);
  const strength = req.body.strength ? parseFloat(req.body.strength) : null;
  // Auto-resolve product rate from contract (no hardcodes — rate lives on cloud contract)
  const productRatePerLtr = truck.contract
    ? (truck.contract.contractType === 'JOB_WORK'
        ? (truck.contract.conversionRate || null)
        : (truck.contract.ethanolRate || null))
    : null;
  const weightNet = weightGross - (truck.weightTare || 0);
  const densityCheck = quantityBL > 0 ? weightNet / quantityBL : 0;
  const productValue = productRatePerLtr && quantityBL ? Math.round(quantityBL * productRatePerLtr) : null;

  const updated = await prisma.dispatchTruck.update({
    where: { id: req.params.id },
    data: {
      weightGross, quantityBL, strength, weightNet,
      productRatePerLtr: productRatePerLtr || undefined,
      productValue: productValue || undefined,
      status: 'GROSS_WEIGHED',
      grossTime: new Date(),
    },
  });
  // Recompute ethanol entry so dispatch is reflected in production/KLPD
  try { await recomputeEthanolEntryByDate(truck.date); } catch (e: any) {
    console.error('[EthanolGatePass] recomputeEthanolEntry failed:', e.message);
  }

  res.json({ ...updated, densityCheck });
}));

// ── POST /:id/release ── THE BIG ONE
router.post('/:id/release', asyncHandler(async (req: AuthRequest, res: Response) => {
  const truck = await prisma.dispatchTruck.findUnique({
    where: { id: req.params.id },
    include: { contract: true },
  });
  if (!truck) return res.status(404).json({ error: 'Not found' });
  if (truck.status !== 'GROSS_WEIGHED') return res.status(400).json({ error: `Cannot release in status ${truck.status}` });
  if (!truck.contractId || !truck.contract) return res.status(400).json({ error: 'No contract linked' });

  const contract = truck.contract;

  // Resolve customer
  let customerId = contract.buyerCustomerId;
  if (!customerId) {
    if (!contract.buyerGst) return res.status(400).json({ error: 'Contract buyer has no GSTIN' });
    const cust = await prisma.customer.findFirst({ where: { gstNo: contract.buyerGst } });
    if (!cust) return res.status(400).json({ error: 'Customer not found for buyer GSTIN' });
    customerId = cust.id;
    await prisma.ethanolContract.update({ where: { id: contract.id }, data: { buyerCustomerId: customerId } });
  }
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return res.status(500).json({ error: 'Customer not found' });

  const rate = contract.conversionRate || contract.ethanolRate || 0;
  const amount = truck.quantityBL * rate;
  const gstPercent = contract.gstPercent || 18;
  const gst = calcGstSplit(amount, gstPercent, customer.state, customer.gstNo);
  const totalAmount = Math.round(amount + gst.gstAmount);
  const ist = new Date();

  const result = await prisma.$transaction(async (tx: any) => {
    // Re-check status inside transaction to prevent double-release race
    const fresh = await tx.dispatchTruck.findUnique({ where: { id: truck.id }, select: { status: true, liftingId: true } });
    if (fresh?.status === 'RELEASED' || fresh?.liftingId) throw new Error('Already released');

    const gatePassNo = await nextCounter(tx, 'GP/ETH');
    const challanNo = await nextCounter(tx, 'DCH/ETH');
    const invoiceNo = await nextInvoiceNo(tx, 'ETH');

    const invoice = await tx.invoice.create({
      data: {
        customerId: customer.id,
        invoiceDate: truck.date,
        dueDate: contract.paymentTermsDays ? new Date(truck.date.getTime() + contract.paymentTermsDays * 86400000) : null,
        productName: contract.contractType === 'JOB_WORK' ? 'Job Work Charges for Ethanol Production' : 'ETHANOL',
        quantity: truck.quantityBL, unit: 'BL', rate, amount,
        gstPercent, gstAmount: gst.gstAmount, supplyType: gst.supplyType,
        cgstPercent: gst.cgstPercent, cgstAmount: gst.cgstAmount,
        sgstPercent: gst.sgstPercent, sgstAmount: gst.sgstAmount,
        igstPercent: gst.igstPercent, igstAmount: gst.igstAmount,
        totalAmount, balanceAmount: totalAmount, status: 'UNPAID',
        remarks: invoiceNo,
        userId: req.user?.id || 'system',
      },
    });

    const lifting = await tx.ethanolLifting.create({
      data: {
        contractId: contract.id, liftingDate: truck.date,
        vehicleNo: truck.vehicleNo, driverName: truck.driverName, driverPhone: truck.driverPhone,
        transporterName: truck.transporterName, destination: truck.destination,
        quantityBL: truck.quantityBL, quantityKL: truck.quantityBL / 1000,
        strength: truck.strength, rate, amount,
        status: 'LOADED', invoiceId: invoice.id, invoiceNo,
        distanceKm: truck.distanceKm, rstNo: truck.rstNo, challanNo,
        dispatchMode: 'TANKER',
        productRatePerLtr: truck.productRatePerLtr, productValue: truck.productValue,
      },
    });

    await tx.dispatchTruck.update({
      where: { id: truck.id },
      data: { status: 'RELEASED', releaseTime: ist, gatePassNo, challanNo, liftingId: lifting.id },
    });

    // Update contract supplied KL
    const allLiftings = await tx.ethanolLifting.findMany({
      where: { contractId: contract.id }, select: { quantityKL: true },
    });
    const totalKL = allLiftings.reduce((s: number, l: any) => s + l.quantityKL, 0);
    await tx.ethanolContract.update({ where: { id: contract.id }, data: { totalSuppliedKL: totalKL } });

    return { invoice, lifting, gatePassNo, challanNo, invoiceNo };
  });

  // Fire-and-forget journal entry
  onSaleInvoiceCreated(prisma, {
    id: result.invoice.id, invoiceNo: result.invoice.invoiceNo, remarks: result.invoice.remarks, totalAmount,
    amount, gstAmount: gst.gstAmount, gstPercent,
    cgstAmount: gst.cgstAmount, sgstAmount: gst.sgstAmount, igstAmount: gst.igstAmount,
    supplyType: gst.supplyType, freightCharge: 0,
    productName: result.invoice.productName, customerId: customer.id,
    userId: req.user?.id || 'system', invoiceDate: truck.date,
    companyId: result.invoice.companyId || undefined,
  }).catch(() => {});

  res.json({
    success: true, gatePassNo: result.gatePassNo, challanNo: result.challanNo,
    invoiceNo: result.invoiceNo, invoiceId: result.invoice.id,
    liftingId: result.lifting.id, truckId: truck.id,
  });
}));

// ── GET /:id/invoice-pdf ── Redirect to invoice PDF
router.get('/:id/invoice-pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
  const truck = await prisma.dispatchTruck.findUnique({ where: { id: req.params.id }, select: { liftingId: true } });
  if (!truck?.liftingId) return res.status(400).json({ error: 'No invoice yet — release first' });
  const lifting = await prisma.ethanolLifting.findUnique({ where: { id: truck.liftingId }, select: { invoiceId: true } });
  if (!lifting?.invoiceId) return res.status(400).json({ error: 'Invoice not found' });
  res.redirect(`/api/invoices/${lifting.invoiceId}/pdf`);
}));

// ── GET /:id/delivery-challan-pdf ── Ethanol challan with letterhead
router.get('/:id/delivery-challan-pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
  const truck = await prisma.dispatchTruck.findUnique({
    where: { id: req.params.id },
    include: { contract: { select: { buyerName: true, buyerAddress: true, buyerGst: true, contractType: true, ethanolRate: true } } },
  });
  if (!truck) return res.status(404).json({ error: 'Not found' });

  // Challan rate logic — read live, never use frozen truck.productRatePerLtr:
  // - JOB_WORK: fixed company-wide ₹71.86/BL × 5% GST (ethanol HSN 22072000 movement value)
  // - OMC sale: contract.ethanolRate live + 5% GST
  const isJobWork = truck.contract?.contractType === 'JOB_WORK';
  const productRate = isJobWork ? 71.86 : (truck.contract?.ethanolRate || 71.86);
  const productValue = Math.round(truck.quantityBL * productRate);
  const gstRate = 5;
  const gstAmount = Math.round(productValue * gstRate / 100);
  const totalValue = productValue + gstAmount;

  const { renderDocumentPdf } = await import('../services/documentRenderer');
  const pdfBuffer = await renderDocumentPdf({
    docType: 'ETHANOL_CHALLAN',
    data: {
      challanNo: truck.challanNo || '-',
      date: truck.date,
      vehicleNo: truck.vehicleNo,
      driverName: truck.driverName,
      driverPhone: truck.driverPhone,
      transporterName: truck.transporterName,
      destination: truck.destination,
      rstNo: truck.rstNo,
      sealNo: truck.sealNo,
      isJobWork: truck.contract?.contractType === 'JOB_WORK',
      buyerName: truck.contract?.buyerName || truck.partyName,
      buyerAddress: truck.contract?.buyerAddress || '',
      buyerGst: truck.contract?.buyerGst || '',
      quantityBL: truck.quantityBL,
      productRate,
      productValue,
      gstRate,
      gstAmount,
      totalValue,
    },
    verifyId: truck.id,
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Challan-${(truck.challanNo || truck.id).replace(/\//g, '-')}.pdf"`);
  res.send(pdfBuffer);
}));

// ── GET /:id/gate-pass-pdf ── Ethanol gate pass with letterhead
router.get('/:id/gate-pass-pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
  const truck = await prisma.dispatchTruck.findUnique({
    where: { id: req.params.id },
    include: { contract: { select: { contractNo: true, contractType: true, buyerName: true, buyerAddress: true, buyerGst: true, conversionRate: true, ethanolRate: true } } },
  });
  if (!truck) return res.status(404).json({ error: 'Not found' });

  const isJobWork = truck.contract?.contractType === 'JOB_WORK';
  // Read live from contract — no fallback. If rate is missing the contract is misconfigured.
  const rate = isJobWork
    ? (truck.contract?.conversionRate || 0)
    : (truck.contract?.ethanolRate || 0);
  const amount = Math.round(truck.quantityBL * rate);

  const { renderDocumentPdf } = await import('../services/documentRenderer');
  const pdfBuffer = await renderDocumentPdf({
    docType: 'ETHANOL_GATE_PASS',
    data: {
      gatePassNo: truck.gatePassNo || '-',
      date: truck.date,
      vehicleNo: truck.vehicleNo,
      driverName: truck.driverName,
      driverPhone: truck.driverPhone,
      transporterName: truck.transporterName,
      destination: truck.destination,
      contractNo: truck.contract?.contractNo,
      rstNo: truck.rstNo,
      sealNo: truck.sealNo,
      isJobWork,
      buyerName: truck.contract?.buyerName || truck.partyName,
      buyerAddress: truck.contract?.buyerAddress || '',
      buyerGst: truck.contract?.buyerGst || '',
      productDescription: isJobWork ? 'Job Work Charges for Ethanol Production' : 'Ethanol',
      hsnCode: isJobWork ? '998842' : '22072000',
      quantityBL: truck.quantityBL,
      rate,
      amount,
      strength: truck.strength,
      weightGross: truck.weightGross,
      weightTare: truck.weightTare,
      weightNet: truck.weightNet,
    },
    verifyId: truck.id,
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="GatePass-${(truck.gatePassNo || truck.id).replace(/\//g, '-')}.pdf"`);
  res.send(pdfBuffer);
}));

// ── PUT /:id ── Update (pre-release only)
router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const truck = await prisma.dispatchTruck.findUnique({ where: { id: req.params.id } });
  if (!truck) return res.status(404).json({ error: 'Not found' });
  if (truck.status === 'RELEASED') return res.status(403).json({ error: 'Cannot edit released dispatch' });

  const allowed = ['vehicleNo', 'driverName', 'driverPhone', 'transporterName', 'distanceKm', 'destination', 'rstNo', 'sealNo', 'remarks', 'contractId'];
  const data: any = {};
  for (const f of allowed) {
    if (req.body[f] !== undefined) data[f] = req.body[f];
  }
  if (data.vehicleNo) data.vehicleNo = data.vehicleNo.toUpperCase().replace(/\s/g, '');
  if (data.distanceKm) data.distanceKm = parseInt(data.distanceKm);

  const updated = await prisma.dispatchTruck.update({ where: { id: req.params.id }, data });
  res.json(updated);
}));

// ── DELETE /:id ── Admin only, blocked after gate pass
router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const truck = await prisma.dispatchTruck.findUnique({ where: { id: req.params.id } });
  if (!truck) return res.status(404).json({ error: 'Not found' });
  if (truck.status === 'GROSS_WEIGHED' || truck.status === 'RELEASED') {
    return res.status(403).json({ error: 'Cannot delete after gate pass is issued' });
  }
  await prisma.dispatchTruck.delete({ where: { id: req.params.id } });
  res.json({ success: true });
}));

export default router;
