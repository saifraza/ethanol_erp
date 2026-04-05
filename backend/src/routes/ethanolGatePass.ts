import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import prisma from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { nextInvoiceNo } from '../utils/invoiceCounter';
import { onSaleInvoiceCreated } from '../services/autoJournal';

const router = Router();

// Accept either JWT auth or X-WB-Key (for factory server proxy)
const WB_KEY = process.env.WB_PUSH_KEY || 'mspil-wb-2026';
function authOrWbKey(req: Request, res: Response, next: NextFunction) {
  const wbKey = req.headers['x-wb-key'] as string;
  if (wbKey && wbKey.length === WB_KEY.length) {
    try {
      if (crypto.timingSafeEqual(Buffer.from(wbKey), Buffer.from(WB_KEY))) {
        (req as any).user = { id: 'factory-server', role: 'ADMIN' };
        return next();
      }
    } catch { /* fall through to JWT */ }
  }
  return authenticate(req as any, res, next);
}
router.use(authOrWbKey);

function nowIST(): Date {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

function calcGstSplit(amount: number, gstPercent: number, customerState?: string | null) {
  const isIntra = customerState?.toLowerCase().includes('madhya pradesh');
  const gstAmount = Math.round(amount * gstPercent / 100 * 100) / 100;
  if (isIntra) {
    const half = Math.round(gstAmount / 2 * 100) / 100;
    return { gstAmount, supplyType: 'INTRA_STATE' as const, cgstPercent: gstPercent / 2, cgstAmount: half, sgstPercent: gstPercent / 2, sgstAmount: gstAmount - half, igstPercent: 0, igstAmount: 0 };
  }
  return { gstAmount, supplyType: 'INTER_STATE' as const, cgstPercent: 0, cgstAmount: 0, sgstPercent: 0, sgstAmount: 0, igstPercent: gstPercent, igstAmount: gstAmount };
}

async function nextCounter(tx: any, prefix: string): Promise<string> {
  const key = `counter:${prefix}`;
  const existing = await tx.appConfig.findUnique({ where: { key } });
  const counter = existing ? parseInt(existing.value, 10) + 1 : 1;
  await tx.appConfig.upsert({ where: { key }, update: { value: String(counter) }, create: { key, value: String(counter) } });
  return `${prefix}/${String(counter).padStart(3, '0')}`;
}

// ── GET /active-contracts ── (must be before /:id)
router.get('/active-contracts', asyncHandler(async (req: AuthRequest, res: Response) => {
  const contracts = await prisma.ethanolContract.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, contractNo: true, contractType: true, buyerName: true, buyerGst: true, buyerAddress: true, conversionRate: true, ethanolRate: true, gstPercent: true, paymentTermsDays: true, omcDepot: true, buyerCustomerId: true },
    take: 50,
  });
  res.json(contracts);
}));

// ── GET / ── List for date
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const dateStr = req.query.date as string;
  const ist = nowIST();
  const y = ist.getUTCFullYear(), m = ist.getUTCMonth(), d = ist.getUTCDate();
  const targetDate = dateStr ? new Date(dateStr + 'T00:00:00Z') : new Date(Date.UTC(y, m, d));
  const nextDay = new Date(targetDate); nextDay.setUTCDate(nextDay.getUTCDate() + 1);

  const trucks = await prisma.dispatchTruck.findMany({
    where: { date: { gte: targetDate, lt: nextDay }, status: { not: undefined } },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { contract: { select: { contractNo: true, contractType: true, buyerName: true, gstPercent: true, paymentTermsDays: true, buyerGst: true } } },
  });
  res.json(trucks);
}));

