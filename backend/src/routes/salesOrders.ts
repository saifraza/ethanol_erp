import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import PDFDocument from 'pdfkit';
import path from 'path';
// RAG indexing removed — only compliance docs go to RAG
import fs from 'fs';
import { sendEmail } from '../services/messaging';
import { drawLetterhead } from '../utils/letterhead';
import { getTemplate } from '../utils/templateHelper';
import { renderDocumentPdf } from '../services/documentRenderer';

const router = Router();

router.use(authenticate as any);

// GET / — List sales orders with filters
router.get('/', async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const customerId = req.query.customerId as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    let where: any = {};
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;

    const [orders, total] = await Promise.all([
      prisma.salesOrder.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, shortName: true } },
          lines: true,
          dispatchRequests: {
            include: {
              shipments: {
                select: { id: true, status: true, vehicleNo: true, weightNet: true, challanNo: true, ewayBill: true },
              },
            },
          },
          invoices: {
            select: { id: true, invoiceNo: true, status: true, totalAmount: true },
          },
        },
        orderBy: { orderDate: 'desc' },
        skip,
        take: limit,
      }),
      prisma.salesOrder.count({ where }),
    ]);

    res.json({
      orders,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:id — Single order with all details
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const order = await prisma.salesOrder.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        lines: true,
        dispatchRequests: {
          include: { _count: { select: { shipments: true } } },
        },
        invoices: true,
      },
    });

    if (!order) {
      res.status(404).json({ error: 'Sales order not found' });
      return;
    }

    res.json(order);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST / — Create sales order with lines
