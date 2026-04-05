import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import multer from 'multer';
// RAG indexing removed — only compliance docs go to RAG
import { generateIRN, generateEWBByIRN } from '../services/eInvoice';
import { getStateCode, getHsnCode, MSPIL } from '../services/ewayBill';
import fs from 'fs';
import path from 'path';
import os from 'os';

const COMPANY_STATE = 'Madhya Pradesh';

function calcGstSplit(amount: number, gstPercent: number, customerState: string | null | undefined) {
  const gstAmount = Math.round((amount * gstPercent) / 100 * 100) / 100;
  const isInterstate = customerState && customerState !== COMPANY_STATE;
  if (isInterstate) {
    return { supplyType: 'INTER_STATE' as const, cgstPercent: 0, cgstAmount: 0, sgstPercent: 0, sgstAmount: 0, igstPercent: gstPercent, igstAmount: gstAmount, gstAmount };
  }
  const half = Math.round(gstAmount / 2 * 100) / 100;
  return { supplyType: 'INTRA_STATE' as const, cgstPercent: gstPercent / 2, cgstAmount: half, sgstPercent: gstPercent / 2, sgstAmount: Math.round((gstAmount - half) * 100) / 100, igstPercent: 0, igstAmount: 0, gstAmount };
}

/** Derive state name from GSTIN prefix (first 2 digits) */
function stateFromGstin(gstin: string): string | null {
  const stateMap: Record<string, string> = {
    '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
    '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan',
    '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
    '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
    '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh',
    '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra & Nagar Haveli', '27': 'Maharashtra',
    '29': 'Karnataka', '30': 'Goa', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
    '36': 'Telangana', '37': 'Andhra Pradesh',
  };
  return gstin ? stateMap[gstin.substring(0, 2)] || null : null;
}

const router = Router();
router.use(authenticate as any);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── GET all contracts ──
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { type, status } = req.query;
    const where: any = {};
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

    const contract = await prisma.ethanolContract.create({
      data: {
        contractNo: b.contractNo,
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

    // Auto e-invoice: fire-and-forget if enabled
    if (contract.autoGenerateEInvoice && rate && amount && contract.buyerGst) {
      setImmediate(async () => {
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

          // 2. Create invoice
          const gst = calcGstSplit(amount!, contract.gstPercent || 18, cust.state);
          const total = Math.round((amount! + gst.gstAmount) * 100) / 100;
          const inv = await prisma.invoice.create({
            data: {
              customerId: cust.id, invoiceDate: lifting.liftingDate, productName: 'ETHANOL',
              quantity: qtyBL, unit: 'LTR', rate: rate!, amount: amount!,
              gstPercent: contract.gstPercent || 18, gstAmount: gst.gstAmount, supplyType: gst.supplyType,
              cgstPercent: gst.cgstPercent, cgstAmount: gst.cgstAmount, sgstPercent: gst.sgstPercent, sgstAmount: gst.sgstAmount,
              igstPercent: gst.igstPercent, igstAmount: gst.igstAmount,
              totalAmount: total, balanceAmount: total, status: 'UNPAID', userId: 'system',
            },
          });
          await prisma.ethanolLifting.update({ where: { id: lifting.id }, data: { invoiceId: inv.id, invoiceNo: `INV-${inv.invoiceNo}` } });

          // 3. Generate IRN
          if (cust.gstNo && cust.state && cust.pincode && cust.address) {
            const irnRes = await generateIRN({
              invoiceNo: `INV-${inv.invoiceNo}`, invoiceDate: inv.invoiceDate,
              productName: 'ETHANOL', quantity: inv.quantity, unit: 'LTR', rate: inv.rate, amount: inv.amount, gstPercent: inv.gstPercent,
              customer: { gstin: cust.gstNo, name: cust.name, address: cust.address, city: cust.city || '', pincode: cust.pincode, state: cust.state, phone: cust.phone || '', email: cust.email || '' },
            });
            if (irnRes.success && irnRes.irn) {
              await prisma.invoice.update({ where: { id: inv.id }, data: { irn: irnRes.irn, irnDate: new Date(), irnStatus: 'GENERATED', ackNo: irnRes.ackNo ? String(irnRes.ackNo) : null, signedQRCode: irnRes.signedQRCode?.slice(0, 4000) || null } as any });

              // 4. Generate EWB
              const vehNo = (lifting.vehicleNo || '').replace(/\s/g, '');
              const autoEwbData: Record<string, any> = { Irn: irnRes.irn, Distance: 100, TransMode: '1', VehNo: vehNo, VehType: 'R' };
              if (lifting.transporterName && lifting.transporterName.length >= 3) autoEwbData.TransName = lifting.transporterName;
              const ewbRes = await generateEWBByIRN(irnRes.irn, autoEwbData);
              if (ewbRes.success && ewbRes.ewayBillNo) {
                await prisma.invoice.update({ where: { id: inv.id }, data: { ewbNo: ewbRes.ewayBillNo, ewbDate: new Date(), ewbStatus: 'GENERATED' } as any });
              }
            }
          }
          console.log(`[EthanolContract] Auto e-invoice complete for lifting ${lifting.id}`);
        } catch (err: any) {
          console.error(`[EthanolContract] Auto e-invoice failed for lifting ${lifting.id}:`, err.message);
        }
      });
    }

    res.json({ lifting });
}));

