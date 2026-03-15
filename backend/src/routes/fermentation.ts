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

/* ═══════ SETTINGS — gravity target etc ═══════ */
router.get('/settings', async (_req: Request, res: Response) => {
  const s = await prisma.settings.findFirst();
  res.json({
    pfGravityTarget: (s as any)?.pfGravityTarget ?? 1.024,
    fermRetentionHours: (s as any)?.fermRetentionHours ?? 8,
    fermenter1Cap: s?.fermenter1Cap ?? 2300,
    fermenter2Cap: s?.fermenter2Cap ?? 2300,
    fermenter3Cap: s?.fermenter3Cap ?? 2300,
    fermenter4Cap: s?.fermenter4Cap ?? 2300,
    pfCap: s?.pfCap ?? 430,
    beerWellCap: s?.beerWellCap ?? 430,
  });
});

/* ═══════ NEXT BATCH NUMBER (auto-suggest) ═══════ */
router.get('/next-batch', async (_req: Request, res: Response) => {
  const [lastPF, lastFerm] = await Promise.all([
    prisma.pFBatch.findFirst({ orderBy: { batchNo: 'desc' }, select: { batchNo: true } }),
    prisma.fermentationBatch.findFirst({ orderBy: { batchNo: 'desc' }, select: { batchNo: true } }),
  ]);
  const maxBatch = Math.max(lastPF?.batchNo ?? 0, lastFerm?.batchNo ?? 0);
  res.json({ nextBatchNo: maxBatch + 1 });
});

/* ═══════ FREE VESSELS ═══════ */
router.get('/free-vessels', async (_req: Request, res: Response) => {
  const [activePF, activeFerm] = await Promise.all([
    prisma.pFBatch.findMany({ where: { phase: { not: 'DONE' } }, select: { fermenterNo: true } }),
    prisma.fermentationBatch.findMany({ where: { phase: { not: 'DONE' } }, select: { fermenterNo: true } }),
  ]);
  const usedPF = new Set(activePF.map(b => b.fermenterNo));
  const usedFerm = new Set(activeFerm.map(b => b.fermenterNo));
  res.json({
    freePF: [1, 2].filter(n => !usedPF.has(n)),
    freeFerm: [1, 2, 3, 4].filter(n => !usedFerm.has(n)),
  });
});

