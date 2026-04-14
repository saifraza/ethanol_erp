import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { generateIRN, generateEWBByIRN } from '../services/eInvoice';
import { onSaleInvoiceCreated } from '../services/autoJournal';
import { nextInvoiceNo } from '../utils/invoiceCounter';
import multer from 'multer';

const DEFAULT_GST_PCT = 18;

// HSN code map for scrap/miscellaneous products
const HSN_MAP: Record<string, string> = {
  'Scrap Iron': '72044900',
  'Scrap Copper': '74040000',
  'Scrap SS': '72042190',
  'Empty Drums': '73101000',
  'Gunny Bags': '63053200',
  'Coal Ash': '26219090',
  'Waste Oil': '27109900',
  'Spent Wash': '23099090',
  'Other': '99999999',
};

import { calcGstSplit } from '../utils/gstSplit';

const router = Router();
router.use(authenticate as any);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// GET / — list orders with optional filters
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const status = req.query.status as string | undefined;
  const product = req.query.product as string | undefined;

  const where: any = { ...getCompanyFilter(req) };
  if (status && status !== 'ALL') where.status = status;
  if (product) where.productName = product;

  const orders = await prisma.directSale.findMany({
    where,
    orderBy: { date: 'desc' },
    take: 500,
    select: {
      id: true, entryNo: true, date: true,
      customerId: true, buyerName: true, buyerPhone: true, buyerAddress: true,
      productName: true, rate: true, unit: true,
      validFrom: true, validTo: true, status: true,
      quantity: true, totalSuppliedQty: true, totalSuppliedAmt: true,
      remarks: true, createdAt: true,
      customer: { select: { id: true, name: true, gstNo: true, phone: true, state: true } },
    },
  });

  // Auto-expire past-due ACTIVE orders
  const now = new Date();
  const expired: string[] = [];
  for (const o of orders) {
    if (o.status === 'ACTIVE' && o.validTo && new Date(o.validTo) < now) {
      expired.push(o.id);
      o.status = 'EXPIRED';
    }
  }
  if (expired.length > 0) {
    await prisma.directSale.updateMany({
      where: { id: { in: expired } },
      data: { status: 'EXPIRED' },
    });
  }

  const active = orders.filter(o => o.status === 'ACTIVE');
  const twoDaysFromNow = new Date(now.getTime() + 2 * 86400000);
  const expiringSoon = active.filter(o => o.validTo && new Date(o.validTo) <= twoDaysFromNow);

  res.json({
    orders,
    stats: {
      total: orders.length,
      active: active.length,
      expiringSoon: expiringSoon.length,
      totalSuppliedAmt: orders.reduce((s, o) => s + (o.totalSuppliedAmt || 0), 0),
    },
  });
}));

// GET /active — active orders for a product (for weighbridge matching)
router.get('/active', asyncHandler(async (req: AuthRequest, res: Response) => {
  const product = req.query.product as string | undefined;
  const now = new Date();

  const where: any = {
    ...getCompanyFilter(req),
    status: 'ACTIVE',
    validFrom: { lte: now },
    OR: [{ validTo: null }, { validTo: { gte: now } }],
  };
  if (product) where.productName = product;

  const orders = await prisma.directSale.findMany({
    where,
    orderBy: { date: 'desc' },
    select: {
      id: true, entryNo: true, buyerName: true, productName: true,
      rate: true, unit: true, validFrom: true, validTo: true,
      quantity: true, totalSuppliedQty: true,
      customer: { select: { id: true, name: true } },
    },
  });

  res.json({ orders });
}));