// ── POST / ── Gate entry
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const contract = b.contractId ? await prisma.ethanolContract.findUnique({ where: { id: b.contractId }, select: { buyerName: true, buyerAddress: true, omcDepot: true, conversionRate: true, ethanolRate: true } }) : null;
  const ist = nowIST();

  const truck = await prisma.dispatchTruck.create({
    data: {
      date: new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate())),
      vehicleNo: (b.vehicleNo || '').toUpperCase().replace(/\s/g, ''),
      partyName: contract?.buyerName || b.partyName || '',
      destination: b.destination || contract?.omcDepot || '',
      contractId: b.contractId || null,
      driverName: b.driverName || null,
      driverPhone: b.driverPhone || null,
      transporterName: b.transporterName || null,
      distanceKm: b.distanceKm ? parseInt(b.distanceKm) : null,
      rstNo: b.rstNo || null,
      sealNo: b.sealNo || null,
      status: 'GATE_IN',
      gateInTime: ist,
      userId: req.user?.id || null,
    },
  });
  res.status(201).json(truck);
}));

// ── POST /:id/tare ──
router.post('/:id/tare', asyncHandler(async (req: AuthRequest, res: Response) => {
  const truck = await prisma.dispatchTruck.findUnique({ where: { id: req.params.id } });
  if (!truck) return res.status(404).json({ error: 'Not found' });
  if (truck.status !== 'GATE_IN') return res.status(400).json({ error: `Cannot tare in status ${truck.status}` });

  const updated = await prisma.dispatchTruck.update({
    where: { id: req.params.id },
    data: { weightTare: parseFloat(req.body.weightTare), status: 'TARE_WEIGHED', tareTime: nowIST() },
  });
  res.json(updated);
}));

// ── POST /:id/gross ──
router.post('/:id/gross', asyncHandler(async (req: AuthRequest, res: Response) => {
  const truck = await prisma.dispatchTruck.findUnique({ where: { id: req.params.id } });
  if (!truck) return res.status(404).json({ error: 'Not found' });
  if (truck.status !== 'TARE_WEIGHED') return res.status(400).json({ error: `Cannot record gross in status ${truck.status}` });

  const weightGross = parseFloat(req.body.weightGross);
  const quantityBL = parseFloat(req.body.quantityBL);
  const strength = req.body.strength ? parseFloat(req.body.strength) : null;
  const productRatePerLtr = req.body.productRatePerLtr ? parseFloat(req.body.productRatePerLtr) : null;
  const weightNet = weightGross - (truck.weightTare || 0);
  const densityCheck = quantityBL > 0 ? weightNet / quantityBL : 0;
  const productValue = productRatePerLtr && quantityBL ? Math.round(quantityBL * productRatePerLtr) : null;

  const updated = await prisma.dispatchTruck.update({
    where: { id: req.params.id },
    data: {
      weightGross, quantityBL, strength, weightNet,
      productRatePerLtr: productRatePerLtr || undefined,
      productValue: productValue || undefined,
      status: 'GROSS_WEIGHED',
      grossTime: nowIST(),
    },
  });
  res.json({ ...updated, densityCheck });
}));

