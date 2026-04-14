import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize, AuthRequest, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { generateEwayBill, MSPIL } from '../services/ewayBill';
import { renderDocumentPdf } from '../services/documentRenderer';

const router = Router();
router.use(authenticate as any);

// ─── helpers ───
function isInterstate(partyGstin: string | null): boolean {
  if (!partyGstin || partyGstin === 'URP' || partyGstin.length < 2) return false;
  const mspilStateCode = MSPIL.gstin.substring(0, 2);
  const partyStateCode = partyGstin.substring(0, 2);
  return mspilStateCode !== partyStateCode;
}

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

const SUGAR_HSN = '1701';
const SUGAR_GST = 5;

// GET /summary?date=YYYY-MM-DD
router.get('/summary', async (req: AuthRequest, res: Response) => {
  try {
    const dateStr = req.query.date as string;
    if (!dateStr) { res.json({ totalNet: 0, truckCount: 0, totalBags: 0 }); return; }
    const dayStart = new Date(dateStr + 'T00:00:00.000Z');
    const dayEnd = new Date(dateStr + 'T23:59:59.999Z');
    const trucks = await prisma.sugarDispatchTruck.findMany({
      where: { date: { gte: dayStart, lte: dayEnd }, ...getCompanyFilter(req) },
      orderBy: { createdAt: 'desc' },
      select: { weightNet: true, bags: true },
    });
    const totalNet = trucks.reduce((s, t) => s + t.weightNet, 0);
    const totalBags = trucks.reduce((s, t) => s + t.bags, 0);
    res.json({ totalNet, truckCount: trucks.length, totalBags });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET ?date=YYYY-MM-DD
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const dateStr = req.query.date as string;
    let where: any = { ...getCompanyFilter(req) };
    if (dateStr) {
      const dayStart = new Date(dateStr + 'T00:00:00.000Z');
      const dayEnd = new Date(dateStr + 'T23:59:59.999Z');
      where = { ...where, date: { gte: dayStart, lte: dayEnd } };
    }
    const trucks = await prisma.sugarDispatchTruck.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ trucks });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /history — past dispatches grouped by date
router.get('/history', async (req: AuthRequest, res: Response) => {
  try {
    const trucks = await prisma.sugarDispatchTruck.findMany({
      where: { ...getCompanyFilter(req) },
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
    const today = new Date().toISOString().split('T')[0];
    delete history[today];
    res.json({ history });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST / — Gate In
router.post('/', async (req: AuthRequest, res: Response) => {
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

    const truck = await prisma.sugarDispatchTruck.create({
      data: {
        companyId: getActiveCompanyId(req),
        date: new Date(b.date || new Date()), status,
        rstNo: b.rstNo ? parseInt(b.rstNo) : null,
        vehicleNo: b.vehicleNo || '', partyName: b.partyName || '',
        partyAddress: b.partyAddress || null, partyGstin: b.partyGstin || null,
        destination: b.destination || '', driverName: b.driverName || null,
        driverMobile: b.driverMobile || null, transporterName: b.transporterName || null,
        bags, weightPerBag, weightGross, weightTare, weightNet,
        rate: b.rate ? parseFloat(b.rate) : null,
        hsnCode: b.hsnCode || SUGAR_HSN,
        gateInTime: now, tareTime, grossTime,
        remarks: b.remarks || null,
        contractId: b.contractId || null,
        customerId: b.customerId || null,
        userId: req.user!.id,
      },
    });
    res.status(201).json(truck);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /:id — Update truck (status guard: cannot edit BILLED/RELEASED via free PUT)
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.sugarDispatchTruck.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
    if (existing.status === 'BILLED' || existing.status === 'RELEASED') {
      res.status(409).json({ error: `Cannot edit truck in status ${existing.status}` });
      return;
    }
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
      const gross = data.weightGross ?? existing.weightGross;
      const tare = data.weightTare ?? existing.weightTare;
      if (gross > 0 && tare > 0) data.weightNet = gross - tare;
    }
    const truck = await prisma.sugarDispatchTruck.update({ where: { id: req.params.id }, data });
    res.json(truck);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /:id/weigh
router.post('/:id/weigh', async (req: AuthRequest, res: Response) => {
  try {
    const { type, weight } = req.body;
    const w = parseFloat(weight);
    if (!w || !['tare', 'gross'].includes(type)) { res.status(400).json({ error: 'Invalid' }); return; }
    const truck = await prisma.sugarDispatchTruck.findUnique({ where: { id: req.params.id } });
    if (!truck) { res.status(404).json({ error: 'Not found' }); return; }
    if (truck.status === 'BILLED' || truck.status === 'RELEASED') {
      res.status(409).json({ error: `Cannot reweigh truck in status ${truck.status}` });
      return;
    }
    const now = new Date();
    const data: any = {};
    if (type === 'tare') {
      data.weightTare = w; data.tareTime = now; data.status = 'TARE_WEIGHED';
    } else {
      data.weightGross = w; data.grossTime = now; data.status = 'GROSS_WEIGHED';
      if (truck.weightTare > 0) data.weightNet = w - truck.weightTare;
    }
    const updated = await prisma.sugarDispatchTruck.update({ where: { id: req.params.id }, data });
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /:id/generate-bill
router.post('/:id/generate-bill', async (req: AuthRequest, res: Response) => {
  try {
    const truck = await prisma.sugarDispatchTruck.findUnique({ where: { id: req.params.id } });
    if (!truck) { res.status(404).json({ error: 'Not found' }); return; }
    if (truck.status === 'BILLED' || truck.status === 'RELEASED') {
      res.status(409).json({ error: `Already ${truck.status}` });
      return;
    }
    const { rate, invoiceNo } = req.body;
    const r = parseFloat(rate);
    if (!r) { res.status(400).json({ error: 'Rate required' }); return; }

    const netMT = truck.weightNet;
    const taxableAmount = Math.round(netMT * r * 100) / 100;
    const gstAmount = Math.round(taxableAmount * SUGAR_GST / 100 * 100) / 100;
    const totalAmount = Math.round((taxableAmount + gstAmount) * 100) / 100;

    const invNo = invoiceNo || `SUG/25-26/${Date.now().toString().slice(-5)}`;

    const updated = await prisma.sugarDispatchTruck.update({
      where: { id: req.params.id },
      data: {
        rate: r, invoiceNo: invNo, invoiceAmount: totalAmount,
        status: truck.status === 'GROSS_WEIGHED' ? 'BILLED' : truck.status,
      },
    });
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /:id/release
router.post('/:id/release', async (req: AuthRequest, res: Response) => {
  try {
    const updated = await prisma.sugarDispatchTruck.update({
      where: { id: req.params.id },
      data: { status: 'RELEASED', releaseTime: new Date() },
    });
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /:id/invoice-pdf
router.get('/:id/invoice-pdf', async (req: AuthRequest, res: Response) => {
  try {
    const truck = await prisma.sugarDispatchTruck.findUnique({ where: { id: req.params.id } });
    if (!truck) { res.status(404).json({ error: 'Not found' }); return; }

    const interstate = isInterstate(truck.partyGstin);
    const netMT = truck.weightNet;
    const rate = truck.rate || 0;
    const taxableValue = Math.round(netMT * rate * 100) / 100;
    const cgst = interstate ? 0 : Math.round(taxableValue * 2.5 / 100 * 100) / 100;
    const sgst = interstate ? 0 : Math.round(taxableValue * 2.5 / 100 * 100) / 100;
    const igst = interstate ? Math.round(taxableValue * 5 / 100 * 100) / 100 : 0;
    const grandTotal = Math.round((taxableValue + cgst + sgst + igst) * 100) / 100;

    const data = {
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
      productName: 'White Sugar',
      netMT,
      bags: truck.bags,
      rate,
      taxableValue,
      cgst, sgst, igst, grandTotal,
    };

    // Reuse DDGS_INVOICE template (same shape: bags + HSN + GST split)
    const pdfBuffer = await renderDocumentPdf({ docType: 'DDGS_INVOICE', data, verifyId: truck.id });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=Invoice-${truck.invoiceNo || truck.id.slice(0, 8)}.pdf`);
    res.send(pdfBuffer);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /:id/gate-pass-pdf
router.get('/:id/gate-pass-pdf', async (req: AuthRequest, res: Response) => {
  try {
    const truck = await prisma.sugarDispatchTruck.findUnique({ where: { id: req.params.id } });
    if (!truck) { res.status(404).json({ error: 'Not found' }); return; }

    const amt = truck.invoiceAmount || (truck.weightNet * (truck.rate || 0));

    const data = {
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
      productName: 'White Sugar',
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

    // Reuse DDGS_GATE_PASS template
    const pdfBuffer = await renderDocumentPdf({ docType: 'DDGS_GATE_PASS', data, verifyId: truck.id });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=GatePass-${truck.vehicleNo.replace(/\s/g, '')}.pdf`);
    res.send(pdfBuffer);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /:id/eway-bill
router.post('/:id/eway-bill', async (req: AuthRequest, res: Response) => {
  try {
    const truck = await prisma.sugarDispatchTruck.findUnique({ where: { id: req.params.id } });
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
        productName: 'Sugar (White, Refined)',
        hsnCode: truck.hsnCode || SUGAR_HSN,
        quantity: truck.weightNet * 1000,
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
      await prisma.sugarDispatchTruck.update({
        where: { id: req.params.id },
        data: { ewayBillNo: result.ewayBillNo },
      });
    }
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /:id
router.delete('/:id', authorize('ADMIN') as any, async (req: AuthRequest, res: Response) => {
  try {
    const truck = await prisma.sugarDispatchTruck.findUnique({ where: { id: req.params.id } });
    if (!truck) { res.status(404).json({ error: 'Not found' }); return; }
    if (truck.status === 'BILLED' || truck.status === 'RELEASED') {
      res.status(409).json({ error: `Cannot delete truck in status ${truck.status}` });
      return;
    }
    await prisma.sugarDispatchTruck.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
