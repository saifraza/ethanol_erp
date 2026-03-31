import { Router, Response, Request } from 'express';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import prisma from '../config/prisma';
import { onStockMovement } from '../services/autoJournal';
import { z } from 'zod';

const router = Router();

const WB_PUSH_KEY = process.env.WB_PUSH_KEY || 'mspil-wb-2026';

function checkWBKey(req: Request, res: Response): boolean {
  const key = req.headers['x-wb-key'] as string;
  if (key !== WB_PUSH_KEY) {
    res.status(401).json({ error: 'Invalid weighbridge push key' });
    return false;
  }
  return true;
}

let lastHeartbeat: {
  timestamp: string;
  uptimeSeconds?: number;
  queueDepth?: number;
  dbSizeMb?: number;
  receivedAt: string;
} | null = null;

// ==========================================================================
//  INVENTORY SYNC — reuse exact logic from goodsReceipts.ts
// ==========================================================================

async function syncToInventory(
  refType: string,
  refId: string,
  refNo: string,
  itemId: string,
  qty: number,
  costRate: number,
  direction: 'IN' | 'OUT',
  movementType: string,
  narration: string,
  userId: string,
): Promise<void> {
  const defaultWh = await prisma.warehouse.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!defaultWh) return;

  const invItem = await prisma.inventoryItem.findUnique({
    where: { id: itemId },
    select: { id: true, name: true, unit: true, currentStock: true, avgCost: true },
  });
  if (!invItem) return;

  const totalValue = Math.round(qty * costRate * 100) / 100;

  await prisma.$transaction(async (tx) => {
    const movement = await tx.stockMovement.create({
      data: {
        itemId: invItem.id,
        movementType,
        direction,
        quantity: qty,
        unit: invItem.unit,
        costRate,
        totalValue,
        warehouseId: defaultWh.id,
        refType,
        refId,
        refNo,
        narration,
        userId,
      },
    });

    // Upsert StockLevel
    const existing = await tx.stockLevel.findFirst({
      where: { itemId: invItem.id, warehouseId: defaultWh.id, binId: null, batchId: null },
    });
    if (existing) {
      await tx.stockLevel.update({
        where: { id: existing.id },
        data: { quantity: direction === 'IN' ? { increment: qty } : { decrement: qty } },
      });
    } else {
      await tx.stockLevel.create({
        data: { itemId: invItem.id, warehouseId: defaultWh.id, quantity: direction === 'IN' ? qty : -qty },
      });
    }

    // Update InventoryItem — weighted average cost (only for IN)
    if (direction === 'IN') {
      const existingQty = invItem.currentStock;
      const existingAvgCost = invItem.avgCost;
      const newTotalQty = existingQty + qty;
      const newAvgCost = newTotalQty > 0
        ? (existingQty * existingAvgCost + qty * costRate) / newTotalQty
        : costRate;

      await tx.inventoryItem.update({
        where: { id: invItem.id },
        data: {
          currentStock: { increment: qty },
          avgCost: Math.round(newAvgCost * 100) / 100,
          totalValue: Math.round(newTotalQty * newAvgCost * 100) / 100,
        },
      });
    } else {
      await tx.inventoryItem.update({
        where: { id: invItem.id },
        data: {
          currentStock: { decrement: qty },
          totalValue: { decrement: Math.round(qty * invItem.avgCost * 100) / 100 },
        },
      });
    }

    // Auto journal
    onStockMovement(prisma as Parameters<typeof onStockMovement>[0], {
      id: movement.id,
      movementNo: movement.movementNo,
      movementType: movement.movementType,
      direction: movement.direction,
      totalValue: movement.totalValue,
      itemName: invItem.name,
      userId,
      date: movement.date,
    }).catch(() => {});
  });
}

// ==========================================================================
//  PUSH — receive weighments from local service
// ==========================================================================

const weighmentSchema = z.object({
  id: z.string(),
  ticket_no: z.number(),
  direction: z.enum(['IN', 'OUT']),
  vehicle_no: z.string(),
  supplier_name: z.string().optional().default(''),
  material: z.string().optional().default(''),
  weight_first: z.number().nullable().optional(),
  weight_second: z.number().nullable().optional(),
  weight_gross: z.number().nullable().optional(),
  weight_tare: z.number().nullable().optional(),
  weight_net: z.number().nullable().optional(),
  weight_source: z.string().optional().default('SERIAL'),
  status: z.string().optional().default('COMPLETE'),
  moisture: z.number().nullable().optional(),
  bags: z.number().nullable().optional(),
  remarks: z.string().nullable().optional(),
  first_weight_at: z.string().nullable().optional(),
  second_weight_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  // New fields for ERP integration
  purchase_type: z.enum(['PO', 'SPOT', 'OUTBOUND']).optional().default('PO'),
  po_id: z.string().nullable().optional(),
  po_line_id: z.string().nullable().optional(),
  // Spot purchase fields
  seller_phone: z.string().nullable().optional(),
  seller_village: z.string().nullable().optional(),
  seller_aadhaar: z.string().nullable().optional(),
  rate: z.number().nullable().optional(),
  deductions: z.number().nullable().optional(),
  deduction_reason: z.string().nullable().optional(),
  payment_mode: z.string().nullable().optional(),
  payment_ref: z.string().nullable().optional(),
  po_number: z.string().nullable().optional(),
  transporter: z.string().nullable().optional(),
  vehicle_type: z.string().nullable().optional(),
  driver_mobile: z.string().nullable().optional(),
});

