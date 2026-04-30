import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { broadcastToPrivate } from '../services/messagingGateway';

const router = Router();
router.use(authenticate);

/** IST-aware now: Railway runs UTC, we need IST (UTC+5:30) */
function nowIST(): Date {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

/** Get shift date (9am–9am IST cycle): before 9am IST → previous calendar day */
function getShiftDate(d?: Date): string {
  const ist = d ? new Date(d.getTime() + 5.5 * 60 * 60 * 1000) : nowIST();
  if (ist.getUTCHours() < 9) ist.setUTCDate(ist.getUTCDate() - 1);
  return ist.toISOString().split('T')[0];
}

function yesterdayShiftDate(): string {
  const ist = nowIST();
  if (ist.getUTCHours() < 9) ist.setUTCDate(ist.getUTCDate() - 1);
  ist.setUTCDate(ist.getUTCDate() - 1);
  return ist.toISOString().split('T')[0];
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

  // Auto-push Telegram notification (fire-and-forget)
  pushTelegramNotification(shiftDate, entry).catch(err =>
    console.error('[DDGS TG] Push failed:', err.message)
  );

  res.status(201).json(entry);
}));

// DELETE /:id
router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.dDGSProductionEntry.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

/** Auto-push Telegram message to configured chat IDs */
async function pushTelegramNotification(shiftDate: string, entry: any): Promise<void> {
  const settings = await prisma.settings.findFirst();
  if (!settings || !settings.telegramEnabled || !settings.telegramPrivateChatIds) return;

  const chatIds: string[] = settings.telegramPrivateChatIds
    .split(',')
    .map((n: string) => n.trim())
    .filter(Boolean);

  if (chatIds.length === 0) return;

  // Get today's running total
  const todayEntries = await prisma.dDGSProductionEntry.findMany({
    where: { shiftDate },
    select: { bags: true, totalProduction: true },
    take: 200,
  });
  const totalBags = todayEntries.reduce((sum, e) => sum + (e.bags || 0), 0);
  const totalMT = todayEntries.reduce((sum, e) => sum + (e.totalProduction || 0), 0);

  const timeStr = entry.timeFrom && entry.timeTo ? `${entry.timeFrom}–${entry.timeTo}` : '';
  const msg = [
    `*DDGS Bag Entry*`,
    timeStr ? `Time: ${timeStr}` : '',
    entry.operatorName ? `Operator: ${entry.operatorName}` : '',
    `Bags: ${entry.bags}`,
    ``,
    `*Today Total: ${totalBags} bags (${totalMT.toFixed(2)} MT)*`,
  ].filter(Boolean).join('\n');

  // Broadcast to all configured private recipients (Telegram + WhatsApp)
  broadcastToPrivate(msg, 'ddgs').catch(err =>
    console.error(`[DDGS] Broadcast failed:`, (err as Error).message)
  );
}

export default router;
