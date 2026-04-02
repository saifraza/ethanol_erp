import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import {
  generateEwayBill, buildEwayBillPayload, MSPIL,
  getStateCode, getHsnCode, getUnitCode, formatDateDDMMYYYY,
  cancelEwayBill, updateVehicle, getEwayBillDetails,
  EwayBillInput,
} from '../services/ewayBill';
import { generateIRN, generateEWBByIRN, buildIRNPayload, cancelIRN, getGSTINDetails } from '../services/eInvoice';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { drawLetterhead } from '../utils/letterhead';
import { sendEmail } from '../services/messaging';
import { renderDocumentPdf } from '../services/documentRenderer';

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
        dispatchRequest: { include: { orderLine: true } },
        documents: { orderBy: { createdAt: 'desc' } },
        transporterPayments: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    // Attach linked invoice IDs
    const shipmentIds = shipments.map((s: any) => s.id);
    const invoices = await prisma.invoice.findMany({
      where: { shipmentId: { in: shipmentIds } },
      select: { id: true, shipmentId: true, invoiceNo: true },
    });
    const invMap = new Map<string, any>(invoices.map((i: any) => [i.shipmentId, i]));
    const enriched = shipments.map((s: any) => ({
      ...s,
      linkedInvoiceId: invMap.get(s.id)?.id || null,
      linkedInvoiceNo: invMap.get(s.id)?.invoiceNo || null,
    }));
    res.json({ shipments: enriched });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /active — All active shipments + today's EXITED (for dispatch % calc)
