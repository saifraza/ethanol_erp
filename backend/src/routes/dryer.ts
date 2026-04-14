import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';

const router = Router();

router.use(authenticate as any);

const DRYERS = [1, 2, 3];
const PER_DRYER = ['Moisture', 'SteamFlow', 'SteamTempIn', 'SteamTempOut', 'SyrupConsumption', 'LoadAmps'];
const FLOAT_FIELDS = [
  ...DRYERS.flatMap(n => PER_DRYER.map(f => `dr${n}${f}`)),
  'finalMoisture'
];

function parseBody(b: any) {
  const data: any = {};
  for (const f of FLOAT_FIELDS) {
    data[f] = b[f] != null && b[f] !== '' ? parseFloat(b[f]) : null;
  }
  return data;
}

router.get('/', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const entries = await prisma.dryerEntry.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  res.json(entries);
}));

router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const entry = await prisma.dryerEntry.create({
    data: {
      date: new Date(b.date),
      entryTime: b.entryTime || '',
      ...parseBody(b),
      remark: b.remark || null,
      userId: req.user!.id,
    }
  });
  res.status(201).json(entry);
}));

router.delete('/:id', authorize('ADMIN') as any, asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.dryerEntry.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

export default router;
