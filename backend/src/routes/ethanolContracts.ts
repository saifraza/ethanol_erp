import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import multer from 'multer';
// RAG indexing removed — only compliance docs go to RAG
import { generateIRN, generateEWBByIRN, generateStandaloneEWB } from '../services/eInvoice';
import { onSaleInvoiceCreated } from '../services/autoJournal';
import { getStateCode, getHsnCode, MSPIL } from '../services/ewayBill';
import { nextInvoiceNo, getInvoiceSeries } from '../utils/invoiceCounter';
import { invoiceDisplayNo } from '../utils/invoiceDisplay';
import { nextEthanolContractNo } from '../utils/contractNoGenerator';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { calcGstSplit, stateFromGstin } from '../utils/gstSplit';
import { Prisma } from '@prisma/client';

const router = Router();
router.use(authenticate);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── GET all contracts ──
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { type, status } = req.query;
    const where: any = { ...getCompanyFilter(req) };
    if (type && type !== 'ALL') where.contractType = type;
    if (status && status !== 'ALL') where.status = status;

    const contracts = await prisma.ethanolContract.findMany({
      where,
      include: { liftings: { orderBy: { liftingDate: 'desc' }, take: 5 } },
      orderBy: { createdAt: 'desc' },
    }).then(rows => rows.map(({ contractPdf, ...rest }) => ({ ...rest, hasPdf: !!contractPdf })));

    // Summary stats
    const stats = {
      total: contracts.length,
      active: contracts.filter((c: any) => c.status === 'ACTIVE').length,
      jobWork: contracts.filter((c: any) => c.contractType === 'JOB_WORK').length,
      fixedPrice: contracts.filter((c: any) => c.contractType === 'FIXED_PRICE').length,
      omc: contracts.filter((c: any) => c.contractType === 'OMC').length,
      totalContractQtyKL: contracts.reduce((s: number, c: any) => s + (c.contractQtyKL || 0), 0),
      totalSuppliedKL: contracts.reduce((s: number, c: any) => s + (c.totalSuppliedKL || 0), 0),
    };

    res.json({ contracts, stats });
}));

// ── GET single contract with all liftings ──
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const raw = await prisma.ethanolContract.findUnique({
      where: { id: req.params.id },
      include: {
        liftings: {
          orderBy: { liftingDate: 'desc' },
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
    const p = (v: any) => v !== undefined && v !== null && v !== '' ? parseFloat(v) : null;
    const pInt = (v: any) => v !== undefined && v !== null && v !== '' ? parseInt(v) : null;

    const contractNo = (b.contractNo && String(b.contractNo).trim()) || await nextEthanolContractNo();

    const contract = await prisma.ethanolContract.create({
      data: {
        contractNo,
        contractType: b.contractType,
        status: b.status || 'ACTIVE',
        buyerName: b.buyerName,
        buyerAddress: b.buyerAddress || null,
        buyerGst: b.buyerGst || null,
        buyerPan: b.buyerPan || null,
        buyerContact: b.buyerContact || null,
        buyerPhone: b.buyerPhone || null,
        buyerEmail: b.buyerEmail || null,
        // OMC
        omcName: b.omcName || null,
        omcDepot: b.omcDepot || null,
        allocationQtyKL: p(b.allocationQtyKL),
        // Job Work
        principalName: b.principalName || null,
        conversionRate: p(b.conversionRate),
        ddgsRate: p(b.ddgsRate),
        ethanolBenchmark: p(b.ethanolBenchmark),
        ddgsBenchmark: p(b.ddgsBenchmark),
        prcPenalty: p(b.prcPenalty),
        // Fixed Price
        ethanolRate: p(b.ethanolRate),
        // Common
        startDate: new Date(b.startDate),
        endDate: new Date(b.endDate),
        contractQtyKL: p(b.contractQtyKL),
        dailyTargetKL: p(b.dailyTargetKL),
        minLiftingPerDay: pInt(b.minLiftingPerDay),
        tankerCapacityKL: b.tankerCapacityKL || null,
        paymentTermsDays: pInt(b.paymentTermsDays),
        paymentMode: b.paymentMode || null,
        gstPercent: p(b.gstPercent),
        supplyType: b.supplyType || null,
        logisticsBy: b.logisticsBy || null,
        remarks: b.remarks || null,
        userId: b.userId || 'system',
        companyId: getActiveCompanyId(req),
      },
    });
    res.json({ contract });
}));

// ── PUT update contract ──
router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body;
    const p = (v: any) => v !== undefined && v !== null && v !== '' ? parseFloat(v) : null;
    const pInt = (v: any) => v !== undefined && v !== null && v !== '' ? parseInt(v) : null;

    const existing = await prisma.ethanolContract.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Contract not found' });

    const contract = await prisma.ethanolContract.update({
      where: { id: req.params.id },
      data: {
        contractNo: b.contractNo ?? existing.contractNo,
        contractType: b.contractType ?? existing.contractType,
        status: b.status ?? existing.status,
        buyerName: b.buyerName ?? existing.buyerName,
        buyerAddress: b.buyerAddress !== undefined ? b.buyerAddress : existing.buyerAddress,
        buyerGst: b.buyerGst !== undefined ? b.buyerGst : existing.buyerGst,
        buyerPan: b.buyerPan !== undefined ? b.buyerPan : existing.buyerPan,
        buyerContact: b.buyerContact !== undefined ? b.buyerContact : existing.buyerContact,
        buyerPhone: b.buyerPhone !== undefined ? b.buyerPhone : existing.buyerPhone,
        buyerEmail: b.buyerEmail !== undefined ? b.buyerEmail : existing.buyerEmail,
        omcName: b.omcName !== undefined ? b.omcName : existing.omcName,
        omcDepot: b.omcDepot !== undefined ? b.omcDepot : existing.omcDepot,
        allocationQtyKL: b.allocationQtyKL !== undefined ? p(b.allocationQtyKL) : existing.allocationQtyKL,
        principalName: b.principalName !== undefined ? b.principalName : existing.principalName,
        conversionRate: b.conversionRate !== undefined ? p(b.conversionRate) : existing.conversionRate,
        ddgsRate: b.ddgsRate !== undefined ? p(b.ddgsRate) : existing.ddgsRate,
        ethanolBenchmark: b.ethanolBenchmark !== undefined ? p(b.ethanolBenchmark) : existing.ethanolBenchmark,
        ddgsBenchmark: b.ddgsBenchmark !== undefined ? p(b.ddgsBenchmark) : existing.ddgsBenchmark,
        prcPenalty: b.prcPenalty !== undefined ? p(b.prcPenalty) : existing.prcPenalty,
        ethanolRate: b.ethanolRate !== undefined ? p(b.ethanolRate) : existing.ethanolRate,
        startDate: b.startDate ? new Date(b.startDate) : existing.startDate,
        endDate: b.endDate ? new Date(b.endDate) : existing.endDate,
        contractQtyKL: b.contractQtyKL !== undefined ? p(b.contractQtyKL) : existing.contractQtyKL,
        dailyTargetKL: b.dailyTargetKL !== undefined ? p(b.dailyTargetKL) : existing.dailyTargetKL,
        minLiftingPerDay: b.minLiftingPerDay !== undefined ? pInt(b.minLiftingPerDay) : existing.minLiftingPerDay,
        tankerCapacityKL: b.tankerCapacityKL !== undefined ? b.tankerCapacityKL : existing.tankerCapacityKL,
        paymentTermsDays: b.paymentTermsDays !== undefined ? pInt(b.paymentTermsDays) : existing.paymentTermsDays,
        paymentMode: b.paymentMode !== undefined ? b.paymentMode : existing.paymentMode,
        gstPercent: b.gstPercent !== undefined ? p(b.gstPercent) : existing.gstPercent,
        supplyType: b.supplyType !== undefined ? b.supplyType : existing.supplyType,
        logisticsBy: b.logisticsBy !== undefined ? b.logisticsBy : existing.logisticsBy,
        remarks: b.remarks !== undefined ? b.remarks : existing.remarks,
      },
    });
    res.json({ contract });
}));

