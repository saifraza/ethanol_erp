import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate as any);

// ─── Helper: generate next item code ───
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

// ─── Helper: normalize unit from old Material format ───
function normalizeUnit(unit: string): string {
  const map: Record<string, string> = { KG: 'kg', MT: 'MT', LTR: 'ltr', KL: 'KL', NOS: 'nos', BAG: 'nos', DRUM: 'nos' };
  return map[unit?.toUpperCase()] || unit || 'kg';
}

// GET / — list all active items (procurement view)
router.get('/', async (req: Request, res: Response) => {
  try {
    const items = await prisma.inventoryItem.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true, code: true, name: true, category: true, subCategory: true,
        hsnCode: true, unit: true, gstPercent: true, defaultRate: true,
        minStock: true, currentStock: true, location: true, isActive: true,
        remarks: true, avgCost: true,
      },
    });
    // Map to Material-compatible shape for frontend compat
    const materials = items.map(i => ({
      ...i,
      storageLocation: i.location,
    }));
    res.json({ materials });
  } catch (err: unknown) { res.status(500).json({ error: 'Failed to load materials' }); }
});

// GET /:id — single item
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const item = await prisma.inventoryItem.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ error: 'Material not found' });
    res.json({ ...item, storageLocation: item.location });
  } catch (err: unknown) { res.status(500).json({ error: 'Failed to load material' }); }
});

// POST / — create item via procurement
router.post('/', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const code = await generateItemCode();
    const item = await prisma.inventoryItem.create({
      data: {
        name: b.name,
        code,
        category: b.category || 'RAW_MATERIAL',
        subCategory: b.subCategory || null,
        hsnCode: b.hsnCode || null,
        unit: normalizeUnit(b.unit),
        gstPercent: b.gstPercent ? parseFloat(b.gstPercent) : 18,
        defaultRate: b.defaultRate ? parseFloat(b.defaultRate) : 0,
        costPerUnit: b.defaultRate ? parseFloat(b.defaultRate) : 0,
        minStock: b.minStock ? parseFloat(b.minStock) : 0,
        currentStock: 0,
        location: b.storageLocation || b.location || null,
        remarks: b.remarks || null,
        isActive: true,
      },
    });
    res.status(201).json({ ...item, storageLocation: item.location });
  } catch (err: unknown) { res.status(500).json({ error: 'Failed to create material' }); }
});

// PUT /:id — update item via procurement
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const data: Record<string, unknown> = {};
    if (b.name !== undefined) data.name = b.name;
    if (b.category !== undefined) data.category = b.category;
    if (b.subCategory !== undefined) data.subCategory = b.subCategory;
    if (b.hsnCode !== undefined) data.hsnCode = b.hsnCode;
    if (b.unit !== undefined) data.unit = normalizeUnit(b.unit);
    if (b.gstPercent !== undefined) data.gstPercent = parseFloat(b.gstPercent);
    if (b.defaultRate !== undefined) data.defaultRate = parseFloat(b.defaultRate);
    if (b.minStock !== undefined) data.minStock = parseFloat(b.minStock);
    if (b.storageLocation !== undefined) data.location = b.storageLocation;
    if (b.location !== undefined) data.location = b.location;
    if (b.remarks !== undefined) data.remarks = b.remarks;
    if (b.isActive !== undefined) data.isActive = b.isActive;

    const item = await prisma.inventoryItem.update({ where: { id: req.params.id }, data });
    res.json({ ...item, storageLocation: item.location });
  } catch (err: unknown) { res.status(500).json({ error: 'Failed to update material' }); }
});

// DELETE /:id — deactivate
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await prisma.inventoryItem.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ ok: true });
  } catch (err: unknown) { res.status(500).json({ error: 'Failed to delete material' }); }
});

