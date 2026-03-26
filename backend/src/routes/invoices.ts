import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { generateInvoicePdf } from '../utils/pdfGenerator';
import { sendEmail } from '../services/messaging';
import { generateIRN, cancelIRN, getIRNDetails } from '../services/eInvoice';
import { onSaleInvoiceCreated } from '../services/autoJournal';

const router = Router();

router.use(authenticate as any);

// GET / — List invoices with filters
router.get('/', async (req: Request, res: Response) => {
  try {
    const customerId = req.query.customerId as string;
    const status = req.query.status as string;
    const from = req.query.from as string;
    const to = req.query.to as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;

    let where: any = {};

    if (customerId) where.customerId = customerId;
    if (status) where.status = status;

    if (from || to) {
      where.invoiceDate = {};
      if (from) where.invoiceDate.gte = new Date(from + 'T00:00:00.000Z');
      if (to) where.invoiceDate.lte = new Date(to + 'T23:59:59.999Z');
    }

    const skip = (page - 1) * limit;

    const invoices = await prisma.invoice.findMany({
      where,
      include: {
        customer: {
          select: { id: true, name: true, shortName: true },
        },
        payments: true,
      },
      orderBy: { invoiceDate: 'desc' },
      skip,
      take: limit,
    });

    const total = await prisma.invoice.count({ where });

    res.json({ invoices, total, page, limit });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /outstanding — Outstanding invoices summary
router.get('/outstanding', async (req: Request, res: Response) => {
  try {
    // Cap limit to prevent unbounded queries
    const limit = Math.min(parseInt((req.query.limit as string) || '200'), 1000);
    const outstanding = await prisma.invoice.findMany({
      where: {
        status: { in: ['UNPAID', 'PARTIAL'] },
      },
      include: {
        customer: {
          select: { id: true, name: true },
        },
      },
      take: limit,
    });

    // Group by customerId
    const grouped: { [key: string]: any } = {};

    outstanding.forEach((inv: any) => {
      const custId = inv.customerId;
      if (!grouped[custId]) {
        grouped[custId] = {
          customerId: custId,
          customerName: inv.customer.name,
          totalOutstanding: 0,
          invoiceCount: 0,
        };
      }
      grouped[custId].totalOutstanding += inv.balanceAmount;
      grouped[custId].invoiceCount += 1;
    });

    res.json(Object.values(grouped));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /:id — Single invoice with customer, order, payments
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        order: true,
        payments: true,
      },
    });
    if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }
    res.json(invoice);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST / — Create invoice
router.post('/', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const quantity = parseFloat(b.quantity) || 0;
    const rate = parseFloat(b.rate) || 0;
    const gstPercent = parseFloat(b.gstPercent) || 0;
    const freightCharge = parseFloat(b.freightCharge) || 0;

    const amount = quantity * rate;
    const gstAmount = (amount * gstPercent) / 100;
    const totalAmount = amount + gstAmount + freightCharge;

    const invoice = await prisma.invoice.create({
      data: {
        customerId: b.customerId,
        orderId: b.orderId || null,
        shipmentId: b.shipmentId || null,
        invoiceDate: b.invoiceDate ? new Date(b.invoiceDate) : new Date(),
        dueDate: b.dueDate ? new Date(b.dueDate) : null,
        productName: b.productName || '',
        quantity,
        unit: b.unit || 'KL',
        rate,
        gstPercent,
        amount,
        gstAmount,
        freightCharge,
        totalAmount,
        paidAmount: 0,
        balanceAmount: totalAmount,
        status: 'UNPAID',
        challanNo: b.challanNo || null,
        ewayBill: b.ewayBill || null,
        remarks: b.remarks || null,
        userId: (req as any).user.id,
      },
      include: {
        customer: {
          select: { id: true, name: true, shortName: true },
        },
        payments: true,
      },
    });

    // Auto-journal: Dr Receivable, Cr Sales + GST
    onSaleInvoiceCreated(prisma, {
      id: invoice.id,
      invoiceNo: invoice.invoiceNo,
      totalAmount: invoice.totalAmount,
      amount: invoice.amount,
      gstAmount: invoice.gstAmount,
      gstPercent: invoice.gstPercent,
      productName: invoice.productName,
      customerId: b.customerId,
      userId: (req as any).user.id,
      invoiceDate: invoice.invoiceDate,
    }).catch(() => {});

    res.status(201).json(invoice);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /from-shipment/:shipmentId — Auto-create invoice from a completed shipment
router.post('/from-shipment/:shipmentId', async (req: Request, res: Response) => {
  try {
    const shipmentId = req.params.shipmentId;

    // Read the shipment
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: {
        dispatchRequest: {
          include: {
            order: {
              include: {
                lines: true,
              },
            },
          },
        },
      },
    });

    if (!shipment) { res.status(404).json({ error: 'Shipment not found' }); return; }
    if (!shipment.dispatchRequest) { res.status(400).json({ error: 'Shipment has no dispatch request' }); return; }

    const order = shipment.dispatchRequest.order;
    const orderLine = order?.lines?.[0];

    if (!order || !orderLine) { res.status(400).json({ error: 'Order or order line not found' }); return; }

    // Calculate quantity from shipment (weightNet / 1000 for TON, or quantityKL for KL)
    let quantity = 0;
    if (shipment.quantityKL) {
      quantity = shipment.quantityKL;
    } else if (shipment.weightNet) {
      quantity = shipment.weightNet / 1000; // Convert to TON
    }

    const rate = orderLine.rate || 0;
    const gstPercent = orderLine.gstPercent || 0;
    const freightCharge = 0;

    const amount = quantity * rate;
    const gstAmount = (amount * gstPercent) / 100;
    const totalAmount = amount + gstAmount + freightCharge;

    const invoice = await prisma.invoice.create({
      data: {
        customerId: order.customerId,
        orderId: order.id,
        shipmentId: shipment.id,
        invoiceDate: new Date(),
        dueDate: null,
        productName: shipment.productName || orderLine.productName || '',
        quantity,
        unit: orderLine.unit || 'KL',
        rate,
        gstPercent,
        amount,
        gstAmount,
        freightCharge,
        totalAmount,
        paidAmount: 0,
        balanceAmount: totalAmount,
        status: 'UNPAID',
        challanNo: shipment.challanNo || null,
        ewayBill: shipment.ewayBill || null,
        remarks: null,
        userId: (req as any).user.id,
      },
      include: {
        customer: {
          select: { id: true, name: true, shortName: true },
        },
        payments: true,
      },
    });

    // Update shipment.invoiceRef
    await prisma.shipment.update({
      where: { id: shipmentId },
      data: { invoiceRef: String(invoice.invoiceNo) },
    });

    // Auto-journal: Dr Receivable, Cr Sales + GST
    onSaleInvoiceCreated(prisma, {
      id: invoice.id,
      invoiceNo: invoice.invoiceNo,
      totalAmount: invoice.totalAmount,
      amount: invoice.amount,
      gstAmount: invoice.gstAmount,
      gstPercent: invoice.gstPercent,
      productName: invoice.productName,
      customerId: order.customerId,
      userId: (req as any).user.id,
      invoiceDate: invoice.invoiceDate,
    }).catch(() => {});

    res.status(201).json(invoice);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /:id — Update invoice (only if UNPAID)
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const b = req.body;

    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
    });

    if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }
    if (invoice.status !== 'UNPAID') { res.status(400).json({ error: 'Can only update UNPAID invoices' }); return; }

    const updateData: any = {};

    // Parse numeric fields
    if (b.quantity !== undefined) updateData.quantity = parseFloat(b.quantity);
    if (b.rate !== undefined) updateData.rate = parseFloat(b.rate);
    if (b.gstPercent !== undefined) updateData.gstPercent = parseFloat(b.gstPercent);
    if (b.freightCharge !== undefined) updateData.freightCharge = parseFloat(b.freightCharge);

    // Recalculate amounts if needed
    if (b.quantity !== undefined || b.rate !== undefined || b.gstPercent !== undefined || b.freightCharge !== undefined) {
      const quantity = parseFloat(b.quantity) || invoice.quantity;
      const rate = parseFloat(b.rate) || invoice.rate;
      const gstPercent = parseFloat(b.gstPercent) || invoice.gstPercent;
      const freightCharge = parseFloat(b.freightCharge) || invoice.freightCharge;

      const amount = quantity * rate;
      const gstAmount = (amount * gstPercent) / 100;
      const totalAmount = amount + gstAmount + freightCharge;

      updateData.amount = amount;
      updateData.gstAmount = gstAmount;
      updateData.totalAmount = totalAmount;
      updateData.balanceAmount = totalAmount - invoice.paidAmount;
    }

    // Copy string fields
    ['productName', 'unit', 'remarks', 'challanNo', 'ewayBill'].forEach(field => {
      if (b[field] !== undefined) updateData[field] = b[field];
    });

    if (b.invoiceDate !== undefined) updateData.invoiceDate = new Date(b.invoiceDate);
    if (b.dueDate !== undefined) updateData.dueDate = b.dueDate ? new Date(b.dueDate) : null;

    const updated = await prisma.invoice.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        customer: {
          select: { id: true, name: true, shortName: true },
        },
        payments: true,
      },
    });
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /:id/pdf — Generate Invoice PDF with letterhead
router.get('/:id/pdf', async (req: Request, res: Response) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: { customer: true },
    });

    if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }

    const pdfBuffer = await generateInvoicePdf({
      invoiceNo: invoice.invoiceNo,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      customer: {
        name: invoice.customer.name,
        shortName: invoice.customer.shortName,
        gstin: invoice.customer.gstNo,
        address: invoice.customer.address,
        city: invoice.customer.city,
        state: invoice.customer.state,
        pincode: invoice.customer.pincode,
      },
      productName: invoice.productName,
      quantity: invoice.quantity,
      unit: invoice.unit,
      rate: invoice.rate,
      amount: invoice.amount,
      gstPercent: invoice.gstPercent,
      gstAmount: invoice.gstAmount,
      freightCharge: invoice.freightCharge,
      totalAmount: invoice.totalAmount,
      challanNo: invoice.challanNo,
      ewayBill: invoice.ewayBill,
      remarks: invoice.remarks,
      orderId: invoice.orderId,
      shipmentId: invoice.shipmentId,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="INV-${invoice.invoiceNo}.pdf"`);
    res.send(pdfBuffer);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /:id/e-invoice — Generate IRN for invoice
router.post('/:id/e-invoice', async (req: Request, res: Response) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: { customer: true },
    });

    if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }

    // Check if IRN already exists
    if ((invoice as any).irn) {
      return res.status(400).json({ error: `IRN already generated: ${(invoice as any).irn}` });
    }

    // Validate customer data
    const customer = invoice.customer;
    const missingFields: string[] = [];
    if (!customer.gstNo) missingFields.push('GSTIN');
    if (!customer.state) missingFields.push('State');
    if (!customer.pincode) missingFields.push('Pincode');
    if (!customer.address) missingFields.push('Address');

    if (missingFields.length > 0) {
      return res.status(400).json({
        error: `Customer "${customer.name}" is missing: ${missingFields.join(', ')}. Update the customer record first.`,
        missingFields,
      });
    }

    if (!invoice.rate || invoice.rate <= 0) {
      return res.status(400).json({ error: 'Invoice rate is zero. Update the invoice first.' });
    }

    console.log(`[Invoice] Generating e-invoice for INV-${invoice.invoiceNo}`);

    // Build proper payload from Invoice record
    const invoiceData = {
      invoiceNo: `INV-${invoice.invoiceNo}`,
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

    const result = await generateIRN(invoiceData);

    if (!result.success) {
      return res.status(400).json({ error: result.error, rawResponse: result.rawResponse });
    }

    // Store IRN in proper dedicated fields on Invoice
    const updated = await prisma.invoice.update({
      where: { id: req.params.id },
      data: {
        irn: result.irn,
        irnDate: new Date(),
        irnStatus: 'GENERATED',
        ackNo: result.ackNo || null,
        signedQRCode: result.signedQRCode ? result.signedQRCode.slice(0, 4000) : null,
      } as any,
      include: { customer: true },
    });

    // If invoice is linked to a shipment, copy IRN there too
    if (invoice.shipmentId) {
      await prisma.shipment.update({
        where: { id: invoice.shipmentId },
        data: {
          irn: result.irn,
          irnDate: new Date(),
          irnStatus: 'GENERATED',
          ackNo: result.ackNo || null,
          signedQRCode: result.signedQRCode ? result.signedQRCode.slice(0, 4000) : null,
        } as any,
      }).catch(() => {}); // Non-critical
    }

    res.json({
      success: true,
      irn: result.irn,
      ackNo: result.ackNo,
      ackDt: result.ackDt,
      signedQRCode: result.signedQRCode,
      message: 'e-Invoice generated successfully',
      invoice: updated,
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /:id/e-invoice/cancel — Cancel IRN
router.post('/:id/e-invoice/cancel', async (req: Request, res: Response) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
    });

    if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }

    const irn = (invoice as any).irn;
    if (!irn) {
      return res.status(400).json({ error: 'Invoice does not have an IRN' });
    }

    const cancelReason = req.body.cancelReason || 'Cancelled as per request';

    console.log(`[Invoice] Cancelling IRN ${irn}`);

    const result = await cancelIRN(irn, cancelReason);

    if (!result.success) {
      return res.status(400).json({ error: result.error, rawResponse: result.rawResponse });
    }

    // Update invoice IRN status
    const updated = await prisma.invoice.update({
      where: { id: req.params.id },
      data: {
        irnStatus: 'CANCELLED',
        status: 'CANCELLED',
      } as any,
      include: { customer: true },
    });

    // If linked to shipment, clear IRN there too
    if (invoice.shipmentId) {
      await prisma.shipment.update({
        where: { id: invoice.shipmentId },
        data: { irnStatus: 'CANCELLED' } as any,
      }).catch(() => {});
    }

    res.json({
      success: true,
      irn,
      cancelDate: result.cancelDate,
      message: 'IRN cancelled successfully',
      invoice: updated,
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /:id/e-invoice/details — Get IRN details
router.get('/:id/e-invoice/details', async (req: Request, res: Response) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
    });

    if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }

    const irn = (invoice as any).irn;
    if (!irn) {
      return res.status(400).json({ error: 'Invoice does not have an IRN' });
    }

    console.log(`[Invoice] Fetching IRN details for ${irn}`);

    const result = await getIRNDetails(irn);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      success: true,
      irn,
      details: result.data,
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /:id/send-email — Send Invoice PDF to customer via email
router.post('/:id/send-email', async (req: Request, res: Response) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: { customer: true },
    });
    if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }

    const toEmail = req.body.to || invoice.customer.email;
    if (!toEmail) { res.status(400).json({ error: 'No email address. Add customer email or provide "to" in request.' }); return; }

    const invLabel = `INV-${String(invoice.invoiceNo).padStart(4, '0')}`;
    const pdfBuffer = await generateInvoicePdf({
      invoiceNo: invoice.invoiceNo, invoiceDate: invoice.invoiceDate, dueDate: invoice.dueDate,
      customer: { name: invoice.customer.name, shortName: invoice.customer.shortName,
        gstin: invoice.customer.gstNo, address: invoice.customer.address,
        city: invoice.customer.city, state: invoice.customer.state, pincode: invoice.customer.pincode },
      productName: invoice.productName, quantity: invoice.quantity, unit: invoice.unit,
      rate: invoice.rate, amount: invoice.amount, gstPercent: invoice.gstPercent,
      gstAmount: invoice.gstAmount, freightCharge: invoice.freightCharge,
      totalAmount: invoice.totalAmount, challanNo: invoice.challanNo, ewayBill: invoice.ewayBill,
      remarks: invoice.remarks, orderId: invoice.orderId, shipmentId: invoice.shipmentId,
    });

    const subject = req.body.subject || `${invLabel} — Tax Invoice from MSPIL`;
    const body = req.body.body || `Dear ${invoice.customer.name},\n\nPlease find attached Tax Invoice ${invLabel} dated ${new Date(invoice.invoiceDate).toLocaleDateString('en-IN')}.\n\nProduct: ${invoice.productName}\nQuantity: ${invoice.quantity} ${invoice.unit}\nTotal Amount: Rs.${invoice.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}\n${invoice.dueDate ? `Due Date: ${new Date(invoice.dueDate).toLocaleDateString('en-IN')}` : ''}\n\nKindly process the payment as per agreed terms.\n\nRegards,\nMahakaushal Sugar & Power Industries Ltd.\nVillage Bachai, Dist. Narsinghpur (M.P.)`;

    const result = await sendEmail({
      to: toEmail, subject, text: body,
      attachments: [{ filename: `${invLabel}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }],
    });

    if (result.success) {
      res.json({ ok: true, messageId: result.messageId, sentTo: toEmail });
    } else {
      res.status(500).json({ error: result.error || 'Email send failed' });
    }
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
