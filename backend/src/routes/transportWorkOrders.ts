import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { z } from 'zod';
import {
  onTransportWorkOrderConfirmed,
  onTransportPaymentMade,
  reverseAutoJournal,
} from '../services/autoJournal';

const router = Router();

// All transport-work-order routes require a logged-in user (sets req.user).
router.use(authenticate);

const PRODUCT_TYPES = ['ETHANOL', 'DDGS', 'WGS', 'SUGAR', 'SCRAP'] as const;
const RATE_BASES = ['PER_TRUCK', 'PER_LITER', 'PER_KL', 'PER_MT', 'PER_KM'] as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Normalized truck shape pulled from the various dispatch tables ──
interface SourceTruck {
  sourceType: string;
  sourceId: string;
  vehicleNo: string;
  dispatchDate: Date | null;
  destination: string | null;
  qtyMT?: number;
  qtyKL?: number;
  qtyLiters?: number;
  distanceKm?: number | null;
}

// Pull the billable per-truck dispatch records for a sales contract.
async function fetchContractTrucks(productType: string, contractId: string): Promise<SourceTruck[]> {
  if (productType === 'ETHANOL') {
    const rows = await prisma.ethanolLifting.findMany({
      where: { contractId },
      select: { id: true, vehicleNo: true, liftingDate: true, destination: true, quantityKL: true, quantityBL: true, distanceKm: true },
      orderBy: { liftingDate: 'desc' }, take: 500,
    });
    return rows.map(r => ({
      sourceType: 'ETHANOL_LIFTING', sourceId: r.id, vehicleNo: r.vehicleNo,
      dispatchDate: r.liftingDate, destination: r.destination,
      qtyKL: r.quantityKL, qtyLiters: r.quantityBL > 0 ? r.quantityBL : round2(r.quantityKL * 1000),
      distanceKm: r.distanceKm ?? null,
    }));
  }

  const table = productType === 'DDGS' ? prisma.dDGSContractDispatch
    : productType === 'WGS' ? prisma.wGSContractDispatch
    : productType === 'SUGAR' ? prisma.sugarContractDispatch
    : null;
  if (!table) return [];

  const sourceType = productType === 'DDGS' ? 'DDGS_DISPATCH' : productType === 'WGS' ? 'WGS_DISPATCH' : 'SUGAR_DISPATCH';
  const rows = await (table as any).findMany({
    where: { contractId },
    select: { id: true, vehicleNo: true, dispatchDate: true, destination: true, weightNetMT: true, distanceKm: true },
    orderBy: { dispatchDate: 'desc' }, take: 500,
  });
  return rows.map((r: any) => ({
    sourceType, sourceId: r.id, vehicleNo: r.vehicleNo,
    dispatchDate: r.dispatchDate, destination: r.destination,
    qtyMT: r.weightNetMT, distanceKm: r.distanceKm ?? null,
  }));
}

// Compute the billing quantity + unit for one truck under a given rate basis.
function billingQty(rateBasis: string, t: SourceTruck): { qty: number; unit: string } {
  switch (rateBasis) {
    case 'PER_TRUCK': return { qty: 1, unit: 'TRUCK' };
    case 'PER_MT': return { qty: t.qtyMT ?? 0, unit: 'MT' };
    case 'PER_KL': return { qty: t.qtyKL ?? 0, unit: 'KL' };
    case 'PER_LITER': return { qty: t.qtyLiters ?? 0, unit: 'LITER' };
    case 'PER_KM': return { qty: t.distanceKm ?? 0, unit: 'KM' };
    default: return { qty: 0, unit: 'TRUCK' };
  }
}

