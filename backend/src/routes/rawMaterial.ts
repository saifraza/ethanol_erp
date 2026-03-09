import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticate as any);

router.get('/', async (_req: Request, res: Response) => {
  const entries = await prisma.rawMaterialEntry.findMany({ orderBy: { date: 'desc' }, take: 200 });
  res.json(entries);
});

router.post('/', async (req: Request, res: Response) => {
  const { date, vehicleCode, vehicleNo, moisture, starch, fungus, immature, damaged, waterDamaged, tfm, remark } = req.body;
  const entry = await prisma.rawMaterialEntry.create({
    data: {
      date: new Date(date), vehicleCode: vehicleCode || '', vehicleNo: vehicleNo || '',
      moisture: parseFloat(moisture) || 0, starch: parseFloat(starch) || 0,
      fungus: parseFloat(fungus) || 0, immature: parseFloat(immature) || 0,
      damaged: parseFloat(damaged) || 0, waterDamaged: parseFloat(waterDamaged) || 0,
      tfm: parseFloat(tfm) || 0, remark: remark || null, userId: (req as any).userId
    }
  });
  res.status(201).json(entry);
});

router.delete('/:id', async (req: Request, res: Response) => {
  await prisma.rawMaterialEntry.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

export default router;