// ── POST /:id/release ── THE BIG ONE
router.post('/:id/release', asyncHandler(async (req: AuthRequest, res: Response) => {
  const truck = await prisma.dispatchTruck.findUnique({
    where: { id: req.params.id },
    include: { contract: true },
  });
  if (!truck) return res.status(404).json({ error: 'Not found' });
  if (truck.status !== 'GROSS_WEIGHED') return res.status(400).json({ error: `Cannot release in status ${truck.status}` });
  if (!truck.contractId || !truck.contract) return res.status(400).json({ error: 'No contract linked' });

  const contract = truck.contract;

  // Resolve customer
  let customerId = contract.buyerCustomerId;
  if (!customerId) {
    if (!contract.buyerGst) return res.status(400).json({ error: 'Contract buyer has no GSTIN' });
    const cust = await prisma.customer.findFirst({ where: { gstNo: contract.buyerGst } });
    if (!cust) return res.status(400).json({ error: 'Customer not found for buyer GSTIN' });
    customerId = cust.id;
    await prisma.ethanolContract.update({ where: { id: contract.id }, data: { buyerCustomerId: customerId } });
  }
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return res.status(500).json({ error: 'Customer not found' });

  const rate = contract.conversionRate || contract.ethanolRate || 0;
  const amount = truck.quantityBL * rate;
  const gstPercent = contract.gstPercent || 18;
  const gst = calcGstSplit(amount, gstPercent, customer.state);
  const totalAmount = Math.round(amount + gst.gstAmount);
  const ist = nowIST();

  const result = await prisma.$transaction(async (tx: any) => {
    // Re-check status inside transaction to prevent double-release race
    const fresh = await tx.dispatchTruck.findUnique({ where: { id: truck.id }, select: { status: true, liftingId: true } });
    if (fresh?.status === 'RELEASED' || fresh?.liftingId) throw new Error('Already released');

    const gatePassNo = await nextCounter(tx, 'GP/ETH');
    const challanNo = await nextCounter(tx, 'DCH/ETH');
    const invoiceNo = await nextInvoiceNo(tx, 'ETH');

    const invoice = await tx.invoice.create({
      data: {
        customerId: customer.id,
        invoiceDate: truck.date,
        dueDate: contract.paymentTermsDays ? new Date(truck.date.getTime() + contract.paymentTermsDays * 86400000) : null,
        productName: contract.contractType === 'JOB_WORK' ? 'Job Work Charges for Ethanol Production' : 'ETHANOL',
        quantity: truck.quantityBL, unit: 'BL', rate, amount,
        gstPercent, gstAmount: gst.gstAmount, supplyType: gst.supplyType,
        cgstPercent: gst.cgstPercent, cgstAmount: gst.cgstAmount,
        sgstPercent: gst.sgstPercent, sgstAmount: gst.sgstAmount,
        igstPercent: gst.igstPercent, igstAmount: gst.igstAmount,
        totalAmount, balanceAmount: totalAmount, status: 'UNPAID',
        remarks: invoiceNo,
        userId: req.user?.id || 'system',
      },
    });

    const lifting = await tx.ethanolLifting.create({
      data: {
        contractId: contract.id, liftingDate: truck.date,
        vehicleNo: truck.vehicleNo, driverName: truck.driverName, driverPhone: truck.driverPhone,
        transporterName: truck.transporterName, destination: truck.destination,
        quantityBL: truck.quantityBL, quantityKL: truck.quantityBL / 1000,
        strength: truck.strength, rate, amount,
        status: 'LOADED', invoiceId: invoice.id, invoiceNo,
        distanceKm: truck.distanceKm, rstNo: truck.rstNo, challanNo,
        dispatchMode: 'TANKER',
        productRatePerLtr: truck.productRatePerLtr, productValue: truck.productValue,
      },
    });

    await tx.dispatchTruck.update({
      where: { id: truck.id },
      data: { status: 'RELEASED', releaseTime: ist, gatePassNo, challanNo, liftingId: lifting.id },
    });

    // Update contract supplied KL
    const allLiftings = await tx.ethanolLifting.findMany({
      where: { contractId: contract.id }, select: { quantityKL: true },
    });
    const totalKL = allLiftings.reduce((s: number, l: any) => s + l.quantityKL, 0);
    await tx.ethanolContract.update({ where: { id: contract.id }, data: { totalSuppliedKL: totalKL } });

    return { invoice, lifting, gatePassNo, challanNo, invoiceNo };
  });

  // Fire-and-forget journal entry
  onSaleInvoiceCreated(prisma, {
    id: result.invoice.id, invoiceNo: result.invoice.invoiceNo, totalAmount,
    amount, gstAmount: gst.gstAmount, gstPercent,
    cgstAmount: gst.cgstAmount, sgstAmount: gst.sgstAmount, igstAmount: gst.igstAmount,
    supplyType: gst.supplyType, freightCharge: 0,
    productName: result.invoice.productName, customerId: customer.id,
    userId: req.user?.id || 'system', invoiceDate: truck.date,
  }).catch(() => {});

  res.json({
    success: true, gatePassNo: result.gatePassNo, challanNo: result.challanNo,
    invoiceNo: result.invoiceNo, invoiceId: result.invoice.id,
    liftingId: result.lifting.id, truckId: truck.id,
  });
}));