// GET /:id/dispatches — shipments linked to this order (with invoice data)
router.get('/:id/dispatches', asyncHandler(async (req: AuthRequest, res: Response) => {
  const shipments = await prisma.shipment.findMany({
    where: { directSaleId: req.params.id },
    orderBy: { date: 'desc' },
    take: 200,
    select: {
      id: true, shipmentNo: true, date: true, vehicleNo: true, customerName: true,
      weightTare: true, weightGross: true, weightNet: true, bags: true,
      status: true, gateInTime: true, grossTime: true, releaseTime: true,
      productName: true, invoiceRef: true, remarks: true,
      driverName: true, driverMobile: true, transporterName: true, destination: true,
    },
  });

  // Fetch linked invoices via Invoice.shipmentId
  const shipmentIds = shipments.map(s => s.id);
  const invoices = shipmentIds.length > 0 ? await prisma.invoice.findMany({
    where: { shipmentId: { in: shipmentIds } },
    select: {
      id: true, invoiceNo: true, shipmentId: true, amount: true, totalAmount: true,
      gstPercent: true, gstAmount: true, supplyType: true,
      cgstAmount: true, sgstAmount: true, igstAmount: true,
      rate: true, quantity: true, unit: true, productName: true,
      irn: true, irnStatus: true, irnDate: true, ackNo: true,
      ewbNo: true, ewbDate: true, ewbStatus: true,
      status: true, paidAmount: true, balanceAmount: true, freightCharge: true,
      tcsPercent: true, tcsAmount: true, tcsSection: true,
      remarks: true,
    },
  }) : [];
  const invoiceByShipment = new Map(invoices.map(inv => [inv.shipmentId, inv]));

  // Fetch linked cash vouchers by matching linkedInvoiceId
  const invoiceIds = invoices.map(i => i.id);
  const cashVouchers = invoiceIds.length > 0 ? await prisma.cashVoucher.findMany({
    where: { linkedInvoiceId: { in: invoiceIds } },
    select: { id: true, voucherNo: true, amount: true, status: true, linkedInvoiceId: true },
  }) : [];
  // Also find cash vouchers for shipments with 0% invoice (no invoice, only cash voucher)
  // These are linked via purpose containing shipment ID
  const noInvoiceShipments = shipments.filter(s => !invoiceByShipment.has(s.id)).map(s => s.id);
  const directCashVouchers = noInvoiceShipments.length > 0 ? await prisma.cashVoucher.findMany({
    where: { purpose: { contains: 'shipment:' }, linkedInvoiceId: { in: noInvoiceShipments } },
    select: { id: true, voucherNo: true, amount: true, status: true, linkedInvoiceId: true },
  }) : [];

  const cvByInvoice = new Map(cashVouchers.map(cv => [cv.linkedInvoiceId, cv]));
  const cvByShipment = new Map(directCashVouchers.map(cv => [cv.linkedInvoiceId, cv]));

  const enriched = shipments.map(s => ({
    ...s,
    invoice: invoiceByShipment.get(s.id) || null,
    cashVoucher: cvByInvoice.get(invoiceByShipment.get(s.id)?.id || '') || cvByShipment.get(s.id) || null,
  }));

  const atGate = shipments.filter(s => ['GATE_IN', 'TARE_WEIGHED', 'LOADING'].includes(s.status));
  const dispatched = shipments.filter(s => !['GATE_IN', 'TARE_WEIGHED', 'LOADING'].includes(s.status));
  const invoicedCount = invoices.length;
  const irnCount = invoices.filter(i => i.irnStatus === 'GENERATED').length;
  const ewbCount = invoices.filter(i => i.ewbStatus === 'GENERATED').length;
  const outstanding = invoices.reduce((s, i) => s + (i.balanceAmount || 0), 0);

  res.json({
    shipments: enriched,
    pipeline: {
      atWeighbridge: atGate.length,
      atWeighbridgeVehicles: atGate.map(s => s.vehicleNo).join(', '),
      totalDispatches: shipments.length,
      dispatched: dispatched.length,
      invoiced: invoicedCount,
      irnGenerated: irnCount,
      ewbGenerated: ewbCount,
      outstanding,
    },
  });
}));

