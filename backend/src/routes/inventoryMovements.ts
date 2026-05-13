import { Router, Response } from 'express';
import { authenticate, AuthRequest, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { NotFoundError, ValidationError } from '../shared/errors';
import { z } from 'zod';
import prisma from '../config/prisma';
import { onStockMovement } from '../services/autoJournal';

const router = Router();
router.use(authenticate);

// Type for Prisma transaction client (same query API as PrismaClient)
type TxClient = { stockLevel: typeof prisma.stockLevel; stockMovement: typeof prisma.stockMovement; inventoryItem: typeof prisma.inventoryItem; batch: typeof prisma.batch };

// Helper: find-or-create StockLevel (nullable compound unique requires findFirst approach)
async function upsertStockLevel(
  tx: TxClient,
  itemId: string,
  warehouseId: string,
  binId: string | null | undefined,
  batchId: string | null | undefined,
  qtyChange: number,
  absolute?: number
): Promise<void> {
  const where = { itemId, warehouseId, binId: binId ?? null, batchId: batchId ?? null };
  const existing = await tx.stockLevel.findFirst({ where });

  if (existing) {
    await tx.stockLevel.update({
      where: { id: existing.id },
      data: { quantity: absolute !== undefined ? absolute : { increment: qtyChange } },
    });
  } else {
    await tx.stockLevel.create({
      data: { ...where, quantity: absolute !== undefined ? absolute : qtyChange },
    });
  }
}

async function findStockLevel(
  tx: TxClient,
  itemId: string,
  warehouseId: string,
  binId: string | null | undefined,
  batchId: string | null | undefined,
) {
  return tx.stockLevel.findFirst({
    where: { itemId, warehouseId, binId: binId ?? null, batchId: batchId ?? null },
  });
}

// ─── Schemas ────────────────────────────────────────

const receiptSchema = z.object({
  itemId: z.string().min(1),
  warehouseId: z.string().min(1),
  binId: z.string().optional(),
  quantity: z.number().positive(),
  costRate: z.number().min(0),
  movementType: z.string().default('GRN_RECEIPT'),
  batchNo: z.string().optional(),
  mfgDate: z.string().optional(),
  expiryDate: z.string().optional(),
  supplier: z.string().optional(),
  grnId: z.string().optional(),
  refType: z.string().optional(),
  refId: z.string().optional(),
  refNo: z.string().optional(),
  narration: z.string().optional(),
});

const issueSchema = z.object({
  itemId: z.string().min(1),
  warehouseId: z.string().min(1),
  binId: z.string().optional(),
  batchId: z.string().optional(),
  quantity: z.number().positive(),
  movementType: z.string().default('PRODUCTION_ISSUE'),
  refType: z.string().optional(),
  refId: z.string().optional(),
  refNo: z.string().optional(),
  narration: z.string().optional(),
});

const transferSchema = z.object({
  itemId: z.string().min(1),
  fromWarehouseId: z.string().min(1),
  fromBinId: z.string().optional(),
  toWarehouseId: z.string().min(1),
  toBinId: z.string().optional(),
  batchId: z.string().optional(),
  quantity: z.number().positive(),
  narration: z.string().optional(),
});

const adjustSchema = z.object({
  itemId: z.string().min(1),
  warehouseId: z.string().min(1),
  binId: z.string().optional(),
  batchId: z.string().optional(),
  newQty: z.number().min(0),
  reason: z.string().min(1),
});

// ─── GET / — paginated movement history with filters ───

router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const take = Math.min(parseInt(req.query.limit as string) || 50, 500);
  const skip = parseInt(req.query.offset as string) || 0;

  const where: Record<string, unknown> = { ...getCompanyFilter(req) };
  if (req.query.itemId) where.itemId = req.query.itemId as string;
  if (req.query.warehouseId) where.warehouseId = req.query.warehouseId as string;
  if (req.query.movementType) where.movementType = req.query.movementType as string;
  if (req.query.direction) where.direction = req.query.direction as string;

  // Bucket-style filter from the UI tabs (RECEIPT / ISSUE / TRANSFER / ADJUSTMENT).
  // RECEIPT/ISSUE map to direction since movementType values include GRN_RECEIPT,
  // PRODUCTION_ISSUE, SALES_ISSUE etc.
  const bucket = req.query.bucket as string | undefined;
  if (bucket === 'RECEIPT') where.direction = 'IN';
  else if (bucket === 'ISSUE') where.direction = 'OUT';
  else if (bucket === 'TRANSFER') where.movementType = 'TRANSFER';
  else if (bucket === 'ADJUSTMENT') where.movementType = 'ADJUSTMENT';

  // Filter by linked item.category (e.g., ?category=CHEMICAL on the chemicals page).
  const category = req.query.category as string | undefined;
  if (category) where.item = { category };

  const search = (req.query.search as string | undefined)?.trim();
  if (search) {
    where.item = {
      ...(typeof where.item === 'object' && where.item ? (where.item as Record<string, unknown>) : {}),
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
      ],
    };
  }

  // Accept both ?from/?to and ?dateFrom/?dateTo for date range (UI sends the latter).
  const from = (req.query.from || req.query.dateFrom) as string | undefined;
  const to = (req.query.to || req.query.dateTo) as string | undefined;
  if (from || to) {
    where.date = {};
    if (from) (where.date as Record<string, unknown>).gte = new Date(from);
    if (to) (where.date as Record<string, unknown>).lte = new Date(to);
  }

  const [movements, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where,
      take,
      skip,
      orderBy: { date: 'desc' },
      select: {
        id: true,
        movementNo: true,
        movementType: true,
        direction: true,
        quantity: true,
        unit: true,
        costRate: true,
        totalValue: true,
        warehouseId: true,
        toWarehouseId: true,
        refType: true,
        refNo: true,
        narration: true,
        date: true,
        item: { select: { id: true, name: true, code: true, unit: true, category: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        batch: { select: { id: true, batchNo: true } },
      },
    }),
    prisma.stockMovement.count({ where }),
  ]);

  res.json({ movements, total, take, skip });
}));

