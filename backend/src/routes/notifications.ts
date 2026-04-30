import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { resolveNotifications } from '../services/notify';

const router = Router();
router.use(authenticate);

// Build the WHERE clause that matches notifications visible to the current user:
// (user-specific OR role-broadcast matching their role) AND not resolved
function visibleWhere(req: AuthRequest) {
  const userId = req.user!.id;
  const role = req.user!.role;
  return {
    resolved: false,
    OR: [
      { userId },
      { role },
      { userId: null, role: null }, // global broadcast
    ],
  };
}

// GET / — list visible notifications (latest first)
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const take = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const unreadOnly = req.query.unread === 'true';
  const where: Record<string, unknown> = visibleWhere(req);
  if (unreadOnly) (where as any).read = false;

  const items = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true, category: true, severity: true, title: true, message: true,
      link: true, read: true, createdAt: true, metadata: true,
      entityType: true, entityId: true,
    },
  });
  res.json(items);
}));

// GET /count — unread count (for bell badge)
router.get('/count', asyncHandler(async (req: AuthRequest, res: Response) => {
  const where = { ...visibleWhere(req), read: false };
  const count = await prisma.notification.count({ where });

  // Severity breakdown (so the bell can turn red for CRITICAL)
  const critical = await prisma.notification.count({
    where: { ...where, severity: 'CRITICAL' },
  });
  res.json({ count, critical });
}));

// POST /:id/read — mark one as read
router.post('/:id/read', asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.notification.updateMany({
    where: { id: req.params.id, ...visibleWhere(req) },
    data: { read: true, readAt: new Date() },
  });
  res.json({ ok: true });
}));

// POST /read-all — mark all visible as read
router.post('/read-all', asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await prisma.notification.updateMany({
    where: { ...visibleWhere(req), read: false },
    data: { read: true, readAt: new Date() },
  });
  res.json({ updated: result.count });
}));

// POST /:id/resolve — dismiss (admin only — actually resolves the underlying item)
router.post('/:id/resolve', asyncHandler(async (req: AuthRequest, res: Response) => {
  const n = await prisma.notification.findUnique({ where: { id: req.params.id } });
  if (!n) return res.status(404).json({ error: 'Not found' });
  if (n.entityType && n.entityId) {
    await resolveNotifications(n.entityType, n.entityId);
  } else {
    await prisma.notification.update({
      where: { id: n.id },
      data: { resolved: true, resolvedAt: new Date() },
    });
  }
  res.json({ ok: true });
}));

export default router;
