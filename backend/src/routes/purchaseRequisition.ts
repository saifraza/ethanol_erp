import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { createPurchaseOrder } from '../services/purchaseOrderService';
import { COMPANY } from '../shared/config/company';

const router = Router();
router.use(authenticate as any);

// GET / — list requisitions (with optional status filter)
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { status, urgency } = req.query;
    const where: any = { ...getCompanyFilter(req) };
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
    const reqs = await prisma.purchaseRequisition.findMany({ where: { ...getCompanyFilter(_req) } });
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
    // Allow SUBMITTED as initial status (from indent form), otherwise default to DRAFT
    const initialStatus = b.status === 'SUBMITTED' ? 'SUBMITTED' : 'DRAFT';
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
        status: initialStatus,
        remarks: b.remarks || null,
        requestedBy: user.name || user.email,
        userId: user.id,
        inventoryItemId: b.inventoryItemId || null,
        department: b.department || null,
        requestedByPerson: b.requestedByPerson || null,
        companyId: getActiveCompanyId(req),
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
// Role-guarded: only ADMIN/MANAGER can issue stock and trigger auto-PO
router.put('/:id/issue', asyncHandler(async (req: AuthRequest, res: Response) => {
    const user = req.user!;
    if (!['ADMIN', 'MANAGER'].includes(user.role)) {
      return res.status(403).json({ error: 'Only ADMIN or MANAGER can issue from store' });
    }

    let pr = await prisma.purchaseRequisition.findUnique({ where: { id: req.params.id } });
    if (!pr) return res.status(404).json({ error: 'Requisition not found' });

    // Fast-track: auto-approve DRAFT/SUBMITTED indents when store manager issues directly
    if (['DRAFT', 'SUBMITTED'].includes(pr.status)) {
      pr = await prisma.purchaseRequisition.update({
        where: { id: pr.id },
        data: { status: 'APPROVED', approvedBy: user.name || user.email, approvedAt: new Date() },
      });
    }
    if (pr.status !== 'APPROVED') return res.status(400).json({ error: 'Can only issue from APPROVED status' });

    // Validate issuedQty with strict parsing (Codex: don't let malformed input become 0)
    const rawQty = req.body.issuedQty;
    const issueQty = typeof rawQty === 'number' ? rawQty : parseFloat(rawQty);
    if (isNaN(issueQty) || issueQty < 0 || issueQty > pr.quantity) {
      return res.status(400).json({ error: `Invalid issue quantity: must be 0–${pr.quantity}` });
    }

    const purchaseQty = Math.round((pr.quantity - issueQty) * 1000) / 1000;

    // If issuing from stock, validate availability and create proper stock movement
    if (issueQty > 0 && pr.inventoryItemId) {
      // Stock check + deduction inside transaction to prevent oversell (Codex race condition fix)
      try {
        await prisma.$transaction(async (tx) => {
          const item = await tx.inventoryItem.findUnique({
            where: { id: pr.inventoryItemId! },
            select: { id: true, currentStock: true, avgCost: true, unit: true, name: true },
          });
          if (!item) throw new Error('Inventory item not found');
          if (item.currentStock < issueQty) {
            throw new Error(`Insufficient stock: available ${item.currentStock} ${item.unit}, requested ${issueQty} ${item.unit}`);
          }

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
      } catch (txErr: unknown) {
        // Map known validation errors to 400 instead of letting them bubble as 500
        const msg = txErr instanceof Error ? txErr.message : 'Stock issue failed';
        if (msg.includes('Insufficient stock') || msg.includes('not found')) {
          return res.status(400).json({ error: msg });
        }
        throw txErr; // re-throw unknown errors for asyncHandler to handle as 500
      }
    }

    // Determine new status
    const newStatus = issueQty >= pr.quantity ? 'COMPLETED' : purchaseQty > 0 ? 'PO_PENDING' : 'COMPLETED';

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

    // Auto-create DRAFT PO for purchase shortfall (outside stock transaction — failure is non-fatal)
    let autoPO: { created: boolean; poId?: string; poNo?: number; vendorName?: string; rate?: number; quantity?: number; grandTotal?: number; reason?: string } | null = null;

    if (purchaseQty > 0 && pr.inventoryItemId) {
      try {
        // Idempotency check: don't create duplicate PO for same indent (Codex fix)
        const existingPO = await prisma.purchaseOrder.findFirst({
          where: { requisitionId: pr.id, status: { not: 'CANCELLED' } },
          select: { id: true, poNo: true },
        });
        if (existingPO) {
          autoPO = { created: false, reason: `PO #${existingPO.poNo} already exists for this indent` };
        } else {
          // Find preferred vendor — also check vendor.isActive (Codex fix)
          const vendorItem = await prisma.vendorItem.findFirst({
            where: {
              inventoryItemId: pr.inventoryItemId,
              isPreferred: true,
              isActive: true,
              vendor: { isActive: true },
            },
            orderBy: { updatedAt: 'desc' }, // deterministic: most recently updated preferred vendor
            include: {
              vendor: { select: { id: true, name: true, gstState: true, paymentTerms: true, creditDays: true } },
              item: { select: { name: true, hsnCode: true, gstPercent: true, unit: true } },
            },
          });

          if (vendorItem && vendorItem.rate > 0) {
            // Determine GST supply type: compare vendor state code with company state code
            const vendorStateCode = vendorItem.vendor.gstState || '';
            const supplyType = vendorStateCode && vendorStateCode !== COMPANY.stateCode ? 'INTER_STATE' : 'INTRA_STATE';

            const po = await createPurchaseOrder({
              vendorId: vendorItem.vendor.id,
              lines: [{
                inventoryItemId: pr.inventoryItemId,
                description: vendorItem.item.name,
                hsnCode: vendorItem.item.hsnCode || undefined,
                quantity: purchaseQty,
                unit: vendorItem.item.unit || pr.unit,
                rate: vendorItem.rate,
                gstPercent: vendorItem.item.gstPercent || 18,
              }],
              supplyType: supplyType as 'INTRA_STATE' | 'INTER_STATE',
              requisitionId: pr.id,
              userId: user.id,
              remarks: `Auto-created from Indent #${pr.reqNo}`,
              paymentTerms: vendorItem.vendor.paymentTerms || undefined,
              creditDays: vendorItem.vendor.creditDays || 30,
            });

            autoPO = {
              created: true,
              poId: po.id,
              poNo: po.poNo,
              vendorName: vendorItem.vendor.name,
              rate: vendorItem.rate,
              quantity: purchaseQty,
              grandTotal: po.grandTotal,
            };
          } else {
            autoPO = {
              created: false,
              reason: !vendorItem
                ? 'No approved vendor found for this item — manual PO required'
                : 'Vendor rate is 0 — manual PO required with negotiated rate',
            };
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        autoPO = { created: false, reason: `Auto-PO failed: ${message}` };
      }
    }

    res.json({
      requisition: updated,
      issue: { issuedQty: issueQty, purchaseQty, status: newStatus },
      autoPO,
    });
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
        'DRAFT': ['SUBMITTED', 'APPROVED', 'CANCELLED'],
        'SUBMITTED': ['APPROVED', 'REJECTED', 'DRAFT'],
        'APPROVED': ['ISSUED', 'PO_PENDING', 'COMPLETED', 'CANCELLED'],
        'REJECTED': ['DRAFT'],
        'PO_PENDING': ['ORDERED', 'COMPLETED', 'CANCELLED'],
        'ORDERED': ['RECEIVED', 'COMPLETED', 'CANCELLED'],
        'RECEIVED': ['COMPLETED'],
        'ISSUED': ['COMPLETED'],
        'COMPLETED': [],
        'CANCELLED': ['DRAFT'],
      };

      const allowed = validTransitions[existing.status] || [];
      if (!allowed.includes(b.status)) {
        return res.status(400).json({ error: `Invalid status transition: ${existing.status} → ${b.status}` });
      }

      // Role-based authorization for approval actions
      const userRole = req.user!.role;
      if (b.status === 'APPROVED' && !['ADMIN', 'MANAGER'].includes(userRole)) {
        return res.status(403).json({ error: 'Only ADMIN or MANAGER can approve requisitions' });
      }
      if (b.status === 'REJECTED' && !['ADMIN', 'MANAGER'].includes(userRole)) {
        return res.status(403).json({ error: 'Only ADMIN or MANAGER can reject requisitions' });
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