// ── GET /:id/invoice-pdf ── Redirect to invoice PDF
router.get('/:id/invoice-pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
  const truck = await prisma.dispatchTruck.findUnique({ where: { id: req.params.id }, select: { liftingId: true } });
  if (!truck?.liftingId) return res.status(400).json({ error: 'No invoice yet — release first' });
  const lifting = await prisma.ethanolLifting.findUnique({ where: { id: truck.liftingId }, select: { invoiceId: true } });
  if (!lifting?.invoiceId) return res.status(400).json({ error: 'Invoice not found' });
  res.redirect(`/api/invoices/${lifting.invoiceId}/pdf`);
}));

// ── GET /:id/delivery-challan-pdf ── Ethanol-specific challan
router.get('/:id/delivery-challan-pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
  const truck = await prisma.dispatchTruck.findUnique({
    where: { id: req.params.id },
    include: { contract: { select: { buyerName: true, buyerAddress: true, buyerGst: true, contractType: true, conversionRate: true, ethanolRate: true } } },
  });
  if (!truck) return res.status(404).json({ error: 'Not found' });

  const productRate = truck.productRatePerLtr || 71.86;
  const productValue = Math.round(truck.quantityBL * productRate);
  const gstRate = 5; // 5% GST on ethanol product value
  const gstValue = Math.round(productValue * gstRate / 100);
  const totalValue = productValue + gstValue;
  const ist = new Date(truck.date.getTime() + 5.5 * 60 * 60 * 1000);
  const fmtDate = `${String(ist.getUTCDate()).padStart(2,'0')}.${String(ist.getUTCMonth()+1).padStart(2,'0')}.${ist.getUTCFullYear()}`;
  const fmtINR = (n: number) => n.toLocaleString('en-IN');

  const html = `<!DOCTYPE html><html><head><title>Delivery Challan</title>
<style>body{font-family:Arial,sans-serif;font-size:12px;padding:30px;line-height:1.6;color:#333}
.header{font-size:14px;font-weight:bold;text-align:center;margin-bottom:5px}
.company{text-align:center;font-size:11px;margin-bottom:15px;color:#555}
.row{display:flex;justify-content:space-between;margin-bottom:8px}
.label{font-weight:bold}
table{width:100%;border-collapse:collapse;margin:15px 0}
td,th{border:1px solid #333;padding:6px 10px;text-align:left;font-size:11px}
th{background:#f5f5f5;font-weight:600}
.right{text-align:right}
.bold{font-weight:bold}
</style></head><body>
<div class="header">Delivery Challan</div>
<div class="company">Mahakaushal Sugar And Power Industries Limited<br>Village Agariya, Bachai, District Narsinghpur, Madhya Pradesh - 487 001<br>GSTIN: 23AAECM3666P1Z1</div>
<hr>
<div class="row"><span>Challan No: <b>${truck.challanNo || '-'}</b></span><span>Date: <b>${fmtDate}</b></span></div>
<p>To,<br><b>${truck.contract?.buyerName || truck.partyName}</b><br>${truck.contract?.buyerAddress || ''}<br>GSTIN: ${truck.contract?.buyerGst || '-'}</p>
<p class="label">Details of Goods Delivered:</p>
<table>
<tr><th>Sno.</th><th>Description of Goods</th><th>Quantity</th><th>Unit</th><th class="right">Rate (Rs.)</th><th class="right">Value (inc.${gstRate}% GST)</th><th>Remarks</th></tr>
<tr><td>1</td><td>Ethanol</td><td class="right">${fmtINR(truck.quantityBL)} ltr</td><td>Litres</td><td class="right">${productRate}/ltr</td><td class="right">${fmtINR(totalValue)}/-</td><td>(produced on job work)</td></tr>
</table>
<p><i>(Distilling, Rectifying and Blending of Spirits)</i></p>
<p class="label">Delivery Details:</p>
<ul style="list-style:none;padding-left:5px">
<li>- Mode of Transport: By Road</li>
<li>- Vehicle No: <b>${truck.vehicleNo}</b></li>
<li>- Driver Name: ${truck.driverName || '-'}</li>
<li>- Mob No: ${truck.driverPhone ? '+91 ' + truck.driverPhone : '-'}</li>
<li>- Transport Name: ${truck.transporterName || '-'}</li>
<li>- Place of Supply: ${truck.destination || '-'}</li>
<li>- Purpose of Delivery: Delivery of Ethanol Spirit produced on job work basis</li>
</ul>
<p style="margin-top:20px"><b>Declaration:</b></p>
<p><i>We hereby declare that the goods mentioned above are being delivered as per the terms of job work and are subject to the conditions agreed upon between Mahakaushal Sugar and Power Industries Limited and ${truck.contract?.buyerName || truck.partyName}</i></p>
<br><br><p class="right bold">For Mahakaushal Sugar and Power Industries Limited<br><br><br><br>Authorized Signatory</p>
</body></html>`;

  try {
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'A4', margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' } });
    await browser.close();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Challan-${(truck.challanNo || truck.id).replace(/\//g, '-')}.pdf"`);
    res.send(pdf);
  } catch {
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  }
}));

