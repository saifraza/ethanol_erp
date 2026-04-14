import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';

const router = Router();

router.post('/create', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = req.body;
  const date = new Date(data.date);
  const yearStart = date.getFullYear();

  const entry = await prisma.dailyEntry.create({
    data: {
      date,
      yearStart,
      syrup1Flow: data.syrup1Flow || 0,
      syrup2Flow: data.syrup2Flow || 0,
      syrup3Flow: data.syrup3Flow || 0,
      fltFlow: data.fltFlow || 0,
      washFlow: data.washFlow || 0,
      fermenter1Level: data.fermenter1Level || 0,
      fermenter2Level: data.fermenter2Level || 0,
      fermenter3Level: data.fermenter3Level || 0,
      fermenter4Level: data.fermenter4Level || 0,
      beerWellLevel: data.beerWellLevel || 0,
      pfLevel: data.pfLevel || 0,
      grainOpeningStock: data.grainOpeningStock || 0,
      grainUnloadedToday: data.grainUnloadedToday || 0,
      grainConsumed: data.grainConsumed || 0,
      grainDistilled: data.grainDistilled || 0,
      grainClosingStock: data.grainClosingStock || 0,
      grainInFermenters: data.grainInFermenters || 0,
      steamTotal: data.steamTotal || 0,
      steamAvgTph: data.steamAvgTph || 0,
      steamPerTon: data.steamPerTon || 0,
      distillationEfficiency: data.distillationEfficiency || 0,
      recoveryPercentage: data.recoveryPercentage || 0,
      status: 'DRAFT',
      notes: data.notes || '',
    },
  });

  res.status(201).json(entry);
}));

router.get('/list', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const entries = await prisma.dailyEntry.findMany({
    orderBy: { date: 'desc' },
    take: 100,
  });
  res.json(entries);
}));

router.get('/:id', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const entry = await prisma.dailyEntry.findUnique({
    where: { id: req.params.id },
  });
  if (!entry) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(entry);
}));

router.patch('/:id', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const entry = await prisma.dailyEntry.update({
    where: { id: req.params.id },
    data: req.body,
  });
  res.json(entry);
}));

router.patch('/:id/approve', authenticate, authorize('SUPERVISOR', 'ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const entry = await prisma.dailyEntry.update({
    where: { id: req.params.id },
    data: { status: 'APPROVED' },
  });
  res.json(entry);
}));

export default router;
