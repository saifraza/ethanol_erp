import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();
router.use(authenticate as any);

// Multer setup for spent wash & RC less photos
const uploadDir = path.join(__dirname, '../../uploads/distillation');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

router.get('/', async (_req: Request, res: Response) => {
  try {
    const entries = await prisma.distillationEntry.findMany({ orderBy: { date: 'desc' }, take: 200 });
    res.json(entries);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/', upload.fields([
  { name: 'spentWashPhoto', maxCount: 1 },
  { name: 'rcLessPhoto', maxCount: 1 },
]), async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const spentWashPhotoUrl = files?.spentWashPhoto?.[0] ? `/uploads/distillation/${files.spentWashPhoto[0].filename}` : null;
    const rcLessPhotoUrl = files?.rcLessPhoto?.[0] ? `/uploads/distillation/${files.rcLessPhoto[0].filename}` : null;

    const entry = await prisma.distillationEntry.create({
      data: {
        date: new Date(b.date), analysisTime: b.analysisTime || '',
        spentWashLoss: b.spentWashLoss ? parseFloat(b.spentWashLoss) : null,
        rcLessLoss: b.rcLessLoss ? parseFloat(b.rcLessLoss) : null,
        ethanolStrength: b.ethanolStrength ? parseFloat(b.ethanolStrength) : null,
        rcReflexStrength: b.rcReflexStrength ? parseFloat(b.rcReflexStrength) : null,
        regenerationStrength: b.regenerationStrength ? parseFloat(b.regenerationStrength) : null,
        evaporationSpgr: b.evaporationSpgr ? parseFloat(b.evaporationSpgr) : null,
        rcStrength: b.rcStrength ? parseFloat(b.rcStrength) : null,
        actStrength: b.actStrength ? parseFloat(b.actStrength) : null,
        spentLossLevel: b.spentLossLevel || null,
        spentWashPhotoUrl,
        rcLessPhotoUrl,
        remark: b.remark || null, userId: (req as any).user.id
      }
    });
    res.status(201).json(entry);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  try {
    const entry = await prisma.distillationEntry.findUnique({ where: { id: req.params.id } });
    if (entry) {
      // Clean up photo files
      for (const url of [entry.spentWashPhotoUrl, entry.rcLessPhotoUrl]) {
        if (url) {
          const filename = path.basename(url.replace(/^\//, ''));
          const filePath = path.join(__dirname, '../../uploads/distillation', filename);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
      }
    }
    await prisma.distillationEntry.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
