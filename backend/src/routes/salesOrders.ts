import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { drawLetterhead } from '../utils/letterhead';
import { getTemplate } from '../utils/templateHelper';

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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
