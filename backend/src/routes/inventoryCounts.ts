import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { NotFoundError, ValidationError } from '../shared/errors';
import { z } from 'zod';
import prisma from '../config/prisma';

const router = Router();
router.use(authenticate as any);

// ─── Schemas ────────────────────────────────────────

const createCountSchema = z.object({
  warehouseId: z.string().min(1),
  countType: z.enum(['FULL', 'CYCLE', 'SPOT']).default('FULL'),
  remarks: z.string().optional(),
});

const updateLinesSchema = z.object({
  lines: z.array(z.object({
    id: z.string().min(1),
    physicalQty: z.number().min(0),
    remarks: z.string().optional(),
  })),
});

// ─── GET / — list stock counts (paginated) ───

router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const take = Math.min(parseInt(req.query.limit as string) || 50, 500);
  const skip = parseInt(req.query.offset as string) || 0;
  const status = req.query.status as string | undefined;

  const where: Record<string, unknown> = {};
  if (status) where.status = status;

  const [counts, total] = await Promise.all([
    prisma.stockCount.findMany({
      where,
      take,
      skip,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        countNo: true,
        warehouseId: true,
        countDate: true,
        status: true,
        countType: true,
        remarks: true,
        userId: true,
        approvedBy: true,
        createdAt: true,
        _count: { select: { lines: true } },
      },
    }),
    prisma.stockCount.count({ where }),
  ]);

  res.json({ counts, total, take, skip });
}));

// ─── GET /:id — count detail with lines ───

router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const count = await prisma.stockCount.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      countNo: true,
      warehouseId: true,
      countDate: true,
      status: true,
      countType: true,
      remarks: true,
      userId: true,
      approvedBy: true,
      createdAt: true,
      updatedAt: true,
      lines: {
        select: {
          id: true,
          itemId: true,
          batchId: true,
          binId: true,
          systemQty: true,
          physicalQty: true,
          variance: true,
          variancePct: true,
          adjustmentDone: true,
          remarks: true,
        },
        orderBy: { itemId: 'asc' },
      },
    },
  });

  if (!count) throw new NotFoundError('StockCount', req.params.id);

  // Enrich lines with item names
  const itemIds = [...new Set(count.lines.map((l) => l.itemId))];
  const items = await prisma.inventoryItem.findMany({
    where: { id: { in: itemIds } },
    take: 500,
    select: { id: true, name: true, code: true, unit: true },
  });
  const itemMap = new Map(items.map((i) => [i.id, i]));

  const enrichedLines = count.lines.map((line) => ({
    ...line,
    item: itemMap.get(line.itemId) ?? null,
  }));

  res.json({ ...count, lines: enrichedLines });
}));

// ─── POST / — create stock count, auto-populate lines from StockLevel ───

router.post('/', validate(createCountSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { warehouseId, countType, remarks } = req.body;
  const userId = req.user!.id;

  // Verify warehouse
  const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) throw new NotFoundError('Warehouse', warehouseId);

  // Get current stock levels for this warehouse
  const stockLevels = await prisma.stockLevel.findMany({
    where: { warehouseId },
    take: 500,
    select: {
      itemId: true,
      batchId: true,
      binId: true,
      quantity: true,
    },
  });

  const count = await prisma.stockCount.create({
    data: {
      warehouseId,
      countDate: new Date(),
      countType,
      remarks,
      userId,
      status: 'DRAFT',
      lines: {
        create: stockLevels.map((sl) => ({
          itemId: sl.itemId,
          batchId: sl.batchId,
          binId: sl.binId,
          systemQty: sl.quantity,
        })),
      },
    },
    select: {
      id: true,
      countNo: true,
      warehouseId: true,
      countDate: true,
      status: true,
      countType: true,
      _count: { select: { lines: true } },
    },
  });

  res.status(201).json(count);
}));

// ─── PUT /:id/lines — bulk update physical qty for lines ───

