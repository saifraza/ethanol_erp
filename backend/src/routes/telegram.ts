/**
 * Telegram Bot API routes — primary outbound messaging
 *
 * No QR, no connect/disconnect, no worker proxy — bot uses long-polling in-process.
 * Just bot token + chat IDs in Settings.
 */

import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import prisma from '../config/prisma';
import { z } from 'zod';
import { tgSend, tgSendGroup, tgStatus } from '../services/telegramClient';
import { initTelegram, stopPolling } from '../services/telegramBot';
import { broadcast } from '../services/messagingGateway';

const router = Router();
router.use(authenticate);

const ALL_MODULES = [
  'liquefaction', 'fermentation', 'distillation', 'milling',
  'evaporation', 'decanter', 'dryer', 'ethanol-product', 'grain',
  'ddgs', 'ddgs-stock', 'ddgs-dispatch', 'sales', 'dispatch',
  'procurement', 'accounts', 'inventory',
];

const DEFAULT_MODULE_ROUTING: Record<string, string> = {
  'liquefaction': 'group1', 'fermentation': 'group1', 'distillation': 'group1',
  'milling': 'group1', 'evaporation': 'group1', 'decanter': 'group1',
  'dryer': 'group1', 'ethanol-product': 'group1', 'grain': 'group1',
  'ddgs': 'group1', 'ddgs-stock': 'private', 'ddgs-dispatch': 'private',
  'sales': 'private', 'dispatch': 'private', 'procurement': 'private',
  'accounts': 'private', 'inventory': 'private',
};

function getModuleRouting(settings: any): Record<string, string> {
  try {
    const raw = settings?.telegramModuleRouting;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_MODULE_ROUTING };
}

// ── Status ──

router.get('/status', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const status = await tgStatus();
  res.json(status);
}));

// ── Reconnect (re-init bot with current token) ──

router.post('/reconnect', asyncHandler(async (_req: AuthRequest, res: Response) => {
  stopPolling();
  const ok = await initTelegram();
  res.json({ success: ok });
}));

// ── Test Send ──

const testSchema = z.object({
  chatId: z.string().min(1),
  message: z.string().optional(),
});

router.post('/test', validate(testSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { chatId, message } = req.body;
  const result = await tgSend(chatId, message || '✅ Test message from MSPIL ERP', 'test');
  res.json(result);
}));

// ── Test Group ──

router.post('/test-group', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const settings = await prisma.settings.findFirst();
  const chatId = (settings as any)?.telegramGroupChatId;
  if (!chatId) {
    res.status(400).json({ success: false, error: 'No Telegram group configured' });
    return;
  }
  const result = await tgSendGroup(chatId, '✅ Test message from MSPIL ERP', 'test');
  res.json(result);
}));

// ── Smart Report Routing ──

const sendReportSchema = z.object({
  module: z.string().min(1),
  message: z.string().min(1),
});

router.post('/send-report', validate(sendReportSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { module, message } = req.body;
  const result = await broadcast(module, message);
  res.json({ success: result.telegram.success, telegram: result.telegram });
}));

// ── Config / Routing ──

router.get('/config', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const settings = await prisma.settings.findFirst();
  const routing = getModuleRouting(settings);
  res.json({
    enabled: (settings as any)?.telegramEnabled || false,
    group1: { chatId: (settings as any)?.telegramGroupChatId, name: (settings as any)?.telegramGroupName },
    group2: { chatId: (settings as any)?.telegramGroup2ChatId, name: (settings as any)?.telegramGroup2Name },
    privateChatIds: (settings as any)?.telegramPrivateChatIds || '',
    routing,
  });
}));

router.get('/modules', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const settings = await prisma.settings.findFirst();
  const routing = getModuleRouting(settings);
  const modules = ALL_MODULES.map(m => ({
    module: m,
    target: routing[m] || 'group1',
  }));
  res.json({ modules });
}));

// ── Message History ──

router.get('/messages', asyncHandler(async (req: AuthRequest, res: Response) => {
  const take = Math.min(parseInt(req.query.limit as string) || 50, 200);
  try {
    const messages = await prisma.telegramMessage.findMany({
      take,
      orderBy: { timestamp: 'desc' },
      select: { id: true, direction: true, chatId: true, name: true, message: true, module: true, timestamp: true },
    });
    res.json(messages);
  } catch {
    // Table may not exist yet — return empty
    res.json([]);
  }
}));

export default router;
