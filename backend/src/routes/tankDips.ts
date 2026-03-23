import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

router.post('/create', authenticate, async (req: AuthRequest, res: Response) => {
  try {
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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/list', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const dips = await prisma.tankDip.findMany({
      orderBy: { date: 'desc' },
      take: 100,
    });
    res.json(dips);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const dip = await prisma.tankDip.findUnique({
      where: { id: req.params.id },
    });
    if (!dip) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(dip);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const dip = await prisma.tankDip.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(dip);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
