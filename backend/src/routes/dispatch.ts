import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import prisma from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { recomputeEthanolEntryByDate } from './ethanolProduct';

const router = Router();

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', '..', 'uploads', 'dispatch');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB max

// GET /api/dispatch/active-contracts — active ethanol contracts for party dropdown
router.get('/active-contracts', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const contracts = await prisma.ethanolContract.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true, contractNo: true, contractType: true, buyerName: true,
        ethanolRate: true, conversionRate: true, omcName: true, omcDepot: true,
        autoGenerateEInvoice: true,
      },
      orderBy: { buyerName: 'asc' },
    });
    res.json({ contracts });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/dispatch — list standalone dispatches
// ?date=YYYY-MM-DD  — single date (default: today)
// ?from=ISO&to=ISO   — date range (for production calc: dispatches since last entry)
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    let start: Date, end: Date;
    if (req.query.from) {
      start = new Date(req.query.from as string);
      end = req.query.to ? new Date(req.query.to as string) : new Date();
      end.setHours(23, 59, 59, 999);
    } else {
      const dateStr = req.query.date as string || new Date().toISOString().split('T')[0];
      start = new Date(dateStr);
      start.setHours(0, 0, 0, 0);
      end = new Date(dateStr);
      end.setHours(23, 59, 59, 999);
    }

    if (req.query.from) {
      // Range mode: use Weighment mirror (matches getStandaloneDispatch in ethanolProduct.ts)
      // Actual weighment time, not DispatchTruck.createdAt
      const weighments = await prisma.weighment.findMany({
        where: {
          direction: 'OUTBOUND',
          cancelled: false,
          status: { in: ['COMPLETE', 'COMPLETED', 'RELEASED'] },
          secondWeightAt: { gt: start, lte: end },
          OR: [
            { materialCategory: 'ETHANOL' },
            { materialName: { contains: 'Ethanol', mode: 'insensitive' } },
          ],
        },
        select: {
          id: true, ticketNo: true, vehicleNo: true, materialName: true,
          grossWeight: true, tareWeight: true, netWeight: true, quantityBL: true,
          strength: true, sealNo: true, rstNo: true, customerName: true,
          secondWeightAt: true,
        },
        orderBy: { secondWeightAt: 'desc' },
      });
      // Map to dispatch-like shape for frontend compatibility
      const dispatches = weighments.map(w => ({
        id: w.id, ticketNo: w.ticketNo, vehicleNo: w.vehicleNo,
        productName: w.materialName, grossWeight: w.grossWeight,
        tareWeight: w.tareWeight, netWeight: w.netWeight,
        quantityBL: w.quantityBL, strength: w.strength,
        sealNo: w.sealNo, rstNo: w.rstNo, customerName: w.customerName,
        createdAt: w.secondWeightAt,
      }));
      return res.json({ dispatches });
    }

    // Single-date mode: use DispatchTruck (legacy)
    const dateFilter = { date: { gte: start, lte: end } };
    const dispatches = await prisma.dispatchTruck.findMany({
      where: { ...dateFilter, entryId: null },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ dispatches });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/dispatch/totals — all-time dispatch sum
