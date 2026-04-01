import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { NotFoundError } from '../shared/errors';
import prisma from '../config/prisma';
import { enqueueEvent, getWebhookStats } from '../services/webhookDelivery';

const router = Router();

// GET / — webhook delivery stats
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const stats = await getWebhookStats();
  res.json(stats);
}));

// GET /events — list recent webhook events with optional status filter
router.get('/events', asyncHandler(async (req: AuthRequest, res: Response) => {
  const status = req.query.status as string | undefined;
  const take = Math.min(parseInt(req.query.limit as string) || 50, 500);

  const where = status ? { status: status.toUpperCase() } : {};

  const events = await prisma.webhookEvent.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      event: true,
      status: true,
      attempts: true,
      lastError: true,
      nextRetry: true,
      deliveredAt: true,
      createdAt: true,
      targetUrl: true,
    },
  });

  res.json(events);
}));

// POST /test — send a test ping event to factory
router.post('/test', asyncHandler(async (req: AuthRequest, res: Response) => {
  const id = await enqueueEvent('TEST_PING', {
    message: 'Test webhook from cloud ERP',
    timestamp: new Date().toISOString(),
    triggeredBy: req.user?.name || 'unknown',
  });

  if (!id) {
    res.json({ success: false, message: 'FACTORY_WEBHOOK_URL not configured' });
    return;
  }

  res.json({ success: true, eventId: id });
}));

// POST /retry/:id — retry a specific failed/dead event
router.post('/retry/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const evt = await prisma.webhookEvent.findUnique({ where: { id: req.params.id } });
  if (!evt) throw new NotFoundError('WebhookEvent', req.params.id);

  if (evt.status !== 'FAILED' && evt.status !== 'DEAD') {
    res.status(400).json({ error: `Cannot retry event with status ${evt.status}` });
    return;
  }

  await prisma.webhookEvent.update({
    where: { id: evt.id },
    data: {
      status: 'PENDING',
      attempts: 0,
      lastError: null,
      nextRetry: new Date(),
    },
  });

  res.json({ success: true, message: 'Event queued for retry' });
}));

export default router;