// ── DELETE contract (DRAFT only) ──
router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const contract = await prisma.ethanolContract.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { liftings: true } } },
    });
    if (!contract) return res.status(404).json({ error: 'Not found' });
    if (contract._count.liftings > 0) {
      return res.status(400).json({ error: 'Cannot delete contract with liftings. Terminate instead.' });
    }
    await prisma.ethanolContract.delete({ where: { id: req.params.id } });
    res.json({ success: true });
}));

// ── PDF UPLOAD/DOWNLOAD ──

// Upload contract PDF
router.post('/:id/pdf', upload.single('pdf'), asyncHandler(async (req: AuthRequest, res: Response) => {
    const file = (req as any).file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const base64 = file.buffer.toString('base64');
    const contract = await prisma.ethanolContract.update({
      where: { id: req.params.id },
      data: { contractPdf: base64, contractPdfName: file.originalname },
    });
    res.json({ success: true, filename: contract.contractPdfName });

}));

// Download contract PDF
router.get('/:id/pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
    const contract = await prisma.ethanolContract.findUnique({
      where: { id: req.params.id },
      select: { contractPdf: true, contractPdfName: true },
    });
    if (!contract || !contract.contractPdf) return res.status(404).json({ error: 'No PDF attached' });

    const buffer = Buffer.from(contract.contractPdf, 'base64');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${contract.contractPdfName || 'contract.pdf'}"`);
    res.send(buffer);
}));

// Delete contract PDF
router.delete('/:id/pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
    await prisma.ethanolContract.update({
      where: { id: req.params.id },
      data: { contractPdf: null, contractPdfName: null },
    });
    res.json({ success: true });
}));

// ── LIFTINGS (dispatch under a contract) ──

// POST lifting
router.post('/:id/liftings', asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body;
    const p = (v: any) => v !== undefined && v !== null && v !== '' ? parseFloat(v) : null;

    const contract = await prisma.ethanolContract.findUnique({ where: { id: req.params.id } });
    if (!contract) return res.status(404).json({ error: 'Contract not found' });

    const qtyBL = p(b.quantityBL) || 0;
    const qtyKL = p(b.quantityKL) || qtyBL / 1000;

    // Auto-calc amount based on contract type
    let rate = p(b.rate);
    let amount = p(b.amount);
    if (!rate) {
      if (contract.contractType === 'JOB_WORK') rate = contract.conversionRate;
      else if (contract.contractType === 'FIXED_PRICE') rate = contract.ethanolRate;
      else rate = contract.ethanolRate; // OMC rate
    }
    if (!amount && rate) {
      amount = qtyBL * rate;
    }

    const lifting = await prisma.ethanolLifting.create({
      data: {
        contractId: req.params.id,
        liftingDate: b.liftingDate ? new Date(b.liftingDate) : new Date(),
        vehicleNo: b.vehicleNo || '',
        driverName: b.driverName || null,
        driverPhone: b.driverPhone || null,
        transporterName: b.transporterName || null,
        destination: b.destination || contract.omcDepot || null,
        quantityBL: qtyBL,
        quantityKL: qtyKL,
        strength: p(b.strength),
        temperature: p(b.temperature),
        rate,
        amount,
        invoiceNo: b.invoiceNo || null,
        invoiceDate: b.invoiceDate ? new Date(b.invoiceDate) : null,
        distanceKm: b.distanceKm ? parseInt(b.distanceKm) : null,
        consigneeName: b.consigneeName || null,
        consigneeGstin: b.consigneeGstin || null,
        consigneeAddress: b.consigneeAddress || null,
        consigneeState: b.consigneeState || null,
        consigneePincode: b.consigneePincode || null,
        status: b.status || 'LOADED',
        remarks: b.remarks || null,
        userId: b.userId || null,
      },
    });

    // Update contract totals
    await prisma.ethanolContract.update({
      where: { id: req.params.id },
      data: {
        totalSuppliedKL: { increment: qtyKL },
        totalInvoicedAmt: amount ? { increment: amount } : undefined,
      },
    });

    // Auto-invoice: create invoice + link atomically in transaction (NOT fire-and-forget)
    // This was the root cause of the 2026-04-11 incident: setImmediate created invoices
    // but the linking update silently failed, orphaning 19 invoices.
    let createdInvoice: any = null;
    if (contract.autoGenerateEInvoice && rate && amount && contract.buyerGst) {
      try {
        // 1. Resolve customer
        let custId = contract.buyerCustomerId;
        if (!custId) {
          let cust = await prisma.customer.findFirst({ where: { gstNo: contract.buyerGst! } });
          if (!cust) {
            const st = stateFromGstin(contract.buyerGst!);
            cust = await prisma.customer.create({
              data: { name: contract.buyerName, gstNo: contract.buyerGst, address: contract.buyerAddress, state: st, phone: contract.buyerPhone, email: contract.buyerEmail },
            });
          }
          custId = cust.id;
          await prisma.ethanolContract.update({ where: { id: contract.id }, data: { buyerCustomerId: custId } });
        }
        const cust = await prisma.customer.findUnique({ where: { id: custId! } });
        if (!cust) throw new Error('Customer not found');

        // 2. Create invoice + link to lifting in ONE transaction — never orphan
        const gst = calcGstSplit(amount!, contract.gstPercent || 18, cust.state, cust.gstNo);
        const total = Math.round((amount! + gst.gstAmount) * 100) / 100;
        const inv = await prisma.$transaction(async (tx) => {
          // Atomic next invoice number from the global counter (INV/ETH/NNN)
          const customInvNo = await nextInvoiceNo(tx, 'ETH');
          const created = await tx.invoice.create({
            data: {
              customerId: cust.id, invoiceDate: lifting.liftingDate,
              productName: contract.contractType === 'JOB_WORK' ? 'Job Work Charges for Ethanol Production' : 'ETHANOL',
              quantity: qtyBL, unit: 'LTR', rate: rate!, amount: amount!,
              gstPercent: contract.gstPercent || 18, gstAmount: gst.gstAmount, supplyType: gst.supplyType,
              cgstPercent: gst.cgstPercent, cgstAmount: gst.cgstAmount, sgstPercent: gst.sgstPercent, sgstAmount: gst.sgstAmount,
              igstPercent: gst.igstPercent, igstAmount: gst.igstAmount,
              totalAmount: total, balanceAmount: total, status: 'UNPAID', userId: 'system',
              remarks: customInvNo, // INV/ETH/NNN — printed number, used everywhere for display
            },
          });
          await tx.ethanolLifting.update({ where: { id: lifting.id }, data: { invoiceId: created.id, invoiceNo: customInvNo, status: 'DELIVERED', deliveredQtyKL: qtyBL / 1000 } });
          return created;
        });
        createdInvoice = inv;

        // Auto-journal (non-critical, outside transaction)
        onSaleInvoiceCreated(prisma, {
          id: inv.id, invoiceNo: inv.invoiceNo, remarks: inv.remarks, totalAmount: total,
          amount: amount!, gstAmount: gst.gstAmount, gstPercent: contract.gstPercent || 18,
          cgstAmount: gst.cgstAmount, sgstAmount: gst.sgstAmount, igstAmount: gst.igstAmount,
          supplyType: gst.supplyType,
          productName: contract.contractType === 'JOB_WORK' ? 'Job Work Charges for Ethanol Production' : 'ETHANOL',
          customerId: cust.id, userId: 'system', invoiceDate: lifting.liftingDate,
          customer: { state: cust.state },
          companyId: inv.companyId || undefined,
        });

        // 3. IRN + EWB: fire-and-forget (external API, OK to be async)
        if (cust.gstNo && cust.state && cust.pincode && cust.address) {
          setImmediate(async () => {
            try {
              const irnRes = await generateIRN({
                invoiceNo: invoiceDisplayNo(inv), invoiceDate: inv.invoiceDate,
                productName: inv.productName, quantity: inv.quantity, unit: 'LTR', rate: inv.rate, amount: inv.amount, gstPercent: inv.gstPercent,
                customer: { gstin: cust.gstNo!, name: cust.name, address: cust.address!, city: cust.city || '', pincode: cust.pincode!, state: cust.state!, phone: cust.phone || '', email: cust.email || '' },
              });
              if (irnRes.success && irnRes.irn) {
                await prisma.invoice.update({ where: { id: inv.id }, data: { irn: irnRes.irn, irnDate: new Date(), irnStatus: 'GENERATED', ackNo: irnRes.ackNo ? String(irnRes.ackNo) : null, signedQRCode: irnRes.signedQRCode?.slice(0, 4000) || null } as any });
                const vehNo = (lifting.vehicleNo || '').replace(/\s/g, '');
                const autoEwbData: Record<string, any> = { Irn: irnRes.irn, Distance: 100, TransMode: '1', VehNo: vehNo, VehType: 'R' };
                if (lifting.transporterName && lifting.transporterName.length >= 3) autoEwbData.TransName = lifting.transporterName;
                const ewbRes = await generateEWBByIRN(irnRes.irn, autoEwbData);
                if (ewbRes.success && ewbRes.ewayBillNo) {
                  await prisma.invoice.update({ where: { id: inv.id }, data: { ewbNo: ewbRes.ewayBillNo, ewbDate: new Date(), ewbStatus: 'GENERATED' } as any });
                }
              }
              console.log(`[EthanolContract] Auto e-invoice complete for lifting ${lifting.id}`);
            } catch (err: unknown) {
              console.error(`[EthanolContract] Auto IRN/EWB failed for lifting ${lifting.id}:`, (err instanceof Error ? err.message : String(err)));
            }
          });
        }
      } catch (err: unknown) {
        // Invoice creation failed — log but don't block the lifting creation
        console.error(`[EthanolContract] Auto-invoice failed for lifting ${lifting.id}:`, (err instanceof Error ? err.message : String(err)));
      }
    }

    // Return lifting with invoice info if created
    const result = createdInvoice
      ? await prisma.ethanolLifting.findUnique({ where: { id: lifting.id }, include: { invoice: { select: { id: true, invoiceNo: true } } } })
      : lifting;
    res.json({ lifting: result || lifting });
}));

