import { Router, Response } from 'express';
import { AuthRequest, authenticate } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import {
  startCollection,
  getSchedules,
  saveSchedules,
  getActiveSessions,
  getAvailableModules,
  clearSession,
  clearAllSessions,
} from '../services/whatsappAutoCollect';

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
    res.json(getSchedules());
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
    res.json({ success: true, schedules: getSchedules() });
  })
);

// POST /api/auto-collect/trigger — manually trigger a collection now
router.post(
  '/trigger',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { phone, module, autoShare } = req.body;
    if (!phone || !module) {
      res.status(400).json({ error: 'phone and module are required' });
      return;
    }
    const result = await startCollection(phone, module, autoShare !== false);
    res.json(result);
  })
);

// GET /api/auto-collect/sessions — active collection sessions
router.get(
  '/sessions',
  authenticate,
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    res.json(getActiveSessions());
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