// ─── GET /ledger/:itemId — stock ledger for an item ───

router.get('/ledger/:itemId', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { itemId } = req.params;
  const item = await prisma.inventoryItem.findUnique({
    where: { id: itemId },
    select: { id: true, name: true, code: true, unit: true, currentStock: true, avgCost: true },
  });
  if (!item) throw new NotFoundError('InventoryItem', itemId);

  const where: Record<string, unknown> = { itemId };
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  if (from || to) {
    where.date = {};
    if (from) (where.date as Record<string, unknown>).gte = new Date(from);
    if (to) (where.date as Record<string, unknown>).lte = new Date(to);
  }

  const movements = await prisma.stockMovement.findMany({
    where,
    take: Math.min(parseInt(req.query.limit as string) || 200, 500),
    orderBy: { date: 'asc' },
    select: {
      id: true,
      movementNo: true,
      movementType: true,
      direction: true,
      quantity: true,
      costRate: true,
      totalValue: true,
      refType: true,
      refNo: true,
      narration: true,
      date: true,
      warehouse: { select: { code: true, name: true } },
      batch: { select: { batchNo: true } },
    },
  });

  // Build running balance
  let runningQty = 0;
  let runningValue = 0;
  const ledger = movements.map((m) => {
    if (m.direction === 'IN') {
      runningQty += m.quantity;
      runningValue += m.totalValue;
    } else {
      runningQty -= m.quantity;
      runningValue -= m.totalValue;
    }
    return {
      ...m,
      runningQty: Math.round(runningQty * 1000) / 1000,
      runningValue: Math.round(runningValue * 100) / 100,
    };
  });

  res.json({ item, ledger });
}));

// ─── POST /receipt — goods receipt ───

