import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { onStockMovement } from '../services/autoJournal';

const router = Router();
router.use(authenticate as any);

// ─── Helper: sync GRN lines to new inventory system ───
async function syncGrnToInventory(
  grnId: string,
  grnNo: number,
  lines: Array<{ materialId: string | null; acceptedQty: number; rate: number; unit: string; batchNo: string; storageLocation: string }>,
  warehouseId: string | null,
  userId: string
): Promise<void> {
  // Need a warehouse — use provided one or find default
  let whId = warehouseId;
  if (!whId) {
    const defaultWh = await prisma.warehouse.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (defaultWh) whId = defaultWh.id;
  }
  if (!whId) return; // no warehouses configured, skip inventory sync

  for (const line of lines) {
    if (!line.materialId || line.acceptedQty <= 0) continue;

    // Find the material to get its name
    const material = await prisma.material.findUnique({ where: { id: line.materialId }, select: { name: true } });
    if (!material) continue;

    // Match to InventoryItem by name (case-insensitive)
    const invItem = await prisma.inventoryItem.findFirst({
      where: { name: { equals: material.name, mode: 'insensitive' } },
      select: { id: true, unit: true, currentStock: true, avgCost: true },
    });
    if (!invItem) continue; // no matching inventory item, skip

    const qty = line.acceptedQty;
    const costRate = line.rate;
    const totalValue = Math.round(qty * costRate * 100) / 100;

    await prisma.$transaction(async (tx) => {
      // 1. Create StockMovement
      const movement = await tx.stockMovement.create({
        data: {
          itemId: invItem.id,
          movementType: 'GRN_RECEIPT',
          direction: 'IN',
          quantity: qty,
          unit: invItem.unit,
          costRate,
          totalValue,
          warehouseId: whId!,
          refType: 'GRN',
          refId: grnId,
          refNo: `GRN-${grnNo}`,
          narration: `GRN receipt for ${material.name}`,
          userId,
        },
      });

      // 2. Upsert StockLevel
      const existing = await tx.stockLevel.findFirst({
        where: { itemId: invItem.id, warehouseId: whId!, binId: null, batchId: null },
      });
      if (existing) {
        await tx.stockLevel.update({
          where: { id: existing.id },
          data: { quantity: { increment: qty } },
        });
      } else {
        await tx.stockLevel.create({
          data: { itemId: invItem.id, warehouseId: whId!, binId: null, batchId: null, quantity: qty },
        });
      }

      // 3. Update InventoryItem — weighted average cost
      const existingQty = invItem.currentStock;
      const existingAvgCost = invItem.avgCost;
      const newTotalQty = existingQty + qty;
      const newAvgCost = newTotalQty > 0
        ? (existingQty * existingAvgCost + qty * costRate) / newTotalQty
        : costRate;

      await tx.inventoryItem.update({
        where: { id: invItem.id },
        data: {
          currentStock: { increment: qty },
          avgCost: Math.round(newAvgCost * 100) / 100,
          totalValue: Math.round(newTotalQty * newAvgCost * 100) / 100,
        },
      });

      // Fire-and-forget auto journal
      onStockMovement(prisma as Parameters<typeof onStockMovement>[0], {
        id: movement.id,
        movementNo: movement.movementNo,
        movementType: movement.movementType,
        direction: movement.direction,
        totalValue: movement.totalValue,
        itemName: material.name,
        userId,
        date: movement.date,
      }).catch(() => {});
    });
  }
}

