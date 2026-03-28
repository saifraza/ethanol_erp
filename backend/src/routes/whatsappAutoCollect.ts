import { Router, Response } from 'express';
import { AuthRequest, authenticate } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import {
  startCollection,
  getSchedules,
  saveSchedules,
  loadSchedules,
  getActiveSessions,
  getAvailableModules,
  clearSession,
  clearAllSessions,
} from '../services/whatsappAutoCollect';
import prisma from '../config/prisma';

const router = Router();

// GET /api/auto-collect/modules — available modules for auto-collection
router.get(
  '/modules',
  authenticate,
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    res.json(getAvailableModules());
  })
);

// GET /api/auto-collect/schedules — current schedule config
router.get(
  '/schedules',
  authenticate,
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    res.json(await getSchedules());
  })
);

// POST /api/auto-collect/schedules — save schedule config
router.post(
  '/schedules',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { schedules } = req.body;
    if (!Array.isArray(schedules)) {
      res.status(400).json({ error: 'schedules must be an array' });
      return;
    }
    await saveSchedules(schedules);
    res.json({ success: true, schedules: await getSchedules() });
  })
);

// PUT /api/auto-collect/schedules/:module — save a single module's schedule directly to DB
router.put(
  '/schedules/:module',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const moduleName = req.params.module;
    const { phone, intervalMinutes, enabled, autoShare, language } = req.body;

    if (!phone && enabled !== false) {
      res.status(400).json({ error: 'phone is required when enabling a schedule' });
      return;
    }

    // Upsert directly to the AutoCollectSchedule table
    await prisma.autoCollectSchedule.upsert({
      where: { module: moduleName },
      create: {
        module: moduleName,
        phone: phone || '',
        intervalMinutes: intervalMinutes || 60,
        enabled: enabled ?? false,
        autoShare: autoShare !== false,
        language: language || 'hi',
      },
      update: {
        phone: phone || '',
        intervalMinutes: intervalMinutes || 60,
        enabled: enabled ?? false,
        autoShare: autoShare !== false,
        language: language || 'hi',
      },
    });

    // Reload all schedules from DB into memory
    await loadSchedules();
    res.json({ success: true, schedules: getSchedules() });
  })
);

// POST /api/auto-collect/trigger — manually trigger a collection now
// If WA_WORKER_URL is set, proxy to the worker so the session lives where replies arrive
router.post(
  '/trigger',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { phone, module, autoShare } = req.body;
    if (!phone || !module) {
      res.status(400).json({ error: 'phone and module are required' });
      return;
    }

    const workerUrl = process.env.WA_WORKER_URL;
    if (workerUrl) {
      // Proxy to worker — session must live on the worker where replies arrive
      try {
        const axios = (await import('axios')).default;
        const apiKey = process.env.WA_WORKER_API_KEY || 'mspil-wa-internal';
        const resp = await axios.post(`${workerUrl}/wa/auto-collect/trigger`, { phone, module, autoShare }, {
          headers: { 'x-api-key': apiKey },
          timeout: 15000,
        });
        res.json(resp.data);
      } catch (err: unknown) {
        const axErr = err as { response?: { data?: { error?: string } }; message?: string };
        res.status(502).json({ success: false, error: axErr.response?.data?.error || axErr.message || 'Worker unreachable' });
      }
    } else {
      const result = await startCollection(phone, module, autoShare !== false);
      res.json(result);
    }
  })
);

// GET /api/auto-collect/debug — check raw DB value for autoCollectConfig
router.get(
  '/debug',
  authenticate,
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const settings = await prisma.settings.findFirst({
      select: { id: true, autoCollectConfig: true, updatedAt: true },
    });
    res.json({
      dbValue: (settings as any)?.autoCollectConfig || null,
      inMemory: getSchedules(),
      settingsId: settings?.id || null,
      updatedAt: settings?.updatedAt || null,
    });
  })
);

// GET /api/auto-collect/sessions — active collection sessions (proxy to worker if external)
router.get(
  '/sessions',
  authenticate,
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const workerUrl = process.env.WA_WORKER_URL;
    if (workerUrl) {
      try {
        const axios = (await import('axios')).default;
        const apiKey = process.env.WA_WORKER_API_KEY || 'mspil-wa-internal';
        const resp = await axios.get(`${workerUrl}/wa/auto-collect/sessions`, { headers: { 'x-api-key': apiKey }, timeout: 10000 });
        res.json(resp.data);
      } catch {
        res.json(getActiveSessions()); // fallback to local
      }
    } else {
      res.json(getActiveSessions());
    }
  })
);

// DELETE /api/auto-collect/sessions/:phone — clear a stuck session
router.delete(
  '/sessions/:phone',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cleared = clearSession(req.params.phone);
    res.json({ success: cleared, message: cleared ? 'Session cleared' : 'No session found' });
  })
);

// DELETE /api/auto-collect/sessions — clear ALL sessions
router.delete(
  '/sessions',
  authenticate,
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const count = clearAllSessions();
    res.json({ success: true, cleared: count });
  })
);

export default router;
