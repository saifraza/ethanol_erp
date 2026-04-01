import { Router, Response, Request } from 'express';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import prisma from '../config/prisma';
import { onStockMovement } from '../services/autoJournal';
import { z } from 'zod';
import crypto from 'crypto';
import { getLatestHeartbeat as getOPCHeartbeat } from './opcBridge';

const router = Router();

const WB_PUSH_KEY = process.env.WB_PUSH_KEY || 'mspil-wb-2026';

function checkWBKey(req: Request, res: Response): boolean {
  const key = req.headers['x-wb-key'] as string;
  if (!key || key.length !== WB_PUSH_KEY.length) {
    res.status(401).json({ error: 'Invalid weighbridge push key' });
    return false;
  }
  // Timing-safe comparison to prevent key leakage via timing attacks
  const keyBuf = Buffer.from(key, 'utf8');
  const expectedBuf = Buffer.from(WB_PUSH_KEY, 'utf8');
  if (!crypto.timingSafeEqual(keyBuf, expectedBuf)) {
    res.status(401).json({ error: 'Invalid weighbridge push key' });
    return false;
  }
  return true;
}

// Multi-PC heartbeat tracking
interface PCHeartbeat {
  pcId: string;
  pcName: string;
  timestamp: string;
  receivedAt: string;
  uptimeSeconds?: number;
  queueDepth?: number;
  dbSizeMb?: number;
  serialConnected?: boolean;
  serialProtocol?: string;
  webPort?: number;
  tailscaleIp?: string;
  localUrl?: string;
  weightsToday?: number;
  lastTicket?: number;
  version?: string;
  system?: {
    cpuPercent?: number;
    memoryMb?: number;
    diskFreeGb?: number;
    hostname?: string;
    os?: string;
  };
}

