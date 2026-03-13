import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate as any);

router.get('/', async (_req: Request, res: Response) => {
  try {
    const entries = await prisma.distillationEntry.findMany({ orderBy: { date: 'desc' }, take: 200 });
    res.json(entries);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const b = req.body;
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
        remark: b.remark || null, userId: (req as any).user.id
      }
    });
    res.status(201).json(entry);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  try {
    await prisma.distillationEntry.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
