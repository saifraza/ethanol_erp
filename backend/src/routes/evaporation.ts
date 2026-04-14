import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';
import { broadcast } from '../services/messagingGateway';
import { asyncHandler } from '../shared/middleware';

const router = Router();

router.use(authenticate as any);

const FLOAT_FIELDS = [
  'ff1SpGravity','ff1Temp','ff2SpGravity','ff2Temp','ff3SpGravity','ff3Temp',
  'ff4SpGravity','ff4Temp','ff5SpGravity','ff5Temp',
  'fc1SpGravity','fc1Temp','fc2SpGravity','fc2Temp',
  'ff1Concentration','ff2Concentration','ff3Concentration','ff4Concentration','ff5Concentration',
  'syrupConcentration','vacuum','thinSlopFlowRate','lastSyrupGravity',
  'reboilerATemp','reboilerBTemp','reboilerCTemp',
  'thinSlopGravity','thinSlopSolids','spentWashGravity','spentWashSolids'
];

function parseBody(b: any) {
  const data: any = {};
  for (const f of FLOAT_FIELDS) {
    data[f] = b[f] != null && b[f] !== '' ? parseFloat(b[f]) : null;
  }
  return data;
}

// GET / — history
router.get('/', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const entries = await prisma.evaporationEntry.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  res.json(entries);
}));

// POST /
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const entry = await prisma.evaporationEntry.create({
    data: {
      date: new Date(b.date),
      analysisTime: b.analysisTime || '',
      ...parseBody(b),
      remark: b.remark || null,
      userId: req.user!.id,
    }
  });
  res.status(201).json(entry);

  // Telegram notify
  const lines = [
    `🧪 *Evaporation Lab Entry*`,
    b.analysisTime ? `Time: ${b.analysisTime}` : '',
    entry.syrupConcentration != null ? `Syrup: ${entry.syrupConcentration}%` : '',
    entry.thinSlopGravity != null ? `Thin Slop SG: ${entry.thinSlopGravity}` : '',
    entry.spentWashGravity != null ? `Spent Wash SG: ${entry.spentWashGravity}` : '',
    entry.vacuum != null ? `Vacuum: ${entry.vacuum}` : '',
    entry.remark ? `Remark: ${entry.remark}` : '',
  ].filter(Boolean).join('\n');
  broadcast('evaporation', lines).catch(() => {});
}));

// PUT /:id
router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
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
}));

// DELETE /:id — ADMIN only
router.delete('/:id', authorize('ADMIN') as any, asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.evaporationEntry.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

export default router;