router.post('/receipt', validate(receiptSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const {
    itemId, warehouseId, binId, quantity, costRate, movementType,
    batchNo, mfgDate, expiryDate, supplier, grnId,
    refType, refId, refNo, narration,
  } = req.body;
  const userId = req.user!.id;

  const item = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
  if (!item) throw new NotFoundError('InventoryItem', itemId);

  const totalValue = Math.round(quantity * costRate * 100) / 100;

  const result = await prisma.$transaction(async (tx) => {
    // 1. Create batch if batchNo provided
    let batchId: string | undefined;
    if (batchNo) {
      const batch = await tx.batch.upsert({
        where: { itemId_batchNo: { itemId, batchNo } },
        create: {
          itemId,
          batchNo,
          mfgDate: mfgDate ? new Date(mfgDate) : undefined,
          expiryDate: expiryDate ? new Date(expiryDate) : undefined,
          supplier,
          grnId,
          costRate,
        },
        update: {},
      });
      batchId = batch.id;
    }

    // 2. Create StockMovement
    const movement = await tx.stockMovement.create({
      data: {
        itemId,
        movementType,
        direction: 'IN',
        quantity,
        unit: item.unit,
        costRate,
        totalValue,
        warehouseId,
        binId,
        batchId,
        refType,
        refId,
        refNo,
        narration,
        userId,
      },
    });

    // 3. Upsert StockLevel
    await upsertStockLevel(tx, itemId, warehouseId, binId, batchId, quantity);

    // 4. Update InventoryItem — weighted average cost
    const existingQty = item.currentStock;
    const existingAvgCost = item.avgCost;
    const newTotalQty = existingQty + quantity;
    const newAvgCost = newTotalQty > 0
      ? (existingQty * existingAvgCost + quantity * costRate) / newTotalQty
      : costRate;

    await tx.inventoryItem.update({
      where: { id: itemId },
      data: {
        currentStock: { increment: quantity },
        avgCost: Math.round(newAvgCost * 100) / 100,
        totalValue: Math.round(newTotalQty * newAvgCost * 100) / 100,
      },
    });

    return movement;
  });

  // Fire-and-forget auto journal
  onStockMovement(prisma as Parameters<typeof onStockMovement>[0], {
    id: result.id,
    movementNo: result.movementNo,
    movementType: result.movementType,
    direction: result.direction,
    totalValue: result.totalValue,
    itemName: item.name,
    userId,
    date: result.date,
  }).catch(() => {});

  res.status(201).json(result);
}));

// ─── POST /issue — goods issue ───

router.post('/issue', validate(issueSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const {
    itemId, warehouseId, binId, batchId, quantity, movementType,
    refType, refId, refNo, narration,
  } = req.body;
  const userId = req.user!.id;

  const item = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
  if (!item) throw new NotFoundError('InventoryItem', itemId);

  if (item.currentStock < quantity) {
    throw new ValidationError('Insufficient stock', {
      fieldErrors: {},
      formErrors: [`Available: ${item.currentStock} ${item.unit}, Requested: ${quantity}`],
    });
  }

  const costRate = item.avgCost;
  const totalValue = Math.round(quantity * costRate * 100) / 100;

  const result = await prisma.$transaction(async (tx) => {
    // 1. Create StockMovement
    const movement = await tx.stockMovement.create({
      data: {
        itemId,
        movementType,
        direction: 'OUT',
        quantity,
        unit: item.unit,
        costRate,
        totalValue,
        warehouseId,
        binId,
        batchId,
        refType,
        refId,
        refNo,
        narration,
        userId,
      },
    });

    // 2. Reduce StockLevel
    const stockLevel = await findStockLevel(tx, itemId, warehouseId, binId, batchId);

    if (!stockLevel || stockLevel.quantity < quantity) {
      throw new ValidationError('Insufficient stock at this location', {
        fieldErrors: {},
        formErrors: [`Available at location: ${stockLevel?.quantity ?? 0}`],
      });
    }

    await tx.stockLevel.update({
      where: { id: stockLevel.id },
      data: { quantity: { decrement: quantity } },
    });

    // 3. Reduce InventoryItem.currentStock
    const newStock = item.currentStock - quantity;
    await tx.inventoryItem.update({
      where: { id: itemId },
      data: {
        currentStock: { decrement: quantity },
        totalValue: Math.round(newStock * item.avgCost * 100) / 100,
      },
    });

    return movement;
  });

  // Fire-and-forget auto journal
  onStockMovement(prisma as Parameters<typeof onStockMovement>[0], {
    id: result.id,
    movementNo: result.movementNo,
    movementType: result.movementType,
    direction: result.direction,
    totalValue: result.totalValue,
    itemName: item.name,
    userId,
    date: result.date,
  }).catch(() => {});

  res.status(201).json(result);
}));

