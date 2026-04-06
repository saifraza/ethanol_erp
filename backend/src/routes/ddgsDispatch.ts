import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { generateEwayBill, MSPIL } from '../services/ewayBill';
import { drawLetterhead } from '../utils/letterhead';
import { renderDocumentPdf } from '../services/documentRenderer';

const router = Router();
router.use(authenticate as any);

// ═══════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════

/** Indian Number to Words (up to 99,99,99,999) */
function amountInWords(n: number): string {
  if (n === 0) return 'Zero Only';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const twoDigit = (num: number): string => {
    if (num < 20) return ones[num];
    return tens[Math.floor(num / 10)] + (num % 10 ? ' ' + ones[num % 10] : '');
  };
  const rupees = Math.floor(n);
  const paise = Math.round((n - rupees) * 100);
  let words = '';
  if (rupees >= 10000000) { words += twoDigit(Math.floor(rupees / 10000000)) + ' Crore '; }
  const afterCrore = rupees % 10000000;
  if (afterCrore >= 100000) { words += twoDigit(Math.floor(afterCrore / 100000)) + ' Lakh '; }
  const afterLakh = afterCrore % 100000;
  if (afterLakh >= 1000) { words += twoDigit(Math.floor(afterLakh / 1000)) + ' Thousand '; }
  const afterThousand = afterLakh % 1000;
  if (afterThousand >= 100) { words += ones[Math.floor(afterThousand / 100)] + ' Hundred '; }
  const lastTwo = afterThousand % 100;
  if (lastTwo > 0) { if (words) words += 'and '; words += twoDigit(lastTwo) + ' '; }
  words = 'Indian Rupee ' + words.trim();
  if (paise > 0) words += ' and ' + twoDigit(paise) + ' Paise';
  return words + ' Only';
}

