import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import PDFDocument from 'pdfkit';
import { sendEmail } from '../services/messaging';
import { drawLetterhead } from '../utils/letterhead';

const router = Router();
router.use(authenticate as any);

// GET / — list with filters (vendorId, status)
router.get('/', async (req: Request, res: Response) => {
  try {
    const vendorId = req.query.vendorId as string | undefined;
    const status = req.query.status as string | undefined;

    const where: any = {};
    if (vendorId) where.vendorId = vendorId;
    if (status) where.status = status;

    const invoices = await prisma.vendorInvoice.findMany({
      where,
      include: {
        vendor: true,
        po: true,
        grn: true,
      },
      orderBy: { invoiceDate: 'desc' },
    });

    res.json({ invoices });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /outstanding — outstanding vendor invoices grouped by vendor
router.get('/outstanding', async (req: Request, res: Response) => {
  try {
    const invoices = await prisma.vendorInvoice.findMany({
      where: {
        balanceAmount: {
          gt: 0,
        },
      },
      include: {
        vendor: true,
      },
    });

    // Group by vendor
    const grouped: Record<string, any> = {};
    for (const inv of invoices) {
      const vendorId = inv.vendorId;
      if (!grouped[vendorId]) {
        grouped[vendorId] = {
          vendor: inv.vendor,
          invoices: [],
          totalOutstanding: 0,
        };
      }
      grouped[vendorId].invoices.push(inv);
      grouped[vendorId].totalOutstanding += inv.balanceAmount || 0;
    }

    res.json({ outstanding: Object.values(grouped) });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /itc-report — ITC report
router.get('/itc-report', async (req: Request, res: Response) => {
  try {
    const invoices = await prisma.vendorInvoice.findMany({
      where: {
        status: { in: ['VERIFIED', 'APPROVED', 'PAID'] },
      },
      include: {
        vendor: true,
      },
      orderBy: { invoiceDate: 'desc' },
    });

    const report = invoices.map((inv: any) => ({
      ...inv,
      calcCgst: (inv.subtotal || 0) * ((inv.gstPercent || 0) / 2 / 100),
      calcSgst: (inv.subtotal || 0) * ((inv.gstPercent || 0) / 2 / 100),
      calcIgst: (inv.subtotal || 0) * ((inv.gstPercent || 0) / 100),
      itcEligible: inv.isRCM === false,
    }));

    res.json({ report });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /:id — single with vendor, po, grn, payments
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const invoice = await prisma.vendorInvoice.findUnique({
      where: { id: req.params.id },
      include: {
        vendor: true,
        po: true,
        grn: true,
        payments: true,
      },
    });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json(invoice);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST / — create vendor invoice
router.post('/', async (req: Request, res: Response) => {
  try {
    const b = req.body;

    const quantity = parseFloat(b.quantity) || 0;
    const rate = parseFloat(b.rate) || 0;
    const gstPercent = parseFloat(b.gstPercent) || 0;
    const freightCharge = parseFloat(b.freightCharge) || 0;
    const loadingCharge = parseFloat(b.loadingCharge) || 0;
    const otherCharges = parseFloat(b.otherCharges) || 0;
    const roundOff = parseFloat(b.roundOff) || 0;
    const tdsPercent = parseFloat(b.tdsPercent) || 0;

    const subtotal = quantity * rate;

    let cgstAmount = 0, sgstAmount = 0, igstAmount = 0;
    if (b.supplyType === 'INTRA_STATE') {
      cgstAmount = subtotal * ((gstPercent / 2) / 100);
      sgstAmount = subtotal * ((gstPercent / 2) / 100);
    } else if (b.supplyType === 'INTER_STATE') {
      igstAmount = subtotal * (gstPercent / 100);
    }

    const totalGst = cgstAmount + sgstAmount + igstAmount;
    let rcmCgst = 0, rcmSgst = 0, rcmIgst = 0;

    if (b.isRCM) {
      rcmCgst = cgstAmount;
      rcmSgst = sgstAmount;
      rcmIgst = igstAmount;
    }

    const totalAmount = subtotal + totalGst + freightCharge + loadingCharge + otherCharges + roundOff;
    const tdsAmount = subtotal * (tdsPercent / 100);
    const netPayable = totalAmount - tdsAmount;
    const balanceAmount = netPayable;

    // 3-way match
    let matchStatus = 'UNMATCHED';
    if (b.poId && b.grnId) {
      const po = await prisma.purchaseOrder.findUnique({
        where: { id: b.poId },
        include: { lines: true },
      });
      const grn = await prisma.goodsReceipt.findUnique({
        where: { id: b.grnId },
        include: { lines: true },
      });

      if (po && grn) {
        const poQty = po.lines.reduce((sum, line) => sum + line.quantity, 0);
        const grnQty = grn.lines.reduce((sum, line) => sum + line.acceptedQty, 0);

        if (Math.abs(poQty - quantity) < 0.01 && Math.abs(grnQty - quantity) < 0.01) {
          matchStatus = 'MATCHED';
        } else {
          matchStatus = 'MISMATCH';
        }
      }
    }

    const invoice = await prisma.vendorInvoice.create({
      data: {
        vendorId: b.vendorId,
        poId: b.poId || null,
        grnId: b.grnId || null,
        vendorInvNo: b.vendorInvNo || '',
        vendorInvDate: b.vendorInvDate ? new Date(b.vendorInvDate) : new Date(),
        invoiceDate: b.invoiceDate ? new Date(b.invoiceDate) : new Date(),
        dueDate: b.dueDate ? new Date(b.dueDate) : null,
        productName: b.productName || '',
        quantity,
        unit: b.unit || 'kg',
        rate,
        supplyType: b.supplyType || 'INTRA_STATE',
        gstPercent,
        isRCM: b.isRCM || false,
        cgstAmount,
        sgstAmount,
        igstAmount,
        totalGst,
        rcmCgst,
        rcmSgst,
        rcmIgst,
        itcEligible: b.isRCM === false,
        subtotal,
        freightCharge,
        loadingCharge,
        otherCharges,
        roundOff,
        totalAmount,
        tdsSection: b.tdsSection || null,
        tdsPercent,
        tdsAmount,
        netPayable,
        paidAmount: 0,
        balanceAmount,
        matchStatus,
        status: 'PENDING',
        remarks: b.remarks || null,
        userId: (req as any).user.id,
      },
    });

    res.status(201).json(invoice);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /:id — edit vendor invoice (only PENDING status)
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const existing = await prisma.vendorInvoice.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });
    if (existing.status !== 'PENDING') {
      return res.status(400).json({ error: 'Can only edit invoices in PENDING status' });
    }

    const b = req.body;
    const quantity = b.quantity !== undefined ? parseFloat(b.quantity) : existing.quantity;
    const rate = b.rate !== undefined ? parseFloat(b.rate) : existing.rate;
    const gstPercent = b.gstPercent !== undefined ? parseFloat(b.gstPercent) : existing.gstPercent;
    const freightCharge = b.freightCharge !== undefined ? parseFloat(b.freightCharge) : existing.freightCharge;
    const loadingCharge = b.loadingCharge !== undefined ? parseFloat(b.loadingCharge) : existing.loadingCharge;
    const otherCharges = b.otherCharges !== undefined ? parseFloat(b.otherCharges) : existing.otherCharges;
    const roundOff = b.roundOff !== undefined ? parseFloat(b.roundOff) : existing.roundOff;
    const tdsPercent = b.tdsPercent !== undefined ? parseFloat(b.tdsPercent) : existing.tdsPercent;
    const supplyType = b.supplyType || existing.supplyType;

    const subtotal = quantity * rate;
    let cgstAmount = 0, sgstAmount = 0, igstAmount = 0;
    if (supplyType === 'INTRA_STATE') {
      cgstAmount = subtotal * ((gstPercent / 2) / 100);
      sgstAmount = subtotal * ((gstPercent / 2) / 100);
    } else {
      igstAmount = subtotal * (gstPercent / 100);
    }
    const totalGst = cgstAmount + sgstAmount + igstAmount;
    const isRCM = b.isRCM !== undefined ? b.isRCM : existing.isRCM;
    const totalAmount = subtotal + totalGst + freightCharge + loadingCharge + otherCharges + roundOff;
    const tdsAmount = subtotal * (tdsPercent / 100);
    const netPayable = totalAmount - tdsAmount;
    const balanceAmount = netPayable - (existing.paidAmount || 0);

    const invoice = await prisma.vendorInvoice.update({
      where: { id: req.params.id },
      data: {
        vendorInvNo: b.vendorInvNo ?? existing.vendorInvNo,
        vendorInvDate: b.vendorInvDate ? new Date(b.vendorInvDate) : existing.vendorInvDate,
        invoiceDate: b.invoiceDate ? new Date(b.invoiceDate) : existing.invoiceDate,
        dueDate: b.dueDate ? new Date(b.dueDate) : existing.dueDate,
        productName: b.productName ?? existing.productName,
        quantity, unit: b.unit || existing.unit, rate, subtotal,
        supplyType, gstPercent, isRCM,
        cgstAmount, sgstAmount, igstAmount, totalGst,
        rcmCgst: isRCM ? cgstAmount : 0, rcmSgst: isRCM ? sgstAmount : 0, rcmIgst: isRCM ? igstAmount : 0,
        freightCharge, loadingCharge, otherCharges, roundOff,
        totalAmount, tdsSection: b.tdsSection ?? existing.tdsSection,
        tdsPercent, tdsAmount, netPayable, balanceAmount: Math.max(0, balanceAmount),
        remarks: b.remarks ?? existing.remarks,
        poId: b.poId !== undefined ? (b.poId || null) : existing.poId,
        grnId: b.grnId !== undefined ? (b.grnId || null) : existing.grnId,
      },
    });
    res.json(invoice);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /:id/status — status transitions
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const { newStatus } = req.body;
    const invoice = await prisma.vendorInvoice.findUnique({
      where: { id: req.params.id },
    });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const validTransitions: Record<string, string[]> = {
      'PENDING': ['VERIFIED', 'CANCELLED'],
      'VERIFIED': ['APPROVED', 'CANCELLED'],
      'APPROVED': ['PAID', 'CANCELLED'],
      'PAID': [],
      'CANCELLED': [],
    };

    if (!validTransitions[invoice.status] || !validTransitions[invoice.status].includes(newStatus)) {
      return res.status(400).json({ error: `Invalid status transition from ${invoice.status} to ${newStatus}` });
    }

    const updated = await prisma.vendorInvoice.update({
      where: { id: req.params.id },
      data: { status: newStatus },
    });

    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /:id/itc — update ITC status
router.put('/:id/itc', async (req: Request, res: Response) => {
  try {
    const { itcClaimed, itcClaimedDate, itcReversed, itcReversalReason } = req.body;
    const invoice = await prisma.vendorInvoice.update({
      where: { id: req.params.id },
      data: {
        itcClaimed,
        itcClaimedDate: itcClaimedDate ? new Date(itcClaimedDate) : undefined,
        itcReversed,
        itcReversalReason,
      },
    });
    res.json(invoice);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /:id/pdf — Generate Vendor Invoice PDF
router.get('/:id/pdf', async (req: Request, res: Response) => {
  try {
    const inv = await prisma.vendorInvoice.findUnique({
      where: { id: req.params.id },
      include: { vendor: true },
    });
    if (!inv) { res.status(404).json({ error: 'Vendor invoice not found' }); return; }

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="VI-${inv.invoiceNo || inv.id.slice(0, 8)}.pdf"`);
    doc.pipe(res);

    drawLetterhead(doc, 40, 515);
    doc.moveDown(0.5);
    doc.fontSize(14).font('Helvetica-Bold').text('VENDOR INVOICE', { align: 'center' });
    doc.moveDown(0.5);

    doc.fontSize(9).font('Helvetica');
    doc.text(`Invoice No: VI-${String(inv.invoiceNo).padStart(4, '0')}`, 40);
    doc.text(`Vendor Inv No: ${inv.vendorInvNo || '-'}`);
    doc.text(`Invoice Date: ${inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString('en-IN') : '-'}`);
    doc.text(`Vendor: ${(inv as any).vendor?.name || '-'}`);
    doc.text(`GSTIN: ${(inv as any).vendor?.gstin || '-'}`);
    doc.text(`Status: ${inv.status}`);
    doc.moveDown();

    // Single line item (flat model)
    const tableTop = doc.y;
    doc.font('Helvetica-Bold').fontSize(8);
    doc.text('Product', 40, tableTop, { width: 180 });
    doc.text('Qty', 220, tableTop, { width: 50, align: 'right' });
    doc.text('Unit', 270, tableTop, { width: 40 });
    doc.text('Rate', 310, tableTop, { width: 60, align: 'right' });
    doc.text('GST%', 370, tableTop, { width: 40, align: 'right' });
    doc.text('Amount', 410, tableTop, { width: 80, align: 'right' });
    doc.moveTo(40, tableTop + 12).lineTo(555, tableTop + 12).stroke();

    const y = tableTop + 16;
    doc.font('Helvetica').fontSize(8);
    doc.text(inv.productName || '-', 40, y, { width: 180 });
    doc.text(String(inv.quantity || 0), 220, y, { width: 50, align: 'right' });
    doc.text(inv.unit || '', 270, y, { width: 40 });
    doc.text(String(inv.rate || 0), 310, y, { width: 60, align: 'right' });
    doc.text(String(inv.gstPercent || 0), 370, y, { width: 40, align: 'right' });
    doc.text(inv.subtotal.toLocaleString('en-IN'), 410, y, { width: 80, align: 'right' });

    doc.moveDown(3);
    doc.font('Helvetica').fontSize(9);
    doc.text(`Subtotal: Rs. ${inv.subtotal.toLocaleString('en-IN')}`, { align: 'right' });
    doc.text(`GST: Rs. ${inv.totalGst.toLocaleString('en-IN')}`, { align: 'right' });
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text(`Net Payable: Rs. ${inv.netPayable.toLocaleString('en-IN')}`, { align: 'right' });

    doc.end();
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /:id/send-email — Send Vendor Invoice via email
router.post('/:id/send-email', async (req: Request, res: Response) => {
  try {
    const inv = await prisma.vendorInvoice.findUnique({
      where: { id: req.params.id },
      include: { vendor: true },
    });
    if (!inv) { res.status(404).json({ error: 'Vendor invoice not found' }); return; }

    const toEmail = req.body.to || (inv as any).vendor?.email;
    if (!toEmail) { res.status(400).json({ error: 'No email address. Add vendor email or provide "to" in request.' }); return; }

    // Generate PDF buffer
    const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.fontSize(14).font('Helvetica-Bold').text('VENDOR INVOICE', { align: 'center' });
      doc.moveDown();
      doc.fontSize(9).font('Helvetica');
      doc.text(`Invoice No: VI-${String(inv.invoiceNo).padStart(4, '0')}`);
      doc.text(`Vendor Inv No: ${inv.vendorInvNo || '-'}`);
      doc.text(`Date: ${inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString('en-IN') : '-'}`);
      doc.text(`Vendor: ${(inv as any).vendor?.name || '-'}`);
      doc.text(`Product: ${inv.productName || '-'}`);
      doc.text(`Qty: ${inv.quantity} ${inv.unit} @ Rs.${inv.rate}`);
      doc.text(`Net Payable: Rs. ${inv.netPayable.toLocaleString('en-IN')}`);
      doc.text(`Status: ${inv.status}`);
      doc.end();
    });

    const label = `VI-${String(inv.invoiceNo).padStart(4, '0')}`;
    const subject = req.body.subject || `${label} — Vendor Invoice from MSPIL`;
    const body = req.body.body || `Dear ${(inv as any).vendor?.name || 'Vendor'},\n\nPlease find attached vendor invoice ${label}.\n\nRegards,\nMSPIL Distillery`;

    const result = await sendEmail({
      to: toEmail, subject, text: body,
      attachments: [{ filename: `${label}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }],
    });

    if (result.success) {
      res.json({ ok: true, messageId: result.messageId, sentTo: toEmail });
    } else {
      res.status(500).json({ error: result.error || 'Email send failed' });
    }
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
