import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import multer from 'multer';
import { lightragInsertText, isRagEnabled } from '../services/lightragClient';
import fs from 'fs';
import path from 'path';
import os from 'os';

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
      include: { liftings: { orderBy: { liftingDate: 'desc' } } },
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

    // Fire-and-forget: write temp file and index in LightRAG
    if (isRagEnabled()) {
      setImmediate(async () => {
        try {
          const tmpFile = path.join(os.tmpdir(), `contract-${req.params.id}-${Date.now()}.pdf`);
          fs.writeFileSync(tmpFile, file.buffer);
          const { lightragUpload } = await import('../services/lightragClient');
          await lightragUpload(tmpFile, {
            sourceType: 'EthanolContract',
            sourceId: req.params.id,
            title: file.originalname,
          });
          fs.unlinkSync(tmpFile);
        } catch (err) {
          console.error('[EthanolContract] LightRAG indexing failed:', err);
        }
      });
    }
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

export default router;
