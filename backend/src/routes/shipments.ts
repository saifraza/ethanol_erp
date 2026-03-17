import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import {
  generateEwayBill, buildEwayBillPayload, MSPIL,
  getStateCode, getHsnCode, getUnitCode, formatDateDDMMYYYY,
  EwayBillInput,
} from '../services/ewayBill';

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
    const type = b.type; // 'tare' or 'gross'
    let updateData: any = {};

    // Get existing shipment to fetch stored tare
    const existing = await prisma.shipment.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ error: 'Shipment not found' }); return; }

    if (type === 'tare' || (b.weightTare && !b.weightGross)) {
      // Tare weight step
      updateData.weightTare = parseFloat(b.weightTare) || 0;
      updateData.tareTime = b.tareTime || new Date().toISOString();
      updateData.status = 'TARE_WEIGHED';
    } else if (type === 'gross' || b.weightGross) {
      // Gross weight step — use stored tare if not provided
      const tare = parseFloat(b.weightTare) || existing.weightTare || 0;
      const gross = parseFloat(b.weightGross) || 0;
      updateData.weightGross = gross;
      updateData.weightNet = gross - tare;
      updateData.grossTime = b.grossTime || new Date().toISOString();
      updateData.status = 'GROSS_WEIGHED';
      if (!existing.weightTare && tare) updateData.weightTare = tare;

      // For DDGS: if bags and weightPerBag provided
      if (b.bags || b.weightPerBag) {
        updateData.bags = parseInt(b.bags) || 0;
        updateData.weightPerBag = parseFloat(b.weightPerBag) || 50;
      }
    } else {
      // Fallback: set whatever is provided
      if (b.weightTare) { updateData.weightTare = parseFloat(b.weightTare); updateData.status = 'TARE_WEIGHED'; }
      if (b.weightGross) {
        updateData.weightGross = parseFloat(b.weightGross);
        const tare = parseFloat(b.weightTare) || existing.weightTare || 0;
        updateData.weightNet = parseFloat(b.weightGross) - tare;
        updateData.status = 'GROSS_WEIGHED';
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

// POST /:id/eway-bill — Generate e-way bill for a shipment
router.post('/:id/eway-bill', async (req: Request, res: Response) => {
  try {
    // Load shipment with full chain: shipment → DR → order → customer + lines
    const shipment = await prisma.shipment.findUnique({
      where: { id: req.params.id },
      include: {
        dispatchRequest: {
          include: {
            order: {
              include: {
                customer: true,
                lines: true,
              },
            },
          },
        },
      },
    });

    if (!shipment) { res.status(404).json({ error: 'Shipment not found' }); return; }
    if (shipment.ewayBill && shipment.ewayBillStatus === 'GENERATED') {
      res.status(400).json({ error: `E-Way Bill already generated: ${shipment.ewayBill}` });
      return;
    }

    // Must have gross weight (goods loaded)
    if (!shipment.weightNet || shipment.weightNet <= 0) {
      res.status(400).json({ error: 'Cannot generate e-way bill without net weight. Complete weighbridge first.' });
      return;
    }

    const dr = shipment.dispatchRequest;
    const order = dr?.order;
    const customer = order?.customer;

    if (!order || !customer) {
      res.status(400).json({ error: 'Shipment must be linked to an order with customer details' });
      return;
    }

    // Build customer address
    const custAddress = [customer.address, customer.city, customer.state, customer.pincode].filter(Boolean).join(', ');

    // Get transporter details if available
    let transporterGstin = '';
    let transporterName = shipment.transporterName || '';
    if (dr?.transporterId) {
      const transporter = await prisma.transporter.findUnique({ where: { id: dr.transporterId } });
      if (transporter) {
        transporterGstin = transporter.gstin || '';
        transporterName = transporter.name;
      }
    }

    // Determine document info (use challan or invoice ref)
    const docNo = shipment.challanNo || shipment.invoiceRef || `SHP-${shipment.shipmentNo}`;
    const docDate = formatDateDDMMYYYY(shipment.date || new Date());
    const docType = shipment.invoiceRef ? 'INV' : 'CHL';

    // Build item list from order lines
    const items = order.lines.map(line => {
      const gstHalf = (line.gstPercent || 18) / 2;
      const isInterState = getStateCode(customer.state || '') !== '23'; // 23 = MP

      // Pro-rate taxable value by weight ratio if multiple lines
      const lineWeight = line.quantity; // in tons
      const totalOrderQty = order.lines.reduce((s, l) => s + l.quantity, 0);
      const weightRatio = totalOrderQty > 0 ? (shipment.weightNet! / 1000) / totalOrderQty : 1;
      const shipmentQty = lineWeight * weightRatio;
      const taxableValue = shipmentQty * line.rate;

      return {
        productName: line.productName,
        hsnCode: getHsnCode(line.productName),
        quantity: Math.round(shipmentQty * 1000) / 1000,
        unit: line.unit || 'TON',
        taxableValue: Math.round(taxableValue * 100) / 100,
        cgstRate: isInterState ? 0 : gstHalf,
        sgstRate: isInterState ? 0 : gstHalf,
        igstRate: isInterState ? (line.gstPercent || 18) : 0,
      };
    });

    // Distance from DR or default
    const distanceKm = (dr as any)?.distanceKm || 0;

    const input: EwayBillInput = {
      supplierGstin: MSPIL.gstin,
      supplierName: MSPIL.name,
      supplierAddress: MSPIL.address,
      supplierState: MSPIL.state,
      supplierPincode: MSPIL.pincode,
      recipientGstin: customer.gstNo || undefined,
      recipientName: customer.name,
      recipientAddress: custAddress,
      recipientState: customer.state || '',
      recipientPincode: customer.pincode || '',
      documentType: docType as any,
      documentNo: docNo,
      documentDate: docDate,
      items,
      transporterId: transporterGstin,
      transporterName,
      vehicleNo: shipment.vehicleNo,
      vehicleType: 'R',
      transportMode: '1', // Road
      distanceKm: distanceKm || 100,
      supplyType: 'O', // Outward
      subType: '1',    // Supply
    };

    // Generate e-way bill
    const result = await generateEwayBill(input);

    if (result.success && result.ewayBillNo) {
      // Save to shipment
      await prisma.shipment.update({
        where: { id: req.params.id },
        data: {
          ewayBill: result.ewayBillNo,
          ewayBillDate: result.ewayBillDate ? new Date(result.ewayBillDate) : new Date(),
          ewayBillValid: result.validUpto ? new Date(result.validUpto) : null,
          ewayBillStatus: 'GENERATED',
        },
      });

      res.json({
        success: true,
        ewayBillNo: result.ewayBillNo,
        ewayBillDate: result.ewayBillDate,
        validUpto: result.validUpto,
        message: process.env.EWAY_BILL_MODE === 'production'
          ? 'E-Way Bill generated successfully'
          : 'SANDBOX: Mock e-way bill generated. Set EWAY_BILL_MODE=production and configure GSP credentials for live generation.',
      });
    } else {
      res.status(400).json({ success: false, error: result.error || 'E-Way Bill generation failed' });
    }
  } catch (err: any) {
    console.error('[E-Way Bill] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /:id/eway-bill/preview — Preview e-way bill payload without generating
router.post('/:id/eway-bill/preview', async (req: Request, res: Response) => {
  try {
    const shipment = await prisma.shipment.findUnique({
      where: { id: req.params.id },
      include: {
        dispatchRequest: {
          include: {
            order: {
              include: {
                customer: true,
                lines: true,
              },
            },
          },
        },
      },
    });

    if (!shipment) { res.status(404).json({ error: 'Shipment not found' }); return; }

    const dr = shipment.dispatchRequest;
    const order = dr?.order;
    const customer = order?.customer;

    res.json({
      shipment: {
        id: shipment.id,
        vehicleNo: shipment.vehicleNo,
        weightNet: shipment.weightNet,
        productName: shipment.productName,
        customerName: shipment.customerName,
      },
      customer: customer ? {
        name: customer.name,
        gstin: customer.gstNo,
        state: customer.state,
        pincode: customer.pincode,
      } : null,
      order: order ? {
        orderNo: order.orderNo,
        lines: order.lines.length,
        grandTotal: order.grandTotal,
      } : null,
      supplier: MSPIL,
      mode: process.env.EWAY_BILL_MODE || 'sandbox',
      ready: !!(shipment.weightNet && shipment.weightNet > 0 && customer),
    });
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
