/**
 * Activity Log — admin viewer for the generic high-value audit trail.
 * Read-only. All writes happen automatically via Prisma middleware in
 * services/activityLogger.ts.
 *
 * Endpoints:
 *   GET /events    — paginated, filterable list
 *   GET /summary   — 24h KPI counts by category
 *   GET /:id       — full row including the changes JSON (for the detail panel)
 *
 * Auth: JWT + ADMIN role for all endpoints.
 */

import { Router, Response } from 'express';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import prisma from '../config/prisma';

const router = Router();

router.use(authenticate);
router.use(authorize('ADMIN'));

// ─────────────────────────────────────────────────────────────────────────
// GET /api/activity-log/events
// Filterable + paginated list of activity log rows.
// ─────────────────────────────────────────────────────────────────────────
router.get('/events', asyncHandler(async (req: AuthRequest, res: Response) => {
  const take = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const skip = parseInt(req.query.offset as string) || 0;
  const category = req.query.category as string | undefined;
  const model = req.query.model as string | undefined;
  const action = req.query.action as string | undefined;
  const userName = (req.query.user as string | undefined)?.trim();
  const search = ((req.query.search as string) || '').trim();
  const fromStr = req.query.from as string | undefined;
  const toStr = req.query.to as string | undefined;

  const where: Record<string, unknown> = {};
  if (category) where.category = category;
  if (model) where.model = model;
  if (action) where.action = action;
  if (userName) where.userName = { contains: userName, mode: 'insensitive' };
  if (fromStr || toStr) {
    where.createdAt = {
      ...(fromStr ? { gte: new Date(fromStr) } : {}),
      ...(toStr ? { lte: new Date(toStr) } : {}),
    };
  }
  if (search) {
    where.OR = [
      { summary: { contains: search, mode: 'insensitive' } },
      { recordId: { contains: search, mode: 'insensitive' } },
      { routePath: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      select: {
        id: true, category: true, model: true, recordId: true, action: true,
        userId: true, userName: true, userRole: true,
        routePath: true, ipAddress: true, summary: true, createdAt: true,
        // changes excluded from list (heavy JSON) — fetch via /:id for detail
      },
    }),
    prisma.activityLog.count({ where }),
  ]);

  res.json({ rows, total, limit: take, offset: skip });
}));

// ─────────────────────────────────────────────────────────────────────────
// GET /api/activity-log/summary
// 24h KPI counts by category — feeds the admin page header strip.
// ─────────────────────────────────────────────────────────────────────────
router.get('/summary', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [byCategory, total] = await Promise.all([
    prisma.activityLog.groupBy({
      by: ['category'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.activityLog.count({ where: { createdAt: { gte: since } } }),
  ]);
  const totals: Record<string, number> = {};
  for (const g of byCategory) totals[g.category] = g._count._all;
  res.json({ since: since.toISOString(), total, totals });
}));

// ─────────────────────────────────────────────────────────────────────────
// GET /api/activity-log/:id
// Full row including the changes JSON (clicked from the list).
// ─────────────────────────────────────────────────────────────────────────
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const row = await prisma.activityLog.findUnique({ where: { id: req.params.id as string } });
  if (!row) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(row);
}));

export default router;
