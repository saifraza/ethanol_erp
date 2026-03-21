import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { drawLetterhead } from '../utils/letterhead';

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

    // Create PDF
    const doc = new PDFDocument({ size: 'A4', margin: 40 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=SO-${order.orderNo}.pdf`);
    doc.pipe(res);

    const pageW = doc.page.width;
    const marginL = 40;
    const marginR = 40;
    const contentW = pageW - marginL - marginR;

    // ── Letterhead (HD vector) ──
    const afterHeader = drawLetterhead(doc, marginL, contentW);
    doc.y = afterHeader + 2;
    doc.y = afterHeader + 10;

    // ── Title ──
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#333')
      .text('SALES ORDER', marginL, doc.y, { align: 'center', width: contentW });
    doc.moveDown(0.5);

    // ── Order Info (two columns) ──
    const infoY = doc.y;
    const col1X = marginL;
    const col2X = pageW / 2 + 20;
    const labelFont = 'Helvetica-Bold';
    const valueFont = 'Helvetica';
    const infoSize = 9;

    function infoRow(label: string, value: string, x: number, y: number) {
      doc.fontSize(infoSize).font(labelFont).fillColor('#555').text(label, x, y);
      doc.font(valueFont).fillColor('#333').text(value, x + 95, y);
    }

    infoRow('SO Number:', `SO-${order.orderNo}`, col1X, infoY);
    infoRow('Order Date:', new Date(order.orderDate).toLocaleDateString('en-IN'), col2X, infoY);
    infoRow('Status:', order.status, col1X, infoY + 16);
    infoRow('Delivery Date:', order.deliveryDate ? new Date(order.deliveryDate).toLocaleDateString('en-IN') : 'TBD', col2X, infoY + 16);
    infoRow('PO Number:', order.poNumber || '-', col1X, infoY + 32);
    infoRow('Payment Terms:', order.paymentTerms || '-', col2X, infoY + 32);
    infoRow('Logistics By:', order.logisticsBy || '-', col1X, infoY + 48);

    doc.y = infoY + 70;

    // ── Customer Box ──
    const custY = doc.y;
    doc.rect(col1X, custY, contentW, 70).lineWidth(0.5).strokeColor('#ccc').stroke();
    doc.fontSize(10).font(labelFont).fillColor('#4a7c3f').text('BILL TO / SHIP TO', col1X + 10, custY + 6);
    doc.fontSize(9).font(labelFont).fillColor('#333').text(order.customer.name, col1X + 10, custY + 20);
    const custAddr = [order.customer.address, order.customer.city, order.customer.state, order.customer.pincode].filter(Boolean).join(', ');
    doc.font(valueFont).fontSize(8).fillColor('#555').text(custAddr || '', col1X + 10, custY + 33, { width: contentW / 2 - 20 });
    // Right side: GST, contact, phone
    if (order.customer.gstNo) doc.font(valueFont).fontSize(8).text(`GSTIN: ${order.customer.gstNo}`, col2X, custY + 20);
    if (order.customer.contactPerson) doc.text(`Contact: ${order.customer.contactPerson}`, col2X, custY + 33);
    if (order.customer.phone) doc.text(`Phone: ${order.customer.phone}`, col2X, custY + 46);
    if (order.customer.email) doc.text(`Email: ${order.customer.email}`, col2X, custY + 59);

    doc.y = custY + 80;

    // ── Line Items Table ──
    const tableTop = doc.y;
    const colWidths = [25, 155, 50, 45, 70, 35, 55, 80];
    const colHeaders = ['#', 'Product', 'Qty', 'Unit', 'Rate (₹)', 'GST%', 'GST (₹)', 'Total (₹)'];
    const colAligns: ('left' | 'right' | 'center')[] = ['center', 'left', 'right', 'center', 'right', 'center', 'right', 'right'];

    // Table header
    doc.rect(marginL, tableTop, contentW, 20).fill('#4a7c3f');
    let colX = marginL + 4;
    colHeaders.forEach((header, i) => {
      doc.fontSize(8).font(labelFont).fillColor('#fff')
        .text(header, colX, tableTop + 5, { width: colWidths[i], align: colAligns[i] });
      colX += colWidths[i];
    });

    // Table rows
    let rowY = tableTop + 22;
    order.lines.forEach((line, idx) => {
      const isEven = idx % 2 === 0;
      if (isEven) {
        doc.rect(marginL, rowY - 2, contentW, 18).fill('#f8f8f8');
      }

      colX = marginL + 4;
      const rowData = [
        String(idx + 1),
        line.productName,
        line.quantity.toFixed(2),
        line.unit,
        `₹${line.rate.toLocaleString('en-IN')}`,
        `${line.gstPercent}%`,
        `₹${line.gstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
        `₹${line.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
      ];

      rowData.forEach((val, i) => {
        doc.fontSize(8).font(valueFont).fillColor('#333')
          .text(val, colX, rowY, { width: colWidths[i], align: colAligns[i] });
        colX += colWidths[i];
      });
      rowY += 18;
    });

    // Table bottom line
    doc.moveTo(marginL, rowY).lineTo(pageW - marginR, rowY).lineWidth(0.5).strokeColor('#ccc').stroke();
    rowY += 8;

    // ── Totals ──
    const totalsX = pageW - marginR - 200;
    function totalRow(label: string, value: string, bold = false) {
      doc.fontSize(9).font(bold ? labelFont : valueFont).fillColor('#333')
        .text(label, totalsX, rowY, { width: 110, align: 'right' });
      doc.font(bold ? labelFont : valueFont)
        .text(value, totalsX + 115, rowY, { width: 85, align: 'right' });
      rowY += 16;
    }

    totalRow('Subtotal:', `₹${order.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
    totalRow('GST:', `₹${order.totalGst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
    if (order.freightRate && order.freightRate > 0) {
      totalRow('Freight:', `₹${order.freightRate.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
    }
    // Bold divider before grand total
    doc.moveTo(totalsX, rowY - 4).lineTo(pageW - marginR, rowY - 4).lineWidth(1).strokeColor('#4a7c3f').stroke();
    totalRow('Grand Total:', `₹${order.grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, true);

    // ── Remarks ──
    if (order.remarks) {
      rowY += 10;
      doc.fontSize(9).font(labelFont).fillColor('#555').text('Remarks:', marginL, rowY);
      rowY += 14;
      doc.font(valueFont).fillColor('#333').text(order.remarks, marginL, rowY, { width: contentW });
    }

    // ── Footer ──
    const footerY = doc.page.height - 80;
    doc.moveTo(marginL, footerY).lineTo(pageW - marginR, footerY).lineWidth(0.5).strokeColor('#ccc').stroke();

    doc.fontSize(8).font(valueFont).fillColor('#888')
      .text('This is a system-generated document.', marginL, footerY + 8, { width: contentW, align: 'center' })
      .text('Mahakaushal Sugar and Power Industries Ltd. | Village Bachai, Dist. Narsinghpur (M.P.) - 487001', marginL, footerY + 20, { width: contentW, align: 'center' });

    // Signature lines
    const sigY = footerY - 40;
    doc.fontSize(8).font(valueFont).fillColor('#555');
    doc.text('________________________', marginL, sigY, { width: 150, align: 'center' });
    doc.text('Authorized Signatory', marginL, sigY + 12, { width: 150, align: 'center' });
    doc.text('________________________', pageW - marginR - 150, sigY, { width: 150, align: 'center' });
    doc.text('Customer Acceptance', pageW - marginR - 150, sigY + 12, { width: 150, align: 'center' });

    doc.end();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