// Recompute header totals from line amounts + rates. Authoritative (server-side).
function computeTotals(opts: {
  lineAmounts: number[]; gstPercent: number; tdsPercent: number; supplyType: string; paidAmount: number;
}) {
  const subtotal = round2(opts.lineAmounts.reduce((s, a) => s + a, 0));
  const gstAmount = round2((subtotal * opts.gstPercent) / 100);
  const inter = opts.supplyType === 'INTER_STATE';
  const cgstAmount = inter ? 0 : round2(gstAmount / 2);
  const sgstAmount = inter ? 0 : round2(gstAmount - cgstAmount);
  const igstAmount = inter ? gstAmount : 0;
  const totalAmount = round2(subtotal + gstAmount);
  const tdsAmount = round2((subtotal * opts.tdsPercent) / 100);
  const netPayable = round2(totalAmount - tdsAmount);
  const balanceAmount = round2(netPayable - opts.paidAmount);
  return { subtotal, gstAmount, cgstAmount, sgstAmount, igstAmount, totalAmount, tdsAmount, netPayable, balanceAmount };
}

// List the sales contracts of a product type (for the contract picker).
async function listContracts(productType: string, companyFilter: Record<string, unknown>) {
  if (productType === 'ETHANOL') {
    const rows = await prisma.ethanolContract.findMany({
      where: { ...companyFilter },
      select: { id: true, contractNo: true, buyerName: true, omcName: true, omcDepot: true },
      orderBy: { createdAt: 'desc' }, take: 300,
    });
    return rows.map(r => ({ id: r.id, contractNo: r.contractNo, party: r.omcName || r.buyerName, defaultDepot: r.omcDepot || '' }));
  }
  const table = productType === 'DDGS' ? prisma.dDGSContract
    : productType === 'WGS' ? prisma.wGSContract
    : productType === 'SUGAR' ? prisma.sugarContract
    : null;
  if (!table) return [];
  const rows = await (table as any).findMany({
    where: { ...companyFilter },
    select: { id: true, contractNo: true, buyerName: true },
    orderBy: { createdAt: 'desc' }, take: 300,
  });
  return rows.map((r: any) => ({ id: r.id, contractNo: r.contractNo, party: r.buyerName, defaultDepot: '' }));
}

// ── GET / — list transport work orders ──
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const where: Record<string, unknown> = { ...getCompanyFilter(req) };
  if (req.query.status) where.status = String(req.query.status);
  if (req.query.transporterId) where.transporterId = String(req.query.transporterId);
  if (req.query.productType) where.productType = String(req.query.productType);

  const orders = await prisma.transportWorkOrder.findMany({
    where,
    select: {
      id: true, twoNo: true, transporterName: true, productType: true, contractNo: true,
      customerName: true, depot: true, rateBasis: true, rate: true, status: true,
      subtotal: true, totalAmount: true, netPayable: true, paidAmount: true, balanceAmount: true,
      createdAt: true, _count: { select: { lines: true } },
    },
    orderBy: { twoNo: 'desc' }, take: 200,
  });
  res.json({ orders });
}));

// ── GET /contracts?productType= — contracts for the picker ──
router.get('/contracts', asyncHandler(async (req: AuthRequest, res: Response) => {
  const productType = String(req.query.productType || '');
  if (!PRODUCT_TYPES.includes(productType as typeof PRODUCT_TYPES[number])) {
    return res.status(400).json({ error: 'Invalid productType' });
  }
  const contracts = await listContracts(productType, getCompanyFilter(req));
  res.json({ contracts });
}));

// ── GET /trucks?productType=&contractId=&excludeWoId= — dispatched trucks + billed flag ──
router.get('/trucks', asyncHandler(async (req: AuthRequest, res: Response) => {
  const productType = String(req.query.productType || '');
  const contractId = String(req.query.contractId || '');
  if (!productType || !contractId) return res.status(400).json({ error: 'productType and contractId are required' });

  const trucks = await fetchContractTrucks(productType, contractId);

  // Which of these are already billed on a (non-cancelled) transport WO?
  const sourceIds = trucks.map(t => t.sourceId);
  const billedLines = sourceIds.length ? await prisma.transportWorkOrderLine.findMany({
    where: {
      sourceId: { in: sourceIds },
      wo: { status: { not: 'CANCELLED' }, ...(req.query.excludeWoId ? { id: { not: String(req.query.excludeWoId) } } : {}) },
    },
    select: { sourceId: true, wo: { select: { twoNo: true } } },
  }) : [];
  const billedMap = new Map(billedLines.map(l => [l.sourceId, l.wo.twoNo]));

  res.json({
    trucks: trucks.map(t => ({ ...t, billedOnWo: billedMap.get(t.sourceId) ?? null })),
    depots: [...new Set(trucks.map(t => t.destination).filter(Boolean))],
  });
}));

