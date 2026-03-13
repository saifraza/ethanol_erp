import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate as any);

// Multer for iodine test photo
const uploadsDir = path.join(__dirname, '..', '..', 'uploads', 'iodine');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

router.get('/', async (_req: Request, res: Response) => {
  const entries = await prisma.liquefactionEntry.findMany({ orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 200 });
  res.json(entries);
});

router.post('/', upload.single('iodinePhoto'), async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const userId = (req as any).user?.id || 'unknown';
    const photoUrl = req.file ? `/uploads/iodine/${req.file.filename}` : null;
    const entry = await prisma.liquefactionEntry.create({
      data: {
        date: new Date(b.date), analysisTime: b.analysisTime || '',
        jetCookerTemp: b.jetCookerTemp ? parseFloat(b.jetCookerTemp) : null,
        jetCookerFlow: b.jetCookerFlow ? parseFloat(b.jetCookerFlow) : null,
        iltTemp: b.iltTemp ? parseFloat(b.iltTemp) : null,
        iltSpGravity: b.iltSpGravity ? parseFloat(b.iltSpGravity) : null,
        iltPh: b.iltPh ? parseFloat(b.iltPh) : null,
        iltRs: b.iltRs ? parseFloat(b.iltRs) : null,
        fltTemp: b.fltTemp ? parseFloat(b.fltTemp) : null,
        fltSpGravity: b.fltSpGravity ? parseFloat(b.fltSpGravity) : null,
        fltPh: b.fltPh ? parseFloat(b.fltPh) : null,
        fltRs: b.fltRs ? parseFloat(b.fltRs) : null,
        fltRst: b.fltRst ? parseFloat(b.fltRst) : null,
        iltDs: b.iltDs ? parseFloat(b.iltDs) : null,
        iltTs: b.iltTs ? parseFloat(b.iltTs) : null,
        fltDs: b.fltDs ? parseFloat(b.fltDs) : null,
        fltTs: b.fltTs ? parseFloat(b.fltTs) : null,
        iltBrix: b.iltBrix ? parseFloat(b.iltBrix) : null,
        fltBrix: b.fltBrix ? parseFloat(b.fltBrix) : null,
        iltViscosity: b.iltViscosity ? parseFloat(b.iltViscosity) : null,
        fltViscosity: b.fltViscosity ? parseFloat(b.fltViscosity) : null,
        iltAcidity: b.iltAcidity ? parseFloat(b.iltAcidity) : null,
        fltAcidity: b.fltAcidity ? parseFloat(b.fltAcidity) : null,
        iltLevel: b.iltLevel ? parseFloat(b.iltLevel) : null,
        fltLevel: b.fltLevel ? parseFloat(b.fltLevel) : null,
        fltFlowRate: b.fltFlowRate ? parseFloat(b.fltFlowRate) : null,
        flourRate: b.flourRate ? parseFloat(b.flourRate) : null,
        hotWaterFlowRate: b.hotWaterFlowRate ? parseFloat(b.hotWaterFlowRate) : null,
        thinSlopRecycleFlowRate: b.thinSlopRecycleFlowRate ? parseFloat(b.thinSlopRecycleFlowRate) : null,
        slurryFlow: b.slurryFlow ? parseFloat(b.slurryFlow) : null,
        steamFlow: b.steamFlow ? parseFloat(b.steamFlow) : null,
        fltIodineTest: b.fltIodineTest || null,
        fltIodinePhotoUrl: photoUrl || b.fltIodinePhotoUrl || null,
        remark: b.remark || null, userId
      }
    });
    res.status(201).json(entry);
  } catch (err: any) {
    console.error('Liquefaction POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  const entry = await prisma.liquefactionEntry.findUnique({ where: { id: req.params.id } });
  if (entry?.fltIodinePhotoUrl) {
    const filePath = path.join(__dirname, '..', '..', entry.fltIodinePhotoUrl.replace(/^\//, ''));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  await prisma.liquefactionEntry.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

export default router;