// ── GET /:id/gate-pass-pdf ── Ethanol-specific gate pass
router.get('/:id/gate-pass-pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
  const truck = await prisma.dispatchTruck.findUnique({
    where: { id: req.params.id },
    include: { contract: { select: { contractNo: true, contractType: true, buyerName: true, buyerAddress: true, buyerGst: true, conversionRate: true, ethanolRate: true } } },
  });
  if (!truck) return res.status(404).json({ error: 'Not found' });

  const rate = truck.contract?.conversionRate || truck.contract?.ethanolRate || 14;
  const amount = Math.round(truck.quantityBL * rate);
  const ist = new Date(truck.date.getTime() + 5.5 * 60 * 60 * 1000);
  const fmtDate = `${String(ist.getUTCDate()).padStart(2,'0')}.${String(ist.getUTCMonth()+1).padStart(2,'0')}.${ist.getUTCFullYear()}`;
  const isJobWork = truck.contract?.contractType === 'JOB_WORK';
  const fmtINR = (n: number) => n.toLocaleString('en-IN');
  const fmtKg = (n: number | null) => n ? fmtINR(n) : '-';

  const html = `<!DOCTYPE html><html><head><title>Gate Pass</title>
<style>body{font-family:Arial,sans-serif;font-size:12px;padding:30px;line-height:1.5;color:#333}
.header{font-size:16px;font-weight:bold;text-align:center;margin-bottom:3px}
.sub{text-align:center;font-size:10px;color:#555;margin-bottom:15px}
.row{display:flex;justify-content:space-between;margin-bottom:5px;font-size:11px}
table{width:100%;border-collapse:collapse;margin:10px 0}
td,th{border:1px solid #333;padding:5px 8px;font-size:11px}
th{background:#f5f5f5;font-size:10px;font-weight:600}
.right{text-align:right}
.sig{display:flex;justify-content:space-between;margin-top:50px;font-size:10px}
.sig div{text-align:center;width:22%}
</style></head><body>
<div class="header">GATE PASS CUM CHALLAN</div>
<div class="sub">ETHANOL DISPATCH — ${isJobWork ? 'JOB WORK' : 'SALE'}</div>
<div class="row"><span>Gate Pass No: <b>${truck.gatePassNo || '-'}</b></span><span>Date: <b>${fmtDate}</b></span></div>
<div class="row"><span>Vehicle: <b>${truck.vehicleNo}</b></span><span>Driver: <b>${truck.driverName || '-'}</b> | ${truck.driverPhone || '-'}</span></div>
<div class="row"><span>Contract: <b>${truck.contract?.contractNo || '-'}</b></span><span>RST No: <b>${truck.rstNo || '-'}</b></span></div>
<div class="row"><span>Transporter: <b>${truck.transporterName || '-'}</b></span><span>Destination: <b>${truck.destination || '-'}</b></span></div>
<div class="row"><span>Seal No: <b>${truck.sealNo || '-'}</b></span><span></span></div>
<p style="font-size:11px;margin:8px 0"><b>Party:</b> ${truck.contract?.buyerName || truck.partyName}<br>${truck.contract?.buyerAddress || ''}<br>GSTIN: ${truck.contract?.buyerGst || '-'}</p>
<table>
<tr><th>Description</th><th>HSN/SAC</th><th class="right">Qty</th><th>Unit</th><th class="right">Rate</th><th class="right">Amount</th></tr>
<tr><td>${isJobWork ? 'Job Work Charges for Ethanol Production' : 'Ethanol'}</td><td>${isJobWork ? '998842' : '22072000'}</td><td class="right">${fmtINR(truck.quantityBL)}</td><td>BL</td><td class="right">${rate}</td><td class="right">${fmtINR(amount)}</td></tr>
</table>
<table>
<tr><th>Gross (KG)</th><th>Tare (KG)</th><th>Net (KG)</th><th>Volume (BL)</th><th>Strength %</th></tr>
<tr><td class="right">${fmtKg(truck.weightGross)}</td><td class="right">${fmtKg(truck.weightTare)}</td><td class="right">${fmtKg(truck.weightNet)}</td><td class="right">${fmtINR(truck.quantityBL)}</td><td class="right">${truck.strength || '-'}</td></tr>
</table>
<div class="sig">
<div>___________<br>Gate Keeper</div>
<div>___________<br>WB Operator</div>
<div>___________<br>Store In-Charge</div>
<div>___________<br>Auth. by MSPIL</div>
</div>
<p style="text-align:center;font-size:9px;color:#999;margin-top:20px">Computer Generated Gate Pass</p>
</body></html>`;

  try {
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'A4', margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' } });
    await browser.close();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="GatePass-${(truck.gatePassNo || truck.id).replace(/\//g, '-')}.pdf"`);
    res.send(pdf);
  } catch {
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  }
}));

// ── PUT /:id ── Update (pre-release only)
router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const truck = await prisma.dispatchTruck.findUnique({ where: { id: req.params.id } });
  if (!truck) return res.status(404).json({ error: 'Not found' });
  if (truck.status === 'RELEASED') return res.status(403).json({ error: 'Cannot edit released dispatch' });

  const allowed = ['vehicleNo', 'driverName', 'driverPhone', 'transporterName', 'distanceKm', 'destination', 'rstNo', 'sealNo', 'remarks', 'contractId'];
  const data: any = {};
  for (const f of allowed) {
    if (req.body[f] !== undefined) data[f] = req.body[f];
  }
  if (data.vehicleNo) data.vehicleNo = data.vehicleNo.toUpperCase().replace(/\s/g, '');
  if (data.distanceKm) data.distanceKm = parseInt(data.distanceKm);

  const updated = await prisma.dispatchTruck.update({ where: { id: req.params.id }, data });
  res.json(updated);
}));

// ── DELETE /:id ── Admin only, blocked after gate pass
router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const truck = await prisma.dispatchTruck.findUnique({ where: { id: req.params.id } });
  if (!truck) return res.status(404).json({ error: 'Not found' });
  if (truck.status === 'GROSS_WEIGHED' || truck.status === 'RELEASED') {
    return res.status(403).json({ error: 'Cannot delete after gate pass is issued' });
  }
  await prisma.dispatchTruck.delete({ where: { id: req.params.id } });
  res.json({ success: true });
}));

export default router;