// ── GET /:id — detail ──
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const wo = await prisma.transportWorkOrder.findFirst({
    where: { id: req.params.id, ...getCompanyFilter(req) },
    include: {
      transporter: { select: { id: true, name: true, gstin: true, phone: true } },
      lines: { orderBy: { dispatchDate: 'asc' } },
      payments: { orderBy: { paymentDate: 'desc' } },
    },
  });
  if (!wo) return res.status(404).json({ error: 'Transport work order not found' });
  res.json({ wo });
}));

// Shared: build line rows from a create/update payload + recompute totals.
async function buildLinesAndTotals(body: any) {
  const rateBasis: string = body.rateBasis;
  const rate: number = Number(body.rate) || 0;
  const lines: { sourceType: string; sourceId: string | null; vehicleNo: string; dispatchDate: Date | null; quantity: number; unit: string; amount: number }[] = [];

  // Pulled-from-dispatch trucks: re-resolve server-side so qty is authoritative.
  const selections: { sourceType: string; sourceId: string }[] = Array.isArray(body.truckSelections) ? body.truckSelections : [];
  if (selections.length && body.contractId) {
    const trucks = await fetchContractTrucks(body.productType, body.contractId);
    const byId = new Map(trucks.map(t => [t.sourceId, t]));
    for (const sel of selections) {
      const t = byId.get(sel.sourceId);
      if (!t) continue;
      const { qty, unit } = billingQty(rateBasis, t);
      lines.push({ sourceType: t.sourceType, sourceId: t.sourceId, vehicleNo: t.vehicleNo, dispatchDate: t.dispatchDate, quantity: qty, unit, amount: round2(rate * qty) });
    }
  }

  // Manual aggregate (no weighbridge): N trucks × qty per truck → one summary line.
  const truckCount = Math.trunc(Number(body.truckCount) || 0);
  const qtyPerTruck = Number(body.qtyPerTruck) || 0;
  if (truckCount > 0) {
    const unit = rateBasis === 'PER_TRUCK' ? 'TRUCK' : rateBasis === 'PER_MT' ? 'MT' : rateBasis === 'PER_KL' ? 'KL' : rateBasis === 'PER_LITER' ? 'LITER' : 'KM';
    // PER_TRUCK bills per truck; everything else bills total units (trucks × qty/truck).
    const totalQty = rateBasis === 'PER_TRUCK' ? truckCount : round2(truckCount * qtyPerTruck);
    const eta = body.estimatedDelivery ? new Date(body.estimatedDelivery) : null;
    lines.push({
      sourceType: 'MANUAL', sourceId: null,
      vehicleNo: `${truckCount} truck${truckCount > 1 ? 's' : ''}${qtyPerTruck > 0 && rateBasis !== 'PER_TRUCK' ? ` × ${qtyPerTruck.toLocaleString('en-IN')} ${unit}` : ''}`,
      dispatchDate: eta, quantity: totalQty, unit, amount: round2(rate * totalQty),
    });
  }

  const supplyType: string = body.supplyType || 'INTRA_STATE';
  const totals = computeTotals({
    lineAmounts: lines.map(l => l.amount),
    gstPercent: Number(body.gstPercent) || 0,
    tdsPercent: Number(body.tdsPercent) || 0,
    supplyType, paidAmount: 0,
  });
  return { lines, totals, supplyType };
}

