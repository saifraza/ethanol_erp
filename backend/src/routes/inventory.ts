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
    take: 500,
    orderBy: { name: 'asc' },
    include: { transactions: { orderBy: { createdAt: 'desc' }, take: 5 } },
  });
  res.json({ items });
}));

// GET /items/po-status — PO status for all items (must be BEFORE /:id)
router.get('/items/po-status', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const poLines = await prisma.pOLine.findMany({
    where: {
      inventoryItemId: { not: null },
      po: { status: { in: ['DRAFT', 'APPROVED', 'SENT', 'PARTIAL_RECEIVED'] } },
    },
    take: 500,
    select: {
      inventoryItemId: true,
      po: { select: { status: true, poNo: true } },
    },
  });
  const statusMap: Record<string, { status: string; poNo: number }> = {};
  for (const line of poLines) {
    if (!line.inventoryItemId) continue;
    const existing = statusMap[line.inventoryItemId];
    const poStatus = line.po.status;
    if (!existing || poStatus === 'SENT' || (poStatus === 'APPROVED' && existing.status === 'DRAFT')) {
      statusMap[line.inventoryItemId] = { status: poStatus, poNo: line.po.poNo };
    }
  }
  res.json(statusMap);
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

// GET /items/:id/details — full item with PO history + transactions
router.get('/items/:id/details', asyncHandler(async (req: AuthRequest, res: Response) => {
  const item = await prisma.inventoryItem.findUnique({ where: { id: req.params.id } });
  if (!item) return res.status(404).json({ error: 'Item not found' });

  // PO history — all PO lines that reference this item
  const poLines = await prisma.pOLine.findMany({
    where: { inventoryItemId: req.params.id },
    take: 20,
    orderBy: { po: { poDate: 'desc' } },
    select: {
      id: true, quantity: true, rate: true, unit: true, receivedQty: true, pendingQty: true, lineTotal: true,
      po: {
        select: {
          id: true, poNo: true, poDate: true, status: true, grandTotal: true,
          vendor: { select: { id: true, name: true } },
        },
      },
    },
  });

  // Recent transactions
  const transactions = await prisma.inventoryTransaction.findMany({
    where: { itemId: req.params.id },
    take: 30,
    orderBy: { createdAt: 'desc' },
    select: { id: true, type: true, quantity: true, reference: true, remarks: true, department: true, warehouse: true, issuedTo: true, createdAt: true },
  });

  // Rate history (unique rates from PO lines, most recent first)
  const rateHistory = poLines
    .filter(p => p.rate > 0)
    .map(p => ({ rate: p.rate, date: p.po.poDate, vendor: p.po.vendor.name, poNo: p.po.poNo }))
    .slice(0, 10);

  res.json({ item, poHistory: poLines, transactions, rateHistory });
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
      currentStock: b.currentStock !== undefined ? parseFloat(b.currentStock) : undefined,
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

// POST /transaction — record stock movement + auto-draft PO if low stock
router.post('/transaction', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const qty = parseFloat(b.quantity) || 0;
  const type = b.type; // IN, OUT, ADJUST

  // Wrap in transaction to ensure atomicity
  const result = await prisma.$transaction(async (tx: any) => {
    // Create transaction with warehouse/department
    const transaction = await tx.inventoryTransaction.create({
      data: {
        itemId: b.itemId,
        type,
        quantity: qty,
        reference: b.reference || null,
        remarks: b.remarks || null,
        warehouse: b.warehouse || null,
        department: b.department || null,
        issuedTo: b.issuedTo || null,
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

      return { transaction, item, newStock: Math.max(0, newStock) };
    }

    return { transaction, item: null, newStock: 0 };
  });

  // Auto-draft PO if stock fell below minimum
  let autoPO = null;
  if (result.item && result.newStock <= result.item.minStock && result.item.minStock > 0 && type === 'OUT') {
    try {
      // Find last PO for this item to get supplier and rate
      const lastPOLine = await prisma.pOLine.findFirst({
        where: { inventoryItemId: b.itemId },
        orderBy: { po: { poDate: 'desc' } },
        select: {
          rate: true, quantity: true, unit: true, hsnCode: true, gstPercent: true,
          po: { select: { vendorId: true, vendor: { select: { name: true } } } },
        },
      });

      if (lastPOLine?.po?.vendorId) {
        // Calculate reorder qty: max stock - current stock, or last PO qty
        const reorderQty = result.item.maxStock
          ? result.item.maxStock - result.newStock
          : lastPOLine.quantity;
        const rate = lastPOLine.rate;
        const amount = reorderQty * rate;
        const gstPct = lastPOLine.gstPercent || result.item.gstPercent || 18;
        const isIntraState = true; // default
        const taxableAmount = amount;
        const cgst = isIntraState ? taxableAmount * gstPct / 200 : 0;
        const sgst = cgst;
        const igst = isIntraState ? 0 : taxableAmount * gstPct / 100;
        const totalGst = cgst + sgst + igst;

        const po = await prisma.purchaseOrder.create({
          data: {
            vendorId: lastPOLine.po.vendorId,
            poDate: new Date(),
            deliveryDate: new Date(Date.now() + (result.item.leadTimeDays || 7) * 86400000),
            status: 'DRAFT',
            supplyType: 'INTRA_STATE',
            subtotal: amount,
            totalCgst: cgst,
            totalSgst: sgst,
            totalIgst: igst,
            totalGst: totalGst,
            grandTotal: amount + totalGst,
            remarks: `Auto-drafted: ${result.item.name} below min stock (${result.newStock}/${result.item.minStock} ${result.item.unit})`,
            userId: req.user!.id,
            lines: {
              create: {
                lineNo: 1,
                inventoryItemId: b.itemId,
                description: result.item.name,
                hsnCode: lastPOLine.hsnCode || result.item.hsnCode || '',
                quantity: reorderQty,
                unit: result.item.unit,
                rate: rate,
                amount: amount,
                gstPercent: gstPct,
                taxableAmount: taxableAmount,
                cgstPercent: isIntraState ? gstPct / 2 : 0,
                cgstAmount: cgst,
                sgstPercent: isIntraState ? gstPct / 2 : 0,
                sgstAmount: sgst,
                igstPercent: isIntraState ? 0 : gstPct,
                igstAmount: igst,
                totalGst: totalGst,
                lineTotal: amount + totalGst,
                receivedQty: 0,
                pendingQty: reorderQty,
              },
            },
          },
        });
        autoPO = { poId: po.id, poNo: po.poNo, vendor: lastPOLine.po.vendor.name, qty: reorderQty, rate };
        console.log(`[Inventory] Auto-drafted PO-${po.poNo} for ${result.item.name} (${result.newStock} < ${result.item.minStock})`);
      }
    } catch (err) {
      console.error('[Inventory] Auto-draft PO failed:', (err as Error).message);
    }
  }

  res.status(201).json({ ...result.transaction, autoPO });
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

// ─── ITEM-VENDOR LINKS (Multi-supplier) ─────────

// GET /items/:id/vendors — vendors linked to this item
router.get('/items/:id/vendors', asyncHandler(async (req: AuthRequest, res: Response) => {
  const vendors = await prisma.vendorItem.findMany({
    where: { inventoryItemId: req.params.id, isActive: true },
    select: {
      id: true, rate: true, minOrderQty: true, leadTimeDays: true, isPreferred: true, remarks: true,
      vendor: { select: { id: true, name: true, gstin: true, category: true } },
    },
    orderBy: [{ isPreferred: 'desc' }, { rate: 'asc' }],
    take: 20,
  });
  res.json(vendors);
}));

// POST /items/:id/vendors — link a vendor to this item
router.post('/items/:id/vendors', authorize('ADMIN') as any, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { vendorId, rate, minOrderQty, leadTimeDays, isPreferred, remarks } = req.body;
  if (!vendorId) { res.status(400).json({ error: 'vendorId required' }); return; }

  // If marking as preferred, unmark others first
  if (isPreferred) {
    await prisma.vendorItem.updateMany({
      where: { inventoryItemId: req.params.id, isPreferred: true },
      data: { isPreferred: false },
    });
  }

  const link = await prisma.vendorItem.upsert({
    where: { vendorId_inventoryItemId: { vendorId, inventoryItemId: req.params.id } },
    create: {
      vendorId,
      inventoryItemId: req.params.id,
      rate: parseFloat(rate) || 0,
      minOrderQty: minOrderQty ? parseFloat(minOrderQty) : null,
      leadTimeDays: leadTimeDays ? parseInt(leadTimeDays) : null,
      isPreferred: isPreferred || false,
      remarks: remarks || null,
    },
    update: {
      rate: parseFloat(rate) || 0,
      minOrderQty: minOrderQty ? parseFloat(minOrderQty) : null,
      leadTimeDays: leadTimeDays ? parseInt(leadTimeDays) : null,
      isPreferred: isPreferred || false,
      remarks: remarks || null,
      isActive: true,
    },
    include: { vendor: { select: { id: true, name: true, gstin: true } } },
  });

  // Update the supplier display name on the item to the preferred vendor
  if (isPreferred) {
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { name: true } });
    if (vendor) {
      await prisma.inventoryItem.update({ where: { id: req.params.id }, data: { supplier: vendor.name } });
    }
  }

  res.json(link);
}));

// DELETE /items/:id/vendors/:vendorId — unlink vendor
router.delete('/items/:id/vendors/:vendorId', authorize('ADMIN') as any, asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.vendorItem.updateMany({
    where: { inventoryItemId: req.params.id, vendorId: req.params.vendorId },
    data: { isActive: false },
  });
  res.json({ ok: true });
}));

// POST /vendors/quick — quick-add a new vendor (minimal fields)
router.post('/vendors/quick', authorize('ADMIN') as any, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { name, gstin } = req.body;
  if (!name) { res.status(400).json({ error: 'name required' }); return; }
  const vendor = await prisma.vendor.create({
    data: { name, gstin: gstin || null, category: 'GENERAL', isActive: true },
  });
  res.json(vendor);
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
