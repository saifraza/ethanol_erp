import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { generateInvoicePdf } from '../utils/pdfGenerator';

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
    const outstanding = await prisma.invoice.findMany({
      where: {
        status: { in: ['UNPAID', 'PARTIAL'] },
      },
      include: {
        customer: {
          select: { id: true, name: true },
        },
      },
    });

    // Group by customerId
    const grouped: { [key: string]: any } = {};

    outstanding.forEach((inv) => {
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
      customer: invoice.customer,
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

export default router;
