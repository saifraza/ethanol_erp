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

// GET /api/grain-truck — shift trucks (9AM to 9AM)
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const dateStr = req.query.date as string || currentShiftDate();
    const { start, end } = shiftWindow(dateStr);

    const trucks = await prisma.grainTruck.findMany({
      where: { date: { gte: start, lte: end } },
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
      where: { date: { gte: start, lte: end } },
    });

    // Partial quarantine: to silo = net - quarantineWeight
    const totalNet = trucks.reduce((s, t) => s + (t.weightNet - (t.quarantineWeight || 0)), 0);
    const quarantineNet = trucks.reduce((s, t) => s + (t.quarantineWeight || 0), 0);
    const totalReceived = trucks.reduce((s, t) => s + t.weightNet, 0); // all net weight incl quarantine
    const truckCount = trucks.length;

    res.json({ totalNet, quarantineNet, totalReceived, truckCount });
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

    const gross = parseFloat(weightGross) || 0;
    const tare = parseFloat(weightTare) || 0;
    const qWeight = parseFloat(quarantineWeight) || 0;
    const photoUrl = req.file ? `/uploads/grain-truck/${req.file.filename}` : null;

    const truck = await prisma.grainTruck.create({
      data: {
        date: truckDate,
        uidRst: uidRst || '',
        vehicleNo: vehicleNo || '',
        supplier: supplier || '',
        weightGross: gross,
        weightTare: tare,
        weightNet: gross - tare,
        quarantineWeight: qWeight,
        moisture: moisture ? parseFloat(moisture) : null,
        starchPercent: starchPercent ? parseFloat(starchPercent) : null,
        damagedPercent: damagedPercent ? parseFloat(damagedPercent) : null,
        foreignMatter: foreignMatter ? parseFloat(foreignMatter) : null,
        quarantine: (quarantine === 'true' || quarantine === true) || qWeight > 0,
        quarantineReason: quarantineReason || null,
        photoUrl,
        bags: bags ? parseFloat(bags) : null,
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
    const data: any = {};
    if (quarantine !== undefined) data.quarantine = quarantine === 'true' || quarantine === true;
    if (quarantineReason !== undefined) data.quarantineReason = quarantineReason || null;
    if (quarantineWeight !== undefined) {
      data.quarantineWeight = parseFloat(quarantineWeight) || 0;
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
      const filePath = path.join(__dirname, '..', '..', t.photoUrl);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    await prisma.grainTruck.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
