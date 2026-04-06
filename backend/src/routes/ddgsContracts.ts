import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import multer from 'multer';
import { generateIRN, generateEWBByIRN } from '../services/eInvoice';
import { onSaleInvoiceCreated } from '../services/autoJournal';
import { nextInvoiceNo } from '../utils/invoiceCounter';

const COMPANY_STATE = 'Madhya Pradesh';
const DDGS_HSN = '2303';
const DDGS_GST_PCT = 5;

const p = (v: any): number | null => v !== undefined && v !== null && v !== '' ? parseFloat(v) : null;
const pInt = (v: any): number | null => v !== undefined && v !== null && v !== '' ? parseInt(v) : null;

function calcGstSplit(amount: number, gstPercent: number, customerState: string | null | undefined) {
  const gstAmount = Math.round((amount * gstPercent) / 100 * 100) / 100;
  const isInterstate = customerState && customerState !== COMPANY_STATE;
  if (isInterstate) {
    return { supplyType: 'INTER_STATE' as const, cgstPercent: 0, cgstAmount: 0, sgstPercent: 0, sgstAmount: 0, igstPercent: gstPercent, igstAmount: gstAmount, gstAmount };
  }
  const half = Math.round(gstAmount / 2 * 100) / 100;
  return { supplyType: 'INTRA_STATE' as const, cgstPercent: gstPercent / 2, cgstAmount: half, sgstPercent: gstPercent / 2, sgstAmount: Math.round((gstAmount - half) * 100) / 100, igstPercent: 0, igstAmount: 0, gstAmount };
}

const router = Router();
router.use(authenticate as any);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── GET all contracts ──
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { status } = req.query;
  const where: any = {};
  if (status && status !== 'ALL') where.status = status;

  const contracts = await prisma.dDGSContract.findMany({
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

// ── GET single contract with all dispatches ──
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const raw = await prisma.dDGSContract.findUnique({
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

  const contract = await prisma.dDGSContract.create({
    data: {
      contractNo: b.contractNo,
      status: b.status || 'ACTIVE',
      customerId: customer.id,
      buyerName: customer.name,
      buyerAddress: customer.address || null,
      buyerGstin: customer.gstNo || null,
      buyerState: customer.state || null,
      startDate: new Date(b.startDate),
      endDate: new Date(b.endDate),
      contractQtyMT: p(b.contractQtyMT) || 0,
      rate: p(b.rate) || 0,
      gstPercent: p(b.gstPercent) ?? DDGS_GST_PCT,
      paymentTermsDays: pInt(b.paymentTermsDays),
      paymentMode: b.paymentMode || null,
      logisticsBy: b.logisticsBy || 'BUYER',
      remarks: b.remarks || null,
      userId: (req as AuthRequest).user?.id || 'system',
    },
  });
  res.json({ contract });
}));

// ── PUT update contract ──
router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const existing = await prisma.dDGSContract.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Contract not found' });

  // If customerId changed, look up new customer
  let buyerName = existing.buyerName;
  let buyerAddress = existing.buyerAddress;
  let buyerGstin = existing.buyerGstin;
  let buyerState = existing.buyerState;
  let customerId = existing.customerId;

  if (b.customerId && b.customerId !== existing.customerId) {
    const cust = await prisma.customer.findUnique({ where: { id: b.customerId } });
    if (!cust) return res.status(404).json({ error: 'Customer not found' });
    customerId = cust.id;
    buyerName = cust.name;
    buyerAddress = cust.address || null;
    buyerGstin = cust.gstNo || null;
    buyerState = cust.state || null;
  }

  const contract = await prisma.dDGSContract.update({
    where: { id: req.params.id },
    data: {
      contractNo: b.contractNo ?? existing.contractNo,
      status: b.status ?? existing.status,
      customerId,
      buyerName,
      buyerAddress,
      buyerGstin,
      buyerState,
      startDate: b.startDate ? new Date(b.startDate) : existing.startDate,
      endDate: b.endDate ? new Date(b.endDate) : existing.endDate,
      contractQtyMT: b.contractQtyMT !== undefined ? (p(b.contractQtyMT) || 0) : existing.contractQtyMT,
      rate: b.rate !== undefined ? (p(b.rate) || 0) : existing.rate,
      gstPercent: b.gstPercent !== undefined ? (p(b.gstPercent) ?? DDGS_GST_PCT) : existing.gstPercent,
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
  const contract = await prisma.dDGSContract.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { dispatches: true } } },
  });
  if (!contract) return res.status(404).json({ error: 'Not found' });
  if (contract._count.dispatches > 0) {
    return res.status(400).json({ error: 'Cannot delete contract with dispatches. Terminate instead.' });
  }
  await prisma.dDGSContract.delete({ where: { id: req.params.id } });
  res.json({ success: true });
}));

