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
import { waSend, waSendGroup, waStatus } from '../services/whatsappClient';
import axios from 'axios';

const WORKER_URL = process.env.WA_WORKER_URL;
const WORKER_KEY = process.env.WA_WORKER_API_KEY || 'mspil-wa-internal';
const useWorker = !!WORKER_URL;

const router = Router();

// All available modules for WhatsApp reporting
const ALL_MODULES = [
  'liquefaction', 'fermentation', 'distillation', 'milling',
  'evaporation', 'decanter', 'dryer', 'ethanol-product', 'grain',
  'ddgs', 'ddgs-stock', 'ddgs-dispatch', 'sales', 'dispatch',
  'procurement', 'accounts', 'inventory',
];

// Default routing: module → "group1" | "group2" | "private"
const DEFAULT_MODULE_ROUTING: Record<string, string> = {
  'liquefaction': 'group1', 'fermentation': 'group1', 'distillation': 'group1',
  'milling': 'group1', 'evaporation': 'group1', 'decanter': 'group1',
  'dryer': 'group1', 'ethanol-product': 'group1', 'grain': 'group1',
  'ddgs': 'group1', 'ddgs-stock': 'private', 'ddgs-dispatch': 'private',
  'sales': 'private', 'dispatch': 'private', 'procurement': 'private',
  'accounts': 'private', 'inventory': 'private',
};

// Legacy: old privateModules array → convert to new routing format
const DEFAULT_PRIVATE_MODULES = [
  'ddgs-stock', 'ddgs-dispatch', 'sales', 'dispatch',
  'procurement', 'accounts', 'inventory',
];

/** Read module routing from settings, with migration from old format */
function getModuleRouting(settings: any): Record<string, string> {
  // Try new format first
  try {
    const raw = settings?.whatsappModuleRouting;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    }
  } catch { /* ignore */ }

  // Fall back to old privateModules format → convert to group1/private
  try {
    const raw = settings?.whatsappPrivateModules;
    if (raw) {
      const privMods: string[] = JSON.parse(raw);
      const routing: Record<string, string> = {};
      for (const m of ALL_MODULES) {
        routing[m] = privMods.includes(m) ? 'private' : 'group1';
      }
      return routing;
    }
  } catch { /* ignore */ }

  return { ...DEFAULT_MODULE_ROUTING };
}

/** Resolve a routing target to a group JID */
function resolveGroupJid(target: string, settings: any): string | null {
  if (target === 'group1') return settings?.whatsappGroupJid || null;
  if (target === 'group2') return settings?.whatsappGroup2Jid || null;
  return null;
}

// Helper to call worker API
async function workerCall(method: 'get' | 'post', path: string, data?: any): Promise<any> {
  const res = await axios({ method, url: `${WORKER_URL}${path}`, data, headers: { 'x-api-key': WORKER_KEY }, timeout: 15000 });
  return res.data;
}

// GET /api/whatsapp/status
router.get(
  '/status',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (useWorker) {
      try {
        const data = await workerCall('get', '/wa/status');
        res.json({ status: data.connected ? 'connected' : 'disconnected', qr: data.qr || null, connectedNumber: null, worker: true });
      } catch (err: any) {
        res.json({ status: 'worker-unreachable', qr: null, connectedNumber: null, worker: true, error: err.message });
      }
      return;
    }
    res.json({ status: getConnectionStatus(), qr: getQRCode(), connectedNumber: getConnectedNumber() });
  })
);

// POST /api/whatsapp/connect
router.post(
  '/connect',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (useWorker) {
      try {
        const data = await workerCall('post', '/wa/connect');
        res.json({ status: 'connected', worker: true, ...data });
      } catch (err: any) {
        res.status(500).json({ error: `Worker unreachable: ${err.message}` });
      }
      return;
    }
    await connectWhatsApp();
    await new Promise((r) => setTimeout(r, 2000));
    res.json({ status: getConnectionStatus(), qr: getQRCode() });
  })
);

// POST /api/whatsapp/disconnect
router.post(
  '/disconnect',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (useWorker) {
      try {
        await workerCall('post', '/wa/disconnect');
        res.json({ status: 'disconnected', worker: true });
      } catch (err: any) {
        res.status(500).json({ error: `Worker unreachable: ${err.message}` });
      }
      return;
    }
    await disconnectWhatsApp();
    res.json({ status: 'disconnected' });
  })
);

// GET /api/whatsapp/groups
router.get(
  '/groups',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    // Groups only available via local Baileys for now
    if (useWorker) { res.json([]); return; }
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
    if (!phone || !message) { res.status(400).json({ error: 'phone and message required' }); return; }
    const result = await waSend(phone, message);
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

// POST /api/whatsapp/send-report — smart routing: group1 / group2 / private based on module
router.post(
  '/send-report',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { message, module } = req.body as { message: string; module?: string };
    if (!message) { res.status(400).json({ error: 'message is required' }); return; }

    const settings = await prisma.settings.findFirst();
    const routing = getModuleRouting(settings);
    const results: { target: string; success: boolean; error?: string }[] = [];

    const mod = (module || '').toLowerCase();
    const target = routing[mod] || 'group1'; // default to group1 for unknown modules

    console.log(`[WA] send-report: module="${mod}" target="${target}" group1=${settings?.whatsappGroupJid ? 'SET' : 'NOT SET'} group2=${(settings as any)?.whatsappGroup2Jid ? 'SET' : 'NOT SET'}`);

    if (target === 'private') {
      // Send to private numbers only
      const privateNumbers = (settings?.whatsappNumbers || '').split(',').map((p: string) => p.trim()).filter(Boolean);
      for (const phone of privateNumbers) {
        const r = await waSend(phone, message, module);
        results.push({ target: phone, ...r });
      }
    } else {
      // Send to the assigned group (group1 or group2)
      const groupJid = resolveGroupJid(target, settings);
      if (groupJid) {
        const r = await waSendGroup(groupJid, message, module);
        results.push({ target, ...r });
      }
    }

    if (results.length === 0) {
      const reason = target === 'private' ? 'No private numbers configured. Add numbers in Settings.'
        : `No WhatsApp ${target} configured. Set group in Settings.`;
      res.status(400).json({ error: reason, sent: 0, failed: 0, total: 0, results: [] });
      return;
    }

    const sent = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
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
    const routing = getModuleRouting(settings);
    const autoCollectConfig = (() => {
      try {
        const raw = (settings as any)?.autoCollectConfig;
        if (raw) return JSON.parse(raw);
      } catch { /* ignore */ }
      return null;
    })();
    res.json({
      group1Jid: settings?.whatsappGroupJid || null,
      group1Name: settings?.whatsappGroupName || null,
      group2Jid: (settings as any)?.whatsappGroup2Jid || null,
      group2Name: (settings as any)?.whatsappGroup2Name || null,
      privateNumbers: (settings?.whatsappNumbers || '').split(',').map((p: string) => p.trim()).filter(Boolean),
      moduleRouting: routing,
      autoCollectConfig,
      connectionStatus: getConnectionStatus(),
      connectedNumber: getConnectedNumber(),
    });
  })
);

// GET /api/whatsapp/modules — list all modules + routing config
router.get(
  '/modules',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const settings = await prisma.settings.findFirst();
    const routing = getModuleRouting(settings);
    res.json({
      all: ALL_MODULES,
      routing,
      // Legacy field for backward compat
      privateModules: ALL_MODULES.filter(m => routing[m] === 'private'),
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