// GET liftings for a contract
router.get('/:id/liftings', asyncHandler(async (req: AuthRequest, res: Response) => {
    const liftings = await prisma.ethanolLifting.findMany({
      where: { contractId: req.params.id },
      orderBy: { liftingDate: 'desc' },
    
    take: 500,
  });
    res.json({ liftings });
}));

// PATCH manual EWB number + optional PDF upload (for job work where API generation isn't available)
const ewbUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
router.patch('/:id/liftings/:liftingId/manual-ewb', ewbUpload.single('ewbPdf'), asyncHandler(async (req: AuthRequest, res: Response) => {
    const { ewbNo } = req.body;
    if (!ewbNo?.trim()) return res.status(400).json({ error: 'EWB number is required' });

    const lifting = await prisma.ethanolLifting.findFirst({
      where: { id: req.params.liftingId, contractId: req.params.id },
      select: { invoiceId: true },
    });
    if (!lifting?.invoiceId) return res.status(404).json({ error: 'Lifting or invoice not found' });

    const data: any = {
      ewbNo: ewbNo.trim(),
      ewbDate: new Date(),
      ewbStatus: 'GENERATED',
    };
    if (req.file?.buffer) {
      data.ewbPdfData = req.file.buffer;
    }

    await prisma.invoice.update({ where: { id: lifting.invoiceId }, data });
    res.json({ success: true, ewbNo: ewbNo.trim(), hasPdf: !!req.file });
}));

// GET EWB PDF for a lifting (serves uploaded PDF)
// PUT update lifting status (delivery confirmation)
router.put('/liftings/:liftingId', asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body;
    const p = (v: any) => v !== undefined && v !== null && v !== '' ? parseFloat(v) : null;

    const existing = await prisma.ethanolLifting.findUnique({ where: { id: req.params.liftingId } });
    if (!existing) return res.status(404).json({ error: 'Lifting not found' });

    const lifting = await prisma.ethanolLifting.update({
      where: { id: req.params.liftingId },
      data: {
        status: b.status ?? existing.status,
        deliveredQtyKL: b.deliveredQtyKL !== undefined ? p(b.deliveredQtyKL) : existing.deliveredQtyKL,
        shortageKL: b.shortageKL !== undefined ? p(b.shortageKL) : existing.shortageKL,
        omcReceiptNo: b.omcReceiptNo !== undefined ? b.omcReceiptNo : existing.omcReceiptNo,
        deliveredAt: b.deliveredAt ? new Date(b.deliveredAt) : existing.deliveredAt,
        invoiceNo: b.invoiceNo !== undefined ? b.invoiceNo : existing.invoiceNo,
        invoiceDate: b.invoiceDate ? new Date(b.invoiceDate) : existing.invoiceDate,
        distanceKm: b.distanceKm !== undefined ? (b.distanceKm ? parseInt(b.distanceKm) : null) : existing.distanceKm,
        consigneeName: b.consigneeName !== undefined ? b.consigneeName : existing.consigneeName,
        consigneeGstin: b.consigneeGstin !== undefined ? b.consigneeGstin : existing.consigneeGstin,
        consigneeAddress: b.consigneeAddress !== undefined ? b.consigneeAddress : existing.consigneeAddress,
        consigneeState: b.consigneeState !== undefined ? b.consigneeState : existing.consigneeState,
        consigneePincode: b.consigneePincode !== undefined ? b.consigneePincode : existing.consigneePincode,
        remarks: b.remarks !== undefined ? b.remarks : existing.remarks,
      },
    });

    res.json({ lifting });
}));

