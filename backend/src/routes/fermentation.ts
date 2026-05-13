import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';
import { broadcast } from '../services/messagingGateway';
import { asyncHandler } from '../shared/middleware';
import { triggerRecompute as triggerFillRecompute } from '../services/fermentation/fillLive';
import { mirrorToS3 } from '../shared/s3Storage';
import {
  issueChemicalForDosing,
  reverseChemicalForDosing,
  adjustChemicalForDosing,
} from '../services/chemicalDosingInventory';

const router = Router();

/* ═══════ MULTER for spent-loss photos ═══════ */
const uploadDir = path.join(__dirname, '../../uploads/spent-loss');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

router.use(authenticate);

/* ═══════ CHEMICALS (shared with PF) ═══════ */
router.get('/chemicals', async (_req: Request, res: Response) => {
  const chemicals = await prisma.pFChemical.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } ,
    take: 500,
  });
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
    prisma.pFBatch.findMany({ where: { phase: { not: 'DONE' } }, select: { fermenterNo: true } ,
    take: 500,
  }),
    prisma.fermentationBatch.findMany({ where: { phase: { not: 'DONE' } }, select: { fermenterNo: true } ,
    take: 500,
  }),
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

  const [pfBatches, fermBatches, beerWellReadings, beerWellBatches] = await Promise.all([
    prisma.pFBatch.findMany({
      where: { phase: { not: 'DONE' } },
      include: { dosings: true, labReadings: { orderBy: { createdAt: 'asc' } } },
    
    take: 500,
  }),
    prisma.fermentationBatch.findMany({
      where: { phase: { not: 'DONE' } },
      include: { dosings: true },
    
    take: 500,
  }),
    prisma.beerWellReading.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.fermentationBatch.findMany({
      where: { phase: 'DONE', beerWellNo: { not: null } },
      orderBy: { transferTime: 'desc' },
      take: 5,
      select: { batchNo: true, fermenterNo: true, beerWellNo: true, transferTime: true, finalAlcohol: true, transferVolume: true },
    }),
  ]);

  // Get latest ferm lab entries for active batches
  const activeFermBatchNos = fermBatches.map(b => b.batchNo);
  const fermLabEntries = activeFermBatchNos.length > 0
    ? await prisma.fermentationEntry.findMany({
        where: { batchNo: { in: activeFermBatchNos } },
        orderBy: { createdAt: 'desc' },
      
    take: 500,
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
    beerWell: {
      readings: beerWellReadings,
      recentBatches: beerWellBatches,
      latest: beerWellReadings[0] || null,
    },
  });
});

/* ═══════ BATCHES (lifecycle) ═══════ */
router.get('/batches', async (req: Request, res: Response) => {
  // Cap limit to prevent unbounded queries
  const limit = Math.min(parseInt((req.query.limit as string) || '50'), 100);
  const batches = await prisma.fermentationBatch.findMany({
    orderBy: { createdAt: 'desc' }, take: limit,
    include: { dosings: { orderBy: { addedAt: 'asc' } } }
  });
  res.json(batches);
});

router.post('/batches', asyncHandler(async (req: AuthRequest, res: Response) => {
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
      userId: req.user?.id || 'unknown'
    },
    include: { dosings: true }
  });
  res.status(201).json(batch);
}));

router.patch('/batches/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
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
}));

