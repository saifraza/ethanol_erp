import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayEntry = await prisma.dailyEntry.findFirst({
      where: {
        date: {
          gte: today,
          lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
        },
      },
    });

    const lastSevenDays = await prisma.dailyEntry.findMany({
      where: {
        date: {
          gte: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000),
        },
      },
      orderBy: { date: 'desc' },
    });

    const recovery = lastSevenDays.map((entry) => ({
      date: entry.date,
      recovery: entry.recoveryPercentage || 0,
    }));

    const production = lastSevenDays.map((entry) => ({
      date: entry.date,
      production: (entry.syrup1Flow || 0) + (entry.syrup2Flow || 0) + (entry.syrup3Flow || 0),
    }));

    res.json({
      todayEntry,
      kpis: {
        grainConsumption: todayEntry?.grainConsumed || 0,
        ethanol: (todayEntry?.syrup1Flow || 0) + (todayEntry?.syrup2Flow || 0) + (todayEntry?.syrup3Flow || 0),
        recovery: todayEntry?.recoveryPercentage || 0,
        efficiency: todayEntry?.distillationEfficiency || 0,
      },
      charts: {
        recovery,
        production,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
