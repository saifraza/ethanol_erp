import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

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

    if (order.status !== 'DRAFT') {
      res.status(400).json({ error: 'Can only delete orders with DRAFT status' });
      return;
    }

    // Delete lines first (or let cascade handle it)
    await prisma.salesOrderLine.deleteMany({
      where: { orderId: req.params.id },
    });

    // Delete order
    await prisma.salesOrder.delete({
      where: { id: req.params.id },
    });

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
