import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';

const router = Router();
router.use(authenticate as any);

// GET / — list issues (with optional status/type filter)
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { status, issueType, severity } = req.query;
  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (issueType) where.issueType = issueType;
  if (severity) where.severity = severity;

  const issues = await prisma.plantIssue.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { comments: { orderBy: { createdAt: 'desc' }, take: 3 } },
  });
  res.json({ issues });
}));

// GET /stats — counts by status/severity
router.get('/stats', asyncHandler(async (req: AuthRequest, res: Response) => {
  // Cap limit to prevent unbounded queries
  const limit = Math.min(parseInt((req.query.limit as string) || '1000'), 5000);
  const issues = await prisma.plantIssue.findMany({ take: limit });
  const byStatus: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  const byType: Record<string, number> = {};
  for (const i of issues) {
    byStatus[i.status] = (byStatus[i.status] || 0) + 1;
    bySeverity[i.severity] = (bySeverity[i.severity] || 0) + 1;
    byType[i.issueType] = (byType[i.issueType] || 0) + 1;
  }
  const avgResolutionHours = issues
    .filter(i => i.resolvedAt)
    .map(i => (new Date(i.resolvedAt!).getTime() - new Date(i.createdAt).getTime()) / 3600000);
  const mttr = avgResolutionHours.length > 0
    ? avgResolutionHours.reduce((a, b) => a + b, 0) / avgResolutionHours.length
    : 0;
  res.json({ byStatus, bySeverity, byType, total: issues.length, mttr: Math.round(mttr * 10) / 10 });
}));

// GET /:id — single issue with all comments
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const issue = await prisma.plantIssue.findUnique({
    where: { id: req.params.id },
    include: { comments: { orderBy: { createdAt: 'asc' } } },
  });
  if (!issue) return res.status(404).json({ error: 'Issue not found' });
  res.json(issue);
}));

// POST / — create new issue
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const user = req.user!;
  const issue = await prisma.plantIssue.create({
    data: {
      title: b.title,
      description: b.description || '',
      issueType: b.issueType || 'MECHANICAL',
      severity: b.severity || 'MEDIUM',
      equipment: b.equipment || null,
      location: b.location || null,
      photoUrl: b.photoUrl || null,
      reportedBy: user.name || user.email,
      userId: user.id,
    },
  });
  res.status(201).json(issue);
}));

// PUT /:id — update issue (status, assign, resolve)
router.put('/:id', authorize('ADMIN') as any, asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const data: Record<string, unknown> = {};
  if (b.status !== undefined) data.status = b.status;
  if (b.assignedTo !== undefined) data.assignedTo = b.assignedTo;
  if (b.severity !== undefined) data.severity = b.severity;
  if (b.resolution !== undefined) data.resolution = b.resolution;
  if (b.partsUsed !== undefined) data.partsUsed = b.partsUsed;
  if (b.downtimeHours !== undefined) data.downtimeHours = parseFloat(b.downtimeHours);
  if (b.status === 'RESOLVED' || b.status === 'CLOSED') data.resolvedAt = new Date();

  const issue = await prisma.plantIssue.update({
    where: { id: req.params.id },
    data,
  });
  res.json(issue);
}));

// POST /:id/comment — add comment
router.post('/:id/comment', asyncHandler(async (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const comment = await prisma.issueComment.create({
    data: {
      issueId: req.params.id,
      message: req.body.message,
      userId: user.id,
      userName: user.name || user.email,
    },
  });
  res.status(201).json(comment);
}));

// DELETE /:id
router.delete('/:id', authorize('ADMIN') as any, asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.plantIssue.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

export default router;
