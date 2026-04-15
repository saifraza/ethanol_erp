/**
 * Weighbridge Audit Events — cloud receiver + admin viewer.
 *
 * Purpose: cross-system audit trail for weighbridge safety overrides and
 * soft-confirmations. Factory server records each event locally first
 * (WeighmentAuditQueue) and the syncWorker pushes here. Admins view the
 * full timeline at /admin/weighbridge-audit.
 *
 * Two auth modes:
 *   POST  /push       — X-WB-Key (machine-to-machine from factory)
 *   GET   /events     — JWT + ADMIN role (cloud admin UI)
 *
 * Idempotency: factoryEventId is @unique on the model. Push handler uses
 * createMany({skipDuplicates:true}) so retries are safe.
 */

import { Router, Response, Request } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { asyncHandler, validate } from '../shared/middleware';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';

const router = Router();

const WB_PUSH_KEY = process.env.WB_PUSH_KEY || 'mspil-wb-2026';

function checkWbKey(req: Request, res: Response): boolean {
  const key = req.headers['x-wb-key'] as string;
  if (!key || key.length !== WB_PUSH_KEY.length) {
    res.status(401).json({ error: 'Invalid weighbridge push key' });
    return false;
  }
  const a = Buffer.from(key, 'utf8');
  const b = Buffer.from(WB_PUSH_KEY, 'utf8');
  if (!crypto.timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'Invalid weighbridge push key' });
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/weighbridge/audit/push
// Factory syncWorker posts a batch of audit events. Idempotent via factoryEventId.
// ─────────────────────────────────────────────────────────────────────────
const pushSchema = z.object({
  events: z.array(z.object({
    factoryEventId: z.string(),
    eventType: z.string(),
    ruleKey: z.string().nullable().optional(),
    weighmentLocalId: z.string(),
    ticketNo: z.number().int().nullable().optional(),
    vehicleNo: z.string().nullable().optional(),
    pcId: z.string().nullable().optional(),
    action: z.string().nullable().optional(),
    newWeight: z.number().nullable().optional(),
    prevWeight: z.number().nullable().optional(),
    liveScaleWeight: z.number().nullable().optional(),
    thresholdKg: z.number().nullable().optional(),
    message: z.string().nullable().optional(),
    confirmedBy: z.string(),
    confirmReason: z.string().nullable().optional(),
    occurredAt: z.string(), // ISO
    rawPayload: z.unknown().optional(),
  })),
});

router.post('/push', validate(pushSchema), asyncHandler(async (req: Request, res: Response) => {
  if (!checkWbKey(req, res)) return;
  const { events } = req.body as z.infer<typeof pushSchema>;
  if (events.length === 0) {
    res.json({ ok: true, accepted: 0 });
    return;
  }

  const result = await prisma.weighmentAuditEvent.createMany({
    data: events.map(e => ({
      factoryEventId: e.factoryEventId,
      eventType: e.eventType,
      ruleKey: e.ruleKey ?? null,
      weighmentLocalId: e.weighmentLocalId,
      ticketNo: e.ticketNo ?? null,
      vehicleNo: e.vehicleNo ?? null,
      pcId: e.pcId ?? null,
      action: e.action ?? null,
      newWeight: e.newWeight ?? null,
      prevWeight: e.prevWeight ?? null,
      liveScaleWeight: e.liveScaleWeight ?? null,
      thresholdKg: e.thresholdKg ?? null,
      message: e.message ?? null,
      confirmedBy: e.confirmedBy,
      confirmReason: e.confirmReason ?? null,
      occurredAt: new Date(e.occurredAt),
      rawPayload: e.rawPayload === undefined || e.rawPayload === null
        ? Prisma.JsonNull
        : (e.rawPayload as Prisma.InputJsonValue),
    })),
    skipDuplicates: true,
  });

  res.json({ ok: true, accepted: result.count, ackIds: events.map(e => e.factoryEventId) });
}));

// ─────────────────────────────────────────────────────────────────────────
// GET /api/weighbridge/audit/events
// Admin-only listing with filters + pagination.
// ─────────────────────────────────────────────────────────────────────────
router.get('/events', authenticate, authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const take = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const skip = parseInt(req.query.offset as string) || 0;
  const eventType = req.query.eventType as string | undefined;
  const search = ((req.query.search as string) || '').trim();
  const fromStr = req.query.from as string | undefined;
  const toStr = req.query.to as string | undefined;

  const where: Record<string, unknown> = {};
  if (eventType) where.eventType = eventType;
  if (fromStr || toStr) {
    where.occurredAt = {
      ...(fromStr ? { gte: new Date(fromStr) } : {}),
      ...(toStr ? { lte: new Date(toStr) } : {}),
    };
  }
  if (search) {
    const num = Number(search);
    where.OR = [
      { vehicleNo: { contains: search, mode: 'insensitive' } },
      { confirmedBy: { contains: search, mode: 'insensitive' } },
      ...(Number.isFinite(num) ? [{ ticketNo: num }] : []),
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.weighmentAuditEvent.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      take,
      skip,
      select: {
        id: true, factoryEventId: true, eventType: true, ruleKey: true,
        weighmentLocalId: true, ticketNo: true, vehicleNo: true, pcId: true,
        action: true, newWeight: true, prevWeight: true, liveScaleWeight: true,
        thresholdKg: true, message: true, confirmedBy: true, confirmReason: true,
        occurredAt: true, receivedAt: true,
      },
    }),
    prisma.weighmentAuditEvent.count({ where }),
  ]);

  res.json({ rows, total, limit: take, offset: skip });
}));

// ─────────────────────────────────────────────────────────────────────────
// GET /api/weighbridge/audit/summary
// 24h KPI counts by eventType — feeds the admin page header strip.
// ─────────────────────────────────────────────────────────────────────────
router.get('/summary', authenticate, authorize('ADMIN'), asyncHandler(async (_req: AuthRequest, res: Response) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const groups = await prisma.weighmentAuditEvent.groupBy({
    by: ['eventType'],
    where: { occurredAt: { gte: since } },
    _count: { _all: true },
  });
  const totals: Record<string, number> = {};
  for (const g of groups) totals[g.eventType] = g._count._all;
  res.json({ since: since.toISOString(), totals });
}));

export default router;
