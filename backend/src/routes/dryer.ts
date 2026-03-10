import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

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

router.get('/', async (_req: Request, res: Response) => {
  try {
    const entries = await prisma.dryerEntry.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    res.json(entries);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const entry = await prisma.dryerEntry.create({
      data: {
        date: new Date(b.date),
        entryTime: b.entryTime || '',
        ...parseBody(b),
        remark: b.remark || null,
        userId: (req as any).user.id,
      }
    });
    res.status(201).json(entry);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  try {
    await prisma.dryerEntry.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