// GET liftings for a contract
router.get('/:id/liftings', asyncHandler(async (req: AuthRequest, res: Response) => {
    const liftings = await prisma.ethanolLifting.findMany({
      where: { contractId: req.params.id },
      orderBy: { liftingDate: 'desc' },
    });
    res.json({ liftings });
}));

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
          },
        },
      },
    });
    if (!raw) return res.status(404).json({ error: 'Contract not found' });
    const { contractPdf, ...contract } = raw;

    const liftings = contract.liftings;
    const inTransit = liftings.filter(l => l.status === 'LOADED' || l.status === 'IN_TRANSIT');
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

    res.json({ contract: { ...contract, hasPdf: !!contractPdf }, summary, liftings });
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
    const gst = calcGstSplit(amount, gstPercent, customer.state);
    const totalAmount = Math.round(amount + gst.gstAmount);

    // Atomic: create invoice + link to lifting in transaction to prevent double-create race
    const invoice = await prisma.$transaction(async (tx) => {
      // Re-check inside transaction
      const fresh = await tx.ethanolLifting.findUnique({ where: { id: lifting.id }, select: { invoiceId: true } });
      if (fresh?.invoiceId) throw new Error('Invoice already exists for this lifting');

      const inv = await tx.invoice.create({
        data: {
          customerId: customer.id,
          invoiceDate: lifting.liftingDate,
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
          userId: (req as any).user?.id || 'system',
        },
      });

      await tx.ethanolLifting.update({
        where: { id: lifting.id },
        data: { invoiceId: inv.id, invoiceNo: contract.contractType === 'JOB_WORK' ? `MSPIL/ETH/${String(inv.invoiceNo).padStart(3, '0')}` : `INV-${inv.invoiceNo}` },
      });

      return inv;
    });

    res.json({ invoice });
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
        invoiceNo: isJobWork ? `MSPIL/ETH/${String(invoice.invoiceNo).padStart(3, '0')}` : `INV-${invoice.invoiceNo}`,
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

    // ── STEP 2: Generate E-Way Bill from IRN ──
    let ewayBillNo: string | null = null;
    let ewayBillDate: string | null = null;
    let ewbError: string | null = null;

    try {
      const distanceKm = (req.body.distanceKm ? parseInt(req.body.distanceKm) : null) || lifting.distanceKm || 100;
      const vehNo = (lifting.vehicleNo || '').replace(/\s/g, '');
      const transporterGstin = req.body.transporterGstin || '';
      const transporterName = lifting.transporterName || '';
      const ewbData: Record<string, any> = {
        Irn: irn,
        Distance: distanceKm,
        TransMode: '1', // Road
        VehNo: vehNo,
        VehType: 'R',
      };
      // TransId must be exactly 15 chars (valid GSTIN) or omitted
      if (transporterGstin && transporterGstin.length === 15) {
        ewbData.TransId = transporterGstin;
      }
      if (transporterName && transporterName.length >= 3) {
        ewbData.TransName = transporterName;
      }

      const ewbResult = await generateEWBByIRN(irn!, ewbData);
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
      invoiceNo: `INV-${invoice.invoiceNo}`,
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

export default router;
