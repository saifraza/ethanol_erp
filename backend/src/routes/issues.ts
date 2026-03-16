import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate as any);

// GET / — list issues (with optional status/type filter)
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, issueType, severity } = req.query;
    const where: any = {};
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
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /stats — counts by status/severity
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const issues = await prisma.plantIssue.findMany();
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
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /:id — single issue with all comments
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const issue = await prisma.plantIssue.findUnique({
      where: { id: req.params.id },
      include: { comments: { orderBy: { createdAt: 'asc' } } },
    });
    if (!issue) return res.status(404).json({ error: 'Issue not found' });
    res.json(issue);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST / — create new issue
router.post('/', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const user = (req as any).user;
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
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /:id — update issue (status, assign, resolve)
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const data: any = {};
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
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /:id/comment — add comment
router.post('/:id/comment', async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const comment = await prisma.issueComment.create({
      data: {
        issueId: req.params.id,
        message: req.body.message,
        userId: user.id,
        userName: user.name || user.email,
      },
    });
    res.status(201).json(comment);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /:id
router.delete('/:id', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  try {
    await prisma.plantIssue.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