// ── PDF UPLOAD ──
router.post('/:id/pdf', upload.single('pdf'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const file = (req as any).file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  const base64 = file.buffer.toString('base64');
  const contract = await prisma.dDGSContract.update({
    where: { id: req.params.id },
    data: { contractPdf: base64, contractPdfName: file.originalname },
  });
  res.json({ success: true, filename: contract.contractPdfName });
}));

// ── PDF DOWNLOAD ──
router.get('/:id/pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
  const contract = await prisma.dDGSContract.findUnique({
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
  const raw = await prisma.dDGSContract.findUnique({
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
              supplyType: true, freightCharge: true,
              irn: true, irnDate: true, irnStatus: true, ackNo: true, signedQRCode: true,
              ewbNo: true, ewbDate: true, ewbValidTill: true, ewbStatus: true,
            },
          },
        },
      },
    },
  });
  if (!raw) return res.status(404).json({ error: 'Contract not found' });
  const { contractPdf, ...contract } = raw;

  // Sort: active (DISPATCHED/IN_TRANSIT) first, then by date desc
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

  res.json({ contract: { ...contract, hasPdf: !!contractPdf }, summary, dispatches });
}));

// ── POST dispatch under contract ──
router.post('/:id/dispatches', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;

  const contract = await prisma.dDGSContract.findUnique({
    where: { id: req.params.id },
    include: { customer: { select: { id: true, name: true, gstNo: true, state: true, address: true, pincode: true, city: true, phone: true, email: true } } },
  });
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  const bags = pInt(b.bags) || 0;
  const weightPerBag = p(b.weightPerBag) || 50;
  const weightGrossMT = p(b.weightGrossMT) || 0;
  const weightTareMT = p(b.weightTareMT) || 0;
  let weightNetMT: number;
  if (weightGrossMT > 0 && weightTareMT > 0) {
    weightNetMT = Math.round((weightGrossMT - weightTareMT) * 1000) / 1000;
  } else {
    weightNetMT = Math.round((bags * weightPerBag / 1000) * 1000) / 1000;
  }

  const rate = p(b.rate) || contract.rate;
  const amount = Math.round(weightNetMT * rate * 100) / 100;

  // Atomic: create dispatch + update contract totals
  const dispatch = await prisma.$transaction(async (tx) => {
    const d = await tx.dDGSContractDispatch.create({
      data: {
        contractId: req.params.id,
        dispatchDate: b.dispatchDate ? new Date(b.dispatchDate) : new Date(),
        vehicleNo: b.vehicleNo || '',
        driverName: b.driverName || null,
        driverPhone: b.driverPhone || null,
        transporterName: b.transporterName || null,
        destination: b.destination || null,
        bags,
        weightPerBag,
        weightGrossMT,
        weightTareMT,
        weightNetMT,
        rate,
        amount,
        distanceKm: p(b.distanceKm),
        challanNo: b.challanNo || null,
        gatePassNo: b.gatePassNo || null,
        status: 'DISPATCHED',
        remarks: b.remarks || null,
      },
    });
    await tx.dDGSContract.update({
      where: { id: req.params.id },
      data: { totalSuppliedMT: { increment: weightNetMT } },
    });
    return d;
  });

  // Auto e-invoice: fire-and-forget if enabled
  if (contract.autoGenerateEInvoice && rate > 0 && amount > 0 && contract.buyerGstin) {
    setImmediate(async () => {
      try {
        const customer = contract.customer;
        if (!customer) throw new Error('Customer not found');

        // Create invoice
        const gstPercent = contract.gstPercent || DDGS_GST_PCT;
        const gst = calcGstSplit(amount, gstPercent, customer.state);
        const total = Math.round((amount + gst.gstAmount) * 100) / 100;

        const inv = await prisma.$transaction(async (tx) => {
          const customInvNo = await nextInvoiceNo(tx, 'DDGS');

          const invoice = await tx.invoice.create({
            data: {
              customerId: customer.id,
              invoiceDate: dispatch.dispatchDate,
              productName: 'DDGS',
              quantity: weightNetMT,
              unit: 'MT',
              rate,
              amount,
              gstPercent,
              gstAmount: gst.gstAmount,
              supplyType: gst.supplyType,
              cgstPercent: gst.cgstPercent,
              cgstAmount: gst.cgstAmount,
              sgstPercent: gst.sgstPercent,
              sgstAmount: gst.sgstAmount,
              igstPercent: gst.igstPercent,
              igstAmount: gst.igstAmount,
              totalAmount: total,
              balanceAmount: total,
              status: 'UNPAID',
              remarks: customInvNo,
              userId: 'system',
            },
          });

          await tx.dDGSContractDispatch.update({
            where: { id: dispatch.id },
            data: { invoiceId: invoice.id },
          });

          return invoice;
        });

        // Auto-journal
        onSaleInvoiceCreated(prisma, {
          id: inv.id, invoiceNo: inv.invoiceNo, totalAmount: total,
          amount, gstAmount: gst.gstAmount, gstPercent,
          cgstAmount: gst.cgstAmount, sgstAmount: gst.sgstAmount, igstAmount: gst.igstAmount,
          supplyType: gst.supplyType, productName: 'DDGS',
          customerId: customer.id, userId: 'system', invoiceDate: dispatch.dispatchDate,
          customer: { state: customer.state },
        });

        // Generate IRN
        if (customer.gstNo && customer.state && customer.pincode && customer.address) {
          const irnRes = await generateIRN({
            invoiceNo: inv.remarks || `INV-${inv.invoiceNo}`,
            invoiceDate: inv.invoiceDate,
            productName: 'DDGS', quantity: inv.quantity, unit: 'MT', rate: inv.rate, amount: inv.amount, gstPercent: inv.gstPercent,
            customer: { gstin: customer.gstNo, name: customer.name, address: customer.address, city: customer.city || '', pincode: customer.pincode, state: customer.state, phone: customer.phone || '', email: customer.email || '' },
          });
          if (irnRes.success && irnRes.irn) {
            await prisma.invoice.update({
              where: { id: inv.id },
              data: { irn: irnRes.irn, irnDate: new Date(), irnStatus: 'GENERATED', ackNo: irnRes.ackNo ? String(irnRes.ackNo) : null, signedQRCode: irnRes.signedQRCode?.slice(0, 4000) || null } as any,
            });

            // Generate EWB
            const vehNo = (dispatch.vehicleNo || '').replace(/\s/g, '');
            const autoEwbData: Record<string, any> = { Irn: irnRes.irn, Distance: 100, TransMode: '1', VehNo: vehNo, VehType: 'R' };
            if (dispatch.transporterName && dispatch.transporterName.length >= 3) autoEwbData.TransName = dispatch.transporterName;
            const ewbRes = await generateEWBByIRN(irnRes.irn, autoEwbData);
            if (ewbRes.success && ewbRes.ewayBillNo) {
              await prisma.invoice.update({ where: { id: inv.id }, data: { ewbNo: ewbRes.ewayBillNo, ewbDate: new Date(), ewbStatus: 'GENERATED' } as any });
            }
          }
        }
      } catch (err: any) {
        // Structured error logging only
        process.stderr.write(`[DDGSContract] Auto e-invoice failed for dispatch ${dispatch.id}: ${err.message}\n`);
      }
    });
  }

  res.json({ dispatch });
}));

