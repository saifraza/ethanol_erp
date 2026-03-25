import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { NotFoundError } from '../shared/errors';
import prisma from '../config/prisma';

const router = Router();

// ─── GET /levels — stock levels grouped by item, with warehouse/batch breakdown ───

router.get('/levels', asyncHandler(async (req: AuthRequest, res: Response) => {
  const take = Math.min(parseInt(req.query.limit as string) || 50, 500);
  const skip = parseInt(req.query.offset as string) || 0;
  const category = req.query.category as string | undefined;
  const warehouseId = req.query.warehouseId as string | undefined;

  const itemWhere: Record<string, unknown> = { isActive: true };
  if (category) itemWhere.category = category;

  const items = await prisma.inventoryItem.findMany({
    where: itemWhere,
    take,
    skip,
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      code: true,
      category: true,
      unit: true,
      currentStock: true,
      avgCost: true,
      totalValue: true,
      minStock: true,
      stockLevels: {
        where: warehouseId ? { warehouseId, quantity: { gt: 0 } } : { quantity: { gt: 0 } },
        select: {
          id: true,
          quantity: true,
          reservedQty: true,
          warehouse: { select: { id: true, code: true, name: true } },
          bin: { select: { id: true, code: true } },
          batch: { select: { id: true, batchNo: true, expiryDate: true } },
        },
        orderBy: { quantity: 'desc' },
      },
    },
  });

  res.json(items);
}));

// ─── GET /levels/:itemId — single item stock across warehouses ───

router.get('/levels/:itemId', asyncHandler(async (req: AuthRequest, res: Response) => {
  const item = await prisma.inventoryItem.findUnique({
    where: { id: req.params.itemId },
    select: {
      id: true,
      name: true,
      code: true,
      category: true,
      unit: true,
      currentStock: true,
      avgCost: true,
      totalValue: true,
      minStock: true,
      maxStock: true,
      batchTracked: true,
    },
  });

  if (!item) throw new NotFoundError('InventoryItem', req.params.itemId);

  const stockLevels = await prisma.stockLevel.findMany({
    where: { itemId: req.params.itemId },
    take: 100,
    select: {
      id: true,
      quantity: true,
      reservedQty: true,
      warehouse: { select: { id: true, code: true, name: true } },
      bin: { select: { id: true, code: true, name: true } },
      batch: { select: { id: true, batchNo: true, expiryDate: true, status: true } },
      updatedAt: true,
    },
    orderBy: { quantity: 'desc' },
  });

  res.json({ ...item, stockLevels });
}));

// ─── GET /valuation — stock valuation report ───

router.get('/valuation', asyncHandler(async (req: AuthRequest, res: Response) => {
  const category = req.query.category as string | undefined;
  const where: Record<string, unknown> = { isActive: true, currentStock: { gt: 0 } };
  if (category) where.category = category;

  const items = await prisma.inventoryItem.findMany({
    where,
    take: 500,
    orderBy: { totalValue: 'desc' },
    select: {
      id: true,
      name: true,
      code: true,
      category: true,
      unit: true,
      currentStock: true,
      avgCost: true,
      totalValue: true,
      hsnCode: true,
    },
  });

  // Group by category
  const byCategory: Record<string, { items: typeof items; totalValue: number; itemCount: number }> = {};
  let grandTotal = 0;

  for (const item of items) {
    const cat = item.category;
    if (!byCategory[cat]) {
      byCategory[cat] = { items: [], totalValue: 0, itemCount: 0 };
    }
    byCategory[cat].items.push(item);
    byCategory[cat].totalValue += item.totalValue;
    byCategory[cat].itemCount += 1;
    grandTotal += item.totalValue;
  }

  res.json({
    byCategory,
    grandTotal: Math.round(grandTotal * 100) / 100,
    totalItems: items.length,
  });
}));

// ─── GET /aging — batch aging report ───

router.get('/aging', asyncHandler(async (req: AuthRequest, res: Response) => {
  const now = new Date();

  const batches = await prisma.batch.findMany({
    where: {
      status: 'AVAILABLE',
      expiryDate: { not: null },
    },
    take: 200,
    orderBy: { expiryDate: 'asc' },
    select: {
      id: true,
      batchNo: true,
      mfgDate: true,
      expiryDate: true,
      costRate: true,
      status: true,
      supplier: true,
      item: { select: { id: true, name: true, code: true, unit: true } },
      stockLevels: {
        where: { quantity: { gt: 0 } },
        select: {
          quantity: true,
          warehouse: { select: { code: true, name: true } },
        },
      },
    },
  });

  const report = batches.map((b) => {
    const expiryDate = b.expiryDate!;
    const daysToExpiry = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const totalQty = b.stockLevels.reduce((s, sl) => s + sl.quantity, 0);
    return {
      ...b,
      daysToExpiry,
      totalQty,
      isExpired: daysToExpiry < 0,
      isNearExpiry: daysToExpiry >= 0 && daysToExpiry <= 30,
    };
  });

  // Sort by urgency (expired first, then nearest expiry)
  report.sort((a, b) => a.daysToExpiry - b.daysToExpiry);

  res.json({
    batches: report,
    summary: {
      expired: report.filter((r) => r.isExpired).length,
      nearExpiry: report.filter((r) => r.isNearExpiry).length,
      healthy: report.filter((r) => !r.isExpired && !r.isNearExpiry).length,
    },
  });
}));

// ─── GET /abc-analysis — ABC classification ───

router.get('/abc-analysis', asyncHandler(async (req: AuthRequest, res: Response) => {
  const items = await prisma.inventoryItem.findMany({
    where: { isActive: true, currentStock: { gt: 0 } },
    take: 500,
    orderBy: { totalValue: 'desc' },
    select: {
      id: true,
      name: true,
      code: true,
      category: true,
      unit: true,
      currentStock: true,
      avgCost: true,
      totalValue: true,
    },
  });

  const grandTotal = items.reduce((s, i) => s + i.totalValue, 0);
  if (grandTotal === 0) {
    res.json({ items: [], summary: { A: 0, B: 0, C: 0 }, grandTotal: 0 });
    return;
  }

  let cumulative = 0;
  const classified = items.map((item) => {
    cumulative += item.totalValue;
    const cumulativePct = (cumulative / grandTotal) * 100;
    let classification: string;
    if (cumulativePct <= 80) {
      classification = 'A';
    } else if (cumulativePct <= 95) {
      classification = 'B';
    } else {
      classification = 'C';
    }
    return {
      ...item,
      valuePct: Math.round((item.totalValue / grandTotal) * 10000) / 100,
      cumulativePct: Math.round(cumulativePct * 100) / 100,
      classification,
    };
  });

  const summary = {
    A: classified.filter((i) => i.classification === 'A').length,
    B: classified.filter((i) => i.classification === 'B').length,
    C: classified.filter((i) => i.classification === 'C').length,
  };

  res.json({ items: classified, summary, grandTotal: Math.round(grandTotal * 100) / 100 });
}));

export default router;
