import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticate as any);

const FLOAT_FIELDS = [
  'ff1SpGravity','ff1Temp','ff2SpGravity','ff2Temp','ff3SpGravity','ff3Temp',
  'ff4SpGravity','ff4Temp','ff5SpGravity','ff5Temp',
  'fc1SpGravity','fc1Temp','fc2SpGravity','fc2Temp',
  'ff1Concentration','ff2Concentration','ff3Concentration','ff4Concentration','ff5Concentration',
  'syrupConcentration','vacuum','thinSlopFlowRate','lastSyrupGravity'
];

function parseBody(b: any) {
  const data: any = {};
  for (const f of FLOAT_FIELDS) {
    data[f] = b[f] != null && b[f] !== '' ? parseFloat(b[f]) : null;
  }
  return data;
}

// GET / — history
router.get('/', async (_req: Request, res: Response) => {
  try {
    const entries = await prisma.evaporationEntry.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    res.json(entries);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /
router.post('/', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const entry = await prisma.evaporationEntry.create({
      data: {
        date: new Date(b.date),
        analysisTime: b.analysisTime || '',
        ...parseBody(b),
        remark: b.remark || null,
        userId: (req as any).user.id,
      }
    });
    res.status(201).json(entry);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const entry = await prisma.evaporationEntry.update({
      where: { id: req.params.id },
      data: {
        analysisTime: b.analysisTime || '',
        ...parseBody(b),
        remark: b.remark || null,
      }
    });
    res.json(entry);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /:id — ADMIN only
router.delete('/:id', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  try {
    await prisma.evaporationEntry.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