const createSchema = z.object({
  transporterId: z.string().min(1),
  productType: z.enum(PRODUCT_TYPES),
  contractId: z.string().optional().nullable(),
  contractNo: z.string().optional().nullable(),
  customerName: z.string().optional().nullable(),
  depot: z.string().min(1, 'Depot/destination is required'),
  distanceKm: z.coerce.number().optional().nullable(),
  rateBasis: z.enum(RATE_BASES),
  rate: z.coerce.number().nonnegative(),
  gstPercent: z.coerce.number().min(0).max(28).optional().default(0),
  tdsPercent: z.coerce.number().min(0).max(10).optional().default(0),
  supplyType: z.enum(['INTRA_STATE', 'INTER_STATE']).optional().default('INTRA_STATE'),
  remarks: z.string().optional().nullable(),
  estimatedDelivery: z.string().optional().nullable(),
  truckSelections: z.array(z.object({ sourceType: z.string(), sourceId: z.string() })).optional(),
  // Manual aggregate (no weighbridge): N trucks × qty per truck
  trucksOrdered: z.coerce.number().int().min(0).optional(),
  truckCount: z.coerce.number().int().min(0).optional(),
  qtyPerTruck: z.coerce.number().min(0).optional(),
});

// ── POST / — create (DRAFT) ──
router.post('/', validate(createSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;

  const transporter = await prisma.transporter.findUnique({ where: { id: b.transporterId }, select: { name: true } });
  if (!transporter) return res.status(400).json({ error: 'Transporter not found' });

  const { lines, totals, supplyType } = await buildLinesAndTotals(b);
  if (lines.length === 0) return res.status(400).json({ error: 'Add at least one truck to the work order' });

  const wo = await prisma.transportWorkOrder.create({
    data: {
      transporterId: b.transporterId,
      transporterName: transporter.name,
      productType: b.productType,
      contractId: b.contractId || null,
      contractNo: b.contractNo || null,
      customerName: b.customerName || null,
      depot: b.depot,
      distanceKm: b.distanceKm ?? null,
      estimatedDelivery: b.estimatedDelivery ? new Date(b.estimatedDelivery) : null,
      rateBasis: b.rateBasis,
      rate: Number(b.rate) || 0,
      trucksOrdered: b.trucksOrdered ? Math.trunc(Number(b.trucksOrdered)) : null,
      truckCount: b.truckCount ? Math.trunc(Number(b.truckCount)) : null,
      qtyPerTruck: b.qtyPerTruck ? Number(b.qtyPerTruck) : null,
      gstPercent: Number(b.gstPercent) || 0,
      supplyType,
      tdsPercent: Number(b.tdsPercent) || 0,
      ...totals,
      status: 'DRAFT',
      remarks: b.remarks || null,
      userId: req.user!.id,
      companyId: getActiveCompanyId(req),
      lines: { create: lines },
    },
    include: { lines: true },
  });
  res.status(201).json({ wo });
}));

const updateSchema = createSchema.partial().extend({
  rateBasis: z.enum(RATE_BASES).optional(),
});

