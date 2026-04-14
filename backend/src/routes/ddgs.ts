import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';

const router = Router();

router.use(authenticate as any);

const FLOAT_FIELDS = [
  'bags','weightPerBag','totalProduction',
  'dryerInletTemp','dryerOutletTemp','ddgsMoisture','ddgsProtein'
];

function parseBody(b: Record<string, unknown>) {
  const data: Record<string, number | null> = {};
  for (const f of FLOAT_FIELDS) {
    data[f] = b[f] != null && b[f] !== '' ? parseFloat(b[f] as string) : null;
  }
  return data;
}

// GET / — history
router.get('/', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const entries = await prisma.dDGSProductionEntry.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  res.json(entries);
}));

// POST /
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const entry = await prisma.dDGSProductionEntry.create({
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
  await prisma.dDGSProductionEntry.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

export default router;