router.post('/push', asyncHandler(async (req: Request, res: Response) => {
  if (!checkWBKey(req, res)) return;

  const { weighments } = req.body;
  if (!Array.isArray(weighments) || weighments.length === 0) {
    return res.status(400).json({ error: 'No weighments provided' });
  }

  const ids: string[] = [];
  const results: Array<{ id: string; type: string; refNo: string }> = [];

  for (const raw of weighments) {
    const w = weighmentSchema.parse(raw);

    if (w.status !== 'COMPLETE' || !w.weight_net || !w.weight_gross || !w.weight_tare) {
      continue;
    }

    // Check for duplicate
    const dupCheck = await prisma.grainTruck.findFirst({
      where: { remarks: { contains: `WB:${w.id}` } },
      select: { id: true },
    });
    if (dupCheck) { ids.push(dupCheck.id); continue; }

    const wbRef = `WB:${w.id} | Ticket #${w.ticket_no} | ${w.weight_source}`;
    const purchaseType = w.purchase_type || 'PO';

    // ── INBOUND + PO → Auto-create GRN ──
    if (w.direction === 'IN' && purchaseType === 'PO' && w.po_id) {
      const po = await prisma.purchaseOrder.findUnique({
        where: { id: w.po_id },
        include: { lines: true, vendor: { select: { id: true, name: true } } },
      });

      if (po) {
        const netKg = w.weight_net || 0;
        // Find matching PO line (by inventoryItemId or first line)
        const poLine = w.po_line_id
          ? po.lines.find(l => l.id === w.po_line_id)
          : po.lines[0];

        if (poLine) {
          // Convert KG to PO unit (assume PO is in KG or MT)
          const unit = poLine.unit?.toUpperCase() || 'KG';
          const receivedQty = unit === 'MT' ? netKg / 1000 : netKg;
          const rate = poLine.rate;

          // Create GRN + update PO in transaction
          const grn = await prisma.$transaction(async (tx) => {
            const grn = await tx.goodsReceipt.create({
              data: {
                poId: po.id,
                vendorId: po.vendorId,
                grnDate: new Date(),
                vehicleNo: w.vehicle_no,
                challanNo: '',
                invoiceNo: '',
                remarks: `${wbRef} | Auto-GRN from weighbridge`,
                totalAmount: Math.round(receivedQty * rate * 100) / 100,
                totalQty: receivedQty,
                status: 'DRAFT',
                userId: 'system-weighbridge',
                lines: {
                  create: [{
                    poLineId: poLine.id,
                    inventoryItemId: poLine.inventoryItemId || null,
                    description: poLine.description || w.material || '',
                    receivedQty,
                    acceptedQty: receivedQty,
                    rejectedQty: 0,
                    unit: poLine.unit || 'KG',
                    rate,
                    amount: Math.round(receivedQty * rate * 100) / 100,
                    storageLocation: '',
                    batchNo: '',
                    remarks: `Vehicle: ${w.vehicle_no}`,
                  }],
                },
              },
              include: { lines: true },
            });

            // Update PO line received qty
            const newReceivedQty = poLine.receivedQty + receivedQty;
            const newPendingQty = poLine.quantity - newReceivedQty;
            await tx.pOLine.update({
              where: { id: poLine.id },
              data: { receivedQty: newReceivedQty, pendingQty: Math.max(0, newPendingQty) },
            });

            // Update PO status
            const allLines = await tx.pOLine.findMany({ where: { poId: po.id } });
            const allDone = allLines.every(l => l.pendingQty <= 0);
            const anyPartial = allLines.some(l => l.receivedQty > 0 && l.pendingQty > 0);
            if (allDone) {
              await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: 'RECEIVED' } });
            } else if (anyPartial) {
              await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: 'PARTIAL_RECEIVED' } });
            }

            return grn;
          });

          // Sync inventory outside transaction
          if (poLine.inventoryItemId) {
            try {
              await syncToInventory(
                'GRN', grn.id, `GRN-${grn.grnNo}`,
                poLine.inventoryItemId, receivedQty, rate,
                'IN', 'GRN_RECEIPT',
                `Auto-GRN from weighbridge: ${w.vehicle_no}`,
                'system-weighbridge',
              );
            } catch (_e) { /* swallow */ }
          }

          results.push({ id: grn.id, type: 'GRN', refNo: `GRN-${grn.grnNo}` });
          ids.push(grn.id);
          continue;
        }
      }
    }

    // ── INBOUND + SPOT → Auto-create DirectPurchase ──
    if (w.direction === 'IN' && purchaseType === 'SPOT') {
      const netKg = w.weight_net || 0;
      const rate = w.rate || 0;
      const amount = Math.round(netKg * rate * 100) / 100;
      const deductions = w.deductions || 0;
      const netPayable = Math.round((amount - deductions) * 100) / 100;

      const dp = await prisma.directPurchase.create({
        data: {
          date: w.created_at ? new Date(w.created_at) : new Date(),
          sellerName: w.supplier_name || 'Unknown',
          sellerPhone: w.seller_phone || '',
          sellerVillage: w.seller_village || '',
          sellerAadhaar: w.seller_aadhaar || '',
          materialName: w.material || 'Grain',
          quantity: netKg,
          unit: 'KG',
          rate,
          amount,
          vehicleNo: w.vehicle_no,
          weightSlipNo: `WB-${w.ticket_no}`,
          grossWeight: w.weight_gross,
          tareWeight: w.weight_tare,
          netWeight: w.weight_net,
          paymentMode: w.payment_mode || 'CASH',
          paymentRef: w.payment_ref || '',
          deductions,
          deductionReason: w.deduction_reason || '',
          netPayable,
          remarks: `${wbRef} | Auto from weighbridge`,
          userId: 'system-weighbridge',
        },
      });

      results.push({ id: dp.id, type: 'DirectPurchase', refNo: `DP-${dp.entryNo}` });
      ids.push(dp.id);
      continue;
    }

    // ── OUTBOUND → Create DDGSDispatchTruck ──
    if (w.direction === 'OUT') {
      const dupOutbound = await prisma.dDGSDispatchTruck.findFirst({
        where: { remarks: { contains: `WB:${w.id}` } },
        select: { id: true },
      });
      if (dupOutbound) { ids.push(dupOutbound.id); continue; }

      const grossKg = w.weight_gross || 0;
      const tareKg = w.weight_tare || 0;
      const netKg = w.weight_net || 0;
      const netMT = netKg / 1000;

      const dispatch = await prisma.dDGSDispatchTruck.create({
        data: {
          date: w.created_at ? new Date(w.created_at) : new Date(),
          vehicleNo: w.vehicle_no,
          partyName: w.supplier_name || '',
          weightGross: grossKg,
          weightTare: tareKg,
          weightNet: netMT,
          bags: w.bags || 0,
          status: 'GROSS_WEIGHED',
          gateInTime: w.first_weight_at ? new Date(w.first_weight_at) : new Date(),
          tareTime: w.first_weight_at ? new Date(w.first_weight_at) : undefined,
          grossTime: w.second_weight_at ? new Date(w.second_weight_at) : undefined,
          remarks: `${wbRef} | ${w.remarks || ''}`.trim(),
        },
      });

      results.push({ id: dispatch.id, type: 'DDGSDispatch', refNo: dispatch.id });
      ids.push(dispatch.id);
      continue;
    }

    // ── INBOUND + no PO (fallback) → GrainTruck record only ──
    if (w.direction === 'IN') {
      const grossTon = (w.weight_gross || 0) / 1000;
      const tareTon = (w.weight_tare || 0) / 1000;
      const netTon = (w.weight_net || 0) / 1000;

      const truck = await prisma.grainTruck.create({
        data: {
          date: w.created_at ? new Date(w.created_at) : new Date(),
          vehicleNo: w.vehicle_no,
          supplier: w.supplier_name || '',
          weightGross: grossTon,
          weightTare: tareTon,
          weightNet: netTon,
          moisture: w.moisture || undefined,
          bags: w.bags || undefined,
          remarks: `${wbRef} | ${w.remarks || ''}`.trim(),
        },
      });

      results.push({ id: truck.id, type: 'GrainTruck', refNo: truck.id });
      ids.push(truck.id);
    }
  }

  res.json({ ok: true, ids, results, count: ids.length });
}));


