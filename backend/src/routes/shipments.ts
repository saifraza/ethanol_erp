import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate as any);

// GET / — List shipments for a date
router.get('/', async (req: Request, res: Response) => {
  try {
    const dateStr = req.query.date as string;
    const status = req.query.status as string;
    let where: any = {};

    if (dateStr) {
      const dayStart = new Date(dateStr + 'T00:00:00.000Z');
      const dayEnd = new Date(dateStr + 'T23:59:59.999Z');
      where.createdAt = { gte: dayStart, lte: dayEnd };
    }

    if (status) {
      where.status = status;
    }

    const shipments = await prisma.shipment.findMany({
      where,
      include: {
        dispatchRequest: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ shipments });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /active — All shipments NOT yet EXITED
router.get('/active', async (req: Request, res: Response) => {
  try {
    const shipments = await prisma.shipment.findMany({
      where: {
        status: { notIn: ['EXITED', 'CANCELLED'] },
      },
      include: {
        dispatchRequest: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ shipments });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /:id — Single shipment with dispatchRequest details
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const shipment = await prisma.shipment.findUnique({
      where: { id: req.params.id },
      include: {
        dispatchRequest: true,
      },
    });
    if (!shipment) { res.status(404).json({ error: 'Shipment not found' }); return; }
    res.json(shipment);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST / — Create shipment (Gate Entry)
router.post('/', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const capacityTon = parseFloat(b.capacityTon) || 0;

    const shipment = await prisma.shipment.create({
      data: {
        dispatchRequest: { connect: { id: b.dispatchRequestId } },
        productName: b.productName || '',
        customerName: b.customerName || '',
        destination: b.destination || '',
        vehicleNo: b.vehicleNo || '',
        vehicleType: b.vehicleType || '',
        capacityTon,
        driverName: b.driverName || '',
        driverMobile: b.driverMobile || '',
        transporterName: b.transporterName || '',
        date: b.date ? new Date(b.date) : new Date(),
        gateInTime: b.gateInTime || null,
        status: 'GATE_IN',
        remarks: b.remarks || null,
        userId: (req as any).user.id,
      },
      include: {
        dispatchRequest: true,
      },
    });
    res.status(201).json(shipment);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /:id/weighbridge — Record weighbridge data
router.put('/:id/weighbridge', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const weightTare = parseFloat(b.weightTare) || 0;
    const weightGross = parseFloat(b.weightGross) || 0;
    let updateData: any = {};

    if (weightTare && !weightGross) {
      // Only tare recorded
      updateData.weightTare = weightTare;
      updateData.tareTime = b.tareTime || null;
      updateData.status = 'TARE_WEIGHED';
    } else if (weightTare && weightGross) {
      // Both tare and gross recorded
      updateData.weightTare = weightTare;
      updateData.weightGross = weightGross;
      updateData.weightNet = weightGross - weightTare;
      updateData.tareTime = b.tareTime || null;
      updateData.grossTime = b.grossTime || null;
      updateData.status = 'GROSS_WEIGHED';

      // For DDGS: if bags and weightPerBag provided
      if (b.bags || b.weightPerBag) {
        updateData.bags = parseInt(b.bags) || 0;
        updateData.weightPerBag = parseFloat(b.weightPerBag) || 50;
      }
    }

    const shipment = await prisma.shipment.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        dispatchRequest: true,
      },
    });
    res.json(shipment);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /:id/status — Update shipment status with transitions
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const newStatus = b.status;
    let updateData: any = { status: newStatus };

    // Status-specific logic
    if (newStatus === 'LOADING') {
      updateData.loadStartTime = b.loadStartTime || null;
    } else if (newStatus === 'RELEASED') {
      updateData.releaseTime = b.releaseTime || null;
      if (b.challanNo) updateData.challanNo = b.challanNo;
      if (b.ewayBill) updateData.ewayBill = b.ewayBill;
      if (b.gatePassNo) updateData.gatePassNo = b.gatePassNo;
    } else if (newStatus === 'EXITED') {
      updateData.exitTime = b.exitTime || null;
    }

    // Save extra fields from body
    if (b.quantityKL) updateData.quantityKL = parseFloat(b.quantityKL);
    if (b.quantityBL) updateData.quantityBL = parseFloat(b.quantityBL);
    if (b.strength) updateData.strength = parseFloat(b.strength);
    if (b.bags) updateData.bags = parseInt(b.bags);
    if (b.weightPerBag) updateData.weightPerBag = parseFloat(b.weightPerBag);
    if (b.invoiceRef) updateData.invoiceRef = b.invoiceRef;

    const shipment = await prisma.shipment.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        dispatchRequest: true,
      },
    });
    res.json(shipment);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /:id — Update any shipment fields
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const updateData: any = {};

    // Parse numeric fields
    if (b.capacityTon !== undefined) updateData.capacityTon = parseFloat(b.capacityTon);
    if (b.weightTare !== undefined) updateData.weightTare = parseFloat(b.weightTare);
    if (b.weightGross !== undefined) updateData.weightGross = parseFloat(b.weightGross);
    if (b.weightNet !== undefined) updateData.weightNet = parseFloat(b.weightNet);
    if (b.quantityKL !== undefined) updateData.quantityKL = parseFloat(b.quantityKL);
    if (b.quantityBL !== undefined) updateData.quantityBL = parseFloat(b.quantityBL);
    if (b.strength !== undefined) updateData.strength = parseFloat(b.strength);
    if (b.bags !== undefined) updateData.bags = parseInt(b.bags);
    if (b.weightPerBag !== undefined) updateData.weightPerBag = parseFloat(b.weightPerBag);

    // Copy string fields
    ['productName', 'customerName', 'destination', 'vehicleNo', 'vehicleType', 'driverName', 'driverMobile', 'transporterName', 'remarks', 'challanNo', 'ewayBill', 'gatePassNo', 'invoiceRef', 'status'].forEach(field => {
      if (b[field] !== undefined) updateData[field] = b[field];
    });

    const shipment = await prisma.shipment.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        dispatchRequest: true,
      },
    });
    res.json(shipment);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /:id — Delete (ADMIN only, only if GATE_IN status)
router.delete('/:id', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  try {
    const shipment = await prisma.shipment.findUnique({
      where: { id: req.params.id },
    });

    if (!shipment) { res.status(404).json({ error: 'Shipment not found' }); return; }
    if (shipment.status !== 'GATE_IN') { res.status(400).json({ error: 'Can only delete GATE_IN shipments' }); return; }

    await prisma.shipment.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