// ── PUT update dispatch ──
router.put('/dispatches/:dispatchId', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const existing = await prisma.dDGSContractDispatch.findUnique({ where: { id: req.params.dispatchId } });
  if (!existing) return res.status(404).json({ error: 'Dispatch not found' });

  const dispatch = await prisma.dDGSContractDispatch.update({
    where: { id: req.params.dispatchId },
    data: {
      status: b.status ?? existing.status,
      distanceKm: b.distanceKm !== undefined ? p(b.distanceKm) : existing.distanceKm,
      transporterName: b.transporterName !== undefined ? b.transporterName : existing.transporterName,
      destination: b.destination !== undefined ? b.destination : existing.destination,
      driverName: b.driverName !== undefined ? b.driverName : existing.driverName,
      driverPhone: b.driverPhone !== undefined ? b.driverPhone : existing.driverPhone,
      vehicleNo: b.vehicleNo !== undefined ? b.vehicleNo : existing.vehicleNo,
      remarks: b.remarks !== undefined ? b.remarks : existing.remarks,
    },
  });

  res.json({ dispatch });
}));

// ── DELETE dispatch ──
router.delete('/dispatches/:dispatchId', asyncHandler(async (req: AuthRequest, res: Response) => {
  const dispatch = await prisma.dDGSContractDispatch.findUnique({ where: { id: req.params.dispatchId } });
  if (!dispatch) return res.status(404).json({ error: 'Not found' });
  if (dispatch.invoiceId) return res.status(400).json({ error: 'Cannot delete dispatch with linked invoice. Void the invoice first.' });

  // Atomic: reverse totals + delete
  await prisma.$transaction([
    prisma.dDGSContract.update({
      where: { id: dispatch.contractId },
      data: { totalSuppliedMT: { decrement: dispatch.weightNetMT } },
    }),
    prisma.dDGSContractDispatch.delete({ where: { id: req.params.dispatchId } }),
  ]);
  res.json({ success: true });
}));

