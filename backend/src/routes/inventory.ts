import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { searchHSN } from '../data/hsnDatabase';

const router = Router();
router.use(authenticate as any);

// ─── ITEM LOOKUP (Smart Search) ──────────────────

// GET /item-lookup?q=search_term — search HSN database for auto-fill
router.get('/item-lookup', async (req: Request, res: Response) => {
  try {
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
  } catch (err: unknown) {
    res.status(500).json({ error: 'Lookup failed' });
  }
});

// ─── ITEMS ───────────────────────────────────────

// GET /items — list all items (with optional category filter)
router.get('/items', async (req: Request, res: Response) => {
  try {
    const category = req.query.category as string | undefined;
    const where: any = {};
    if (category) where.category = category;
    const items = await prisma.inventoryItem.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { transactions: { orderBy: { createdAt: 'desc' }, take: 5 } },
    });
    res.json({ items });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /items/:id — single item with full history
router.get('/items/:id', async (req: Request, res: Response) => {
  try {
    const item = await prisma.inventoryItem.findUnique({
      where: { id: req.params.id },
      include: { transactions: { orderBy: { createdAt: 'desc' }, take: 50 } },
    });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /items — create new item
router.post('/items', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const item = await prisma.inventoryItem.create({
      data: {
        name: b.name,
        code: b.code,
        category: b.category || 'RAW_MATERIAL',
        unit: b.unit || 'kg',
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
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /items/:id — update item
router.put('/items/:id', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const item = await prisma.inventoryItem.update({
      where: { id: req.params.id },
      data: {
        name: b.name,
        code: b.code,
        category: b.category,
        unit: b.unit,
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
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /items/:id
router.delete('/items/:id', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  try {
    await prisma.inventoryItem.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── TRANSACTIONS (Stock In / Out / Adjust) ─────

// POST /transaction — record stock movement
router.post('/transaction', async (req: Request, res: Response) => {
  try {
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
          userId: (req as any).user.id,
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
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /alerts — items below min stock
router.get('/alerts', async (_req: Request, res: Response) => {
  try {
    const items = await prisma.inventoryItem.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    const lowStock = items.filter(i => i.currentStock <= i.minStock && i.minStock > 0);
    res.json({ alerts: lowStock });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /summary — category-wise totals
router.get('/summary', async (_req: Request, res: Response) => {
  try {
    const items = await prisma.inventoryItem.findMany({ where: { isActive: true } });
    const categories: Record<string, { count: number; totalValue: number; lowStock: number }> = {};
    for (const item of items) {
      if (!categories[item.category]) categories[item.category] = { count: 0, totalValue: 0, lowStock: 0 };
      categories[item.category].count++;
      categories[item.category].totalValue += item.currentStock * item.costPerUnit;
      if (item.currentStock <= item.minStock && item.minStock > 0) categories[item.category].lowStock++;
    }
    res.json({ summary: categories, totalItems: items.length });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