router.delete('/batches/:id', authorize('ADMIN'), async (req: Request, res: Response) => {
  await prisma.fermentationBatch.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

/* ═══════ PF → FERMENTER AUTO-TRANSFER ═══════ */
// One endpoint: transfers PF batch to a fermenter
// - Sets PF to CIP
// - Creates new FermentationBatch in FILLING phase with same batch #
router.post('/transfer-pf', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { pfBatchId, fermenterNo } = req.body;
  if (!pfBatchId || !fermenterNo) return res.status(400).json({ error: 'pfBatchId and fermenterNo required' });

  const pfBatch = await prisma.pFBatch.findUnique({
    where: { id: pfBatchId },
    include: { labReadings: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  if (!pfBatch) return res.status(404).json({ error: 'PF batch not found' });
  if (['DONE', 'CIP', 'TRANSFER'].includes(pfBatch.phase)) return res.status(400).json({ error: `PF batch already in ${pfBatch.phase} phase` });

  // Check fermenter is free
  const existing = await prisma.fermentationBatch.findFirst({
    where: { fermenterNo: parseInt(String(fermenterNo)), phase: { not: 'DONE' } },
  });
  if (existing) return res.status(400).json({ error: `Fermenter ${fermenterNo} is occupied by batch #${existing.batchNo}` });

  const now = new Date();

  // Update PF → TRANSFER then CIP
  await prisma.pFBatch.update({
    where: { id: pfBatchId },
    data: { phase: 'CIP', transferTime: now, transferVolume: pfBatch.slurryVolume },
  });

  // Create fermenter batch — setupGravity will be set from first fermenter lab reading
  const fermBatch = await prisma.fermentationBatch.create({
    data: {
      batchNo: pfBatch.batchNo,
      fermenterNo: parseInt(String(fermenterNo)),
      phase: 'FILLING',
      pfTransferTime: now,
      fillingStartTime: now,
      remarks: `From PF-${pfBatch.fermenterNo}`,
      userId: req.user?.id || 'unknown',
    },
    include: { dosings: true },
  });

  res.json({ pfBatch: { id: pfBatchId, phase: 'CIP' }, fermBatch });
}));

/* ═══════ CREATE FROM PF TRANSFER (legacy) ═══════ */
router.post('/batches/from-pf', asyncHandler(async (req: AuthRequest, res: Response) => {
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
      userId: req.user?.id || 'unknown'
    },
    include: { dosings: true }
  });
  res.status(201).json(batch);
}));

/* ═══════ DOSING ═══════ */
router.post('/batches/:id/dosing', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { chemicalName, quantity, unit, level } = req.body;
  const userId = req.user?.id || 'unknown';
  const qtyNum = parseFloat(quantity) || 0;
  const unitStr = unit || 'kg';
  const dosing = await prisma.fermDosing.create({
    data: { batchId: req.params.id, chemicalName, quantity: qtyNum, unit: unitStr, level: level ? parseFloat(level) : null }
  });
  const batch = await prisma.fermentationBatch.findUnique({
    where: { id: req.params.id },
    select: { batchNo: true, fermenterNo: true },
  });
  await issueChemicalForDosing(prisma, {
    chemicalName,
    quantity: qtyNum,
    unit: unitStr,
    source: 'FERM_DOSING',
    refId: dosing.id,
    batchNo: batch?.batchNo,
    fermenterNo: batch?.fermenterNo,
    userId,
  });
  const updated = await prisma.fermentationBatch.findUnique({ where: { id: req.params.id }, include: { dosings: true } });
  res.status(201).json(updated);
}));

router.patch('/dosing/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { quantity, unit } = req.body;
  const userId = req.user?.id || 'unknown';
  const data: any = {};
  if (quantity !== undefined) data.quantity = parseFloat(quantity);
  if (unit !== undefined) data.unit = unit;
  const dosing = await prisma.fermDosing.update({ where: { id: req.params.id }, data });
  if (quantity !== undefined) {
    await adjustChemicalForDosing(prisma, {
      source: 'FERM_DOSING',
      refId: dosing.id,
      newQuantity: parseFloat(quantity),
      chemicalName: dosing.chemicalName,
      unit: dosing.unit,
      userId,
    });
  }
  res.json(dosing);
}));