// ── PATCH /liftings/:liftingId/rate ──
// Re-rate an existing lifting and cascade to:
//   - linked Invoice (rate, amount, gst split, total, balance)
//   - linked DispatchTruck (productRatePerLtr, productValue)
//   - Contract.totalInvoicedAmt (recomputed from sum)
//   - Journal Entry: mark old as reversed, post new via onSaleInvoiceCreated
// Hard-blocked if invoice has IRN generated or any payment received — those need a credit note flow.
router.patch('/liftings/:liftingId/rate', asyncHandler(async (req: AuthRequest, res: Response) => {
  const liftingId = req.params.liftingId;
  const newRate = parseFloat(req.body.rate);
  if (!newRate || newRate <= 0) return res.status(400).json({ error: 'rate must be > 0' });

  const lifting = await prisma.ethanolLifting.findUnique({
    where: { id: liftingId },
    include: { contract: true, invoice: { include: { customer: { select: { state: true, gstNo: true } } } } },
  });
  if (!lifting) return res.status(404).json({ error: 'Lifting not found' });
  if (!lifting.invoice) return res.status(400).json({ error: 'Lifting has no linked invoice' });

  const inv = lifting.invoice;
  if (inv.irn || inv.irnStatus === 'GENERATED') {
    return res.status(409).json({ error: 'Cannot re-rate: IRN already generated. Issue a credit note instead.' });
  }
  if ((inv.paidAmount || 0) > 0) {
    return res.status(409).json({ error: 'Cannot re-rate: payment already received against this invoice. Issue a credit note instead.' });
  }

  const qtyBL = lifting.quantityBL;
  const newAmount = Math.round(qtyBL * newRate * 100) / 100;
  const gstPercent = inv.gstPercent || lifting.contract.gstPercent || 18;
  const gst = calcGstSplit(newAmount, gstPercent, inv.customer?.state, inv.customer?.gstNo);
  const newTotal = Math.round((newAmount + gst.gstAmount) * 100) / 100;

  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // 1. Update invoice
    await tx.invoice.update({
      where: { id: inv.id },
      data: {
        rate: newRate,
        amount: newAmount,
        gstAmount: gst.gstAmount,
        cgstPercent: gst.cgstPercent,
        cgstAmount: gst.cgstAmount,
        sgstPercent: gst.sgstPercent,
        sgstAmount: gst.sgstAmount,
        igstPercent: gst.igstPercent,
        igstAmount: gst.igstAmount,
        supplyType: gst.supplyType,
        totalAmount: newTotal,
        balanceAmount: newTotal,
      },
    });

    // 2. Update lifting
    await tx.ethanolLifting.update({
      where: { id: liftingId },
      data: { rate: newRate, amount: newAmount },
    });

    // 3. Update DispatchTruck (so any future re-fetches don't show stale snapshot)
    await tx.dispatchTruck.updateMany({
      where: { liftingId },
      data: { productRatePerLtr: newRate, productValue: newAmount },
    });

    // 4. Reverse old journal entry
    await tx.journalEntry.updateMany({
      where: { refType: 'SALE', refId: inv.id, isReversed: false },
      data: { isReversed: true },
    });

    // 5. Recompute contract totals from scratch (drift-safe)
    const liftings = await tx.ethanolLifting.findMany({
      where: { contractId: lifting.contractId },
      select: { quantityKL: true, amount: true },
    
    take: 500,
  });
    const totalKL = liftings.reduce((s: number, l: any) => s + (l.quantityKL || 0), 0);
    const totalAmt = liftings.reduce((s: number, l: any) => s + (l.amount || 0), 0);
    await tx.ethanolContract.update({
      where: { id: lifting.contractId },
      data: { totalSuppliedKL: totalKL, totalInvoicedAmt: totalAmt },
    });

    return { invoiceId: inv.id, newAmount, newTotal };
  }, { timeout: 30000, maxWait: 10000 });

  // 6. Post new journal entry (outside tx — onSaleInvoiceCreated has its own tx)
  await onSaleInvoiceCreated(prisma, {
    id: inv.id,
    invoiceNo: inv.invoiceNo,
    remarks: inv.remarks,
    totalAmount: newTotal,
    amount: newAmount,
    gstAmount: gst.gstAmount,
    gstPercent,
    cgstAmount: gst.cgstAmount,
    sgstAmount: gst.sgstAmount,
    igstAmount: gst.igstAmount,
    supplyType: gst.supplyType,
    productName: inv.productName,
    customerId: inv.customerId,
    userId: 'system',
    invoiceDate: inv.invoiceDate,
    customer: { state: inv.customer?.state },
    companyId: inv.companyId || undefined,
  });

  res.json({ success: true, ...result });
}));

// DELETE lifting
router.delete('/liftings/:liftingId', asyncHandler(async (req: AuthRequest, res: Response) => {
    const lifting = await prisma.ethanolLifting.findUnique({ where: { id: req.params.liftingId } });
    if (!lifting) return res.status(404).json({ error: 'Not found' });

    // Reverse contract totals
    await prisma.ethanolContract.update({
      where: { id: lifting.contractId },
      data: {
        totalSuppliedKL: { decrement: lifting.quantityKL },
        totalInvoicedAmt: lifting.amount ? { decrement: lifting.amount } : undefined,
      },
    });

    await prisma.ethanolLifting.delete({ where: { id: req.params.liftingId } });
    res.json({ success: true });
}));

// ── SUPPLY SUMMARY (dashboard data for a contract) ──
router.get('/:id/supply-summary', asyncHandler(async (req: AuthRequest, res: Response) => {
    const raw = await prisma.ethanolContract.findUnique({
      where: { id: req.params.id },
      include: {
        liftings: {
          orderBy: { liftingDate: 'desc' },
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
            dispatchTruck: { select: { id: true } },
          },
        },
      },
    });
    if (!raw) return res.status(404).json({ error: 'Contract not found' });
    const { contractPdf, ...contract } = raw;

    // Sort: active (LOADED/IN_TRANSIT) first, then by date desc
    const activeStatuses = new Set(['LOADED', 'IN_TRANSIT']);
    const liftings = contract.liftings.sort((a, b) => {
      const aActive = activeStatuses.has(a.status) ? 0 : 1;
      const bActive = activeStatuses.has(b.status) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return new Date(b.liftingDate).getTime() - new Date(a.liftingDate).getTime();
    });
    const inTransit = liftings.filter(l => activeStatuses.has(l.status));
    const delivered = liftings.filter(l => l.status === 'DELIVERED');

    // Payment summary from linked invoices
    let totalInvoiceAmount = 0;
    let totalPaid = 0;
    for (const l of liftings) {
      if (l.invoice) {
        totalInvoiceAmount += l.invoice.totalAmount || 0;
        totalPaid += l.invoice.paidAmount || 0;
      }
    }

    const summary = {
      contractQtyKL: contract.contractQtyKL || 0,
      suppliedKL: contract.totalSuppliedKL || 0,
      remainingKL: Math.max(0, (contract.contractQtyKL || 0) - (contract.totalSuppliedKL || 0)),
      progressPct: contract.contractQtyKL ? Math.round(((contract.totalSuppliedKL || 0) / contract.contractQtyKL) * 100) : 0,
      invoicedAmount: totalInvoiceAmount,
      receivedAmount: totalPaid,
      outstanding: Math.round((totalInvoiceAmount - totalPaid) * 100) / 100,
      inTransitCount: inTransit.length,
      inTransitKL: inTransit.reduce((s, l) => s + l.quantityKL, 0),
      deliveredCount: delivered.length,
      totalLiftings: liftings.length,
      daysRemaining: Math.max(0, Math.ceil((new Date(contract.endDate).getTime() - Date.now()) / (86400000))),
      // Last used values for auto-fill
      lastDistanceKm: liftings.find(l => l.distanceKm)?.distanceKm || null,
      lastTransporterName: liftings.find(l => l.transporterName)?.transporterName || null,
    };

    // In-progress trucks at site (not yet released = no lifting yet).
    // Factory gate entry often doesn't set contractId (operator doesn't pick one),
    // so ALSO match trucks where contractId is null AND partyName matches this contract's buyer.
    // Only consider trucks created TODAY (IST) — prevents stale GATE_IN rows from past days
    // showing up forever. The liftingId guard excludes already-released trucks.
    const IST_MS = 5.5 * 60 * 60 * 1000;
    const todayIST = new Date(Date.now() + IST_MS);
    const todayStart = new Date(Date.UTC(todayIST.getUTCFullYear(), todayIST.getUTCMonth(), todayIST.getUTCDate()) - IST_MS);
    const buyerName = contract.buyerName || '';
    const activeTrucks = await prisma.dispatchTruck.findMany({
      where: {
        status: { in: ['GATE_IN', 'TARE_WEIGHED', 'GROSS_WEIGHED'] },
        liftingId: null,
        createdAt: { gte: todayStart },
        OR: [
          { contractId: contract.id },
          { contractId: null, partyName: buyerName },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, date: true, vehicleNo: true, driverName: true, driverPhone: true,
        driverLicense: true, transporterName: true, destination: true, status: true,
        quantityBL: true, strength: true, batchNo: true,
        weightGross: true, weightTare: true, weightNet: true,
        gateInTime: true, tareTime: true, grossTime: true,
        rstNo: true, sealNo: true, pesoDate: true,
        gatePassNo: true, challanNo: true,
        productRatePerLtr: true, productValue: true,
      },
    });

    res.json({ contract: { ...contract, hasPdf: !!contractPdf }, summary, liftings, activeTrucks });
}));

