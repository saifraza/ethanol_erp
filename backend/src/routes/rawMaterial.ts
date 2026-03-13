import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(authenticate as any);

router.get('/', async (_req: Request, res: Response) => {
  const entries = await prisma.rawMaterialEntry.findMany({ orderBy: { date: 'desc' }, take: 200 });
  res.json(entries);
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { date, vehicleCode, vehicleNo, moisture, starch, fungus, immature, damaged, waterDamaged, tfm, remark, material } = req.body;
    const userId = (req as any).user?.id;
    console.log('[RAW-MATERIAL] POST userId:', userId, 'user:', JSON.stringify((req as any).user));
    if (!userId) { res.status(401).json({ error: 'User not authenticated' }); return; }
    const entry = await prisma.rawMaterialEntry.create({
      data: {
        date: new Date(date), vehicleCode: vehicleCode || '', vehicleNo: vehicleNo || '',
        moisture: parseFloat(moisture) || 0, starch: parseFloat(starch) || 0,
        fungus: parseFloat(fungus) || 0, immature: parseFloat(immature) || 0,
        damaged: parseFloat(damaged) || 0, waterDamaged: parseFloat(waterDamaged) || 0,
        tfm: parseFloat(tfm) || 0, remark: remark || null, material: material || 'Corn',
        userId
      }
    });
    res.status(201).json(entry);
  } catch (err: any) {
    console.error('[RAW-MATERIAL] POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Lookup by vehicle code (RST number) — returns latest entry
router.get('/by-code/:code', async (req: Request, res: Response) => {
  const entry = await prisma.rawMaterialEntry.findFirst({
    where: { vehicleCode: req.params.code.trim() },
    orderBy: { date: 'desc' }
  });
  if (!entry) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(entry);
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { date, vehicleCode, vehicleNo, moisture, starch, fungus, immature, damaged, waterDamaged, tfm, remark, material } = req.body;
    const entry = await prisma.rawMaterialEntry.update({
      where: { id: req.params.id },
      data: {
        date: new Date(date), vehicleCode: vehicleCode || '', vehicleNo: vehicleNo || '',
        moisture: parseFloat(moisture) || 0, starch: parseFloat(starch) || 0,
        fungus: parseFloat(fungus) || 0, immature: parseFloat(immature) || 0,
        damaged: parseFloat(damaged) || 0, waterDamaged: parseFloat(waterDamaged) || 0,
        tfm: parseFloat(tfm) || 0, remark: remark || null, material: material || 'Corn',
      }
    });
    res.json(entry);
  } catch (err: any) {
    console.error('[RAW-MATERIAL] PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  await prisma.rawMaterialEntry.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

export default router;
