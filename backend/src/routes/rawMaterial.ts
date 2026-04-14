import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';

const router = Router();

router.use(authenticate as any);

router.get('/', async (_req: AuthRequest, res: Response) => {
  const entries = await prisma.rawMaterialEntry.findMany({ orderBy: { date: 'desc' }, take: 200 });
  res.json(entries);
});

router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { date, vehicleCode, vehicleNo, moisture, starch, fungus, immature, damaged, waterDamaged, tfm, remark, material } = req.body;
  const userId = req.user?.id;
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
}));

// Lookup by vehicle code (RST number) — returns latest entry
router.get('/by-code/:code', async (req: AuthRequest, res: Response) => {
  const entry = await prisma.rawMaterialEntry.findFirst({
    where: { vehicleCode: req.params.code.trim() },
    orderBy: { date: 'desc' }
  });
  if (!entry) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(entry);
});

router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
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
}));

router.delete('/:id', authorize('ADMIN') as any, async (req: AuthRequest, res: Response) => {
  await prisma.rawMaterialEntry.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

export default router;