// ── CREATE INVOICE from a lifting ──
router.post('/:id/liftings/:liftingId/create-invoice', asyncHandler(async (req: AuthRequest, res: Response) => {
    // Verify lifting belongs to this contract
    const lifting = await prisma.ethanolLifting.findFirst({
      where: { id: req.params.liftingId, contractId: req.params.id },
    });
    if (!lifting) return res.status(404).json({ error: 'Lifting not found for this contract' });
    if (lifting.invoiceId) return res.status(400).json({ error: 'Invoice already exists for this lifting' });

    const contract = await prisma.ethanolContract.findUnique({ where: { id: req.params.id } });
    if (!contract) return res.status(404).json({ error: 'Contract not found' });

    // Find or create Customer by GSTIN
    let customerId = contract.buyerCustomerId;
    if (!customerId) {
      if (!contract.buyerGst) {
        return res.status(400).json({ error: 'Contract buyer has no GSTIN. Update the contract first.' });
      }
      let customer = await prisma.customer.findFirst({ where: { gstNo: contract.buyerGst } });
      if (!customer) {
        const state = stateFromGstin(contract.buyerGst);
        customer = await prisma.customer.create({
          data: {
            name: contract.buyerName,
            gstNo: contract.buyerGst,
            panNo: contract.buyerPan || null,
            address: contract.buyerAddress || null,
            state: state || null,
            contactPerson: contract.buyerContact || null,
            phone: contract.buyerPhone || null,
            email: contract.buyerEmail || null,
          },
        });
      }
      customerId = customer.id;
      // Backfill FK on contract
      await prisma.ethanolContract.update({ where: { id: contract.id }, data: { buyerCustomerId: customerId } });
    }

    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) return res.status(500).json({ error: 'Customer not found after resolve' });

    const gstPercent = contract.gstPercent || 18;
    const amount = lifting.amount || (lifting.quantityBL * (lifting.rate || 0));
    const gst = calcGstSplit(amount, gstPercent, customer.state, customer.gstNo);
    const totalAmount = Math.round(amount + gst.gstAmount);

    // Atomic: create invoice + link to lifting in transaction to prevent double-create race
    const invoice = await prisma.$transaction(async (tx) => {
      // Re-check inside transaction
      const fresh = await tx.ethanolLifting.findUnique({ where: { id: lifting.id }, select: { invoiceId: true } });
      if (fresh?.invoiceId) throw new Error('Invoice already exists for this lifting');

      // Generate custom invoice number (INV/ETH/001 etc.)
      const series = getInvoiceSeries(contract.contractType);
      const customInvNo = await nextInvoiceNo(tx, series);

      const inv = await tx.invoice.create({
        data: {
          customerId: customer.id,
          invoiceDate: lifting.liftingDate,
          dueDate: contract.paymentTermsDays ? new Date(lifting.liftingDate.getTime() + contract.paymentTermsDays * 86400000) : null,
          productName: contract.contractType === 'JOB_WORK' ? 'Job Work Charges for Ethanol Production' : 'ETHANOL',
          quantity: lifting.quantityBL,
          unit: contract.contractType === 'JOB_WORK' ? 'BL' : 'LTR',
          rate: lifting.rate || 0,
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
          remarks: customInvNo, // store custom invoice no in remarks for now
          userId: (req as any).user?.id || 'system',
        },
      });

      await tx.ethanolLifting.update({
        where: { id: lifting.id },
        data: { invoiceId: inv.id, invoiceNo: customInvNo, status: 'DELIVERED', deliveredQtyKL: lifting.quantityKL },
      });

      return inv;
    });

    // Auto-journal: Dr Trade Receivable, Cr Sales + GST
    onSaleInvoiceCreated(prisma, {
      id: invoice.id, invoiceNo: invoice.invoiceNo, remarks: invoice.remarks, totalAmount: invoice.totalAmount,
      amount: invoice.amount, gstAmount: gst.gstAmount, gstPercent,
      cgstAmount: gst.cgstAmount, sgstAmount: gst.sgstAmount, igstAmount: gst.igstAmount,
      supplyType: gst.supplyType, productName: invoice.productName,
      customerId: customer.id, userId: (req as any).user?.id || 'system',
      invoiceDate: lifting.liftingDate, customer: { state: customer.state },
      companyId: invoice.companyId || undefined,
    });

    res.json({ invoice });
}));

