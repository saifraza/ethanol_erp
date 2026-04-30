import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { drawLetterhead } from '../utils/letterhead';
import { getTemplate } from '../utils/templateHelper';
import { renderDocumentPdf } from '../services/documentRenderer';

const router = Router();
router.use(authenticate as any);

// GET / — List freight inquiries
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const status = req.query.status as string | undefined;
    const where: any = { ...getCompanyFilter(req) };
    if (status) where.status = status;

    const inquiries = await prisma.freightInquiry.findMany({
      where,
      include: {
        quotations: {
          include: {},
          orderBy: { totalAmount: 'asc' as const },
        },
      },
      orderBy: { createdAt: 'desc' },
    
    take: 500,
  });
    res.json({ inquiries });
}));

// GET /:id — Single inquiry with quotations
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const inquiry = await prisma.freightInquiry.findUnique({
      where: { id: req.params.id },
      include: { quotations: true },
    });
    if (!inquiry) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(inquiry);
}));

// POST / — Create freight inquiry
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body;
    const inquiry = await prisma.freightInquiry.create({
      data: {
        dispatchRequestId: b.dispatchRequestId || null,
        orderId: b.orderId || null,
        origin: b.origin || 'MSPIL, Village Bachai, Narsinghpur, MP - 487001',
        destination: b.destination,
        distanceKm: b.distanceKm ? parseFloat(b.distanceKm) : null,
        productName: b.productName,
        quantity: parseFloat(b.quantity) || 0,
        unit: b.unit || 'TON',
        vehicleType: b.vehicleType || null,
        vehicleCount: parseInt(b.vehicleCount) || 1,
        loadingDate: b.loadingDate ? new Date(b.loadingDate) : null,
        validTill: b.validTill ? new Date(b.validTill) : null,
        remarks: b.remarks || null,
        userId: req.user!.id,
        companyId: getActiveCompanyId(req),
      },
      include: { quotations: true },
    });
    res.status(201).json(inquiry);
}));

// PUT /:id — Update inquiry
router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body;
    const data: any = {};
    if (b.destination !== undefined) data.destination = b.destination;
    if (b.distanceKm !== undefined) data.distanceKm = parseFloat(b.distanceKm);
    if (b.productName !== undefined) data.productName = b.productName;
    if (b.quantity !== undefined) data.quantity = parseFloat(b.quantity);
    if (b.vehicleType !== undefined) data.vehicleType = b.vehicleType;
    if (b.vehicleCount !== undefined) data.vehicleCount = parseInt(b.vehicleCount);
    if (b.loadingDate !== undefined) data.loadingDate = b.loadingDate ? new Date(b.loadingDate) : null;
    if (b.status !== undefined) data.status = b.status;
    if (b.remarks !== undefined) data.remarks = b.remarks;

    const inquiry = await prisma.freightInquiry.update({
      where: { id: req.params.id },
      data,
      include: { quotations: true },
    });
    res.json(inquiry);
}));

// POST /:id/quotations — Add quotation to inquiry
router.post('/:id/quotations', asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body;
    const quotation = await prisma.freightQuotation.create({
      data: {
        inquiryId: req.params.id,
        transporterId: b.transporterId || null,
        transporterName: b.transporterName,
        ratePerMT: b.ratePerMT ? parseFloat(b.ratePerMT) : null,
        ratePerTrip: b.ratePerTrip ? parseFloat(b.ratePerTrip) : null,
        ratePerKm: b.ratePerKm ? parseFloat(b.ratePerKm) : null,
        totalAmount: b.totalAmount ? parseFloat(b.totalAmount) : null,
        vehicleType: b.vehicleType || null,
        vehicleCount: parseInt(b.vehicleCount) || 1,
        estimatedDays: b.estimatedDays ? parseInt(b.estimatedDays) : null,
        remarks: b.remarks || null,
      },
    });

    // Update inquiry status
    await prisma.freightInquiry.update({
      where: { id: req.params.id },
      data: { status: 'QUOTES_RECEIVED' },
    });

    res.status(201).json(quotation);
}));

// PUT /quotations/:qid/accept — Accept a quotation
router.put('/quotations/:qid/accept', asyncHandler(async (req: AuthRequest, res: Response) => {
    const quotation = await prisma.freightQuotation.update({
      where: { id: req.params.qid },
      data: { status: 'ACCEPTED' },
    });

    // Reject others for same inquiry
    await prisma.freightQuotation.updateMany({
      where: { inquiryId: quotation.inquiryId, id: { not: req.params.qid } },
      data: { status: 'REJECTED' },
    });

    // Update inquiry status
    await prisma.freightInquiry.update({
      where: { id: quotation.inquiryId },
      data: { status: 'AWARDED' },
    });

    res.json(quotation);
}));

// GET /:id/pdf — Generate Freight Inquiry PDF (MSPIL generated document)
router.get('/:id/pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
    const inquiry = await prisma.freightInquiry.findUnique({
      where: { id: req.params.id },
      include: { quotations: true },
    });
    if (!inquiry) { res.status(404).json({ error: 'Not found' }); return; }

    const inquiryData = {
      inquiryNo: inquiry.inquiryNo,
      createdAt: inquiry.createdAt,
      origin: inquiry.origin,
      destination: inquiry.destination,
      productName: inquiry.productName,
      quantity: inquiry.quantity,
      unit: inquiry.unit,
      distanceKm: inquiry.distanceKm,
      vehicleType: inquiry.vehicleType,
      vehicleCount: inquiry.vehicleCount,
      loadingDate: inquiry.loadingDate,
      remarks: inquiry.remarks,
    };

    const pdfBuffer = await renderDocumentPdf({ docType: 'RATE_REQUEST', data: inquiryData, verifyId: inquiry.id });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=Inquiry-${inquiry.inquiryNo}.pdf`);
    res.send(pdfBuffer);
}));

// DELETE /:id
router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
    await prisma.freightQuotation.deleteMany({ where: { inquiryId: req.params.id } });
    await prisma.freightInquiry.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
}));

export default router;