// ── CREATE INVOICE from dispatch ──
router.post('/:id/dispatches/:dispatchId/create-invoice', asyncHandler(async (req: AuthRequest, res: Response) => {
  const dispatch = await prisma.dDGSContractDispatch.findFirst({
    where: { id: req.params.dispatchId, contractId: req.params.id },
  });
  if (!dispatch) return res.status(404).json({ error: 'Dispatch not found for this contract' });
  if (dispatch.invoiceId) return res.status(400).json({ error: 'Invoice already exists for this dispatch' });

  const contract = await prisma.dDGSContract.findUnique({
    where: { id: req.params.id },
    include: { customer: true },
  });
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  const customer = contract.customer;
  if (!customer) return res.status(500).json({ error: 'Customer not found' });

  const gstPercent = contract.gstPercent || DDGS_GST_PCT;
  const amount = dispatch.amount || (dispatch.weightNetMT * dispatch.rate);
  const gst = calcGstSplit(amount, gstPercent, customer.state);
  const totalAmount = Math.round((amount + gst.gstAmount) * 100) / 100;

  // Atomic: create invoice + link to dispatch in transaction
  const invoice = await prisma.$transaction(async (tx) => {
    // Re-check inside transaction
    const fresh = await tx.dDGSContractDispatch.findUnique({ where: { id: dispatch.id }, select: { invoiceId: true } });
    if (fresh?.invoiceId) throw new Error('Invoice already exists for this dispatch');

    const customInvNo = await nextInvoiceNo(tx, 'DDGS');

    const inv = await tx.invoice.create({
      data: {
        customerId: customer.id,
        invoiceDate: dispatch.dispatchDate,
        dueDate: contract.paymentTermsDays ? new Date(dispatch.dispatchDate.getTime() + contract.paymentTermsDays * 86400000) : null,
        productName: 'DDGS',
        quantity: dispatch.weightNetMT,
        unit: 'MT',
        rate: dispatch.rate || 0,
        amount,
        gstPercent,
        gstAmount: gst.gstAmount,
        supplyType: gst.supplyType,
        cgstPercent: gst.cgstPercent,
        cgstAmount: gst.cgstAmount,
        sgstPercent: gst.sgstPercent,
        sgstAmount: gst.sgstAmount,
        igstPercent: gst.igstPercent,
        igstAmount: gst.igstAmount,
        totalAmount,
        balanceAmount: totalAmount,
        status: 'UNPAID',
        remarks: customInvNo,
        userId: (req as AuthRequest).user?.id || 'system',
      },
    });

    await tx.dDGSContractDispatch.update({
      where: { id: dispatch.id },
      data: { invoiceId: inv.id },
    });

    return inv;
  });

  // Auto-journal
  onSaleInvoiceCreated(prisma, {
    id: invoice.id, invoiceNo: invoice.invoiceNo, totalAmount: invoice.totalAmount,
    amount: invoice.amount, gstAmount: gst.gstAmount, gstPercent,
    cgstAmount: gst.cgstAmount, sgstAmount: gst.sgstAmount, igstAmount: gst.igstAmount,
    supplyType: gst.supplyType, productName: 'DDGS',
    customerId: customer.id, userId: (req as AuthRequest).user?.id || 'system',
    invoiceDate: dispatch.dispatchDate, customer: { state: customer.state },
  });

  res.json({ invoice });
}));

