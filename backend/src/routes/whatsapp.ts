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

// POST /api/whatsapp/test-group — test sending to the configured group
router.post(
  '/test-group',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const settings = await prisma.settings.findFirst();
    const groupJid = (settings as any)?.whatsappGroupJid;
    if (!groupJid) {
      res.status(400).json({ error: 'No group configured in Settings', groupJid: null });
      return;
    }
    console.log(`[WA-Route] test-group: sending to groupJid="${groupJid}"`);
    const result = await sendToGroup(groupJid, req.body.message || '🧪 Test message from MSPIL ERP');
    console.log(`[WA-Route] test-group result:`, JSON.stringify(result));
    res.json({ groupJid, ...result });
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
    const groupJidVal = (settings as any)?.whatsappGroupJid || null;

    console.log(`[WA] send-report: module="${mod}" isGroup=${isGroup} isPrivate=${isPrivate} groupJid=${groupJidVal ? groupJidVal.substring(0, 20) + '...' : 'NOT SET'} settingsId=${settings?.id || 'NONE'}`);

    // Group modules → group only (private numbers are already in the group)
    // Private modules → private numbers only
    if (isGroup) {
      const groupJid = groupJidVal;
      if (groupJid) {
        const r = await sendToGroup(groupJid, message, module);
        console.log(`[WA] send-report: group send result:`, JSON.stringify(r));
        results.push({ target: 'group', ...r });
      } else {
        console.log(`[WA] send-report: groupJid is NULL — cannot send to group for module "${mod}"`);
      }
    } else if (isPrivate) {
      const privateNumbers = (settings?.whatsappNumbers || '')
        .split(',')
        .map((p: string) => p.trim())
        .filter(Boolean);
      for (const phone of privateNumbers) {
        const r = await sendWhatsAppMessage(phone, message, module);
        results.push({ target: phone, ...r });
      }
    } else {
      // Unknown module — send to both
      const groupJid = (settings as any)?.whatsappGroupJid;
      if (groupJid) {
        const r = await sendToGroup(groupJid, message, module);
        results.push({ target: 'group', ...r });
      }
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

    if (results.length === 0) {
      const reason = isGroup ? 'No WhatsApp group configured. Set group in Settings.' :
                     isPrivate ? 'No private numbers configured. Add numbers in Settings.' :
                     'No recipients configured.';
      console.log(`[WA] send-report: No targets for module "${mod}" — ${reason}`);
      res.status(400).json({ error: reason, sent: 0, failed: 0, total: 0, results: [] });
      return;
    }

    res.json({ sent, failed, total: results.length, results });
  })
);

// GET /api/whatsapp/config — diagnostic: show current WhatsApp routing config
router.get(
  '/config',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const settings = await prisma.settings.findFirst();
    const groupJid = (settings as any)?.whatsappGroupJid || null;
    const groupName = (settings as any)?.whatsappGroupName || null;
    const privateNumbers = (settings?.whatsappNumbers || '').split(',').map((p: string) => p.trim()).filter(Boolean);
    const privateModules: string[] = (() => {
      try {
        const raw = (settings as any)?.whatsappPrivateModules;
        if (raw) return JSON.parse(raw);
      } catch { /* ignore */ }
      return DEFAULT_PRIVATE_MODULES;
    })();
    const autoCollectConfig = (() => {
      try {
        const raw = (settings as any)?.autoCollectConfig;
        if (raw) return JSON.parse(raw);
      } catch { /* ignore */ }
      return null;
    })();
    res.json({
      groupJid,
      groupName,
      privateNumbers,
      privateModules,
      groupModules: ALL_MODULES.filter(m => !privateModules.includes(m)),
      autoCollectConfig,
      connectionStatus: getConnectionStatus(),
      connectedNumber: getConnectedNumber(),
    });
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
