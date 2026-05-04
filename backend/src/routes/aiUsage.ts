/**
 * GET /api/ai-usage — list AI call audit log + roll-up totals.
 *
 * Powers the Settings → AI Usage page so admins can see which features burn
 * tokens, which fail, and what the running cost is.
 *
 * Filters via query string:
 *   ?feature=rfq-extraction   ?model=gemini-3-flash-preview
 *   ?success=true|false       ?days=7  (default 30)
 *   ?page=1  ?limit=100       (max 500)
 */
import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';

const router = Router();
router.use(authenticate);
router.use(authorize('SUPER_ADMIN', 'ADMIN'));

// GET / — paginated log + summary
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { feature, model, success } = req.query;
    const days = Math.min(parseInt((req.query.days as string) || '30', 10) || 30, 365);
    const page = Math.max(parseInt((req.query.page as string) || '1', 10) || 1, 1);
    const limit = Math.min(parseInt((req.query.limit as string) || '100', 10) || 100, 500);

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const where: Record<string, unknown> = { createdAt: { gte: since } };
    if (typeof feature === 'string' && feature) where.feature = feature;
    if (typeof model === 'string' && model) where.model = model;
    if (success === 'true' || success === 'false') where.success = success === 'true';

    const [rows, total, summary] = await Promise.all([
      prisma.aiCallLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.aiCallLog.count({ where }),
      prisma.aiCallLog.aggregate({
        where,
        _sum: { inputTokens: true, outputTokens: true, totalTokens: true, estimatedCostUsd: true, estimatedCostInr: true, durationMs: true },
        _count: { _all: true },
      }),
    ]);

    // Per-feature breakdown
    const byFeature = await prisma.aiCallLog.groupBy({
      by: ['feature'],
      where,
      _count: { _all: true },
      _sum: { totalTokens: true, estimatedCostInr: true },
    });
    // Per-model breakdown
    const byModel = await prisma.aiCallLog.groupBy({
      by: ['model'],
      where,
      _count: { _all: true },
      _sum: { totalTokens: true, estimatedCostInr: true },
    });
    // Failure rate
    const failureCount = await prisma.aiCallLog.count({ where: { ...where, success: false } });

    res.json({
      rows,
      total,
      page,
      limit,
      summary: {
        totalCalls: summary._count._all,
        failures: failureCount,
        successRate: summary._count._all > 0 ? 1 - failureCount / summary._count._all : 1,
        totalTokens: summary._sum.totalTokens ?? 0,
        inputTokens: summary._sum.inputTokens ?? 0,
        outputTokens: summary._sum.outputTokens ?? 0,
        estimatedCostUsd: summary._sum.estimatedCostUsd ?? 0,
        estimatedCostInr: summary._sum.estimatedCostInr ?? 0,
        avgDurationMs: summary._count._all > 0 ? Math.round((summary._sum.durationMs ?? 0) / summary._count._all) : 0,
      },
      byFeature: byFeature.map(f => ({
        feature: f.feature,
        calls: f._count._all,
        tokens: f._sum.totalTokens ?? 0,
        costInr: f._sum.estimatedCostInr ?? 0,
      })).sort((a, b) => b.costInr - a.costInr),
      byModel: byModel.map(m => ({
        model: m.model,
        calls: m._count._all,
        tokens: m._sum.totalTokens ?? 0,
        costInr: m._sum.estimatedCostInr ?? 0,
      })).sort((a, b) => b.costInr - a.costInr),
      windowDays: days,
    });
}));

export default router;
