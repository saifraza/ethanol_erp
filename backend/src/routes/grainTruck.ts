import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import prisma from '../config/prisma';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', '..', 'uploads', 'grain-truck');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// IST offset: UTC+5:30 = 5.5 hours = 330 minutes
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Helper: get current time in IST
function nowIST(): Date {
  return new Date(Date.now() + IST_OFFSET_MS);
}

// Helper: get shift window (9AM IST on date to 9AM IST next day) — returned as UTC
function shiftWindow(dateStr: string) {
  // dateStr is YYYY-MM-DD; 9AM IST = 3:30 AM UTC
  const start = new Date(dateStr + 'T03:30:00.000Z');
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

// Helper: get current shift date — if before 9AM IST, it's yesterday's shift
function currentShiftDate(): string {
  const ist = nowIST();
  if (ist.getUTCHours() < 9) ist.setUTCDate(ist.getUTCDate() - 1);
  return ist.toISOString().split('T')[0];
}

function shiftDateFor(date: Date): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  if (ist.getUTCHours() < 9) ist.setUTCDate(ist.getUTCDate() - 1);
  return ist.toISOString().split('T')[0];
}

function invalidTruckWeightMessage(weightNet: number, quarantineWeight: number) {
  if (weightNet < 0) return 'Gross weight cannot be less than tare weight';
  if (quarantineWeight < 0) return 'Quarantine weight cannot be negative';
  if (quarantineWeight > weightNet) return 'Quarantine weight cannot be greater than net weight';
  return null;
}

function parseNumericField(value: any) {
  if (value === undefined || value === null || value === '') {
    return { provided: false, valid: true, value: null as number | null };
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return { provided: true, valid: false, value: null as number | null };
  }
  return { provided: true, valid: true, value: parsed };
}

function validateNonNegativeNumber(label: string, parsed: ReturnType<typeof parseNumericField>) {
  if (!parsed.valid) return `${label} must be a valid number`;
  if (parsed.value != null && parsed.value < 0) return `${label} cannot be negative`;
  return null;
}

function validatePercentageNumber(label: string, parsed: ReturnType<typeof parseNumericField>) {
  const err = validateNonNegativeNumber(label, parsed);
  if (err) return err;
  if (parsed.value != null && parsed.value > 100) return `${label} must be between 0 and 100`;
  return null;
}

function summarizeTrucks(trucks: any[]) {
  const totalReceived = trucks.reduce((s, t) => s + (t.weightNet || 0), 0);
  const quarantine = trucks.reduce((s, t) => s + (t.quarantineWeight || 0), 0);
  const toSilo = trucks.reduce((s, t) => s + (t.toSilo ?? ((t.weightNet || 0) - (t.quarantineWeight || 0))), 0);
  const invalidCount = trucks.filter(t => t.invalidQuarantine).length;

  return {
    totalReceived,
    quarantine,
    toSilo,
    truckCount: trucks.length,
    avgTruckWeight: trucks.length ? totalReceived / trucks.length : 0,
    avgToSilo: trucks.length ? toSilo / trucks.length : 0,
    invalidCount,
  };
}

