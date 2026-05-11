import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import multer from 'multer';
import { generateIRN, generateEWBByIRN } from '../services/eInvoice';
import { onSaleInvoiceCreated } from '../services/autoJournal';
import { nextInvoiceNo, nextCounter } from '../utils/invoiceCounter';
import { nextWGSContractNo } from '../utils/contractNoGenerator';

import { calcGstSplit } from '../utils/gstSplit';

const WGS_HSN = '2303';
const WGS_GST_PCT = 5;

const p = (v: any): number | null => v !== undefined && v !== null && v !== '' ? parseFloat(v) : null;
const pInt = (v: any): number | null => v !== undefined && v !== null && v !== '' ? parseInt(v) : null;

const router = Router();
router.use(authenticate);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── GET all contracts ──
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { status } = req.query;
  const where: any = { ...getCompanyFilter(req) };
  if (status && status !== 'ALL') where.status = status;

  const rows = await prisma.wGSContract.findMany({
    where,
    take: 500,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, contractNo: true, status: true,
      dealType: true, processingChargePerMT: true, principalName: true,
      quantityType: true,
      customerId: true, buyerName: true, buyerAddress: true, buyerGstin: true,
      buyerState: true, buyerContact: true, buyerPhone: true, buyerEmail: true,
      supplyType: true, startDate: true, endDate: true,
      contractQtyMT: true, rate: true, gstPercent: true,
      paymentTermsDays: true, paymentMode: true, logisticsBy: true, remarks: true,
      contractPdfName: true, autoGenerateEInvoice: true,
      totalSuppliedMT: true, totalInvoicedAmt: true, totalReceivedAmt: true,
      createdAt: true, updatedAt: true,
      customer: { select: { id: true, name: true, gstNo: true, state: true } },
    },
  });
  const contracts = rows.map(r => ({ ...r, hasPdf: !!r.contractPdfName }));

  const stats = {
    total: contracts.length,
    active: contracts.filter((c: any) => c.status === 'ACTIVE').length,
    totalContractQtyMT: contracts.reduce((s: number, c: any) => s + (c.quantityType === 'OPEN' ? 0 : (c.contractQtyMT || 0)), 0),
    totalSuppliedMT: contracts.reduce((s: number, c: any) => s + (c.totalSuppliedMT || 0), 0),
  };

  res.json({ contracts, stats });
}));