router.get('/active', async (req: Request, res: Response) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Cap limit to prevent unbounded queries
    const limit = Math.min(parseInt((req.query.limit as string) || '100'), 500);
    const shipments = await prisma.shipment.findMany({
      where: {
        OR: [
          { status: { notIn: ['EXITED', 'CANCELLED'] } },
          { status: 'EXITED', exitTime: { gte: todayStart.toISOString() } },
          { status: 'EXITED', updatedAt: { gte: todayStart.toISOString() } },
        ],
      },
      include: {
        dispatchRequest: { include: { orderLine: true } },
        documents: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    // Attach linked invoice IDs
    const sIds = shipments.map((s: any) => s.id);
    const invs = await prisma.invoice.findMany({
      where: { shipmentId: { in: sIds } },
      select: { id: true, shipmentId: true, invoiceNo: true },
    });
    const iMap = new Map<string, any>(invs.map((i: any) => [i.shipmentId, i]));
    const enriched = shipments.map((s: any) => ({
      ...s,
      linkedInvoiceId: iMap.get(s.id)?.id || null,
      linkedInvoiceNo: iMap.get(s.id)?.invoiceNo || null,
    }));
    res.json({ shipments: enriched });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /config/eway-mode — Return current e-way bill mode for frontend
router.get('/config/eway-mode', async (_req: Request, res: Response) => {
  res.json({
    mode: process.env.EWAY_BILL_MODE || 'sandbox',
    gstin: process.env.EWAY_GSTIN || MSPIL.gstin,
    nicConfigured: !!(process.env.EWAY_NIC_URL && process.env.EWAY_NIC_CLIENT_ID),
    gspConfigured: !!(process.env.EWAY_GSP_URL && process.env.EWAY_GSP_TOKEN),
  });
});

// GET /:id — Single shipment with dispatchRequest details
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const shipment = await prisma.shipment.findUnique({
      where: { id: req.params.id },
      include: {
        dispatchRequest: { include: { orderLine: true } },
      },
    });
    if (!shipment) { res.status(404).json({ error: 'Shipment not found' }); return; }
    res.json(shipment);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST / — Create shipment (Gate Entry) or Gate Pass
router.post('/', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const capacityTon = parseFloat(b.capacityTon) || 0;

    const data: any = {
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
    };

    // Link to dispatch request if provided (sales flow)
    if (b.dispatchRequestId) {
      data.dispatchRequest = { connect: { id: b.dispatchRequestId } };

      // Inherit paymentTerms from the SalesOrder
      const dr = await prisma.dispatchRequest.findUnique({
        where: { id: b.dispatchRequestId },
        include: { order: { select: { paymentTerms: true } } },
      });
      if (dr?.order?.paymentTerms) {
        data.paymentTerms = dr.order.paymentTerms;
        // Credit terms (NET*) don't need payment before release
        const creditTerms = ['NET7', 'NET15', 'NET30', 'NET45', 'NET60'];
        data.paymentStatus = creditTerms.includes(dr.order.paymentTerms)
          ? 'NOT_REQUIRED' : 'PENDING';
      }
    }

    // Allow manual override of paymentTerms
    if (b.paymentTerms) {
      data.paymentTerms = b.paymentTerms;
      const creditTerms = ['NET7', 'NET15', 'NET30', 'NET45', 'NET60'];
      data.paymentStatus = creditTerms.includes(b.paymentTerms)
        ? 'NOT_REQUIRED' : 'PENDING';
    }

    // Gate pass fields (job work / returnable flow)
    if (b.gatePassType) {
      data.gatePassType = b.gatePassType;
      data.purpose = b.purpose || null;
      data.partyName = b.partyName || null;
      data.partyAddress = b.partyAddress || null;
      data.partyGstin = b.partyGstin || null;
      data.gatePassItems = b.gatePassItems ? JSON.stringify(b.gatePassItems) : null;
      data.totalValue = parseFloat(b.totalValue) || null;
      data.coveringNote = b.coveringNote || null;
      // Use party info as customer/destination
      if (!b.customerName && b.partyName) data.customerName = b.partyName;
      if (!b.destination && b.partyAddress) data.destination = b.partyAddress;
    }

    const shipment = await prisma.shipment.create({
      data,
      include: {
        dispatchRequest: { include: { orderLine: true } },
      },
    });

    // Auto-generate challanNo and gatePassNo from shipmentNo
    const challanNo = `DC-${shipment.shipmentNo}`;
    const gatePassNo = `GP-${shipment.shipmentNo}`;
    const updated = await prisma.shipment.update({
      where: { id: shipment.id },
      data: { challanNo, gatePassNo },
      include: { dispatchRequest: { include: { orderLine: true } } },
    });
    res.status(201).json(updated);
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
        dispatchRequest: { include: { orderLine: true } },
      },
    });
    res.json(shipment);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /:id/confirm-payment — Confirm payment received for ADVANCE/COD shipments
router.post('/:id/confirm-payment', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id } });
    if (!shipment) { res.status(404).json({ error: 'Shipment not found' }); return; }

    if (shipment.paymentStatus === 'CONFIRMED' || shipment.paymentStatus === 'NOT_REQUIRED') {
      res.status(400).json({ error: 'Payment already confirmed or not required' });
      return;
    }

    const mode = b.paymentMode || 'CASH';
    const validModes = ['CASH', 'UPI', 'NEFT', 'RTGS', 'CHEQUE', 'BANK_TRANSFER'];
    if (!validModes.includes(mode)) {
      res.status(400).json({ error: `Invalid payment mode. Use: ${validModes.join(', ')}` });
      return;
    }

    const updated = await prisma.shipment.update({
      where: { id: req.params.id },
      data: {
        paymentStatus: 'CONFIRMED',
        paymentMode: mode,
        paymentRef: b.paymentRef || null,
        paymentAmount: parseFloat(b.paymentAmount) || null,
        paymentConfirmedAt: new Date(),
        paymentConfirmedBy: (req as any).user?.id || null,
      },
      include: { dispatchRequest: { include: { orderLine: true } } },
    });
    res.json(updated);
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
      // ── Payment + E-Way Bill gates before release ──
      const shipCheck = await prisma.shipment.findUnique({
        where: { id: req.params.id },
        select: {
          paymentStatus: true, paymentTerms: true,
          ewayBill: true, gatePassType: true, totalValue: true,
          documents: { where: { docType: 'EWAY_BILL' }, select: { id: true }, take: 1 },
        },
      });

      // Payment gate (existing)
      if (shipCheck && shipCheck.paymentStatus === 'PENDING') {
        res.status(400).json({
          error: `Payment must be confirmed before release (terms: ${shipCheck.paymentTerms || 'ADVANCE'})`,
          code: 'PAYMENT_REQUIRED',
        });
        return;
      }

      // E-Way Bill gate: required unless exempt (returnable gate pass under 50k)
      if (shipCheck) {
        const hasEwb = !!shipCheck.ewayBill || (shipCheck.documents?.length || 0) > 0;
        const isExempt = shipCheck.gatePassType === 'RETURNABLE'
          && (shipCheck.totalValue || 0) < 50000;
        if (!hasEwb && !isExempt) {
          res.status(400).json({
            error: 'E-Way Bill is required before release. Generate via e-Invoice or upload the document.',
            code: 'EWAY_BILL_REQUIRED',
          });
          return;
        }
      }

      updateData.releaseTime = b.releaseTime || null;
      if (b.challanNo) updateData.challanNo = b.challanNo;
      if (b.ewayBill) updateData.ewayBill = b.ewayBill;
      if (b.gatePassNo) updateData.gatePassNo = b.gatePassNo;
    } else if (newStatus === 'EXITED') {
      updateData.exitTime = b.exitTime || null;
    }

    // Fetch existing shipment for stock deduction
    const existing = await prisma.shipment.findUnique({ where: { id: req.params.id } });

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
        dispatchRequest: { include: { orderLine: true } },
      },
    });

    // ── Auto-deduct DDGS stock when truck is RELEASED ──
    if (newStatus === 'RELEASED' && existing && existing.weightNet && existing.weightNet > 0) {
      const productName = (existing.productName || '').toUpperCase();
      if (productName.includes('DDGS')) {
        try {
          const netMT = existing.weightNet / 1000; // KG → MT (Shipment stores KG)

          // 1. Check for existing DDGSDispatchTruck (may exist from factory sync)
          let existingDdgs = existing.sourceWbId
            ? await prisma.dDGSDispatchTruck.findFirst({ where: { sourceWbId: existing.sourceWbId } })
            : null;
          // Fallback: match by vehicle + same day
          if (!existingDdgs) {
            const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
            const dayEnd = new Date(); dayEnd.setHours(23, 59, 59, 999);
            existingDdgs = await prisma.dDGSDispatchTruck.findFirst({
              where: { vehicleNo: existing.vehicleNo || '', date: { gte: dayStart, lte: dayEnd } },
            });
          }

          if (existingDdgs) {
            // Update existing row status (already created by factory sync)
            await prisma.dDGSDispatchTruck.update({
              where: { id: existingDdgs.id },
              data: { status: 'RELEASED', releaseTime: new Date() },
            });
          } else {
            // Create new DDGSDispatchTruck (manual shipment, not from factory)
            await prisma.dDGSDispatchTruck.create({
              data: {
                date: new Date(),
                vehicleNo: existing.vehicleNo || '',
                partyName: existing.customerName || '',
                destination: existing.destination || '',
                bags: existing.bags || 0,
                weightPerBag: existing.weightPerBag || 50,
                weightGross: existing.weightGross || 0,
                weightTare: existing.weightTare || 0,
                weightNet: netMT,  // FIX: KG → MT conversion
                sourceWbId: existing.sourceWbId || null,
                remarks: `Auto from shipment #${existing.shipmentNo}`,
                userId: (req as any).user?.id || null,
              },
            });
          }

          // 2. Update today's DDGSStockEntry dispatch total
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const yearStart = today.getFullYear();

          const todayEntry = await prisma.dDGSStockEntry.findFirst({
            where: { date: today, yearStart },
          });

          if (todayEntry) {
            const newDispatch = (todayEntry.dispatchToday || 0) + netMT;
            const newClosing = (todayEntry.openingStock || 0) + (todayEntry.productionToday || 0) - newDispatch;
            await prisma.dDGSStockEntry.update({
              where: { id: todayEntry.id },
              data: { dispatchToday: newDispatch, closingStock: newClosing },
            });
          }

          console.log(`[Stock] DDGS deducted: ${netMT.toFixed(3)} MT for ${existing.vehicleNo}`);
        } catch (stockErr) {
          console.error('[Stock] DDGS deduction failed:', stockErr);
          // Don't fail the shipment release if stock update fails
        }
      }
    }

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
    if (b.totalValue !== undefined) updateData.totalValue = parseFloat(b.totalValue);

    // Copy string fields
    ['productName', 'customerName', 'destination', 'vehicleNo', 'vehicleType', 'driverName', 'driverMobile', 'transporterName', 'remarks', 'challanNo', 'ewayBill', 'gatePassNo', 'invoiceRef', 'status',
     'grBiltyNo', 'deliveryStatus', 'receivedByName', 'receivedByPhone', 'podRemarks', 'insuranceBy', 'insuranceNo', 'insuranceProvider',
     'gatePassType', 'purpose', 'partyName', 'partyAddress', 'partyGstin', 'gatePassItems', 'coveringNote'].forEach(field => {
      if (b[field] !== undefined) updateData[field] = b[field];
    });
    // Date fields
    if (b.grBiltyDate !== undefined) updateData.grBiltyDate = b.grBiltyDate ? new Date(b.grBiltyDate) : null;
    if (b.grReceivedBack !== undefined) updateData.grReceivedBack = !!b.grReceivedBack;
    if (b.grReceivedDate !== undefined) updateData.grReceivedDate = b.grReceivedDate ? new Date(b.grReceivedDate) : null;
    if (b.deliveredAt !== undefined) updateData.deliveredAt = b.deliveredAt ? new Date(b.deliveredAt) : null;

    const shipment = await prisma.shipment.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        dispatchRequest: { include: { orderLine: true } },
      },
    });
    res.json(shipment);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /:id/eway-bill — Generate e-way bill for a shipment