// ── GENERATE E-INVOICE (IRN + EWB) for a dispatch ──
router.post('/:id/dispatches/:dispatchId/e-invoice', asyncHandler(async (req: AuthRequest, res: Response) => {
  const dispatch = await prisma.dDGSContractDispatch.findFirst({
    where: { id: req.params.dispatchId, contractId: req.params.id },
    include: { invoice: { include: { customer: true } } },
  });
  if (!dispatch) return res.status(404).json({ error: 'Dispatch not found for this contract' });
  if (!dispatch.invoice) return res.status(400).json({ error: 'Create an invoice for this dispatch first.' });
  if (!dispatch.vehicleNo?.trim()) return res.status(400).json({ error: 'Vehicle number is required for e-invoice.' });

  const invoice = dispatch.invoice;

  if (!invoice.rate || invoice.rate <= 0) {
    return res.status(400).json({ error: 'Invoice rate is zero. Update the invoice first.' });
  }

  // Allow EWB retry: if IRN exists but EWB missing, skip to EWB step
  const irnAlreadyExists = !!invoice.irn;
  if (irnAlreadyExists && invoice.ewbNo) {
    return res.status(400).json({ error: 'Both IRN and E-Way Bill already generated.' });
  }

  const customer = invoice.customer;
  const missingFields: string[] = [];
  if (!customer.gstNo) missingFields.push('GSTIN');
  if (!customer.state) missingFields.push('State');
  if (!customer.pincode) missingFields.push('Pincode');
  if (!customer.address) missingFields.push('Address');
  if (missingFields.length > 0) {
    return res.status(400).json({
      error: `Customer "${customer.name}" is missing: ${missingFields.join(', ')}. Update customer record first.`,
      missingFields,
    });
  }

  // ── STEP 1: Generate IRN ──
  let irn = invoice.irn;
  let ackNo = invoice.ackNo;

  if (!irnAlreadyExists) {
    const invoiceData = {
      invoiceNo: invoice.remarks || `INV-${invoice.invoiceNo}`,
      invoiceDate: invoice.invoiceDate,
      productName: 'DDGS',
      quantity: invoice.quantity,
      unit: 'MT',
      rate: invoice.rate,
      amount: invoice.amount,
      gstPercent: invoice.gstPercent,
      customer: {
        gstin: customer.gstNo || '',
        name: customer.name,
        address: customer.address || '',
        city: customer.city || '',
        pincode: customer.pincode || '',
        state: customer.state || '',
        phone: customer.phone || '',
        email: customer.email || '',
      },
    };

    const irnResult = await generateIRN(invoiceData);
    if (!irnResult.success) {
      return res.status(400).json({ error: irnResult.error, step: 'e-invoice', rawResponse: (irnResult as any).rawResponse });
    }

    irn = irnResult.irn || null;
    ackNo = irnResult.ackNo ? String(irnResult.ackNo) : null;

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        irn,
        irnDate: new Date(),
        irnStatus: 'GENERATED',
        ackNo,
        signedQRCode: irnResult.signedQRCode ? irnResult.signedQRCode.slice(0, 4000) : null,
      } as any,
    });
  }

  if (!irn) return res.status(500).json({ error: 'IRN not available for EWB generation' });

  // ── STEP 2: Generate E-Way Bill from IRN ──
  let ewayBillNo: string | null = null;
  let ewayBillDate: string | null = null;
  let ewbError: string | null = null;

  try {
    const distanceKm = (req.body.distanceKm ? parseInt(req.body.distanceKm) : null) || (dispatch.distanceKm ? Math.round(dispatch.distanceKm) : 100);
    const vehNo = (dispatch.vehicleNo || '').replace(/\s/g, '');
    const transporterGstin = req.body.transporterGstin || '';
    const transporterName = dispatch.transporterName || '';

    const ewbData: Record<string, any> = {
      Irn: irn,
      Distance: distanceKm,
      TransMode: '1',
      VehNo: vehNo,
      VehType: 'R',
    };
    if (transporterGstin && transporterGstin.length === 15) {
      ewbData.TransId = transporterGstin;
    }
    if (transporterName && transporterName.length >= 3) {
      ewbData.TransName = transporterName;
    }
    const ewbResult = await generateEWBByIRN(irn, ewbData);

    if (ewbResult.success && ewbResult.ewayBillNo) {
      ewayBillNo = ewbResult.ewayBillNo;
      ewayBillDate = ewbResult.ewayBillDate || new Date().toISOString();

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          ewbNo: ewayBillNo,
          ewbDate: ewayBillDate ? new Date(ewayBillDate) : new Date(),
          ewbValidTill: ewbResult.validUpto ? new Date(ewbResult.validUpto) : null,
          ewbStatus: 'GENERATED',
        } as any,
      });
    } else {
      ewbError = ewbResult.error || 'E-Way Bill generation failed';
    }
  } catch (err: any) {
    ewbError = err.message || 'E-Way Bill generation error';
  }

  res.json({
    success: true,
    irn,
    ackNo,
    invoiceNo: invoice.remarks || `INV-${invoice.invoiceNo}`,
    ewayBillNo,
    ewayBillDate,
    ewbError,
    message: ewayBillNo
      ? 'e-Invoice and E-Way Bill generated successfully'
      : `e-Invoice generated (IRN: ${irn}). E-Way Bill failed: ${ewbError}`,
  });
}));

