import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';

const router = Router();
router.use(authenticate as any);

// ── Helpers ──

const cleanPhone = (p?: string | null) =>
  (p || '').replace(/\D/g, '').slice(-10) || null;

async function nextFarmerCode(): Promise<string> {
  const count = await prisma.farmer.count();
  return `F-${String(count + 1).padStart(4, '0')}`;
}

/** Find farmer by phone (primary) or aadhaar (fallback). Used by gate handler too. */
async function findFarmer(phone: string | null, aadhaar: string | null) {
  if (phone) {
    const byPhone = await prisma.farmer.findFirst({ where: { phone } });
    if (byPhone) return byPhone;
  }
  if (aadhaar) {
    const byAadhaar = await prisma.farmer.findFirst({ where: { aadhaar } });
    if (byAadhaar) return byAadhaar;
  }
  return null;
}

// ── Schemas ──

const farmerSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional().nullable(),
  aadhaar: z.string().optional().nullable(),
  maanNumber: z.string().optional().nullable(),
  village: z.string().optional().nullable(),
  tehsil: z.string().optional().nullable(),
  district: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  pincode: z.string().optional().nullable(),
  bankName: z.string().optional().nullable(),
  bankAccount: z.string().optional().nullable(),
  bankIfsc: z.string().optional().nullable(),
  upiId: z.string().optional().nullable(),
  rawMaterialTypes: z.string().optional().nullable(),
  kycStatus: z.enum(['PENDING', 'VERIFIED', 'REJECTED']).optional(),
  kycNotes: z.string().optional().nullable(),
  isRCM: z.boolean().optional(),
  remarks: z.string().optional().nullable(),
});

const paymentSchema = z.object({
  amount: z.number().positive(),
  mode: z.string().default('CASH'),
  reference: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
  paymentDate: z.string().optional().nullable(),
  purchaseId: z.string().optional().nullable(),
});

// ──────────────────────────────────────────────────────────────
// LIST + SEARCH
// ──────────────────────────────────────────────────────────────

router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const q = (req.query.q as string | undefined)?.trim();
  const where: Record<string, unknown> = { ...getCompanyFilter(req), isActive: true };
  if (q) {
    (where as Record<string, unknown>).OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { phone: { contains: cleanPhone(q) || q } },
      { village: { contains: q, mode: 'insensitive' } },
      { maanNumber: { contains: q, mode: 'insensitive' } },
      { code: { contains: q, mode: 'insensitive' } },
    ];
  }
  const farmers = await prisma.farmer.findMany({
    where,
    take: 200,
    orderBy: { name: 'asc' },
    select: {
      id: true, code: true, name: true, phone: true, village: true, district: true,
      maanNumber: true, rawMaterialTypes: true, kycStatus: true, isActive: true, createdAt: true,
    },
  });
  res.json(farmers);
}));

// ──────────────────────────────────────────────────────────────
// LIST WITH BALANCE — used by RM Deals page to show farmers alongside POs.
// One round-trip: farmer master + summed purchases - summed payments + last trip date.
// ──────────────────────────────────────────────────────────────

router.get('/with-balance', asyncHandler(async (req: AuthRequest, res: Response) => {
  const farmers = await prisma.farmer.findMany({
    where: { ...getCompanyFilter(req), isActive: true },
    take: 500,
    orderBy: { name: 'asc' },
    select: {
      id: true, code: true, name: true, phone: true, village: true, district: true,
      maanNumber: true, rawMaterialTypes: true, kycStatus: true, createdAt: true,
    },
  });

  if (farmers.length === 0) return res.json([]);
  const ids = farmers.map(f => f.id);

  const [purchaseAgg, lastTrips, paymentAgg] = await Promise.all([
    prisma.directPurchase.groupBy({
      by: ['farmerId'],
      where: { farmerId: { in: ids } },
      _sum: { netPayable: true, quantity: true },
      _count: { _all: true },
    }),
    prisma.directPurchase.groupBy({
      by: ['farmerId'],
      where: { farmerId: { in: ids } },
      _max: { date: true },
    }),
    prisma.farmerPayment.groupBy({
      by: ['farmerId'],
      where: { farmerId: { in: ids } },
      _sum: { amount: true },
    }),
  ]);

  const purchaseMap = new Map(purchaseAgg.map(p => [p.farmerId, p]));
  const lastMap = new Map(lastTrips.map(t => [t.farmerId, t._max.date]));
  const payMap = new Map(paymentAgg.map(p => [p.farmerId, p._sum.amount || 0]));

  const result = farmers.map(f => {
    const p = purchaseMap.get(f.id);
    const purchased = Math.round((p?._sum.netPayable || 0) * 100) / 100;
    const paid = Math.round((payMap.get(f.id) || 0) * 100) / 100;
    return {
      ...f,
      trips: p?._count._all || 0,
      totalQty: Math.round((p?._sum.quantity || 0) * 100) / 100,
      totalPurchased: purchased,
      totalPaid: paid,
      outstanding: Math.round((purchased - paid) * 100) / 100,
      lastTripDate: lastMap.get(f.id) || null,
    };
  });

  res.json(result);
}));