// CORRECT FLOW: Invoice (must exist) → e-Invoice IRN (from Invoice) → EWB from IRN
// All IRN data is stored on the INVOICE record (single source of truth)
// Shipment just gets the EWB number + a reference back to the Invoice
router.post('/:id/eway-bill', async (req: Request, res: Response) => {
  try {
    // Load shipment with dispatch request for transporter info
    const shipment = await prisma.shipment.findUnique({
      where: { id: req.params.id },
      include: {
        dispatchRequest: true,
      },
    });

    if (!shipment) { res.status(404).json({ error: 'Shipment not found' }); return; }
    if (shipment.ewayBill && shipment.ewayBillStatus === 'GENERATED') {
      res.status(400).json({ error: `E-Way Bill already generated: ${shipment.ewayBill}` });
      return;
    }

    // Must have gross weight (goods loaded)
    if (!shipment.weightNet || shipment.weightNet <= 0) {
      res.status(400).json({ error: 'Complete weighbridge first — net weight is required.' });
      return;
    }

    // ── Payment gate: ADVANCE/COD must be paid before generating EWB ──
    if (shipment.paymentStatus === 'PENDING') {
      res.status(400).json({
        error: `Payment must be confirmed before generating E-Way Bill (terms: ${shipment.paymentTerms || 'ADVANCE'})`,
        step: 'payment-required',
        code: 'PAYMENT_REQUIRED',
      });
      return;
    }

    // ── STEP 0: Find the Invoice for this shipment ──
    // Invoice is the single source of truth for all tax/amount data
    const invoice = await prisma.invoice.findFirst({
      where: { shipmentId: shipment.id },
      include: { customer: true },
    });

    if (!invoice) {
      res.status(400).json({
        error: 'Create an Invoice for this shipment first. Go to the shipment card and click "Bill" to generate an invoice.',
        step: 'invoice-missing',
      });
      return;
    }

    // ── STEP 0b: Validate customer data for e-Invoice ──
    const customer = invoice.customer;
    const missingFields: string[] = [];
    if (!customer.gstNo) missingFields.push('GSTIN');
    if (!customer.state) missingFields.push('State');
    if (!customer.pincode) missingFields.push('Pincode');
    if (!customer.address) missingFields.push('Address');

    if (missingFields.length > 0) {
      res.status(400).json({
        error: `Customer "${customer.name}" is missing: ${missingFields.join(', ')}. Update the customer record in Sales → Customers before generating e-Invoice.`,
        step: 'customer-incomplete',
        missingFields,
      });
      return;
    }

    // Validate invoice amounts
    if (!invoice.rate || invoice.rate <= 0) {
      res.status(400).json({ error: 'Invoice rate is zero. Update the invoice with the correct rate.', step: 'invoice-incomplete' });
      return;
    }

    const mode = process.env.EWAY_BILL_MODE || 'sandbox';
    const dr = shipment.dispatchRequest;

    // Get transporter details
    let transporterGstin = '';
    let transporterName = shipment.transporterName || '';
    if (dr?.transporterId) {
      const transporter = await prisma.transporter.findUnique({ where: { id: dr.transporterId } });
      if (transporter) { transporterGstin = transporter.gstin || ''; transporterName = transporter.name; }
    }

    const distanceKm = (dr as any)?.distanceKm || 100;

    // ── Sandbox Mode: Skip IRN, generate mock EWB ──
    if (mode === 'sandbox') {
      const custAddress = [customer.address, customer.city, customer.state, customer.pincode].filter(Boolean).join(', ');
      const docNo = `INV-${invoice.invoiceNo}`;
      const docDate = formatDateDDMMYYYY(invoice.invoiceDate || new Date());
      const isInterState = getStateCode(customer.state || '') !== '23';
      const gstHalf = (invoice.gstPercent || 18) / 2;

      const items = [{
        productName: invoice.productName, hsnCode: getHsnCode(invoice.productName),
        quantity: invoice.quantity, unit: invoice.unit || 'MT',
        taxableValue: invoice.amount,
        cgstRate: isInterState ? 0 : gstHalf, sgstRate: isInterState ? 0 : gstHalf,
        igstRate: isInterState ? (invoice.gstPercent || 18) : 0,
      }];

      const input: EwayBillInput = {
        supplierGstin: MSPIL.gstin, supplierName: MSPIL.name, supplierAddress: MSPIL.address,
        supplierState: MSPIL.state, supplierPincode: MSPIL.pincode,
        recipientGstin: customer.gstNo || undefined, recipientName: customer.name,
        recipientAddress: custAddress, recipientState: customer.state || '', recipientPincode: customer.pincode || '',
        documentType: 'INV', documentNo: docNo, documentDate: docDate,
        items, transporterId: transporterGstin, transporterName,
        vehicleNo: shipment.vehicleNo, vehicleType: 'R', transportMode: '1',
        distanceKm: distanceKm || 100, supplyType: 'O', subType: '1',
      };

      const result = await generateEwayBill(input);
      if (result.success && result.ewayBillNo) {
        // Update both shipment AND invoice with EWB
        await prisma.shipment.update({
          where: { id: req.params.id },
          data: {
            ewayBill: result.ewayBillNo,
            ewayBillDate: result.ewayBillDate ? new Date(result.ewayBillDate) : new Date(),
            ewayBillValid: result.validUpto ? new Date(result.validUpto) : null,
            ewayBillStatus: 'GENERATED',
          },
        });
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            ewbNo: result.ewayBillNo,
            ewbDate: result.ewayBillDate ? new Date(result.ewayBillDate) : new Date(),
            ewbValidTill: result.validUpto ? new Date(result.validUpto) : null,
            ewbStatus: 'GENERATED',
          } as any,
        });
        res.json({
          success: true, ewayBillNo: result.ewayBillNo,
          invoiceNo: invoice.invoiceNo,
          ewayBillDate: result.ewayBillDate, validUpto: result.validUpto,
          message: 'SANDBOX: Mock e-way bill generated.',
        });
      } else {
        res.status(400).json({ success: false, error: result.error || 'E-Way Bill generation failed' });
      }
      return;
    }

    // ══════════════════════════════════════════════════════════════
    // ── Production Mode (Saral): Invoice → e-Invoice IRN → EWB ──
    // ══════════════════════════════════════════════════════════════

    // ── Step 1: Generate e-Invoice (IRN) if not already done ──
    // IRN is stored on the Invoice record (single source of truth)
    let irn = invoice.irn as string | null;

    if (!irn) {
      console.log(`[Shipment ${shipment.shipmentNo}] Step 1: Generating e-Invoice (IRN) from Invoice INV-${invoice.invoiceNo}...`);

      // Build IRN payload from the actual Invoice record
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

      const irnResult = await generateIRN(invoiceData);

      if (!irnResult.success || !irnResult.irn) {
        res.status(400).json({
          success: false,
          step: 'e-invoice',
          error: `e-Invoice generation failed: ${irnResult.error}`,
          invoiceNo: invoice.invoiceNo,
        });
        return;
      }

      irn = irnResult.irn;

      // Save IRN to INVOICE (single source of truth)
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          irn: irnResult.irn,
          irnDate: new Date(),
          irnStatus: 'GENERATED',
          ackNo: irnResult.ackNo || null,
          signedQRCode: irnResult.signedQRCode ? irnResult.signedQRCode.slice(0, 4000) : null,
        } as any,
      });

      // Also copy IRN to shipment for quick reference
      await prisma.shipment.update({
        where: { id: req.params.id },
        data: {
          irn: irnResult.irn,
          irnDate: new Date(),
          irnStatus: 'GENERATED',
          ackNo: irnResult.ackNo || null,
          signedQRCode: irnResult.signedQRCode ? irnResult.signedQRCode.slice(0, 4000) : null,
        } as any,
      });

      console.log(`[Shipment ${shipment.shipmentNo}] IRN generated: ${irn} (stored on Invoice INV-${invoice.invoiceNo})`);
    } else {
      console.log(`[Shipment ${shipment.shipmentNo}] Step 1: IRN already exists on Invoice INV-${invoice.invoiceNo}: ${irn}`);
    }

    // ── Step 2: Generate E-Way Bill from IRN ──
    console.log(`[Shipment ${shipment.shipmentNo}] Step 2: Generating E-Way Bill from IRN...`);

    const ewbData: Record<string, any> = {
      Distance: Math.round(distanceKm),
      TransMode: '1', // Road
      VehNo: shipment.vehicleNo.replace(/\s/g, '').toUpperCase(),
      VehType: 'R',   // Regular
    };
    if (transporterGstin) ewbData.TransId = transporterGstin;
    if (transporterName) ewbData.TransName = transporterName;

    const ewbResult = await generateEWBByIRN(irn!, ewbData);

    if (ewbResult.success && ewbResult.ewayBillNo) {
      // Update BOTH shipment and invoice
      await prisma.shipment.update({
        where: { id: req.params.id },
        data: {
          ewayBill: ewbResult.ewayBillNo,
          ewayBillDate: ewbResult.ewayBillDate ? new Date(ewbResult.ewayBillDate) : new Date(),
          ewayBillValid: ewbResult.validUpto ? new Date(ewbResult.validUpto) : null,
          ewayBillStatus: 'GENERATED',
        },
      });
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          ewbNo: ewbResult.ewayBillNo,
          ewbDate: ewbResult.ewayBillDate ? new Date(ewbResult.ewayBillDate) : new Date(),
          ewbValidTill: ewbResult.validUpto ? new Date(ewbResult.validUpto) : null,
          ewbStatus: 'GENERATED',
        } as any,
      });

      res.json({
        success: true,
        irn,
        invoiceNo: invoice.invoiceNo,
        ewayBillNo: ewbResult.ewayBillNo,
        ewayBillDate: ewbResult.ewayBillDate,
        validUpto: ewbResult.validUpto,
        message: 'e-Invoice and E-Way Bill generated successfully',
      });
    } else {
      res.status(400).json({
        success: false,
        step: 'eway-bill',
        irn, // IRN was generated successfully
        invoiceNo: invoice.invoiceNo,
        error: `E-Way Bill generation failed: ${ewbResult.error}`,
      });
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

// GET /:id/challan-pdf — Generate Delivery Challan PDF
router.get('/:id/challan-pdf', async (req: Request, res: Response) => {
  try {
    const shipment = await prisma.shipment.findUnique({
      where: { id: req.params.id },
      include: {
        dispatchRequest: {
          include: {
            order: { include: { customer: true, lines: true } },
          },
        },
      },
    });
    if (!shipment) { res.status(404).json({ error: 'Shipment not found' }); return; }

    const dr = shipment.dispatchRequest;
    const order = dr?.order;
    const customer = order?.customer;

    const challanData = {
      challanNo: shipment.challanNo || `DC-${shipment.shipmentNo}`,
      shipmentNo: shipment.shipmentNo,
      date: shipment.date,
      vehicleNo: shipment.vehicleNo,
      driverName: shipment.driverName,
      driverMobile: shipment.driverMobile,
      transporterName: shipment.transporterName,
      ewayBill: shipment.ewayBill,
      grBiltyNo: shipment.grBiltyNo,
      destination: shipment.destination,
      weightGross: shipment.weightGross,
      weightTare: shipment.weightTare,
      weightNet: shipment.weightNet,
      customer: customer ? {
        name: customer.name,
        address: customer.address,
        city: customer.city,
        state: customer.state,
        pincode: customer.pincode,
        gstNo: customer.gstNo,
        phone: customer.phone,
      } : { name: shipment.customerName },
      lines: order?.lines?.map((line: any) => ({
        productName: line.productName || shipment.productName,
        hsnCode: line.hsnCode,
        quantity: line.quantity,
        unit: line.unit,
        rate: line.rate,
        value: line.quantity * line.rate,
      })) || [{ productName: shipment.productName, quantity: 0, unit: 'TON', rate: 0, value: 0 }],
    };

    const pdfBuffer = await renderDocumentPdf({ docType: 'CHALLAN', data: challanData, verifyId: shipment.id });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=Challan-${shipment.shipmentNo}.pdf`);
    res.send(pdfBuffer);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /:id/gate-pass-pdf — Generate Gate Pass cum Challan PDF
router.get('/:id/gate-pass-pdf', async (req: Request, res: Response) => {
  try {
    const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id } });
    if (!shipment) { res.status(404).json({ error: 'Shipment not found' }); return; }

    const items = shipment.gatePassItems ? JSON.parse(shipment.gatePassItems) : [];
    const isReturnable = shipment.gatePassType === 'RETURNABLE' || shipment.gatePassType === 'JOB_WORK';

    const gatePassData = {
      gatePassNo: shipment.gatePassNo || `GP-${shipment.shipmentNo}`,
      shipmentNo: shipment.shipmentNo,
      date: shipment.date,
      vehicleNo: shipment.vehicleNo,
      driverName: shipment.driverName,
      driverMobile: shipment.driverMobile,
      transporterName: shipment.transporterName,
      ewayBill: shipment.ewayBill,
      isReturnable,
      partyName: shipment.partyName,
      partyAddress: shipment.partyAddress,
      partyGstin: shipment.partyGstin,
      customerName: shipment.customerName,
      destination: shipment.destination,
      weightGross: shipment.weightGross,
      weightTare: shipment.weightTare,
      weightNet: shipment.weightNet,
      totalValue: shipment.totalValue,
      items,
      coveringNote: shipment.coveringNote,
      purpose: shipment.purpose,
    };

    const pdfBuffer = await renderDocumentPdf({ docType: 'GATE_PASS', data: gatePassData, verifyId: shipment.id });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=GatePass-${shipment.shipmentNo}.pdf`);
    res.send(pdfBuffer);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /:id/eway-bill/cancel — Cancel e-way bill
router.post('/:id/eway-bill/cancel', async (req: Request, res: Response) => {
  try {
    const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id } });
    if (!shipment) { res.status(404).json({ error: 'Shipment not found' }); return; }
    if (!shipment.ewayBill) { res.status(400).json({ error: 'No e-way bill to cancel' }); return; }

    const { reasonCode, remarks } = req.body;
    const result = await cancelEwayBill(
      shipment.ewayBill,
      reasonCode || 1,
      remarks || 'Cancelled from ERP'
    );

    if (result.success) {
      await prisma.shipment.update({
        where: { id: req.params.id },
        data: { ewayBillStatus: 'CANCELLED' },
      });
      res.json({ success: true, message: 'E-Way Bill cancelled' });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /:id/eway-bill/vehicle — Update vehicle number on e-way bill
router.put('/:id/eway-bill/vehicle', async (req: Request, res: Response) => {
  try {
    const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id } });
    if (!shipment) { res.status(404).json({ error: 'Shipment not found' }); return; }
    if (!shipment.ewayBill) { res.status(400).json({ error: 'No e-way bill to update' }); return; }

    const { vehicleNo, reasonCode, remarks } = req.body;
    if (!vehicleNo) { res.status(400).json({ error: 'vehicleNo required' }); return; }

    const result = await updateVehicle(
      shipment.ewayBill,
      vehicleNo,
      'Narsinghpur', // fromPlace
      23,             // MP state code
      reasonCode || 4, // 4 = First Time
      remarks || 'Vehicle updated from ERP'
    );

    if (result.success) {
      await prisma.shipment.update({
        where: { id: req.params.id },
        data: { vehicleNo: vehicleNo.replace(/\s/g, '').toUpperCase() },
      });
      res.json({ success: true, message: `Vehicle updated to ${vehicleNo}` });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /:id/eway-bill/details — Get e-way bill details from NIC
router.get('/:id/eway-bill/details', async (req: Request, res: Response) => {
  try {
    const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id } });
    if (!shipment) { res.status(404).json({ error: 'Shipment not found' }); return; }
    if (!shipment.ewayBill) { res.status(400).json({ error: 'No e-way bill' }); return; }

    const details = await getEwayBillDetails(shipment.ewayBill);
    res.json(details);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /:id — Delete (ADMIN only; unlinked trucks any status, linked only GATE_IN)
router.delete('/:id', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  try {
    const shipment = await prisma.shipment.findUnique({
      where: { id: req.params.id },
    });

    if (!shipment) { res.status(404).json({ error: 'Shipment not found' }); return; }
    // Linked shipments can only be deleted at GATE_IN; unlinked can be deleted at any status
    if (shipment.dispatchRequestId && shipment.status !== 'GATE_IN') {
      res.status(400).json({ error: 'Linked shipments can only be deleted at GATE_IN' }); return;
    }

    // Delete related documents first
    await prisma.shipmentDocument.deleteMany({ where: { shipmentId: req.params.id } });
    await prisma.shipment.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /:id/cancel-irn — Cancel e-Invoice IRN (within 24 hours)
router.post('/:id/cancel-irn', async (req: Request, res: Response) => {
  try {
    const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id } });
    if (!shipment) { res.status(404).json({ error: 'Shipment not found' }); return; }
    if (!shipment.irn) { res.status(400).json({ error: 'No IRN to cancel on this shipment' }); return; }

    // CnlRsn: 1=Duplicate, 2=Data entry mistake, 3=Order cancelled, 4=Others
    const { reason, remarks } = req.body;
    const cancelReason = String(reason || '1');
    if (!['1', '2', '3', '4'].includes(cancelReason)) {
      res.status(400).json({ error: 'Invalid cancel reason. Use: 1=Duplicate, 2=Data entry mistake, 3=Order cancelled, 4=Others' });
      return;
    }

    const result = await cancelIRN(shipment.irn, cancelReason, remarks);

    if (result.success) {
      await prisma.shipment.update({
        where: { id: req.params.id },
        data: {
          irnStatus: 'CANCELLED',
          ewayBillStatus: shipment.ewayBill ? 'CANCELLED' : shipment.ewayBillStatus, // EWB auto-cancels with IRN
        },
      });
      res.json({ success: true, message: 'IRN cancelled successfully', cancelDate: result.cancelDate });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /gstin-lookup/:gstin — Lookup GSTIN details from NIC (for customer/vendor creation)
router.get('/gstin-lookup/:gstin', async (req: Request, res: Response) => {
  try {
    const { gstin } = req.params;
    if (!gstin || gstin.length !== 15) {
      res.status(400).json({ error: 'GSTIN must be exactly 15 characters' });
      return;
    }

    const result = await getGSTINDetails(gstin);
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /:id/send-email — Send Shipment Challan PDF via email
router.post('/:id/send-email', async (req: Request, res: Response) => {
  try {
    const shipment = await prisma.shipment.findUnique({
      where: { id: req.params.id },
      include: {
        dispatchRequest: {
          include: { order: { include: { customer: true } } },
        },
      },
    });
    if (!shipment) { res.status(404).json({ error: 'Shipment not found' }); return; }

    const customer = (shipment as any).dispatchRequest?.order?.customer;
    const toEmail = req.body.to || customer?.email;
    if (!toEmail) { res.status(400).json({ error: 'No email address. Add customer email or provide "to" in request.' }); return; }

    // Generate simple challan PDF as buffer
    const challanRes = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.fontSize(16).text('DELIVERY CHALLAN', { align: 'center' });
      doc.moveDown();
      doc.fontSize(10).text(`Shipment: ${shipment.shipmentNo || shipment.id}`);
      doc.text(`Vehicle: ${shipment.vehicleNo || '-'}`);
      doc.text(`Date: ${shipment.date ? new Date(shipment.date).toLocaleDateString('en-IN') : '-'}`);
      doc.text(`Customer: ${shipment.customerName || customer?.name || '-'}`);
      doc.text(`Product: ${shipment.productName || '-'}`);
      doc.text(`Qty: ${shipment.quantityBL || shipment.bags || '-'}`);
      doc.text(`Status: ${shipment.status}`);
      doc.end();
    });

    const shipLabel = `Shipment-${shipment.shipmentNo || shipment.id.slice(0, 8)}`;
    const subject = req.body.subject || `${shipLabel} — Delivery Challan from MSPIL`;
    const body = req.body.body || `Dear ${shipment.customerName || customer?.name || 'Customer'},\n\nPlease find attached the delivery challan for ${shipLabel}.\n\nRegards,\nMSPIL Distillery`;

    const result = await sendEmail({
      to: toEmail, subject, text: body,
      attachments: [{ filename: `${shipLabel}.pdf`, content: challanRes, contentType: 'application/pdf' }],
    });

    if (result.success) {
      res.json({ ok: true, messageId: result.messageId, sentTo: toEmail });
    } else {
      res.status(500).json({ error: result.error || 'Email send failed' });
    }
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