// ── GET single contract with all dispatches ──
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const raw = await prisma.wGSContract.findUnique({
    where: { id: req.params.id },
    include: {
      customer: { select: { id: true, name: true, gstNo: true, state: true, address: true, pincode: true, city: true, phone: true, email: true } },
      dispatches: {
        orderBy: { dispatchDate: 'desc' },
        include: {
          invoice: {
            select: {
              id: true, invoiceNo: true, remarks: true, totalAmount: true, paidAmount: true, status: true,
              amount: true, quantity: true, rate: true, unit: true, productName: true,
              gstPercent: true, gstAmount: true, supplyType: true,
              cgstAmount: true, sgstAmount: true, igstAmount: true, freightCharge: true,
              irn: true, irnStatus: true, irnDate: true, ackNo: true,
              ewbNo: true, ewbDate: true, ewbStatus: true,
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

  const startDate = b.startDate ? new Date(b.startDate) : null;
  const endDate = b.endDate ? new Date(b.endDate) : null;
  if (!startDate || isNaN(startDate.getTime())) return res.status(400).json({ error: 'Valid startDate is required' });
  if (!endDate || isNaN(endDate.getTime())) return res.status(400).json({ error: 'Valid endDate is required' });

  const contractNo = (b.contractNo && String(b.contractNo).trim()) || await nextWGSContractNo();

  const contract = await prisma.wGSContract.create({
    data: {
      contractNo,
      status: b.status || 'ACTIVE',
      dealType: b.dealType || 'FIXED_RATE',
      processingChargePerMT: p(b.processingChargePerMT),
      principalName: b.principalName || null,
      customerId: customer.id,
      buyerName: b.buyerName || customer.name,
      buyerAddress: b.buyerAddress || customer.address || null,
      buyerGstin: b.buyerGstin || customer.gstNo || null,
      buyerState: b.buyerState || customer.state || null,
      buyerContact: b.buyerContact || null,
      buyerPhone: b.buyerPhone || customer.phone || null,
      buyerEmail: b.buyerEmail || customer.email || null,
      supplyType: b.supplyType || null,
      startDate,
      endDate,
      quantityType: b.quantityType === 'OPEN' ? 'OPEN' : 'FIXED',
      contractQtyMT: b.quantityType === 'OPEN' ? 0 : (p(b.contractQtyMT) || 0),
      rate: p(b.rate) || 0,
      gstPercent: p(b.gstPercent) ?? WGS_GST_PCT,
      paymentTermsDays: pInt(b.paymentTermsDays),
      paymentMode: b.paymentMode || null,
      logisticsBy: b.logisticsBy || 'BUYER',
      remarks: b.remarks || null,
      userId: (req as AuthRequest).user?.id || 'system',
      companyId: getActiveCompanyId(req),
    },
  });
  res.json({ contract });
}));

// ── PUT update contract ──
router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const existing = await prisma.wGSContract.findUnique({ where: { id: req.params.id } });
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

  const newRate = b.rate !== undefined ? (p(b.rate) || 0) : existing.rate;
  const newGstPct = b.gstPercent !== undefined ? (p(b.gstPercent) ?? WGS_GST_PCT) : existing.gstPercent;
  const rateChanged = newRate !== existing.rate || newGstPct !== existing.gstPercent;

  const contract = await prisma.wGSContract.update({
    where: { id: req.params.id },
    data: {
      contractNo: b.contractNo ?? existing.contractNo,
      status: b.status ?? existing.status,
      dealType: b.dealType ?? existing.dealType,
      processingChargePerMT: b.processingChargePerMT !== undefined ? p(b.processingChargePerMT) : existing.processingChargePerMT,
      principalName: b.principalName !== undefined ? b.principalName : existing.principalName,
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
      quantityType: b.quantityType !== undefined ? (b.quantityType === 'OPEN' ? 'OPEN' : 'FIXED') : (existing as any).quantityType,
      contractQtyMT: b.quantityType === 'OPEN'
        ? 0
        : (b.contractQtyMT !== undefined ? (p(b.contractQtyMT) || 0) : existing.contractQtyMT),
      rate: newRate,
      gstPercent: newGstPct,
      paymentTermsDays: b.paymentTermsDays !== undefined ? pInt(b.paymentTermsDays) : existing.paymentTermsDays,
      paymentMode: b.paymentMode !== undefined ? b.paymentMode : existing.paymentMode,
      logisticsBy: b.logisticsBy !== undefined ? b.logisticsBy : existing.logisticsBy,
      remarks: b.remarks !== undefined ? b.remarks : existing.remarks,
    },
  });

  // ── Cascade rate change to all dispatches + invoices ──
  if (rateChanged) {
    const dispatches = await prisma.wGSContractDispatch.findMany({
      where: { contractId: req.params.id },
      include: { invoice: { select: { id: true, quantity: true, totalAmount: true, balanceAmount: true } } },
      take: 500,
    });

    let totalInvoicedAmt = 0;
    const customerState = buyerState || existing.buyerState;
    const customerGstin = buyerGstin || existing.buyerGstin;

    for (const d of dispatches) {
      const newAmount = Math.round(d.weightNetMT * newRate * 100) / 100;

      // Update dispatch snapshot
      await prisma.wGSContractDispatch.update({
        where: { id: d.id },
        data: { rate: newRate, amount: newAmount },
      });

      // Recalculate linked invoice
      if (d.invoiceId && d.invoice) {
        const inv = d.invoice;
        const invAmount = Math.round((inv.quantity || 0) * newRate * 100) / 100;
        const gst = calcGstSplit(invAmount, newGstPct, customerState, customerGstin);
        const invTotal = Math.round((invAmount + gst.gstAmount) * 100) / 100;
        // Adjust balance by the delta so payments already received are preserved
        const oldTotal = inv.totalAmount || 0;
        const newBalance = Math.max(0, (inv.balanceAmount || 0) + (invTotal - oldTotal));

        await prisma.invoice.update({
          where: { id: inv.id },
          data: {
            rate: newRate,
            amount: invAmount,
            gstPercent: newGstPct,
            gstAmount: gst.gstAmount,
            supplyType: gst.supplyType,
            cgstPercent: gst.cgstPercent,
            cgstAmount: gst.cgstAmount,
            sgstPercent: gst.sgstPercent,
            sgstAmount: gst.sgstAmount,
            igstPercent: gst.igstPercent,
            igstAmount: gst.igstAmount,
            totalAmount: invTotal,
            balanceAmount: newBalance,
          },
        });

        totalInvoicedAmt += invTotal;
      }
    }

    // Refresh contract totals
    if (dispatches.some(d => d.invoiceId)) {
      await prisma.wGSContract.update({
        where: { id: req.params.id },
        data: { totalInvoicedAmt },
      });
    }
  }

  res.json({ contract, rateUpdated: rateChanged });
}));

// ── DELETE contract (only if no dispatches) ──
router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const contract = await prisma.wGSContract.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { dispatches: true } } },
  });
  if (!contract) return res.status(404).json({ error: 'Not found' });
  if (contract._count.dispatches > 0) {
    return res.status(400).json({ error: 'Cannot delete contract with dispatches. Terminate instead.' });
  }
  await prisma.wGSContract.delete({ where: { id: req.params.id } });
  res.json({ success: true });
}));

