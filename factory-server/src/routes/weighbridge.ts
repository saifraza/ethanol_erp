import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import prisma from '../prisma';
import { getCloudPrisma } from '../cloudPrisma';
import { asyncHandler, requireWbKey, requireWbKeyOrAuth, requireAuth, requireRole, AuthRequest } from '../middleware';
import { captureSnapshots } from '../services/cameraCapture';
import { getMasterData } from '../services/masterDataCache';
import { checkWeighmentRules, verifyOverridePin, logOverride } from '../services/ruleEngine';
import { registerPC } from '../services/pcMonitor';

const router = Router();

// ============================================================
// HELPERS
// ============================================================

/** IST time — Railway server runs UTC */
function nowIST(): Date {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

/** Determine shift from IST hour: 6-14=First, 14-22=Second, 22-6=Third */
function getShift(): string {
  const ist = nowIST();
  const h = ist.getUTCHours();
  if (h >= 6 && h < 14) return 'First Shift';
  if (h >= 14 && h < 22) return 'Second Shift';
  return 'Third Shift';
}

/** IST date string YYYY-MM-DD */
function todayIST(): string {
  const ist = nowIST();
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Start and end of IST date as UTC Date objects */
function istDayRange(dateStr?: string): { start: Date; end: Date } {
  const d = dateStr || todayIST();
  const start = new Date(`${d}T00:00:00+05:30`);
  const end = new Date(`${d}T23:59:59.999+05:30`);
  return { start, end };
}

/** Format IST datetime for display */
function fmtIST(d: Date | null | undefined): string {
  if (!d) return '--';
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  const dd = String(ist.getUTCDate()).padStart(2, '0');
  const mm = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const yy = String(ist.getUTCFullYear()).slice(2);
  const hh = String(ist.getUTCHours()).padStart(2, '0');
  const mi = String(ist.getUTCMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yy} ${hh}:${mi}`;
}

/** Atomic ticket number from Counter table */
async function nextTicketNo(): Promise<number> {
  const counter = await prisma.counter.upsert({
    where: { id: 'ticket_no' },
    create: { id: 'ticket_no', value: 1 },
    update: { value: { increment: 1 } },
  });
  return counter.value;
}

/** HTML-escape user input to prevent XSS in print templates */
function esc(s: string | number | null | undefined): string {
  if (s == null) return '--';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Weighment fields selected for list endpoints
const LIST_SELECT = {
  id: true, localId: true, ticketNo: true, pcId: true, pcName: true,
  vehicleNo: true, direction: true, purchaseType: true,
  poNumber: true, supplierName: true, materialName: true,
  grossWeight: true, tareWeight: true, netWeight: true,
  grossTime: true, tareTime: true, weightSource: true,
  status: true, gateEntryNo: true, gateEntryAt: true,
  shift: true, operatorName: true, bags: true, remarks: true,
  transporter: true, vehicleType: true, driverName: true, driverPhone: true,
  labStatus: true, labMoisture: true, labRemarks: true,
  grossPhotos: true, tarePhotos: true,
  cloudSynced: true, createdAt: true, updatedAt: true,
  materialCategory: true,
};

// ============================================================
// EXISTING ENDPOINTS (PC-to-server, API key auth)
// ============================================================

// POST /api/weighbridge/push — receive weighment from a PC
router.post('/push', requireWbKey, asyncHandler(async (req: Request, res: Response) => {
  const {
    localId, pcId, pcName, vehicleNo, direction,
    purchaseType, poNumber, supplierName, supplierId,
    materialName, materialId,
    grossWeight, tareWeight, netWeight,
    grossTime, tareTime,
    status, gateEntryNo, driverName, driverPhone, remarks,
  } = req.body;

  if (!localId || !pcId || !vehicleNo) {
    res.status(400).json({ error: 'localId, pcId, vehicleNo required' });
    return;
  }

  // Valid state transitions: GATE_ENTRY -> FIRST_DONE -> COMPLETE
  const VALID_TRANSITIONS: Record<string, string[]> = {
    GATE_ENTRY: ['FIRST_DONE', 'COMPLETE', 'CANCELLED'],
    FIRST_DONE: ['COMPLETE', 'CANCELLED'],
    COMPLETE: [],
    CANCELLED: [],
  };

  const newStatus = status || 'GATE_ENTRY';

  const existing = await prisma.weighment.findUnique({
    where: { localId },
    select: { id: true, status: true },
  });

  if (existing) {
    const allowedNext = VALID_TRANSITIONS[existing.status] || [];
    if (newStatus !== existing.status && !allowedNext.includes(newStatus)) {
      res.status(409).json({
        error: `Invalid transition: ${existing.status} -> ${newStatus}`,
        currentStatus: existing.status,
      });
      return;
    }
  }

  const weighment = await prisma.weighment.upsert({
    where: { localId },
    create: {
      localId, pcId, pcName: pcName || pcId, vehicleNo, direction: direction || 'INBOUND',
      purchaseType, poNumber, supplierName, supplierId,
      materialName, materialId,
      grossWeight: grossWeight ? parseFloat(grossWeight) : null,
      tareWeight: tareWeight ? parseFloat(tareWeight) : null,
      netWeight: netWeight ? parseFloat(netWeight) : null,
      grossTime: grossTime ? new Date(grossTime) : null,
      tareTime: tareTime ? new Date(tareTime) : null,
      status: newStatus,
      gateEntryNo, driverName, driverPhone, remarks,
    },
    update: {
      grossWeight: grossWeight ? parseFloat(grossWeight) : undefined,
      tareWeight: tareWeight ? parseFloat(tareWeight) : undefined,
      netWeight: netWeight ? parseFloat(netWeight) : undefined,
      grossTime: grossTime ? new Date(grossTime) : undefined,
      tareTime: tareTime ? new Date(tareTime) : undefined,
      status: newStatus,
      gateEntryNo, driverName, driverPhone, remarks,
      updatedAt: new Date(),
    },
  });

  res.json({ success: true, id: weighment.id });
}));

// GET /api/weighbridge/lookup/:identifier — QR scan lookup
router.get('/lookup/:identifier', requireWbKeyOrAuth, asyncHandler(async (req: Request, res: Response) => {
  const identifier = req.params.identifier as string;

  let weighment = await prisma.weighment.findUnique({
    where: { localId: identifier },
  });

  if (!weighment) {
    weighment = await prisma.weighment.findFirst({
      where: { gateEntryNo: identifier },
      orderBy: { createdAt: 'desc' },
    });
  }

  if (!weighment) {
    weighment = await prisma.weighment.findFirst({
      where: {
        vehicleNo: identifier,
        status: { not: 'COMPLETE' },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  if (!weighment) {
    res.status(404).json({ error: 'Not found', identifier });
    return;
  }

  res.json(weighment);
}));

// GET /api/weighbridge/weighments — list weighments (admin dashboard)
router.get('/weighments', requireAuth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const date = req.query.date as string;
  const pcId = req.query.pcId as string;
  const take = Math.min(parseInt(req.query.limit as string) || 50, 500);

  const where: Record<string, unknown> = {};
  if (date) {
    const { start, end } = istDayRange(date);
    where.createdAt = { gte: start, lte: end };
  }
  if (pcId) where.pcId = pcId;

  const weighments = await prisma.weighment.findMany({
    where,
    take,
    orderBy: { createdAt: 'desc' },
    select: LIST_SELECT,
  });

  res.json(weighments);
}));

// GET /api/weighbridge/stats — today's summary (legacy)
router.get('/stats', requireAuth, asyncHandler(async (_req: AuthRequest, res: Response) => {
  const { start } = istDayRange();

  const [total, completed, pending, unsynced, catCounts] = await Promise.all([
    prisma.weighment.count({ where: { createdAt: { gte: start } } }),
    prisma.weighment.count({ where: { createdAt: { gte: start }, status: 'COMPLETE' } }),
    prisma.weighment.count({ where: { createdAt: { gte: start }, status: { not: 'COMPLETE' } } }),
    prisma.weighment.count({ where: { cloudSynced: false, status: 'COMPLETE' } }),
    prisma.weighment.groupBy({
      by: ['materialCategory'],
      where: { createdAt: { gte: start } },
      _count: true,
    }),
  ]);

  const byCategory: Record<string, number> = {};
  for (const g of catCounts) {
    byCategory[g.materialCategory || 'OTHER'] = g._count;
  }

  res.json({ today: { total, completed, pending }, unsynced, byCategory });
}));

// ============================================================
// NEW ENDPOINTS (JWT auth for frontend users)
// ============================================================

// POST /api/weighbridge/gate-entry — Create new weighment (gate entry step)
router.post('/gate-entry', requireAuth, requireRole('GATE_ENTRY', 'ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const {
    vehicleNo, direction, purchaseType, supplierName, supplierId, materialName,
    poId, poLineId, poNumber, transporter, vehicleType,
    driverName, driverPhone, bags, remarks, operatorName,
    sellerPhone, sellerVillage, sellerAadhaar,
    rate, deductions, deductionReason, paymentMode, paymentRef,
    cloudGatePassId,
  } = req.body;

  if (!vehicleNo) {
    res.status(400).json({ error: 'vehicleNo is required' });
    return;
  }

  const localId = randomUUID();
  const ticketNo = await nextTicketNo();
  const shift = getShift();
  const gateEntryAt = new Date();

  // Look up material category to determine lab behavior
  // 1. Try keyword inference first (instant, no DB needed)
  // 2. Then cloud DB (InventoryItem) for exact match
  // 3. Then local cache fallback
  let materialCategory: string | null = null;
  if (materialName) {
    const trimmedName = materialName.trim();
    const lower = trimmedName.toLowerCase();

    // 1. Keyword inference (fastest, always works)
    // DDGS checked BEFORE RAW_MATERIAL — "wet grain" would otherwise match "grain"
    const FUEL_KEYWORDS = ['coal', 'husk', 'bagasse', 'mustard', 'furnace', 'diesel', 'hsd', 'lfo', 'hfo', 'firewood', 'biomass'];
    const DDGS_KEYWORDS = ['ddgs', 'wdgs', 'distillers', 'distiller', 'dried grain', 'wet grain', 'wet distillers'];
    const RAW_MATERIAL_KEYWORDS = ['maize', 'corn', 'broken rice', 'grain', 'sorghum', 'milo'];
    const CHEMICAL_KEYWORDS = ['amylase', 'urea', 'acid', 'antifoam', 'yeast', 'chemical'];
    if (FUEL_KEYWORDS.some(kw => lower.includes(kw))) {
      materialCategory = 'FUEL';
    } else if (DDGS_KEYWORDS.some(kw => lower.includes(kw))) {
      materialCategory = 'DDGS';
    } else if (RAW_MATERIAL_KEYWORDS.some(kw => lower.includes(kw))) {
      materialCategory = 'RAW_MATERIAL';
    } else if (CHEMICAL_KEYWORDS.some(kw => lower.includes(kw))) {
      materialCategory = 'CHEMICAL';
    }

    // 2. Cloud DB lookup if keyword didn't match
    if (!materialCategory) {
      const cloud = getCloudPrisma();
      if (cloud) {
        try {
          const item = await cloud.inventoryItem.findFirst({
            where: { name: { equals: trimmedName, mode: 'insensitive' }, isActive: true },
            select: { category: true },
          });
          if (item?.category) materialCategory = item.category;
        } catch { /* cloud DB unreachable */ }
      }
    }

    // 3. Local cache fallback
    if (!materialCategory) {
      const mat = await prisma.cachedMaterial.findFirst({
        where: { name: { equals: trimmedName, mode: 'insensitive' } },
        select: { category: true },
      });
      if (mat?.category) materialCategory = mat.category;
    }
  }

  // Lab status rules:
  // - OUTBOUND: no lab
  // - RAW_MATERIAL (maize, broken rice): full lab on cloud ERP (PENDING)
  // - FUEL (coal, rice husk, bagasse): quick moisture check at gross WB (PENDING)
  // - CHEMICAL/PACKING/other: no lab
  const isInbound = (direction || 'INBOUND') === 'INBOUND';
  const needsLab = isInbound && (materialCategory === 'RAW_MATERIAL' || materialCategory === 'FUEL');
  const labStatus = needsLab ? 'PENDING' : null;

  const weighment = await prisma.weighment.create({
    data: {
      localId,
      ticketNo,
      pcId: 'web',
      pcName: 'Web UI',
      vehicleNo: vehicleNo.toUpperCase().trim(),
      direction: direction || 'INBOUND',
      purchaseType: purchaseType || null,
      supplierName: supplierName || null,
      supplierId: supplierId || null,
      materialName: materialName || null,
      materialCategory,
      poId: poId || null,
      poLineId: poLineId || null,
      poNumber: poNumber || null,
      transporter: transporter || null,
      vehicleType: vehicleType || null,
      driverName: driverName || null,
      driverPhone: driverPhone || null,
      bags: bags ? parseInt(bags) : null,
      remarks: remarks || null,
      operatorName: operatorName || req.user?.name || null,
      shift,
      gateEntryAt,
      status: 'GATE_ENTRY',
      // Spot purchase fields
      sellerPhone: sellerPhone || null,
      sellerVillage: sellerVillage || null,
      sellerAadhaar: sellerAadhaar || null,
      rate: rate ? parseFloat(rate) : null,
      deductions: deductions ? parseFloat(deductions) : null,
      deductionReason: deductionReason || null,
      paymentMode: paymentMode || null,
      paymentRef: paymentRef || null,
      labStatus,
      // Ethanol outbound: link to cloud DispatchTruck
      cloudGatePassId: cloudGatePassId || null,
    },
  });

  res.status(201).json(weighment);
}));

// POST /api/weighbridge/:id/gross — Capture gross weight (loaded truck)
// Outbound: this is the 2nd weighment. Inbound: this is the 1st weighment.
router.post('/:id/gross', requireAuth, requireRole('GROSS_WB', 'ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { weight, weightSource, pcId, quantityBL, strength, sealNo, rstNo, driverLicense, pesoDate } = req.body;

  if (!weight || typeof weight !== 'number' || weight <= 0) {
    res.status(400).json({ error: 'weight must be a positive number (KG)' });
    return;
  }

  const id = req.params.id as string;
  const peek = await prisma.weighment.findUnique({ where: { id }, select: { direction: true, status: true, tareWeight: true } });
  if (!peek) { res.status(404).json({ error: 'Weighment not found' }); return; }

  const now = new Date();
  const isFirst = peek.status === 'GATE_ENTRY';
  const isSecond = peek.status === 'FIRST_DONE';

  if (!isFirst && !isSecond) {
    res.status(409).json({ error: `Cannot capture gross — weighment is ${peek.status}` });
    return;
  }

  // Business rules check (only on 2nd weight — 1st weight has no prior to compare)
  if (isSecond) {
    const violations = await checkWeighmentRules(id, 'GROSS');
    if (violations.length > 0) {
      const { overridePin, overrideBy } = req.body;
      if (!overridePin) {
        res.status(422).json({ error: 'RULE_VIOLATION', violations, canOverride: true });
        return;
      }
      const pinValid = await verifyOverridePin(overridePin);
      if (!pinValid) {
        res.status(403).json({ error: 'Invalid override PIN' });
        return;
      }
      for (const v of violations) {
        await logOverride(v.ruleKey, id, 'GROSS', overrideBy || req.user?.name || 'admin');
      }
    }
  }

  let updateData: Record<string, unknown> = {
    grossWeight: weight,
    grossTime: now,
    grossPcId: pcId || 'web',
    weightSource: weightSource || 'SCALE',
    cloudSynced: false,
  };

  if (isFirst) {
    // Inbound: gross is 1st weighment
    updateData.status = 'FIRST_DONE';
    updateData.firstWeightAt = now;
  } else {
    // Outbound: gross is 2nd weighment (tare already captured)
    const tareW = peek.tareWeight || 0;
    if (weight <= tareW) { res.status(400).json({ error: 'Gross weight must exceed tare weight' }); return; }
    updateData.netWeight = weight - tareW;
    updateData.status = 'COMPLETE';
    updateData.secondWeightAt = now;
    // Ethanol outbound extras
    if (quantityBL != null) updateData.quantityBL = parseFloat(quantityBL);
    if (strength != null) updateData.strength = parseFloat(strength);
    if (sealNo) updateData.sealNo = sealNo;
    if (rstNo) updateData.rstNo = rstNo;
    if (driverLicense) updateData.driverLicense = driverLicense;
    if (pesoDate) updateData.pesoDate = pesoDate;
  }

  const result = await prisma.weighment.updateMany({
    where: { id, status: peek.status },
    data: updateData,
  });
  if (result.count === 0) {
    res.status(409).json({ error: 'Weighment state changed — refresh and try again' });
    return;
  }

  const updated = await prisma.weighment.findUnique({ where: { id } });

  // Fire-and-forget: capture camera snapshots
  captureSnapshots(id, 'gross').then(paths => {
    if (paths.length > 0) {
      prisma.weighment.update({ where: { id }, data: { grossPhotos: paths.join(',') } }).catch(() => {});
    }
  });

  res.json(updated);
}));

// POST /api/weighbridge/:id/tare — Capture tare weight (empty truck)
// Outbound: this is the 1st weighment. Inbound: this is the 2nd weighment.
router.post('/:id/tare', requireAuth, requireRole('TARE_WB', 'ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { weight, weightSource, pcId, quantityBL, strength, sealNo } = req.body;

  if (!weight || typeof weight !== 'number' || weight <= 0) {
    res.status(400).json({ error: 'weight must be a positive number (KG)' });
    return;
  }

  const id = req.params.id as string;
  const peek = await prisma.weighment.findUnique({
    where: { id },
    select: { direction: true, status: true, grossWeight: true },
  });
  if (!peek) { res.status(404).json({ error: 'Weighment not found' }); return; }

  const now = new Date();
  const isFirst = peek.status === 'GATE_ENTRY';
  const isSecond = peek.status === 'FIRST_DONE';

  if (!isFirst && !isSecond) {
    res.status(409).json({ error: `Cannot capture tare — weighment is ${peek.status}` });
    return;
  }

  // Business rules check (only on 2nd weight — 1st weight has no prior to compare)
  if (isSecond) {
    const violations = await checkWeighmentRules(id, 'TARE');
    if (violations.length > 0) {
      const { overridePin, overrideBy } = req.body;
      if (!overridePin) {
        res.status(422).json({ error: 'RULE_VIOLATION', violations, canOverride: true });
        return;
      }
      const pinValid = await verifyOverridePin(overridePin);
      if (!pinValid) {
        res.status(403).json({ error: 'Invalid override PIN' });
        return;
      }
      for (const v of violations) {
        await logOverride(v.ruleKey, id, 'TARE', overrideBy || req.user?.name || 'admin');
      }
    }
  }

  let updateData: Record<string, unknown> = {
    tareWeight: weight,
    tareTime: now,
    tarePcId: pcId || 'web',
    weightSource: weightSource || 'SCALE',
    cloudSynced: false,
  };

  if (isFirst) {
    // Outbound: tare is 1st weighment
    updateData.status = 'FIRST_DONE';
    updateData.firstWeightAt = now;
  } else {
    // Inbound: tare is 2nd weighment (gross already captured)
    const grossW = peek.grossWeight || 0;
    if (grossW <= weight) { res.status(400).json({ error: 'Gross weight must exceed tare weight' }); return; }
    updateData.netWeight = grossW - weight;
    updateData.status = 'COMPLETE';
    updateData.secondWeightAt = now;
    // Ethanol outbound extras (if provided)
    if (quantityBL != null) updateData.quantityBL = parseFloat(quantityBL);
    if (strength != null) updateData.strength = parseFloat(strength);
    if (sealNo) updateData.sealNo = sealNo;
  }

  const result = await prisma.weighment.updateMany({
    where: { id, status: peek.status },
    data: updateData,
  });
  if (result.count === 0) {
    res.status(409).json({ error: 'Weighment state changed — refresh and try again' });
    return;
  }

  const updated = await prisma.weighment.findUnique({ where: { id } });

  // Fire-and-forget: capture camera snapshots
  captureSnapshots(id, 'tare').then(paths => {
    if (paths.length > 0) {
      prisma.weighment.update({ where: { id }, data: { tarePhotos: paths.join(',') } }).catch(() => {});
    }
  });

  res.json(updated);
}));

// POST /api/weighbridge/:id/lab — Record lab test result
router.post('/:id/lab', requireAuth, requireRole('GROSS_WB', 'LAB', 'ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { labStatus, labMoisture, labStarch, labDamaged, labForeignMatter, labRemarks, labTestedBy } = req.body;

  if (!labStatus || !['PASS', 'FAIL'].includes(labStatus)) {
    res.status(400).json({ error: 'labStatus must be PASS or FAIL' });
    return;
  }

  const weighment = await prisma.weighment.findUnique({
    where: { id: req.params.id as string },
    select: { id: true, direction: true, status: true, labStatus: true },
  });
  if (!weighment) {
    res.status(404).json({ error: 'Weighment not found' });
    return;
  }

  // F-006: Only inbound, non-cancelled weighments with pending lab status
  if (weighment.direction !== 'INBOUND') {
    res.status(400).json({ error: 'Lab results only apply to INBOUND weighments' });
    return;
  }
  if (weighment.status === 'CANCELLED') {
    res.status(409).json({ error: 'Cannot record lab results for a cancelled weighment' });
    return;
  }
  if (weighment.labStatus !== 'PENDING') {
    res.status(409).json({ error: `Lab already recorded: ${weighment.labStatus}` });
    return;
  }

  const updated = await prisma.weighment.update({
    where: { id: req.params.id as string },
    data: {
      labStatus,
      labMoisture: labMoisture != null ? parseFloat(labMoisture) : null,
      labStarch: labStarch != null ? parseFloat(labStarch) : null,
      labDamaged: labDamaged != null ? parseFloat(labDamaged) : null,
      labForeignMatter: labForeignMatter != null ? parseFloat(labForeignMatter) : null,
      labRemarks: labRemarks || null,
      labTestedBy: labTestedBy || req.user?.name || null,
      labTestedAt: new Date(),
      cloudSynced: false, // re-sync to cloud with lab result
    },
  });

  res.json(updated);
}));

// GET /api/weighbridge/pending-gross — Trucks needing gross weight
// Inbound GATE_ENTRY (gross is 1st) + Outbound FIRST_DONE (gross is 2nd)
router.get('/pending-gross', requireAuth, asyncHandler(async (_req: AuthRequest, res: Response) => {
  const weighments = await prisma.weighment.findMany({
    where: {
      OR: [
        { direction: 'INBOUND', status: 'GATE_ENTRY' },
        { direction: 'OUTBOUND', status: 'FIRST_DONE' },
      ],
    },
    take: 100,
    orderBy: { createdAt: 'asc' },
    select: LIST_SELECT,
  });
  res.json(weighments);
}));

// GET /api/weighbridge/pending-tare — Trucks needing tare weight
// Outbound GATE_ENTRY (tare is 1st) + Inbound FIRST_DONE (tare is 2nd)
router.get('/pending-tare', requireAuth, asyncHandler(async (_req: AuthRequest, res: Response) => {
  const weighments = await prisma.weighment.findMany({
    where: {
      OR: [
        { direction: 'OUTBOUND', status: 'GATE_ENTRY' },
        { direction: 'INBOUND', status: 'FIRST_DONE' },
      ],
    },
    take: 100,
    orderBy: { createdAt: 'asc' },
    select: LIST_SELECT,
  });
  res.json(weighments);
}));

// GET /api/weighbridge/today — Today's completed weighments
router.get('/today', requireAuth, asyncHandler(async (_req: AuthRequest, res: Response) => {
  const { start, end } = istDayRange();

  const weighments = await prisma.weighment.findMany({
    where: {
      status: 'COMPLETE',
      createdAt: { gte: start, lte: end },
    },
    take: 200,
    orderBy: { createdAt: 'desc' },
    select: LIST_SELECT,
  });
  res.json(weighments);
}));

// GET /api/weighbridge/:id/photos — List available snapshot files
router.get('/:id/photos', requireAuth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const dir = path.join(__dirname, '..', '..', 'data', 'snapshots', req.params.id as string);
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.jpg'));
    res.json(files.map(f => ({ name: f, url: `/snapshots/${req.params.id}/${f}` })));
  } catch {
    res.json([]);
  }
}));

// GET /api/weighbridge/summary — Daily KPI stats
router.get('/summary', requireAuth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const dateStr = req.query.date as string;
  const { start, end } = istDayRange(dateStr);
  const dateFilter = { gte: start, lte: end };

  const [totalTrucks, completed, inboundAgg, outboundAgg, bagsAgg] = await Promise.all([
    prisma.weighment.count({ where: { createdAt: dateFilter } }),
    prisma.weighment.count({ where: { createdAt: dateFilter, status: 'COMPLETE' } }),
    prisma.weighment.aggregate({
      where: { createdAt: dateFilter, status: 'COMPLETE', direction: 'INBOUND' },
      _sum: { netWeight: true },
    }),
    prisma.weighment.aggregate({
      where: { createdAt: dateFilter, status: 'COMPLETE', direction: 'OUTBOUND' },
      _sum: { netWeight: true },
    }),
    prisma.weighment.aggregate({
      where: { createdAt: dateFilter },
      _sum: { bags: true },
    }),
  ]);

  const pending = totalTrucks - completed;

  res.json({
    date: dateStr || todayIST(),
    totalTrucks,
    completed,
    pending,
    inboundKg: inboundAgg._sum.netWeight || 0,
    outboundKg: outboundAgg._sum.netWeight || 0,
    totalBags: bagsAgg._sum.bags || 0,
  });
}));

// GET /api/weighbridge/search — Search with filters
router.get('/search', requireAuth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const vehicle = req.query.vehicle as string;
  const from = req.query.from as string;
  const to = req.query.to as string;
  const take = Math.min(parseInt(req.query.limit as string) || 50, 500);

  const where: Record<string, unknown> = {};

  if (vehicle) {
    where.vehicleNo = { contains: vehicle.toUpperCase(), mode: 'insensitive' };
  }
  if (from || to) {
    const dateFilter: Record<string, Date> = {};
    if (from) dateFilter.gte = new Date(`${from}T00:00:00+05:30`);
    if (to) dateFilter.lte = new Date(`${to}T23:59:59.999+05:30`);
    where.createdAt = dateFilter;
  }

  const weighments = await prisma.weighment.findMany({
    where,
    take,
    orderBy: { createdAt: 'desc' },
    select: LIST_SELECT,
  });

  res.json(weighments);
}));

// ============================================================
// PRINT ENDPOINTS (server-rendered HTML for 80mm thermal)
// ============================================================

const COMPANY_NAME = 'MAHAKAUSHAL SUGAR & POWER INDUSTRIES LTD';
const COMPANY_ADDR = 'Village Bachai, Dist. Narsinghpur, MP';

/** Common 80mm thermal receipt HTML wrapper */
function thermalHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @page { size: 80mm auto; margin: 2mm; }
  body { font-family: 'Courier New', monospace; font-size: 11px; width: 80mm; margin: 0 auto; padding: 2mm; color: #000; }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .line { border-top: 1px dashed #000; margin: 4px 0; }
  .row { display: flex; justify-content: space-between; margin: 1px 0; }
  .row .label { color: #000; font-weight: bold; }
  .row .value { font-weight: bold; text-align: right; }
  .big { font-size: 16px; font-weight: bold; text-align: center; margin: 4px 0; }
  .company { font-size: 12px; font-weight: bold; text-align: center; }
  .addr { font-size: 9px; text-align: center; color: #000; }
  .qr { text-align: center; margin: 6px 0; }
  .qr img { width: 120px; height: 120px; }
  .footer { font-size: 8px; text-align: center; color: #000; margin-top: 8px; }
  @media print { body { width: 80mm; } }
</style>
</head>
<body>
<div class="company">${COMPANY_NAME}</div>
<div class="addr">${COMPANY_ADDR}</div>
<div class="line"></div>
${body}
<div class="line"></div>
<div class="footer">Printed: ${fmtIST(new Date())}</div>
<script>window.onload=function(){window.print()}</script>
</body>
</html>`;
}

/** Build a row for receipt (HTML-escaped) */
function row(label: string, value: string | number | null | undefined): string {
  return `<div class="row"><span class="label">${label}:</span><span class="value">${esc(value)}</span></div>`;
}

/** QR code img tag using external API */
function qrImg(data: string): string {
  const encoded = encodeURIComponent(data);
  return `<div class="qr"><img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encoded}" alt="QR"></div>`;
}

/** Format weight for display */
function fmtKg(w: number | null | undefined): string {
  if (w == null) return '--';
  return `${w.toLocaleString('en-IN')} KG`;
}

// GET /api/weighbridge/print/gate-pass/:id — 80mm thermal gate pass
router.get('/print/gate-pass/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const w = await prisma.weighment.findUnique({ where: { id: req.params.id as string } });
  if (!w) { res.status(404).send('Not found'); return; }

  const body = `
<div class="center bold" style="font-size:13px; margin:4px 0;">GATE PASS</div>
<div class="big">T-${String(w.ticketNo || 0).padStart(4, '0')}</div>
<div class="line"></div>
${row('Vehicle', w.vehicleNo)}
${row('Direction', w.direction)}
${row('Type', w.purchaseType)}
${row('Supplier', w.supplierName)}
${row('Material', w.materialName)}
${row('PO No', w.poNumber)}
${row('Transporter', w.transporter)}
${row('Vehicle Type', w.vehicleType)}
${row('Driver', w.driverName)}
${row('Phone', w.driverPhone)}
${row('Bags', w.bags)}
${row('Shift', w.shift)}
${row('Gate Entry', fmtIST(w.gateEntryAt))}
${row('Operator', w.operatorName)}
${w.remarks ? row('Remarks', w.remarks) : ''}
${qrImg(w.localId)}
`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(thermalHtml(`Gate Pass T-${w.ticketNo}`, body));
}));