// ──────────────────────────────────────────────────────────────
// CREATE
// ──────────────────────────────────────────────────────────────

router.post('/', validate(farmerSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body as z.infer<typeof farmerSchema>;
  const phone = cleanPhone(b.phone);

  // Dedup: phone first, aadhaar fallback
  const existing = await findFarmer(phone, b.aadhaar || null);
  if (existing) {
    return res.status(409).json({ error: `Farmer already exists: ${existing.name} (${existing.code})`, farmer: existing });
  }

  const code = await nextFarmerCode();
  const farmer = await prisma.farmer.create({
    data: {
      code,
      name: b.name,
      phone,
      aadhaar: b.aadhaar || null,
      maanNumber: b.maanNumber || null,
      village: b.village || null,
      tehsil: b.tehsil || null,
      district: b.district || null,
      state: b.state || null,
      pincode: b.pincode || null,
      bankName: b.bankName || null,
      bankAccount: b.bankAccount || null,
      bankIfsc: b.bankIfsc || null,
      upiId: b.upiId || null,
      rawMaterialTypes: b.rawMaterialTypes || null,
      kycStatus: b.kycStatus || 'PENDING',
      kycNotes: b.kycNotes || null,
      isRCM: b.isRCM ?? true,
      remarks: b.remarks || null,
      companyId: getActiveCompanyId(req),
    },
  });
  res.status(201).json(farmer);
}));

// ──────────────────────────────────────────────────────────────
// READ ONE
// ──────────────────────────────────────────────────────────────

router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const farmer = await prisma.farmer.findUnique({ where: { id: req.params.id } });
  if (!farmer) return res.status(404).json({ error: 'Farmer not found' });
  res.json(farmer);
}));

// ──────────────────────────────────────────────────────────────
// UPDATE
// ──────────────────────────────────────────────────────────────

router.put('/:id', validate(farmerSchema.partial()), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.farmer.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Farmer not found' });

  const b = req.body;
  const phone = b.phone !== undefined ? cleanPhone(b.phone) : existing.phone;

  const farmer = await prisma.farmer.update({
    where: { id: req.params.id },
    data: {
      name: b.name ?? existing.name,
      phone,
      aadhaar: b.aadhaar !== undefined ? (b.aadhaar || null) : existing.aadhaar,
      maanNumber: b.maanNumber !== undefined ? (b.maanNumber || null) : existing.maanNumber,
      village: b.village !== undefined ? (b.village || null) : existing.village,
      tehsil: b.tehsil !== undefined ? (b.tehsil || null) : existing.tehsil,
      district: b.district !== undefined ? (b.district || null) : existing.district,
      state: b.state !== undefined ? (b.state || null) : existing.state,
      pincode: b.pincode !== undefined ? (b.pincode || null) : existing.pincode,
      bankName: b.bankName !== undefined ? (b.bankName || null) : existing.bankName,
      bankAccount: b.bankAccount !== undefined ? (b.bankAccount || null) : existing.bankAccount,
      bankIfsc: b.bankIfsc !== undefined ? (b.bankIfsc || null) : existing.bankIfsc,
      upiId: b.upiId !== undefined ? (b.upiId || null) : existing.upiId,
      rawMaterialTypes: b.rawMaterialTypes !== undefined ? (b.rawMaterialTypes || null) : existing.rawMaterialTypes,
      kycStatus: b.kycStatus ?? existing.kycStatus,
      kycNotes: b.kycNotes !== undefined ? (b.kycNotes || null) : existing.kycNotes,
      isRCM: b.isRCM ?? existing.isRCM,
      remarks: b.remarks !== undefined ? (b.remarks || null) : existing.remarks,
    },
  });
  res.json(farmer);
}));

