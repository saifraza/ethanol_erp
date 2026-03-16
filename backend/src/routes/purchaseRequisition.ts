import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate as any);

// GET / — list requisitions (with optional status filter)
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, urgency } = req.query;
    const where: any = {};
    if (status) where.status = status;
    if (urgency) where.urgency = urgency;

    const reqs = await prisma.purchaseRequisition.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ requisitions: reqs });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /stats
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const reqs = await prisma.purchaseRequisition.findMany();
    const byStatus: Record<string, number> = {};
    const byUrgency: Record<string, number> = {};
    let totalValue = 0;
    let pendingValue = 0;
    for (const r of reqs) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      byUrgency[r.urgency] = (byUrgency[r.urgency] || 0) + 1;
      const val = r.quantity * r.estimatedCost;
      totalValue += val;
      if (['DRAFT', 'SUBMITTED'].includes(r.status)) pendingValue += val;
    }
    res.json({ byStatus, byUrgency, total: reqs.length, totalValue, pendingValue });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const pr = await prisma.purchaseRequisition.findUnique({ where: { id: req.params.id } });
    if (!pr) return res.status(404).json({ error: 'Requisition not found' });
    res.json(pr);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST / — create new requisition
router.post('/', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const user = (req as any).user;
    const pr = await prisma.purchaseRequisition.create({
      data: {
        title: b.title,
        itemName: b.itemName,
        quantity: parseFloat(b.quantity) || 1,
        unit: b.unit || 'nos',
        estimatedCost: parseFloat(b.estimatedCost) || 0,
        urgency: b.urgency || 'ROUTINE',
        category: b.category || 'GENERAL',
        justification: b.justification || null,
        linkedIssueId: b.linkedIssueId || null,
        supplier: b.supplier || null,
        status: b.status || 'DRAFT',
        remarks: b.remarks || null,
        requestedBy: user.name || user.email,
        userId: user.id,
      },
    });
    res.status(201).json(pr);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /:id — update requisition
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const data: any = {};
    // Editable fields
    if (b.title !== undefined) data.title = b.title;
    if (b.itemName !== undefined) data.itemName = b.itemName;
    if (b.quantity !== undefined) data.quantity = parseFloat(b.quantity);
    if (b.unit !== undefined) data.unit = b.unit;
    if (b.estimatedCost !== undefined) data.estimatedCost = parseFloat(b.estimatedCost);
    if (b.urgency !== undefined) data.urgency = b.urgency;
    if (b.category !== undefined) data.category = b.category;
    if (b.justification !== undefined) data.justification = b.justification;
    if (b.supplier !== undefined) data.supplier = b.supplier;
    if (b.remarks !== undefined) data.remarks = b.remarks;
    // Status transitions
    if (b.status !== undefined) {
      data.status = b.status;
      if (b.status === 'APPROVED') {
        data.approvedBy = (req as any).user.name || (req as any).user.email;
        data.approvedAt = new Date();
      }
      if (b.status === 'REJECTED') {
        data.rejectionReason = b.rejectionReason || null;
      }
    }

    const pr = await prisma.purchaseRequisition.update({
      where: { id: req.params.id },
      data,
    });
    res.json(pr);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /:id
router.delete('/:id', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  try {
    await prisma.purchaseRequisition.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
