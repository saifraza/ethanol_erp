import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticate as any);

router.get('/', async (_req: Request, res: Response) => {
  const entries = await prisma.liquefactionEntry.findMany({ orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 200 });
  res.json(entries);
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const userId = (req as any).user?.id || 'unknown';
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
  await prisma.liquefactionEntry.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

export default router;