const pcHeartbeats = new Map<string, PCHeartbeat>();

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
  // Lab quality fields
  lab_status: z.string().optional(),
  lab_moisture: z.number().nullable().optional(),
  lab_starch: z.number().nullable().optional(),
  lab_damaged: z.number().nullable().optional(),
  lab_foreign_matter: z.number().nullable().optional(),
  lab_remarks: z.string().nullable().optional(),
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

    // For INBOUND raw material: accept gate entries (for lab testing page)
    // For everything else: only process COMPLETE weighments with weights
    const isGateOrPending = w.status === 'GATE_ENTRY' || w.status === 'FIRST_DONE';
    const isInbound = w.direction === 'IN';
    if (isGateOrPending && isInbound) {
      // Create/update a GrainTruck record for lab testing page (no weight yet)
      const dupGrain = await prisma.grainTruck.findFirst({
        where: { remarks: { contains: `WB:${w.id}` } },
        select: { id: true },
      });
      if (!dupGrain) {
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
            moisture: w.lab_moisture || undefined,
            starchPercent: w.lab_starch || undefined,
            damagedPercent: w.lab_damaged || undefined,
            foreignMatter: w.lab_foreign_matter || undefined,
            quarantine: w.lab_status === 'FAIL' ? true : undefined,
            quarantineWeight: w.lab_status === 'FAIL' ? netTon : undefined,
            quarantineReason: w.lab_status === 'FAIL' ? (w.lab_remarks || 'Failed lab test') : undefined,
            bags: w.bags || undefined,
            remarks: `WB:${w.id} | Ticket #${w.ticket_no} | ${w.status} | ${w.remarks || ''}`.trim(),
          },
        });
        results.push({ id: truck.id, type: 'GrainTruck', refNo: `PENDING-${truck.id.slice(0, 8)}` });
        ids.push(truck.id);
      } else {
        // Update existing record with latest data (lab result, weights)
        await prisma.grainTruck.update({
          where: { id: dupGrain.id },
          data: {
            weightGross: (w.weight_gross || 0) / 1000 || undefined,
            weightTare: (w.weight_tare || 0) / 1000 || undefined,
            weightNet: (w.weight_net || 0) / 1000 || undefined,
            moisture: w.lab_moisture || undefined,
            starchPercent: w.lab_starch || undefined,
            damagedPercent: w.lab_damaged || undefined,
            foreignMatter: w.lab_foreign_matter || undefined,
            quarantine: w.lab_status === 'FAIL' ? true : undefined,
            quarantineWeight: w.lab_status === 'FAIL' ? (w.weight_net || 0) / 1000 : undefined,
            quarantineReason: w.lab_status === 'FAIL' ? (w.lab_remarks || 'Failed lab test') : undefined,
            remarks: `WB:${w.id} | Ticket #${w.ticket_no} | ${w.status} | ${w.remarks || ''}`.trim(),
          },
        });
        ids.push(dupGrain.id);
      }
      continue;
    }

    if (w.status !== 'COMPLETE' || !w.weight_net || !w.weight_gross || !w.weight_tare) {
      continue;
    }

    // Check for duplicate across ALL tables (GrainTruck, DirectPurchase, DDGSDispatch)
    const dupGrain = await prisma.grainTruck.findFirst({
      where: { remarks: { contains: `WB:${w.id}` } },
      select: { id: true, weightNet: true },
    });
    if (dupGrain) {
      // Update existing record with weights (gate entry created it with 0 weights)
      if (dupGrain.weightNet === 0 || dupGrain.weightNet === null) {
        const grossTon = (w.weight_gross || 0) / 1000;
        const tareTon = (w.weight_tare || 0) / 1000;
        const netTon = (w.weight_net || 0) / 1000;
        await prisma.grainTruck.update({
          where: { id: dupGrain.id },
          data: {
            weightGross: grossTon,
            weightTare: tareTon,
            weightNet: netTon,
            moisture: w.lab_moisture || w.moisture || undefined,
            starchPercent: w.lab_starch || undefined,
            damagedPercent: w.lab_damaged || undefined,
            foreignMatter: w.lab_foreign_matter || undefined,
            quarantine: w.lab_status === 'FAIL' ? true : undefined,
            quarantineWeight: w.lab_status === 'FAIL' ? netTon : undefined,
            quarantineReason: w.lab_status === 'FAIL' ? (w.lab_remarks || 'Failed lab test') : undefined,
            remarks: `WB:${w.id} | Ticket #${w.ticket_no} | COMPLETE | ${w.remarks || ''}`.trim(),
          },
        });
        results.push({ id: dupGrain.id, type: 'GrainTruck', refNo: `UPDATED-${dupGrain.id.slice(0, 8)}` });
      }
      ids.push(dupGrain.id);
      continue;
    }

    const dupDP = await prisma.directPurchase.findFirst({
      where: { remarks: { contains: `WB:${w.id}` } },
      select: { id: true },
    });
    if (dupDP) { ids.push(dupDP.id); continue; }

    const dupDDGS = await prisma.dDGSDispatchTruck.findFirst({
      where: { remarks: { contains: `WB:${w.id}` } },
      select: { id: true },
    });
    if (dupDDGS) { ids.push(dupDDGS.id); continue; }

    // P1-1: Also check GoodsReceipt for duplicate (PO-linked inbound weighments create GRNs)
    const dupGRN = await prisma.goodsReceipt.findFirst({
      where: { remarks: { contains: `WB:${w.id}` } },
      select: { id: true },
    });
    if (dupGRN) { ids.push(dupGRN.id); continue; }

    const wbRef = `WB:${w.id} | Ticket #${w.ticket_no} | ${w.weight_source}`;
    const purchaseType = w.purchase_type || 'PO';

    // ── INBOUND + PO → Auto-create GRN (PASS) or quarantine GrainTruck (FAIL) ──
    if (w.direction === 'IN' && purchaseType === 'PO' && w.po_id) {
      const po = await prisma.purchaseOrder.findUnique({
        where: { id: w.po_id },
        include: {
          lines: { orderBy: { createdAt: 'asc' } },
          vendor: { select: { id: true, name: true } },
        },
      });

      // Validate PO is still receivable (not cancelled, closed, or already fully received)
      const receivableStatuses = ['APPROVED', 'SENT', 'PARTIAL_RECEIVED'];
      if (po && receivableStatuses.includes(po.status)) {
        const netKg = w.weight_net || 0;
        // Find matching PO line — prefer explicit po_line_id, fall back to first line with pending qty
        const poLine = w.po_line_id
          ? po.lines.find(l => l.id === w.po_line_id)
          : po.lines.find(l => l.pendingQty > 0) || po.lines[0];

        if (poLine) {
          // Convert KG to PO unit — support KG, MT, QUINTAL; default to KG
          const unit = poLine.unit?.toUpperCase() || 'KG';
          let receivedQty: number;
          switch (unit) {
            case 'MT': receivedQty = netKg / 1000; break;
            case 'QUINTAL': case 'QTL': receivedQty = netKg / 100; break;
            default: receivedQty = netKg; break; // KG and any unknown unit treated as KG
          }
          const rate = poLine.rate;

          // P1-2: Reject if PO line is already exhausted — do NOT fall through to GrainTruck
          if (poLine.pendingQty <= 0) {
            results.push({ id: w.id, type: 'SKIPPED', refNo: `PO-${po.poNo} line exhausted (pendingQty=0)` });
            ids.push(w.id);
            continue;
          }

          // ── LAB FAIL → Quarantine GrainTruck, skip GRN ──
          if (w.lab_status === 'FAIL') {
            const grossTon = (w.weight_gross || 0) / 1000;
            const tareTon = (w.weight_tare || 0) / 1000;
            const netTon = netKg / 1000;
            const labInfo = w.lab_remarks ? ` | Lab: ${w.lab_remarks}` : '';

            const truck = await prisma.grainTruck.create({
              data: {
                date: w.created_at ? new Date(w.created_at) : new Date(),
                vehicleNo: w.vehicle_no,
                supplier: po.vendor.name || w.supplier_name || '',
                weightGross: grossTon,
                weightTare: tareTon,
                weightNet: netTon,
                moisture: w.lab_moisture ?? undefined,
                starchPercent: w.lab_starch ?? undefined,
                damagedPercent: w.lab_damaged ?? undefined,
                foreignMatter: w.lab_foreign_matter ?? undefined,
                quarantine: true,
                quarantineWeight: netTon,
                quarantineReason: `QUARANTINE — Lab FAIL | PO-${po.poNo}${labInfo}`,
                bags: w.bags ?? undefined,
                remarks: `${wbRef} | QUARANTINE — Lab FAIL | PO-${po.poNo}${labInfo}`,
              },
            });

            results.push({ id: truck.id, type: 'QUARANTINE', refNo: `PO-${po.poNo} | Vehicle ${w.vehicle_no}` });
            ids.push(truck.id);
            continue;
          }

          // ── LAB PASS or PENDING/unset → Normal GRN flow ──
          {
            // Use local weighment timestamp, not server time
            const grnDate = w.created_at ? new Date(w.created_at) : new Date();
            const labRemarksSuffix = w.lab_status === 'PASS'
              ? ` | Lab PASS${w.lab_moisture != null ? ` (M:${w.lab_moisture}%)` : ''}`
              : '';

            // Create GRN + update PO + sync inventory all in one transaction
            const grn = await prisma.$transaction(async (tx) => {
              const grn = await tx.goodsReceipt.create({
                data: {
                  poId: po.id,
                  vendorId: po.vendorId,
                  grnDate,
                  vehicleNo: w.vehicle_no,
                  challanNo: '',
                  invoiceNo: '',
                  remarks: `${wbRef} | Auto-GRN from weighbridge${labRemarksSuffix}`,
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
                      remarks: `Vehicle: ${w.vehicle_no}${labRemarksSuffix}`,
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

            // Also create a GrainTruck record with lab quality data (for traceability)
            if (w.lab_moisture != null || w.lab_starch != null) {
              const grossTon = (w.weight_gross || 0) / 1000;
              const tareTon = (w.weight_tare || 0) / 1000;
              const netTon = netKg / 1000;
              await prisma.grainTruck.create({
                data: {
                  date: w.created_at ? new Date(w.created_at) : new Date(),
                  vehicleNo: w.vehicle_no,
                  supplier: po.vendor.name || w.supplier_name || '',
                  weightGross: grossTon,
                  weightTare: tareTon,
                  weightNet: netTon,
                  moisture: w.lab_moisture ?? undefined,
                  starchPercent: w.lab_starch ?? undefined,
                  damagedPercent: w.lab_damaged ?? undefined,
                  foreignMatter: w.lab_foreign_matter ?? undefined,
                  bags: w.bags ?? undefined,
                  remarks: `${wbRef} | GRN-${grn.grnNo} | PO-${po.poNo}${labRemarksSuffix}`,
                },
              }).catch(() => {}); // best-effort — GRN is the primary record
            }

            // Sync inventory outside transaction (DRAFT GRNs don't affect approved stock)
            if (poLine.inventoryItemId) {
              try {
                await syncToInventory(
                  'GRN', grn.id, `GRN-${grn.grnNo}`,
                  poLine.inventoryItemId, receivedQty, rate,
                  'IN', 'GRN_RECEIPT',
                  `Auto-GRN from weighbridge: ${w.vehicle_no}`,
                  'system-weighbridge',
                );
              } catch (invErr) {
                // Log but don't fail — GRN is created, inventory can be reconciled
                console.error(`Inventory sync failed for GRN-${grn.grnNo}: ${invErr}`);
              }
            }

            results.push({ id: grn.id, type: 'GRN', refNo: `GRN-${grn.grnNo}` });
            ids.push(grn.id);
            continue;
          }
        }
      }
      // P1-2: PO is cancelled/closed/not receivable — skip entirely, don't create GrainTruck
      if (!po) {
        results.push({ id: w.id, type: 'SKIPPED', refNo: `PO ${w.po_id} not found` });
      } else {
        results.push({ id: w.id, type: 'SKIPPED', refNo: `PO-${po.poNo} not receivable (status=${po.status})` });
      }
      ids.push(w.id);
      continue;
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
      const isQuarantine = w.lab_status === 'FAIL';
      const labInfo = w.lab_remarks ? ` | Lab: ${w.lab_remarks}` : '';

      const truck = await prisma.grainTruck.create({
        data: {
          date: w.created_at ? new Date(w.created_at) : new Date(),
          vehicleNo: w.vehicle_no,
          supplier: w.supplier_name || '',
          weightGross: grossTon,
          weightTare: tareTon,
          weightNet: netTon,
          moisture: w.lab_moisture ?? w.moisture ?? undefined,
          starchPercent: w.lab_starch ?? undefined,
          damagedPercent: w.lab_damaged ?? undefined,
          foreignMatter: w.lab_foreign_matter ?? undefined,
          quarantine: isQuarantine,
          quarantineWeight: isQuarantine ? netTon : 0,
          quarantineReason: isQuarantine ? `QUARANTINE — Lab FAIL${labInfo}` : undefined,
          bags: w.bags ?? undefined,
          remarks: `${wbRef} | ${isQuarantine ? 'QUARANTINE — Lab FAIL | ' : ''}${w.remarks || ''}${labInfo}`.trim(),
        },
      });

      results.push({ id: truck.id, type: isQuarantine ? 'QUARANTINE' : 'GrainTruck', refNo: truck.id });
      ids.push(truck.id);
    }
  }

  res.json({ ok: true, ids, results, count: ids.length });
}));


// ==========================================================================
//  LAB RESULTS — pull lab status back to weighbridge PC
// ==========================================================================

router.post('/lab-results', asyncHandler(async (req: Request, res: Response) => {
  if (!checkWBKey(req, res)) return;

  const { weighment_ids } = req.body;
  if (!Array.isArray(weighment_ids) || weighment_ids.length === 0) {
    return res.json({ results: [] });
  }

  // Find GrainTruck records that match these weighment IDs (via WB:uuid in remarks)
  const results: Array<{ weighment_id: string; lab_status: string; moisture: number | null; starch: number | null; damaged: number | null; foreign_matter: number | null }> = [];

  for (const wid of weighment_ids.slice(0, 50)) {
    const truck = await prisma.grainTruck.findFirst({
      where: { remarks: { contains: `WB:${wid}` } },
      select: { moisture: true, starchPercent: true, damagedPercent: true, foreignMatter: true, quarantine: true },
    });
    if (truck && (truck.moisture !== null || truck.quarantine)) {
      results.push({
        weighment_id: wid,
        lab_status: truck.quarantine ? 'FAIL' : 'PASS',
        moisture: truck.moisture,
        starch: truck.starchPercent,
        damaged: truck.damagedPercent,
        foreign_matter: truck.foreignMatter,
      });
    }
  }

  res.json({ results });
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

  // Materials (from Material table + fuel items from InventoryItem)
  const materials = await prisma.material.findMany({
    take: 500,
    select: { id: true, name: true, category: true },
    orderBy: { name: 'asc' },
  });

  // Also include fuel items from InventoryItem
  const fuelItems = await prisma.inventoryItem.findMany({
    where: { category: 'FUEL', isActive: true },
    take: 100,
    select: { id: true, name: true, category: true },
    orderBy: { name: 'asc' },
  });

  // Merge — add fuel items that aren't already in materials
  const materialNames = new Set(materials.map(m => m.name.toLowerCase()));
  for (const f of fuelItems) {
    if (!materialNames.has(f.name.toLowerCase())) {
      materials.push({ id: f.id, name: f.name, category: 'FUEL' });
    }
  }

  // Active POs with pending qty (for raw material & fuel)
  const activePOs = await prisma.purchaseOrder.findMany({
    where: {
      status: { in: ['APPROVED', 'SENT', 'PARTIAL_RECEIVED'] },
    },
    take: 200,
    select: {
      id: true,
      poNo: true,
      dealType: true,
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
    deal_type: po.dealType || 'STANDARD',
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
  const pcId = req.body.pcId || req.body.service || 'default';
  const hb: PCHeartbeat = {
    pcId,
    pcName: req.body.pcName || pcId,
    timestamp: req.body.timestamp || new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    uptimeSeconds: req.body.uptimeSeconds,
    queueDepth: req.body.queueDepth,
    dbSizeMb: req.body.dbSizeMb,
    serialConnected: req.body.serialConnected,
    serialProtocol: req.body.serialProtocol,
    webPort: req.body.webPort,
    tailscaleIp: req.body.tailscaleIp,
    localUrl: req.body.localUrl,
    weightsToday: req.body.weightsToday,
    lastTicket: req.body.lastTicket,
    version: req.body.version,
    system: req.body.system,
  };
  pcHeartbeats.set(pcId, hb);
  res.json({ ok: true });
}));

// GET /heartbeat — single PC (backward compat)
router.get('/heartbeat', asyncHandler(async (req: AuthRequest, res: Response) => {
  const allPCs = Array.from(pcHeartbeats.values());
  if (allPCs.length === 0) {
    return res.json({ connected: false, message: 'No heartbeat received yet' });
  }
  // Return first PC for backward compat
  const hb = allPCs[0];
  const receivedAt = new Date(hb.receivedAt).getTime();
  const staleMs = 5 * 60 * 1000;
  const isAlive = Date.now() - receivedAt < staleMs;
  res.json({ connected: isAlive, lastHeartbeat: hb, staleAfterMs: staleMs });
}));

// GET /system-status — all PCs status (for admin page)
router.get('/system-status', asyncHandler(async (req: AuthRequest, res: Response) => {
  const staleMs = 5 * 60 * 1000;
  const now = Date.now();

  const pcs = Array.from(pcHeartbeats.values()).map(hb => {
    const receivedAt = new Date(hb.receivedAt).getTime();
    const isAlive = now - receivedAt < staleMs;
    const lastSeenSec = Math.round((now - receivedAt) / 1000);
    return { ...hb, isAlive, lastSeenSec };
  });

  // Sync stats — use startsWith for index-friendly query instead of contains (full table scan)
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
  const [totalSynced, todaySynced] = await Promise.all([
    prisma.grainTruck.count({ where: { remarks: { startsWith: 'WB:' } } }),
    prisma.grainTruck.count({
      where: {
        remarks: { startsWith: 'WB:' },
        date: { gte: todayStart },
      },
    }),
  ]);

  // Include OPC bridge PC
  const opcHB = getOPCHeartbeat();
  if (opcHB) {
    const opcReceivedAt = new Date(opcHB.receivedAt).getTime();
    const opcAlive = now - opcReceivedAt < staleMs;
    pcs.push({
      pcId: 'opc-bridge',
      pcName: 'Lab Computer (OPC)',
      timestamp: opcHB.timestamp,
      receivedAt: opcHB.receivedAt.toISOString(),
      isAlive: opcAlive,
      lastSeenSec: Math.round((now - opcReceivedAt) / 1000),
      uptimeSeconds: opcHB.uptimeSeconds,
      queueDepth: opcHB.queueDepth,
      dbSizeMb: opcHB.dbSizeMb,
      serialConnected: opcHB.opcConnected,
      serialProtocol: 'OPC-UA',
      webPort: 8099,
      tailscaleIp: '100.74.209.72',
      version: opcHB.version,
      system: opcHB.system ? {
        cpuPercent: opcHB.system.cpuPercent,
        memoryMb: opcHB.system.memoryMb,
        diskFreeGb: opcHB.system.diskFreeGb,
        hostname: undefined,
        os: undefined,
      } : undefined,
    } as unknown as typeof pcs[0]);
  }

  res.json({
    pcs,
    totalPCs: pcs.length,
    alivePCs: pcs.filter(p => p.isAlive).length,
    totalSynced,
    todaySynced,
  });
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

// ==========================================================================
//  FACTORY USER MANAGEMENT — proxy to factory server via Tailscale
// ==========================================================================

const FACTORY_SERVER_URL = process.env.FACTORY_SERVER_URL || 'http://100.126.101.7:5000';

// GET /factory-users — list all factory users
router.get('/factory-users', asyncHandler(async (req: AuthRequest, res: Response) => {
  try {
    const token = await getFactoryAdminToken();
    if (!token) { res.json([]); return; }
    const resp = await fetch(`${FACTORY_SERVER_URL}/api/auth/users`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (resp.ok) { res.json(await resp.json()); }
    else { res.json([]); }
  } catch { res.json([]); }
}));

// POST /factory-users — create factory user
router.post('/factory-users', asyncHandler(async (req: AuthRequest, res: Response) => {
  try {
    const token = await getFactoryAdminToken();
    if (!token) { res.status(503).json({ error: 'Factory server unreachable' }); return; }
    const resp = await fetch(`${FACTORY_SERVER_URL}/api/auth/users`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch { res.status(503).json({ error: 'Factory server unreachable' }); }
}));

// PUT /factory-users/:id — update factory user
router.put('/factory-users/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  try {
    const token = await getFactoryAdminToken();
    if (!token) { res.status(503).json({ error: 'Factory server unreachable' }); return; }
    const resp = await fetch(`${FACTORY_SERVER_URL}/api/auth/users/${req.params.id}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch { res.status(503).json({ error: 'Factory server unreachable' }); }
}));

// PUT /factory-users/:id/password — reset password
router.put('/factory-users/:id/password', asyncHandler(async (req: AuthRequest, res: Response) => {
  try {
    const token = await getFactoryAdminToken();
    if (!token) { res.status(503).json({ error: 'Factory server unreachable' }); return; }
    const resp = await fetch(`${FACTORY_SERVER_URL}/api/auth/users/${req.params.id}/password`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch { res.status(503).json({ error: 'Factory server unreachable' }); }
}));

// Helper: get admin JWT from factory server
let _factoryToken: string | null = null;
let _factoryTokenExpiry = 0;
async function getFactoryAdminToken(): Promise<string | null> {
  if (_factoryToken && Date.now() < _factoryTokenExpiry) return _factoryToken;
  try {
    const resp = await fetch(`${FACTORY_SERVER_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
    if (resp.ok) {
      const data = await resp.json() as { token: string };
      _factoryToken = data.token;
      _factoryTokenExpiry = Date.now() + 24 * 60 * 60 * 1000; // 24h
      return _factoryToken;
    }
  } catch { /* factory server unreachable */ }
  return null;
}

export default router;
