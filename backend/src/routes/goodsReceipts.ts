import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { onStockMovement } from '../services/autoJournal';

const router = Router();
router.use(authenticate as any);

// ─── Helper: sync GRN lines to new inventory system ───
async function syncGrnToInventory(
  grnId: string,
  grnNo: number,
  lines: Array<{ inventoryItemId?: string | null; materialId?: string | null; acceptedQty: number; rate: number; unit: string; batchNo: string; storageLocation: string }>,
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
    // Use inventoryItemId directly (unified material master)
    const itemId = line.inventoryItemId || line.materialId;
    if (!itemId || line.acceptedQty <= 0) continue;

    const invItem = await prisma.inventoryItem.findUnique({
      where: { id: itemId },
      select: { id: true, name: true, unit: true, currentStock: true, avgCost: true },
    });
    if (!invItem) continue;

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
          narration: `GRN receipt for ${invItem.name}`,
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
        itemName: invItem.name,
        userId,
        date: movement.date,
      }).catch(() => {});
    });
  }
}

// GET / — list GRNs with filters (poId, vendorId, status)
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const poId = req.query.poId as string | undefined;
    const vendorId = req.query.vendorId as string | undefined;
    const status = req.query.status as string | undefined;

    const archived = req.query.archived === 'true';
    const where: any = { archived };
    if (poId) where.poId = poId;
    if (vendorId) where.vendorId = vendorId;
    if (status) where.status = status;

    const grns = await prisma.goodsReceipt.findMany({
      where,
      include: {
        po: { select: { id: true, poNo: true, status: true } },
        vendor: { select: { id: true, name: true, email: true } },
        lines: true,
      },
      orderBy: { grnDate: 'desc' },
      take: 200,
    });

    res.json({ grns });
}));

// GET /pending-pos — list POs with pending quantities
router.get('/pending-pos', asyncHandler(async (req: AuthRequest, res: Response) => {
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
      take: 200,
    });

    const filtered = pos.filter(po => po.lines.length > 0);
    res.json({ pos: filtered });
}));

// GET /:id — single GRN with lines, po, vendor
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
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
}));