// ==========================================================================
//  MASTER DATA — suppliers + materials + active POs + customers
// ==========================================================================

router.get('/master-data', asyncHandler(async (req: Request, res: Response) => {
  if (!checkWBKey(req, res)) return;

  // Suppliers
  const vendors = await prisma.vendor.findMany({
    take: 500,
    where: { isActive: true },
    select: { id: true, name: true, category: true },
    orderBy: { name: 'asc' },
  });

  const recentTrucks = await prisma.grainTruck.findMany({
    where: {
      date: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
      supplier: { not: '' },
    },
    select: { supplier: true },
    distinct: ['supplier'],
    take: 200,
  });

  const supplierMap = new Map<string, { id: string; name: string }>();
  for (const v of vendors) {
    supplierMap.set(v.name.toLowerCase(), { id: v.id, name: v.name });
  }
  for (const t of recentTrucks) {
    if (t.supplier && !supplierMap.has(t.supplier.toLowerCase())) {
      supplierMap.set(t.supplier.toLowerCase(), { id: `truck-${t.supplier}`, name: t.supplier });
    }
  }

  // Materials
  const materials = await prisma.material.findMany({
    take: 500,
    select: { id: true, name: true, category: true },
    orderBy: { name: 'asc' },
  });

  // Active POs with pending qty (for raw material & fuel)
  const activePOs = await prisma.purchaseOrder.findMany({
    where: {
      status: { in: ['APPROVED', 'SENT', 'PARTIAL_RECEIVED'] },
    },
    take: 200,
    select: {
      id: true,
      poNo: true,
      vendorId: true,
      vendor: { select: { name: true } },
      status: true,
      lines: {
        select: {
          id: true,
          inventoryItemId: true,
          description: true,
          quantity: true,
          receivedQty: true,
          pendingQty: true,
          rate: true,
          unit: true,
        },
      },
    },
    orderBy: { poNo: 'desc' },
  });

  // Flatten POs into a simpler format for local cache
  const pos = activePOs.map(po => ({
    id: po.id,
    po_no: po.poNo,
    vendor_id: po.vendorId,
    vendor_name: po.vendor.name,
    status: po.status,
    lines: po.lines.map(l => ({
      id: l.id,
      inventory_item_id: l.inventoryItemId,
      description: l.description,
      quantity: l.quantity,
      received_qty: l.receivedQty,
      pending_qty: l.pendingQty,
      rate: l.rate,
      unit: l.unit,
    })),
  }));

  // Customers (for outbound)
  const customers = await prisma.customer.findMany({
    where: { isActive: true },
    take: 200,
    select: { id: true, name: true, shortName: true },
    orderBy: { name: 'asc' },
  });

  // Recent vehicle numbers (for auto-complete)
  const recentVehicles = await prisma.grainTruck.findMany({
    where: { date: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } },
    select: { vehicleNo: true },
    distinct: ['vehicleNo'],
    take: 200,
    orderBy: { date: 'desc' },
  });

  res.json({
    suppliers: Array.from(supplierMap.values()),
    materials: materials.map(m => ({ id: m.id, name: m.name, category: m.category })),
    pos,
    customers: customers.map(c => ({ id: c.id, name: c.name, short_name: c.shortName })),
    vehicles: recentVehicles.map(v => v.vehicleNo),
  });
}));