// POST /seed — seed default materials as InventoryItems
router.post('/seed', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  try {
    const seeds = [
      { name: 'Maize', category: 'RAW_MATERIAL', hsnCode: '1005', unit: 'MT', gstPercent: 5 },
      { name: 'Broken Rice', category: 'RAW_MATERIAL', hsnCode: '1006', unit: 'MT', gstPercent: 5 },
      { name: 'Alpha Amylase', category: 'CHEMICAL', subCategory: 'ENZYME', hsnCode: '3507', unit: 'ltr', gstPercent: 18 },
      { name: 'Gluco Amylase', category: 'CHEMICAL', subCategory: 'ENZYME', hsnCode: '3507', unit: 'ltr', gstPercent: 18 },
      { name: 'Yeast', category: 'CHEMICAL', hsnCode: '2102', unit: 'kg', gstPercent: 18 },
      { name: 'Sulphuric Acid', category: 'CHEMICAL', hsnCode: '2807', unit: 'kg', gstPercent: 18 },
      { name: 'Urea', category: 'CHEMICAL', hsnCode: '3102', unit: 'kg', gstPercent: 5 },
      { name: 'Antifoam', category: 'CHEMICAL', hsnCode: '3402', unit: 'ltr', gstPercent: 18 },
      { name: 'HSD/Diesel', category: 'CONSUMABLE', hsnCode: '2710', unit: 'ltr', gstPercent: 0 },
      { name: 'Furnace Oil', category: 'CONSUMABLE', hsnCode: '2710', unit: 'KL', gstPercent: 18 },
      { name: 'PP Bags', category: 'CONSUMABLE', hsnCode: '3923', unit: 'nos', gstPercent: 18 },
      { name: 'HDPE Bags', category: 'CONSUMABLE', hsnCode: '3923', unit: 'nos', gstPercent: 18 },
    ];
    let created = 0;
    for (const s of seeds) {
      const exists = await prisma.inventoryItem.findFirst({ where: { name: { equals: s.name, mode: 'insensitive' } } });
      if (!exists) {
        const code = await generateItemCode();
        await prisma.inventoryItem.create({ data: { ...s, code, isActive: true } });
        created++;
      }
    }
    res.json({ created });
  } catch (err: unknown) { res.status(500).json({ error: 'Seed failed' }); }
});

// POST /migrate — one-time migration: link old Material records to InventoryItem
router.post('/migrate', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  try {
    const materials = await prisma.material.findMany();
    const stats = { matched: 0, created: 0, poLinesUpdated: 0, grnLinesUpdated: 0 };
    const mapping: Record<string, string> = {}; // materialId -> inventoryItemId

    for (const mat of materials) {
      // Try to find matching InventoryItem
      let invItem = await prisma.inventoryItem.findFirst({
        where: { name: { equals: mat.name, mode: 'insensitive' } },
        select: { id: true },
      });
      if (!invItem) {
        invItem = await prisma.inventoryItem.findFirst({
          where: { name: { contains: mat.name, mode: 'insensitive' } },
          select: { id: true },
        });
      }
      if (!invItem) {
        invItem = await prisma.inventoryItem.findFirst({
          where: { name: { startsWith: mat.name, mode: 'insensitive' } },
          select: { id: true },
        });
      }

      if (invItem) {
        // Update InventoryItem with procurement fields from Material
        await prisma.inventoryItem.update({
          where: { id: invItem.id },
          data: {
            subCategory: mat.subCategory || undefined,
            defaultRate: mat.defaultRate || undefined,
            hsnCode: mat.hsnCode || undefined,
            gstPercent: mat.gstPercent,
          },
        });
        mapping[mat.id] = invItem.id;
        stats.matched++;
      } else {
        // Create new InventoryItem from Material
        const code = await generateItemCode();
        const created = await prisma.inventoryItem.create({
          data: {
            name: mat.name,
            code,
            category: mat.category,
            subCategory: mat.subCategory,
            hsnCode: mat.hsnCode,
            unit: normalizeUnit(mat.unit),
            gstPercent: mat.gstPercent,
            defaultRate: mat.defaultRate,
            costPerUnit: mat.defaultRate,
            minStock: mat.minStock,
            location: mat.storageLocation,
            remarks: mat.remarks,
            isActive: mat.isActive,
          },
        });
        mapping[mat.id] = created.id;
        stats.created++;
      }
    }

    // Backfill POLine.inventoryItemId
    for (const [materialId, inventoryItemId] of Object.entries(mapping)) {
      const result = await prisma.pOLine.updateMany({
        where: { materialId, inventoryItemId: null },
        data: { inventoryItemId },
      });
      stats.poLinesUpdated += result.count;
    }

    // Backfill GRNLine.inventoryItemId
    for (const [materialId, inventoryItemId] of Object.entries(mapping)) {
      const result = await prisma.gRNLine.updateMany({
        where: { materialId, inventoryItemId: null },
        data: { inventoryItemId },
      });
      stats.grnLinesUpdated += result.count;
    }

    res.json({ ok: true, mapping, ...stats });
  } catch (err: unknown) { res.status(500).json({ error: 'Migration failed' }); }
});

export default router;
