import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

/**
 * Escape CSV values to prevent injection attacks.
 * If value contains special chars, wrap in quotes and escape inner quotes.
 */
function escapeCSV(val: any): string {
  const s = String(val ?? '');
  // Check for formula characters, quotes, newlines, commas
  if (/[",\n\r]|^[=+@\-]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

router.post('/filter', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { startDate, endDate } = req.body;

    const entries = await prisma.dailyEntry.findMany({
      where: {
        date: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        },
      },
      orderBy: { date: 'asc' },
    });

    res.json(entries);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/csv', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const entries = await prisma.dailyEntry.findMany({
      orderBy: { date: 'desc' },
      take: 100,
    });

    let csv = 'Date,Grain Consumed,Grain Distilled,Recovery %,Efficiency %\n';
    entries.forEach((entry) => {
      // Escape all CSV fields to prevent injection
      csv += [
        escapeCSV(entry.date.toISOString()),
        escapeCSV(entry.grainConsumed),
        escapeCSV(entry.grainDistilled),
        escapeCSV(entry.recoveryPercentage),
        escapeCSV(entry.distillationEfficiency)
      ].join(',') + '\n';
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="report.csv"');
    res.send(csv);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
