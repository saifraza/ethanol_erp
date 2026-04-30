import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize, AuthRequest, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { getEffectiveGstRate, resolveHsnFromString } from '../services/taxRateLookup';
import { asyncHandler } from '../shared/middleware';

const router = Router();
router.use(authenticate);

/**
 * Resolve the effective GST for an InventoryItem given a possible hsnCodeId and
 * per-item override. HSN master is authoritative; legacyGstPercent is a fallback
 * used only when no hsnCodeId is set (pre-migration items).
 */
async function resolveMaterialGst(opts: {
  hsnCodeId?: string | null;
  overridePercent?: number | null;
  overrideReason?: string | null;
  legacyGstPercent?: number | null;
}): Promise<number> {
  const r = await getEffectiveGstRate({
    hsnCodeId: opts.hsnCodeId ?? null,
    itemOverridePercent: opts.overridePercent,
    itemOverrideReason: opts.overrideReason,
    legacyGstPercent: opts.legacyGstPercent,
  });
  return r.rate;
}

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
router.get('/', asyncHandler(async (req: Request, res: Response) => {
    const items = await prisma.inventoryItem.findMany({
      where: { isActive: true, ...getCompanyFilter(req as AuthRequest) },
      orderBy: { name: 'asc' },
      select: {
        id: true, code: true, name: true, category: true, subCategory: true,
        hsnCode: true, hsnCodeId: true, unit: true, gstPercent: true,
        gstOverridePercent: true, gstOverrideReason: true,
        hsnCodeRef: { select: { id: true, code: true, description: true } },
        defaultRate: true, minStock: true, currentStock: true, location: true,
        isActive: true, remarks: true, avgCost: true,
      },
    
    take: 500,
  });
    // Map to Material-compatible shape for frontend compat
    const materials = items.map(i => ({
      ...i,
      storageLocation: i.location,
    }));
    res.json({ materials });
}));

// GET /:id — single item
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
    const item = await prisma.inventoryItem.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ error: 'Material not found' });
    res.json({ ...item, storageLocation: item.location });
}));

// POST / — create item via procurement
router.post('/', asyncHandler(async (req: Request, res: Response) => {
    const b = req.body;
    const code = await generateItemCode();

    // If hsnCodeId supplied, lookup code string for legacy cache + use master GST.
    // If only the free-text hsnCode is given (what the Store usually types),
    // fuzzy-match it against the HSN master so the FK gets set automatically.
    let hsnCodeStr: string | null = b.hsnCode || null;
    let resolvedHsnId: string | null = b.hsnCodeId || null;
    if (resolvedHsnId) {
      const h = await prisma.hsnCode.findUnique({ where: { id: resolvedHsnId }, select: { code: true } });
      if (h) hsnCodeStr = h.code;
    } else if (hsnCodeStr) {
      const auto = await resolveHsnFromString(hsnCodeStr);
      if (auto.hsnCodeId) {
        resolvedHsnId = auto.hsnCodeId;
        hsnCodeStr = auto.matchedCode;
      }
    }

    const overridePercent = b.gstOverridePercent != null ? parseFloat(b.gstOverridePercent) : null;
    const overrideReason = b.gstOverrideReason || null;
    if (overridePercent != null && !overrideReason) {
      return res.status(400).json({ error: 'gstOverrideReason is required when gstOverridePercent is set' });
    }

    const resolvedGst = await resolveMaterialGst({
      hsnCodeId: resolvedHsnId,
      overridePercent,
      overrideReason,
      legacyGstPercent: b.gstPercent != null ? parseFloat(b.gstPercent) : null,
    });

    const item = await prisma.inventoryItem.create({
      data: {
        name: b.name,
        code,
        category: b.category || 'RAW_MATERIAL',
        subCategory: b.subCategory || null,
        hsnCode: hsnCodeStr,
        hsnCodeId: resolvedHsnId,
        unit: normalizeUnit(b.unit),
        gstPercent: resolvedGst,
        gstOverridePercent: overridePercent,
        gstOverrideReason: overrideReason,
        defaultRate: b.defaultRate ? parseFloat(b.defaultRate) : 0,
        costPerUnit: b.defaultRate ? parseFloat(b.defaultRate) : 0,
        minStock: b.minStock ? parseFloat(b.minStock) : 0,
        currentStock: 0,
        location: b.storageLocation || b.location || null,
        remarks: b.remarks || null,
        isActive: true,
        companyId: getActiveCompanyId(req as AuthRequest),
      },
    });
    res.status(201).json({ ...item, storageLocation: item.location });
}));