// GET /api/weighbridge/print/gross-slip/:id — 80mm thermal gross weight slip
router.get('/print/gross-slip/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const w = await prisma.weighment.findUnique({ where: { id: req.params.id as string } });
  if (!w) { res.status(404).send('Not found'); return; }

  const isOutbound = w.direction === 'OUTBOUND';
  const firstLabel = isOutbound ? 'TARE WEIGHT' : 'GROSS WEIGHT';
  const firstWeight = isOutbound ? w.tareWeight : w.grossWeight;
  const firstTime = isOutbound ? w.tareTime : w.grossTime;

  const body = `
<div class="center bold" style="font-size:13px; margin:4px 0;">WEIGHT SLIP - 1st</div>
<div class="big">T-${String(w.ticketNo || 0).padStart(4, '0')}</div>
<div class="line"></div>
${row('Vehicle', w.vehicleNo)}
${row('Direction', w.direction)}
${row('Supplier', w.supplierName)}
${row('Material', w.materialName)}
${row('PO No', w.poNumber)}
<div class="line"></div>
<div class="center bold" style="font-size:10px; margin:2px 0;">${firstLabel}</div>
<div class="big" style="font-size:20px;">${fmtKg(firstWeight)}</div>
${row('Weighed At', fmtIST(firstTime))}
${row('Source', w.weightSource)}
${qrImg(w.localId)}
`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(thermalHtml(`Gross Slip T-${w.ticketNo}`, body));
}));