// POST / — create new scrap sales order
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;

  // Auto-fill buyer from Customer master
  let buyerName = b.buyerName || '';
  let buyerPhone = b.buyerPhone || null;
  let buyerAddress = b.buyerAddress || null;
  if (b.customerId) {
    const cust = await prisma.customer.findUnique({
      where: { id: b.customerId },
      select: { name: true, phone: true, address: true, state: true },
    });
    if (cust) {
      buyerName = buyerName || cust.name;
      buyerPhone = buyerPhone || cust.phone;
      buyerAddress = buyerAddress || [cust.address, cust.state].filter(Boolean).join(', ');
    }
  }

  const order = await prisma.directSale.create({
    data: {
      date: b.date ? new Date(b.date) : new Date(),
      customerId: b.customerId || null,
      buyerName,
      buyerPhone,
      buyerAddress,
      productName: b.productName,
      rate: parseFloat(b.rate) || 0,
      unit: b.unit || 'KG',
      quantity: parseFloat(b.quantity) || 0,
      validFrom: b.validFrom ? new Date(b.validFrom) : new Date(),
      validTo: b.validTo ? new Date(b.validTo) : null,
      status: 'ACTIVE',
      remarks: b.remarks || null,
      userId: req.user!.id,
      companyId: getActiveCompanyId(req),
    },
  });

  res.status(201).json(order);
}));

// PUT /:id — update order
router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const data: any = {};
  if (b.customerId !== undefined) data.customerId = b.customerId || null;
  if (b.buyerName !== undefined) data.buyerName = b.buyerName;
  if (b.buyerPhone !== undefined) data.buyerPhone = b.buyerPhone;
  if (b.buyerAddress !== undefined) data.buyerAddress = b.buyerAddress;
  if (b.productName !== undefined) data.productName = b.productName;
  if (b.rate !== undefined) data.rate = parseFloat(b.rate) || 0;
  if (b.unit !== undefined) data.unit = b.unit;
  if (b.quantity !== undefined) data.quantity = parseFloat(b.quantity) || 0;
  if (b.validFrom !== undefined) data.validFrom = new Date(b.validFrom);
  if (b.validTo !== undefined) data.validTo = b.validTo ? new Date(b.validTo) : null;
  if (b.status !== undefined) data.status = b.status;
  if (b.remarks !== undefined) data.remarks = b.remarks;

  const order = await prisma.directSale.update({
    where: { id: req.params.id },
    data,
  });
  res.json(order);
}));

// ══════════════════════════════════════════════════════════════════
//  DOCUMENT GENERATION — Invoice (with % split), IRN, EWB, Challan, Gate Pass
// ══════════════════════════════════════════════════════════════════