// ─── POST /transfer — transfer between warehouses ───

router.post('/transfer', validate(transferSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const {
    itemId, fromWarehouseId, fromBinId, toWarehouseId, toBinId,
    batchId, quantity, narration,
  } = req.body;
  const userId = req.user!.id;

  const item = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
  if (!item) throw new NotFoundError('InventoryItem', itemId);

  const costRate = item.avgCost;
  const totalValue = Math.round(quantity * costRate * 100) / 100;

  const result = await prisma.$transaction(async (tx) => {
    // 1. Check source stock level
    const sourceLevel = await findStockLevel(tx, itemId, fromWarehouseId, fromBinId, batchId);

    if (!sourceLevel || sourceLevel.quantity < quantity) {
      throw new ValidationError('Insufficient stock at source', {
        fieldErrors: {},
        formErrors: [`Available at source: ${sourceLevel?.quantity ?? 0}`],
      });
    }

    // 2. OUT movement from source
    const outMovement = await tx.stockMovement.create({
      data: {
        itemId,
        movementType: 'TRANSFER',
        direction: 'OUT',
        quantity,
        unit: item.unit,
        costRate,
        totalValue,
        warehouseId: fromWarehouseId,
        binId: fromBinId,
        batchId,
        toWarehouseId,
        toBinId,
        narration: narration ?? `Transfer to ${toWarehouseId}`,
        userId,
      },
    });

    // 3. IN movement to destination
    const inMovement = await tx.stockMovement.create({
      data: {
        itemId,
        movementType: 'TRANSFER',
        direction: 'IN',
        quantity,
        unit: item.unit,
        costRate,
        totalValue,
        warehouseId: toWarehouseId,
        binId: toBinId,
        batchId,
        narration: narration ?? `Transfer from ${fromWarehouseId}`,
        userId,
      },
    });

    // 4. Decrement source StockLevel
    await tx.stockLevel.update({
      where: { id: sourceLevel.id },
      data: { quantity: { decrement: quantity } },
    });

    // 5. Upsert destination StockLevel
    await upsertStockLevel(tx, itemId, toWarehouseId, toBinId, batchId, quantity);

    return { outMovement, inMovement };
  });

  res.status(201).json(result);
}));

// ─── POST /adjust — stock adjustment ───

router.post('/adjust', validate(adjustSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { itemId, warehouseId, binId, batchId, newQty, reason } = req.body;
  const userId = req.user!.id;

  const item = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
  if (!item) throw new NotFoundError('InventoryItem', itemId);

  const result = await prisma.$transaction(async (tx) => {
    const currentLevel = await findStockLevel(tx, itemId, warehouseId, binId, batchId);

    const currentQty = currentLevel?.quantity ?? 0;
    const diff = newQty - currentQty;
    if (diff === 0) return null;

    const direction = diff > 0 ? 'IN' : 'OUT';
    const absQty = Math.abs(diff);
    const totalValue = Math.round(absQty * item.avgCost * 100) / 100;

    // 1. Create adjustment movement
    const movement = await tx.stockMovement.create({
      data: {
        itemId,
        movementType: 'ADJUSTMENT',
        direction,
        quantity: absQty,
        unit: item.unit,
        costRate: item.avgCost,
        totalValue,
        warehouseId,
        binId,
        batchId,
        refType: 'MANUAL',
        narration: reason,
        userId,
      },
    });

    // 2. Set StockLevel to new quantity
    await upsertStockLevel(tx, itemId, warehouseId, binId, batchId, 0, newQty);

    // 3. Recalc InventoryItem.currentStock from all StockLevels
    const allLevels = await tx.stockLevel.aggregate({
      where: { itemId },
      _sum: { quantity: true },
    });
    const newTotalStock = allLevels._sum.quantity ?? 0;

    await tx.inventoryItem.update({
      where: { id: itemId },
      data: {
        currentStock: newTotalStock,
        totalValue: Math.round(newTotalStock * item.avgCost * 100) / 100,
      },
    });

    return movement;
  });

  res.status(201).json(result ?? { message: 'No adjustment needed' });
}));

export default router;
