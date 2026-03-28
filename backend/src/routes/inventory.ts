import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { searchHSN } from '../data/hsnDatabase';

const router = Router();
router.use(authenticate as any);

// ─── ITEM LOOKUP (Smart Search) ──────────────────

// GET /item-lookup?q=search_term — search HSN database for auto-fill
router.get('/item-lookup', asyncHandler(async (req: AuthRequest, res: Response) => {
  const q = (req.query.q as string) || '';
  if (q.length < 2) {
    res.json([]);
    return;
  }
  const results = searchHSN(q, 15);
  res.json(results.map(r => ({
    name: r.name,
    hsnCode: r.hsn,
    gstPercent: r.gst,
    category: r.category,
    unit: r.unit,
    score: r.score,
  })));
}));

// ─── ITEMS ───────────────────────────────────────

// GET /items — list all items (with optional category filter)
router.get('/items', asyncHandler(async (req: AuthRequest, res: Response) => {
  const category = req.query.category as string | undefined;
  const where: any = {};
  if (category) where.category = category;
  const items = await prisma.inventoryItem.findMany({
    where,
    take: 50,
    orderBy: { name: 'asc' },
    include: { transactions: { orderBy: { createdAt: 'desc' }, take: 5 } },
  });
  res.json({ items });
}));

// GET /items/:id — single item with full history
router.get('/items/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const item = await prisma.inventoryItem.findUnique({
    where: { id: req.params.id },
    include: { transactions: { orderBy: { createdAt: 'desc' }, take: 50 } },
  });
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json(item);
}));

// Helper: generate next item code (ITM-00001, ITM-00002, ...)
async function generateItemCode(): Promise<string> {
  const last = await prisma.inventoryItem.findFirst({
    where: { code: { startsWith: 'ITM-' } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });
  if (!last) return 'ITM-00001';
  const num = parseInt(last.code.replace('ITM-', ''), 10);
  return `ITM-${String(num + 1).padStart(5, '0')}`;
}

// POST /items — create new item
router.post('/items', authorize('ADMIN') as any, asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const code = await generateItemCode();
  const item = await prisma.inventoryItem.create({
    data: {
      name: b.name,
      code,
      category: b.category || 'RAW_MATERIAL',
      subCategory: b.subCategory || null,
      unit: b.unit || 'kg',
      hsnCode: b.hsnCode || null,
      gstPercent: b.gstPercent !== undefined ? parseFloat(b.gstPercent) : 18,
      defaultRate: b.defaultRate ? parseFloat(b.defaultRate) : 0,
      currentStock: parseFloat(b.currentStock) || 0,
      minStock: parseFloat(b.minStock) || 0,
      maxStock: b.maxStock ? parseFloat(b.maxStock) : null,
      costPerUnit: parseFloat(b.costPerUnit) || 0,
      location: b.location || null,
      supplier: b.supplier || null,
      leadTimeDays: b.leadTimeDays ? parseInt(b.leadTimeDays) : null,
      remarks: b.remarks || null,
    },
  });
  res.status(201).json(item);
}));

// PUT /items/:id — update item
router.put('/items/:id', authorize('ADMIN') as any, asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const item = await prisma.inventoryItem.update({
    where: { id: req.params.id },
    data: {
      name: b.name,
      category: b.category,
      subCategory: b.subCategory,
      unit: b.unit,
      hsnCode: b.hsnCode,
      gstPercent: b.gstPercent !== undefined ? parseFloat(b.gstPercent) : undefined,
      defaultRate: b.defaultRate !== undefined ? parseFloat(b.defaultRate) : undefined,
      minStock: b.minStock !== undefined ? parseFloat(b.minStock) : undefined,
      maxStock: b.maxStock !== undefined ? parseFloat(b.maxStock) : undefined,
      costPerUnit: b.costPerUnit !== undefined ? parseFloat(b.costPerUnit) : undefined,
      location: b.location,
      supplier: b.supplier,
      leadTimeDays: b.leadTimeDays !== undefined ? parseInt(b.leadTimeDays) : undefined,
      remarks: b.remarks,
      isActive: b.isActive,
    },
  });
  res.json(item);
}));

// DELETE /items/:id
router.delete('/items/:id', authorize('ADMIN') as any, asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.inventoryItem.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

// ─── TRANSACTIONS (Stock In / Out / Adjust) ─────

// POST /transaction — record stock movement
router.post('/transaction', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const qty = parseFloat(b.quantity) || 0;
  const type = b.type; // IN, OUT, ADJUST

  // Wrap in transaction to ensure atomicity
  const txn = await prisma.$transaction(async (tx: any) => {
    // Create transaction
    const transaction = await tx.inventoryTransaction.create({
      data: {
        itemId: b.itemId,
        type,
        quantity: qty,
        reference: b.reference || null,
        remarks: b.remarks || null,
        userId: req.user!.id,
      },
    });

    // Update current stock
    const item = await tx.inventoryItem.findUnique({ where: { id: b.itemId } });
    if (item) {
      let newStock = item.currentStock;
      if (type === 'IN') newStock += qty;
      else if (type === 'OUT') newStock -= qty;
      else if (type === 'ADJUST') newStock = qty; // absolute set
      await tx.inventoryItem.update({
        where: { id: b.itemId },
        data: { currentStock: Math.max(0, newStock) },
      });
    }

    return transaction;
  });

  res.status(201).json(txn);
}));

// GET /alerts — items below min stock
router.get('/alerts', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const items = await prisma.inventoryItem.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });
  const lowStock = items.filter(i => i.currentStock <= i.minStock && i.minStock > 0);
  res.json({ alerts: lowStock });
}));

// GET /summary — category-wise totals
router.get('/summary', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const items = await prisma.inventoryItem.findMany({ where: { isActive: true } });
  const categories: Record<string, { count: number; totalValue: number; lowStock: number }> = {};
  for (const item of items) {
    if (!categories[item.category]) categories[item.category] = { count: 0, totalValue: 0, lowStock: 0 };
    categories[item.category].count++;
    categories[item.category].totalValue += item.currentStock * item.costPerUnit;
    if (item.currentStock <= item.minStock && item.minStock > 0) categories[item.category].lowStock++;
  }
  res.json({ summary: categories, totalItems: items.length });
}));

export default router;