// ── MANUAL EWB number + optional PDF upload ──
const ewbUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
router.patch('/:id/dispatches/:dispatchId/manual-ewb', ewbUpload.single('ewbPdf'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { ewbNo } = req.body;
  if (!ewbNo?.trim()) return res.status(400).json({ error: 'EWB number is required' });

  const dispatch = await prisma.dDGSContractDispatch.findFirst({
    where: { id: req.params.dispatchId, contractId: req.params.id },
    select: { invoiceId: true },
  });
  if (!dispatch?.invoiceId) return res.status(404).json({ error: 'Dispatch or invoice not found' });

  const data: any = {
    ewbNo: ewbNo.trim(),
    ewbDate: new Date(),
    ewbStatus: 'GENERATED',
  };
  if (req.file?.buffer) {
    data.ewbPdfData = req.file.buffer;
  }

  await prisma.invoice.update({ where: { id: dispatch.invoiceId }, data });
  res.json({ success: true, ewbNo: ewbNo.trim(), hasPdf: !!req.file });
}));

// ── GET EWB PDF ──
router.get('/:id/dispatches/:dispatchId/ewb-pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
  const dispatch = await prisma.dDGSContractDispatch.findFirst({
    where: { id: req.params.dispatchId, contractId: req.params.id },
    select: { invoiceId: true },
  });
  if (!dispatch?.invoiceId) return res.status(404).json({ error: 'Not found' });

  const invoice = await prisma.invoice.findUnique({
    where: { id: dispatch.invoiceId },
    select: { ewbPdfData: true, ewbNo: true },
  });
  if (!invoice?.ewbPdfData) return res.status(404).json({ error: 'No EWB PDF uploaded' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="EWB-${invoice.ewbNo || 'unknown'}.pdf"`);
  res.send(invoice.ewbPdfData);
}));

// ── TOGGLE auto e-invoice ──
router.patch('/:id/auto-einvoice', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { enabled } = req.body;
  const contract = await prisma.dDGSContract.update({
    where: { id: req.params.id },
    data: { autoGenerateEInvoice: enabled === true },
    select: { id: true, autoGenerateEInvoice: true },
  });
  res.json({ contract });
}));

export default router;