// ==========================================================================
//  HEARTBEAT
// ==========================================================================

router.post('/heartbeat', asyncHandler(async (req: Request, res: Response) => {
  if (!checkWBKey(req, res)) return;
  lastHeartbeat = { ...req.body, receivedAt: new Date().toISOString() };
  res.json({ ok: true });
}));

router.get('/heartbeat', asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!lastHeartbeat) {
    return res.json({ connected: false, message: 'No heartbeat received yet' });
  }
  const receivedAt = new Date(lastHeartbeat.receivedAt).getTime();
  const staleMs = 5 * 60 * 1000;
  const isAlive = Date.now() - receivedAt < staleMs;
  res.json({ connected: isAlive, lastHeartbeat, staleAfterMs: staleMs });
}));


// ==========================================================================
//  WEIGHMENTS — view synced weighments (for ERP web UI)
// ==========================================================================

router.get('/weighments', asyncHandler(async (req: AuthRequest, res: Response) => {
  const take = Math.min(parseInt(req.query.limit as string) || 50, 500);
  const skip = parseInt(req.query.offset as string) || 0;
  const date = req.query.date as string;

  const where: Record<string, unknown> = {};
  if (date) {
    const start = new Date(date);
    const end = new Date(date);
    end.setDate(end.getDate() + 1);
    where.date = { gte: start, lt: end };
  }
  where.remarks = { contains: 'WB:' };

  const trucks = await prisma.grainTruck.findMany({
    take, skip, where,
    orderBy: { date: 'desc' },
    select: {
      id: true, date: true, vehicleNo: true, supplier: true,
      weightGross: true, weightTare: true, weightNet: true,
      bags: true, remarks: true, createdAt: true,
    },
  });

  res.json(trucks);
}));

export default router;