// PUT /:id — update item via procurement
router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
    const b = req.body;
    const existing = await prisma.inventoryItem.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Material not found' });

    const data: Record<string, unknown> = {};
    if (b.name !== undefined) data.name = b.name;
    if (b.category !== undefined) data.category = b.category;
    if (b.subCategory !== undefined) data.subCategory = b.subCategory;
    if (b.unit !== undefined) data.unit = normalizeUnit(b.unit);
    if (b.defaultRate !== undefined) data.defaultRate = parseFloat(b.defaultRate);
    if (b.minStock !== undefined) data.minStock = parseFloat(b.minStock);
    if (b.storageLocation !== undefined) data.location = b.storageLocation;
    if (b.location !== undefined) data.location = b.location;
    if (b.remarks !== undefined) data.remarks = b.remarks;
    if (b.isActive !== undefined) data.isActive = b.isActive;

    // Tax fields — source of truth is HsnCode master; only recompute if inputs changed.
    // Also: if the free-text hsnCode changed but no hsnCodeId supplied, fuzzy-
    // match against master so the FK gets auto-set on plain string edits.
    let autoResolvedId: string | null | undefined;
    const hsnStringChanged = b.hsnCode !== undefined && b.hsnCode !== existing.hsnCode;
    if (hsnStringChanged && b.hsnCodeId === undefined) {
      const auto = await resolveHsnFromString(b.hsnCode);
      if (auto.hsnCodeId) autoResolvedId = auto.hsnCodeId;
    }
    const hsnIdChanged =
      (b.hsnCodeId !== undefined && b.hsnCodeId !== existing.hsnCodeId) ||
      (autoResolvedId !== undefined && autoResolvedId !== existing.hsnCodeId);
    const overrideChanged = b.gstOverridePercent !== undefined || b.gstOverrideReason !== undefined;
    const legacyChanged = b.gstPercent !== undefined;
    if (hsnIdChanged || overrideChanged || legacyChanged) {
      const nextHsnId = b.hsnCodeId !== undefined ? b.hsnCodeId : (autoResolvedId ?? existing.hsnCodeId);
      const nextOverride = b.gstOverridePercent !== undefined
        ? (b.gstOverridePercent == null ? null : parseFloat(b.gstOverridePercent))
        : existing.gstOverridePercent;
      const nextReason = b.gstOverrideReason !== undefined
        ? (b.gstOverrideReason || null)
        : existing.gstOverrideReason;
      if (nextOverride != null && !nextReason) {
        return res.status(400).json({ error: 'gstOverrideReason is required when gstOverridePercent is set' });
      }
      const legacy = b.gstPercent != null ? parseFloat(b.gstPercent) : existing.gstPercent;
      const resolved = await resolveMaterialGst({
        hsnCodeId: nextHsnId,
        overridePercent: nextOverride,
        overrideReason: nextReason,
        legacyGstPercent: legacy,
      });
      data.hsnCodeId = nextHsnId;
      data.gstOverridePercent = nextOverride;
      data.gstOverrideReason = nextReason;
      data.gstPercent = resolved;
      // Keep legacy hsnCode string in sync
      if (hsnIdChanged) {
        if (nextHsnId) {
          const h = await prisma.hsnCode.findUnique({ where: { id: nextHsnId }, select: { code: true } });
          if (h) data.hsnCode = h.code;
        } else if (b.hsnCode !== undefined) {
          data.hsnCode = b.hsnCode;
        }
      } else if (b.hsnCode !== undefined) {
        data.hsnCode = b.hsnCode;
      }
    } else if (b.hsnCode !== undefined) {
      data.hsnCode = b.hsnCode;
    }

    const item = await prisma.inventoryItem.update({ where: { id: req.params.id }, data });
    res.json({ ...item, storageLocation: item.location });
}));

