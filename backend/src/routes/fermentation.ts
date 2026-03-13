import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

/* ═══════ MULTER for spent-loss photos ═══════ */
const uploadDir = path.join(__dirname, '../../uploads/spent-loss');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

router.use(authenticate as any);

/* ═══════ CHEMICALS (shared with PF) ═══════ */
router.get('/chemicals', async (_req: Request, res: Response) => {
  const chemicals = await prisma.pFChemical.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  res.json(chemicals);
});

/* ═══════ BATCHES (lifecycle) ═══════ */
router.get('/batches', async (_req: Request, res: Response) => {
  const batches = await prisma.fermentationBatch.findMany({
    orderBy: { createdAt: 'desc' }, take: 100,
    include: { dosings: { orderBy: { addedAt: 'asc' } } }
  });
  res.json(batches);
});

router.post('/batches', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const batch = await prisma.fermentationBatch.create({
      data: {
        batchNo: parseInt(b.batchNo) || 0,
        fermenterNo: parseInt(b.fermenterNo) || 1,
        phase: 'FILLING',
        fillingStartTime: b.fillingStartTime ? new Date(b.fillingStartTime) : new Date(),
        fermLevel: b.fermLevel ? parseFloat(b.fermLevel) : null,
        volume: b.fermLevel ? parseFloat((parseFloat(b.fermLevel) / 100 * 2300 * 1000).toFixed(0)) : (b.volume ? parseFloat(b.volume) : null),
        setupGravity: b.setupGravity ? parseFloat(b.setupGravity) : null,
        remarks: b.remarks || null,
        userId: (req as any).user?.id || 'unknown'
      },
      include: { dosings: true }
    });
    res.status(201).json(batch);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

router.patch('/batches/:id', async (req: Request, res: Response) => {
  try {
    const data: any = {};
    const b = req.body;
    // phase
    if (b.phase) data.phase = b.phase;
    // time fields
    for (const f of ['fillingStartTime', 'fillingEndTime', 'setupEndTime', 'reactionStartTime', 'retentionStartTime', 'transferTime', 'cipStartTime', 'cipEndTime']) {
      if (b[f] !== undefined) data[f] = b[f] ? new Date(b[f]) : null;
    }
    // numeric
    for (const f of ['volume', 'fermLevel', 'transferVolume', 'setupGravity', 'setupRs', 'setupRst', 'finalRsGravity', 'totalHours', 'finalAlcohol']) {
      if (b[f] !== undefined) data[f] = b[f] ? parseFloat(b[f]) : null;
    }
    // string
    for (const f of ['remarks', 'yeast', 'enzyme', 'formolin', 'booster', 'urea', 'setupTime']) {
      if (b[f] !== undefined) data[f] = b[f] || null;
    }
    // int
    if (b.beerWellNo !== undefined) data.beerWellNo = b.beerWellNo ? parseInt(b.beerWellNo) : null;
    if (b.setupDate !== undefined) data.setupDate = b.setupDate ? new Date(b.setupDate) : null;
    if (b.finalDate !== undefined) data.finalDate = b.finalDate ? new Date(b.finalDate) : null;

    const batch = await prisma.fermentationBatch.update({
      where: { id: req.params.id }, data,
      include: { dosings: true }
    });
    res.json(batch);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

router.delete('/batches/:id', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  await prisma.fermentationBatch.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

/* ═══════ DOSING ═══════ */
router.post('/batches/:id/dosing', async (req: Request, res: Response) => {
  try {
    const { chemicalName, quantity, unit, level } = req.body;
    await prisma.fermDosing.create({
      data: { batchId: req.params.id, chemicalName, quantity: parseFloat(quantity) || 0, unit: unit || 'kg', level: level ? parseFloat(level) : null }
    });
    const updated = await prisma.fermentationBatch.findUnique({ where: { id: req.params.id }, include: { dosings: true } });
    res.status(201).json(updated);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

router.delete('/dosing/:id', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  await prisma.fermDosing.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

/* ═══════ LAB READINGS (existing FermentationEntry) ═══════ */
router.get('/', async (_req: Request, res: Response) => {
  const entries = await prisma.fermentationEntry.findMany({ orderBy: { date: 'desc' }, take: 500 });
  res.json(entries);
});

router.get('/fermenter/:no', async (req: Request, res: Response) => {
  const fermenterNo = parseInt(req.params.no);
  const entries = await prisma.fermentationEntry.findMany({
    where: { fermenterNo }, orderBy: { date: 'desc' }, take: 200
  });
  res.json(entries);
});

router.get('/batch/:batchNo', async (req: Request, res: Response) => {
  const batchNo = parseInt(req.params.batchNo);
  const entries = await prisma.fermentationEntry.findMany({
    where: { batchNo }, orderBy: [{ date: 'asc' }, { analysisTime: 'asc' }]
  });
  res.json(entries);
});

router.post('/', upload.single('spentLossPhoto'), async (req: Request, res: Response) => {
  const b = req.body;
  const entry = await prisma.fermentationEntry.create({
    data: {
      date: new Date(b.date), analysisTime: b.analysisTime || '',
      batchNo: parseInt(b.batchNo) || 0, fermenterNo: parseInt(b.fermenterNo) || 1,
      level: b.level ? parseFloat(b.level) : null,
      spGravity: b.spGravity ? parseFloat(b.spGravity) : null,
      ph: b.ph ? parseFloat(b.ph) : null,
      rs: b.rs ? parseFloat(b.rs) : null,
      rst: b.rst ? parseFloat(b.rst) : null,
      alcohol: b.alcohol ? parseFloat(b.alcohol) : null,
      ds: b.ds ? parseFloat(b.ds) : null,
      vfaPpa: b.vfaPpa ? parseFloat(b.vfaPpa) : null,
      temp: b.temp ? parseFloat(b.temp) : null,
      spentLoss: b.spentLoss ? parseFloat(b.spentLoss) : null,
      spentLossPhotoUrl: req.file ? `/uploads/spent-loss/${req.file.filename}` : null,
      status: b.status || 'U/F',
      remarks: b.remarks || null, userId: (req as any).user?.id || 'unknown'
    }
  });
  res.status(201).json(entry);
});

router.delete('/:id', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  const entry = await prisma.fermentationEntry.findUnique({ where: { id: req.params.id } });
  if (entry?.spentLossPhotoUrl) {
    const fp = path.join(__dirname, '../..', entry.spentLossPhotoUrl);
    fs.unlink(fp, () => {});
  }
  await prisma.fermentationEntry.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

/* ═══════ ANOMALY ═══════ */
router.get('/anomaly/:fermenterNo', async (req: Request, res: Response) => {
  const fNo = parseInt(req.params.fermenterNo);
  const allEntries = await prisma.fermentationEntry.findMany({
    where: { fermenterNo: fNo }, orderBy: [{ date: 'asc' }, { analysisTime: 'asc' }]
  });
  if (allEntries.length === 0) return res.json({ anomalies: [], stats: null });
  const batches: Record<number, typeof allEntries> = {};
  for (const e of allEntries) {
    if (!batches[e.batchNo]) batches[e.batchNo] = [];
    batches[e.batchNo].push(e);
  }
  const batchNos = Object.keys(batches).map(Number).sort();
  const currentBatch = batchNos[batchNos.length - 1];
  const historicalBatches = batchNos.slice(0, -1);
  const hourBuckets: Record<number, number[]> = {};
  for (const bn of historicalBatches) {
    const readings = batches[bn];
    if (readings.length < 3) continue;
    const t0 = new Date(readings[0].date).getTime();
    for (const r of readings) {
      if (r.spGravity == null) continue;
      const hrs = Math.round((new Date(r.date).getTime() - t0) / 3600000);
      const bucket = Math.round(hrs / 2) * 2;
      if (!hourBuckets[bucket]) hourBuckets[bucket] = [];
      hourBuckets[bucket].push(r.spGravity);
    }
  }
  const avgCurve: { hour: number; avgGravity: number; stdDev: number }[] = [];
  for (const [h, vals] of Object.entries(hourBuckets)) {
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((a, b) => a + (b - avg) ** 2, 0) / vals.length);
    avgCurve.push({ hour: parseInt(h), avgGravity: avg, stdDev: std });
  }
  avgCurve.sort((a, b) => a.hour - b.hour);
  const currentReadings = batches[currentBatch] || [];
  const anomalies: any[] = [];
  if (currentReadings.length > 0) {
    const t0 = new Date(currentReadings[0].date).getTime();
    for (const r of currentReadings) {
      if (r.spGravity == null) continue;
      const hrs = Math.round((new Date(r.date).getTime() - t0) / 3600000);
      const bucket = Math.round(hrs / 2) * 2;
      const ref = avgCurve.find(c => c.hour === bucket);
      if (ref && ref.stdDev > 0) {
        const zScore = Math.abs(r.spGravity - ref.avgGravity) / ref.stdDev;
        if (zScore > 2) {
          anomalies.push({ time: r.analysisTime, field: 'spGravity', value: r.spGravity, expected: Math.round(ref.avgGravity * 1000) / 1000, deviation: zScore > 3 ? 'CRITICAL' : 'WARNING' });
        }
      }
      if (r.temp != null && r.temp > 37) {
        anomalies.push({ time: r.analysisTime, field: 'temp', value: r.temp, expected: 35.5, deviation: r.temp > 38 ? 'CRITICAL' : 'WARNING' });
      }
    }
  }
  res.json({ anomalies, avgCurve, currentBatch, historicalBatches: historicalBatches.length });
});

export default router;