/* ═══════ OVERVIEW — all active batches with status ═══════ */
router.get('/overview', async (_req: Request, res: Response) => {
  const s = await prisma.settings.findFirst();
  const gravityTarget = (s as any)?.pfGravityTarget ?? 1.024;

  const [pfBatches, fermBatches] = await Promise.all([
    prisma.pFBatch.findMany({
      where: { phase: { not: 'DONE' } },
      include: { dosings: true, labReadings: { orderBy: { createdAt: 'asc' } } },
    }),
    prisma.fermentationBatch.findMany({
      where: { phase: { not: 'DONE' } },
      include: { dosings: true },
    }),
  ]);

  // Get latest ferm lab entries for active batches
  const activeFermBatchNos = fermBatches.map(b => b.batchNo);
  const fermLabEntries = activeFermBatchNos.length > 0
    ? await prisma.fermentationEntry.findMany({
        where: { batchNo: { in: activeFermBatchNos } },
        orderBy: { createdAt: 'desc' },
      })
    : [];

  // Group ALL lab entries per fermenter + keep latest
  const allFermLab: Record<number, any[]> = {};
  const latestFermLab: Record<number, any> = {};
  for (const e of fermLabEntries) {
    if (!allFermLab[e.fermenterNo]) allFermLab[e.fermenterNo] = [];
    allFermLab[e.fermenterNo].push(e);
    if (!latestFermLab[e.fermenterNo]) latestFermLab[e.fermenterNo] = e;
  }

  // Add readyToTransfer hint for PF batches
  const pfWithHints = pfBatches.map(b => {
    const lastLab = b.labReadings.length ? b.labReadings[b.labReadings.length - 1] : null;
    const lastGravity = lastLab?.spGravity ?? null;
    const readyToTransfer = lastGravity !== null && lastGravity <= gravityTarget;
    return { ...b, lastGravity, readyToTransfer, gravityTarget };
  });

  res.json({
    pfBatches: pfWithHints,
    fermBatches: fermBatches.map(b => ({
      ...b,
      lastLab: latestFermLab[b.fermenterNo] || null,
      labReadings: (allFermLab[b.fermenterNo] || []).sort((a: any, c: any) => new Date(a.createdAt).getTime() - new Date(c.createdAt).getTime()),
    })),
    gravityTarget,
  });
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
        phase: b.phase || 'PF_TRANSFER',
        pfTransferTime: b.pfTransferTime ? new Date(b.pfTransferTime) : new Date(),
        fillingStartTime: b.fillingStartTime ? new Date(b.fillingStartTime) : null,
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
    if (b.phase) data.phase = b.phase;
    for (const f of ['pfTransferTime', 'fillingStartTime', 'fillingEndTime', 'setupEndTime', 'reactionStartTime', 'retentionStartTime', 'transferTime', 'cipStartTime', 'cipEndTime']) {
      if (b[f] !== undefined) data[f] = b[f] ? new Date(b[f]) : null;
    }
    for (const f of ['volume', 'fermLevel', 'transferVolume', 'setupGravity', 'setupRs', 'setupRst', 'finalRsGravity', 'totalHours', 'finalAlcohol']) {
      if (b[f] !== undefined) data[f] = b[f] ? parseFloat(b[f]) : null;
    }
    for (const f of ['remarks', 'yeast', 'enzyme', 'formolin', 'booster', 'urea', 'setupTime']) {
      if (b[f] !== undefined) data[f] = b[f] || null;
    }
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

/* ═══════ PF → FERMENTER AUTO-TRANSFER ═══════ */
// One endpoint: transfers PF batch to a fermenter
// - Sets PF to CIP
// - Creates new FermentationBatch in FILLING phase with same batch #
router.post('/transfer-pf', async (req: Request, res: Response) => {
  try {
    const { pfBatchId, fermenterNo } = req.body;
    if (!pfBatchId || !fermenterNo) return res.status(400).json({ error: 'pfBatchId and fermenterNo required' });

    const pfBatch = await prisma.pFBatch.findUnique({
      where: { id: pfBatchId },
      include: { labReadings: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!pfBatch) return res.status(404).json({ error: 'PF batch not found' });
    if (pfBatch.phase === 'DONE') return res.status(400).json({ error: 'PF batch already done' });

    // Check fermenter is free
    const existing = await prisma.fermentationBatch.findFirst({
      where: { fermenterNo: parseInt(String(fermenterNo)), phase: { not: 'DONE' } },
    });
    if (existing) return res.status(400).json({ error: `Fermenter ${fermenterNo} is occupied by batch #${existing.batchNo}` });

    const now = new Date();
    const lastGravity = pfBatch.labReadings[0]?.spGravity ?? null;

    // Update PF → TRANSFER then CIP
    await prisma.pFBatch.update({
      where: { id: pfBatchId },
      data: { phase: 'CIP', transferTime: now, transferVolume: pfBatch.slurryVolume },
    });

    // Create fermenter batch
    const fermBatch = await prisma.fermentationBatch.create({
      data: {
        batchNo: pfBatch.batchNo,
        fermenterNo: parseInt(String(fermenterNo)),
        phase: 'FILLING',
        pfTransferTime: now,
        fillingStartTime: now,
        setupGravity: lastGravity,
        remarks: `From PF-${pfBatch.fermenterNo}`,
        userId: (req as any).user?.id || 'unknown',
      },
      include: { dosings: true },
    });

    res.json({ pfBatch: { id: pfBatchId, phase: 'CIP' }, fermBatch });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ═══════ CREATE FROM PF TRANSFER (legacy) ═══════ */
router.post('/batches/from-pf', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const now = new Date();
    const batch = await prisma.fermentationBatch.create({
      data: {
        batchNo: parseInt(b.batchNo) || 0,
        fermenterNo: parseInt(b.fermenterNo) || 1,
        phase: 'FILLING',
        pfTransferTime: b.pfTransferTime ? new Date(b.pfTransferTime) : now,
        fillingStartTime: b.pfTransferTime ? new Date(b.pfTransferTime) : now,
        fermLevel: b.fermLevel ? parseFloat(b.fermLevel) : null,
        volume: b.fermLevel ? parseFloat((parseFloat(b.fermLevel) / 100 * 2300 * 1000).toFixed(0)) : null,
        setupGravity: b.setupGravity ? parseFloat(b.setupGravity) : null,
        remarks: b.remarks ? String(b.remarks) : (b.pfBatchId ? `From PF${b.pfNo || ''} batch` : null),
        userId: (req as any).user?.id || 'unknown'
      },
      include: { dosings: true }
    });
    res.status(201).json(batch);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
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

/* ═══════ LAB READINGS (FermentationEntry) ═══════ */
// GET all
router.get('/', async (_req: Request, res: Response) => {
  const entries = await prisma.fermentationEntry.findMany({ orderBy: { date: 'desc' }, take: 500 });
  res.json(entries);
});

// GET for specific fermenter
router.get('/fermenter/:no', async (req: Request, res: Response) => {
  const fermenterNo = parseInt(req.params.no);
  const entries = await prisma.fermentationEntry.findMany({
    where: { fermenterNo }, orderBy: { date: 'desc' }, take: 200
  });
  res.json(entries);
});

// GET for specific batch
router.get('/batch/:batchNo', async (req: Request, res: Response) => {
  const batchNo = parseInt(req.params.batchNo);
  const entries = await prisma.fermentationEntry.findMany({
    where: { batchNo }, orderBy: [{ date: 'asc' }, { analysisTime: 'asc' }]
  });
  res.json(entries);
});

/* ═══════ FIELD INPUT — level/temp/gravity from field users ═══════ */
router.post('/field-reading', async (req: Request, res: Response) => {
  try {
    const { fermenterNo, level, temp, spGravity } = req.body;
    const vesselNo = parseInt(String(fermenterNo));
    const userId = (req as any).user?.id || 'unknown';

    const fermBatch = await prisma.fermentationBatch.findFirst({
      where: { fermenterNo: vesselNo, phase: { not: 'DONE' } },
    });
    if (!fermBatch) return res.status(400).json({ error: `No active batch on F-${vesselNo}` });

    // Update batch level
    const updateData: any = {};
    if (level) updateData.fermLevel = parseFloat(level);

    if (Object.keys(updateData).length > 0) {
      await prisma.fermentationBatch.update({ where: { id: fermBatch.id }, data: updateData });
    }

    // Create a lab entry with field readings so lab can see it
    const entry = await prisma.fermentationEntry.create({
      data: {
        date: new Date(),
        analysisTime: new Date().toISOString(),
        batchNo: fermBatch.batchNo,
        fermenterNo: vesselNo,
        level: level ? parseFloat(level) : null,
        spGravity: spGravity ? parseFloat(spGravity) : null,
        temp: temp ? parseFloat(temp) : null,
        status: 'FIELD',
        remarks: 'Field reading',
        userId,
      },
    });
    res.status(201).json({ entry, batchNo: fermBatch.batchNo });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ═══════ LAB QUICK-ADD — simplified for lab tab ═══════ */
// POST /fermentation/lab-reading
// Lab person just picks vessel type + number, enters readings
// Auto-finds active batch, auto-stamps time
router.post('/lab-reading', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const vesselType = b.vesselType; // 'PF' or 'FERM'
    const vesselNo = parseInt(b.vesselNo);
    const userId = (req as any).user?.id || 'unknown';

    if (vesselType === 'PF') {
      // Find active PF batch for this vessel
      const pfBatch = await prisma.pFBatch.findFirst({
        where: { fermenterNo: vesselNo, phase: { not: 'DONE' } },
      });
      if (!pfBatch) return res.status(400).json({ error: `No active PF batch on PF-${vesselNo}` });

      const reading = await prisma.pFLabReading.create({
        data: {
          batchId: pfBatch.id,
          analysisTime: b.analysisTime || new Date().toISOString(),
          spGravity: b.spGravity ? parseFloat(b.spGravity) : null,
          ph: b.ph ? parseFloat(b.ph) : null,
          rs: b.rs ? parseFloat(b.rs) : null,
          rst: b.rst ? parseFloat(b.rst) : null,
          alcohol: b.alcohol ? parseFloat(b.alcohol) : null,
          ds: b.ds ? parseFloat(b.ds) : null,
          vfaPpa: b.vfaPpa ? parseFloat(b.vfaPpa) : null,
          temp: b.temp ? parseFloat(b.temp) : null,
          remarks: b.remarks || null,
          userId,
        },
      });
      // Auto advance to LAB phase
      await prisma.pFBatch.updateMany({
        where: { id: pfBatch.id, phase: { in: ['SETUP', 'DOSING'] } },
        data: { phase: 'LAB' },
      });

      // Check gravity target
      const settings = await prisma.settings.findFirst();
      const target = (settings as any)?.pfGravityTarget ?? 1.024;
      const gravity = b.spGravity ? parseFloat(b.spGravity) : null;
      const readyToTransfer = gravity !== null && gravity <= target;

      res.status(201).json({ reading, batchNo: pfBatch.batchNo, readyToTransfer, gravityTarget: target });
    } else {
      // Fermenter lab reading
      const fermBatch = await prisma.fermentationBatch.findFirst({
        where: { fermenterNo: vesselNo, phase: { not: 'DONE' } },
      });
      if (!fermBatch) return res.status(400).json({ error: `No active batch on F-${vesselNo}` });

      const entry = await prisma.fermentationEntry.create({
        data: {
          date: new Date(),
          analysisTime: b.analysisTime || new Date().toISOString(),
          batchNo: fermBatch.batchNo,
          fermenterNo: vesselNo,
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
          status: b.status || 'U/F',
          remarks: b.remarks || null,
          userId,
        },
      });
      res.status(201).json({ entry, batchNo: fermBatch.batchNo });
    }
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST traditional lab entry (kept for backward compat)
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