/** Format Indian currency */
function fmtINR(n: number): string {
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Determine if interstate (based on state code from GSTIN first 2 digits) */
function isInterstate(partyGstin: string | null): boolean {
  if (!partyGstin || partyGstin === 'URP' || partyGstin.length < 2) return false;
  const mspilStateCode = MSPIL.gstin.substring(0, 2); // 23 = MP
  const partyStateCode = partyGstin.substring(0, 2);
  return mspilStateCode !== partyStateCode;
}

/** State name from GSTIN state code */
function stateFromGstin(gstin: string | null): string {
  if (!gstin || gstin.length < 2) return '';
  const codes: Record<string, string> = {
    '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
    '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
    '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
    '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
    '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
    '24': 'Gujarat', '27': 'Maharashtra', '29': 'Karnataka', '32': 'Kerala',
    '33': 'Tamil Nadu', '36': 'Telangana', '37': 'Andhra Pradesh',
  };
  return codes[gstin.substring(0, 2)] || '';
}

const MSPIL_BANK = {
  name: 'State Bank of India',
  branch: 'NARSINGHPUR BRANCH',
  ifsc: 'SBIN0000636',
  account: '30613498188',
};

// letterhead is now imported from ../utils/letterhead

// ═══════════════════════════════════════════════
// GET /summary?date=YYYY-MM-DD
// ═══════════════════════════════════════════════
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const dateStr = req.query.date as string;
    if (!dateStr) { res.json({ totalNet: 0, truckCount: 0, totalBags: 0 }); return; }
    const dayStart = new Date(dateStr + 'T00:00:00.000Z');
    const dayEnd = new Date(dateStr + 'T23:59:59.999Z');
    const trucks = await prisma.dDGSDispatchTruck.findMany({
      where: { date: { gte: dayStart, lte: dayEnd } }, orderBy: { createdAt: 'desc' },
    });
    const totalNet = trucks.reduce((s: number, t: any) => s + t.weightNet, 0);
    const totalBags = trucks.reduce((s: number, t: any) => s + t.bags, 0);
    res.json({ totalNet, truckCount: trucks.length, totalBags });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════
// GET ?date=YYYY-MM-DD
// ═══════════════════════════════════════════════
router.get('/', async (req: Request, res: Response) => {
  try {
    const dateStr = req.query.date as string;
    let where: any = {};
    if (dateStr) {
      const dayStart = new Date(dateStr + 'T00:00:00.000Z');
      const dayEnd = new Date(dateStr + 'T23:59:59.999Z');
      where = { date: { gte: dayStart, lte: dayEnd } };
    }
    const trucks = await prisma.dDGSDispatchTruck.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
    res.json({ trucks });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════
// GET /history — past dispatches grouped by date
// ═══════════════════════════════════════════════
router.get('/history', async (req: Request, res: Response) => {
  try {
    const trucks = await prisma.dDGSDispatchTruck.findMany({
      orderBy: { date: 'desc' },
      take: 500,
      select: {
        id: true, date: true, rstNo: true, vehicleNo: true, partyName: true, destination: true,
        bags: true, weightNet: true, rate: true, invoiceAmount: true, invoiceNo: true,
        createdAt: true, status: true, weightGross: true, weightTare: true, weightPerBag: true,
        partyGstin: true, ewayBillNo: true, remarks: true,
      },
    });
    const history: Record<string, typeof trucks> = {};
    for (const t of trucks) {
      const key = new Date(t.date).toISOString().split('T')[0];
      if (!history[key]) history[key] = [];
      history[key].push(t);
    }
    // Remove today
    const today = new Date().toISOString().split('T')[0];
    delete history[today];
    res.json({ history });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════
// POST / — Gate In
// ═══════════════════════════════════════════════
router.post('/', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const bags = parseInt(b.bags) || 0;
    const weightPerBag = parseFloat(b.weightPerBag) || 50;
    const weightGross = parseFloat(b.weightGross) || 0;
    const weightTare = parseFloat(b.weightTare) || 0;
    const weightNet = weightGross > 0 && weightTare > 0 ? weightGross - weightTare : 0;

    let status = 'GATE_IN';
    const now = new Date();
    let tareTime: Date | null = null;
    let grossTime: Date | null = null;
    if (weightTare > 0 && weightGross > 0) { status = 'GROSS_WEIGHED'; tareTime = now; grossTime = now; }
    else if (weightTare > 0) { status = 'TARE_WEIGHED'; tareTime = now; }

    const truck = await prisma.dDGSDispatchTruck.create({
      data: {
        date: new Date(b.date || new Date()), status,
        rstNo: b.rstNo ? parseInt(b.rstNo) : null,
        vehicleNo: b.vehicleNo || '', partyName: b.partyName || '',
        partyAddress: b.partyAddress || null, partyGstin: b.partyGstin || null,
        destination: b.destination || '', driverName: b.driverName || null,
        driverMobile: b.driverMobile || null, transporterName: b.transporterName || null,
        bags, weightPerBag, weightGross, weightTare, weightNet,
        rate: b.rate ? parseFloat(b.rate) : null,
        hsnCode: b.hsnCode || '2303',
        gateInTime: now, tareTime, grossTime,
        remarks: b.remarks || null,
        contractId: b.contractId || null,
        customerId: b.customerId || null,
        userId: (req as any).user.id,
      }
    });
    res.status(201).json(truck);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════
// PUT /:id — Update truck
// ═══════════════════════════════════════════════
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const data: any = {};
    const strFields = ['status', 'vehicleNo', 'partyName', 'partyAddress', 'partyGstin',
      'destination', 'driverName', 'driverMobile', 'transporterName',
      'invoiceNo', 'gatePassNo', 'ewayBillNo', 'hsnCode', 'remarks'];
    strFields.forEach(f => { if (b[f] !== undefined) data[f] = b[f]; });
    const numFields = ['bags', 'weightPerBag', 'weightGross', 'weightTare', 'weightNet', 'rate', 'invoiceAmount'];
    numFields.forEach(f => { if (b[f] !== undefined) data[f] = parseFloat(b[f]) || 0; });
    ['gateInTime', 'tareTime', 'grossTime', 'releaseTime'].forEach(f => {
      if (b[f] !== undefined) data[f] = b[f] ? new Date(b[f]) : null;
    });
    if (data.weightGross !== undefined || data.weightTare !== undefined) {
      const existing = await prisma.dDGSDispatchTruck.findUnique({ where: { id: req.params.id } });
      if (existing) {
        const gross = data.weightGross ?? existing.weightGross;
        const tare = data.weightTare ?? existing.weightTare;
        if (gross > 0 && tare > 0) data.weightNet = gross - tare;
      }
    }
    const truck = await prisma.dDGSDispatchTruck.update({ where: { id: req.params.id }, data });
    res.json(truck);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════
// POST /:id/weigh
// ═══════════════════════════════════════════════
router.post('/:id/weigh', async (req: Request, res: Response) => {
  try {
    const { type, weight } = req.body;
    const w = parseFloat(weight);
    if (!w || !['tare', 'gross'].includes(type)) { res.status(400).json({ error: 'Invalid' }); return; }
    const truck = await prisma.dDGSDispatchTruck.findUnique({ where: { id: req.params.id } });
    if (!truck) { res.status(404).json({ error: 'Not found' }); return; }
    const now = new Date();
    const data: any = {};
    if (type === 'tare') {
      data.weightTare = w; data.tareTime = now; data.status = 'TARE_WEIGHED';
    } else {
      data.weightGross = w; data.grossTime = now; data.status = 'GROSS_WEIGHED';
      if (truck.weightTare > 0) data.weightNet = w - truck.weightTare;
    }
    const updated = await prisma.dDGSDispatchTruck.update({ where: { id: req.params.id }, data });
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════
// POST /:id/generate-bill
// ═══════════════════════════════════════════════
router.post('/:id/generate-bill', async (req: Request, res: Response) => {
  try {
    const truck = await prisma.dDGSDispatchTruck.findUnique({ where: { id: req.params.id } });
    if (!truck) { res.status(404).json({ error: 'Not found' }); return; }
    const { rate, invoiceNo } = req.body;
    const r = parseFloat(rate);
    if (!r) { res.status(400).json({ error: 'Rate required' }); return; }

    const netMT = truck.weightNet;
    const netKG = netMT * 1000;
    // Rate is per MT, amount = net MT × rate
    const taxableAmount = Math.round(netMT * r * 100) / 100;
    const interstate = isInterstate(truck.partyGstin);
    const gstRate = 5; // DDGS 5% GST
    const gstAmount = Math.round(taxableAmount * gstRate / 100 * 100) / 100;
    const totalAmount = Math.round((taxableAmount + gstAmount) * 100) / 100;

    const invNo = invoiceNo || `GST/25-26/${Date.now().toString().slice(-5)}`;

    const updated = await prisma.dDGSDispatchTruck.update({
      where: { id: req.params.id },
      data: {
        rate: r, invoiceNo: invNo, invoiceAmount: totalAmount,
        status: truck.status === 'GROSS_WEIGHED' ? 'BILLED' : truck.status,
      },
    });
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════
// POST /:id/confirm-payment
// ═══════════════════════════════════════════════
router.post('/:id/confirm-payment', async (req: Request, res: Response) => {
  try {
    const truck = await prisma.dDGSDispatchTruck.findUnique({ where: { id: req.params.id } });
    if (!truck) { res.status(404).json({ error: 'Not found' }); return; }
    const updated = await prisma.dDGSDispatchTruck.update({
      where: { id: req.params.id },
      data: { status: 'PAYMENT_CONFIRMED' },
    });
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════
// POST /:id/release
// ═══════════════════════════════════════════════
router.post('/:id/release', async (req: Request, res: Response) => {
  try {
    const updated = await prisma.dDGSDispatchTruck.update({
      where: { id: req.params.id },
      data: { status: 'RELEASED', releaseTime: new Date() },
    });
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});


// ══════════════════════════════════════════════════════════════════════
//  INVOICE PDF — SAP Business One quality
// ══════════════════════════════════════════════════════════════════════
router.get('/:id/invoice-pdf', async (req: Request, res: Response) => {
  try {
    const truck = await prisma.dDGSDispatchTruck.findUnique({ where: { id: req.params.id } });
    if (!truck) { res.status(404).json({ error: 'Not found' }); return; }

    const interstate = isInterstate(truck.partyGstin);
    const netMT = truck.weightNet;
    const rate = truck.rate || 0;
    const taxableValue = Math.round(netMT * rate * 100) / 100;
    const gstRate = 5;
    const cgst = interstate ? 0 : Math.round(taxableValue * 2.5 / 100 * 100) / 100;
    const sgst = interstate ? 0 : Math.round(taxableValue * 2.5 / 100 * 100) / 100;
    const igst = interstate ? Math.round(taxableValue * 5 / 100 * 100) / 100 : 0;
    const grandTotal = Math.round((taxableValue + cgst + sgst + igst) * 100) / 100;

    const ddgsInvData = {
      invoiceNo: truck.invoiceNo,
      date: truck.date,
      vehicleNo: truck.vehicleNo,
      transporterName: truck.transporterName,
      partyName: truck.partyName,
      partyAddress: truck.partyAddress,
      partyGstin: truck.partyGstin,
      destination: truck.destination,
      isInterstate: interstate,
      hsnCode: truck.hsnCode,
      netMT,
      bags: truck.bags,
      rate,
      taxableValue,
      cgst,
      sgst,
      igst,
      grandTotal,
    };

    const pdfBuffer = await renderDocumentPdf({ docType: 'DDGS_INVOICE', data: ddgsInvData, verifyId: truck.id });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=Invoice-${truck.invoiceNo || truck.id.slice(0, 8)}.pdf`);
    res.send(pdfBuffer);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});


// ══════════════════════════════════════════════════════════════════════
//  GATE PASS CUM CHALLAN PDF — Professional grade
// ══════════════════════════════════════════════════════════════════════
router.get('/:id/gate-pass-pdf', async (req: Request, res: Response) => {
  try {
    const truck = await prisma.dDGSDispatchTruck.findUnique({ where: { id: req.params.id } });
    if (!truck) { res.status(404).json({ error: 'Not found' }); return; }

    const amt = truck.invoiceAmount || (truck.weightNet * (truck.rate || 0));

    const ddgsGpData = {
      gatePassNo: truck.gatePassNo || `GP/${new Date(truck.date).toISOString().slice(2, 10).replace(/-/g, '')}/${truck.vehicleNo.replace(/\s/g, '')}`,
      date: truck.date,
      vehicleNo: truck.vehicleNo,
      driverName: truck.driverName,
      driverMobile: truck.driverMobile,
      transporterName: truck.transporterName,
      ewayBillNo: truck.ewayBillNo,
      invoiceNo: truck.invoiceNo,
      partyName: truck.partyName,
      partyAddress: truck.partyAddress,
      partyGstin: truck.partyGstin,
      destination: truck.destination,
      hsnCode: truck.hsnCode,
      weightGross: truck.weightGross,
      weightTare: truck.weightTare,
      weightNet: truck.weightNet,
      netMT: truck.weightNet,
      bags: truck.bags,
      weightPerBag: truck.weightPerBag,
      bagTotal: (truck.bags * truck.weightPerBag) / 1000,
      rate: truck.rate,
      invoiceAmount: amt,
    };

    const pdfBuffer = await renderDocumentPdf({ docType: 'DDGS_GATE_PASS', data: ddgsGpData, verifyId: truck.id });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=GatePass-${truck.vehicleNo.replace(/\s/g, '')}.pdf`);
    res.send(pdfBuffer);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});


// ═══════════════════════════════════════════════
// POST /:id/eway-bill — Generate E-Way Bill
// ═══════════════════════════════════════════════
router.post('/:id/eway-bill', async (req: Request, res: Response) => {
  try {
    const truck = await prisma.dDGSDispatchTruck.findUnique({ where: { id: req.params.id } });
    if (!truck) { res.status(404).json({ error: 'Not found' }); return; }
    if (truck.ewayBillNo) { res.status(400).json({ error: `E-Way Bill already exists: ${truck.ewayBillNo}` }); return; }

    const taxableValue = truck.invoiceAmount || (truck.weightNet * (truck.rate || 0));
    const interstate = isInterstate(truck.partyGstin);
    const cgst = interstate ? 0 : 2.5;
    const sgst = interstate ? 0 : 2.5;
    const igst = interstate ? 5 : 0;

    const payload: any = {
      supplierGstin: MSPIL.gstin,
      supplierName: MSPIL.name,
      supplierAddress: MSPIL.address,
      supplierState: MSPIL.state,
      supplierPincode: MSPIL.pincode,
      recipientGstin: truck.partyGstin || 'URP',
      recipientName: truck.partyName,
      recipientAddress: truck.partyAddress || truck.destination,
      recipientState: req.body.recipientState || stateFromGstin(truck.partyGstin) || MSPIL.state,
      recipientPincode: req.body.recipientPincode || MSPIL.pincode,
      documentType: 'INV',
      documentNo: truck.invoiceNo || truck.id.slice(0, 8),
      documentDate: truck.date.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      items: [{
        productName: 'DDGS - Animal Feed Supplements',
        hsnCode: truck.hsnCode || '2303',
        quantity: truck.weightNet * 1000, // in KG
        unit: 'KGS',
        taxableValue,
        cgstRate: cgst,
        sgstRate: sgst,
        igstRate: igst,
      }],
      vehicleNo: truck.vehicleNo.replace(/\s/g, ''),
      vehicleType: 'R' as const,
      transportMode: '1' as const,
      transporterId: req.body.transporterGstin || '',
      transporterName: truck.transporterName || 'OWN TRANSPORT',
      distanceKm: parseInt(req.body.distance) || 100,
      supplyType: 'O' as const,
      subType: '1' as const,
    };

    const result = await generateEwayBill(payload);
    if (result.ewayBillNo) {
      await prisma.dDGSDispatchTruck.update({
        where: { id: req.params.id },
        data: { ewayBillNo: result.ewayBillNo },
      });
    }
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════
// DELETE /:id
// ═══════════════════════════════════════════════
router.delete('/:id', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  try {
    await prisma.dDGSDispatchTruck.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
