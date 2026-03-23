import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';

const router = Router();
router.use(authenticate as any);

/** Get shift date (9am–9am cycle): before 9am → previous calendar day */
function getShiftDate(d?: Date): string {
  const now = d || new Date();
  const shifted = new Date(now);
  if (shifted.getHours() < 9) shifted.setDate(shifted.getDate() - 1);
  return shifted.toISOString().split('T')[0];
}

function yesterdayShiftDate(): string {
  const d = new Date();
  if (d.getHours() < 9) d.setDate(d.getDate() - 1);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

// GET /today — entries for current shift day + yesterday total
router.get('/today', asyncHandler(async (req: AuthRequest, res: Response) => {
  const shiftDate = getShiftDate();
  const yesterdaySD = yesterdayShiftDate();

  const entries = await prisma.dDGSProductionEntry.findMany({
    where: { shiftDate },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: {
      id: true, shiftDate: true, timeFrom: true, timeTo: true,
      operatorName: true, bags: true, weightPerBag: true,
      totalProduction: true, remark: true, createdAt: true,
    },
  });

  const todayTotal = entries.reduce((sum, e) => sum + (e.bags || 0), 0);
  const todayTonnage = entries.reduce((sum, e) => sum + (e.totalProduction || 0), 0);

  // Yesterday's total
  const yesterdayEntries = await prisma.dDGSProductionEntry.findMany({
    where: { shiftDate: yesterdaySD },
    select: { bags: true, totalProduction: true },
    take: 200,
  });
  const yesterdayBags = yesterdayEntries.reduce((sum, e) => sum + (e.bags || 0), 0);
  const yesterdayTonnage = yesterdayEntries.reduce((sum, e) => sum + (e.totalProduction || 0), 0);

  res.json({
    shiftDate,
    entries,
    todayBags: todayTotal,
    todayTonnage,
    yesterdayBags,
    yesterdayTonnage,
    yesterdayShiftDate: yesterdaySD,
  });
}));

// GET /by-date?shiftDate=YYYY-MM-DD — entries for a specific shift date
router.get('/by-date', asyncHandler(async (req: AuthRequest, res: Response) => {
  const shiftDate = (req.query.shiftDate as string) || getShiftDate();

  const entries = await prisma.dDGSProductionEntry.findMany({
    where: { shiftDate },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: {
      id: true, shiftDate: true, timeFrom: true, timeTo: true,
      operatorName: true, bags: true, weightPerBag: true,
      totalProduction: true, remark: true, createdAt: true,
    },
  });

  const totalBags = entries.reduce((sum, e) => sum + (e.bags || 0), 0);
  const totalTonnage = entries.reduce((sum, e) => sum + (e.totalProduction || 0), 0);

  res.json({ shiftDate, entries, totalBags, totalTonnage });
}));

// POST / — add a new bag entry
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const bags = parseFloat(b.bags) || 0;
  const weightPerBag = parseFloat(b.weightPerBag) || 50;
  const totalProduction = (bags * weightPerBag) / 1000; // kg → MT
  const shiftDate = b.shiftDate || getShiftDate();

  const entry = await prisma.dDGSProductionEntry.create({
    data: {
      date: new Date(),
      shiftDate,
      timeFrom: b.timeFrom || '',
      timeTo: b.timeTo || '',
      operatorName: b.operatorName || '',
      bags,
      weightPerBag,
      totalProduction,
      remark: b.remark || null,
      userId: req.user!.id,
    },
  });
  res.status(201).json(entry);
}));

// DELETE /:id
router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.dDGSProductionEntry.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

export default router;
