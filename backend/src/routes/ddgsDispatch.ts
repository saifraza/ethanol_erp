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
// GET /summary?date=YYYY-MM-DD — summary for a date
// ═══════════════════════════════════════════════
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const dateStr = req.query.date as string;
    if (!dateStr) { res.json({ totalNet: 0, truckCount: 0, totalBags: 0 }); return; }

    const dayStart = new Date(dateStr + 'T00:00:00.000Z');
    const dayEnd = new Date(dateStr + 'T23:59:59.999Z');

    const trucks = await prisma.dDGSDispatchTruck.findMany({
      where: { date: { gte: dayStart, lte: dayEnd } },
      orderBy: { createdAt: 'desc' },
    });

    const totalNet = trucks.reduce((s: number, t: any) => s + t.weightNet, 0);
    const totalBags = trucks.reduce((s: number, t: any) => s + t.bags, 0);

    res.json({ totalNet, truckCount: trucks.length, totalBags });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════
// GET ?date=YYYY-MM-DD — list trucks for date
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

    const trucks = await prisma.dDGSDispatchTruck.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 200
    });
    res.json({ trucks });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════
// POST / — Gate In: create new dispatch truck
// ═══════════════════════════════════════════════
router.post('/', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const bags = parseInt(b.bags) || 0;
    const weightPerBag = parseFloat(b.weightPerBag) || 50;
    const weightGross = parseFloat(b.weightGross) || 0;
    const weightTare = parseFloat(b.weightTare) || 0;
    const weightNet = weightGross > 0 && weightTare > 0 ? weightGross - weightTare : 0;

    // Determine initial status based on what data is provided
    let status = 'GATE_IN';
    const now = new Date();
    let gateInTime = now;
    let tareTime: Date | null = null;
    let grossTime: Date | null = null;

    if (weightTare > 0 && weightGross > 0) {
      status = 'GROSS_WEIGHED';
      tareTime = now;
      grossTime = now;
    } else if (weightTare > 0) {
      status = 'TARE_WEIGHED';
      tareTime = now;
    }

    const truck = await prisma.dDGSDispatchTruck.create({
      data: {
        date: new Date(b.date || new Date()),
        status,
        vehicleNo: b.vehicleNo || '',
        partyName: b.partyName || '',
        partyAddress: b.partyAddress || null,
        partyGstin: b.partyGstin || null,
        destination: b.destination || '',
        driverName: b.driverName || null,
        driverMobile: b.driverMobile || null,
        transporterName: b.transporterName || null,
        bags,
        weightPerBag,
        weightGross,
        weightTare,
        weightNet,
        rate: b.rate ? parseFloat(b.rate) : null,
        hsnCode: b.hsnCode || '2303',
        gateInTime,
        tareTime,
        grossTime,
        remarks: b.remarks || null,
        userId: (req as any).user.id,
      }
    });
    res.status(201).json(truck);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════
// PUT /:id — Update truck (status, weights, docs, etc.)
// ═══════════════════════════════════════════════
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const data: any = {};

    // String fields
    const strFields = [
      'status', 'vehicleNo', 'partyName', 'partyAddress', 'partyGstin',
      'destination', 'driverName', 'driverMobile', 'transporterName',
      'invoiceNo', 'gatePassNo', 'ewayBillNo', 'hsnCode', 'remarks'
    ];
    strFields.forEach(f => { if (b[f] !== undefined) data[f] = b[f]; });

    // Numeric fields
    const numFields = ['bags', 'weightPerBag', 'weightGross', 'weightTare', 'weightNet', 'rate', 'invoiceAmount'];
    numFields.forEach(f => {
      if (b[f] !== undefined) data[f] = parseFloat(b[f]) || 0;
    });

    // Datetime fields
    ['gateInTime', 'tareTime', 'grossTime', 'releaseTime'].forEach(f => {
      if (b[f] !== undefined) data[f] = b[f] ? new Date(b[f]) : null;
    });

    // Auto-calc net weight if gross & tare provided
    if (data.weightGross !== undefined || data.weightTare !== undefined) {
      const existing = await prisma.dDGSDispatchTruck.findUnique({ where: { id: req.params.id } });
      if (existing) {
        const gross = data.weightGross ?? existing.weightGross;
        const tare = data.weightTare ?? existing.weightTare;
        if (gross > 0 && tare > 0) data.weightNet = gross - tare;
      }
    }

    const truck = await prisma.dDGSDispatchTruck.update({
      where: { id: req.params.id },
      data,
    });
    res.json(truck);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════
// POST /:id/weigh — Record tare or gross weight
// ═══════════════════════════════════════════════
router.post('/:id/weigh', async (req: Request, res: Response) => {
  try {
    const { type, weight } = req.body; // type: 'tare' | 'gross'
    const w = parseFloat(weight);
    if (!w || !['tare', 'gross'].includes(type)) {
      res.status(400).json({ error: 'Invalid weight or type' }); return;
    }

    const truck = await prisma.dDGSDispatchTruck.findUnique({ where: { id: req.params.id } });
    if (!truck) { res.status(404).json({ error: 'Not found' }); return; }

    const now = new Date();
    const data: any = {};

    if (type === 'tare') {
      data.weightTare = w;
      data.tareTime = now;
      data.status = 'TARE_WEIGHED';
    } else {
      data.weightGross = w;
      data.grossTime = now;
      data.status = 'GROSS_WEIGHED';
      // Calc net
      const tare = truck.weightTare;
      if (tare > 0) data.weightNet = w - tare;
    }

    const updated = await prisma.dDGSDispatchTruck.update({
      where: { id: req.params.id },
      data,
    });
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════
// POST /:id/generate-bill — Auto-generate invoice
// ═══════════════════════════════════════════════
router.post('/:id/generate-bill', async (req: Request, res: Response) => {
  try {
    const truck = await prisma.dDGSDispatchTruck.findUnique({ where: { id: req.params.id } });
    if (!truck) { res.status(404).json({ error: 'Not found' }); return; }

    const { rate, invoiceNo } = req.body;
    const r = parseFloat(rate);
    if (!r) { res.status(400).json({ error: 'Rate required' }); return; }

    const netMT = truck.weightNet; // already in tonnes
    const amount = netMT * r;

    // Generate invoice number if not provided
    const invNo = invoiceNo || `DDGS-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}/${truck.vehicleNo.replace(/\s/g, '')}`;

    const updated = await prisma.dDGSDispatchTruck.update({
      where: { id: req.params.id },
      data: {
        rate: r,
        invoiceNo: invNo,
        invoiceAmount: Math.round(amount * 100) / 100,
        status: truck.status === 'GROSS_WEIGHED' ? 'BILLED' : truck.status,
      },
    });
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════
// POST /:id/release — Mark truck as released
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

// ═══════════════════════════════════════════════
// GET /:id/invoice-pdf — Generate DDGS Invoice PDF
// ═══════════════════════════════════════════════
router.get('/:id/invoice-pdf', async (req: Request, res: Response) => {
  try {
    const truck = await prisma.dDGSDispatchTruck.findUnique({ where: { id: req.params.id } });
    if (!truck) { res.status(404).json({ error: 'Not found' }); return; }

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=DDGS-Invoice-${truck.invoiceNo || truck.id.slice(0, 8)}.pdf`);
    doc.pipe(res);

    const pageW = doc.page.width;
    const mL = 40;
    const mR = pageW - 40;
    const cW = mR - mL;
    const lf = 'Helvetica-Bold';
    const vf = 'Helvetica';

    // Letterhead
    const letterheadPath = path.resolve(__dirname, '../../../assets/letterhead_img_0.jpeg');
    if (fs.existsSync(letterheadPath)) {
      doc.image(letterheadPath, mL, 30, { width: cW, height: 70 });
      doc.y = 110;
    } else {
      doc.fontSize(14).font(lf).text('Mahakaushal Sugar and Power Industries Ltd.', mL, 30, { align: 'center', width: cW });
      doc.fontSize(8).font(vf).text('GSTIN: 23AAECM3666P1Z1 | Village Bachai, Narsinghpur, MP - 487001', { align: 'center', width: cW });
      doc.y = 70;
    }

    // Title bar
    doc.rect(mL, doc.y, cW, 24).fill('#1a3a1a');
    doc.fontSize(12).font(lf).fillColor('#fff').text('TAX INVOICE', mL, doc.y + 6, { width: cW, align: 'center' });
    doc.y += 32;

    // Invoice details
    const col2 = pageW / 2 + 20;
    const y0 = doc.y;
    const info = (label: string, val: string, x: number, y: number) => {
      doc.fontSize(8).font(lf).fillColor('#888').text(label, x, y);
      doc.fontSize(9).font(vf).fillColor('#222').text(val || '—', x + 85, y);
    };

    info('Invoice No:', truck.invoiceNo || '—', mL, y0);
    info('Date:', new Date(truck.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }), col2, y0);
    info('Vehicle No:', truck.vehicleNo, mL, y0 + 16);
    info('E-Way Bill:', truck.ewayBillNo || '—', col2, y0 + 16);
    doc.y = y0 + 40;

    // Supplier & Buyer boxes
    const boxY = doc.y;
    // Supplier
    doc.rect(mL, boxY, cW / 2 - 5, 55).lineWidth(0.5).strokeColor('#ddd').stroke();
    doc.fontSize(7).font(lf).fillColor('#888').text('SUPPLIER', mL + 8, boxY + 5);
    doc.fontSize(9).font(lf).fillColor('#222').text(MSPIL.name, mL + 8, boxY + 16);
    doc.fontSize(7).font(vf).fillColor('#555').text(MSPIL.address + ', ' + MSPIL.state + ' - ' + MSPIL.pincode, mL + 8, boxY + 28, { width: cW / 2 - 20 });
    doc.fontSize(7).font(vf).fillColor('#555').text('GSTIN: ' + MSPIL.gstin, mL + 8, boxY + 42);
    // Buyer
    const bx = mL + cW / 2 + 5;
    doc.rect(bx, boxY, cW / 2 - 5, 55).lineWidth(0.5).strokeColor('#ddd').stroke();
    doc.fontSize(7).font(lf).fillColor('#888').text('BUYER / CONSIGNEE', bx + 8, boxY + 5);
    doc.fontSize(9).font(lf).fillColor('#222').text(truck.partyName || '—', bx + 8, boxY + 16);
    doc.fontSize(7).font(vf).fillColor('#555').text((truck.partyAddress || truck.destination || '—'), bx + 8, boxY + 28, { width: cW / 2 - 20 });
    if (truck.partyGstin) doc.fontSize(7).font(vf).fillColor('#555').text('GSTIN: ' + truck.partyGstin, bx + 8, boxY + 42);
    doc.y = boxY + 65;

    // Items table
    const tY = doc.y;
    const cols = [30, 170, 60, 70, 70, 55, 60];
    const hdrs = ['#', 'Description', 'HSN', 'Qty (MT)', 'Rate/MT', 'Bags', 'Amount'];
    doc.rect(mL, tY, cW, 20).fill('#1a3a1a');
    let cx = mL + 4;
    hdrs.forEach((h, i) => {
      doc.fontSize(7).font(lf).fillColor('#fff').text(h, cx, tY + 6, { width: cols[i], align: i > 2 ? 'right' : 'left' });
      cx += cols[i];
    });

    let rY = tY + 24;
    const netMT = truck.weightNet;
    const rate = truck.rate || 0;
    const amount = truck.invoiceAmount || (netMT * rate);
    const rowData = ['1', 'DDGS (Dried Distillers Grains with Solubles)', truck.hsnCode || '2303',
      netMT.toFixed(3), `₹${rate.toLocaleString('en-IN')}`, truck.bags.toString(), `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`];
    doc.rect(mL, rY - 3, cW, 20).fill('#f8faf8');
    cx = mL + 4;
    rowData.forEach((v, i) => {
      doc.fontSize(8).font(i === 0 ? lf : vf).fillColor('#333').text(v, cx, rY, { width: cols[i], align: i > 2 ? 'right' : 'left' });
      cx += cols[i];
    });
    rY += 24;

    // Total row
    doc.rect(mL, rY - 3, cW, 22).fill('#e8f5e8');
    doc.fontSize(9).font(lf).fillColor('#1a3a1a').text('TOTAL', mL + 8, rY);
    doc.text(`₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, mL + 4, rY, { width: cW - 12, align: 'right' });
    rY += 30;

    // Weight summary
    doc.y = rY;
    doc.fontSize(8).font(lf).fillColor('#888').text('WEIGHT DETAILS', mL, doc.y);
    doc.y += 12;
    const wInfo = [
      ['Gross Weight', `${truck.weightGross.toFixed(3)} MT`],
      ['Tare Weight', `${truck.weightTare.toFixed(3)} MT`],
      ['Net Weight', `${truck.weightNet.toFixed(3)} MT`],
      ['Bags', `${truck.bags} × ${truck.weightPerBag} kg`],
    ];
    wInfo.forEach(([l, v]) => {
      doc.fontSize(8).font(vf).fillColor('#555').text(l + ':', mL + 10, doc.y);
      doc.font(lf).fillColor('#222').text(v, mL + 120, doc.y);
      doc.y += 14;
    });

    doc.y += 20;

    // Signatures
    const sigW = cW / 3;
    const sigY = doc.y;
    ['Prepared By', 'Checked By', 'Authorized Signatory'].forEach((label, i) => {
      const sx = mL + i * sigW;
      doc.moveTo(sx + 10, sigY + 30).lineTo(sx + sigW - 10, sigY + 30).lineWidth(0.5).strokeColor('#ccc').stroke();
      doc.fontSize(7).font(vf).fillColor('#888').text(label, sx + 10, sigY + 34, { width: sigW - 20, align: 'center' });
    });

    doc.end();
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════
// GET /:id/gate-pass-pdf — Generate Gate Pass Challan PDF
// ═══════════════════════════════════════════════
router.get('/:id/gate-pass-pdf', async (req: Request, res: Response) => {
  try {
    const truck = await prisma.dDGSDispatchTruck.findUnique({ where: { id: req.params.id } });
    if (!truck) { res.status(404).json({ error: 'Not found' }); return; }

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=GatePass-DDGS-${truck.vehicleNo}.pdf`);
    doc.pipe(res);

    const pageW = doc.page.width;
    const mL = 40;
    const mR = pageW - 40;
    const cW = mR - mL;
    const lf = 'Helvetica-Bold';
    const vf = 'Helvetica';

    // Letterhead
    const letterheadPath = path.resolve(__dirname, '../../../assets/letterhead_img_0.jpeg');
    if (fs.existsSync(letterheadPath)) {
      doc.image(letterheadPath, mL, 30, { width: cW, height: 70 });
      doc.y = 110;
    } else {
      doc.fontSize(14).font(lf).text('Mahakaushal Sugar and Power Industries Ltd.', mL, 30, { align: 'center', width: cW });
      doc.fontSize(8).font(vf).text('GSTIN: 23AAECM3666P1Z1 | Village Bachai, Narsinghpur, MP - 487001', { align: 'center', width: cW });
      doc.y = 70;
    }

    // Green bar
    doc.rect(mL, doc.y, cW, 3).fill('#4a7c3f');
    doc.y += 10;

    // Title
    const gpNo = truck.gatePassNo || `DDGS-GP-${truck.date.toISOString().slice(2, 10).replace(/-/g, '')}/${truck.vehicleNo.replace(/\s/g, '')}`;
    doc.fontSize(13).font(lf).fillColor('#1a3a1a').text('GATE PASS CUM CHALLAN', mL, doc.y, { width: cW * 0.6 });
    doc.fontSize(10).font(lf).fillColor('#4a7c3f').text('NON-RETURNABLE (SALE)', mL + cW * 0.6, doc.y, { width: cW * 0.4, align: 'right' });
    doc.y += 22;

    doc.moveTo(mL, doc.y).lineTo(mR, doc.y).lineWidth(0.5).strokeColor('#ddd').stroke();
    doc.y += 8;

    // Info grid
    const col2 = pageW / 2 + 20;
    const y0 = doc.y;
    const info = (label: string, val: string, x: number, y: number) => {
      doc.fontSize(8).font(lf).fillColor('#888').text(label, x, y);
      doc.fontSize(9).font(vf).fillColor('#222').text(val || '—', x + 90, y);
    };

    info('Gate Pass No:', gpNo, mL, y0);
    info('Date:', new Date(truck.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }), col2, y0);
    info('Vehicle No:', truck.vehicleNo, mL, y0 + 16);
    info('Driver:', truck.driverName || '—', col2, y0 + 16);
    info('Driver Mobile:', truck.driverMobile || '—', mL, y0 + 32);
    info('Transporter:', truck.transporterName || '—', col2, y0 + 32);
    if (truck.ewayBillNo) info('E-Way Bill:', truck.ewayBillNo, mL, y0 + 48);
    if (truck.invoiceNo) info('Invoice No:', truck.invoiceNo, col2, y0 + 48);
    doc.y = y0 + (truck.ewayBillNo || truck.invoiceNo ? 68 : 52);

    // Party box
    const cy = doc.y;
    doc.rect(mL, cy, cW, 50).lineWidth(0.5).strokeColor('#4a7c3f').fillOpacity(0.03).fillAndStroke('#4a7c3f', '#4a7c3f');
    doc.fillOpacity(1);
    doc.fontSize(8).font(lf).fillColor('#4a7c3f').text('PARTY / CONSIGNEE', mL + 10, cy + 6);
    doc.fontSize(10).font(lf).fillColor('#222').text(truck.partyName || '—', mL + 10, cy + 20);
    doc.font(vf).fontSize(8).fillColor('#555').text(truck.partyAddress || truck.destination || '—', mL + 10, cy + 33, { width: cW / 2 - 20 });
    if (truck.partyGstin) doc.fontSize(8).font(vf).fillColor('#555').text(`GSTIN: ${truck.partyGstin}`, col2, cy + 20);
    doc.y = cy + 60;

    // Items table
    const tY = doc.y;
    const cols = [30, 200, 60, 60, 70, 95];
    const hdrs = ['#', 'Description', 'HSN', 'Qty (MT)', 'Bags', 'Value (₹)'];
    doc.rect(mL, tY, cW, 20).fill('#4a7c3f');
    let cx = mL + 4;
    hdrs.forEach((h, i) => {
      doc.fontSize(8).font(lf).fillColor('#fff').text(h, cx, tY + 5, { width: cols[i], align: i > 2 ? 'right' : 'left' });
      cx += cols[i];
    });

    let rY = tY + 24;
    const amt = truck.invoiceAmount || (truck.weightNet * (truck.rate || 0));
    doc.rect(mL, rY - 3, cW, 20).fill('#f8faf8');
    cx = mL + 4;
    const rowData = ['1', 'DDGS (Dried Distillers Grains with Solubles)', truck.hsnCode || '2303',
      truck.weightNet.toFixed(3), truck.bags.toString(), amt > 0 ? `₹${amt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'];
    rowData.forEach((v, i) => {
      doc.fontSize(8).font(vf).fillColor('#333').text(v, cx, rY, { width: cols[i], align: i > 2 ? 'right' : 'left' });
      cx += cols[i];
    });
    rY += 24;

    // Total
    if (amt > 0) {
      doc.rect(mL, rY - 3, cW, 20).fill('#e8f5e8');
      doc.fontSize(9).font(lf).fillColor('#1a3a1a').text('TOTAL VALUE', mL + 8, rY);
      doc.text(`₹${amt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, mL + 4, rY, { width: cW - 12, align: 'right' });
      rY += 24;
    }

    // Weight summary box
    doc.y = rY + 5;
    doc.rect(mL, doc.y, cW, 60).lineWidth(0.5).strokeColor('#ddd').stroke();
    const wy0 = doc.y + 5;
    doc.fontSize(8).font(lf).fillColor('#888').text('WEIGHT SUMMARY', mL + 10, wy0);
    const wData = [
      [`Gross: ${truck.weightGross.toFixed(3)} MT`, `Tare: ${truck.weightTare.toFixed(3)} MT`, `Net: ${truck.weightNet.toFixed(3)} MT`],
      [`Bags: ${truck.bags}`, `Wt/Bag: ${truck.weightPerBag} kg`, `Bag Total: ${((truck.bags * truck.weightPerBag) / 1000).toFixed(3)} MT`],
    ];
    wData.forEach((row, ri) => {
      row.forEach((cell, ci) => {
        doc.fontSize(8).font(ri === 0 && ci === 2 ? lf : vf).fillColor('#333').text(cell, mL + 10 + ci * 175, wy0 + 16 + ri * 16);
      });
    });
    doc.y += 75;

    // Signatures
    const sigW = cW / 4;
    const sigY = doc.y;
    ['Gate Keeper', 'Weigh Bridge', 'Store In-Charge', 'Authorized by MSPIL'].forEach((label, i) => {
      const sx = mL + i * sigW;
      doc.moveTo(sx + 5, sigY + 35).lineTo(sx + sigW - 5, sigY + 35).lineWidth(0.5).strokeColor('#ccc').stroke();
      doc.fontSize(7).font(vf).fillColor('#888').text(label, sx + 5, sigY + 39, { width: sigW - 10, align: 'center' });
    });

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
    const cgst = req.body.cgstRate || 2.5;
    const sgst = req.body.sgstRate || 2.5;
    const igst = req.body.igstRate || 0;

    const payload: any = {
      supplierGstin: MSPIL.gstin,
      supplierName: MSPIL.name,
      supplierAddress: MSPIL.address,
      supplierState: MSPIL.state,
      supplierPincode: MSPIL.pincode,
      recipientGstin: truck.partyGstin || 'URP',
      recipientName: truck.partyName,
      recipientAddress: truck.partyAddress || truck.destination,
      recipientState: req.body.recipientState || MSPIL.state,
      recipientPincode: req.body.recipientPincode || MSPIL.pincode,
      documentType: 'INV',
      documentNo: truck.invoiceNo || truck.id.slice(0, 8),
      documentDate: truck.date.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      items: [{
        productName: 'DDGS',
        hsnCode: truck.hsnCode || '2303',
        quantity: truck.weightNet,
        unit: 'MTS',
        taxableValue,
        cgstRate: cgst,
        sgstRate: sgst,
        igstRate: igst,
      }],
      vehicleNo: truck.vehicleNo.replace(/\s/g, ''),
      vehicleType: 'R' as const,
      transportMode: '1' as const,
      transporterId: req.body.transporterGstin || '',
      transporterName: truck.transporterName || '',
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
