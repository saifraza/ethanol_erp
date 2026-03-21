import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate as any);

// ─── CHEMICALS MASTER ───
router.get('/chemicals', async (_req: Request, res: Response) => {
  const chemicals = await prisma.pFChemical.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  res.json(chemicals);
});

router.post('/chemicals', async (req: Request, res: Response) => {
  try {
    const { name, rate, unit } = req.body;
    const chem = await prisma.pFChemical.create({ data: { name, rate: rate ? parseFloat(rate) : null, unit: unit || 'kg' } });
    res.status(201).json(chem);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ─── PF BATCHES ───
router.get('/batches', async (_req: Request, res: Response) => {
  const batches = await prisma.pFBatch.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { dosings: true, labReadings: { orderBy: { createdAt: 'asc' } } }
  });
  res.json(batches);
});

router.get('/batches/:id', async (req: Request, res: Response) => {
  const batch = await prisma.pFBatch.findUnique({
    where: { id: req.params.id },
    include: { dosings: true, labReadings: { orderBy: { createdAt: 'asc' } } }
  });
  if (!batch) return res.status(404).json({ error: 'Not found' });
  res.json(batch);
});

// Create new batch (starts SETUP phase)
router.post('/batches', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const userId = (req as any).user?.id || 'unknown';
    const setupTime = b.setupTime ? new Date(b.setupTime) : new Date();
    const slurryGravity = b.slurryGravity ? parseFloat(b.slurryGravity) : null;
    const slurryTemp = b.slurryTemp ? parseFloat(b.slurryTemp) : null;
    const slurryVolume = b.slurryVolume ? parseFloat(b.slurryVolume) : null;
    const pfLevel = b.pfLevel ? parseFloat(b.pfLevel) : null;

    const batch = await prisma.pFBatch.create({
      data: {
        batchNo: parseInt(b.batchNo) || 0,
        fermenterNo: parseInt(b.fermenterNo) || 1,
        phase: 'SETUP',
        setupTime,
        slurryVolume,
        slurryGravity,
        slurryTemp,
        remarks: b.remarks || null,
        userId,
        // Auto-create first lab reading from setup data
        labReadings: (slurryGravity || slurryTemp || pfLevel) ? {
          create: {
            analysisTime: setupTime.toISOString(),
            spGravity: slurryGravity,
            temp: slurryTemp,
            remarks: 'Setup reading (auto)',
            userId,
          }
        } : undefined,
      },
      include: { dosings: true, labReadings: { orderBy: { createdAt: 'asc' } } },
    });
    res.status(201).json(batch);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update batch phase / details
router.patch('/batches/:id', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const data: any = {};
    if (b.phase) data.phase = b.phase;
    if (b.transferTime) data.transferTime = new Date(b.transferTime);
    if (b.transferVolume) data.transferVolume = parseFloat(b.transferVolume);
    if (b.cipStartTime) data.cipStartTime = new Date(b.cipStartTime);
    if (b.cipEndTime) data.cipEndTime = new Date(b.cipEndTime);
    if (b.remarks !== undefined) data.remarks = b.remarks;
    if (b.slurryVolume) data.slurryVolume = parseFloat(b.slurryVolume);
    if (b.slurryGravity) data.slurryGravity = parseFloat(b.slurryGravity);
    if (b.slurryTemp) data.slurryTemp = parseFloat(b.slurryTemp);

    const batch = await prisma.pFBatch.update({
      where: { id: req.params.id },
      data,
      include: { dosings: true, labReadings: { orderBy: { createdAt: 'asc' } } }
    });
    res.json(batch);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/batches/:id', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  await prisma.pFBatch.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ─── DOSING ───
router.post('/batches/:id/dosing', async (req: Request, res: Response) => {
  try {
    const { chemicalName, quantity, unit, rate } = req.body;
    const dosing = await prisma.pFDosing.create({
      data: {
        batchId: req.params.id,
        chemicalName,
        quantity: parseFloat(quantity),
        unit: unit || 'kg',
        rate: rate ? parseFloat(rate) : null
      }
    });
    // Auto advance to DOSING phase if still in SETUP
    await prisma.pFBatch.updateMany({
      where: { id: req.params.id, phase: 'SETUP' },
      data: { phase: 'DOSING' }
    });
    res.status(201).json(dosing);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Edit dosing quantity
router.patch('/dosing/:id', async (req: Request, res: Response) => {
  try {
    const { quantity } = req.body;
    const dosing = await prisma.pFDosing.update({
      where: { id: req.params.id },
      data: { quantity: parseFloat(quantity) },
    });
    res.json(dosing);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/dosing/:id', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  await prisma.pFDosing.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ─── LAB READINGS ───
router.post('/batches/:id/lab', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const userId = (req as any).user?.id || 'unknown';
    const reading = await prisma.pFLabReading.create({
      data: {
        batchId: req.params.id,
        analysisTime: b.analysisTime || '',
        spGravity: b.spGravity ? parseFloat(b.spGravity) : null,
        ph: b.ph ? parseFloat(b.ph) : null,
        rs: b.rs ? parseFloat(b.rs) : null,
        rst: b.rst ? parseFloat(b.rst) : null,
        alcohol: b.alcohol ? parseFloat(b.alcohol) : null,
        ds: b.ds ? parseFloat(b.ds) : null,
        vfaPpa: b.vfaPpa ? parseFloat(b.vfaPpa) : null,
        temp: b.temp ? parseFloat(b.temp) : null,
        remarks: b.remarks || null,
        userId
      }
    });
    // Auto advance to LAB phase
    await prisma.pFBatch.updateMany({
      where: { id: req.params.id, phase: { in: ['SETUP', 'DOSING'] } },
      data: { phase: 'LAB' }
    });
    res.status(201).json(reading);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /lab/:id — Update individual PF lab reading
router.put('/lab/:id', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const data: any = {};
    if (b.spGravity !== undefined) data.spGravity = b.spGravity !== null && b.spGravity !== '' ? parseFloat(b.spGravity) : null;
    if (b.ph !== undefined) data.ph = b.ph !== null && b.ph !== '' ? parseFloat(b.ph) : null;
    if (b.rs !== undefined) data.rs = b.rs !== null && b.rs !== '' ? parseFloat(b.rs) : null;
    if (b.alcohol !== undefined) data.alcohol = b.alcohol !== null && b.alcohol !== '' ? parseFloat(b.alcohol) : null;
    if (b.temp !== undefined) data.temp = b.temp !== null && b.temp !== '' ? parseFloat(b.temp) : null;
    const reading = await prisma.pFLabReading.update({ where: { id: req.params.id }, data });
    res.json(reading);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/lab/:id', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  await prisma.pFLabReading.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ─── OLD COMPAT: keep /pre-fermentation GET for old entries ───
router.get('/', async (_req: Request, res: Response) => {
  const entries = await prisma.preFermentationEntry.findMany({ orderBy: { date: 'desc' }, take: 200 });
  res.json(entries);
});

export default router;
