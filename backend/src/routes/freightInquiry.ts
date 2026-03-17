import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/auth';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

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

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=Inquiry-${inquiry.inquiryNo}.pdf`);
    doc.pipe(res);

    const pageW = doc.page.width;
    const mL = 40;
    const cW = pageW - 80;

    // Letterhead
    const letterheadPath = path.resolve(__dirname, '../../../assets/letterhead_img_0.jpeg');
    if (fs.existsSync(letterheadPath)) {
      doc.image(letterheadPath, mL, 30, { width: cW, height: 70 });
      doc.y = 110;
    } else {
      doc.fontSize(14).font('Helvetica-Bold').text('Mahakaushal Sugar and Power Industries Ltd.', mL, 30, { align: 'center', width: cW });
      doc.fontSize(8).font('Helvetica').text('GSTIN: 23AAECM3666P1Z1 | Village Bachai, Narsinghpur, MP - 487001', { align: 'center', width: cW });
      doc.y = 70;
    }

    // Divider
    doc.moveTo(mL, doc.y).lineTo(pageW - 40, doc.y).lineWidth(1.5).strokeColor('#4a7c3f').stroke();
    doc.y += 10;

    // Title
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#333').text('FREIGHT INQUIRY', mL, doc.y, { align: 'center', width: cW });
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica').fillColor('#666').text(`Inquiry No: FI-${inquiry.inquiryNo}`, mL, doc.y, { align: 'center', width: cW });
    doc.moveDown(0.3);
    doc.fontSize(8).fillColor('#888').text(`Date: ${new Date(inquiry.createdAt).toLocaleDateString('en-IN')}`, mL, doc.y, { align: 'center', width: cW });
    doc.moveDown(1);

    // Status badge
    const statusColors: Record<string, string> = { OPEN: '#2563eb', QUOTES_RECEIVED: '#d97706', AWARDED: '#16a34a', CANCELLED: '#dc2626' };
    doc.fontSize(9).font('Helvetica-Bold').fillColor(statusColors[inquiry.status] || '#333').text(`Status: ${inquiry.status}`, mL, doc.y);
    doc.moveDown(0.8);

    // Details box
    const boxY = doc.y;
    doc.rect(mL, boxY, cW, 100).lineWidth(0.5).strokeColor('#ccc').stroke();
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#4a7c3f').text('SHIPMENT DETAILS', mL + 10, boxY + 8);

    const col2 = pageW / 2 + 20;
    const detailY = boxY + 26;
    const labelFont = 'Helvetica-Bold';
    const valFont = 'Helvetica';

    const detail = (label: string, val: string, x: number, y: number) => {
      doc.fontSize(9).font(labelFont).fillColor('#555').text(label, x, y);
      doc.font(valFont).fillColor('#333').text(val, x + 90, y);
    };

    detail('Origin:', inquiry.origin || 'MSPIL, Narsinghpur', mL + 10, detailY);
    detail('Destination:', inquiry.destination, col2, detailY);
    detail('Product:', inquiry.productName, mL + 10, detailY + 16);
    detail('Quantity:', `${inquiry.quantity} ${inquiry.unit}`, col2, detailY + 16);
    detail('Distance:', inquiry.distanceKm ? `${inquiry.distanceKm} km` : 'TBD', mL + 10, detailY + 32);
    detail('Vehicle Type:', inquiry.vehicleType || 'Open', col2, detailY + 32);
    detail('Vehicles:', `${inquiry.vehicleCount}`, mL + 10, detailY + 48);
    if (inquiry.loadingDate) detail('Loading Date:', new Date(inquiry.loadingDate).toLocaleDateString('en-IN'), col2, detailY + 48);
    doc.y = boxY + 110;

    // Requirements section
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#333').text('REQUIREMENTS', mL, doc.y);
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica').fillColor('#555');
    doc.text('1. Vehicle must be in good condition with valid fitness certificate.', mL + 10, doc.y);
    doc.moveDown(0.2);
    doc.text('2. Driver must carry valid license and vehicle documents.', mL + 10, doc.y);
    doc.moveDown(0.2);
    doc.text('3. Transporter to provide GR (Bilty) at the time of loading.', mL + 10, doc.y);
    doc.moveDown(0.2);
    doc.text('4. 50% advance payment after bill generation; balance after delivery confirmation.', mL + 10, doc.y);
    doc.moveDown(0.2);
    doc.text('5. Transporter is not responsible for insurance unless specifically agreed.', mL + 10, doc.y);
    doc.moveDown(1);

    // Remarks
    if (inquiry.remarks) {
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#333').text('Remarks:', mL, doc.y);
      doc.font('Helvetica').fillColor('#555').text(inquiry.remarks, mL + 10, doc.y + 14, { width: cW - 20 });
      doc.moveDown(1);
    }

    // Quotation response section
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#333').text('QUOTATION RESPONSE', mL, doc.y);
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica').fillColor('#555');
    doc.text('Please submit your quotation with the following:', mL + 10, doc.y);
    doc.moveDown(0.2);
    doc.text('- Rate per MT / Rate per trip / Rate per km', mL + 20, doc.y);
    doc.moveDown(0.2);
    doc.text('- Vehicle type and number of vehicles available', mL + 20, doc.y);
    doc.moveDown(0.2);
    doc.text('- Estimated transit days', mL + 20, doc.y);
    doc.moveDown(0.2);
    doc.text('- Any terms and conditions', mL + 20, doc.y);
    doc.moveDown(1.5);

    // Signatures
    doc.fontSize(8).font('Helvetica').fillColor('#555');
    doc.text('________________________', mL, doc.y, { width: 200, align: 'center' });
    doc.text('For MSPIL', mL, doc.y + 12, { width: 200, align: 'center' });
    doc.text('________________________', pageW - 40 - 200, doc.y - 12, { width: 200, align: 'center' });
    doc.text('Transporter', pageW - 40 - 200, doc.y, { width: 200, align: 'center' });

    // Footer
    const fY = doc.page.height - 50;
    doc.moveTo(mL, fY).lineTo(pageW - 40, fY).lineWidth(0.5).strokeColor('#ccc').stroke();
    doc.fontSize(7).fillColor('#888').text('This is a system-generated freight inquiry from MSPIL ERP.', mL, fY + 6, { align: 'center', width: cW });

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
