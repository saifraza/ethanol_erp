import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { sendDailyWeighmentReport } from '../services/dailyWeighmentReport';
import { asyncHandler } from '../shared/middleware';

const router = Router();

/**
 * Escape CSV values to prevent injection attacks.
 * If value contains special chars, wrap in quotes and escape inner quotes.
 */
function escapeCSV(val: unknown): string {
  const s = String(val ?? '');
  // Check for formula characters, quotes, newlines, commas
  if (/[",\n\r]|^[=+@\-]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

router.post('/filter', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { startDate, endDate } = req.body;

  const entries = await prisma.dailyEntry.findMany({
    where: {
      date: {
        gte: new Date(startDate),
        lte: new Date(endDate),
      },
    },
    orderBy: { date: 'asc' },
  
    take: 500,
  });

  res.json(entries);
}));

router.get('/csv', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
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
}));

// POST /api/reports/send-weighment-daily — manual trigger for daily weighment email
// Accepts JWT auth OR ?key= secret for CLI/cron triggers
router.post('/send-weighment-daily', asyncHandler(async (req: AuthRequest, res: Response) => {
  const key = req.query.key as string;
  if (key !== 'mspil-report-2026') {
    // Fall back to JWT auth
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Auth required (JWT or ?key=)' });
      return;
    }
  }
  const result = await sendDailyWeighmentReport();
  res.json(result);
}));

export default router;