// GET /api/weighbridge/print/final-slip/:id — 80mm thermal final slip
router.get('/print/final-slip/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const w = await prisma.weighment.findUnique({ where: { id: req.params.id as string } });
  if (!w) { res.status(404).send('Not found'); return; }

  // Lab results section
  let labSection = '';
  if (w.labStatus && w.labStatus !== 'PENDING') {
    labSection = `
<div class="line"></div>
<div class="center bold" style="font-size:10px; margin:2px 0;">LAB RESULTS</div>
${row('Status', w.labStatus)}
${w.labMoisture != null ? row('Moisture %', w.labMoisture.toFixed(1)) : ''}
${w.labStarch != null ? row('Starch %', w.labStarch.toFixed(1)) : ''}
${w.labDamaged != null ? row('Damaged %', w.labDamaged.toFixed(1)) : ''}
${w.labForeignMatter != null ? row('FM %', w.labForeignMatter.toFixed(1)) : ''}
${w.labRemarks ? row('Lab Remarks', w.labRemarks) : ''}
${row('Tested By', w.labTestedBy)}
${row('Tested At', fmtIST(w.labTestedAt))}`;
  }

  // Spot purchase section
  let spotSection = '';
  if (w.purchaseType === 'SPOT') {
    spotSection = `
<div class="line"></div>
<div class="center bold" style="font-size:10px; margin:2px 0;">SPOT PURCHASE</div>
${row('Rate/KG', w.rate != null ? `Rs ${w.rate.toFixed(2)}` : '--')}
${w.netWeight != null && w.rate != null ? row('Gross Amt', `Rs ${(w.netWeight * w.rate).toFixed(2)}`) : ''}
${w.deductions != null ? row('Deductions', `Rs ${w.deductions.toFixed(2)}`) : ''}
${w.deductionReason ? row('Reason', w.deductionReason) : ''}
${w.netWeight != null && w.rate != null ? row('Net Amt', `Rs ${(w.netWeight * w.rate - (w.deductions || 0)).toFixed(2)}`) : ''}
${row('Payment', w.paymentMode)}
${w.paymentRef ? row('Ref', w.paymentRef) : ''}
${row('Seller Phone', w.sellerPhone)}
${row('Village', w.sellerVillage)}`;
  }

  const body = `
<div class="center bold" style="font-size:13px; margin:4px 0;">WEIGHMENT SLIP</div>
<div class="big">T-${String(w.ticketNo || 0).padStart(4, '0')}</div>
<div class="line"></div>
${row('Vehicle', w.vehicleNo)}
${row('Direction', w.direction)}
${row('Type', w.purchaseType)}
${row('Supplier', w.supplierName)}
${row('Material', w.materialName)}
${row('PO No', w.poNumber)}
${row('Bags', w.bags)}
${row('Shift', w.shift)}
<div class="line"></div>
<div class="center bold" style="font-size:10px; margin:2px 0;">WEIGHTS</div>
${row('Gross', fmtKg(w.grossWeight))}
${row('Tare', fmtKg(w.tareWeight))}
<div class="line"></div>
<div class="center bold" style="font-size:10px;">NET WEIGHT (PRODUCT)</div>
<div class="big" style="font-size:22px;">${fmtKg(w.netWeight)}</div>
${row('Gross Time', fmtIST(w.grossTime))}
${row('Tare Time', fmtIST(w.tareTime))}
${labSection}
${spotSection}
${qrImg(w.localId)}
`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(thermalHtml(`Final Slip T-${w.ticketNo}`, body));
}));

