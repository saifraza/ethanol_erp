import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/auth';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { drawLetterhead } from '../utils/letterhead';
import { getTemplate } from '../utils/templateHelper';

const router = Router();
router.use(authenticate as any);

// GET / — List freight inquiries
router.get('/', async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const where: any = {};
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
    });
    res.json({ inquiries });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /:id — Single inquiry with quotations
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const inquiry = await prisma.freightInquiry.findUnique({
      where: { id: req.params.id },
      include: { quotations: true },
    });
    if (!inquiry) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(inquiry);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST / — Create freight inquiry
router.post('/', async (req: Request, res: Response) => {
  try {
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
        userId: (req as any).user.id,
      },
      include: { quotations: true },
    });
    res.status(201).json(inquiry);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /:id — Update inquiry
router.put('/:id', async (req: Request, res: Response) => {
  try {
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
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /:id/quotations — Add quotation to inquiry
router.post('/:id/quotations', async (req: Request, res: Response) => {
  try {
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
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /quotations/:qid/accept — Accept a quotation
router.put('/quotations/:qid/accept', async (req: Request, res: Response) => {
  try {
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
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /:id/pdf — Generate Freight Inquiry PDF (MSPIL generated document)
router.get('/:id/pdf', async (req: Request, res: Response) => {
  try {
    const inquiry = await prisma.freightInquiry.findUnique({
      where: { id: req.params.id },
      include: { quotations: true },
    });
    if (!inquiry) { res.status(404).json({ error: 'Not found' }); return; }

    const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 0, left: 40, right: 40 } });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=Inquiry-${inquiry.inquiryNo}.pdf`);
    doc.pipe(res);

    const pageW = doc.page.width;
    const mL = 40;
    const cW = pageW - 80;

    // Letterhead (HD vector)
    const afterLH = drawLetterhead(doc, mL, cW);
    doc.y = afterLH + 4;

    // Title + Inquiry No on same line
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#333').text('FREIGHT INQUIRY', mL, doc.y, { continued: true, width: cW });
    doc.fontSize(9).font('Helvetica').fillColor('#666').text(`   FI-${inquiry.inquiryNo}  |  ${new Date(inquiry.createdAt).toLocaleDateString('en-IN')}`, { align: 'right' });
    doc.y += 6;

    // Details box
    const boxY = doc.y;
    doc.rect(mL, boxY, cW, 85).lineWidth(0.5).strokeColor('#ccc').stroke();
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#4a7c3f').text('SHIPMENT DETAILS', mL + 8, boxY + 5, { lineBreak: false });

    const col2 = pageW / 2 + 10;
    const colValW = (pageW / 2) - 50 - 70; // constrain value width
    const detailY = boxY + 18;
    const labelFont = 'Helvetica-Bold';
    const valFont = 'Helvetica';

    const detail = (label: string, val: string, x: number, y: number) => {
      doc.fontSize(8).font(labelFont).fillColor('#555').text(label, x, y, { lineBreak: false });
      doc.font(valFont).fillColor('#333').text(val, x + 70, y, { width: colValW, lineBreak: false });
    };

    detail('Origin:', inquiry.origin || 'MSPIL, Narsinghpur', mL + 8, detailY);
    detail('Destination:', inquiry.destination, col2, detailY);
    detail('Product:', inquiry.productName, mL + 8, detailY + 14);
    detail('Quantity:', `${inquiry.quantity} ${inquiry.unit}`, col2, detailY + 14);
    detail('Distance:', inquiry.distanceKm ? `${inquiry.distanceKm} km` : 'TBD', mL + 8, detailY + 28);
    detail('Vehicles:', `${inquiry.vehicleCount} (${inquiry.vehicleType || 'Open'})`, col2, detailY + 28);
    detail('Loading:', inquiry.loadingDate ? new Date(inquiry.loadingDate).toLocaleDateString('en-IN') : 'TBD', mL + 8, detailY + 42);
    doc.y = boxY + 92;

    // Requirements — from template
    const tmpl = await getTemplate('RATE_REQUEST');
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#333').text('Terms:', mL, doc.y);
    doc.y += 10;
    doc.fontSize(7).font('Helvetica').fillColor('#555');
    tmpl.terms.forEach((t, i) => {
      doc.text(`${i + 1}. ${t}`, mL + 8, doc.y);
      doc.y += 10;
    });
    doc.y += 4;

    // Remarks (compact)
    if (inquiry.remarks) {
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#333').text('Remarks: ', mL, doc.y, { continued: true });
      doc.font('Helvetica').fillColor('#555').text(inquiry.remarks);
      doc.y += 6;
    }

    // Quotation response — compact
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#333').text('Please quote:', mL, doc.y);
    doc.y += 10;
    doc.fontSize(7).font('Helvetica').fillColor('#555');
    ['Rate per MT / trip / km', 'Vehicle type & count available', 'Estimated transit days', 'Terms & conditions'].forEach(t => {
      doc.text(`• ${t}`, mL + 8, doc.y);
      doc.y += 10;
    });
    doc.y += 15;

    // Signatures
    doc.fontSize(8).font('Helvetica').fillColor('#555');
    doc.text('________________________', mL, doc.y, { width: 200, align: 'center' });
    doc.text('For MSPIL', mL, doc.y + 10, { width: 200, align: 'center' });
    doc.text('________________________', pageW - 40 - 200, doc.y - 10, { width: 200, align: 'center' });
    doc.text('Transporter', pageW - 40 - 200, doc.y, { width: 200, align: 'center' });

    // Footer — placed below signatures, not at absolute bottom (prevents page 2)
    doc.y += 30;
    const fY = Math.min(doc.y, doc.page.height - 50);
    if (fY < doc.page.height - 10) {
      doc.moveTo(mL, fY).lineTo(pageW - 40, fY).lineWidth(0.5).strokeColor('#ccc').stroke();
      doc.fontSize(7).fillColor('#888').text(tmpl.footer || 'This is a system-generated freight inquiry from MSPIL ERP.', mL, fY + 6, { align: 'center', width: cW });
    }

    doc.end();
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await prisma.freightQuotation.deleteMany({ where: { inquiryId: req.params.id } });
    await prisma.freightInquiry.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