router.put('/:id/lines', validate(updateLinesSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const count = await prisma.stockCount.findUnique({ where: { id: req.params.id } });
  if (!count) throw new NotFoundError('StockCount', req.params.id);

  if (count.status === 'APPROVED') {
    throw new ValidationError('Cannot modify approved count', {
      fieldErrors: {},
      formErrors: ['Count is already approved'],
    });
  }

  const { lines } = req.body as { lines: Array<{ id: string; physicalQty: number; remarks?: string }> };

  await prisma.$transaction(
    lines.map((line) => {
      const variance = line.physicalQty; // Will calc with systemQty below
      return prisma.stockCountLine.update({
        where: { id: line.id },
        data: {
          physicalQty: line.physicalQty,
          remarks: line.remarks,
        },
      });
    })
  );

  // Recalculate variance for all updated lines
  const updatedLines = await prisma.stockCountLine.findMany({
    where: { countId: req.params.id, physicalQty: { not: null } },
    take: 500,
    select: { id: true, systemQty: true, physicalQty: true },
  });

  await prisma.$transaction(
    updatedLines.map((line) => {
      const variance = (line.physicalQty ?? 0) - line.systemQty;
      const variancePct = line.systemQty !== 0
        ? Math.round((variance / line.systemQty) * 10000) / 100
        : line.physicalQty !== 0 ? 100 : 0;
      return prisma.stockCountLine.update({
        where: { id: line.id },
        data: { variance, variancePct },
      });
    })
  );

  // Update count status
  await prisma.stockCount.update({
    where: { id: req.params.id },
    data: { status: 'IN_PROGRESS' },
  });

  res.json({ message: 'Lines updated', count: updatedLines.length });
}));

// ─── POST /:id/approve — approve count and adjust stock ───

router.post('/:id/approve', asyncHandler(async (req: AuthRequest, res: Response) => {
  const count = await prisma.stockCount.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      status: true,
      warehouseId: true,
      lines: {
        select: {
          id: true,
          itemId: true,
          batchId: true,
          binId: true,
          systemQty: true,
          physicalQty: true,
          variance: true,
          adjustmentDone: true,
        },
      },
    },
  });

  if (!count) throw new NotFoundError('StockCount', req.params.id);

  if (count.status === 'APPROVED') {
    throw new ValidationError('Already approved', {
      fieldErrors: {},
      formErrors: ['This count is already approved'],
    });
  }

  const userId = req.user!.id;
  const warehouseId = count.warehouseId;

  // Lines with variance that need adjustment
  const linesToAdjust = count.lines.filter(
    (l) => l.physicalQty !== null && l.variance !== null && l.variance !== 0 && !l.adjustmentDone
  );

  await prisma.$transaction(async (tx) => {
    for (const line of linesToAdjust) {
      const variance = line.variance!;
      const physicalQty = line.physicalQty!;
      const direction = variance > 0 ? 'IN' : 'OUT';
      const absQty = Math.abs(variance);

      // Get item for cost info
      const item = await tx.inventoryItem.findUnique({
        where: { id: line.itemId },
        select: { avgCost: true, unit: true },
      });
      if (!item) continue;

      const totalValue = Math.round(absQty * item.avgCost * 100) / 100;

      // Create adjustment movement
      await tx.stockMovement.create({
        data: {
          itemId: line.itemId,
          movementType: 'ADJUSTMENT',
          direction,
          quantity: absQty,
          unit: item.unit,
          costRate: item.avgCost,
          totalValue,
          warehouseId,
          binId: line.binId,
          batchId: line.batchId,
          refType: 'STOCK_COUNT',
          refId: count.id,
          narration: `Stock count adjustment (variance: ${variance})`,
          userId,
        },
      });

      // Update StockLevel to physical qty
      const existingLevel = await tx.stockLevel.findFirst({
        where: {
          itemId: line.itemId,
          warehouseId,
          binId: line.binId ?? null,
          batchId: line.batchId ?? null,
        },
      });
      if (existingLevel) {
        await tx.stockLevel.update({
          where: { id: existingLevel.id },
          data: { quantity: physicalQty },
        });
      } else {
        await tx.stockLevel.create({
          data: {
            itemId: line.itemId,
            warehouseId,
            binId: line.binId,
            batchId: line.batchId,
            quantity: physicalQty,
          },
        });
      }

      // Mark line as adjusted
      await tx.stockCountLine.update({
        where: { id: line.id },
        data: { adjustmentDone: true },
      });
    }

    // Recalc InventoryItem.currentStock for all affected items
    const affectedItemIds = [...new Set(linesToAdjust.map((l) => l.itemId))];
    for (const itemId of affectedItemIds) {
      const agg = await tx.stockLevel.aggregate({
        where: { itemId },
        _sum: { quantity: true },
      });
      const newStock = agg._sum.quantity ?? 0;
      const itemData = await tx.inventoryItem.findUnique({
        where: { id: itemId },
        select: { avgCost: true },
      });
      await tx.inventoryItem.update({
        where: { id: itemId },
        data: {
          currentStock: newStock,
          totalValue: Math.round(newStock * (itemData?.avgCost ?? 0) * 100) / 100,
        },
      });
    }

    // Set count status to APPROVED
    await tx.stockCount.update({
      where: { id: count.id },
      data: {
        status: 'APPROVED',
        approvedBy: userId,
      },
    });
  });

  res.json({ message: 'Stock count approved', adjustments: linesToAdjust.length });
}));

export default router;
