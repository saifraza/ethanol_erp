import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';

const router = Router();

router.use(authenticate as any);

const FLOAT_FIELDS: string[] = [];
for (let i = 1; i <= 8; i++) {
  FLOAT_FIELDS.push(`d${i}Feed`, `d${i}WetCake`, `d${i}ThinSlopGr`);
}

function parseBody(b: any) {
  const data: any = {};
  for (const f of FLOAT_FIELDS) {
    data[f] = b[f] != null && b[f] !== '' ? parseFloat(b[f]) : null;
  }
  return data;
}

// GET / — history
router.get('/', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const entries = await prisma.decanterEntry.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  res.json(entries);
}));

// POST /
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const entry = await prisma.decanterEntry.create({
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

// DELETE /:id — ADMIN only
router.delete('/:id', authorize('ADMIN') as any, asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.decanterEntry.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

export default router;