// ============================================================
// WEIGHBRIDGE PC → FACTORY SERVER RELAY (cloud-format compat)
// These endpoints accept the same format the weighbridge PC
// currently sends to cloud, so the PC can push here on LAN
// instead of going over the internet.
// ============================================================

// Heartbeat storage for weighbridge PCs (received via /heartbeat)
const wbHeartbeats = new Map<string, Record<string, unknown>>();

/** GET /api/weighbridge/wb-heartbeats — expose stored heartbeats */
router.get('/wb-heartbeats', requireAuth, asyncHandler(async (_req: Request, res: Response) => {
  res.json(Array.from(wbHeartbeats.values()));
}));

/**
 * POST /api/weighbridge/wb-push
 * Accepts cloud-format: { weighments: [{ id, vehicle_no, weight_gross, ... }] }
 * Maps snake_case → camelCase, upserts into factory Weighment, marks for cloud relay.
 * Returns same shape as cloud: { ok, ids, count }
 */
router.post('/wb-push', requireWbKey, asyncHandler(async (req: Request, res: Response) => {
  const { weighments } = req.body;
  if (!Array.isArray(weighments) || weighments.length === 0) {
    res.status(400).json({ error: 'No weighments provided' });
    return;
  }

  const ids: string[] = [];
  let processed = 0;

  for (const w of weighments) {
    if (!w.id || !w.vehicle_no) continue;

    // Map direction: cloud uses IN/OUT, factory uses INBOUND/OUTBOUND
    const direction = w.direction === 'IN' ? 'INBOUND' : w.direction === 'OUT' ? 'OUTBOUND' : (w.direction || 'INBOUND');

    // Required fields for Prisma create
    const pcId = w.pc_id || 'weighbridge-1';
    const pcName = w.pc_name || 'Weighbridge';

    // Auto-register PC in monitor (discovers new PCs automatically)
    registerPC({ pcId, pcName, role: 'WEIGHBRIDGE' });
    const vehicleNo = w.vehicle_no;
    const status = w.status || 'GATE_ENTRY';

    // Optional fields — only include if present
    const optionals: Record<string, unknown> = {};
    if (w.purchase_type) optionals.purchaseType = w.purchase_type;
    if (w.po_number) optionals.poNumber = w.po_number;
    if (w.po_id) optionals.poId = w.po_id;
    if (w.po_line_id) optionals.poLineId = w.po_line_id;
    if (w.supplier_name) optionals.supplierName = w.supplier_name;
    if (w.supplier_id) optionals.supplierId = w.supplier_id;
    if (w.material) optionals.materialName = w.material;
    if (w.ticket_no != null) optionals.ticketNo = w.ticket_no;
    if (w.gate_entry_no) optionals.gateEntryNo = w.gate_entry_no;
    if (w.transporter) optionals.transporter = w.transporter;
    if (w.vehicle_type) optionals.vehicleType = w.vehicle_type;
    if (w.driver_name) optionals.driverName = w.driver_name;
    if (w.driver_mobile) optionals.driverPhone = w.driver_mobile;
    if (w.weight_gross != null) optionals.grossWeight = parseFloat(w.weight_gross);
    if (w.weight_tare != null) optionals.tareWeight = parseFloat(w.weight_tare);
    if (w.weight_net != null) optionals.netWeight = parseFloat(w.weight_net);
    if (w.weight_source) optionals.weightSource = w.weight_source;
    if (w.first_weight_at) optionals.grossTime = new Date(w.first_weight_at);
    if (w.second_weight_at) optionals.tareTime = new Date(w.second_weight_at);
    if (w.bags != null) optionals.bags = w.bags;
    if (w.remarks) optionals.remarks = w.remarks;
    // Lab fields
    if (w.lab_status) optionals.labStatus = w.lab_status;
    if (w.lab_moisture != null) optionals.labMoisture = parseFloat(w.lab_moisture);
    if (w.lab_starch != null) optionals.labStarch = parseFloat(w.lab_starch);
    if (w.lab_damaged != null) optionals.labDamaged = parseFloat(w.lab_damaged);
    if (w.lab_foreign_matter != null) optionals.labForeignMatter = parseFloat(w.lab_foreign_matter);
    if (w.lab_remarks) optionals.labRemarks = w.lab_remarks;
    // Spot purchase
    if (w.seller_phone) optionals.sellerPhone = w.seller_phone;
    if (w.seller_village) optionals.sellerVillage = w.seller_village;
    if (w.seller_aadhaar) optionals.sellerAadhaar = w.seller_aadhaar;
    if (w.rate != null) optionals.rate = parseFloat(w.rate);
    if (w.deductions != null) optionals.deductions = parseFloat(w.deductions);
    if (w.deduction_reason) optionals.deductionReason = w.deduction_reason;
    if (w.payment_mode) optionals.paymentMode = w.payment_mode;
    if (w.payment_ref) optionals.paymentRef = w.payment_ref;
    // Ethanol outbound
    if (w.cloud_gate_pass_id) optionals.cloudGatePassId = w.cloud_gate_pass_id;
    if (w.quantity_bl != null) optionals.quantityBL = parseFloat(w.quantity_bl);
    if (w.ethanol_strength != null) optionals.strength = parseFloat(w.ethanol_strength);
    if (w.seal_no) optionals.sealNo = w.seal_no;
    if (w.rst_no) optionals.rstNo = w.rst_no;
    if (w.driver_license) optionals.driverLicense = w.driver_license;
    if (w.peso_date) optionals.pesoDate = w.peso_date;

    try {
      const weighment = await prisma.weighment.upsert({
        where: { localId: w.id },
        create: {
          localId: w.id,
          pcId,
          pcName,
          vehicleNo,
          direction,
          status,
          cloudSynced: false,
          ...optionals,
        },
        update: {
          pcId,
          pcName,
          vehicleNo,
          direction,
          status,
          cloudSynced: false,
          updatedAt: new Date(),
          ...optionals,
        },
      });
      ids.push(weighment.id);
      processed++;
    } catch (err) {
      console.error(`[WB-PUSH-RELAY] Failed to upsert ${w.id}:`, err instanceof Error ? err.message : err);
    }
  }

  res.json({ ok: true, ids, count: processed });
}));