// GET / — list GRNs with filters (poId, vendorId, status)
router.get('/', async (req: Request, res: Response) => {
  try {
    const poId = req.query.poId as string | undefined;
    const vendorId = req.query.vendorId as string | undefined;
    const status = req.query.status as string | undefined;

    const where: any = {};
    if (poId) where.poId = poId;
    if (vendorId) where.vendorId = vendorId;
    if (status) where.status = status;

    const grns = await prisma.goodsReceipt.findMany({
      where,
      include: {
        po: true,
        vendor: true,
        lines: true,
      },
      orderBy: { grnDate: 'desc' },
    });

    res.json({ grns });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /pending-pos — list POs with pending quantities
router.get('/pending-pos', async (req: Request, res: Response) => {
  try {
    const pos = await prisma.purchaseOrder.findMany({
      where: {
        status: {
          in: ['SENT', 'PARTIAL_RECEIVED', 'APPROVED'],
        },
      },
      include: {
        vendor: true,
        lines: {
          where: {
            pendingQty: {
              gt: 0,
            },
          },
        },
      },
    });

    const filtered = pos.filter(po => po.lines.length > 0);
    res.json({ pos: filtered });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /:id — single GRN with lines, po, vendor
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const grn = await prisma.goodsReceipt.findUnique({
      where: { id: req.params.id },
      include: {
        po: true,
        vendor: true,
        lines: true,
      },
    });
    if (!grn) return res.status(404).json({ error: 'GRN not found' });
    res.json(grn);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST / — create GRN against a PO
router.post('/', async (req: Request, res: Response) => {
  try {
    const b = req.body;

    // Get PO for validation
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: b.poId },
      include: { lines: true },
    });
    if (!po) return res.status(404).json({ error: 'PO not found' });

    // Process lines
    const processedLines = (b.lines || []).map((line: any) => {
      const acceptedQty = parseFloat(line.acceptedQty) || 0;
      const rate = parseFloat(line.rate) || 0;
      const amount = acceptedQty * rate;

      return {
        poLineId: line.poLineId || null,
        materialId: line.materialId || null,
        description: line.description || '',
        receivedQty: parseFloat(line.receivedQty) || 0,
        acceptedQty,
        rejectedQty: parseFloat(line.rejectedQty) || 0,
        unit: line.unit || 'kg',
        rate,
        amount,
        storageLocation: line.storageLocation || '',
        batchNo: line.batchNo || '',
        remarks: line.remarks || '',
      };
    });

    // Calculate totals
    const totalAmount = processedLines.reduce((sum: number, line: any) => sum + line.amount, 0);
    const totalQty = processedLines.reduce((sum: number, line: any) => sum + line.acceptedQty, 0);

    // Create GRN
    const grn = await prisma.goodsReceipt.create({
      data: {
        poId: b.poId,
        vendorId: b.vendorId,
        grnDate: b.grnDate ? new Date(b.grnDate) : new Date(),
        vehicleNo: b.vehicleNo || '',
        challanNo: b.challanNo || '',
        challanDate: b.challanDate ? new Date(b.challanDate) : null,
        ewayBill: b.ewayBill || '',
        remarks: b.remarks || '',
        totalAmount,
        totalQty,
        status: 'DRAFT',
        userId: (req as any).user.id,
        lines: {
          create: processedLines,
        },
      },
      include: { lines: true },
    });

    // Update PO lines and material stocks
    for (const line of processedLines) {
      if (line.poLineId) {
        const poLine = await prisma.pOLine.findUnique({
          where: { id: line.poLineId },
        });
        if (poLine) {
          const newReceivedQty = poLine.receivedQty + line.acceptedQty;
          const newPendingQty = poLine.quantity - newReceivedQty;

          await prisma.pOLine.update({
            where: { id: line.poLineId },
            data: {
              receivedQty: newReceivedQty,
              pendingQty: newPendingQty,
            },
          });
        }
      }

      // Update material stock
      if (line.materialId) {
        const material = await prisma.material.findUnique({
          where: { id: line.materialId },
        });
        if (material) {
          await prisma.material.update({
            where: { id: line.materialId },
            data: {
              currentStock: material.currentStock + line.acceptedQty,
            },
          });
        }
      }
    }

    // Check if all PO lines are fully received
    const updatedPoLines = await prisma.pOLine.findMany({
      where: { poId: b.poId },
    });
    const allFullyReceived = updatedPoLines.every((line: any) => line.pendingQty === 0);
    const anyPartialReceived = updatedPoLines.some((line: any) => line.receivedQty > 0 && line.pendingQty > 0);

    if (allFullyReceived) {
      await prisma.purchaseOrder.update({
        where: { id: b.poId },
        data: { status: 'RECEIVED' },
      });
    } else if (anyPartialReceived) {
      await prisma.purchaseOrder.update({
        where: { id: b.poId },
        data: { status: 'PARTIAL_RECEIVED' },
      });
    }

    // Sync to inventory (new SAP system)
    try {
      await syncGrnToInventory(
        grn.id,
        grn.grnNo,
        processedLines,
        b.warehouseId || null,
        (req as any).user.id
      );
    } catch (syncErr: any) {
      // Log but don't fail the GRN creation
      console.error('Inventory sync failed:', syncErr.message);
    }

    res.status(201).json(grn);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /:id/quality — update quality status
router.put('/:id/quality', async (req: Request, res: Response) => {
  try {
    const { qualityStatus, qualityRemarks, inspectedBy } = req.body;
    const grn = await prisma.goodsReceipt.update({
      where: { id: req.params.id },
      data: {
        qualityStatus,
        qualityRemarks,
        inspectedBy,
      },
      include: { lines: true },
    });
    res.json(grn);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /:id/status — status transitions
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const { newStatus } = req.body;
    const grn = await prisma.goodsReceipt.findUnique({
      where: { id: req.params.id },
    });
    if (!grn) return res.status(404).json({ error: 'GRN not found' });

    const validTransitions: Record<string, string[]> = {
      'DRAFT': ['CONFIRMED', 'CANCELLED'],
      'CONFIRMED': [],
      'CANCELLED': [],
    };

    if (!validTransitions[grn.status] || !validTransitions[grn.status].includes(newStatus)) {
      return res.status(400).json({ error: `Invalid status transition from ${grn.status} to ${newStatus}` });
    }

    const updated = await prisma.goodsReceipt.update({
      where: { id: req.params.id },
      data: { status: newStatus },
      include: { lines: true },
    });

    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /:id — delete GRN (DRAFT only), reverse stock and PO line updates
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const grn = await prisma.goodsReceipt.findUnique({
      where: { id: req.params.id },
      include: { lines: true },
    });
    if (!grn) return res.status(404).json({ error: 'GRN not found' });
    if (grn.status !== 'DRAFT') {
      return res.status(400).json({ error: 'Can only delete GRN in DRAFT status' });
    }

    // Reverse PO line and material stock updates
    for (const line of grn.lines) {
      if (line.poLineId) {
        const poLine = await prisma.pOLine.findUnique({ where: { id: line.poLineId } });
        if (poLine) {
          await prisma.pOLine.update({
            where: { id: line.poLineId },
            data: {
              receivedQty: Math.max(0, poLine.receivedQty - line.acceptedQty),
              pendingQty: poLine.quantity - Math.max(0, poLine.receivedQty - line.acceptedQty),
            },
          });
        }
      }
      if (line.materialId) {
        const mat = await prisma.material.findUnique({ where: { id: line.materialId } });
        if (mat) {
          await prisma.material.update({
            where: { id: line.materialId },
            data: { currentStock: Math.max(0, mat.currentStock - line.acceptedQty) },
          });
        }
      }
    }

    await prisma.goodsReceipt.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