// ── PUT /:id — edit a DRAFT ──
router.put('/:id', validate(updateSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.transportWorkOrder.findFirst({ where: { id: req.params.id, ...getCompanyFilter(req) } });
  if (!existing) return res.status(404).json({ error: 'Transport work order not found' });
  if (existing.status !== 'DRAFT') return res.status(400).json({ error: 'Only DRAFT work orders can be edited' });

  // Merge incoming over existing for fields that feed the recompute.
  const merged = {
    productType: existing.productType,
    contractId: req.body.contractId !== undefined ? req.body.contractId : existing.contractId,
    rateBasis: req.body.rateBasis || existing.rateBasis,
    rate: req.body.rate !== undefined ? req.body.rate : existing.rate,
    gstPercent: req.body.gstPercent !== undefined ? req.body.gstPercent : existing.gstPercent,
    tdsPercent: req.body.tdsPercent !== undefined ? req.body.tdsPercent : existing.tdsPercent,
    supplyType: req.body.supplyType || existing.supplyType || 'INTRA_STATE',
    estimatedDelivery: req.body.estimatedDelivery !== undefined ? req.body.estimatedDelivery : existing.estimatedDelivery,
    truckSelections: req.body.truckSelections,
    truckCount: req.body.truckCount !== undefined ? req.body.truckCount : existing.truckCount,
    qtyPerTruck: req.body.qtyPerTruck !== undefined ? req.body.qtyPerTruck : existing.qtyPerTruck,
  };

  const reLine = req.body.truckSelections !== undefined || req.body.truckCount !== undefined
    || req.body.qtyPerTruck !== undefined || req.body.rate !== undefined || req.body.rateBasis !== undefined;

  const data: Record<string, unknown> = {};
  for (const f of ['depot', 'distanceKm', 'remarks', 'contractNo', 'customerName', 'contractId', 'transporterId']) {
    if (req.body[f] !== undefined) data[f] = req.body[f];
  }
  if (req.body.rate !== undefined) data.rate = Number(req.body.rate);
  if (req.body.rateBasis !== undefined) data.rateBasis = req.body.rateBasis;
  if (req.body.gstPercent !== undefined) data.gstPercent = Number(req.body.gstPercent);
  if (req.body.tdsPercent !== undefined) data.tdsPercent = Number(req.body.tdsPercent);
  if (req.body.supplyType !== undefined) data.supplyType = req.body.supplyType;
  if (req.body.estimatedDelivery !== undefined) data.estimatedDelivery = req.body.estimatedDelivery ? new Date(req.body.estimatedDelivery) : null;
  if (req.body.trucksOrdered !== undefined) data.trucksOrdered = req.body.trucksOrdered ? Math.trunc(Number(req.body.trucksOrdered)) : null;
  if (req.body.truckCount !== undefined) data.truckCount = req.body.truckCount ? Math.trunc(Number(req.body.truckCount)) : null;
  if (req.body.qtyPerTruck !== undefined) data.qtyPerTruck = req.body.qtyPerTruck ? Number(req.body.qtyPerTruck) : null;

  if (reLine) {
    const { lines, totals, supplyType } = await buildLinesAndTotals(merged);
    if (lines.length === 0) return res.status(400).json({ error: 'A work order must keep at least one truck' });
    Object.assign(data, totals, { supplyType });
    await prisma.transportWorkOrderLine.deleteMany({ where: { woId: existing.id } });
    data.lines = { create: lines };
  }

  const wo = await prisma.transportWorkOrder.update({ where: { id: existing.id }, data: data as any, include: { lines: true } });
  res.json({ wo });
}));

// ── POST /:id/confirm — DRAFT → CONFIRMED + accrual journal ──
router.post('/:id/confirm', asyncHandler(async (req: AuthRequest, res: Response) => {
  const wo = await prisma.transportWorkOrder.findFirst({ where: { id: req.params.id, ...getCompanyFilter(req) } });
  if (!wo) return res.status(404).json({ error: 'Transport work order not found' });
  if (wo.status !== 'DRAFT') return res.status(400).json({ error: 'Only DRAFT work orders can be confirmed' });

  const updated = await prisma.transportWorkOrder.update({
    where: { id: wo.id },
    data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedBy: req.user!.id },
  });

  await onTransportWorkOrderConfirmed(prisma, {
    id: wo.id, twoNo: wo.twoNo, subtotal: wo.subtotal,
    cgstAmount: wo.cgstAmount, sgstAmount: wo.sgstAmount, igstAmount: wo.igstAmount,
    tdsAmount: wo.tdsAmount, netPayable: wo.netPayable,
    transporterName: wo.transporterName, userId: req.user!.id,
    date: new Date(), companyId: wo.companyId || undefined,
  });

  res.json({ wo: updated });
}));

const paySchema = z.object({
  amount: z.coerce.number().positive(),
  tdsDeducted: z.coerce.number().min(0).optional().default(0),
  paymentMode: z.string().optional().default('NEFT'),
  paymentRef: z.string().optional().nullable(),
  paymentDate: z.string().optional(),
  remarks: z.string().optional().nullable(),
});

