import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import multer from 'multer';
import { nextSugarContractNo } from '../utils/contractNoGenerator';

const SUGAR_GST_PCT = 5;

const p = (v: any): number | null => v !== undefined && v !== null && v !== '' ? parseFloat(v) : null;
const pInt = (v: any): number | null => v !== undefined && v !== null && v !== '' ? parseInt(v) : null;

const router = Router();
router.use(authenticate as any);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── GET all contracts ──
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { status } = req.query;
  const where: any = { ...getCompanyFilter(req) };
  if (status && status !== 'ALL') where.status = status;

  const contracts = await prisma.sugarContract.findMany({
    where,
    take: 500,
    include: { customer: { select: { id: true, name: true, gstNo: true, state: true } } },
    orderBy: { createdAt: 'desc' },
  }).then(rows => rows.map(({ contractPdf, ...rest }) => ({ ...rest, hasPdf: !!contractPdf })));

  const stats = {
    total: contracts.length,
    active: contracts.filter((c: any) => c.status === 'ACTIVE').length,
    totalContractQtyMT: contracts.reduce((s: number, c: any) => s + (c.contractQtyMT || 0), 0),
    totalSuppliedMT: contracts.reduce((s: number, c: any) => s + (c.totalSuppliedMT || 0), 0),
  };

  res.json({ contracts, stats });
}));

// ── GET single contract ──
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const raw = await prisma.sugarContract.findUnique({
    where: { id: req.params.id },
    include: {
      customer: { select: { id: true, name: true, gstNo: true, state: true, address: true, pincode: true, city: true, phone: true, email: true } },
      dispatches: {
        orderBy: { dispatchDate: 'desc' },
        include: {
          invoice: {
            select: {
              id: true, invoiceNo: true, totalAmount: true, paidAmount: true, status: true,
              irn: true, irnStatus: true, ewbNo: true, ewbStatus: true,
            },
          },
        },
      },
    },
  });
  if (!raw) return res.status(404).json({ error: 'Contract not found' });
  const { contractPdf, ...contract } = raw;
  res.json({ contract: { ...contract, hasPdf: !!contractPdf } });
}));

// ── POST create contract ──
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;

  if (!b.customerId) return res.status(400).json({ error: 'customerId is required' });
  const customer = await prisma.customer.findUnique({ where: { id: b.customerId } });
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  // Sugar deal types: only FIXED_RATE or SPOT
  const dealType = b.dealType === 'SPOT' ? 'SPOT' : 'FIXED_RATE';

  const contractNo = (b.contractNo && String(b.contractNo).trim()) || await nextSugarContractNo();

  const contract = await prisma.sugarContract.create({
    data: {
      contractNo,
      status: b.status || 'ACTIVE',
      dealType,
      customerId: customer.id,
      buyerName: b.buyerName || customer.name,
      buyerAddress: b.buyerAddress || customer.address || null,
      buyerGstin: b.buyerGstin || customer.gstNo || null,
      buyerState: b.buyerState || customer.state || null,
      buyerContact: b.buyerContact || null,
      buyerPhone: b.buyerPhone || customer.phone || null,
      buyerEmail: b.buyerEmail || customer.email || null,
      supplyType: b.supplyType || null,
      startDate: new Date(b.startDate),
      endDate: new Date(b.endDate),
      contractQtyMT: p(b.contractQtyMT) || 0,
      rate: p(b.rate) || 0,
      gstPercent: p(b.gstPercent) ?? SUGAR_GST_PCT,
      paymentTermsDays: pInt(b.paymentTermsDays),
      paymentMode: b.paymentMode || null,
      logisticsBy: b.logisticsBy || 'BUYER',
      remarks: b.remarks || null,
      userId: req.user?.id || 'system',
      companyId: getActiveCompanyId(req),
    },
  });
  res.json({ contract });
}));