router.delete('/dosing/:id', authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id || 'unknown';
  await reverseChemicalForDosing(prisma, { source: 'FERM_DOSING', refId: req.params.id, userId });
  await prisma.fermDosing.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

/* ═══════ LAB READINGS (FermentationEntry) ═══════ */
// GET all
router.get('/', async (_req: Request, res: Response) => {
  // Cap limit to prevent unbounded queries
  const limit = Math.min(parseInt((_req.query.limit as string) || '50'), 500);
  const entries = await prisma.fermentationEntry.findMany({ orderBy: { date: 'desc' }, take: limit });
  res.json(entries);
});

// GET for specific fermenter
router.get('/fermenter/:no', async (req: Request, res: Response) => {
  const fermenterNo = parseInt(req.params.no);
  // Cap limit to prevent unbounded queries
  const limit = Math.min(parseInt((req.query.limit as string) || '50'), 200);
  const entries = await prisma.fermentationEntry.findMany({
    where: { fermenterNo }, orderBy: { date: 'desc' }, take: limit
  });
  res.json(entries);
});

// GET for specific batch
router.get('/batch/:batchNo', async (req: Request, res: Response) => {
  const batchNo = parseInt(req.params.batchNo);
  const fermenterNo = req.query.fermenterNo ? parseInt(req.query.fermenterNo as string) : undefined;
  const where: any = { batchNo };
  if (fermenterNo) where.fermenterNo = fermenterNo;
  const entries = await prisma.fermentationEntry.findMany({
    where, orderBy: [{ date: 'asc' }, { analysisTime: 'asc' }]
  ,
    take: 500,
  });
  res.json(entries);
});

/* ═══════ FIELD INPUT — level/temp/gravity from field users ═══════ */
router.post('/field-reading', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { fermenterNo, level, temp, spGravity } = req.body;
  const vesselNo = parseInt(String(fermenterNo));
  const userId = req.user?.id || 'unknown';

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

    // Auto-detect fermentation end: gravity ≤ 1.0
    let fermentationFinished = false;
    const grav = spGravity ? parseFloat(spGravity) : null;
    if (grav !== null && grav <= 1.0 && !fermBatch.fermentationEndTime) {
      await prisma.fermentationBatch.update({
        where: { id: fermBatch.id },
        data: { fermentationEndTime: new Date(), finalRsGravity: grav },
      });
      fermentationFinished = true;
    }

    triggerFillRecompute(vesselNo);
    res.status(201).json({ entry, batchNo: fermBatch.batchNo, fermentationFinished });
}));

/* ═══════ LAB QUICK-ADD — simplified for lab tab ═══════ */
// POST /fermentation/lab-reading
// Lab person just picks vessel type + number, enters readings
// Auto-finds active batch, auto-stamps time
router.post('/lab-reading', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const vesselType = b.vesselType; // 'PF' or 'FERM'
  const vesselNo = parseInt(b.vesselNo);
  const userId = req.user?.id || 'unknown';

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

      // Telegram notify
      const pfLines = [
        `🧪 *PF-${vesselNo} Lab Reading* (#${pfBatch.batchNo})`,
        b.spGravity ? `SG: ${b.spGravity}` : '', b.ph ? `pH: ${b.ph}` : '',
        b.alcohol ? `Alcohol: ${b.alcohol}%` : '', b.temp ? `Temp: ${b.temp}°C` : '',
        readyToTransfer ? `⚡ Ready to transfer (SG ≤ ${target})` : '',
      ].filter(Boolean).join('\n');
      broadcast('fermentation', pfLines).catch(() => {});

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
      // ── Auto-advance FILLING → REACTION if 2 consecutive levels match ──
      let autoAdvanced = false;
      if (fermBatch.phase === 'FILLING' && b.level) {
        const prevReadings = await prisma.fermentationEntry.findMany({
          where: { batchNo: fermBatch.batchNo, fermenterNo: vesselNo, level: { not: null } },
          orderBy: { createdAt: 'desc' },
          take: 2,
          select: { level: true },
        });
        // prevReadings[0] is the one we just created, prevReadings[1] is the previous
        if (prevReadings.length >= 2 && prevReadings[0].level !== null && prevReadings[1].level !== null) {
          const diff = Math.abs(prevReadings[0].level - prevReadings[1].level);
          // If level difference ≤ 0.5% of the level, filling is complete
          if (diff <= (prevReadings[0].level * 0.005) || diff < 0.1) {
            await prisma.fermentationBatch.update({
              where: { id: fermBatch.id },
              data: { phase: 'REACTION', fillingEndTime: new Date().toISOString() },
            });
            autoAdvanced = true;
          }
        }
      }

      // Auto-set setupGravity from first fermenter SG reading (not PF gravity)
      if (b.spGravity && !fermBatch.setupGravity) {
        await prisma.fermentationBatch.update({
          where: { id: fermBatch.id },
          data: { setupGravity: parseFloat(b.spGravity) },
        });
      }

      // Auto-detect fermentation end: gravity ≤ 1.0 means fermentation is complete
      let fermentationFinished = false;
      const gravity = b.spGravity ? parseFloat(b.spGravity) : null;
      if (gravity !== null && gravity <= 1.0 && !fermBatch.fermentationEndTime) {
        await prisma.fermentationBatch.update({
          where: { id: fermBatch.id },
          data: {
            fermentationEndTime: new Date(),
            finalRsGravity: gravity,
          },
        });
        fermentationFinished = true;
      }

      triggerFillRecompute(vesselNo);
      res.status(201).json({ entry, batchNo: fermBatch.batchNo, autoAdvanced, autoAdvancedTo: autoAdvanced ? 'REACTION' : undefined, fermentationFinished });

      // Telegram notify
      const fLines = [
        `🧪 *F-${vesselNo} Lab Reading* (#${fermBatch.batchNo})`,
        b.spGravity ? `SG: ${b.spGravity}` : '', b.ph ? `pH: ${b.ph}` : '',
        b.alcohol ? `Alcohol: ${b.alcohol}%` : '', b.temp ? `Temp: ${b.temp}°C` : '',
        autoAdvanced ? `⚡ Auto-advanced to REACTION` : '',
        fermentationFinished ? `✅ Fermentation complete (SG ≤ 1.0)` : '',
      ].filter(Boolean).join('\n');
      broadcast('fermentation', fLines).catch(() => {});

    }
}));