/**
 * GET /api/weighbridge/master-data
 * Serves master data from factory server's in-memory cache (works offline).
 * Same format as cloud's /api/weighbridge/master-data.
 */
router.get('/master-data', requireWbKey, asyncHandler(async (_req: Request, res: Response) => {
  const data = getMasterData();

  const suppliers = (data.suppliers || []).map(s => ({ id: s.id, name: s.name }));
  const materials = (data.materials || []).map(m => ({ id: m.id, name: m.name, category: m.category || '' }));
  const pos = (data.pos || []).map(po => ({
    id: po.id,
    po_no: po.po_no,
    vendor_id: po.vendor_id,
    vendor_name: po.vendor_name,
    status: po.status,
    lines: po.lines || [],
  }));
  const customers = (data.customers || []).map(c => ({ id: c.id, name: c.name, short_name: c.shortName || '' }));
  const vehicles = data.vehicles || [];

  res.json({ suppliers, materials, pos, customers, vehicles });
}));

/**
 * POST /api/weighbridge/lab-results
 * Returns lab results for specified weighment IDs (by localId).
 * Weighbridge polls this to sync lab status back from factory/cloud.
 */
router.post('/lab-results', requireWbKey, asyncHandler(async (req: Request, res: Response) => {
  const { weighment_ids } = req.body;
  if (!Array.isArray(weighment_ids) || weighment_ids.length === 0) {
    res.json({ results: [] });
    return;
  }

  const weighments = await prisma.weighment.findMany({
    where: {
      localId: { in: weighment_ids },
      labStatus: { not: 'PENDING' },
    },
    select: {
      localId: true, labStatus: true, labMoisture: true,
      labStarch: true, labDamaged: true, labForeignMatter: true,
    },
    take: 100,
  });

  const results = weighments.map(w => ({
    weighment_id: w.localId,
    lab_status: w.labStatus,
    moisture: w.labMoisture,
    starch: w.labStarch,
    damaged: w.labDamaged,
    foreign_matter: w.labForeignMatter,
  }));

  res.json({ results });
}));

/**
 * POST /api/weighbridge/heartbeat
 * Receives heartbeat from weighbridge PC, stores in memory.
 */
router.post('/heartbeat', requireWbKey, asyncHandler(async (req: Request, res: Response) => {
  const { pcId, pcName } = req.body;
  if (!pcId) {
    res.status(400).json({ error: 'pcId required' });
    return;
  }

  wbHeartbeats.set(pcId, {
    pcId,
    pcName: pcName || pcId,
    timestamp: req.body.timestamp || new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    uptimeSeconds: req.body.uptimeSeconds,
    queueDepth: req.body.queueDepth,
    dbSizeMb: req.body.dbSizeMb,
    serialProtocol: req.body.serialProtocol,
    webPort: req.body.webPort,
    tailscaleIp: req.body.tailscaleIp,
    localUrl: req.body.localUrl,
    weightsToday: req.body.weightsToday,
    lastTicket: req.body.lastTicket,
    version: req.body.version,
    system: req.body.system,
    factoryReachable: req.body.factoryReachable,
    syncTarget: req.body.syncTarget,
  });

  res.json({ ok: true });
}));

export default router;