// ── PUT update contract ──
router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const existing = await prisma.sugarContract.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Contract not found' });

  let buyerName = existing.buyerName;
  let buyerAddress = existing.buyerAddress;
  let buyerGstin = existing.buyerGstin;
  let buyerState = existing.buyerState;
  let customerId = existing.customerId;

  if (b.customerId && b.customerId !== existing.customerId) {
    const cust = await prisma.customer.findUnique({ where: { id: b.customerId } });
    if (!cust) return res.status(404).json({ error: 'Customer not found' });
    customerId = cust.id;
    buyerName = b.buyerName || cust.name;
    buyerAddress = b.buyerAddress ?? cust.address ?? null;
    buyerGstin = b.buyerGstin ?? cust.gstNo ?? null;
    buyerState = b.buyerState ?? cust.state ?? null;
  } else {
    if (b.buyerName !== undefined) buyerName = b.buyerName;
    if (b.buyerAddress !== undefined) buyerAddress = b.buyerAddress;
    if (b.buyerGstin !== undefined) buyerGstin = b.buyerGstin;
    if (b.buyerState !== undefined) buyerState = b.buyerState;
  }

  const dealType = b.dealType === 'SPOT' ? 'SPOT' : (b.dealType === 'FIXED_RATE' ? 'FIXED_RATE' : existing.dealType);

  const contract = await prisma.sugarContract.update({
    where: { id: req.params.id },
    data: {
      contractNo: b.contractNo ?? existing.contractNo,
      status: b.status ?? existing.status,
      dealType,
      customerId,
      buyerName,
      buyerAddress,
      buyerGstin,
      buyerState,
      buyerContact: b.buyerContact !== undefined ? b.buyerContact : existing.buyerContact,
      buyerPhone: b.buyerPhone !== undefined ? b.buyerPhone : existing.buyerPhone,
      buyerEmail: b.buyerEmail !== undefined ? b.buyerEmail : existing.buyerEmail,
      supplyType: b.supplyType !== undefined ? b.supplyType : existing.supplyType,
      startDate: b.startDate ? new Date(b.startDate) : existing.startDate,
      endDate: b.endDate ? new Date(b.endDate) : existing.endDate,
      contractQtyMT: b.contractQtyMT !== undefined ? (p(b.contractQtyMT) || 0) : existing.contractQtyMT,
      rate: b.rate !== undefined ? (p(b.rate) || 0) : existing.rate,
      gstPercent: b.gstPercent !== undefined ? (p(b.gstPercent) ?? SUGAR_GST_PCT) : existing.gstPercent,
      paymentTermsDays: b.paymentTermsDays !== undefined ? pInt(b.paymentTermsDays) : existing.paymentTermsDays,
      paymentMode: b.paymentMode !== undefined ? b.paymentMode : existing.paymentMode,
      logisticsBy: b.logisticsBy !== undefined ? b.logisticsBy : existing.logisticsBy,
      remarks: b.remarks !== undefined ? b.remarks : existing.remarks,
    },
  });
  res.json({ contract });
}));

// ── DELETE contract (only if no dispatches) ──
router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const contract = await prisma.sugarContract.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { dispatches: true } } },
  });
  if (!contract) return res.status(404).json({ error: 'Not found' });
  if (contract._count.dispatches > 0) {
    return res.status(400).json({ error: 'Cannot delete contract with dispatches. Terminate instead.' });
  }
  await prisma.sugarContract.delete({ where: { id: req.params.id } });
  res.json({ success: true });
}));

// ── PDF UPLOAD ──
router.post('/:id/pdf', upload.single('pdf'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const file = (req as any).file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  const base64 = file.buffer.toString('base64');
  const contract = await prisma.sugarContract.update({
    where: { id: req.params.id },
    data: { contractPdf: base64, contractPdfName: file.originalname },
  });
  res.json({ success: true, filename: contract.contractPdfName });
}));

// ── PDF DOWNLOAD ──
router.get('/:id/pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
  const contract = await prisma.sugarContract.findUnique({
    where: { id: req.params.id },
    select: { contractPdf: true, contractPdfName: true },
  });
  if (!contract || !contract.contractPdf) return res.status(404).json({ error: 'No PDF attached' });

  const buffer = Buffer.from(contract.contractPdf, 'base64');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${contract.contractPdfName || 'contract.pdf'}"`);
  res.send(buffer);
}));

// ── SUPPLY SUMMARY ──
router.get('/:id/supply-summary', asyncHandler(async (req: AuthRequest, res: Response) => {
  const raw = await prisma.sugarContract.findUnique({
    where: { id: req.params.id },
    include: {
      customer: { select: { id: true, name: true, gstNo: true, state: true } },
      dispatches: {
        orderBy: { dispatchDate: 'desc' },
        include: {
          invoice: {
            select: {
              id: true, invoiceNo: true, totalAmount: true, paidAmount: true, balanceAmount: true, status: true,
              amount: true, quantity: true, rate: true, unit: true, productName: true,
              gstPercent: true, gstAmount: true, cgstAmount: true, sgstAmount: true, igstAmount: true,
              supplyType: true,
              irn: true, irnDate: true, irnStatus: true, ackNo: true,
              ewbNo: true, ewbDate: true, ewbValidTill: true, ewbStatus: true,
            },
          },
        },
      },
    },
  });
  if (!raw) return res.status(404).json({ error: 'Contract not found' });
  const { contractPdf, ...contract } = raw;

  const activeStatuses = new Set(['DISPATCHED', 'IN_TRANSIT']);
  const dispatches = contract.dispatches.sort((a, b) => {
    const aActive = activeStatuses.has(a.status) ? 0 : 1;
    const bActive = activeStatuses.has(b.status) ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return new Date(b.dispatchDate).getTime() - new Date(a.dispatchDate).getTime();
  });

  let totalInvoiceAmount = 0;
  let totalPaid = 0;
  for (const d of dispatches) {
    if (d.invoice) {
      totalInvoiceAmount += d.invoice.totalAmount || 0;
      totalPaid += d.invoice.paidAmount || 0;
    }
  }

  const summary = {
    contractQtyMT: contract.contractQtyMT || 0,
    suppliedMT: contract.totalSuppliedMT || 0,
    remainingMT: Math.max(0, (contract.contractQtyMT || 0) - (contract.totalSuppliedMT || 0)),
    progressPct: contract.contractQtyMT ? Math.round(((contract.totalSuppliedMT || 0) / contract.contractQtyMT) * 100) : 0,
    invoicedAmount: totalInvoiceAmount,
    receivedAmount: totalPaid,
    outstanding: Math.round((totalInvoiceAmount - totalPaid) * 100) / 100,
    totalDispatches: dispatches.length,
    daysRemaining: Math.max(0, Math.ceil((new Date(contract.endDate).getTime() - Date.now()) / 86400000)),
  };

  // In-progress trucks at weighbridge
  const activeTrucks = await prisma.sugarDispatchTruck.findMany({
    where: { contractId: contract.id, status: { in: ['GATE_IN', 'TARE_WEIGHED', 'GROSS_WEIGHED'] } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true, date: true, vehicleNo: true, driverName: true, driverMobile: true,
      transporterName: true, destination: true, status: true,
      bags: true, weightPerBag: true, weightGross: true, weightTare: true, weightNet: true,
      gateInTime: true, tareTime: true, grossTime: true, partyName: true,
    },
  });

  res.json({ contract: { ...contract, hasPdf: !!contractPdf }, summary, dispatches, activeTrucks });
}));

