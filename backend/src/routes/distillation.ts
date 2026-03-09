import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticate as any);

router.get('/', async (_req: Request, res: Response) => {
  const entries = await prisma.distillationEntry.findMany({ orderBy: { date: 'desc' }, take: 200 });
  res.json(entries);
});

router.post('/', async (req: Request, res: Response) => {
  const b = req.body;
  const entry = await prisma.distillationEntry.create({
    data: {
      date: new Date(b.date), analysisTime: b.analysisTime || '',
      batchNo: b.batchNo ? parseInt(b.batchNo) : null,
      spentWashLoss: b.spentWashLoss ? parseFloat(b.spentWashLoss) : null,
      rcLessLoss: b.rcLessLoss ? parseFloat(b.rcLessLoss) : null,
      ethanolStrength: b.ethanolStrength ? parseFloat(b.ethanolStrength) : null,
      rcReflexStrength: b.rcReflexStrength ? parseFloat(b.rcReflexStrength) : null,
      regenerationStrength: b.regenerationStrength ? parseFloat(b.regenerationStrength) : null,
      evaporationSpgr: b.evaporationSpgr ? parseFloat(b.evaporationSpgr) : null,
      remark: b.remark || null, userId: (req as any).userId
    }
  });
  res.status(201).json(entry);
});

router.delete('/:id', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  await prisma.distillationEntry.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

export default router;
