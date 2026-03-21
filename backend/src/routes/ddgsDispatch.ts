import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { generateEwayBill, MSPIL } from '../services/ewayBill';

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

const letterheadPath = path.resolve(__dirname, '../../../assets/letterhead_img_0.jpeg');
const hasLetterhead = fs.existsSync(letterheadPath);

function drawLetterhead(doc: PDFKit.PDFDocument, mL: number, cW: number) {
  const lf = 'Helvetica-Bold';
  const vf = 'Helvetica';
  if (hasLetterhead) {
    doc.image(letterheadPath, mL, 20, { width: cW, height: 75 });
    doc.y = 100;
  } else {
    doc.fontSize(13).font(lf).fillColor('#1a3a1a').text('Mahakaushal Sugar and Power Industries Ltd.', mL, 25, { align: 'center', width: cW });
    doc.fontSize(7).font(vf).fillColor('#555').text('Village Bachai, Tehsil Gadarwara, Dist. Narsinghpur, Madhya Pradesh - 487001', { align: 'center', width: cW });
    doc.fontSize(7).font(vf).fillColor('#555').text(`PAN: AAECM3666P  |  GSTIN: ${MSPIL.gstin}  |  CIN: U15412MP2007PLC019952`, { align: 'center', width: cW });
    doc.y = 72;
  }
}

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
        vehicleNo: b.vehicleNo || '', partyName: b.partyName || '',
        partyAddress: b.partyAddress || null, partyGstin: b.partyGstin || null,
        destination: b.destination || '', driverName: b.driverName || null,
        driverMobile: b.driverMobile || null, transporterName: b.transporterName || null,
        bags, weightPerBag, weightGross, weightTare, weightNet,
        rate: b.rate ? parseFloat(b.rate) : null,
        hsnCode: b.hsnCode || '2303',
        gateInTime: now, tareTime, grossTime,
        remarks: b.remarks || null,
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

    const doc = new PDFDocument({ size: 'A4', margins: { top: 20, bottom: 30, left: 35, right: 35 } });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=Invoice-${truck.invoiceNo || truck.id.slice(0, 8)}.pdf`);
    doc.pipe(res);

    const pageW = doc.page.width;
    const mL = 35;
    const mR = pageW - 35;
    const cW = mR - mL;
    const lf = 'Helvetica-Bold';
    const vf = 'Helvetica';
    const midX = mL + cW / 2;

    // ── Letterhead ──
    drawLetterhead(doc, mL, cW);

    // ── Tax Invoice title bar ──
    const titleY = doc.y;
    doc.rect(mL, titleY, cW, 20).fill('#1a3a1a');
    doc.fontSize(11).font(lf).fillColor('#ffffff').text('TAX INVOICE', mL, titleY + 4, { width: cW, align: 'center' });
    doc.y = titleY + 25;

    // ── Invoice Meta — two columns ──
    const metaY = doc.y;
    const lbl = (label: string, val: string, x: number, y: number, valW?: number) => {
      doc.fontSize(7.5).font(lf).fillColor('#555').text(label, x, y);
      doc.fontSize(8).font(vf).fillColor('#111').text(': ' + (val || '—'), x + 72, y, valW ? { width: valW } : undefined);
    };

    lbl('Invoice No.', truck.invoiceNo || '—', mL, metaY);
    lbl('Invoice Date', new Date(truck.date).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }), mL, metaY + 13);
    lbl('State', 'Madhya Pradesh', mL, metaY + 26);
    lbl('State Code', '23', mL, metaY + 39);
    lbl('Place of Supply', 'Madhya Pradesh', mL, metaY + 52);

    lbl('Transporter', truck.transporterName || 'OWN TRANSPORT', midX, metaY);
    lbl('Vehicle No.', truck.vehicleNo, midX, metaY + 13);
    lbl('LR No.', '—', midX, metaY + 26);
    lbl('LR Date', '—', midX, metaY + 39);

    doc.y = metaY + 68;

    // ── Thin line ──
    doc.moveTo(mL, doc.y).lineTo(mR, doc.y).lineWidth(0.5).strokeColor('#ccc').stroke();
    doc.y += 5;

    // ── Bill To / Ship To boxes ──
    const interstate = isInterstate(truck.partyGstin);
    const partyState = stateFromGstin(truck.partyGstin) || 'Madhya Pradesh';
    const partyStateCode = truck.partyGstin ? truck.partyGstin.substring(0, 2) : '23';

    const boxH = 72;
    const billY = doc.y;

    // Bill To
    doc.rect(mL, billY, cW / 2 - 3, boxH).lineWidth(0.5).strokeColor('#999').stroke();
    doc.fontSize(7).font(lf).fillColor('#1a3a1a').text('Details of Customer (Bill To)', mL + 5, billY + 3);
    doc.moveTo(mL, billY + 13).lineTo(mL + cW / 2 - 3, billY + 13).lineWidth(0.3).strokeColor('#ccc').stroke();
    let by = billY + 16;
    const billLbl = (l: string, v: string) => {
      doc.fontSize(7).font(lf).fillColor('#555').text(l, mL + 5, by);
      doc.fontSize(7.5).font(l === 'Name' ? lf : vf).fillColor('#111').text(': ' + v, mL + 55, by, { width: cW / 2 - 70 });
      by += (v.length > 45 ? 18 : 11);
    };
    billLbl('Name', truck.partyName || '—');
    billLbl('Address', truck.partyAddress || truck.destination || '—');
    billLbl('State', partyState);
    billLbl('State Code', partyStateCode);
    billLbl('GST No.', truck.partyGstin || '—');

    // Ship To
    const sx = midX + 3;
    doc.rect(sx, billY, cW / 2 - 3, boxH).lineWidth(0.5).strokeColor('#999').stroke();
    doc.fontSize(7).font(lf).fillColor('#1a3a1a').text('Details of Customer (Ship To)', sx + 5, billY + 3);
    doc.moveTo(sx, billY + 13).lineTo(mR, billY + 13).lineWidth(0.3).strokeColor('#ccc').stroke();
    by = billY + 16;
    const shipLbl = (l: string, v: string) => {
      doc.fontSize(7).font(l === 'Name' ? lf : vf).fillColor('#555').text(l, sx + 5, by);
      doc.fontSize(7.5).font(l === 'Name' ? lf : vf).fillColor('#111').text(': ' + v, sx + 55, by, { width: cW / 2 - 70 });
      by += (v.length > 45 ? 18 : 11);
    };
    shipLbl('Name', truck.partyName || '—');
    shipLbl('Address', truck.partyAddress || truck.destination || '—');
    shipLbl('State', partyState);
    shipLbl('State Code', partyStateCode);
    shipLbl('GST No.', truck.partyGstin || '—');

    doc.y = billY + boxH + 5;

    // ── Items Table ──
    const netMT = truck.weightNet;
    const netKG = netMT * 1000;
    const rate = truck.rate || 0;
    const taxableValue = Math.round(netMT * rate * 100) / 100;
    const gstRate = 5;
    const cgstRate = interstate ? 0 : gstRate / 2;
    const sgstRate = interstate ? 0 : gstRate / 2;
    const igstRate = interstate ? gstRate : 0;
    const cgstAmt = Math.round(taxableValue * cgstRate / 100 * 100) / 100;
    const sgstAmt = Math.round(taxableValue * sgstRate / 100 * 100) / 100;
    const igstAmt = Math.round(taxableValue * igstRate / 100 * 100) / 100;
    const totalGST = cgstAmt + sgstAmt + igstAmt;
    const totalAmount = Math.round((taxableValue + totalGST) * 100) / 100;

    const tY = doc.y;
    // Header
    const tblCols = interstate
      ? [25, 140, 55, 50, 30, 50, 5, 60, 45, 55]  // with IGST
      : [25, 120, 55, 50, 30, 50, 5, 60, 30, 30, 60]; // with CGST+SGST

    if (interstate) {
      // Sr, Description, HSN, Qty, UOM, Rate, Disc%, Taxable, IGST %, IGST Amt, Total
      const hdrs = ['Sr.', 'Description of Goods/Services', 'HSN/SAC', 'Quantity', 'UOM', 'Rate', 'Disc%', 'Taxable Value', 'IGST %', 'IGST Amt', 'Total Amount'];
      // Actually let me use a consistent approach
    }

    // Use a unified table approach
    const cols = [22, 115, 52, 50, 28, 48, 28, 55, 0, 0, 0, 60];
    // Dynamic tax columns based on interstate
    let taxCols: { hdr: string; w: number; val: string }[];
    if (interstate) {
      taxCols = [
        { hdr: 'IGST\nRate %', w: 35, val: `${igstRate.toFixed(2)}` },
        { hdr: 'IGST\nAmt', w: 50, val: igstAmt.toFixed(2) },
      ];
    } else {
      taxCols = [
        { hdr: 'CGST\n%', w: 24, val: `${cgstRate.toFixed(2)}` },
        { hdr: 'CGST\nAmt', w: 38, val: cgstAmt.toFixed(2) },
        { hdr: 'SGST\n%', w: 24, val: `${sgstRate.toFixed(2)}` },
        { hdr: 'SGST\nAmt', w: 38, val: sgstAmt.toFixed(2) },
      ];
    }

    const fixedCols = [
      { hdr: 'Sr.\nNo.', w: 20, align: 'left' as const },
      { hdr: 'Description of Goods/Services', w: interstate ? 105 : 82, align: 'left' as const },
      { hdr: 'HSN/SAC\nCode', w: 48, align: 'left' as const },
      { hdr: 'Quantity', w: 45, align: 'right' as const },
      { hdr: 'UOM', w: 22, align: 'left' as const },
      { hdr: 'Rate [INR]', w: 42, align: 'right' as const },
      { hdr: 'Disc\n%', w: 22, align: 'right' as const },
      { hdr: 'Taxable Value\n[INR]', w: 52, align: 'right' as const },
    ];
    const totalCol = { hdr: 'Total\nAmount', w: 58, align: 'right' as const };

    const allCols = [...fixedCols, ...taxCols.map(tc => ({ hdr: tc.hdr, w: tc.w, align: 'right' as const })), totalCol];

    // Table header
    doc.rect(mL, tY, cW, 22).lineWidth(0.5).strokeColor('#999').fillAndStroke('#e8e8e8', '#999');
    let cx = mL + 2;
    allCols.forEach(c => {
      doc.fontSize(6).font(lf).fillColor('#333').text(c.hdr, cx, tY + 3, { width: c.w, align: c.align === 'right' ? 'right' : 'left' });
      cx += c.w;
    });

    // Item row
    const rY = tY + 24;
    doc.rect(mL, rY, cW, 16).lineWidth(0.3).strokeColor('#ccc').stroke();
    cx = mL + 2;
    const itemVals = [
      '1', 'DDGS - Animal Feed Supplements', truck.hsnCode ? truck.hsnCode + '.30.00' : '2303.30.00',
      netKG.toFixed(2), 'KG', rate.toFixed(2), '0.00', taxableValue.toFixed(2),
      ...taxCols.map(tc => tc.val),
      totalAmount.toFixed(2),
    ];
    allCols.forEach((c, i) => {
      doc.fontSize(7).font(vf).fillColor('#111').text(itemVals[i] || '', cx, rY + 4, { width: c.w, align: c.align === 'right' ? 'right' : 'left' });
      cx += c.w;
    });

    // Empty rows for SAP look (just lines)
    let emptyY = rY + 18;
    for (let i = 0; i < 4; i++) {
      doc.rect(mL, emptyY, cW, 14).lineWidth(0.2).strokeColor('#e0e0e0').stroke();
      emptyY += 14;
    }

    // Total row
    doc.rect(mL, emptyY, cW, 16).lineWidth(0.5).strokeColor('#999').fillAndStroke('#f0f0f0', '#999');
    cx = mL + 2;
    const totVals = ['', 'Total', '', netKG.toFixed(2), '', '', '', taxableValue.toFixed(2),
      ...taxCols.map(tc => tc.val), totalAmount.toFixed(2)];
    allCols.forEach((c, i) => {
      doc.fontSize(7).font(lf).fillColor('#111').text(totVals[i] || '', cx, emptyY + 4, { width: c.w, align: c.align === 'right' ? 'right' : 'left' });
      cx += c.w;
    });
    doc.y = emptyY + 22;

    // ── Remarks ──
    doc.rect(mL, doc.y, cW * 0.55, 14).lineWidth(0.3).strokeColor('#ccc').stroke();
    doc.fontSize(7).font(lf).fillColor('#555').text('Remarks :', mL + 3, doc.y + 3);
    doc.fontSize(7).font(vf).fillColor('#111').text('Based on Weigh Bridge Net: ' + netMT.toFixed(3) + ' MT', mL + 50, doc.y + 3);

    // ── Tax Summary (right side) ──
    const sumX = mL + cW * 0.55 + 2;
    const sumW = cW * 0.45 - 2;
    let sumY = doc.y;
    const sumRow = (label: string, val: string, bold = false) => {
      doc.rect(sumX, sumY, sumW, 14).lineWidth(0.3).strokeColor('#ccc').stroke();
      doc.fontSize(7).font(bold ? lf : vf).fillColor('#111').text(label, sumX + 3, sumY + 3, { width: sumW * 0.55 });
      doc.fontSize(7).font(bold ? lf : vf).fillColor('#111').text(val, sumX + sumW * 0.55, sumY + 3, { width: sumW * 0.43, align: 'right' });
      sumY += 14;
    };
    sumRow('Total Amount Before Tax', taxableValue.toFixed(2));
    if (interstate) {
      sumRow('Add : IGST', igstAmt.toFixed(2));
    } else {
      sumRow('Add : CGST', cgstAmt.toFixed(2));
      sumRow('Add : SGST', sgstAmt.toFixed(2));
    }
    sumRow('Total GST', totalGST.toFixed(2), true);
    // Rounding
    const rounded = Math.round(totalAmount);
    const rounding = rounded - totalAmount;
    sumRow('Rounding', rounding.toFixed(2));
    sumRow('Total Amount', rounded.toFixed(2), true);

    doc.y = sumY + 5;

    // ── Amount in Words ──
    doc.rect(mL, doc.y, cW, 16).lineWidth(0.3).strokeColor('#ccc').stroke();
    doc.fontSize(7).font(lf).fillColor('#555').text('Amount In Words', mL + 3, doc.y + 2);
    doc.fontSize(7).font(vf).fillColor('#111').text(': ' + amountInWords(rounded), mL + 75, doc.y + 2, { width: cW - 80 });
    doc.y += 18;

    // ── Payment Terms ──
    doc.rect(mL, doc.y, cW, 14).lineWidth(0.3).strokeColor('#ccc').fillAndStroke('#f5f5f5', '#ccc');
    doc.fontSize(7).font(lf).fillColor('#555').text('Payment Terms', mL + 3, doc.y + 3);
    doc.fontSize(7).font(lf).fillColor('#111').text(': ADVANCE PAYMENT', mL + 75, doc.y + 3);
    doc.y += 18;

    // ── Bank Details + Signature ──
    const bankY = doc.y;
    const bankW = cW * 0.55;
    doc.rect(mL, bankY, bankW, 72).lineWidth(0.3).strokeColor('#ccc').stroke();
    doc.fontSize(7).font(lf).fillColor('#555').text('Our Bank Details :', mL + 3, bankY + 3);
    let bby = bankY + 15;
    const bankRow = (l: string, v: string) => {
      doc.fontSize(7).font(vf).fillColor('#555').text(l, mL + 5, bby);
      doc.fontSize(7).font(vf).fillColor('#111').text(': ' + v, mL + 70, bby);
      bby += 11;
    };
    bankRow('Bank Name', MSPIL_BANK.name);
    bankRow('IFSC No.', MSPIL_BANK.ifsc);
    bankRow('A/C No.', MSPIL_BANK.account);
    bankRow('Branch', MSPIL_BANK.branch);
    bankRow('Payment Due', new Date(truck.date).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }));

    // Signature area (right side)
    const sigX = mL + bankW + 2;
    const sigW2 = cW - bankW - 2;
    doc.rect(sigX, bankY, sigW2, 72).lineWidth(0.3).strokeColor('#ccc').stroke();
    doc.fontSize(7.5).font(vf).fillColor('#555').text('For, Mahakaushal Sugar and Power', sigX + 5, bankY + 5, { width: sigW2 - 10, align: 'right' });
    doc.fontSize(7.5).font(lf).fillColor('#555').text('Industries Ltd.', sigX + 5, bankY + 15, { width: sigW2 - 10, align: 'right' });
    doc.moveTo(sigX + 15, bankY + 55).lineTo(sigX + sigW2 - 15, bankY + 55).lineWidth(0.3).strokeColor('#ccc').stroke();
    doc.fontSize(7).font(vf).fillColor('#888').text('Authorised Signatory', sigX + 5, bankY + 58, { width: sigW2 - 10, align: 'right' });

    doc.y = bankY + 80;

    // ── Footer signatures ──
    const footY = doc.y;
    doc.moveTo(mL, footY).lineTo(mR, footY).lineWidth(0.3).strokeColor('#ccc').stroke();
    const fSigW = cW / 3;
    ['Prepared by:', 'Checked By & Date', 'Received By'].forEach((label, i) => {
      const fx = mL + i * fSigW;
      doc.fontSize(7).font(vf).fillColor('#888').text(label, fx + 5, footY + 4);
      doc.moveTo(fx + 5, footY + 28).lineTo(fx + fSigW - 10, footY + 28).lineWidth(0.2).strokeColor('#ddd').stroke();
    });

    // ── Bottom line ──
    doc.y = footY + 38;
    doc.moveTo(mL, doc.y).lineTo(mR, doc.y).lineWidth(0.5).strokeColor('#999').stroke();
    doc.fontSize(6).font(vf).fillColor('#aaa').text('Printed by Distillery ERP', mL, doc.y + 3, { width: cW, align: 'right' });

    doc.end();
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});


// ══════════════════════════════════════════════════════════════════════
//  GATE PASS CUM CHALLAN PDF — Professional grade
// ══════════════════════════════════════════════════════════════════════
router.get('/:id/gate-pass-pdf', async (req: Request, res: Response) => {
  try {
    const truck = await prisma.dDGSDispatchTruck.findUnique({ where: { id: req.params.id } });
    if (!truck) { res.status(404).json({ error: 'Not found' }); return; }

    const doc = new PDFDocument({ size: 'A4', margins: { top: 20, bottom: 30, left: 35, right: 35 } });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=GatePass-${truck.vehicleNo.replace(/\s/g, '')}.pdf`);
    doc.pipe(res);

    const pageW = doc.page.width;
    const mL = 35;
    const mR = pageW - 35;
    const cW = mR - mL;
    const lf = 'Helvetica-Bold';
    const vf = 'Helvetica';
    const midX = mL + cW / 2;

    // ── Letterhead ──
    drawLetterhead(doc, mL, cW);

    // ── Title bar ──
    const titleY = doc.y;
    doc.rect(mL, titleY, cW, 22).fill('#2d5a27');
    doc.fontSize(11).font(lf).fillColor('#fff').text('GATE PASS CUM CHALLAN', mL + 10, titleY + 5);
    doc.fontSize(9).font(lf).fillColor('#ffe082').text('NON-RETURNABLE (SALE)', mL + 10, titleY + 5, { width: cW - 20, align: 'right' });
    doc.y = titleY + 27;

    // ── GP Meta ──
    const gpNo = truck.gatePassNo || `GP/${new Date(truck.date).toISOString().slice(2, 10).replace(/-/g, '')}/${truck.vehicleNo.replace(/\s/g, '')}`;
    const metaY = doc.y;
    const gLbl = (label: string, val: string, x: number, y: number) => {
      doc.fontSize(7.5).font(lf).fillColor('#555').text(label, x, y);
      doc.fontSize(8).font(vf).fillColor('#111').text(': ' + (val || '—'), x + 75, y);
    };
    gLbl('Gate Pass No.', gpNo, mL, metaY);
    gLbl('Date', new Date(truck.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }), midX, metaY);
    gLbl('Vehicle No.', truck.vehicleNo, mL, metaY + 14);
    gLbl('Driver', truck.driverName || '—', midX, metaY + 14);
    gLbl('Driver Mobile', truck.driverMobile || '—', mL, metaY + 28);
    gLbl('Transporter', truck.transporterName || 'OWN TRANSPORT', midX, metaY + 28);
    if (truck.ewayBillNo) gLbl('E-Way Bill No.', truck.ewayBillNo, mL, metaY + 42);
    if (truck.invoiceNo) gLbl('Invoice No.', truck.invoiceNo, midX, metaY + 42);
    doc.y = metaY + (truck.ewayBillNo || truck.invoiceNo ? 58 : 44);

    // ── Party Box ──
    const pY = doc.y;
    doc.rect(mL, pY, cW, 50).lineWidth(0.8).strokeColor('#2d5a27').stroke();
    // Green label band
    doc.rect(mL, pY, cW, 13).fill('#2d5a27');
    doc.fontSize(7.5).font(lf).fillColor('#fff').text('PARTY / CONSIGNEE DETAILS', mL + 5, pY + 3);
    // Party info
    doc.fontSize(9.5).font(lf).fillColor('#111').text(truck.partyName || '—', mL + 8, pY + 17);
    doc.fontSize(7.5).font(vf).fillColor('#444').text(truck.partyAddress || truck.destination || '—', mL + 8, pY + 30, { width: cW / 2 - 15 });
    if (truck.partyGstin) {
      doc.fontSize(7.5).font(vf).fillColor('#444').text('GSTIN: ' + truck.partyGstin, midX + 10, pY + 17);
      const st = stateFromGstin(truck.partyGstin);
      if (st) doc.fontSize(7.5).font(vf).fillColor('#444').text('State: ' + st, midX + 10, pY + 30);
    }
    doc.y = pY + 55;

    // ── Items Table ──
    const tY = doc.y;
    const tCols = [22, 168, 55, 52, 52, 38, 62, 56];
    const tHdrs = ['Sr.', 'Description of Goods', 'HSN Code', 'Qty (KG)', 'Qty (MT)', 'Bags', 'Rate/MT', 'Value (₹)'];

    // Header
    doc.rect(mL, tY, cW, 18).fill('#2d5a27');
    let cx = mL + 3;
    tHdrs.forEach((h, i) => {
      doc.fontSize(6.5).font(lf).fillColor('#fff').text(h, cx, tY + 5, { width: tCols[i], align: i >= 3 ? 'right' : 'left' });
      cx += tCols[i];
    });

    // Data row
    const rY = tY + 20;
    const netKG = truck.weightNet * 1000;
    const amt = truck.invoiceAmount || (truck.weightNet * (truck.rate || 0));
    doc.rect(mL, rY, cW, 16).lineWidth(0.3).strokeColor('#ccc').stroke();
    cx = mL + 3;
    const vals = ['1', 'DDGS (Dried Distillers Grains with Solubles)', truck.hsnCode ? truck.hsnCode + '.30.00' : '2303.30.00',
      netKG.toFixed(2), truck.weightNet.toFixed(3), truck.bags.toString(),
      truck.rate ? fmtINR(truck.rate) : '—', amt > 0 ? fmtINR(amt) : '—'];
    vals.forEach((v, i) => {
      doc.fontSize(7).font(i === 0 ? lf : vf).fillColor('#111').text(v, cx, rY + 4, { width: tCols[i], align: i >= 3 ? 'right' : 'left' });
      cx += tCols[i];
    });

    // Empty rows
    let eY = rY + 18;
    for (let i = 0; i < 2; i++) {
      doc.rect(mL, eY, cW, 14).lineWidth(0.2).strokeColor('#e0e0e0').stroke();
      eY += 14;
    }

    // Total row
    if (amt > 0) {
      doc.rect(mL, eY, cW, 16).lineWidth(0.5).strokeColor('#2d5a27').fillAndStroke('#e8f5e8', '#2d5a27');
      doc.fontSize(8).font(lf).fillColor('#1a3a1a').text('TOTAL DECLARED VALUE', mL + 8, eY + 4);
      doc.text(fmtINR(amt), mL, eY + 4, { width: cW - 8, align: 'right' });
      eY += 20;
    }
    doc.y = eY + 5;

    // ── Weight Summary Box ──
    const wY = doc.y;
    doc.rect(mL, wY, cW, 52).lineWidth(0.5).strokeColor('#999').stroke();
    doc.rect(mL, wY, cW, 13).fill('#f5f5f5');
    doc.fontSize(7.5).font(lf).fillColor('#555').text('WEIGHT SUMMARY (Weigh Bridge)', mL + 5, wY + 3);

    const wRow = (label: string, val: string, x: number, y: number, bold = false) => {
      doc.fontSize(7.5).font(vf).fillColor('#555').text(label + ':', x, y);
      doc.fontSize(8).font(bold ? lf : vf).fillColor('#111').text(val, x + 75, y);
    };
    const w1 = mL + 8;
    const w2 = mL + cW / 3 + 8;
    const w3 = mL + cW * 2 / 3 + 8;
    wRow('Gross Weight', truck.weightGross.toFixed(3) + ' MT', w1, wY + 18);
    wRow('Tare Weight', truck.weightTare.toFixed(3) + ' MT', w2, wY + 18);
    wRow('Net Weight', truck.weightNet.toFixed(3) + ' MT', w3, wY + 18, true);
    wRow('Total Bags', truck.bags.toString(), w1, wY + 34);
    wRow('Weight/Bag', truck.weightPerBag + ' kg', w2, wY + 34);
    wRow('Bag Total', ((truck.bags * truck.weightPerBag) / 1000).toFixed(3) + ' MT', w3, wY + 34);

    doc.y = wY + 60;

    // ── Authority Note ──
    doc.rect(mL, doc.y, cW, 22).lineWidth(0.3).strokeColor('#ccc').stroke();
    doc.fontSize(7).font(vf).fillColor('#555').text(
      'The above mentioned goods are being dispatched from our factory premises. Please allow the vehicle to pass. This gate pass is valid only for the date mentioned above.',
      mL + 5, doc.y + 3, { width: cW - 10 }
    );
    doc.y += 28;

    // ── Signatures ──
    const sigY = doc.y;
    doc.moveTo(mL, sigY).lineTo(mR, sigY).lineWidth(0.3).strokeColor('#ccc').stroke();
    const sigW = cW / 4;
    ['Gate Keeper', 'Weigh Bridge Operator', 'Store In-Charge', 'Authorised by MSPIL'].forEach((label, i) => {
      const sx2 = mL + i * sigW;
      doc.moveTo(sx2 + 8, sigY + 38).lineTo(sx2 + sigW - 8, sigY + 38).lineWidth(0.3).strokeColor('#ccc').stroke();
      doc.fontSize(6.5).font(vf).fillColor('#888').text(label, sx2 + 5, sigY + 42, { width: sigW - 10, align: 'center' });
    });

    // ── Bottom line ──
    doc.y = sigY + 55;
    doc.moveTo(mL, doc.y).lineTo(mR, doc.y).lineWidth(0.5).strokeColor('#999').stroke();
    doc.fontSize(6).font(vf).fillColor('#aaa').text('Generated by Distillery ERP', mL, doc.y + 3);
    doc.fontSize(6).font(vf).fillColor('#aaa').text('Page 1 of 1', mL, doc.y + 3, { width: cW, align: 'right' });

    doc.end();
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