// POST /:orderId/shipments/:shipmentId/create-invoice — Create invoice with optional split
router.post('/:orderId/shipments/:shipmentId/create-invoice', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { orderId, shipmentId } = req.params;
  const invoicePercent = Math.max(0, Math.min(100, parseFloat(req.body.invoicePercent) || 100));

  const order = await prisma.directSale.findUnique({
    where: { id: orderId },
    include: { customer: { select: { id: true, name: true, gstNo: true, state: true, address: true, city: true, pincode: true, phone: true, email: true } } },
  });
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const shipment = await prisma.shipment.findFirst({
    where: { id: shipmentId, directSaleId: orderId },
  });
  if (!shipment) return res.status(404).json({ error: 'Shipment not found for this order' });

  // Check if invoice already exists for this shipment
  const existing = await prisma.invoice.findFirst({ where: { shipmentId } });
  if (existing) return res.status(400).json({ error: 'Invoice already exists for this dispatch' });

  // Also check if cash voucher already exists for 0% invoice case
  if (invoicePercent === 0) {
    const existingCv = await prisma.cashVoucher.findFirst({ where: { linkedInvoiceId: shipmentId } });
    if (existingCv) return res.status(400).json({ error: 'Cash voucher already created for this dispatch' });
  }

  const netKg = shipment.weightNet || 0;
  if (netKg <= 0) return res.status(400).json({ error: 'Shipment has no net weight' });

  // Auto-create customer if not linked (scrap buyers are often walk-ins)
  let customerId = order.customerId;
  if (!customerId) {
    const existing = await prisma.customer.findFirst({
      where: { name: order.buyerName },
      select: { id: true },
    });
    if (existing) {
      customerId = existing.id;
    } else {
      const newCust = await prisma.customer.create({
        data: {
          name: order.buyerName,
          phone: order.buyerPhone,
          address: order.buyerAddress,
          remarks: 'Auto-created from scrap sales order',
        },
      });
      customerId = newCust.id;
    }
    // Link back to the order for future dispatches
    await prisma.directSale.update({ where: { id: orderId }, data: { customerId } });
  }

  // Rate is provided at invoice time (scrap prices fluctuate)
  const rate = parseFloat(req.body.rate);
  if (!rate || rate <= 0) return res.status(400).json({ error: 'Rate is required' });

  const totalAmount = netKg * rate;
  const hsnCode = HSN_MAP[order.productName] || HSN_MAP['Other'];
  const gstPercent = parseFloat(req.body.gstPercent) || DEFAULT_GST_PCT;
  const customerState = order.customer?.state || null;
  const customerGstin = order.customer?.gstNo || null;

  let invoice: any = null;
  let cashVoucher: any = null;

  if (invoicePercent > 0) {
    const invAmount = Math.round(totalAmount * invoicePercent / 100 * 100) / 100;
    const invQty = Math.round(netKg * invoicePercent / 100 * 100) / 100;
    const gst = calcGstSplit(invAmount, gstPercent, customerState, customerGstin);
    // TCS @ 2% u/s 206C(1) on scrap sales (mandatory from 01-Apr-2026)
    const TCS_PERCENT = 2;
    const tcsAmount = Math.round(invAmount * TCS_PERCENT / 100 * 100) / 100;
    const invTotal = Math.round((invAmount + gst.gstAmount + tcsAmount) * 100) / 100;

    invoice = await prisma.$transaction(async (tx) => {
      const customInvNo = await nextInvoiceNo(tx, 'ETH');

      const inv = await tx.invoice.create({
        data: {
          customerId: customerId!,
          invoiceDate: shipment.date,
          shipmentId: shipment.id,
          productName: order.productName,
          quantity: invQty,
          unit: order.unit,
          rate,
          amount: invAmount,
          gstPercent,
          gstAmount: gst.gstAmount,
          supplyType: gst.supplyType,
          cgstPercent: gst.cgstPercent,
          cgstAmount: gst.cgstAmount,
          sgstPercent: gst.sgstPercent,
          sgstAmount: gst.sgstAmount,
          igstPercent: gst.igstPercent,
          igstAmount: gst.igstAmount,
          tcsPercent: TCS_PERCENT,
          tcsAmount,
          tcsSection: '206C(1)',
          totalAmount: invTotal,
          balanceAmount: invTotal,
          status: 'UNPAID',
          remarks: customInvNo,
          userId: req.user!.id,
          division: 'ETHANOL',
        },
      });

      return inv;
    });

    // Auto-journal (fire-and-forget)
    onSaleInvoiceCreated(prisma, {
      id: invoice.id, invoiceNo: invoice.invoiceNo, totalAmount: invoice.totalAmount,
      amount: invoice.amount, gstAmount: invoice.gstAmount, gstPercent,
      cgstAmount: invoice.cgstAmount, sgstAmount: invoice.sgstAmount, igstAmount: invoice.igstAmount,
      supplyType: invoice.supplyType, productName: order.productName,
      customerId: order.customerId || '', userId: req.user!.id,
      invoiceDate: shipment.date, customer: { state: customerState },
    });
  }

  // Create cash voucher for remaining %
  if (invoicePercent < 100) {
    const cashPercent = 100 - invoicePercent;
    const cashAmount = Math.round(totalAmount * cashPercent / 100 * 100) / 100;

    cashVoucher = await prisma.cashVoucher.create({
      data: {
        date: shipment.date,
        type: 'RECEIPT',
        payeeName: order.buyerName,
        payeePhone: order.buyerPhone,
        purpose: `Scrap sale cash (${cashPercent}%) - ${order.productName} - Order #${order.entryNo} - shipment:${shipmentId}`,
        category: 'MISC',
        amount: cashAmount,
        paymentMode: 'CASH',
        authorizedBy: req.user!.name || req.user!.id,
        status: 'ACTIVE',
        linkedInvoiceId: invoice?.id || shipmentId, // link to invoice or shipment for 0% case
        userId: req.user!.id,
        division: 'ETHANOL',
      },
    });
  }

  res.json({
    invoice: invoice ? { id: invoice.id, invoiceNo: invoice.invoiceNo, totalAmount: invoice.totalAmount } : null,
    cashVoucher: cashVoucher ? { id: cashVoucher.id, voucherNo: cashVoucher.voucherNo, amount: cashVoucher.amount } : null,
    invoicePercent,
  });
}));

