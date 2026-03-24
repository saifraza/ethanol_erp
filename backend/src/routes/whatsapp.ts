import { Router, Response } from 'express';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import prisma from '../config/prisma';
import {
  connectWhatsApp,
  disconnectWhatsApp,
  getQRCode,
  getConnectionStatus,
  getConnectedNumber,
  sendWhatsAppMessage,
  sendToGroup,
  listGroups,
} from '../services/whatsappBaileys';

const router = Router();

// All available modules for WhatsApp reporting
const ALL_MODULES = [
  'liquefaction', 'fermentation', 'distillation', 'milling',
  'evaporation', 'decanter', 'dryer', 'ethanol-product', 'grain',
  'ddgs', 'ddgs-stock', 'ddgs-dispatch', 'sales', 'dispatch',
  'procurement', 'accounts', 'inventory',
];

// Default private modules (used if none configured in Settings)
const DEFAULT_PRIVATE_MODULES = [
  'ddgs', 'ddgs-stock', 'ddgs-dispatch', 'sales', 'dispatch',
  'procurement', 'accounts', 'inventory',
];

// GET /api/whatsapp/status
router.get(
  '/status',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json({
      status: getConnectionStatus(),
      qr: getQRCode(),
      connectedNumber: getConnectedNumber(),
    });
  })
);

// POST /api/whatsapp/connect
router.post(
  '/connect',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await connectWhatsApp();
    await new Promise((r) => setTimeout(r, 2000));
    res.json({
      status: getConnectionStatus(),
      qr: getQRCode(),
    });
  })
);

// POST /api/whatsapp/disconnect
router.post(
  '/disconnect',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await disconnectWhatsApp();
    res.json({ status: 'disconnected' });
  })
);

// GET /api/whatsapp/groups — list all groups this number is part of
router.get(
  '/groups',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const groups = await listGroups();
    res.json(groups);
  })
);

// POST /api/whatsapp/test
router.post(
  '/test',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { phone, message } = req.body;
    if (!phone || !message) {
      res.status(400).json({ error: 'phone and message required' });
      return;
    }
    const result = await sendWhatsAppMessage(phone, message);
    res.json(result);
  })
);

// POST /api/whatsapp/send-report — smart routing: group vs private based on module
router.post(
  '/send-report',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { message, module } = req.body as {
      message: string;
      module?: string;
    };
    if (!message) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const settings = await prisma.settings.findFirst();
    const results: { target: string; success: boolean; error?: string }[] = [];

    // Read private modules from settings (user-configurable) or fall back to defaults
    const privateModules: string[] = (() => {
      try {
        const raw = (settings as any)?.whatsappPrivateModules;
        if (raw) return JSON.parse(raw);
      } catch { /* ignore parse errors */ }
      return DEFAULT_PRIVATE_MODULES;
    })();

    const mod = (module || '').toLowerCase();
    const isPrivate = privateModules.includes(mod);
    const isGroup = !isPrivate && ALL_MODULES.includes(mod);

    // Send to group if module is a group module (or unknown defaults to both)
    if (isGroup || (!isPrivate && !isGroup)) {
      const groupJid = (settings as any)?.whatsappGroupJid;
      if (groupJid) {
        const r = await sendToGroup(groupJid, message, module);
        results.push({ target: 'group', ...r });
      }
    }

    // Send to private numbers if module is private (or unknown defaults to both)
    if (isPrivate || (!isPrivate && !isGroup)) {
      const privateNumbers = (settings?.whatsappNumbers || '')
        .split(',')
        .map((p: string) => p.trim())
        .filter(Boolean);
      for (const phone of privateNumbers) {
        const r = await sendWhatsAppMessage(phone, message, module);
        results.push({ target: phone, ...r });
      }
    }

    // Also always send to private numbers for group modules (so admin gets everything)
    if (isGroup) {
      const privateNumbers = (settings?.whatsappNumbers || '')
        .split(',')
        .map((p: string) => p.trim())
        .filter(Boolean);
      for (const phone of privateNumbers) {
        const r = await sendWhatsAppMessage(phone, message, module);
        results.push({ target: phone, ...r });
      }
    }

    const sent = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    res.json({ sent, failed, total: results.length, results });
  })
);

// GET /api/whatsapp/modules — list all modules for routing config
router.get(
  '/modules',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const settings = await prisma.settings.findFirst();
    const privateModules: string[] = (() => {
      try {
        const raw = (settings as any)?.whatsappPrivateModules;
        if (raw) return JSON.parse(raw);
      } catch { /* ignore */ }
      return DEFAULT_PRIVATE_MODULES;
    })();
    res.json({
      all: ALL_MODULES,
      privateModules,
    });
  })
);

// GET /api/whatsapp/messages — message history
router.get(
  '/messages',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const take = Math.min(parseInt(req.query.limit as string) || 50, 500);
    const direction = req.query.direction as string | undefined;
    const messages = await prisma.whatsAppMessage.findMany({
      take,
      orderBy: { timestamp: 'desc' },
      where: direction ? { direction } : undefined,
      select: {
        id: true,
        direction: true,
        phone: true,
        name: true,
        message: true,
        module: true,
        timestamp: true,
      },
    });
    res.json(messages);
  })
);

export default router;