// DELETE /:id — deactivate, SUPER_ADMIN only, with reference check
router.delete('/:id', authorize('SUPER_ADMIN'), asyncHandler(async (req: Request, res: Response) => {
    const { checkMaterialReferences } = await import('../utils/referenceCheck');
    const check = await checkMaterialReferences(req.params.id);
    if (!check.canDelete) { res.status(409).json({ error: check.message }); return; }
    await prisma.inventoryItem.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ ok: true });
}));

// POST /seed — seed default materials as InventoryItems
router.post('/seed', authorize('ADMIN'), asyncHandler(async (req: Request, res: Response) => {
    const seeds = [
      { name: 'Maize', category: 'RAW_MATERIAL', hsnCode: '1005', unit: 'MT', gstPercent: 5 },
      { name: 'Broken Rice', category: 'RAW_MATERIAL', hsnCode: '1006', unit: 'MT', gstPercent: 5 },
      { name: 'Alpha Amylase', category: 'CHEMICAL', subCategory: 'ENZYME', hsnCode: '3507', unit: 'ltr', gstPercent: 18 },
      { name: 'Gluco Amylase', category: 'CHEMICAL', subCategory: 'ENZYME', hsnCode: '3507', unit: 'ltr', gstPercent: 18 },
      { name: 'Yeast', category: 'CHEMICAL', hsnCode: '2102', unit: 'kg', gstPercent: 18 },
      { name: 'Sulphuric Acid', category: 'CHEMICAL', hsnCode: '2807', unit: 'kg', gstPercent: 18 },
      { name: 'Urea', category: 'CHEMICAL', hsnCode: '3102', unit: 'kg', gstPercent: 5 },
      { name: 'Antifoam', category: 'CHEMICAL', hsnCode: '3402', unit: 'ltr', gstPercent: 18 },
      { name: 'HSD/Diesel', category: 'CONSUMABLE', hsnCode: '2710', unit: 'ltr', gstPercent: 18 },
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
}));

// POST /seed-chemicals — bulk seed all plant chemicals with department-wise rates
router.post('/seed-chemicals', authorize('ADMIN'), asyncHandler(async (req: Request, res: Response) => {
    const seeds: Array<{ name: string; unit: string; subCategory: string; defaultRate: number; remarks: string }> = [
      // ─── CPU (Condensate Polishing Unit) ───
      { name: 'Caustic Soda NaOH 100% - CPU', unit: 'kg', subCategory: 'CPU', defaultRate: 70.00, remarks: 'Monthly req: 3,000 kg' },
      { name: 'SMBS 100% Powder - CPU', unit: 'kg', subCategory: 'CPU', defaultRate: 300.00, remarks: 'Monthly req: 500 kg' },
      { name: 'Antiscalant 98% - CPU', unit: 'kg', subCategory: 'CPU', defaultRate: 250.00, remarks: 'Monthly req: 500 kg' },
      { name: 'HCl 33% Commercial Grade - CPU', unit: 'kg', subCategory: 'CPU', defaultRate: 15.00, remarks: 'Monthly req: 200 kg' },
      { name: 'RO CIP Enhancer - CPU', unit: 'kg', subCategory: 'CPU', defaultRate: 500.00, remarks: 'Monthly req: 500 kg' },
      { name: 'RO Biocide - CPU', unit: 'kg', subCategory: 'CPU', defaultRate: 500.00, remarks: 'Monthly req: 300 kg' },
      { name: 'Cartridge Filter 20µ/60mm/40" - CPU', unit: 'nos', subCategory: 'CPU', defaultRate: 300.00, remarks: 'Monthly req: 500 nos' },
      { name: 'Cartridge Filter 20µ/60mm/30" - CPU', unit: 'nos', subCategory: 'CPU', defaultRate: 250.00, remarks: 'Monthly req: 150 nos' },
      { name: 'Cartridge Filter 05µ/60mm/40" - CPU', unit: 'nos', subCategory: 'CPU', defaultRate: 200.00, remarks: 'Monthly req: 700 nos' },
      { name: 'Cartridge Filter 20µ/07mm/32" - CPU', unit: 'nos', subCategory: 'CPU', defaultRate: 500.00, remarks: 'Monthly req: 70 nos' },
      { name: 'Urea - CPU', unit: 'kg', subCategory: 'CPU', defaultRate: 10.00, remarks: 'Monthly req: 150 kg' },
      { name: 'DAP - CPU', unit: 'kg', subCategory: 'CPU', defaultRate: 20.00, remarks: 'Monthly req: 90 kg' },
      { name: 'Hypo (Sodium Hypochlorite) - CPU', unit: 'kg', subCategory: 'CPU', defaultRate: 30.00, remarks: 'Monthly req: 150 kg' },
      { name: 'Polyelectrolyte - CPU', unit: 'kg', subCategory: 'CPU', defaultRate: 500.00, remarks: 'Monthly req: 60 kg' },
      { name: 'Alum Solid - CPU', unit: 'kg', subCategory: 'CPU', defaultRate: 30.00, remarks: 'Monthly req: 90 kg' },
      { name: 'Aerobic Culture - CPU', unit: 'kg', subCategory: 'CPU', defaultRate: 100.00, remarks: 'Monthly req: 300 kg' },
      { name: 'Cow Dung - CPU', unit: 'kg', subCategory: 'CPU', defaultRate: 5.00, remarks: 'Monthly req: 4,000 kg' },

      // ─── WTP (Water Treatment Plant) ───
      { name: 'HCl 33% Commercial Grade - WTP', unit: 'kg', subCategory: 'WTP', defaultRate: 15.00, remarks: 'Monthly req: 15,000 kg' },
      { name: 'NaOH 100% - WTP', unit: 'kg', subCategory: 'WTP', defaultRate: 70.00, remarks: 'Monthly req: 4,500 kg' },
      { name: 'SMBS 100% LR Grade - WTP', unit: 'kg', subCategory: 'WTP', defaultRate: 300.00, remarks: 'Monthly req: 150 kg' },
      { name: 'Antiscalant 98% - WTP', unit: 'kg', subCategory: 'WTP', defaultRate: 250.00, remarks: 'Monthly req: 150 kg' },
      { name: 'NaCl 100% - WTP', unit: 'kg', subCategory: 'WTP', defaultRate: 8.00, remarks: 'Monthly req: 15,000 kg' },
      { name: 'RO CIP Enhancer - WTP', unit: 'kg', subCategory: 'WTP', defaultRate: 500.00, remarks: 'Monthly req: 200 kg' },
      { name: 'RO Biocide - WTP', unit: 'kg', subCategory: 'WTP', defaultRate: 500.00, remarks: 'Monthly req: 200 kg' },
      { name: 'Cartridge Filter 05µ/60mm/40" - WTP', unit: 'nos', subCategory: 'WTP', defaultRate: 200.00, remarks: 'Monthly req: 200 nos' },

      // ─── Cooling Tower ───
      { name: 'Indion-9061', unit: 'kg', subCategory: 'COOLING_TOWER', defaultRate: 472.00, remarks: 'Monthly req: 1,000 kg' },
      { name: 'Indion-9078', unit: 'kg', subCategory: 'COOLING_TOWER', defaultRate: 278.00, remarks: 'Monthly req: 500 kg' },
      { name: 'Indion-7615', unit: 'kg', subCategory: 'COOLING_TOWER', defaultRate: 285.00, remarks: 'Monthly req: 200 kg' },
      { name: 'Indion-5700', unit: 'kg', subCategory: 'COOLING_TOWER', defaultRate: 295.00, remarks: 'Monthly req: 250 kg' },

      // ─── Fermentation ───
      { name: 'Liquozyme ZPH (Alpha Amylase)', unit: 'kg', subCategory: 'FERMENTATION', defaultRate: 1156.40, remarks: 'Monthly req: 3,700 kg' },
      { name: 'Spirizyme ADV Ultra T (Glucoamylase)', unit: 'kg', subCategory: 'FERMENTATION', defaultRate: 568.40, remarks: 'Monthly req: 8,214 kg' },
      { name: 'Ethanol Red Dry Yeast', unit: 'kg', subCategory: 'FERMENTATION', defaultRate: 821.28, remarks: 'Monthly req: 4,070 kg' },
      { name: 'Alcozym G Pro(I)', unit: 'kg', subCategory: 'FERMENTATION', defaultRate: 3835.00, remarks: 'Monthly req: 185 kg' },
      { name: 'Bactoferm', unit: 'kg', subCategory: 'FERMENTATION', defaultRate: 24780.00, remarks: 'Monthly req: 18.5 kg' },
      { name: 'Urea - Fermentation', unit: 'kg', subCategory: 'FERMENTATION', defaultRate: 35.40, remarks: 'Monthly req: 62,900 kg' },
      { name: 'DAP - Fermentation', unit: 'kg', subCategory: 'FERMENTATION', defaultRate: 37.76, remarks: 'Monthly req: 1,850 kg' },
      { name: 'Formalin', unit: 'kg', subCategory: 'FERMENTATION', defaultRate: 47.20, remarks: 'Monthly req: 703 kg' },
      { name: 'Antifoam - Fermentation', unit: 'kg', subCategory: 'FERMENTATION', defaultRate: 159.30, remarks: 'Monthly req: 3,700 kg' },
      { name: 'Ammonia Liquid', unit: 'ltr', subCategory: 'FERMENTATION', defaultRate: 47.20, remarks: 'Monthly req: 55,500 ltr' },
      { name: 'Caustic Soda NaOH - Fermentation', unit: 'kg', subCategory: 'FERMENTATION', defaultRate: 70.00, remarks: 'Monthly req: 5,550 kg' },

      // ─── Ethanol Denaturing ───
      { name: 'Crotonaldehyde', unit: 'kg', subCategory: 'ETHANOL_DENATURING', defaultRate: 145.00, remarks: 'Monthly req: 18,000 kg' },
      { name: 'Denatonium Benzoate', unit: 'kg', subCategory: 'ETHANOL_DENATURING', defaultRate: 1100.00, remarks: 'Monthly req: 3,600 kg' },
    ];

    let created = 0;
    let skipped = 0;
    const results: Array<{ name: string; status: string }> = [];

    for (const s of seeds) {
      const exists = await prisma.inventoryItem.findFirst({
        where: { name: { equals: s.name, mode: 'insensitive' } },
        select: { id: true },
      });
      if (exists) {
        skipped++;
        results.push({ name: s.name, status: 'exists' });
        continue;
      }
      const code = await generateItemCode();
      await prisma.inventoryItem.create({
        data: {
          name: s.name,
          code,
          category: 'CHEMICAL',
          subCategory: s.subCategory,
          unit: s.unit,
          gstPercent: 18,
          defaultRate: s.defaultRate,
          costPerUnit: s.defaultRate,
          remarks: s.remarks,
          isActive: true,
        },
      });
      created++;
      results.push({ name: s.name, status: 'created' });
    }

    res.json({ created, skipped, total: seeds.length, results });
}));

// POST /normalize-names — one-time fix: trim whitespace and fix known typos in InventoryItem names
router.post('/normalize-names', authorize('ADMIN'), asyncHandler(async (req: Request, res: Response) => {
    // Known typo fixes: old name -> correct name
    const TYPO_FIXES: Record<string, string> = {
      'Rick Husk': 'Rice Husk',
    };

    const items = await prisma.inventoryItem.findMany({
      select: { id: true, name: true },
    
    take: 500,
  });

    let trimmed = 0;
    let typoFixed = 0;
    const changes: Array<{ id: string; oldName: string; newName: string }> = [];

    for (const item of items) {
      let newName = item.name.trim();

      // Check for known typo fixes
      if (TYPO_FIXES[newName]) {
        newName = TYPO_FIXES[newName];
      }

      if (newName !== item.name) {
        await prisma.inventoryItem.update({
          where: { id: item.id },
          data: { name: newName },
        });
        changes.push({ id: item.id, oldName: item.name, newName });
        if (newName.length !== item.name.length) trimmed++;
        if (TYPO_FIXES[item.name.trim()]) typoFixed++;
      }
    }

    res.json({ ok: true, trimmed, typoFixed, total: items.length, changes });
}));

// POST /migrate — one-time migration: link old Material records to InventoryItem
router.post('/migrate', authorize('ADMIN'), asyncHandler(async (req: Request, res: Response) => {
    const materials = await prisma.material.findMany({ take: 500 });
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
}));

export default router;