// Uses EthanolProductEntry.totalDispatch as the source of truth (includes seeded historical data)
// DispatchTruck table only has individual truck records entered after ERP went live
router.get('/totals', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // Total dispatch from ethanol product entries (includes historical seeded data)
    const epTotal = await prisma.ethanolProductEntry.aggregate({
      _sum: { totalDispatch: true },
    });
    const totalFromEntries = epTotal._sum.totalDispatch || 0;

    // Also count standalone dispatches NOT yet included in any ethanol entry
    const lastEntry = await prisma.ethanolProductEntry.findFirst({
      orderBy: { date: 'desc' },
      select: { date: true },
    });
    let standaloneExtra = 0;
    let standaloneCount = 0;
    if (lastEntry) {
      // Use Weighment mirror (matches getStandaloneDispatch in ethanolProduct.ts)
      const standalone = await prisma.weighment.findMany({
        where: {
          direction: 'OUTBOUND',
          cancelled: false,
          status: { in: ['COMPLETE', 'COMPLETED', 'RELEASED'] },
          secondWeightAt: { gt: lastEntry.date },
          OR: [
            { materialCategory: 'ETHANOL' },
            { materialName: { contains: 'Ethanol', mode: 'insensitive' } },
          ],
        },
        select: { quantityBL: true },
      });
      standaloneExtra = standalone.reduce((s, w) => s + (w.quantityBL || 0), 0);
      standaloneCount = standalone.length;
    }

    // Total truck count (all individual truck records)
    const truckCount = await prisma.dispatchTruck.count({ where: { entryId: null } });

    res.json({
      totalDispatched: totalFromEntries + standaloneExtra,
      count: truckCount + standaloneCount,
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/dispatch/history — past dispatches grouped by date (before today 9AM cutoff)
router.get('/history', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // History = everything before today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dispatches = await prisma.dispatchTruck.findMany({
      where: { date: { lt: today }, entryId: null },
      orderBy: { date: 'desc' },
      take: 200,
    });

    // Group by date
    const grouped: Record<string, any[]> = {};
    for (const d of dispatches) {
      const key = d.date.toISOString().split('T')[0];
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(d);
    }

    res.json({ history: grouped });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/dispatch/report — reporting endpoint (all dispatches, date range, aggregates)
router.get('/report', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const fromStr = req.query.from as string;
    const toStr = req.query.to as string;
    const status = req.query.status as string;
    const search = req.query.search as string;

    // Default: last 7 days
    const now = new Date();
    const end = toStr ? new Date(toStr + 'T23:59:59.999Z') : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const start = fromStr ? new Date(fromStr + 'T00:00:00.000Z') : new Date(end.getTime() - 7 * 86400000);

    const where: any = { date: { gte: start, lte: end } };
    if (status && status !== 'ALL') where.status = status;
    if (search) where.partyName = { contains: search, mode: 'insensitive' };

    const [dispatches, agg, releasedCount] = await Promise.all([
      prisma.dispatchTruck.findMany({
        where,
        orderBy: { date: 'desc' },
        take: 500,
        select: {
          id: true, date: true, vehicleNo: true, partyName: true, destination: true,
          quantityBL: true, strength: true, status: true, gateInTime: true, releaseTime: true,
          weightGross: true, weightTare: true, weightNet: true,
          contractId: true, photoUrl: true, remarks: true, sealNo: true, rstNo: true,
          driverName: true, transporterName: true, gatePassNo: true, challanNo: true,
          contract: { select: { contractNo: true, buyerName: true } },
        },
      }),
      prisma.dispatchTruck.aggregate({
        where,
        _sum: { quantityBL: true },
        _count: true,
      }),
      prisma.dispatchTruck.count({ where: { ...where, status: 'RELEASED' } }),
    ]);

    const totalBL = agg._sum.quantityBL || 0;
    const totalTrucks = agg._count || 0;

    res.json({
      dispatches,
      summary: {
        totalBL: Math.round(totalBL * 100) / 100,
        totalTrucks,
        avgPerTruck: totalTrucks > 0 ? Math.round(totalBL / totalTrucks * 100) / 100 : 0,
        releasedCount,
      },
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /api/dispatch — create a dispatch entry with optional photo + optional lifting
router.post('/', authenticate, upload.single('photo'), async (req: AuthRequest, res: Response) => {
  try {
    const { vehicleNo, partyName, destination, quantityBL, strength, remarks, date, batchNo,
            contractId, driverName, driverPhone, driverLicense, transporterName, distanceKm,
            rstNo, sealNo, pesoDate } = req.body;
    const dispatchDate = date ? new Date(date) : new Date();
    dispatchDate.setHours(new Date().getHours(), new Date().getMinutes());

    const photoUrl = req.file ? `/uploads/dispatch/${req.file.filename}` : null;
    const qtyBL = parseFloat(quantityBL) || 0;
    const qtyKL = qtyBL / 1000;

    const dispatch = await prisma.dispatchTruck.create({
      data: {
        date: dispatchDate,
        batchNo: batchNo || '',
        vehicleNo: vehicleNo || '',
        partyName: partyName || '',
        destination: destination || '',
        quantityBL: qtyBL,
        strength: strength ? parseFloat(strength) : null,
        photoUrl,
        remarks: remarks || null,
        userId: req.user!.id,
        contractId: contractId || null,
        driverName: driverName || null,
        driverPhone: driverPhone || null,
        driverLicense: driverLicense || null,
        transporterName: transporterName || null,
        distanceKm: distanceKm ? parseInt(distanceKm) : null,
        rstNo: rstNo || null,
        sealNo: sealNo || null,
        pesoDate: pesoDate || null,
      },
    });

    // If linked to a contract, auto-create a lifting
    let lifting: any = null;
    if (contractId) {
      try {
        const contract = await prisma.ethanolContract.findUnique({ where: { id: contractId } });
        if (contract) {
          // Calculate rate/amount from contract
          let rate: number | null = null;
          if (contract.contractType === 'JOB_WORK') rate = contract.conversionRate;
          else rate = contract.ethanolRate;
          const amount = rate ? qtyBL * rate : null;

          lifting = await prisma.ethanolLifting.create({
            data: {
              contractId,
              liftingDate: dispatchDate,
              vehicleNo: vehicleNo || '',
              driverName: driverName || null,
              driverPhone: driverPhone || null,
              transporterName: transporterName || null,
              destination: destination || contract.omcDepot || null,
              quantityBL: qtyBL,
              quantityKL: qtyKL,
              strength: strength ? parseFloat(strength) : null,
              rate,
              amount,
              distanceKm: distanceKm ? parseInt(distanceKm) : null,
              status: 'LOADED',
              userId: req.user!.id,
            },
          });

          // Link dispatch → lifting
          await prisma.dispatchTruck.update({
            where: { id: dispatch.id },
            data: { liftingId: lifting.id },
          });

          // Update contract totals
          await prisma.ethanolContract.update({
            where: { id: contractId },
            data: {
              totalSuppliedKL: { increment: qtyKL },
              totalInvoicedAmt: amount ? { increment: amount } : undefined,
            },
          });

          // Auto e-invoice if enabled (fire-and-forget)
          if (contract.autoGenerateEInvoice && rate && amount && contract.buyerGst) {
            setImmediate(async () => {
              try {
                const { generateIRN, generateEWBByIRN } = await import('../services/eInvoice');

                // Resolve customer
                let custId = contract.buyerCustomerId;
                if (!custId) {
                  let cust = await prisma.customer.findFirst({ where: { gstNo: contract.buyerGst! } });
                  if (!cust) {
                    cust = await prisma.customer.create({
                      data: { name: contract.buyerName, gstNo: contract.buyerGst, address: contract.buyerAddress, phone: contract.buyerPhone, email: contract.buyerEmail },
                    });
                  }
                  custId = cust.id;
                  await prisma.ethanolContract.update({ where: { id: contractId }, data: { buyerCustomerId: custId } });
                }
                const cust = await prisma.customer.findUnique({ where: { id: custId! } });
                if (!cust) return;

                // Create invoice
                const gstPct = contract.gstPercent || 18;
                const gstAmt = Math.round(amount! * gstPct / 100 * 100) / 100;
                const isInter = cust.state && cust.state !== 'Madhya Pradesh';
                const total = Math.round((amount! + gstAmt) * 100) / 100;

                const inv = await prisma.invoice.create({
                  data: {
                    customerId: cust.id, invoiceDate: dispatchDate, productName: 'ETHANOL',
                    quantity: qtyBL, unit: 'LTR', rate: rate!, amount: amount!,
                    gstPercent: gstPct, gstAmount: gstAmt,
                    supplyType: isInter ? 'INTER_STATE' : 'INTRA_STATE',
                    cgstPercent: isInter ? 0 : gstPct / 2, cgstAmount: isInter ? 0 : Math.round(gstAmt / 2 * 100) / 100,
                    sgstPercent: isInter ? 0 : gstPct / 2, sgstAmount: isInter ? 0 : Math.round(gstAmt / 2 * 100) / 100,
                    igstPercent: isInter ? gstPct : 0, igstAmount: isInter ? gstAmt : 0,
                    totalAmount: total, balanceAmount: total, status: 'UNPAID', userId: 'system',
                  },
                });
                await prisma.ethanolLifting.update({ where: { id: lifting.id }, data: { invoiceId: inv.id, invoiceNo: `INV-${inv.invoiceNo}` } });

                // Generate IRN
                if (cust.gstNo && cust.state && cust.pincode && cust.address) {
                  const irnRes = await generateIRN({
                    invoiceNo: `INV-${inv.invoiceNo}`, invoiceDate: inv.invoiceDate,
                    productName: 'ETHANOL', quantity: inv.quantity, unit: 'LTR', rate: inv.rate, amount: inv.amount, gstPercent: inv.gstPercent,
                    customer: { gstin: cust.gstNo, name: cust.name, address: cust.address, city: cust.city || '', pincode: cust.pincode, state: cust.state, phone: cust.phone || '', email: cust.email || '' },
                  });
                  if (irnRes.success && irnRes.irn) {
                    await prisma.invoice.update({ where: { id: inv.id }, data: { irn: irnRes.irn, irnDate: new Date(), irnStatus: 'GENERATED', ackNo: irnRes.ackNo ? String(irnRes.ackNo) : null, signedQRCode: irnRes.signedQRCode?.slice(0, 4000) || null } as any });
                    // Generate EWB
                    const vehNo = (vehicleNo || '').replace(/\s/g, '');
                    const dist = distanceKm ? parseInt(distanceKm) : 100;
                    const ewbData: Record<string, any> = { Irn: irnRes.irn, Distance: dist, TransMode: '1', VehNo: vehNo, VehType: 'R' };
                    if (transporterName && transporterName.length >= 3) ewbData.TransName = transporterName;
                    const ewbRes = await generateEWBByIRN(irnRes.irn, ewbData);
                    if (ewbRes.success && ewbRes.ewayBillNo) {
                      await prisma.invoice.update({ where: { id: inv.id }, data: { ewbNo: ewbRes.ewayBillNo, ewbDate: new Date(), ewbStatus: 'GENERATED' } as any });
                    }
                  }
                }
                console.log(`[Dispatch] Auto e-invoice complete for dispatch ${dispatch.id}`);
              } catch (err: any) {
                console.error(`[Dispatch] Auto e-invoice failed:`, err.message);
              }
            });
          }
        }
      } catch (liftErr: any) {
        console.error('[Dispatch] Lifting creation failed:', liftErr.message);
        // Dispatch still saved, lifting failed — non-blocking
      }
    }

    // Backfill: recompute enclosing ethanol entry so late-arriving standalone trucks
    // don't leave stale negative production / KLPD on the window's entry
    try { await recomputeEthanolEntryByDate(dispatchDate); } catch (e: any) {
      console.error('[Dispatch] recomputeEthanolEntry failed for', dispatchDate.toISOString(), ':', e.message);
    }

    res.status(201).json({ ...dispatch, lifting, contractNo: lifting ? 'linked' : null });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/dispatch/:id
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const d = await prisma.dispatchTruck.findUnique({ where: { id: req.params.id } });
    if (d?.photoUrl) {
      const filename = path.basename(d.photoUrl.replace(/^\//, ''));
      const filePath = path.join(__dirname, '../../uploads/dispatch', filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    const truckDate = d?.date;
    await prisma.dispatchTruck.delete({ where: { id: req.params.id } });
    if (truckDate) {
      try { await recomputeEthanolEntryByDate(truckDate); } catch (e: any) {
        console.error('[Dispatch] recomputeEthanolEntry failed for', truckDate.toISOString(), ':', e.message);
      }
    }
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Serve uploaded photos
router.get('/photo/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(uploadsDir, filename);
  if (!filePath.startsWith(path.resolve(uploadsDir))) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: 'Photo not found' });
  }
});

export default router;