// ──────────────────────────────────────────────────────────────
// DEACTIVATE (soft delete) — ADMIN only
// ──────────────────────────────────────────────────────────────

router.delete('/:id', authorize('ADMIN') as any, asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.farmer.update({ where: { id: req.params.id }, data: { isActive: false } });
  res.json({ ok: true });
}));

// ──────────────────────────────────────────────────────────────
// LEDGER — running balance from purchases + payments
// ──────────────────────────────────────────────────────────────

router.get('/:id/ledger', asyncHandler(async (req: AuthRequest, res: Response) => {
  const farmerId = req.params.id;
  const farmer = await prisma.farmer.findUnique({ where: { id: farmerId } });
  if (!farmer) return res.status(404).json({ error: 'Farmer not found' });

  const [purchases, payments] = await Promise.all([
    prisma.directPurchase.findMany({
      where: { farmerId },
      orderBy: { date: 'asc' },
      take: 500,
      select: {
        id: true, entryNo: true, date: true, materialName: true, quantity: true, unit: true,
        rate: true, amount: true, deductions: true, netPayable: true, vehicleNo: true,
        weightSlipNo: true, paymentMode: true, isPaid: true,
      },
    }),
    prisma.farmerPayment.findMany({
      where: { farmerId },
      orderBy: { paymentDate: 'asc' },
      take: 500,
      select: {
        id: true, paymentNo: true, paymentDate: true, amount: true, mode: true,
        reference: true, remarks: true, purchaseId: true,
      },
    }),
  ]);

  type LedgerRow = {
    date: Date;
    type: 'PURCHASE' | 'PAYMENT';
    refNo: string;
    description: string;
    debit: number;  // money owed to farmer (purchase)
    credit: number; // money paid to farmer (payment)
    balance: number;
    sourceId: string;
  };

  const events: LedgerRow[] = [];
  for (const p of purchases) {
    events.push({
      date: p.date,
      type: 'PURCHASE',
      refNo: `DP-${p.entryNo}`,
      description: `${p.materialName} ${p.quantity} ${p.unit} @ ${p.rate}${p.vehicleNo ? ` | ${p.vehicleNo}` : ''}`,
      debit: 0,
      credit: p.netPayable,
      balance: 0,
      sourceId: p.id,
    });
  }
  for (const p of payments) {
    events.push({
      date: p.paymentDate,
      type: 'PAYMENT',
      refNo: `FP-${p.paymentNo}`,
      description: `${p.mode}${p.reference ? ` | ${p.reference}` : ''}${p.remarks ? ` | ${p.remarks}` : ''}`,
      debit: p.amount,
      credit: 0,
      balance: 0,
      sourceId: p.id,
    });
  }
  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Running balance: positive = farmer is owed, negative = farmer over-paid
  let bal = 0;
  for (const e of events) {
    bal += e.credit - e.debit;
    e.balance = Math.round(bal * 100) / 100;
  }

  const totalPurchased = purchases.reduce((s, p) => s + p.netPayable, 0);
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  const outstanding = Math.round((totalPurchased - totalPaid) * 100) / 100;

  res.json({
    farmer,
    events,
    summary: {
      totalTrips: purchases.length,
      totalPurchased: Math.round(totalPurchased * 100) / 100,
      totalPaid: Math.round(totalPaid * 100) / 100,
      outstanding,
    },
  });
}));

// ──────────────────────────────────────────────────────────────
// PAYMENTS — list + record
// ──────────────────────────────────────────────────────────────

router.get('/:id/payments', asyncHandler(async (req: AuthRequest, res: Response) => {
  const payments = await prisma.farmerPayment.findMany({
    where: { farmerId: req.params.id },
    orderBy: { paymentDate: 'desc' },
    take: 200,
    select: {
      id: true, paymentNo: true, paymentDate: true, amount: true, mode: true,
      reference: true, remarks: true, purchaseId: true, createdAt: true,
    },
  });
  res.json(payments);
}));

