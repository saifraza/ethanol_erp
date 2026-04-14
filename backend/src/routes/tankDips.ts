import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';

const router = Router();

router.post('/create', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = req.body;
  const date = new Date(data.date);
  const yearStart = date.getFullYear();

  const dip = await prisma.tankDip.create({
    data: {
      date,
      yearStart,
      rsLevel: data.rsLevel || 0,
      hfoLevel: data.hfoLevel || 0,
      lfoLevel: data.lfoLevel || 0,
      production: data.production || 0,
    },
  });

  res.status(201).json(dip);
}));

router.get('/list', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const dips = await prisma.tankDip.findMany({
    orderBy: { date: 'desc' },
    take: 100,
  });
  res.json(dips);
}));

router.get('/:id', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const dip = await prisma.tankDip.findUnique({
    where: { id: req.params.id },
  });
  if (!dip) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(dip);
}));

router.patch('/:id', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const dip = await prisma.tankDip.update({
    where: { id: req.params.id },
    data: req.body,
  });
  res.json(dip);
}));

export default router;