router.post('/', async (req: Request, res: Response) => {
  try {
    const b = req.body;

    // Accept both "lines" and "lineItems" from frontend
    const rawLines = b.lines || b.lineItems;

    // Validate required fields
    if (!b.customerId || !rawLines || !Array.isArray(rawLines) || rawLines.length === 0) {
      res.status(400).json({ error: 'customerId and lines array are required' });
      return;
    }

    // Verify customer exists
    const customer = await prisma.customer.findUnique({
      where: { id: b.customerId },
    });
    if (!customer) {
      res.status(400).json({ error: 'Customer not found' });
      return;
    }

    // Lookup product details for lines
    const productIds = rawLines.map((l: any) => l.productId).filter(Boolean);
    const products = productIds.length > 0
      ? await prisma.product.findMany({ where: { id: { in: productIds } } })
      : [];
    const productMap = Object.fromEntries(products.map(p => [p.id, p]));

    // Process lines and calculate totals
    const processedLines = rawLines.map((line: any) => {
      const product = productMap[line.productId];
      const quantity = parseFloat(line.quantity) || 0;
      const rate = parseFloat(line.rate) || (product?.defaultRate || 0);
      const gstPercent = !isNaN(parseFloat(line.gstPercent)) ? parseFloat(line.gstPercent) : (product?.gstPercent || 0);

      const amount = quantity * rate;
      const gstAmount = (amount * gstPercent) / 100;
      const totalAmount = amount + gstAmount;

      return {
        productName: line.productName || product?.name || '',
        quantity,
        unit: line.unit || product?.unit || '',
        rate,
        gstPercent,
        amount,
        gstAmount,
        totalAmount,
        pendingQty: quantity,
      };
    });

    // Calculate header totals
    const subtotal = processedLines.reduce(
      (sum: number, line: any) => sum + line.amount,
      0
    );
    const totalGst = processedLines.reduce(
      (sum: number, line: any) => sum + line.gstAmount,
      0
    );
    const freight = parseFloat(b.freight) || (b.freightRate ? parseFloat(b.freightRate) * processedLines.reduce((s: number, l: any) => s + l.quantity, 0) : 0);
    const totalAmount = subtotal;
    const grandTotal = subtotal + totalGst + freight;

    // Create order with lines in transaction
    const order = await prisma.salesOrder.create({
      data: {
        customer: { connect: { id: b.customerId } },
        orderDate: b.orderDate ? new Date(b.orderDate) : new Date(),
        deliveryDate: b.deliveryDate ? new Date(b.deliveryDate) : null,
        poNumber: b.poNumber || null,
        paymentTerms: b.paymentTerms || 'ADVANCE',
        logisticsBy: b.logisticsBy || 'BUYER',
        deliveryAddress: b.deliveryAddress || null,
        transporterId: b.transporterId || null,
        freightRate: b.freightRate ? parseFloat(b.freightRate) : 0,
        remarks: b.remarks || null,
        status: 'DRAFT',
        totalGst,
        totalAmount,
        grandTotal,
        userId: (req as any).user.id,
        lines: {
          create: processedLines,
        },
      },
      include: {
        customer: { select: { id: true, name: true, shortName: true } },
        lines: true,
      },
    });

    res.status(201).json(order);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:id/status — Update order status
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const { status } = req.body;

    if (!status) {
      res.status(400).json({ error: 'status is required' });
      return;
    }

    // Validate transitions
    const order = await prisma.salesOrder.findUnique({
      where: { id: req.params.id },
    });

    if (!order) {
      res.status(404).json({ error: 'Sales order not found' });
      return;
    }

    const allowedTransitions: { [key: string]: string[] } = {
      DRAFT: ['CONFIRMED', 'CANCELLED'],
      CONFIRMED: ['IN_PROGRESS', 'CANCELLED'],
      IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
      COMPLETED: ['CANCELLED'],
      CANCELLED: [],
    };

    const allowed = allowedTransitions[order.status] || [];
    if (!allowed.includes(status)) {
      res.status(400).json({
        error: `Cannot transition from ${order.status} to ${status}`,
      });
      return;
    }

    const updated = await prisma.salesOrder.update({
      where: { id: req.params.id },
      data: { status },
      include: {
        customer: { select: { id: true, name: true, shortName: true } },
        lines: true,
      },
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:id — Update order details (only if DRAFT)
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const order = await prisma.salesOrder.findUnique({
      where: { id: req.params.id },
    });

    if (!order) {
      res.status(404).json({ error: 'Sales order not found' });
      return;
    }

    if (order.status !== 'DRAFT') {
      res.status(400).json({
        error: 'Can only update details when order status is DRAFT',
      });
      return;
    }

    const updateData: any = {};
    if (req.body.deliveryDate)
      updateData.deliveryDate = new Date(req.body.deliveryDate);
    if (req.body.poNumber !== undefined) updateData.poNumber = req.body.poNumber;
    if (req.body.paymentTerms !== undefined)
      updateData.paymentTerms = req.body.paymentTerms;
    if (req.body.logisticsBy !== undefined)
      updateData.logisticsBy = req.body.logisticsBy;
    if (req.body.transporterId !== undefined)
      updateData.transporterId = req.body.transporterId;
    if (req.body.freightRate !== undefined)
      updateData.freightRate = parseFloat(req.body.freightRate);
    if (req.body.remarks !== undefined) updateData.remarks = req.body.remarks;

    const updated = await prisma.salesOrder.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        customer: { select: { id: true, name: true, shortName: true } },
        lines: true,
      },
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:id — Delete order (only if DRAFT). Delete with lines (cascade).
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const order = await prisma.salesOrder.findUnique({
      where: { id: req.params.id },
    });

    if (!order) {
      res.status(404).json({ error: 'Sales order not found' });
      return;
    }

    // Delete related records first (cascade)
    // Delete shipments under dispatch requests
    const drs = await prisma.dispatchRequest.findMany({
      where: { orderId: req.params.id },
      select: { id: true },
    });
    const drIds = drs.map(d => d.id);
    if (drIds.length > 0) {
      await prisma.shipment.deleteMany({ where: { dispatchRequestId: { in: drIds } } });
    }
    await prisma.dispatchRequest.deleteMany({ where: { orderId: req.params.id } });
    await prisma.invoice.deleteMany({ where: { orderId: req.params.id } });
    await prisma.salesOrderLine.deleteMany({ where: { orderId: req.params.id } });

    // Delete order
    await prisma.salesOrder.delete({ where: { id: req.params.id } });

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// HSN code mapping for products
function getSOHsnCode(productName: string): string {
  const upper = (productName || '').toUpperCase();
  if (upper.includes('DDGS') || upper.includes('DISTILLER')) return '2303.30.00';
  if (upper.includes('ETHANOL') || upper.includes('ENA') || upper.includes('RS') || upper.includes('RECTIFIED')) return '2207.20.00';
  if (upper.includes('LFO') || upper.includes('LIGHT FUEL')) return '2710.19.40';
  if (upper.includes('HFO') || upper.includes('HEAVY FUEL')) return '2710.19.60';
  return '2207.20.00';
}

// GET /:id/pdf — Generate Sales Order PDF document
router.get('/:id/pdf', async (req: Request, res: Response) => {
  try {
    const order = await prisma.salesOrder.findUnique({
      where: { id: req.params.id },
      include: { customer: true, lines: true },
    });

    if (!order) { res.status(404).json({ error: 'Sales order not found' }); return; }

    const soData = {
      orderNo: order.orderNo,
      orderDate: order.orderDate,
      deliveryDate: order.deliveryDate,
      poNumber: order.poNumber,
      paymentTerms: order.paymentTerms,
      logisticsBy: order.logisticsBy,
      freightRate: order.freightRate,
      customer: order.customer,
      lines: order.lines.map((l: any) => ({
        productName: l.productName,
        hsnCode: l.hsnCode || getSOHsnCode(l.productName),
        quantity: l.quantity,
        unit: l.unit,
        rate: l.rate,
        gstPercent: l.gstPercent,
        gstAmount: l.gstAmount,
        totalAmount: l.totalAmount,
      })),
      totalAmount: order.totalAmount,
      totalGst: order.totalGst,
      grandTotal: order.grandTotal,
      remarks: order.remarks,
    };

    const pdfBuffer = await renderDocumentPdf({
      docType: 'SALE_ORDER',
      data: soData,
      verifyId: order.id,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=SO-${order.orderNo}.pdf`);
    res.send(pdfBuffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:id/send-email — Send Sales Order PDF to customer via email
router.post('/:id/send-email', async (req: Request, res: Response) => {
  try {
    const order = await prisma.salesOrder.findUnique({
      where: { id: req.params.id },
      include: { customer: true, lines: true },
    });
    if (!order) { res.status(404).json({ error: 'Sales order not found' }); return; }

    const toEmail = req.body.to || order.customer.email;
    if (!toEmail) { res.status(400).json({ error: 'No email address. Add customer email or provide "to" in request.' }); return; }

    // Generate PDF to buffer (reuse the PDF generation logic from /:id/pdf)
    const tmpl = await getTemplate('SALE_ORDER');
    const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 0, left: 40, right: 40 } });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Minimal SO PDF — reuse same layout as /:id/pdf route
      const W = doc.page.width;
      const M = 40;
      const CW = W - 2 * M;
      const green = '#4A7D28';

      // Letterhead
      const LOGO = path.join(__dirname, '../../assets/MSPIL_logo_transparent.png');
      doc.rect(M, 22, CW, 58).fill('#C5D49E');
      if (fs.existsSync(LOGO)) doc.image(LOGO, M + 8, 27, { width: 48, height: 48 });
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#1A3B0A')
        .text('Mahakaushal Sugar and Power Industries Ltd.', M + 62, 27, { width: CW - 70, align: 'center' });
      doc.font('Helvetica').fontSize(5.5).fillColor('#3A5A3A')
        .text('CIN - U01543MP2005PLC017514 | GSTIN - 23AAECM3666P1Z1', M + 62, 42, { width: CW - 70, align: 'center' })
        .text('Village Bachai, Dist. Narsinghpur (M.P.) - 487001', M + 62, 50, { width: CW - 70, align: 'center' })
        .text('E-mail: mspil.acc@gmail.com | mspil.power@gmail.com', M + 62, 58, { width: CW - 70, align: 'center' });
      doc.moveTo(M, 83).lineTo(M + CW, 83).lineWidth(1.5).strokeColor(green).stroke();

      // Title
      const soLabel = `SO-${String(order.orderNo).padStart(4, '0')}`;
      doc.font('Helvetica-Bold').fontSize(12).fillColor(green)
        .text('SALES ORDER', M, 90, { width: CW, align: 'center' });

      // Details
      let y = 108;
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#666');
      doc.text('SO Number', M, y); doc.text('Date', M + CW / 2, y);
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#000');
      doc.text(soLabel, M + 80, y); doc.text(new Date(order.orderDate).toLocaleDateString('en-IN'), M + CW / 2 + 80, y);
      y += 14;
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#666').text('Customer', M, y);
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#000').text(order.customer.name, M + 80, y);
      if (order.customer.gstNo) {
        y += 12;
        doc.font('Helvetica').fontSize(7).fillColor('#333').text(`GSTIN: ${order.customer.gstNo}`, M + 80, y);
      }
      y += 16;

      // Lines table
      const rowH = 14;
      doc.rect(M, y, CW, rowH).fill(green);
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#FFF');
      doc.text('#', M + 3, y + 4, { width: 20 });
      doc.text('Product', M + 25, y + 4, { width: 160 });
      doc.text('Qty', M + 190, y + 4, { width: 50, align: 'right' });
      doc.text('Rate', M + 245, y + 4, { width: 60, align: 'right' });
      doc.text('Amount', M + 310, y + 4, { width: CW - 315, align: 'right' });
      y += rowH;

      order.lines.forEach((line: any, i: number) => {
        if (i % 2 === 0) doc.rect(M, y, CW, rowH).fill('#F5F5F5');
        doc.font('Helvetica').fontSize(7).fillColor('#222');
        doc.text(String(i + 1), M + 3, y + 4, { width: 20 });
        doc.text(line.productName || line.description || '', M + 25, y + 4, { width: 160 });
        doc.text(`${line.quantity} ${line.unit || ''}`, M + 190, y + 4, { width: 50, align: 'right' });
        doc.text(`Rs.${(line.rate || 0).toLocaleString('en-IN')}`, M + 245, y + 4, { width: 60, align: 'right' });
        doc.text(`Rs.${(line.amount || line.quantity * line.rate).toLocaleString('en-IN')}`, M + 310, y + 4, { width: CW - 315, align: 'right' });
        y += rowH;
      });

      doc.moveTo(M, y).lineTo(M + CW, y).lineWidth(0.5).strokeColor('#999').stroke();
      y += 8;

      // Total
      doc.font('Helvetica-Bold').fontSize(9).fillColor(green)
        .text('TOTAL:', M + CW - 200, y, { width: 95, align: 'right' })
        .text(`Rs.${(order.grandTotal || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, M + CW - 100, y, { width: 100, align: 'right' });
      y += 20;

      // Terms
      if (tmpl.terms.length) {
        doc.font('Helvetica-Bold').fontSize(7).fillColor('#333').text('Terms & Conditions:', M, y);
        y += 10;
        tmpl.terms.forEach((t: string, i: number) => {
          doc.font('Helvetica').fontSize(6).fillColor('#666').text(`${i + 1}. ${t}`, M + 5, y, { width: CW - 10 });
          y += 8;
        });
      }

      doc.end();
    });

    const soLabel = `SO-${String(order.orderNo).padStart(4, '0')}`;
    const subject = req.body.subject || `${soLabel} — Sales Order from MSPIL`;
    const body = req.body.body || `Dear ${order.customer.name},\n\nPlease find attached Sales Order ${soLabel} dated ${new Date(order.orderDate).toLocaleDateString('en-IN')}.\n\nTotal Amount: Rs.${(order.grandTotal || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}\n\nKindly confirm the order at your earliest.\n\nRegards,\nMahakaushal Sugar & Power Industries Ltd.\nVillage Bachai, Dist. Narsinghpur (M.P.)`;

    const result = await sendEmail({
      to: toEmail, subject, text: body,
      attachments: [{ filename: `${soLabel}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }],
    });

    if (result.success) {
      res.json({ ok: true, messageId: result.messageId, sentTo: toEmail });
    } else {
      res.status(500).json({ error: result.error || 'Email send failed' });
    }
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