// GET /api/grain-truck — shift trucks (9AM to 9AM)
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const dateStr = req.query.date as string || currentShiftDate();
    const { start, end } = shiftWindow(dateStr);

    const trucks = await prisma.grainTruck.findMany({
      where: {
        date: { gte: start, lt: end },
        NOT: { remarks: { contains: '| FUEL |' } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Summaries — partial quarantine: to silo = net - quarantineWeight per truck
    const totalNet = trucks.reduce((s, t) => s + (t.weightNet - (t.quarantineWeight || 0)), 0);
    const quarantineNet = trucks.reduce((s, t) => s + (t.quarantineWeight || 0), 0);

    res.json({ trucks, totalNet, quarantineNet, count: trucks.length });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/grain-truck/summary — shift totals (9AM to 9AM) for grain stock page
router.get('/summary', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const dateStr = req.query.date as string || currentShiftDate();
    const { start, end } = shiftWindow(dateStr);

    const trucks = await prisma.grainTruck.findMany({
      where: {
        date: { gte: start, lt: end },
        NOT: { remarks: { contains: '| FUEL |' } },
      },
    });

    // Partial quarantine: to silo = net - quarantineWeight
    const totalNet = trucks.reduce((s, t) => s + (t.weightNet - (t.quarantineWeight || 0)), 0);
    const quarantineNet = trucks.reduce((s, t) => s + (t.quarantineWeight || 0), 0);
    const totalReceived = trucks.reduce((s, t) => s + t.weightNet, 0); // all net weight incl quarantine
    const truckCount = trucks.length;

    res.json({ totalNet, quarantineNet, totalReceived, truckCount });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/grain-truck/report — baseline-to-date received report with filters
router.get('/report', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const yearStart = Number(req.query.year) || new Date().getFullYear();
    const baseline = await prisma.grainEntry.findFirst({
      where: { yearStart },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, date: true, createdAt: true, cumulativeUnloaded: true },
    });

    const rangeStart = baseline?.createdAt ?? new Date(Date.UTC(yearStart, 0, 1));
    const rangeEnd = new Date(Date.UTC(yearStart + 1, 0, 1));
    const rows = await prisma.grainTruck.findMany({
      where: {
        date: { gt: rangeStart, lt: rangeEnd },
      },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });

    const trucks = rows.map((t) => {
      const shiftDate = shiftDateFor(t.date);
      const quarantineWeight = t.quarantineWeight || 0;
      const weightNet = t.weightNet || 0;
      return {
        ...t,
        shiftDate,
        supplier: t.supplier || 'Unknown',
        toSilo: weightNet - quarantineWeight,
        invalidQuarantine: quarantineWeight > weightNet,
      };
    });

    const firstShiftDate = trucks[0]?.shiftDate ?? shiftDateFor(rangeStart);
    const lastShiftDate = trucks[trucks.length - 1]?.shiftDate ?? currentShiftDate();

    const from = typeof req.query.from === 'string' && req.query.from ? req.query.from : firstShiftDate;
    const to = typeof req.query.to === 'string' && req.query.to ? req.query.to : lastShiftDate;
    const supplier = typeof req.query.supplier === 'string' ? req.query.supplier.trim() : '';
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    const quarantine = req.query.quarantine === 'yes' || req.query.quarantine === 'no'
      ? req.query.quarantine
      : 'all';

    if (from > to) {
      res.status(400).json({ error: 'From Shift cannot be after To Shift' });
      return;
    }

    const filtered = trucks.filter((t) => {
      if (t.shiftDate < from || t.shiftDate > to) return false;
      if (supplier && t.supplier !== supplier) return false;
      if (quarantine === 'yes' && !(t.quarantineWeight > 0)) return false;
      if (quarantine === 'no' && t.quarantineWeight > 0) return false;
      if (search) {
        const haystack = `${t.vehicleNo || ''} ${t.uidRst || ''} ${t.supplier || ''}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });

    const dailyMap: Record<string, any> = {};
    for (const t of filtered) {
      if (!dailyMap[t.shiftDate]) {
        dailyMap[t.shiftDate] = { shiftDate: t.shiftDate, truckCount: 0, totalReceived: 0, quarantine: 0, toSilo: 0, invalidCount: 0 };
      }
      dailyMap[t.shiftDate].truckCount += 1;
      dailyMap[t.shiftDate].totalReceived += t.weightNet || 0;
      dailyMap[t.shiftDate].quarantine += t.quarantineWeight || 0;
      dailyMap[t.shiftDate].toSilo += t.toSilo || 0;
      dailyMap[t.shiftDate].invalidCount += t.invalidQuarantine ? 1 : 0;
    }

    const supplierMap: Record<string, any> = {};
    for (const t of filtered) {
      const key = t.supplier || 'Unknown';
      if (!supplierMap[key]) {
        supplierMap[key] = { supplier: key, truckCount: 0, totalReceived: 0, quarantine: 0, toSilo: 0 };
      }
      supplierMap[key].truckCount += 1;
      supplierMap[key].totalReceived += t.weightNet || 0;
      supplierMap[key].quarantine += t.quarantineWeight || 0;
      supplierMap[key].toSilo += t.toSilo || 0;
    }

    const allSummary = summarizeTrucks(trucks);
    const filteredSummary = summarizeTrucks(filtered);
    const baselineReceived = baseline?.cumulativeUnloaded ?? 0;

    res.json({
      baseline: baseline ? {
        id: baseline.id,
        date: baseline.date,
        createdAt: baseline.createdAt,
        cumulativeUnloaded: baseline.cumulativeUnloaded,
      } : null,
      defaults: {
        from: firstShiftDate,
        to: lastShiftDate,
        supplier: '',
        search: '',
        quarantine: 'all',
      },
      filters: { from, to, supplier, search, quarantine },
      summary: {
        ...filteredSummary,
        baselineReceived,
        filteredLiveTotal: baselineReceived + filteredSummary.totalReceived,
        allLiveTotal: baselineReceived + allSummary.totalReceived,
        allTruckCount: allSummary.truckCount,
      },
      daily: Object.values(dailyMap).sort((a: any, b: any) => a.shiftDate.localeCompare(b.shiftDate)),
      suppliers: Object.values(supplierMap).sort((a: any, b: any) => b.totalReceived - a.totalReceived),
      availableSuppliers: Array.from(new Set(trucks.map(t => t.supplier || 'Unknown'))).sort(),
      trucks: filtered,
      totalRows: filtered.length,
      allRows: trucks.length,
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/grain-truck/history — past trucks grouped by date
router.get('/history', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // Use IST midnight (= previous day 18:30 UTC)
    const ist = nowIST();
    const todayStr = ist.toISOString().split('T')[0];
    const today = new Date(todayStr + 'T00:00:00.000+05:30');

    const trucks = await prisma.grainTruck.findMany({
      where: { date: { lt: today } },
      orderBy: { date: 'desc' },
      take: 200,
    });

    const grouped: Record<string, any[]> = {};
    for (const t of trucks) {
      const key = t.date.toISOString().split('T')[0];
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(t);
    }

    res.json({ history: grouped });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /api/grain-truck — create truck entry with optional photo
router.post('/', authenticate, upload.single('photo'), async (req: AuthRequest, res: Response) => {
  try {
    const { vehicleNo, supplier, weightGross, weightTare, moisture, starchPercent,
      damagedPercent, foreignMatter, quarantine, quarantineWeight, quarantineReason,
      remarks, date, uidRst, bags } = req.body;

    // Check for duplicate UID/RST
    if (uidRst && uidRst.trim()) {
      const existing = await prisma.grainTruck.findFirst({ where: { uidRst: uidRst.trim() } });
      if (existing) {
        res.status(409).json({ error: `Truck with UID/RST "${uidRst.trim()}" already exists (${existing.vehicleNo}, ${existing.date.toISOString().split('T')[0]})` });
        return;
      }
    }

    // Always use server's current time — ensures truck falls in the correct shift window
    const truckDate = new Date();

    const grossInput = parseNumericField(weightGross);
    const tareInput = parseNumericField(weightTare);
    const qWeightInput = parseNumericField(quarantineWeight);
    const moistureInput = parseNumericField(moisture);
    const starchInput = parseNumericField(starchPercent);
    const damagedInput = parseNumericField(damagedPercent);
    const foreignMatterInput = parseNumericField(foreignMatter);
    const bagsInput = parseNumericField(bags);

    const numericError = [
      validateNonNegativeNumber('Gross weight', grossInput),
      validateNonNegativeNumber('Tare weight', tareInput),
      validateNonNegativeNumber('Quarantine weight', qWeightInput),
      validatePercentageNumber('Moisture', moistureInput),
      validatePercentageNumber('Starch', starchInput),
      validatePercentageNumber('Damaged', damagedInput),
      validatePercentageNumber('Foreign matter', foreignMatterInput),
      validateNonNegativeNumber('Bags', bagsInput),
    ].find(Boolean);
    if (numericError) {
      res.status(400).json({ error: numericError });
      return;
    }

    const gross = grossInput.value ?? 0;
    const tare = tareInput.value ?? 0;
    const qWeight = qWeightInput.value ?? 0;
    const weightNet = gross - tare;
    const weightError = invalidTruckWeightMessage(weightNet, qWeight);
    if (weightError) {
      res.status(400).json({ error: weightError });
      return;
    }
    const photoUrl = req.file ? `/uploads/grain-truck/${req.file.filename}` : null;

    const truck = await prisma.grainTruck.create({
      data: {
        date: truckDate,
        uidRst: uidRst || '',
        vehicleNo: vehicleNo || '',
        supplier: supplier || '',
        weightGross: gross,
        weightTare: tare,
        weightNet,
        quarantineWeight: qWeight,
        moisture: moistureInput.value,
        starchPercent: starchInput.value,
        damagedPercent: damagedInput.value,
        foreignMatter: foreignMatterInput.value,
        quarantine: (quarantine === 'true' || quarantine === true) || qWeight > 0,
        quarantineReason: quarantineReason || null,
        photoUrl,
        bags: bagsInput.value,
        remarks: remarks || null,
        userId: req.user!.id,
      },
    });
    res.status(201).json(truck);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /api/grain-truck/:id — ADMIN only
router.put('/:id', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { quarantine, quarantineReason, quarantineWeight, uidRst } = req.body;
    const existing = await prisma.grainTruck.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: 'Truck not found' });
      return;
    }
    const data: any = {};
    if (quarantine !== undefined) data.quarantine = quarantine === 'true' || quarantine === true;
    if (quarantineReason !== undefined) data.quarantineReason = quarantineReason || null;
    if (quarantineWeight !== undefined) {
      const qWeightInput = parseNumericField(quarantineWeight);
      const numericError = validateNonNegativeNumber('Quarantine weight', qWeightInput);
      if (numericError) {
        res.status(400).json({ error: numericError });
        return;
      }
      const qWeight = qWeightInput.value ?? 0;
      const weightError = invalidTruckWeightMessage(existing.weightNet, qWeight);
      if (weightError) {
        res.status(400).json({ error: weightError });
        return;
      }
      data.quarantineWeight = qWeight;
      data.quarantine = data.quarantineWeight > 0;
    }
    if (uidRst !== undefined) data.uidRst = uidRst || '';
    const truck = await prisma.grainTruck.update({ where: { id: req.params.id }, data });
    res.json(truck);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/grain-truck/:id — ADMIN only
router.delete('/:id', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const t = await prisma.grainTruck.findUnique({ where: { id: req.params.id } });
    if (t?.photoUrl) {
      // photoUrl is like "/uploads/grain-truck/xxx.jpg" — strip leading slash and validate with basename
      const filename = path.basename(t.photoUrl.replace(/^\//, ''));
      const filePath = path.join(__dirname, '../../uploads/grain-truck', filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    await prisma.grainTruck.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