// ── POST /:id/pay — record a payment + settlement journal ──
router.post('/:id/pay', validate(paySchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const wo = await prisma.transportWorkOrder.findFirst({ where: { id: req.params.id, ...getCompanyFilter(req) } });
  if (!wo) return res.status(404).json({ error: 'Transport work order not found' });
  if (wo.status === 'DRAFT') return res.status(400).json({ error: 'Confirm the work order before paying' });
  if (wo.status === 'CANCELLED') return res.status(400).json({ error: 'Cannot pay a cancelled work order' });

  const amount = Number(req.body.amount);
  const tds = Number(req.body.tdsDeducted) || 0;
  if (round2(amount + tds) > round2(wo.balanceAmount + 0.01)) {
    return res.status(400).json({ error: `Payment (₹${round2(amount + tds)}) exceeds the outstanding balance (₹${wo.balanceAmount})` });
  }

  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.transportPayment.create({
      data: {
        woId: wo.id, transporterId: wo.transporterId, amount, tdsDeducted: tds,
        paymentMode: req.body.paymentMode || 'NEFT', paymentRef: req.body.paymentRef || null,
        paymentDate: req.body.paymentDate ? new Date(req.body.paymentDate) : new Date(),
        remarks: req.body.remarks || null, userId: req.user!.id, companyId: wo.companyId,
      },
    });
    const paidAmount = round2(wo.paidAmount + amount + tds);
    const balanceAmount = round2(wo.netPayable - paidAmount);
    const status = balanceAmount <= 0.01 ? 'PAID' : 'PARTIAL_PAID';
    const updated = await tx.transportWorkOrder.update({
      where: { id: wo.id }, data: { paidAmount, balanceAmount, status },
    });
    return { payment, updated };
  });

  await onTransportPaymentMade(prisma, {
    id: result.payment.id, amount, mode: req.body.paymentMode || 'NEFT', reference: req.body.paymentRef || null,
    tdsDeducted: tds, transporterName: wo.transporterName, userId: req.user!.id,
    paymentDate: result.payment.paymentDate, companyId: wo.companyId || undefined,
  });

  res.status(201).json({ wo: result.updated, payment: result.payment });
}));

const cancelSchema = z.object({ reason: z.string().trim().min(3, 'A cancellation reason is required') });

// ── POST /:id/cancel — cancel (reverses the accrual if confirmed) ──
router.post('/:id/cancel', validate(cancelSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const wo = await prisma.transportWorkOrder.findFirst({ where: { id: req.params.id, ...getCompanyFilter(req) } });
  if (!wo) return res.status(404).json({ error: 'Transport work order not found' });
  if (wo.status === 'CANCELLED') return res.status(400).json({ error: 'Already cancelled' });
  if (wo.paidAmount > 0) return res.status(400).json({ error: 'Cannot cancel a work order with payments recorded. Reverse the payments first.' });

  const updated = await prisma.transportWorkOrder.update({
    where: { id: wo.id },
    data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: req.body.reason.trim(), balanceAmount: 0 },
  });

  if (wo.status !== 'DRAFT') {
    await reverseAutoJournal(prisma, 'TRANSPORT_WO', wo.id, req.user!.id);
  }
  res.json({ wo: updated });
}));

// ── DELETE /:id — delete a DRAFT ──
router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const wo = await prisma.transportWorkOrder.findFirst({ where: { id: req.params.id, ...getCompanyFilter(req) } });
  if (!wo) return res.status(404).json({ error: 'Transport work order not found' });
  if (wo.status !== 'DRAFT') return res.status(400).json({ error: 'Only DRAFT work orders can be deleted. Cancel instead.' });

  await prisma.$transaction([
    prisma.transportWorkOrderLine.deleteMany({ where: { woId: wo.id } }),
    prisma.transportWorkOrder.delete({ where: { id: wo.id } }),
  ]);
  res.json({ success: true });
}));

export default router;