// POST traditional lab entry (kept for backward compat)
router.post('/', upload.single('spentLossPhoto'), mirrorToS3('spent-loss'), async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const batchNo = parseInt(b.batchNo) || 0;
  const fermenterNo = parseInt(b.fermenterNo) || 1;
  const entry = await prisma.fermentationEntry.create({
    data: {
      date: new Date(b.date), analysisTime: b.analysisTime || '',
      batchNo, fermenterNo,
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
      remarks: b.remarks || null, userId: req.user?.id || 'unknown'
    }
  });

  // Auto-detect fermentation end: gravity ≤ 1.0
  const grav = b.spGravity ? parseFloat(b.spGravity) : null;
  if (grav !== null && grav <= 1.0 && batchNo > 0) {
    const fermBatch = await prisma.fermentationBatch.findFirst({
      where: { batchNo, fermenterNo, fermentationEndTime: null },
    });
    if (fermBatch) {
      await prisma.fermentationBatch.update({
        where: { id: fermBatch.id },
        data: { fermentationEndTime: new Date(), finalRsGravity: grav },
      });
    }
  }

  triggerFillRecompute(fermenterNo);
  res.status(201).json(entry);
});

// PUT /:id — Update individual lab reading
router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const data: any = {};
  if (b.level !== undefined) data.level = b.level !== null && b.level !== '' ? parseFloat(b.level) : null;
  if (b.spGravity !== undefined) data.spGravity = b.spGravity !== null && b.spGravity !== '' ? parseFloat(b.spGravity) : null;
  if (b.ph !== undefined) data.ph = b.ph !== null && b.ph !== '' ? parseFloat(b.ph) : null;
  if (b.rs !== undefined) data.rs = b.rs !== null && b.rs !== '' ? parseFloat(b.rs) : null;
  if (b.alcohol !== undefined) data.alcohol = b.alcohol !== null && b.alcohol !== '' ? parseFloat(b.alcohol) : null;
  if (b.temp !== undefined) data.temp = b.temp !== null && b.temp !== '' ? parseFloat(b.temp) : null;
  if (b.ds !== undefined) data.ds = b.ds !== null && b.ds !== '' ? parseFloat(b.ds) : null;
  if (b.vfaPpa !== undefined) data.vfaPpa = b.vfaPpa !== null && b.vfaPpa !== '' ? parseFloat(b.vfaPpa) : null;
  if (b.remarks !== undefined) data.remarks = b.remarks || null;
  const entry = await prisma.fermentationEntry.update({ where: { id: req.params.id }, data });
  res.json(entry);
}));