router.post('/:id/payments', validate(paymentSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const farmerId = req.params.id;
  const farmer = await prisma.farmer.findUnique({ where: { id: farmerId } });
  if (!farmer) return res.status(404).json({ error: 'Farmer not found' });

  const b = req.body as z.infer<typeof paymentSchema>;
  const payment = await prisma.farmerPayment.create({
    data: {
      farmerId,
      paymentDate: b.paymentDate ? new Date(b.paymentDate) : new Date(),
      amount: b.amount,
      mode: b.mode || 'CASH',
      reference: b.reference || null,
      remarks: b.remarks || null,
      purchaseId: b.purchaseId || null,
      userId: req.user!.id,
      companyId: getActiveCompanyId(req) || farmer.companyId,
    },
  });
  res.status(201).json(payment);
}));

// ──────────────────────────────────────────────────────────────
// AUTO-CREATE — used by gate-entry / weighbridge handlers.
// Idempotent: if a farmer already exists with this phone or aadhaar, return them.
// Otherwise create with minimal data; the back office can enrich KYC later.
// ──────────────────────────────────────────────────────────────

const autoCreateSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional().nullable(),
  aadhaar: z.string().optional().nullable(),
  village: z.string().optional().nullable(),
  maanNumber: z.string().optional().nullable(),
  rawMaterialType: z.string().optional().nullable(),
  companyId: z.string().optional().nullable(),
});

router.post('/auto-create', validate(autoCreateSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body as z.infer<typeof autoCreateSchema>;
  const phone = cleanPhone(b.phone);
  const existing = await findFarmer(phone, b.aadhaar || null);
  if (existing) return res.json({ farmer: existing, created: false });

  const code = await nextFarmerCode();
  const farmer = await prisma.farmer.create({
    data: {
      code,
      name: b.name,
      phone,
      aadhaar: b.aadhaar || null,
      village: b.village || null,
      maanNumber: b.maanNumber || null,
      rawMaterialTypes: b.rawMaterialType || null,
      kycStatus: 'PENDING',
      isRCM: true,
      companyId: b.companyId || getActiveCompanyId(req),
    },
  });
  res.status(201).json({ farmer, created: true });
}));

// ──────────────────────────────────────────────────────────────
// BACKFILL — group existing DirectPurchase rows into Farmers.
// One-shot admin operation. Idempotent: re-runnable, only fills where farmerId is null.
// ──────────────────────────────────────────────────────────────

router.post('/backfill', authorize('ADMIN') as any, asyncHandler(async (_req: AuthRequest, res: Response) => {
  const orphans = await prisma.directPurchase.findMany({
    where: { farmerId: null },
    select: {
      id: true, sellerName: true, sellerPhone: true, sellerAadhaar: true, sellerVillage: true,
      materialName: true, companyId: true,
    },
    take: 5000,
  });

  // Group by phone (fallback name) so multiple trips for same farmer collapse to one master
  const groups = new Map<string, typeof orphans>();
  for (const o of orphans) {
    const phone = cleanPhone(o.sellerPhone);
    const key = phone || `name:${(o.sellerName || '').toLowerCase().trim()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(o);
  }

  let farmersCreated = 0;
  let purchasesLinked = 0;

  for (const [, trips] of groups) {
    const first = trips[0];
    const phone = cleanPhone(first.sellerPhone);
    let farmer = await findFarmer(phone, first.sellerAadhaar);
    if (!farmer) {
      const code = await nextFarmerCode();
      farmer = await prisma.farmer.create({
        data: {
          code,
          name: first.sellerName || 'Unknown Farmer',
          phone,
          aadhaar: first.sellerAadhaar || null,
          village: first.sellerVillage || null,
          rawMaterialTypes: first.materialName || null,
          kycStatus: 'PENDING',
          isRCM: true,
          companyId: first.companyId || null,
        },
      });
      farmersCreated++;
    }
    const ids = trips.map(t => t.id);
    const upd = await prisma.directPurchase.updateMany({
      where: { id: { in: ids } },
      data: { farmerId: farmer.id },
    });
    purchasesLinked += upd.count;
  }

  res.json({ farmersCreated, purchasesLinked, totalOrphans: orphans.length });
}));

export default router;