// POST / — create GRN against a PO
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body;

    // Get PO for validation
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: b.poId },
      include: { lines: true },
    });
    if (!po) return res.status(404).json({ error: 'PO not found' });

    // Process lines
    const processedLines = (b.lines || []).map((line: any) => {
      const receivedQty = parseFloat(line.receivedQty) || 0;
      const acceptedQty = parseFloat(line.acceptedQty) || 0;
      const rejectedQty = receivedQty - acceptedQty; // auto-calculate
      const rate = parseFloat(line.rate) || 0;
      const amount = acceptedQty * rate;

      const itemId = line.inventoryItemId || line.materialId || null;
      return {
        poLineId: line.poLineId || null,
        inventoryItemId: itemId,
        materialId: null,
        description: line.description || '',
        receivedQty,
        acceptedQty,
        rejectedQty: Math.max(0, rejectedQty),
        unit: line.unit || 'kg',
        rate,
        amount,
        storageLocation: line.storageLocation || '',
        warehouseCode: line.warehouseCode || '',
        batchNo: line.batchNo || '',
        remarks: line.remarks || '',
      };
    });

    // Calculate totals
    const totalAmount = processedLines.reduce((sum: number, line: any) => sum + line.amount, 0);
    const totalQty = processedLines.reduce((sum: number, line: any) => sum + line.acceptedQty, 0);

    // Create GRN, update PO lines, and update PO status in a single transaction
    const { grn, poStatus } = await prisma.$transaction(async (tx) => {
      // Step 1: Create GRN with lines
      const grn = await tx.goodsReceipt.create({
        data: {
          poId: b.poId,
          vendorId: po.vendorId,
          grnDate: b.grnDate ? new Date(b.grnDate) : new Date(),
          vehicleNo: b.vehicleNo || '',
          challanNo: b.challanNo || b.invoiceNo || '',
          challanDate: b.challanDate ? new Date(b.challanDate) : (b.invoiceDate ? new Date(b.invoiceDate) : null),
          invoiceNo: b.invoiceNo || b.challanNo || '',
          invoiceDate: b.invoiceDate ? new Date(b.invoiceDate) : (b.challanDate ? new Date(b.challanDate) : null),
          ewayBill: b.ewayBill || '',
          remarks: b.remarks || '',
          totalAmount,
          totalQty,
          status: 'DRAFT',
          userId: req.user!.id,
          lines: {
            create: processedLines,
          },
        },
        include: { lines: true },
      });

      // Step 2: Update PO lines
      for (const line of processedLines) {
        if (line.poLineId) {
          const poLine = await tx.pOLine.findUnique({
            where: { id: line.poLineId },
          });
          if (poLine) {
            const newReceivedQty = poLine.receivedQty + line.acceptedQty;
            const newPendingQty = poLine.quantity - newReceivedQty;

            await tx.pOLine.update({
              where: { id: line.poLineId },
              data: {
                receivedQty: newReceivedQty,
                pendingQty: newPendingQty,
              },
            });
          }
        }
      }

      // Step 3: Check and update PO status
      let poStatus = 'unchanged';
      const updatedPoLines = await tx.pOLine.findMany({
        where: { poId: b.poId },
      });
      const allFullyReceived = updatedPoLines.every((line: any) => line.pendingQty === 0);
      const anyPartialReceived = updatedPoLines.some((line: any) => line.receivedQty > 0 && line.pendingQty > 0);

      if (allFullyReceived) {
        await tx.purchaseOrder.update({
          where: { id: b.poId },
          data: { status: 'RECEIVED' },
        });
        poStatus = 'RECEIVED';
      } else if (anyPartialReceived) {
        await tx.purchaseOrder.update({
          where: { id: b.poId },
          data: { status: 'PARTIAL_RECEIVED' },
        });
        poStatus = 'PARTIAL_RECEIVED';
      }

      return { grn, poStatus };
    });

    // Sync to inventory outside transaction (has its own error handling)
    try {
      await syncGrnToInventory(
        grn.id,
        grn.grnNo,
        processedLines,
        b.warehouseId || null,
        req.user!.id
      );
    } catch (_syncErr: unknown) {
      // Swallow — don't fail the GRN creation
    }

    res.status(201).json(grn);
}));

// PUT /:id/quality — update quality status
router.put('/:id/quality', asyncHandler(async (req: AuthRequest, res: Response) => {
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
}));

// PUT /:id/status — status transitions
router.put('/:id/status', asyncHandler(async (req: AuthRequest, res: Response) => {
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
}));

// DELETE /:id — delete GRN (DRAFT only), reverse stock and PO line updates
router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
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
      // Reverse InventoryItem stock if linked
      const itemId = line.inventoryItemId || line.materialId;
      if (itemId) {
        const invItem = await prisma.inventoryItem.findUnique({ where: { id: itemId }, select: { id: true, currentStock: true, avgCost: true } });
        if (invItem) {
          const newStock = Math.max(0, invItem.currentStock - line.acceptedQty);
          await prisma.inventoryItem.update({
            where: { id: itemId },
            data: { currentStock: newStock, totalValue: Math.round(newStock * invItem.avgCost * 100) / 100 },
          });
          // Reverse StockLevel
          const sl = await prisma.stockLevel.findFirst({ where: { itemId } });
          if (sl) await prisma.stockLevel.update({ where: { id: sl.id }, data: { quantity: Math.max(0, sl.quantity - line.acceptedQty) } });
          // Delete associated stock movements
          await prisma.stockMovement.deleteMany({ where: { refType: 'GRN', refId: grn.id, itemId } });
        }
      }
    }

    await prisma.goodsReceipt.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
}));

// PUT /:id/archive — archive a GRN
router.put('/:id/archive', asyncHandler(async (req: AuthRequest, res: Response) => {
    const archived = req.body.archived !== false;
    await prisma.goodsReceipt.update({ where: { id: req.params.id }, data: { archived } });
    res.json({ ok: true, archived });
}));

export default router;