router.delete('/:id', authorize('ADMIN'), async (req: Request, res: Response) => {
  const entry = await prisma.fermentationEntry.findUnique({ where: { id: req.params.id } });
  if (entry?.spentLossPhotoUrl) {
    const filename = path.basename(entry.spentLossPhotoUrl.replace(/^\//, ''));
    const fp = path.join(__dirname, '../../uploads/spent-loss', filename);
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
  ,
    take: 500,
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

/* ═══════ BEER WELL ═══════ */

// GET latest beer well readings (last 20)
router.get('/beer-well', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const readings = await prisma.beerWellReading.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  // Also get batches recently transferred to beer well (DONE phase, last 5)
  const recentBatches = await prisma.fermentationBatch.findMany({
    where: { phase: 'DONE', beerWellNo: { not: null } },
    orderBy: { transferTime: 'desc' },
    take: 5,
    select: { batchNo: true, fermenterNo: true, beerWellNo: true, transferTime: true, finalAlcohol: true, transferVolume: true },
  });
  res.json({ readings, recentBatches });
}));

// POST beer well reading
router.post('/beer-well', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { wellNo, level, spGravity, ph, alcohol, temp, remarks, batchNo } = req.body;
  const reading = await prisma.beerWellReading.create({
    data: {
      wellNo: wellNo ? parseInt(wellNo) : 1,
      level: level ? parseFloat(level) : null,
      spGravity: spGravity ? parseFloat(spGravity) : null,
      ph: ph ? parseFloat(ph) : null,
      alcohol: alcohol ? parseFloat(alcohol) : null,
      temp: temp ? parseFloat(temp) : null,
      remarks: remarks || null,
      batchNo: batchNo ? parseInt(batchNo) : null,
    },
  });
  res.status(201).json(reading);
}));

// PUT beer well reading (edit)
router.put('/beer-well/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { level, spGravity, ph, alcohol, temp, remarks } = req.body;
  const reading = await prisma.beerWellReading.update({
    where: { id: req.params.id },
    data: {
      level: level !== undefined ? (level !== null ? parseFloat(level) : null) : undefined,
      spGravity: spGravity !== undefined ? (spGravity !== null ? parseFloat(spGravity) : null) : undefined,
      ph: ph !== undefined ? (ph !== null ? parseFloat(ph) : null) : undefined,
      alcohol: alcohol !== undefined ? (alcohol !== null ? parseFloat(alcohol) : null) : undefined,
      temp: temp !== undefined ? (temp !== null ? parseFloat(temp) : null) : undefined,
      remarks: remarks !== undefined ? (remarks || null) : undefined,
    },
  });
  res.json(reading);
}));

// DELETE beer well reading
router.delete('/beer-well/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.beerWellReading.delete({ where: { id: req.params.id } });
  res.json({ success: true });
}));

/* ═══════ BATCH HISTORY — all completed PF + Ferm batches ═══════ */
router.get('/history', asyncHandler(async (req: AuthRequest, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

  const [pfHistory, fermHistory] = await Promise.all([
    prisma.pFBatch.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        dosings: { orderBy: { addedAt: 'desc' } },
        labReadings: { orderBy: { createdAt: 'asc' } },
      },
    }),
    prisma.fermentationBatch.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        dosings: { orderBy: { addedAt: 'desc' } },
      },
    }),
  ]);

  // For ferm batches, also load lab entries.
  // N+1 fix — one OR query instead of one query per batch.
  const entryKeys = fermHistory.map((fb) => ({ batchNo: fb.batchNo, fermenterNo: fb.fermenterNo }));
  const allEntries = entryKeys.length === 0
    ? []
    : await prisma.fermentationEntry.findMany({
        where: { OR: entryKeys },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, analysisTime: true, level: true, spGravity: true, ph: true,
          alcohol: true, temp: true, rs: true, rst: true, createdAt: true,
          batchNo: true, fermenterNo: true,
        },
      
    take: 500,
  });
  const entriesByBatch = new Map<string, typeof allEntries>();
  for (const e of allEntries) {
    const k = `${e.batchNo}-${e.fermenterNo}`;
    let bucket = entriesByBatch.get(k);
    if (!bucket) { bucket = []; entriesByBatch.set(k, bucket); }
    bucket.push(e);
  }
  const fermWithLab = fermHistory.map((fb) => ({
    ...fb,
    labReadings: entriesByBatch.get(`${fb.batchNo}-${fb.fermenterNo}`) ?? [],
  }));

  res.json({ pfHistory, fermHistory: fermWithLab });
}));

export default router;