// POST /:orderId/shipments/:shipmentId/e-invoice — Generate IRN + EWB
router.post('/:orderId/shipments/:shipmentId/e-invoice', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { shipmentId } = req.params;

  const shipment = await prisma.shipment.findFirst({
    where: { id: shipmentId, directSaleId: req.params.orderId },
  });
  if (!shipment) return res.status(404).json({ error: 'Shipment not found' });

  const invoice = await prisma.invoice.findFirst({
    where: { shipmentId },
    include: { customer: true },
  });
  if (!invoice) return res.status(400).json({ error: 'Create an invoice for this dispatch first.' });
  if (!shipment.vehicleNo?.trim()) return res.status(400).json({ error: 'Vehicle number is required for e-invoice.' });
  if (!invoice.rate || invoice.rate <= 0) return res.status(400).json({ error: 'Invoice rate is zero.' });

  const irnAlreadyExists = !!invoice.irn;
  if (irnAlreadyExists && invoice.ewbNo) {
    return res.status(400).json({ error: 'Both IRN and E-Way Bill already generated.' });
  }

  const customer = invoice.customer;
  const missingFields: string[] = [];
  if (!customer.gstNo) missingFields.push('GSTIN');
  if (!customer.state) missingFields.push('State');
  if (!customer.pincode) missingFields.push('Pincode');
  if (!customer.address) missingFields.push('Address');
  if (missingFields.length > 0) {
    return res.status(400).json({ error: `Customer "${customer.name}" is missing: ${missingFields.join(', ')}. Update customer record first.`, missingFields });
  }

  // ── STEP 1: Generate IRN ──
  let irn = invoice.irn;
  let ackNo = invoice.ackNo;

  if (!irnAlreadyExists) {
    const hsnCode = HSN_MAP[invoice.productName] || HSN_MAP['Other'];
    const invoiceData = {
      invoiceNo: invoice.remarks || `INV-${invoice.invoiceNo}`,
      invoiceDate: invoice.invoiceDate,
      productName: invoice.productName,
      hsnCode,
      quantity: invoice.quantity,
      unit: invoice.unit === 'KG' ? 'KGS' : invoice.unit,
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
    if (!irnResult.success) {
      return res.status(400).json({ error: irnResult.error, step: 'e-invoice', rawResponse: (irnResult as any).rawResponse });
    }

    irn = irnResult.irn || null;
    ackNo = irnResult.ackNo ? String(irnResult.ackNo) : null;

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        irn,
        irnDate: new Date(),
        irnStatus: 'GENERATED',
        ackNo,
        signedQRCode: irnResult.signedQRCode ? irnResult.signedQRCode.slice(0, 4000) : null,
      } as any,
    });
  }

  if (!irn) return res.status(500).json({ error: 'IRN not available for EWB generation' });

  // ── STEP 2: Generate E-Way Bill from IRN ──
  let ewayBillNo: string | null = null;
  let ewayBillDate: string | null = null;
  let ewbError: string | null = null;

  try {
    const distanceKm = req.body.distanceKm ? parseInt(req.body.distanceKm) : 100;
    const vehNo = (shipment.vehicleNo || '').replace(/\s/g, '');
    const transporterGstin = req.body.transporterGstin || '';
    const transporterName = shipment.transporterName || '';

    const ewbData: Record<string, any> = {
      Irn: irn,
      Distance: distanceKm,
      TransMode: '1',
      VehNo: vehNo,
      VehType: 'R',
    };
    if (transporterGstin && transporterGstin.length === 15) ewbData.TransId = transporterGstin;
    if (transporterName && transporterName.length >= 3) ewbData.TransName = transporterName;

    const ewbResult = await generateEWBByIRN(irn, ewbData);

    if (ewbResult.success && ewbResult.ewayBillNo) {
      ewayBillNo = ewbResult.ewayBillNo;
      ewayBillDate = ewbResult.ewayBillDate || new Date().toISOString();

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          ewbNo: ewayBillNo,
          ewbDate: ewayBillDate ? new Date(ewayBillDate) : new Date(),
          ewbValidTill: ewbResult.validUpto ? new Date(ewbResult.validUpto) : null,
          ewbStatus: 'GENERATED',
        } as any,
      });
      // Mark shipment as DELIVERED once EWB is generated
      await prisma.shipment.update({ where: { id: shipmentId }, data: { status: 'DELIVERED' } });
    } else {
      ewbError = ewbResult.error || 'E-Way Bill generation failed';
    }
  } catch (err: any) {
    ewbError = err.message || 'E-Way Bill generation error';
  }

  res.json({
    success: true,
    irn,
    ackNo,
    invoiceNo: invoice.remarks || `INV-${invoice.invoiceNo}`,
    ewayBillNo,
    ewayBillDate,
    ewbError,
    message: ewayBillNo
      ? 'e-Invoice and E-Way Bill generated successfully'
      : `e-Invoice generated (IRN: ${irn}). E-Way Bill failed: ${ewbError}`,
  });
}));

