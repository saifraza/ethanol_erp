import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { sendEmail } from '../services/messaging';
import { drawLetterhead } from '../utils/letterhead';
import { getTemplate } from '../utils/templateHelper';

const router = Router();

router.use(authenticate as any);

// GET / — List sales orders with filters
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const status = req.query.status as string | undefined;
    const customerId = req.query.customerId as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 500);
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
}));

// GET /:id — Single order with all details
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
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
}));

// POST / — Create sales order with lines
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
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
        userId: req.user!.id,
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
}));

// PUT /:id/status — Update order status
router.put('/:id/status', asyncHandler(async (req: AuthRequest, res: Response) => {
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
}));

// PUT /:id — Update order details (only if DRAFT)
router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
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
}));

// DELETE /:id — Delete order (only if DRAFT). Delete with lines (cascade).
router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const order = await prisma.salesOrder.findUnique({
      where: { id: req.params.id },
    });

    if (!order) {
      res.status(404).json({ error: 'Sales order not found' });
      return;
    }

    if (order.status !== 'DRAFT') {
      res.status(400).json({ error: 'Only DRAFT orders can be deleted. Cancel the order instead.' });
      return;
    }

    // Delete related records and order in a single transaction
    await prisma.$transaction(async (tx) => {
      const drs = await tx.dispatchRequest.findMany({
        where: { orderId: req.params.id },
        select: { id: true },
      });
      const drIds = drs.map(d => d.id);
      if (drIds.length > 0) {
        await tx.shipment.deleteMany({ where: { dispatchRequestId: { in: drIds } } });
      }
      await tx.dispatchRequest.deleteMany({ where: { orderId: req.params.id } });
      await tx.invoice.deleteMany({ where: { orderId: req.params.id } });
      await tx.salesOrderLine.deleteMany({ where: { orderId: req.params.id } });
      await tx.salesOrder.delete({ where: { id: req.params.id } });
    });

    res.json({ ok: true });
}));

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
router.get('/:id/pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
    const order = await prisma.salesOrder.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        lines: true,
      },
    });

    if (!order) {
      res.status(404).json({ error: 'Sales order not found' });
      return;
    }

    // Load template for terms/footer
    const tmpl = await getTemplate('SALE_ORDER');

    // Create PDF — single page, compact layout
    // bottom: 0 prevents PDFKit auto-pagination so footer stays on page 1
    const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 0, left: 40, right: 40 } });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=SO-${order.orderNo}.pdf`);
    doc.pipe(res);

    const pageW = doc.page.width;   // 595.28
    const pageH = doc.page.height;  // 841.89
    const mL = 40;
    const mR = 40;
    const cW = pageW - mL - mR;
    const rightEdge = pageW - mR;
    const labelFont = 'Helvetica-Bold';
    const valueFont = 'Helvetica';
    const green = '#4a7c3f';

    // ── Letterhead ──
    const afterHeader = drawLetterhead(doc, mL, cW);
    let y = afterHeader + 6;

    // ── Title Bar ──
    doc.rect(mL, y, cW, 20).fill(green);
    doc.fontSize(12).font(labelFont).fillColor('#fff')
      .text(tmpl.title || 'SALE ORDER', mL, y + 4, { align: 'center', width: cW });
    y += 26;

    // ── Order Info — compact two-column grid ──
    const col2X = pageW / 2 + 10;
    const rowH = 13;
    function info(label: string, value: string, x: number, yPos: number) {
      doc.fontSize(8).font(labelFont).fillColor('#777').text(label, x, yPos);
      doc.font(valueFont).fillColor('#333').text(value || '-', x + 80, yPos);
    }

    info('SO Number:', `SO-${order.orderNo}`, mL, y);
    info('Order Date:', new Date(order.orderDate).toLocaleDateString('en-IN'), col2X, y);
    y += rowH;
    info('Status:', order.status, mL, y);
    info('Delivery Date:', order.deliveryDate ? new Date(order.deliveryDate).toLocaleDateString('en-IN') : 'TBD', col2X, y);
    y += rowH;
    info('PO Reference:', order.poNumber || '-', mL, y);
    info('Payment Terms:', order.paymentTerms || '-', col2X, y);
    y += rowH;
    info('Logistics By:', order.logisticsBy === 'SELLER' ? 'MSPIL (Seller)' : 'Buyer', mL, y);
    if (order.freightRate && order.freightRate > 0) {
      info('Freight Rate:', `Rs.${order.freightRate.toLocaleString('en-IN')}/MT`, col2X, y);
    }
    y += rowH + 4;

    // Thin separator
    doc.moveTo(mL, y).lineTo(rightEdge, y).lineWidth(0.3).strokeColor('#ddd').stroke();
    y += 6;

    // ── Bill To / Ship To — two columns ──
    const boxH = 62;
    const halfW = (cW - 10) / 2;

    // Bill To
    doc.rect(mL, y, halfW, boxH).lineWidth(0.5).strokeColor('#ccc').stroke();
    doc.rect(mL, y, halfW, 13).fill(green);
    doc.fontSize(7).font(labelFont).fillColor('#fff').text('BILL TO', mL + 6, y + 3);
    let bY = y + 16;
    doc.fontSize(9).font(labelFont).fillColor('#333').text(order.customer.name, mL + 6, bY);
    bY += 11;
    const custAddr = [order.customer.address, order.customer.city, order.customer.state, order.customer.pincode].filter(Boolean).join(', ');
    doc.font(valueFont).fontSize(7).fillColor('#555').text(custAddr || '', mL + 6, bY, { width: halfW - 12, height: 20 });
    bY += 20;
    if (order.customer.gstNo) doc.fontSize(7).font(valueFont).fillColor('#777').text(`GSTIN: ${order.customer.gstNo}`, mL + 6, bY);

    // Ship To
    const shipX = mL + halfW + 10;
    doc.rect(shipX, y, halfW, boxH).lineWidth(0.5).strokeColor('#ccc').stroke();
    doc.rect(shipX, y, halfW, 13).fill(green);
    doc.fontSize(7).font(labelFont).fillColor('#fff').text('SHIP TO / DELIVERY', shipX + 6, y + 3);
    let sY = y + 16;
    if (order.deliveryAddress) {
      doc.fontSize(8).font(valueFont).fillColor('#333').text(order.deliveryAddress, shipX + 6, sY, { width: halfW - 12, height: 30 });
      sY += 30;
    } else {
      doc.fontSize(8).font(valueFont).fillColor('#333').text(order.customer.name, shipX + 6, sY);
      sY += 11;
      doc.fontSize(7).fillColor('#555').text(custAddr || '', shipX + 6, sY, { width: halfW - 12, height: 20 });
    }
    // Contact info
    const contactLine = [order.customer.contactPerson, order.customer.phone].filter(Boolean).join(' | ');
    if (contactLine) doc.fontSize(6.5).fillColor('#777').text(contactLine, shipX + 6, y + boxH - 12, { width: halfW - 12 });

    y += boxH + 8;

    // ── Line Items Table ──
    const cols = [
      { l: '#',       w: 20,  a: 'center' as const },
      { l: 'Product', w: 115, a: 'left'   as const },
      { l: 'HSN',     w: 60,  a: 'center' as const },
      { l: 'Qty',     w: 45,  a: 'right'  as const },
      { l: 'Unit',    w: 35,  a: 'center' as const },
      { l: 'Rate (Rs.)', w: 60, a: 'right' as const },
      { l: 'GST%',    w: 30,  a: 'center' as const },
      { l: 'GST (Rs.)', w: 55, a: 'right' as const },
      { l: 'Total (Rs.)', w: 75, a: 'right' as const },
    ];

    // Table header
    doc.rect(mL, y, cW, 16).fill(green);
    let colX = mL + 3;
    cols.forEach(c => {
      doc.fontSize(7).font(labelFont).fillColor('#fff').text(c.l, colX, y + 4, { width: c.w, align: c.a });
      colX += c.w;
    });
    y += 18;

    // Table rows
    order.lines.forEach((line, idx) => {
      if (idx % 2 === 0) doc.rect(mL, y - 1, cW, 16).fill('#f8f9f8');
      colX = mL + 3;
      const rowData = [
        String(idx + 1),
        line.productName,
        getSOHsnCode(line.productName),
        line.quantity.toFixed(2),
        line.unit,
        line.rate.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
        `${line.gstPercent}%`,
        line.gstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
        line.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      ];
      rowData.forEach((val, i) => {
        doc.fontSize(7.5).font(valueFont).fillColor('#333').text(val, colX, y + 2, { width: cols[i].w, align: cols[i].a });
        colX += cols[i].w;
      });
      y += 16;
    });

    // Table bottom line
    doc.moveTo(mL, y).lineTo(rightEdge, y).lineWidth(0.5).strokeColor('#ccc').stroke();
    y += 6;

    // ── Totals — right aligned ──
    const labX = rightEdge - 190;
    const valX = rightEdge - 80;
    function totalRow(label: string, value: string, bold = false) {
      doc.fontSize(8).font(bold ? labelFont : valueFont).fillColor(bold ? '#333' : '#555')
        .text(label, labX, y, { width: 105, align: 'right' });
      doc.font(bold ? labelFont : valueFont).fillColor('#333')
        .text(value, valX, y, { width: 80, align: 'right' });
      y += 13;
    }

    totalRow('Subtotal:', `Rs.${order.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
    totalRow('GST:', `Rs.${order.totalGst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
    if (order.freightRate && order.freightRate > 0) {
      totalRow('Freight:', `Rs.${order.freightRate.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
    }
    doc.moveTo(labX, y - 3).lineTo(rightEdge, y - 3).lineWidth(1).strokeColor(green).stroke();
    y += 2;
    totalRow('Grand Total:', `Rs.${order.grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, true);

    // ── Remarks ──
    if (order.remarks) {
      y += 2;
      doc.fontSize(7.5).font(labelFont).fillColor('#555').text('Remarks:', mL, y);
      y += 10;
      doc.font(valueFont).fontSize(7).fillColor('#333').text(order.remarks, mL + 4, y, { width: cW - 8 });
      y = doc.y + 4;
    }

    // ── Terms & Conditions from template ──
    y += 4;
    doc.moveTo(mL, y).lineTo(rightEdge, y).lineWidth(0.3).strokeColor('#ddd').stroke();
    y += 6;
    if (tmpl.terms.length > 0) {
      doc.fontSize(7.5).font(labelFont).fillColor('#555').text('Terms & Conditions:', mL, y);
      y += 10;
      tmpl.terms.forEach((t, i) => {
        doc.fontSize(6.5).font(valueFont).fillColor('#666').text(`${i + 1}. ${t}`, mL + 4, y, { width: cW - 8 });
        y = doc.y + 2;
      });
    }

    // ── Footer line + text (draw FIRST at absolute position, before signatures) ──
    const footerY = pageH - 35;
    doc.moveTo(mL, footerY).lineTo(rightEdge, footerY).lineWidth(0.5).strokeColor(green).stroke();
    doc.fontSize(6).fillColor('#999').text(tmpl.footer || 'This is a system-generated document.', mL, footerY + 4, { width: cW, align: 'center', lineBreak: false });

    // ── Signatures — above footer, below content ──
    const sigY = Math.min(y + 16, footerY - 45);
    doc.fontSize(7).font(valueFont).fillColor('#555');
    doc.text('________________________', mL, sigY, { width: 140, align: 'center', lineBreak: false });
    doc.text('For MSPIL', mL, sigY + 10, { width: 140, align: 'center', lineBreak: false });
    doc.text('Authorized Signatory', mL, sigY + 18, { width: 140, align: 'center', lineBreak: false });
    doc.text('________________________', rightEdge - 140, sigY, { width: 140, align: 'center', lineBreak: false });
    doc.text('Customer Acceptance', rightEdge - 140, sigY + 10, { width: 140, align: 'center', lineBreak: false });

    doc.end();
}));

// POST /:id/send-email — Send Sales Order PDF to customer via email
router.post('/:id/send-email', asyncHandler(async (req: AuthRequest, res: Response) => {
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
}));

export default router;
