import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';

const router = Router();
router.use(authenticate as any);

// GET / — list requisitions (with optional status filter)
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
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
}));

// GET /stats
router.get('/stats', asyncHandler(async (_req: AuthRequest, res: Response) => {
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
}));

// GET /:id
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const pr = await prisma.purchaseRequisition.findUnique({ where: { id: req.params.id } });
    if (!pr) return res.status(404).json({ error: 'Requisition not found' });
    res.json(pr);
}));

// POST / — create new requisition
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body;
    const user = req.user!;
    // New requisitions always start as DRAFT (ignore caller-supplied status)
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
        status: 'DRAFT',
        remarks: b.remarks || null,
        requestedBy: user.name || user.email,
        userId: user.id,
        inventoryItemId: b.inventoryItemId || null,
        department: b.department || null,
        requestedByPerson: b.requestedByPerson || null,
      },
    });
    res.status(201).json(pr);
}));

// GET /:id/stock-check — check available stock for this indent's item
router.get('/:id/stock-check', asyncHandler(async (req: AuthRequest, res: Response) => {
    const pr = await prisma.purchaseRequisition.findUnique({ where: { id: req.params.id } });
    if (!pr) return res.status(404).json({ error: 'Requisition not found' });

    let available = 0;
    let itemUnit = pr.unit;
    if (pr.inventoryItemId) {
      const item = await prisma.inventoryItem.findUnique({ where: { id: pr.inventoryItemId }, select: { currentStock: true, unit: true, costPerUnit: true } });
      if (item) {
        available = item.currentStock;
        itemUnit = item.unit;
      }
    }
    const requested = pr.quantity;
    const canFulfillFromStock = Math.min(available, requested);
    const shortfall = Math.max(0, requested - available);

    res.json({ available, requested, canFulfillFromStock, shortfall, unit: itemUnit });
}));

// PUT /:id/issue — warehouse issues stock and splits remaining to purchase
router.put('/:id/issue', asyncHandler(async (req: AuthRequest, res: Response) => {
    const pr = await prisma.purchaseRequisition.findUnique({ where: { id: req.params.id } });
    if (!pr) return res.status(404).json({ error: 'Requisition not found' });
    if (!['APPROVED'].includes(pr.status)) return res.status(400).json({ error: 'Can only issue from APPROVED status' });

    const issueQty = parseFloat(req.body.issuedQty) || 0;
    if (issueQty < 0 || issueQty > pr.quantity) return res.status(400).json({ error: 'Invalid issue quantity' });

    const purchaseQty = pr.quantity - issueQty;
    const user = req.user!;

    // If issuing from stock, validate availability and create proper stock movement
    if (issueQty > 0 && pr.inventoryItemId) {
      const item = await prisma.inventoryItem.findUnique({
        where: { id: pr.inventoryItemId },
        select: { id: true, currentStock: true, avgCost: true, unit: true, name: true },
      });
      if (!item) return res.status(400).json({ error: 'Inventory item not found' });
      if (item.currentStock < issueQty) {
        return res.status(400).json({
          error: `Insufficient stock: available ${item.currentStock} ${item.unit}, requested ${issueQty} ${item.unit}`,
        });
      }

      await prisma.$transaction(async (tx) => {
        // Create legacy InventoryTransaction (for backward compat)
        await tx.inventoryTransaction.create({
          data: {
            itemId: pr.inventoryItemId!,
            type: 'OUT',
            quantity: issueQty,
            reference: `INDENT-${pr.reqNo}`,
            department: pr.department || 'Production',
            issuedTo: pr.requestedByPerson || pr.requestedBy,
            remarks: `Indent #${pr.reqNo}: ${pr.title}`,
            userId: user.id,
          },
        });

        // Create proper StockMovement (new ledger)
        const defaultWh = await tx.warehouse.findFirst({
          where: { isActive: true },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (defaultWh) {
          await tx.stockMovement.create({
            data: {
              itemId: pr.inventoryItemId!,
              movementType: 'STORE_ISSUE',
              direction: 'OUT',
              quantity: issueQty,
              unit: item.unit,
              costRate: item.avgCost,
              totalValue: Math.round(issueQty * item.avgCost * 100) / 100,
              warehouseId: defaultWh.id,
              refType: 'INDENT',
              refId: pr.id,
              refNo: `INDENT-${pr.reqNo}`,
              narration: `Store issue: ${pr.title} (${pr.requestedByPerson || pr.requestedBy})`,
              userId: user.id,
            },
          });

          // Update StockLevel
          const sl = await tx.stockLevel.findFirst({
            where: { itemId: pr.inventoryItemId!, warehouseId: defaultWh.id, binId: null, batchId: null },
          });
          if (sl) {
            await tx.stockLevel.update({
              where: { id: sl.id },
              data: { quantity: { decrement: issueQty } },
            });
          }
        }

        // Decrement global stock
        await tx.inventoryItem.update({
          where: { id: pr.inventoryItemId! },
          data: {
            currentStock: { decrement: issueQty },
            totalValue: { decrement: Math.round(issueQty * item.avgCost * 100) / 100 },
          },
        });
      });
    }

    // Determine new status
    let newStatus: string;
    if (issueQty >= pr.quantity) {
      newStatus = 'COMPLETED';
    } else if (purchaseQty > 0) {
      newStatus = 'PO_PENDING';
    } else {
      newStatus = 'COMPLETED';
    }

    const updated = await prisma.purchaseRequisition.update({
      where: { id: req.params.id },
      data: {
        issuedQty: issueQty,
        purchaseQty,
        issuedBy: user.name || user.email,
        issuedAt: issueQty > 0 ? new Date() : null,
        status: newStatus,
      },
    });

    res.json(updated);
}));

// PUT /:id — update requisition
router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
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
    if (b.department !== undefined) data.department = b.department;
    if (b.requestedByPerson !== undefined) data.requestedByPerson = b.requestedByPerson;
    if (b.inventoryItemId !== undefined) data.inventoryItemId = b.inventoryItemId;
    // Status transitions — enforce valid paths server-side
    if (b.status !== undefined) {
      const existing = await prisma.purchaseRequisition.findUnique({ where: { id: req.params.id }, select: { status: true } });
      if (!existing) return res.status(404).json({ error: 'Requisition not found' });

      const validTransitions: Record<string, string[]> = {
        'DRAFT': ['SUBMITTED', 'CANCELLED'],
        'SUBMITTED': ['APPROVED', 'REJECTED', 'DRAFT'],
        'APPROVED': ['ISSUED', 'PO_PENDING', 'COMPLETED', 'CANCELLED'],
        'REJECTED': ['DRAFT'],
        'PO_PENDING': ['COMPLETED', 'CANCELLED'],
        'ISSUED': ['COMPLETED'],
        'COMPLETED': [],
        'CANCELLED': ['DRAFT'],
      };

      const allowed = validTransitions[existing.status] || [];
      if (!allowed.includes(b.status)) {
        return res.status(400).json({ error: `Invalid status transition: ${existing.status} → ${b.status}` });
      }

      data.status = b.status;
      if (b.status === 'APPROVED') {
        data.approvedBy = req.user!.name || req.user!.email;
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
}));

// DELETE /:id
router.delete('/:id', authorize('ADMIN') as any, asyncHandler(async (req: AuthRequest, res: Response) => {
    await prisma.purchaseRequisition.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
}));

export default router;