// PATCH /:orderId/shipments/:shipmentId/manual-ewb — Manual EWB number + optional PDF
router.patch('/:orderId/shipments/:shipmentId/manual-ewb', upload.single('ewbPdf'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { ewbNo } = req.body;
  if (!ewbNo?.trim()) return res.status(400).json({ error: 'EWB number is required' });

  const invoice = await prisma.invoice.findFirst({
    where: { shipmentId: req.params.shipmentId },
    select: { id: true },
  });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found for this shipment' });

  const data: any = { ewbNo: ewbNo.trim(), ewbDate: new Date(), ewbStatus: 'GENERATED' };
  if (req.file?.buffer) data.ewbPdfData = req.file.buffer;

  await prisma.invoice.update({ where: { id: invoice.id }, data });
  // Mark shipment as DELIVERED once EWB is set
  await prisma.shipment.update({ where: { id: req.params.shipmentId }, data: { status: 'DELIVERED' } });
  res.json({ success: true, ewbNo: ewbNo.trim(), hasPdf: !!req.file });
}));

// GET /:orderId/shipments/:shipmentId/challan-pdf — Delivery Challan
router.get('/:orderId/shipments/:shipmentId/challan-pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
  const order = await prisma.directSale.findUnique({
    where: { id: req.params.orderId },
    include: { customer: { select: { name: true, gstNo: true, address: true, city: true, state: true, pincode: true, phone: true } } },
  });
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const shipment = await prisma.shipment.findFirst({
    where: { id: req.params.shipmentId, directSaleId: req.params.orderId },
  });
  if (!shipment) return res.status(404).json({ error: 'Shipment not found' });

  // Get rate from linked invoice if exists, otherwise from order
  const linkedInvoice = await prisma.invoice.findFirst({
    where: { shipmentId: shipment.id },
    select: { rate: true, gstPercent: true, remarks: true, invoiceNo: true, ewbNo: true },
  });
  const netKg = shipment.weightNet || 0;
  const rate = linkedInvoice?.rate || order.rate || 0;
  const amount = Math.round(netKg * rate);
  const gstRate = linkedInvoice?.gstPercent || DEFAULT_GST_PCT;
  const gstAmount = Math.round(amount * gstRate / 100);
  const hsnCode = HSN_MAP[order.productName] || HSN_MAP['Other'];
  const cust = order.customer;

  const { renderDocumentPdf } = await import('../services/documentRenderer');
  const pdfBuffer = await renderDocumentPdf({
    docType: 'CHALLAN',
    data: {
      challanNo: `SC/${shipment.shipmentNo}`,
      date: shipment.date,
      vehicleNo: shipment.vehicleNo,
      driverName: shipment.driverName,
      driverPhone: shipment.driverMobile,
      driverMobile: shipment.driverMobile,
      transporterName: shipment.transporterName,
      destination: shipment.destination,
      invoiceNo: linkedInvoice?.remarks || (linkedInvoice ? `INV-${linkedInvoice.invoiceNo}` : ''),
      ewayBillNo: linkedInvoice?.ewbNo || '',
      customer: {
        name: cust?.name || order.buyerName,
        address: cust?.address || order.buyerAddress || '',
        city: cust?.city || '',
        state: cust?.state || '',
        pincode: cust?.pincode || '',
        gstNo: cust?.gstNo || '',
        phone: cust?.phone || order.buyerPhone || '',
      },
      buyerName: cust?.name || order.buyerName,
      buyerAddress: cust?.address || order.buyerAddress || '',
      buyerGst: cust?.gstNo || '',
      contractNo: `Order #${order.entryNo}`,
      productName: order.productName,
      hsnCode,
      quantity: netKg,
      unit: order.unit,
      rate: null,
      amount: null,
      gstRate: null,
      gstAmount: null,
      totalValue: null,
      bags: shipment.bags,
      weightGross: shipment.weightGross,
      weightTare: shipment.weightTare,
      weightNet: netKg,
    },
    verifyId: shipment.id,
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Challan-Scrap-${shipment.vehicleNo}.pdf"`);
  res.send(pdfBuffer);
}));

