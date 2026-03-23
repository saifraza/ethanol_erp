import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate as any);

// GET / — List dispatch requests with filters
router.get('/', async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const orderId = req.query.orderId as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    let where: any = {};
    if (status) where.status = status;
    if (orderId) where.orderId = orderId;

    const [drs, total] = await Promise.all([
      prisma.dispatchRequest.findMany({
        where,
        include: {
          order: {
            select: {
              id: true,
              orderNo: true,
              customer: { select: { name: true } },
            },
          },
          orderLine: true,
          freightInquiry: true,
          _count: { select: { shipments: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.dispatchRequest.count({ where }),
    ]);

    res.json({
      dispatchRequests: drs,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /factory — Factory view: only DRs with status != COMPLETED/CANCELLED
router.get('/factory', async (req: Request, res: Response) => {
  try {
    const drs = await prisma.dispatchRequest.findMany({
      where: {
        status: {
          notIn: ['COMPLETED', 'CANCELLED'],
        },
      },
      include: {
        order: {
          select: {
            id: true,
            orderNo: true,
            logisticsBy: true,
            paymentTerms: true,
            deliveryDate: true,
            freightRate: true,
            grandTotal: true,
            customer: { select: { id: true, name: true, address: true, city: true, state: true, pincode: true, phone: true, contactPerson: true } },
            lines: true,
          },
        },
        shipments: {
          include: {
            documents: { select: { id: true, docType: true, fileName: true, mimeType: true }, orderBy: { createdAt: 'desc' as const } },
          },
        },
        freightInquiry: {
          include: {
            quotations: { orderBy: { createdAt: 'desc' as const } },
          },
        },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });

    res.json(drs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:id — Single DR with full details
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const dr = await prisma.dispatchRequest.findUnique({
      where: { id: req.params.id },
      include: {
        order: {
          include: {
            customer: true,
            lines: true,
          },
        },
        orderLine: true,
        shipments: {
          include: {
            documents: { select: { id: true, docType: true, fileName: true, mimeType: true }, orderBy: { createdAt: 'desc' as const } },
          },
        },
      },
    });

    if (!dr) {
      res.status(404).json({ error: 'Dispatch request not found' });
      return;
    }

    res.json(dr);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST / — Create dispatch request
router.post('/', async (req: Request, res: Response) => {
  try {
    const b = req.body;

    // Validate required fields
    if (!b.orderId) {
      res.status(400).json({ error: 'orderId is required' });
      return;
    }

    // Verify order exists and has valid status
    const order = await prisma.salesOrder.findUnique({
      where: { id: b.orderId },
      include: { lines: true, customer: true },
    });

    if (!order) {
      res.status(400).json({ error: 'Sales order not found' });
      return;
    }

    if (!['CONFIRMED', 'IN_PROGRESS'].includes(order.status)) {
      res.status(400).json({
        error: 'Order must be CONFIRMED or IN_PROGRESS to create dispatch request',
      });
      return;
    }

    // If orderLineId provided, validate pendingQty
    let orderLine = null;
    if (b.orderLineId) {
      orderLine = await prisma.salesOrderLine.findUnique({
        where: { id: b.orderLineId },
      });

      if (!orderLine) {
        res.status(400).json({ error: 'Order line not found' });
        return;
      }

      const quantity = parseFloat(b.quantity) || 0;
      if (orderLine.pendingQty < quantity) {
        res.status(400).json({
          error: `Insufficient pending quantity. Available: ${orderLine.pendingQty}, Requested: ${quantity}`,
        });
        return;
      }
    }

    // Auto-populate from order if not provided
    const autoCustomerName = b.customerName || order.customer?.name || '';
    const autoDestination = b.destination || order.customer?.address || '';
    // Find matching order line for product
    let autoLineId = b.orderLineId || null;
    let autoUnit = b.unit || '';
    if (!autoLineId && b.productName && order.lines.length > 0) {
      const matchLine = order.lines.find(l => l.productName === b.productName);
      if (matchLine) {
        autoLineId = matchLine.id;
        autoUnit = matchLine.unit || autoUnit;
      }
    }

    // Create dispatch request
    const dr = await prisma.dispatchRequest.create({
      data: {
        order: { connect: { id: b.orderId } },
        ...(autoLineId ? { orderLine: { connect: { id: autoLineId } } } : {}),
        productName: b.productName || '',
        quantity: parseFloat(b.requestedQty || b.quantity) || 0,
        unit: autoUnit,
        customerName: autoCustomerName,
        destination: autoDestination,
        deliveryDate: b.deliveryDate ? new Date(b.deliveryDate) : null,
        logisticsBy: b.logisticsBy || 'BUYER',
        transporterName: b.transporterName || null,
        vehicleCount: parseInt(b.vehicleCount) || 0,
        remarks: b.remarks || null,
        status: 'SCHEDULED',
        userId: (req as any).user.id,
      },
      include: {
        order: {
          select: {
            id: true,
            orderNo: true,
            customer: { select: { name: true } },
          },
        },
        orderLine: true,
      },
    });

    // Update order status to IN_PROGRESS if it was CONFIRMED
    if (order.status === 'CONFIRMED') {
      await prisma.salesOrder.update({
        where: { id: b.orderId },
        data: { status: 'IN_PROGRESS' },
      });
    }

    // Auto-create FreightInquiry for the dispatch request
    await prisma.freightInquiry.create({
      data: {
        dispatchRequestId: dr.id,
        orderId: dr.orderId,
        origin: 'MSPIL, Village Bachai, Narsinghpur, MP - 487001',
        destination: dr.destination || '',
        productName: dr.productName,
        quantity: dr.quantity,
        unit: dr.unit,
        vehicleCount: dr.vehicleCount || 1,
        loadingDate: dr.deliveryDate || null,
        status: 'OPEN',
        userId: (req as any).user.id,
      },
    });

    res.status(201).json(dr);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:id/status — Update DR status (factory actions)
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const { status, acceptedBy } = req.body;

    if (!status) {
      res.status(400).json({ error: 'status is required' });
      return;
    }

    const dr = await prisma.dispatchRequest.findUnique({
      where: { id: req.params.id },
      include: {
        order: { include: { lines: true } },
        orderLine: true,
      },
    });

    if (!dr) {
      res.status(404).json({ error: 'Dispatch request not found' });
      return;
    }

    // Validate transitions — simplified flow (no factory confirmation needed)
    const allowedTransitions: { [key: string]: string[] } = {
      PENDING: ['SCHEDULED', 'CANCELLED'],     // legacy support
      SCHEDULED: ['LOADING', 'CANCELLED'],      // logistics scheduled → truck loading at factory
      ACCEPTED: ['LOADING', 'CANCELLED'],       // legacy support
      VEHICLE_ASSIGNED: ['LOADING', 'CANCELLED'], // legacy
      LOADING: ['DISPATCHED', 'CANCELLED'],     // loaded → dispatched
      DISPATCHED: ['COMPLETED', 'CANCELLED'],   // dispatched → delivered
      COMPLETED: [],
      CANCELLED: [],
    };

    const allowed = allowedTransitions[dr.status] || [];
    if (!allowed.includes(status)) {
      res.status(400).json({
        error: `Cannot transition from ${dr.status} to ${status}`,
      });
      return;
    }

    const updateData: any = { status };

    const updated = await prisma.dispatchRequest.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        order: {
          select: {
            id: true,
            orderNo: true,
            customer: { select: { name: true } },
          },
        },
        orderLine: true,
      },
    });

    // Handle DISPATCHED -> COMPLETED transition
    if (dr.status === 'DISPATCHED' && status === 'COMPLETED') {
      // Update orderLine.dispatchedQty and pendingQty if orderLineId exists
      if (dr.orderLineId) {
        const dispatchedQty =
          (dr.orderLine?.dispatchedQty || 0) + dr.quantity;
        const pendingQty = dr.orderLine!.quantity - dispatchedQty;

        await prisma.salesOrderLine.update({
          where: { id: dr.orderLineId },
          data: {
            dispatchedQty,
            pendingQty,
          },
        });

        // Check if all lines are fully dispatched, update order status to COMPLETED
        const order = dr.order;
        if (order) {
          const allLines = await prisma.salesOrderLine.findMany({
            where: { orderId: order.id },
          });

          const allDispatched = allLines.every((line) => line.pendingQty === 0);
          if (allDispatched) {
            await prisma.salesOrder.update({
              where: { id: order.id },
              data: { status: 'COMPLETED' },
            });
          }
        }
      }
    }

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:id — Update DR details (logistics info)
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const dr = await prisma.dispatchRequest.findUnique({
      where: { id: req.params.id },
    });

    if (!dr) {
      res.status(404).json({ error: 'Dispatch request not found' });
      return;
    }

    const updateData: any = {};

    if (req.body.destination !== undefined)
      updateData.destination = req.body.destination;
    if (req.body.deliveryDate !== undefined)
      updateData.deliveryDate = req.body.deliveryDate
        ? new Date(req.body.deliveryDate)
        : null;
    if (req.body.logisticsBy !== undefined)
      updateData.logisticsBy = req.body.logisticsBy;
    if (req.body.transporterName !== undefined)
      updateData.transporterName = req.body.transporterName;
    if (req.body.transporterId !== undefined)
      updateData.transporterId = req.body.transporterId;
    if (req.body.vehicleCount !== undefined)
      updateData.vehicleCount = parseInt(req.body.vehicleCount);
    if (req.body.freightRate !== undefined)
      updateData.freightRate = parseFloat(req.body.freightRate) || null;
    if (req.body.distanceKm !== undefined)
      updateData.distanceKm = parseFloat(req.body.distanceKm) || null;
    if (req.body.remarks !== undefined) updateData.remarks = req.body.remarks;

    const updated = await prisma.dispatchRequest.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        order: {
          select: {
            id: true,
            orderNo: true,
            customer: { select: { name: true } },
          },
        },
        orderLine: true,
      },
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /by-dr/:drId — Get freight inquiry for a dispatch request with quotations
router.get('/by-dr/:drId', async (req: Request, res: Response) => {
  try {
    const freightInquiry = await prisma.freightInquiry.findFirst({
      where: { dispatchRequestId: req.params.drId },
      include: {
        dispatchRequest: true,
        quotations: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!freightInquiry) {
      res.status(404).json({ error: 'Freight inquiry not found for this dispatch request' });
      return;
    }

    res.json(freightInquiry);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:id — Delete dispatch request (only if no shipments started)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const dr = await prisma.dispatchRequest.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { shipments: true } } },
    });

    if (!dr) {
      res.status(404).json({ error: 'Dispatch request not found' });
      return;
    }

    if (['DISPATCHED', 'COMPLETED'].includes(dr.status)) {
      res.status(400).json({ error: 'Cannot delete dispatched/completed requests' });
      return;
    }

    // Delete any GATE_IN shipments first
    await prisma.shipment.deleteMany({
      where: { dispatchRequestId: dr.id, status: 'GATE_IN' },
    });

    await prisma.dispatchRequest.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