// ── PDF UPLOAD ──
router.post('/:id/pdf', upload.single('pdf'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const file = (req as any).file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  const base64 = file.buffer.toString('base64');
  const contract = await prisma.wGSContract.update({
    where: { id: req.params.id },
    data: { contractPdf: base64, contractPdfName: file.originalname },
  });
  res.json({ success: true, filename: contract.contractPdfName });
}));

// ── PDF DOWNLOAD ──
router.get('/:id/pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
  const contract = await prisma.wGSContract.findUnique({
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
  const raw = await prisma.wGSContract.findUnique({
    where: { id: req.params.id },
    include: {
      customer: { select: { id: true, name: true, gstNo: true, state: true } },
      dispatches: {
        orderBy: { dispatchDate: 'desc' },
        include: {
          invoice: {
            select: {
              id: true, invoiceNo: true, remarks: true, totalAmount: true, paidAmount: true, balanceAmount: true, status: true,
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

  const isOpen = (contract as any).quantityType === 'OPEN';
  const summary = {
    quantityType: (contract as any).quantityType || 'FIXED',
    contractQtyMT: contract.contractQtyMT || 0,
    suppliedMT: contract.totalSuppliedMT || 0,
    remainingMT: isOpen ? null : Math.max(0, (contract.contractQtyMT || 0) - (contract.totalSuppliedMT || 0)),
    progressPct: isOpen ? null : (contract.contractQtyMT ? Math.round(((contract.totalSuppliedMT || 0) / contract.contractQtyMT) * 100) : 0),
    invoicedAmount: totalInvoiceAmount,
    receivedAmount: totalPaid,
    outstanding: Math.round((totalInvoiceAmount - totalPaid) * 100) / 100,
    totalDispatches: dispatches.length,
    daysRemaining: Math.max(0, Math.ceil((new Date(contract.endDate).getTime() - Date.now()) / 86400000)),
  };

  // WGS has no weighbridge integration — no in-flight trucks. Keep field for
  // API parity with DDGS supply-summary so the frontend can share state shape.
  const activeTrucks: any[] = [];

  res.json({ contract: { ...contract, hasPdf: !!contractPdf }, summary, dispatches, activeTrucks });
}));

// ── POST dispatch under contract ──
router.post('/:id/dispatches', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;

  const contract = await prisma.wGSContract.findUnique({
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
    const d = await tx.wGSContractDispatch.create({
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
    await tx.wGSContract.update({
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
        const gstPercent = contract.gstPercent || WGS_GST_PCT;
        const gst = calcGstSplit(amount, gstPercent, customer.state, customer.gstNo);
        const total = Math.round((amount + gst.gstAmount) * 100) / 100;

        const inv = await prisma.$transaction(async (tx) => {
          const customInvNo = await nextInvoiceNo(tx, 'ETH');
          const dchNo = await nextCounter(tx, 'DCH/ETH');
          const gpNo = await nextCounter(tx, 'GP/ETH');

          const invoice = await tx.invoice.create({
            data: {
              customerId: customer.id,
              invoiceDate: dispatch.dispatchDate,
              productName: 'WGS',
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

          await tx.wGSContractDispatch.update({
            where: { id: dispatch.id },
            data: { invoiceId: invoice.id, challanNo: dchNo, gatePassNo: gpNo },
          });

          return invoice;
        });

        // Auto-journal
        onSaleInvoiceCreated(prisma, {
          id: inv.id, invoiceNo: inv.invoiceNo, totalAmount: total,
          amount, gstAmount: gst.gstAmount, gstPercent,
          cgstAmount: gst.cgstAmount, sgstAmount: gst.sgstAmount, igstAmount: gst.igstAmount,
          supplyType: gst.supplyType, productName: 'WGS',
          customerId: customer.id, userId: 'system', invoiceDate: dispatch.dispatchDate,
          customer: { state: customer.state },
        });

        // Generate IRN
        if (customer.gstNo && customer.state && customer.pincode && customer.address) {
          const irnRes = await generateIRN({
            invoiceNo: inv.remarks || `INV-${inv.invoiceNo}`,
            invoiceDate: inv.invoiceDate,
            productName: 'WGS', quantity: inv.quantity, unit: 'MT', rate: inv.rate, amount: inv.amount, gstPercent: inv.gstPercent,
            customer: { gstin: customer.gstNo, name: customer.name, address: customer.address, city: customer.city || '', pincode: customer.pincode, state: customer.state, phone: customer.phone || '', email: customer.email || '' },
          });
          if (irnRes.success && irnRes.irn) {
            await prisma.invoice.update({
              where: { id: inv.id },
              data: { irn: irnRes.irn, irnDate: new Date(), irnStatus: 'GENERATED', ackNo: irnRes.ackNo ? String(irnRes.ackNo) : null, signedQRCode: irnRes.signedQRCode?.slice(0, 4000) || null } as any,
            });

            // EWB auto-generation disabled: EWB amount often differs from invoice amount.
            // User uploads EWB PDF manually via PATCH /dispatches/:id/manual-ewb.
          }
        }
      } catch (err: unknown) {
        // Structured error logging only
        process.stderr.write(`[WGSContract] Auto e-invoice failed for dispatch ${dispatch.id}: ${(err instanceof Error ? err.message : String(err))}\n`);
      }
    });
  }

  res.json({ dispatch });
}));

// ── PUT update dispatch ──
router.put('/dispatches/:dispatchId', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const existing = await prisma.wGSContractDispatch.findUnique({ where: { id: req.params.dispatchId } });
  if (!existing) return res.status(404).json({ error: 'Dispatch not found' });

  const dispatch = await prisma.wGSContractDispatch.update({
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
  const dispatch = await prisma.wGSContractDispatch.findUnique({ where: { id: req.params.dispatchId } });
  if (!dispatch) return res.status(404).json({ error: 'Not found' });
  if (dispatch.invoiceId) return res.status(400).json({ error: 'Cannot delete dispatch with linked invoice. Void the invoice first.' });

  // Atomic: reverse totals + delete
  await prisma.$transaction([
    prisma.wGSContract.update({
      where: { id: dispatch.contractId },
      data: { totalSuppliedMT: { decrement: dispatch.weightNetMT } },
    }),
    prisma.wGSContractDispatch.delete({ where: { id: req.params.dispatchId } }),
  ]);
  res.json({ success: true });
}));

// ── CREATE INVOICE from dispatch ──
router.post('/:id/dispatches/:dispatchId/create-invoice', asyncHandler(async (req: AuthRequest, res: Response) => {
  const dispatch = await prisma.wGSContractDispatch.findFirst({
    where: { id: req.params.dispatchId, contractId: req.params.id },
  });
  if (!dispatch) return res.status(404).json({ error: 'Dispatch not found for this contract' });
  if (dispatch.invoiceId) return res.status(400).json({ error: 'Invoice already exists for this dispatch' });

  const contract = await prisma.wGSContract.findUnique({
    where: { id: req.params.id },
    include: { customer: true },
  });
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  const customer = contract.customer;
  if (!customer) return res.status(500).json({ error: 'Customer not found' });

  const gstPercent = contract.gstPercent || WGS_GST_PCT;
  const amount = dispatch.amount || (dispatch.weightNetMT * dispatch.rate);
  const gst = calcGstSplit(amount, gstPercent, customer.state, customer.gstNo);
  const totalAmount = Math.round((amount + gst.gstAmount) * 100) / 100;

  // Atomic: create invoice + link to dispatch in transaction
  const invoice = await prisma.$transaction(async (tx) => {
    // Re-check inside transaction
    const fresh = await tx.wGSContractDispatch.findUnique({ where: { id: dispatch.id }, select: { invoiceId: true } });
    if (fresh?.invoiceId) throw new Error('Invoice already exists for this dispatch');

    const customInvNo = await nextInvoiceNo(tx, 'ETH');
    const dchNo = await nextCounter(tx, 'DCH/ETH');
    const gpNo = await nextCounter(tx, 'GP/ETH');

    const inv = await tx.invoice.create({
      data: {
        customerId: customer.id,
        invoiceDate: dispatch.dispatchDate,
        dueDate: contract.paymentTermsDays ? new Date(dispatch.dispatchDate.getTime() + contract.paymentTermsDays * 86400000) : null,
        productName: 'WGS',
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

    await tx.wGSContractDispatch.update({
      where: { id: dispatch.id },
      data: { invoiceId: inv.id, challanNo: dchNo, gatePassNo: gpNo },
    });

    return inv;
  });

  // Auto-journal
  onSaleInvoiceCreated(prisma, {
    id: invoice.id, invoiceNo: invoice.invoiceNo, totalAmount: invoice.totalAmount,
    amount: invoice.amount, gstAmount: gst.gstAmount, gstPercent,
    cgstAmount: gst.cgstAmount, sgstAmount: gst.sgstAmount, igstAmount: gst.igstAmount,
    supplyType: gst.supplyType, productName: 'WGS',
    customerId: customer.id, userId: (req as AuthRequest).user?.id || 'system',
    invoiceDate: dispatch.dispatchDate, customer: { state: customer.state },
  });

  res.json({ invoice });
}));

// ── GENERATE E-INVOICE (IRN + EWB) for a dispatch ──
router.post('/:id/dispatches/:dispatchId/e-invoice', asyncHandler(async (req: AuthRequest, res: Response) => {
  const dispatch = await prisma.wGSContractDispatch.findFirst({
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
      productName: 'WGS',
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
  } catch (err: unknown) {
    ewbError = (err instanceof Error ? err.message : String(err)) || 'E-Way Bill generation error';
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

// ── DELIVERY CHALLAN PDF ──
router.get('/:id/dispatches/:dispatchId/challan-pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
  const dispatch = await prisma.wGSContractDispatch.findFirst({
    where: { id: req.params.dispatchId, contractId: req.params.id },
    include: {
      contract: { select: { buyerName: true, buyerAddress: true, buyerGstin: true, dealType: true, rate: true, processingChargePerMT: true, contractNo: true, customerId: true } },
      invoice: { select: { shipToName: true, shipToGstin: true, shipToAddress: true, shipToState: true, shipToPincode: true, customer: { select: { name: true, address: true, city: true, state: true, pincode: true, gstNo: true } } } },
    },
  });
  if (!dispatch) return res.status(404).json({ error: 'Dispatch not found' });

  const isJobWork = dispatch.contract.dealType === 'JOB_WORK';
  const rate = dispatch.rate || dispatch.contract.rate || 0;
  const amount = Math.round(dispatch.weightNetMT * rate);
  const gstRate = isJobWork ? 18 : 5;
  const gstAmount = Math.round(amount * gstRate / 100);

  const { renderDocumentPdf } = await import('../services/documentRenderer');
  const pdfBuffer = await renderDocumentPdf({
    docType: 'CHALLAN',
    data: {
      challanNo: dispatch.challanNo || dispatch.gatePassNo || '-',
      date: dispatch.dispatchDate,
      vehicleNo: dispatch.vehicleNo,
      driverName: dispatch.driverName,
      driverPhone: dispatch.driverPhone,
      transporterName: dispatch.transporterName,
      destination: dispatch.destination,
      buyerName: dispatch.contract.buyerName,
      buyerAddress: dispatch.contract.buyerAddress || '',
      buyerGst: dispatch.contract.buyerGstin || '',
      contractNo: dispatch.contract.contractNo,
      customer: dispatch.invoice?.customer ? {
        name: dispatch.invoice.shipToName || dispatch.invoice.customer.name,
        address: dispatch.invoice.shipToAddress || dispatch.invoice.customer.address,
        city: dispatch.invoice.customer.city,
        state: dispatch.invoice.shipToState || dispatch.invoice.customer.state,
        pincode: dispatch.invoice.shipToPincode || dispatch.invoice.customer.pincode,
        gstNo: dispatch.invoice.shipToGstin || dispatch.invoice.customer.gstNo,
      } : {
        name: dispatch.contract.buyerName,
        address: dispatch.contract.buyerAddress || '',
        gstNo: dispatch.contract.buyerGstin || '',
      },
      productName: isJobWork ? 'JOBWORK CHARGES FOR WGS PRODUCTION' : 'WGS',
      hsnCode: isJobWork ? '998817' : '23033000',
      quantity: dispatch.weightNetMT,
      unit: 'MT',
      rate,
      amount,
      gstRate,
      gstAmount,
      totalValue: amount + gstAmount,
      bags: dispatch.bags,
      weightGross: dispatch.weightGrossMT,
      weightTare: dispatch.weightTareMT,
      weightNet: dispatch.weightNetMT,
    },
    verifyId: dispatch.id,
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Challan-WGS-${dispatch.vehicleNo}.pdf"`);
  res.send(pdfBuffer);
}));

// ── MANUAL EWB number + optional PDF upload ──
const ewbUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
router.patch('/:id/dispatches/:dispatchId/manual-ewb', ewbUpload.single('ewbPdf'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { ewbNo } = req.body;
  if (!ewbNo?.trim()) return res.status(400).json({ error: 'EWB number is required' });

  const dispatch = await prisma.wGSContractDispatch.findFirst({
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
  const dispatch = await prisma.wGSContractDispatch.findFirst({
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
  const contract = await prisma.wGSContract.update({
    where: { id: req.params.id },
    data: { autoGenerateEInvoice: enabled === true },
    select: { id: true, autoGenerateEInvoice: true },
  });
  res.json({ contract });
}));

export default router;