// GET /:orderId/shipments/:shipmentId/gate-pass-pdf — Gate Pass
router.get('/:orderId/shipments/:shipmentId/gate-pass-pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
  const order2 = await prisma.directSale.findUnique({
    where: { id: req.params.orderId },
    include: { customer: { select: { name: true, gstNo: true, address: true, city: true, state: true, pincode: true, phone: true } } },
  });
  if (!order2) return res.status(404).json({ error: 'Order not found' });

  const shipment2 = await prisma.shipment.findFirst({
    where: { id: req.params.shipmentId, directSaleId: req.params.orderId },
  });
  if (!shipment2) return res.status(404).json({ error: 'Shipment not found' });

  const gpInvoice = await prisma.invoice.findFirst({
    where: { shipmentId: shipment2.id },
    select: { invoiceNo: true, ewbNo: true, remarks: true, rate: true },
  });

  const gpNetKg = shipment2.weightNet || 0;
  const gpRate = gpInvoice?.rate || order2.rate || 0;
  const gpAmount = Math.round(gpNetKg * gpRate);
  const gpHsnCode = HSN_MAP[order2.productName] || HSN_MAP['Other'];
  const gpCust = order2.customer;

  const { renderDocumentPdf: renderGP } = await import('../services/documentRenderer');
  const pdfBuffer = await renderGP({
    docType: 'GATE_PASS',
    data: {
      gatePassNo: `GP/SC/${shipment2.shipmentNo}`,
      date: shipment2.date,
      vehicleNo: shipment2.vehicleNo,
      driverName: shipment2.driverName,
      driverMobile: shipment2.driverMobile,
      transporterName: shipment2.transporterName,
      destination: shipment2.destination || gpCust?.city || gpCust?.state || '',
      ewayBillNo: gpInvoice?.ewbNo || '',
      invoiceNo: gpInvoice?.remarks || (gpInvoice ? `INV-${gpInvoice.invoiceNo}` : ''),
      partyName: gpCust?.name || order2.buyerName,
      partyAddress: gpCust?.address ? [gpCust.address, gpCust.city, gpCust.state, gpCust.pincode].filter(Boolean).join(', ') : (order2.buyerAddress || ''),
      partyGstin: gpCust?.gstNo || '',
      hsnCode: gpHsnCode,
      weightGross: shipment2.weightGross,
      weightTare: shipment2.weightTare,
      weightNet: gpNetKg,
      netMT: gpNetKg / 1000,
      bags: shipment2.bags,
      rate: gpRate,
      invoiceAmount: gpAmount,
    },
    verifyId: shipment2.id,
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="GatePass-Scrap-${shipment2.vehicleNo}.pdf"`);
  res.send(pdfBuffer);
}));

// GET /:orderId/shipments/:shipmentId/ewb-pdf — Generate proper E-Way Bill PDF
router.get('/:orderId/shipments/:shipmentId/ewb-pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
  const order = await prisma.directSale.findUnique({
    where: { id: req.params.orderId },
    include: { customer: { select: { name: true, gstNo: true, address: true, city: true, state: true, pincode: true } } },
  });
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const shipment = await prisma.shipment.findFirst({
    where: { id: req.params.shipmentId, directSaleId: req.params.orderId },
  });
  if (!shipment) return res.status(404).json({ error: 'Shipment not found' });

  const invoice = await prisma.invoice.findFirst({
    where: { shipmentId: shipment.id },
    select: {
      invoiceNo: true, remarks: true, invoiceDate: true,
      amount: true, gstAmount: true, gstPercent: true, totalAmount: true,
      supplyType: true, cgstPercent: true, cgstAmount: true, sgstPercent: true, sgstAmount: true,
      igstPercent: true, igstAmount: true,
      ewbNo: true, ewbDate: true, ewbValidTill: true, ewbPdfData: true,
      quantity: true, unit: true, rate: true, productName: true,
    },
  });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (!invoice.ewbNo) return res.status(400).json({ error: 'E-Way Bill not generated yet' });

  // If manually uploaded PDF exists, serve that
  if (invoice.ewbPdfData) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="EWB-${invoice.ewbNo}.pdf"`);
    res.send(invoice.ewbPdfData);
    return;
  }

  const cust = order.customer;
  const hsnCode = HSN_MAP[order.productName] || HSN_MAP['Other'];

  // Generate QR code for EWB
  const { generateQRCode } = await import('../services/templateEngine');
  const ewbQrContent = `https://ewaybillgst.gov.in/Others/EBPrint?ewbNo=${invoice.ewbNo}`;
  let ewbQrDataUrl: string | null = null;
  try { ewbQrDataUrl = await generateQRCode(ewbQrContent); } catch { /* ignore QR failures */ }

  const { renderDocumentPdf } = await import('../services/documentRenderer');
  const pdfBuffer = await renderDocumentPdf({
    docType: 'EWAY_BILL',
    data: {
      ewbNo: invoice.ewbNo,
      ewbDate: invoice.ewbDate,
      ewbValidTill: invoice.ewbValidTill,
      ewbQrDataUrl,
      sellerGstin: '23AAECM3666P1Z1',
      sellerName: 'Mahakaushal Sugar & Power Industries Ltd',
      sellerAddress: 'Village Bachai, Dist. Narsinghpur (M.P.) - 487001',
      sellerState: 'Madhya Pradesh',
      buyerGstin: cust?.gstNo || '',
      buyerName: cust?.name || order.buyerName,
      buyerAddress: cust?.address ? [cust.address, cust.city].filter(Boolean).join(', ') : (order.buyerAddress || ''),
      buyerState: cust?.state || '',
      buyerPincode: cust?.pincode || '',
      invoiceNo: invoice.remarks || `INV-${invoice.invoiceNo}`,
      invoiceDate: invoice.invoiceDate,
      hsnCode,
      productName: invoice.productName || order.productName,
      quantity: invoice.quantity,
      unit: invoice.unit,
      amount: invoice.amount,
      gstPercent: invoice.gstPercent,
      supplyType: invoice.supplyType,
      cgstPercent: invoice.cgstPercent || 0,
      cgstAmount: invoice.cgstAmount || 0,
      sgstPercent: invoice.sgstPercent || 0,
      sgstAmount: invoice.sgstAmount || 0,
      igstPercent: invoice.igstPercent || 0,
      igstAmount: invoice.igstAmount || 0,
      totalAmount: invoice.totalAmount,
      vehicleNo: shipment.vehicleNo,
      transporterName: shipment.transporterName || '',
      destination: shipment.destination || cust?.city || cust?.state || '',
      distanceKm: parseInt(req.query.distance as string) || 440,
      challanNo: `SC/${shipment.shipmentNo}`,
    },
    verifyId: shipment.id,
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="EWB-${invoice.ewbNo}.pdf"`);
  res.send(pdfBuffer);
}));

// DELETE /:id
router.delete('/:id', authorize('ADMIN') as any, asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.directSale.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

export default router;