// ── GET /:id/liftings/:liftingId/delivery-challan-pdf ── Challan from lifting data
router.get('/:id/liftings/:liftingId/delivery-challan-pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
    const lifting = await prisma.ethanolLifting.findFirst({
      where: { id: req.params.liftingId, contractId: req.params.id },
      include: {
        contract: { select: { buyerName: true, buyerAddress: true, buyerGst: true, contractType: true, ethanolRate: true } },
        dispatchTruck: { select: { sealNo: true } },
      },
    });
    if (!lifting) return res.status(404).json({ error: 'Lifting not found' });

    const isJobWork = lifting.contract.contractType === 'JOB_WORK';
    const productRate = isJobWork ? 71.86 : (lifting.contract.ethanolRate || 71.86);
    const productValue = Math.round(lifting.quantityBL * productRate);
    const gstRate = 5;
    const gstAmount = Math.round(productValue * gstRate / 100);
    const totalValue = productValue + gstAmount;

    const { renderDocumentPdf } = await import('../services/documentRenderer');
    const pdfBuffer = await renderDocumentPdf({
      docType: 'ETHANOL_CHALLAN',
      data: {
        challanNo: lifting.challanNo || lifting.invoiceNo || '-',
        date: lifting.liftingDate,
        vehicleNo: lifting.vehicleNo,
        driverName: lifting.driverName,
        driverPhone: lifting.driverPhone,
        transporterName: lifting.transporterName,
        destination: lifting.destination,
        rstNo: lifting.rstNo,
        sealNo: lifting.dispatchTruck?.sealNo || null,
        isJobWork,
        buyerName: lifting.contract.buyerName,
        buyerAddress: lifting.contract.buyerAddress || '',
        buyerGst: lifting.contract.buyerGst || '',
        quantityBL: lifting.quantityBL,
        productRate,
        productValue,
        gstRate,
        gstAmount,
        totalValue,
      },
      verifyId: lifting.id,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Challan-${(lifting.challanNo || lifting.id).replace(/\//g, '-')}.pdf"`);
    res.send(pdfBuffer);
}));

// ── GET /:id/liftings/:liftingId/gate-pass-pdf ── Gate pass from lifting data (no DispatchTruck needed)
router.get('/:id/liftings/:liftingId/gate-pass-pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
    const lifting = await prisma.ethanolLifting.findFirst({
      where: { id: req.params.liftingId, contractId: req.params.id },
      include: {
        contract: { select: { contractNo: true, contractType: true, buyerName: true, buyerAddress: true, buyerGst: true, conversionRate: true, ethanolRate: true } },
        dispatchTruck: { select: { weightGross: true, weightTare: true, weightNet: true, sealNo: true, gatePassNo: true } },
      },
    });
    if (!lifting) return res.status(404).json({ error: 'Lifting not found' });

    const isJobWork = lifting.contract.contractType === 'JOB_WORK';
    const rate = isJobWork ? (lifting.contract.conversionRate || 0) : (lifting.contract.ethanolRate || 0);
    const amount = Math.round(lifting.quantityBL * rate);

    const { renderDocumentPdf } = await import('../services/documentRenderer');
    const pdfBuffer = await renderDocumentPdf({
      docType: 'ETHANOL_GATE_PASS',
      data: {
        gatePassNo: lifting.dispatchTruck?.gatePassNo || lifting.challanNo || lifting.rstNo || '-',
        date: lifting.liftingDate,
        vehicleNo: lifting.vehicleNo,
        driverName: lifting.driverName,
        driverPhone: lifting.driverPhone,
        transporterName: lifting.transporterName,
        destination: lifting.destination,
        contractNo: lifting.contract.contractNo,
        rstNo: lifting.rstNo,
        sealNo: lifting.dispatchTruck?.sealNo || null,
        isJobWork,
        buyerName: lifting.contract.buyerName,
        buyerAddress: lifting.contract.buyerAddress || '',
        buyerGst: lifting.contract.buyerGst || '',
        productDescription: isJobWork ? 'Job Work Charges for Ethanol Production' : 'Ethanol',
        hsnCode: isJobWork ? '998842' : '22072000',
        quantityBL: lifting.quantityBL,
        rate,
        amount,
        strength: lifting.strength,
        weightGross: lifting.dispatchTruck?.weightGross || null,
        weightTare: lifting.dispatchTruck?.weightTare || null,
        weightNet: lifting.dispatchTruck?.weightNet || null,
      },
      verifyId: lifting.id,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="GatePass-${lifting.id.slice(0, 8)}.pdf"`);
    res.send(pdfBuffer);
}));

// ── GENERATE E-INVOICE (IRN + EWB) for a lifting ──
router.post('/:id/liftings/:liftingId/e-invoice', asyncHandler(async (req: AuthRequest, res: Response) => {
    // Verify lifting belongs to this contract
    const lifting = await prisma.ethanolLifting.findFirst({
      where: { id: req.params.liftingId, contractId: req.params.id },
      include: { invoice: { include: { customer: true } } },
    });
    if (!lifting) return res.status(404).json({ error: 'Lifting not found for this contract' });
    if (!lifting.invoice) return res.status(400).json({ error: 'Create an invoice for this lifting first.' });
    if (!lifting.vehicleNo?.trim()) return res.status(400).json({ error: 'Vehicle number is required for e-invoice.' });

    const invoice = lifting.invoice;
    const contract = await prisma.ethanolContract.findUnique({ where: { id: req.params.id }, select: { contractType: true } });
    const isJobWork = contract?.contractType === 'JOB_WORK';

    // Validate rate/amount before IRP submission
    if (!invoice.rate || invoice.rate <= 0) {
      return res.status(400).json({ error: 'Invoice rate is zero. Update the invoice first.' });
    }

    // Allow EWB retry: if IRN exists but EWB missing, skip to EWB step
    const irnAlreadyExists = !!invoice.irn;
    if (irnAlreadyExists && invoice.ewbNo) {
      return res.status(400).json({ error: `Both IRN and E-Way Bill already generated.` });
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

    // ── STEP 1: Generate IRN (skip if already exists — EWB retry path) ──
    let irn = invoice.irn;
    let ackNo = invoice.ackNo;

    if (!irnAlreadyExists) {
      const invoiceData = {
        invoiceNo: lifting.invoiceNo || invoiceDisplayNo(invoice),
        invoiceDate: invoice.invoiceDate,
        productName: invoice.productName,
        quantity: invoice.quantity,
        unit: invoice.unit,
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

      // Store IRN on Invoice
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

    // ── STEP 2: Generate E-Way Bill ──
    // For JOB_WORK: standalone EWB with product value (71.86/L) & goods HSN for transport/insurance
    // For others: EWB from IRN (value auto-inherited from e-invoice)
    let ewayBillNo: string | null = null;
    let ewayBillDate: string | null = null;
    let ewbError: string | null = null;

    try {
      const distanceKm = (req.body.distanceKm ? parseInt(req.body.distanceKm) : null) || lifting.distanceKm || 100;
      const vehNo = (lifting.vehicleNo || '').replace(/\s/g, '');
      const transporterGstin = req.body.transporterGstin || '';
      const transporterName = lifting.transporterName || '';

      let ewbResult: any;

      if (isJobWork) {
        // Job work: standalone EWB with product value (71.86/L) & goods HSN
        // Cannot use EWB-from-IRN because SAC 998842 is a service code (error 4009)
        const productRate = lifting.productRatePerLtr || 71.86;
        const productValue = Math.round(lifting.quantityBL * productRate);
        const gstRate = 5;
        const isInterstate = getStateCode(MSPIL.state) !== getStateCode(customer.state || '');
        const igstAmt = isInterstate ? Math.round(productValue * gstRate / 100) : 0;
        const cgstAmt = isInterstate ? 0 : Math.round(productValue * gstRate / 200);
        const sgstAmt = cgstAmt;
        const invDate = new Date(invoice.invoiceDate || lifting.liftingDate);
        const dateStr = `${String(invDate.getDate()).padStart(2, '0')}/${String(invDate.getMonth() + 1).padStart(2, '0')}/${invDate.getFullYear()}`;
        const fromSC = getStateCode(MSPIL.state);
        const toSC = customer.gstNo ? customer.gstNo.substring(0, 2) : getStateCode(customer.state || '');

        // NIC standalone EWB payload format
        const ewbPayload = {
          supplyType: 'O',
          subSupplyType: '3', // Job Work
          docType: 'CHL',
          docNo: lifting.challanNo || lifting.invoiceNo || `DCH-${lifting.id.slice(0, 8)}`,
          docDate: dateStr,
          fromGstin: MSPIL.gstin,
          fromTrdName: MSPIL.name,
          fromAddr1: MSPIL.address,
          fromAddr2: '',
          fromPlace: 'Narsinghpur',
          fromPincode: parseInt(MSPIL.pincode),
          fromStateCode: parseInt(fromSC),
          actFromStateCode: parseInt(fromSC),
          toGstin: customer.gstNo || 'URP',
          toTrdName: customer.name,
          toAddr1: (customer.address || '').substring(0, 120),
          toAddr2: '',
          toPlace: customer.city || '',
          toPincode: parseInt(customer.pincode || '0'),
          toStateCode: parseInt(toSC),
          actToStateCode: parseInt(toSC),
          transactionType: 1,
          totalValue: productValue,
          cgstValue: cgstAmt,
          sgstValue: sgstAmt,
          igstValue: igstAmt,
          cessValue: 0,
          totInvValue: productValue + igstAmt + cgstAmt + sgstAmt,
          transporterId: transporterGstin.length === 15 ? transporterGstin : '',
          transporterName: transporterName.length >= 3 ? transporterName : '',
          transDocNo: '',
          transDocDate: '',
          transMode: '1',
          vehicleNo: vehNo,
          vehicleType: 'R',
          transDistance: distanceKm,
          itemList: [{
            itemNo: 1,
            productName: 'Ethanol',
            productDesc: 'Ethanol',
            hsnCode: 22072000,
            quantity: lifting.quantityBL,
            qtyUnit: 'LTR',
            taxableAmount: productValue,
            cgstRate: isInterstate ? 0 : gstRate / 2,
            sgstRate: isInterstate ? 0 : gstRate / 2,
            igstRate: isInterstate ? gstRate : 0,
            cessRate: 0,
          }],
        };

        // Try standalone EWB via Saral — may fail if EWB portal API not enabled
        // Saral GSP doesn't support standalone EWB — only EWB-from-IRN
        // Job work SAC codes can't use EWB-from-IRN (govt error 4009)
        // Team generates manually on ewaybillgst.gov.in
        const totalWithGst = productValue + (isInterstate ? igstAmt : cgstAmt + sgstAmt);
        ewbResult = {
          success: false,
          error: `Job work EWB: generate manually at ewaybillgst.gov.in | Challan: ${ewbPayload.docNo} | HSN: 22072000 | Value: ₹${totalWithGst.toLocaleString('en-IN')} | Vehicle: ${vehNo} | Distance: ${distanceKm}km`,
        };
      } else {
        // Non-job-work: EWB from IRN
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
        ewbResult = await generateEWBByIRN(irn!, ewbData);
      }

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
      invoiceNo: invoiceDisplayNo(invoice),
      ewayBillNo,
      ewayBillDate,
      ewbError,
      message: ewayBillNo
        ? 'e-Invoice and E-Way Bill generated successfully'
        : `e-Invoice generated (IRN: ${irn}). E-Way Bill failed: ${ewbError}`,
    });
}));

// ── TOGGLE auto e-invoice on contract ──
router.patch('/:id/auto-einvoice', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { enabled } = req.body;
    const contract = await prisma.ethanolContract.update({
      where: { id: req.params.id },
      data: { autoGenerateEInvoice: enabled === true },
      select: { id: true, autoGenerateEInvoice: true },
    });
    res.json({ contract });
}));

// ── E-WAY BILL PDF ──
router.get('/:id/liftings/:liftingId/ewb-pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
    const lifting = await prisma.ethanolLifting.findFirst({
      where: { id: req.params.liftingId, contractId: req.params.id },
      include: { invoice: { include: { customer: true } }, contract: true },
    });
    if (!lifting) return res.status(404).json({ error: 'Lifting not found' });
    if (!lifting.invoice?.ewbNo) return res.status(400).json({ error: 'No E-Way Bill generated for this lifting' });

    const inv = lifting.invoice;

    // Serve uploaded PDF if available (manual uploads for job work)
    if (inv.ewbPdfData) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="EWB-${inv.ewbNo || 'unknown'}.pdf"`);
      return res.send(inv.ewbPdfData);
    }
    const cust = inv.customer;
    const contract = lifting.contract;
    const buyerStateCode = cust.gstNo ? cust.gstNo.substring(0, 2) : '';

    const { renderDocumentPdf } = await import('../services/documentRenderer');
    const { generateQRCode } = await import('../services/templateEngine');
    let ewbQrDataUrl = '';
    try { ewbQrDataUrl = await generateQRCode(String(inv.ewbNo)); } catch { /* non-critical */ }

    const pdfBuffer = await renderDocumentPdf({
      docType: 'EWAY_BILL',
      data: {
        ewbNo: inv.ewbNo,
        ewbDate: inv.ewbDate,
        ewbValidTill: inv.ewbValidTill,
        invoiceNo: inv.invoiceNo,
        invoiceDate: inv.invoiceDate,
        distanceKm: lifting.distanceKm || 0,
        sellerGstin: '23AAECM3666P1Z1',
        sellerName: 'Mahakaushal Sugar And Power Ind (Ethanol Div)',
        sellerState: 'MADHYA PRADESH',
        sellerAddress: 'Village Agariya, Bachai, District Narsinghpur, Madhya Pradesh - 487001',
        buyerGstin: cust.gstNo || '',
        buyerName: cust.name,
        buyerState: (cust.state || '').toUpperCase(),
        buyerAddress: [cust.address, cust.city].filter(Boolean).join(', '),
        buyerPincode: cust.pincode || '',
        productName: inv.productName,
        hsnCode: inv.productName?.toUpperCase().includes('ETHANOL') ? '22072000' : inv.productName?.toUpperCase().includes('DDGS') ? '23033000' : '998817',
        quantity: inv.quantity,
        unit: inv.unit,
        amount: inv.amount,
        supplyType: inv.supplyType,
        cgstPercent: inv.cgstPercent,
        cgstAmount: inv.cgstAmount,
        sgstPercent: inv.sgstPercent,
        sgstAmount: inv.sgstAmount,
        igstPercent: inv.igstPercent,
        igstAmount: inv.igstAmount,
        totalAmount: inv.totalAmount,
        vehicleNo: lifting.vehicleNo,
        transporterName: lifting.transporterName || 'OWN TRANSPORT',
        destination: lifting.destination || cust.state || '',
        ewbQrDataUrl,
      },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="EWB-${inv.ewbNo}.pdf"`);
    res.send(pdfBuffer);
}));

// ── CANCEL E-WAY BILL for a lifting ──
router.post('/:id/liftings/:liftingId/cancel-ewb', asyncHandler(async (req: AuthRequest, res: Response) => {
    const lifting = await prisma.ethanolLifting.findFirst({
      where: { id: req.params.liftingId, contractId: req.params.id },
      include: { invoice: true },
    });
    if (!lifting) return res.status(404).json({ error: 'Lifting not found' });
    if (!lifting.invoice?.ewbNo) return res.status(400).json({ error: 'No E-Way Bill to cancel' });

    const forceLocal = req.body.forceLocal === true; // Skip portal, just mark cancelled in DB

    if (!forceLocal) {
      const { cancelEwayBill } = await import('../services/ewayBill');
      const reasonCode = req.body.reasonCode || 3;
      const remarks = req.body.remarks || 'Cancelled from ERP';
      const result = await cancelEwayBill(String(lifting.invoice.ewbNo), reasonCode, remarks);
      if (!result.success) {
        return res.status(400).json({
          error: result.error || 'EWB cancel failed on portal. Use forceLocal:true to mark cancelled in DB only.',
          rawResponse: result.rawResponse,
        });
      }
    }

    await prisma.invoice.update({
      where: { id: lifting.invoice.id },
      data: { ewbStatus: 'CANCELLED' } as any,
    });

    res.json({ success: true, message: `E-Way Bill ${lifting.invoice.ewbNo} cancelled${forceLocal ? ' (local only)' : ''}` });
}));

// ── CANCEL IRN for a lifting ──
router.post('/:id/liftings/:liftingId/cancel-irn', asyncHandler(async (req: AuthRequest, res: Response) => {
    const lifting = await prisma.ethanolLifting.findFirst({
      where: { id: req.params.liftingId, contractId: req.params.id },
      include: { invoice: true },
    });
    if (!lifting) return res.status(404).json({ error: 'Lifting not found' });
    if (!lifting.invoice?.irn) return res.status(400).json({ error: 'No IRN to cancel' });

    // Must cancel EWB first if exists
    if (lifting.invoice.ewbNo && lifting.invoice.ewbStatus !== 'CANCELLED') {
      return res.status(400).json({ error: 'Cancel the E-Way Bill first before cancelling the IRN' });
    }

    const { cancelIRN: doCancelIRN } = await import('../services/eInvoice');
    const cancelReason = req.body.cancelReason || '2';
    const cancelRemarks = req.body.cancelRemarks || 'Cancelled from ERP';

    const result = await doCancelIRN(lifting.invoice.irn, cancelReason, cancelRemarks);
    if (!result.success) {
      return res.status(400).json({ error: result.error || 'IRN cancel failed', rawResponse: result.rawResponse });
    }

    await prisma.invoice.update({
      where: { id: lifting.invoice.id },
      data: { irnStatus: 'CANCELLED', status: 'CANCELLED' } as any,
    });

    res.json({ success: true, message: `IRN cancelled for INV-${lifting.invoice.invoiceNo}` });
}));

// ── IMPORT HISTORICAL LIFTINGS (one-time migration) ──
router.post('/:id/import-history', asyncHandler(async (req: AuthRequest, res: Response) => {
    const contract = await prisma.ethanolContract.findUnique({ where: { id: req.params.id } });
    if (!contract) return res.status(404).json({ error: 'Contract not found' });

    const rows: { date: string; invoiceNo: string; vehicleNo: string; driverName: string; driverPhone: string; quantityBL: number; rate: number }[] = req.body.rows;
    if (!rows?.length) return res.status(400).json({ error: 'No rows provided' });

    const customerId = contract.buyerCustomerId;
    if (!customerId) return res.status(400).json({ error: 'Contract has no buyer customer linked' });

    const buyer = await prisma.customer.findUnique({ where: { id: customerId }, select: { state: true, gstNo: true } });
    const gstPercent = contract.gstPercent || 18;
    let imported = 0, skipped = 0;

    for (const row of rows) {
      // Skip if already exists (by vehicleNo + date)
      const existing = await prisma.ethanolLifting.findFirst({
        where: { contractId: contract.id, vehicleNo: row.vehicleNo.replace(/\s/g, ''), liftingDate: new Date(row.date) },
      });
      if (existing) { skipped++; continue; }

      const amount = row.quantityBL * row.rate;
      const gst = calcGstSplit(amount, gstPercent, buyer?.state, buyer?.gstNo);
      const totalAmount = Math.round(amount + gst.gstAmount);

      const invoice = await prisma.invoice.create({
        data: {
          customerId,
          invoiceDate: new Date(row.date),
          productName: 'Job Work Charges for Ethanol Production',
          quantity: row.quantityBL, unit: 'BL', rate: row.rate, amount,
          gstPercent, gstAmount: gst.gstAmount, supplyType: gst.supplyType,
          cgstPercent: gst.cgstPercent, cgstAmount: gst.cgstAmount,
          sgstPercent: gst.sgstPercent, sgstAmount: gst.sgstAmount,
          igstPercent: gst.igstPercent, igstAmount: gst.igstAmount,
          totalAmount, paidAmount: totalAmount, balanceAmount: 0,
          status: 'PAID', irnStatus: 'GENERATED', irnDate: new Date(row.date),
          ewbStatus: 'GENERATED',
          userId: (req as any).user?.id || 'system',
        },
      });

      await prisma.ethanolLifting.create({
        data: {
          contractId: contract.id, liftingDate: new Date(row.date),
          vehicleNo: row.vehicleNo.replace(/\s/g, ''),
          driverName: row.driverName || null, driverPhone: row.driverPhone || null,
          destination: 'Odisha', quantityBL: row.quantityBL, quantityKL: row.quantityBL / 1000,
          rate: row.rate, amount, status: 'DELIVERED', deliveredQtyKL: row.quantityBL / 1000,
          invoiceId: invoice.id, invoiceNo: row.invoiceNo,
          dispatchMode: 'TANKER',
        },
      });
      imported++;
    }

    // Update contract totalSuppliedKL
    const allLiftings = await prisma.ethanolLifting.findMany({
      where: { contractId: contract.id }, select: { quantityKL: true },
    
    take: 500,
  });
    const totalKL = allLiftings.reduce((s, l) => s + l.quantityKL, 0);
    await prisma.ethanolContract.update({ where: { id: contract.id }, data: { totalSuppliedKL: totalKL } });

    res.json({ success: true, imported, skipped, totalLiftings: allLiftings.length, totalKL });
}));

// ── EXCEL EXPORT ──
router.get('/export/excel', asyncHandler(async (req: AuthRequest, res: Response) => {
    const ExcelJS = require('exceljs');
    const { contractId, from, to } = req.query;

    const where: Record<string, unknown> = {};
    if (contractId) where.contractId = contractId as string;
    if (from || to) {
      where.liftingDate = {};
      if (from) (where.liftingDate as Record<string, unknown>).gte = new Date(from as string);
      if (to) (where.liftingDate as Record<string, unknown>).lte = new Date(to as string + 'T23:59:59');
    }

    const liftings = await prisma.ethanolLifting.findMany({
      where,
      orderBy: { liftingDate: 'desc' },
      include: { contract: { select: { contractNo: true, buyerName: true, contractType: true, conversionRate: true, ethanolRate: true, principalName: true } } },
      take: 5000,
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'MSPIL ERP';
    const ws = wb.addWorksheet('Ethanol Liftings');

    // Header styling
    const hdrFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } } as const;
    const hdrFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 } as const;
    const borderThin = { style: 'thin', color: { argb: 'FFE2E8F0' } } as const;
    const borders = { top: borderThin, bottom: borderThin, left: borderThin, right: borderThin };

    ws.columns = [
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Contract', key: 'contract', width: 25 },
      { header: 'Party', key: 'party', width: 30 },
      { header: 'Type', key: 'type', width: 12 },
      { header: 'Vehicle', key: 'vehicle', width: 16 },
      { header: 'Qty (BL)', key: 'qtyBL', width: 12 },
      { header: 'Qty (KL)', key: 'qtyKL', width: 12 },
      { header: 'Strength', key: 'strength', width: 10 },
      { header: 'Rate (₹)', key: 'rate', width: 12 },
      { header: 'Amount (₹)', key: 'amount', width: 15 },
      { header: 'Invoice', key: 'invoice', width: 18 },
      { header: 'RST No', key: 'rst', width: 14 },
      { header: 'Transporter', key: 'transporter', width: 22 },
      { header: 'Destination', key: 'destination', width: 20 },
      { header: 'Status', key: 'status', width: 12 },
    ];

    // Style header row
    const headerRow = ws.getRow(1);
    headerRow.eachCell((cell: any) => { cell.fill = hdrFill; cell.font = hdrFont; cell.border = borders; cell.alignment = { vertical: 'middle' }; });
    headerRow.height = 24;

    // Data rows
    for (const l of liftings) {
      const row = ws.addRow({
        date: l.liftingDate,
        contract: l.contract.contractNo,
        party: l.contract.buyerName,
        type: l.contract.contractType === 'JOB_WORK' ? 'Job Work' : l.contract.contractType === 'FIXED_PRICE' ? 'Fixed Price' : 'OMC',
        vehicle: l.vehicleNo,
        qtyBL: l.quantityBL,
        qtyKL: l.quantityKL,
        strength: l.strength,
        rate: l.rate,
        amount: l.amount,
        invoice: l.invoiceNo,
        rst: l.rstNo,
        transporter: l.transporterName,
        destination: l.destination,
        status: l.status,
      });
      row.eachCell((cell: any) => { cell.border = borders; cell.font = { size: 10 }; });
    }

    // Format columns
    ws.getColumn('date').numFmt = 'DD-MMM-YY';
    ws.getColumn('qtyBL').numFmt = '#,##0.00';
    ws.getColumn('qtyKL').numFmt = '#,##0.00';
    ws.getColumn('rate').numFmt = '#,##0.00';
    ws.getColumn('amount').numFmt = '₹#,##0.00';
    ws.getColumn('strength').numFmt = '0.0';

    // Summary row
    const totalBL = liftings.reduce((s, l) => s + l.quantityBL, 0);
    const totalKL = liftings.reduce((s, l) => s + l.quantityKL, 0);
    const totalAmt = liftings.reduce((s, l) => s + (l.amount || 0), 0);
    const sumRow = ws.addRow({ date: '', contract: '', party: 'TOTAL', type: '', vehicle: `${liftings.length} trips`, qtyBL: totalBL, qtyKL: totalKL, strength: '', rate: '', amount: totalAmt });
    sumRow.eachCell((cell: any) => { cell.font = { bold: true, size: 10 }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }; cell.border = borders; });

    // Auto-filter
    ws.autoFilter = { from: 'A1', to: `O${liftings.length + 1}` };

    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `Ethanol-Liftings-${dateStr}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    await wb.xlsx.write(res);
}));

export default router;