// ── POST manual dispatch row under contract ──
// (auto-invoicing happens via the weighbridge handler when a real truck is pushed.
// This endpoint records ad-hoc dispatch metadata only — no Invoice is created here.)
router.post('/:id/dispatches', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const contract = await prisma.sugarContract.findUnique({ where: { id: req.params.id } });
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  const weightNetMT = p(b.weightNetMT) || 0;
  const rate = p(b.rate) ?? contract.rate;
  const amount = Math.round(weightNetMT * (rate || 0) * 100) / 100;

  const dispatch = await prisma.sugarContractDispatch.create({
    data: {
      contractId: contract.id,
      dispatchDate: b.dispatchDate ? new Date(b.dispatchDate) : new Date(),
      vehicleNo: b.vehicleNo || '',
      driverName: b.driverName || null,
      driverPhone: b.driverPhone || null,
      transporterName: b.transporterName || null,
      destination: b.destination || null,
      bags: pInt(b.bags) || 0,
      weightPerBag: p(b.weightPerBag) || 50,
      weightGrossMT: p(b.weightGrossMT) || 0,
      weightTareMT: p(b.weightTareMT) || 0,
      weightNetMT,
      rate: rate || 0,
      amount,
      distanceKm: p(b.distanceKm),
      challanNo: b.challanNo || null,
      gatePassNo: b.gatePassNo || null,
      status: b.status || 'DISPATCHED',
      remarks: b.remarks || null,
    },
  });
  res.json({ dispatch });
}));

// ── PUT update manual dispatch row ──
router.put('/dispatches/:dispatchId', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const existing = await prisma.sugarContractDispatch.findUnique({ where: { id: req.params.dispatchId } });
  if (!existing) return res.status(404).json({ error: 'Dispatch not found' });
  if (existing.invoiceId) return res.status(409).json({ error: 'Cannot edit invoiced dispatch' });

  const data: any = {};
  if (b.dispatchDate !== undefined) data.dispatchDate = new Date(b.dispatchDate);
  ['vehicleNo', 'driverName', 'driverPhone', 'transporterName', 'destination', 'challanNo', 'gatePassNo', 'status', 'remarks'].forEach(f => {
    if (b[f] !== undefined) data[f] = b[f];
  });
  ['bags', 'weightPerBag', 'weightGrossMT', 'weightTareMT', 'weightNetMT', 'rate', 'distanceKm'].forEach(f => {
    if (b[f] !== undefined) data[f] = parseFloat(b[f]) || 0;
  });
  if (data.weightNetMT !== undefined || data.rate !== undefined) {
    const net = data.weightNetMT ?? existing.weightNetMT;
    const r = data.rate ?? existing.rate;
    data.amount = Math.round(net * r * 100) / 100;
  }
  const dispatch = await prisma.sugarContractDispatch.update({ where: { id: req.params.dispatchId }, data });
  res.json({ dispatch });
}));

// ── DELETE manual dispatch row ──
router.delete('/dispatches/:dispatchId', asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.sugarContractDispatch.findUnique({ where: { id: req.params.dispatchId } });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.invoiceId) return res.status(409).json({ error: 'Cannot delete invoiced dispatch' });
  await prisma.sugarContractDispatch.delete({ where: { id: req.params.dispatchId } });
  res.json({ success: true });
}));

// ── PATCH auto-einvoice toggle ──
router.patch('/:id/auto-einvoice', asyncHandler(async (req: AuthRequest, res: Response) => {
  const enable = !!req.body.enable;
  const contract = await prisma.sugarContract.update({
    where: { id: req.params.id },
    data: { autoGenerateEInvoice: enable },
  });
  res.json({ contract });
}));

export default router;
