import { Router, Response, Request } from 'express';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
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

  const totalValue = Math.round(qty * costRate * 100) / 100;

  await prisma.$transaction(async (tx) => {
    // NF-6 FIX: Read invItem INSIDE transaction for concurrency-safe avgCost
    const invItem = await tx.inventoryItem.findUnique({
      where: { id: itemId },
      select: { id: true, name: true, unit: true, currentStock: true, avgCost: true },
    });
    if (!invItem) return;

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
  purchase_type: z.enum(['PO', 'SPOT', 'TRADER', 'OUTBOUND', 'JOB_WORK']).optional().default('PO'),
  po_id: z.string().nullable().optional(),
  po_line_id: z.string().nullable().optional(),
  supplier_id: z.string().nullable().optional(),
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
  driver_name: z.string().nullable().optional(),
  customer_name: z.string().nullable().optional(),
  // Lab quality fields
  lab_status: z.string().optional(),
  lab_moisture: z.number().nullable().optional(),
  lab_starch: z.number().nullable().optional(),
  lab_damaged: z.number().nullable().optional(),
  lab_foreign_matter: z.number().nullable().optional(),
  lab_remarks: z.string().nullable().optional(),
  // Ethanol outbound fields
  cloud_gate_pass_id: z.string().nullable().optional(),
  quantity_bl: z.number().nullable().optional(),
  ethanol_strength: z.number().nullable().optional(),
  seal_no: z.string().nullable().optional(),
  rst_no: z.string().nullable().optional(),
  driver_license: z.string().nullable().optional(),
  peso_date: z.string().nullable().optional(),
  material_category: z.string().nullable().optional(),
});

router.post('/push', asyncHandler(async (req: Request, res: Response) => {
  if (!checkWBKey(req, res)) return;

  const { weighments } = req.body;
  if (!Array.isArray(weighments) || weighments.length === 0) {
    return res.status(400).json({ error: 'No weighments provided' });
  }

  const ids: string[] = [];
  const results: Array<{ id: string; type: string; refNo: string; sourceWbId?: string }> = [];

  for (const raw of weighments) {
    let w;
    try {
    w = weighmentSchema.parse(raw);
    } catch (e) {
      console.error(`[WB-PUSH] Schema parse error for ${raw?.id}:`, e instanceof Error ? e.message : e);
      continue;
    }
    try {
    // Lab join key — set on every GrainTruck so lab can find it via uidRst
    const wbUidRst = `WB-${w.ticket_no}`;
    const materialCategory = w.material_category || (w.remarks?.includes('| FUEL |') ? 'FUEL' : undefined);

    // Skip fuel weighments — they don't belong in GrainTruck (RM Management)
    if (materialCategory === 'FUEL') {
      results.push({ id: w.id, type: 'SKIPPED', refNo: `FUEL-${w.vehicle_no}`, sourceWbId: w.id });
      ids.push(w.id);
      continue;
    }

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
            uidRst: wbUidRst,
            vehicleNo: w.vehicle_no,
            supplier: w.supplier_name || '',
            weightGross: grossTon,
            weightTare: tareTon,
            weightNet: netTon,
            moisture: w.lab_moisture ?? undefined,
            starchPercent: w.lab_starch ?? undefined,
            damagedPercent: w.lab_damaged ?? undefined,
            foreignMatter: w.lab_foreign_matter ?? undefined,
            quarantine: w.lab_status === 'FAIL' ? true : w.lab_status === 'PASS' ? false : undefined,
            quarantineWeight: w.lab_status === 'FAIL' ? netTon : w.lab_status === 'PASS' ? 0 : undefined,
            quarantineReason: w.lab_status === 'FAIL' ? (w.lab_remarks || 'Failed lab test') : w.lab_status === 'PASS' ? '' : undefined,
            bags: w.bags || undefined,
            remarks: `WB:${w.id} | Ticket #${w.ticket_no} | ${w.status} | ${w.remarks || ''}`.trim(),
            vehicleType: w.vehicle_type || undefined,
            driverName: w.driver_name || undefined,
            driverMobile: w.driver_mobile || undefined,
            transporterName: w.transporter || undefined,
            materialType: w.material || undefined,
            ticketNo: w.ticket_no || undefined,
          },
        });
        results.push({ id: truck.id, type: 'GrainTruck', refNo: `PENDING-${truck.id.slice(0, 8)}`, sourceWbId: w.id });
        ids.push(truck.id);
      } else {
        // Update existing record with latest data (lab result, weights)
        await prisma.grainTruck.update({
          where: { id: dupGrain.id },
          data: {
            weightGross: (w.weight_gross || 0) / 1000 || undefined,
            weightTare: (w.weight_tare || 0) / 1000 || undefined,
            weightNet: (w.weight_net || 0) / 1000 || undefined,
            moisture: w.lab_moisture ?? undefined,
            starchPercent: w.lab_starch ?? undefined,
            damagedPercent: w.lab_damaged ?? undefined,
            foreignMatter: w.lab_foreign_matter ?? undefined,
            quarantine: w.lab_status === 'FAIL' ? true : w.lab_status === 'PASS' ? false : undefined,
            quarantineWeight: w.lab_status === 'FAIL' ? (w.weight_net || 0) / 1000 : w.lab_status === 'PASS' ? 0 : undefined,
            quarantineReason: w.lab_status === 'FAIL' ? (w.lab_remarks || 'Failed lab test') : w.lab_status === 'PASS' ? '' : undefined,
            remarks: `WB:${w.id} | Ticket #${w.ticket_no} | ${w.status} | ${w.remarks || ''}`.trim(),
            vehicleType: w.vehicle_type || undefined,
            driverName: w.driver_name || undefined,
            driverMobile: w.driver_mobile || undefined,
            transporterName: w.transporter || undefined,
            materialType: w.material || undefined,
            ticketNo: w.ticket_no || undefined,
            supplier: w.supplier_name || undefined,
          },
        });
        results.push({ id: dupGrain.id, type: 'GrainTruck', refNo: `UPDATED-${dupGrain.id.slice(0, 8)}`, sourceWbId: w.id });
        ids.push(dupGrain.id);
      }
      continue;
    }

    if (w.status !== 'COMPLETE' || !w.weight_net || !w.weight_gross || !w.weight_tare) {
      continue;
    }

    // Determine purchase type early (needed for dupGrain fall-through logic)
    const wbRef = `WB:${w.id} | Ticket #${w.ticket_no} | ${w.weight_source}`;
    const purchaseType = w.purchase_type || 'PO';

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
            moisture: w.lab_moisture ?? w.moisture ?? undefined,
            starchPercent: w.lab_starch ?? undefined,
            damagedPercent: w.lab_damaged ?? undefined,
            foreignMatter: w.lab_foreign_matter ?? undefined,
            quarantine: w.lab_status === 'FAIL' ? true : w.lab_status === 'PASS' ? false : undefined,
            quarantineWeight: w.lab_status === 'FAIL' ? netTon : w.lab_status === 'PASS' ? 0 : undefined,
            quarantineReason: w.lab_status === 'FAIL' ? (w.lab_remarks || 'Failed lab test') : w.lab_status === 'PASS' ? '' : undefined,
            remarks: `WB:${w.id} | Ticket #${w.ticket_no} | COMPLETE | ${w.remarks || ''}`.trim(),
          },
        });
        results.push({ id: dupGrain.id, type: 'GrainTruck', refNo: `UPDATED-${dupGrain.id.slice(0, 8)}`, sourceWbId: w.id });
      }
      ids.push(dupGrain.id);

      // NF-1 FIX: Only skip downstream if there's no PO/SPOT work to do.
      // Previously, this always `continue`d — blocking GRN creation for weighments
      // whose GATE_ENTRY was synced first and created a GrainTruck stub.
      // The dupGRN/dupDP/dupDDGS checks below prevent double-creation.
      const hasPOWork = w.po_id && (purchaseType === 'PO' || purchaseType === 'JOB_WORK');
      const hasSPOTWork = purchaseType === 'SPOT';
      const hasTRADERWork = purchaseType === 'TRADER' && w.supplier_id;
      if (!hasPOWork && !hasSPOTWork && !hasTRADERWork) {
        continue; // No downstream work needed — true duplicate
      }
      // Fall through to PO/SPOT/TRADER branches
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

    // ── INBOUND + PO → Auto-create GRN (PASS) or quarantine GrainTruck (FAIL) ──
    if (w.direction === 'IN' && (purchaseType === 'PO' || purchaseType === 'JOB_WORK') && w.po_id) {
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
        // NF-4 FIX: Check truck cap for FIXED TRUCKS deals
        if (po.truckCap) {
          const grnCount = await prisma.goodsReceipt.count({ where: { poId: po.id } });
          if (grnCount >= po.truckCap) {
            results.push({ id: w.id, type: 'SKIPPED', refNo: `PO-${po.poNo} truck cap (${po.truckCap}) reached`, sourceWbId: w.id });
            continue;
          }
        }
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

          // Overage tolerance: check if this delivery pushes total received beyond PO qty + 5%
          // Works for both exhausted POs (pendingQty<=0) AND mid-PO deliveries that exceed
          const newTotalReceived = poLine.receivedQty + receivedQty;
          const overageQty = newTotalReceived - poLine.quantity;
          const overagePercent = poLine.quantity > 0 ? (overageQty / poLine.quantity) * 100 : (newTotalReceived > 0 ? 100 : 0);
          let needsApproval = false;

          if (overageQty > 0) {
            if (overagePercent <= 5) {
              // Within 5% tolerance — auto-allow, proceed to create GRN
            } else {
              // Exceeds 5% — allow weighment but flag for admin approval
              needsApproval = true;
            }
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
                uidRst: wbUidRst,
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
                poId: po.id,
                materialId: poLine.inventoryItemId || undefined,
                vehicleType: w.vehicle_type || undefined,
                driverName: w.driver_name || undefined,
                driverMobile: w.driver_mobile || undefined,
                transporterName: w.transporter || undefined,
                materialType: w.material || undefined,
                ticketNo: w.ticket_no || undefined,
              },
            });

            results.push({ id: truck.id, type: 'QUARANTINE', refNo: `PO-${po.poNo} | Vehicle ${w.vehicle_no}`, sourceWbId: w.id });
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
                  remarks: `${wbRef} | Auto-GRN from weighbridge${labRemarksSuffix} | Auto-confirmed (weighbridge verified)`,
                  totalAmount: Math.round(receivedQty * rate * 100) / 100,
                  totalQty: receivedQty,
                  status: 'CONFIRMED', // Weighbridge-verified = physically weighed, auto-approve
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
                  uidRst: wbUidRst,
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
                  poId: po.id,
                  grnId: grn.id,
                  materialId: poLine.inventoryItemId || undefined,
                  vehicleType: w.vehicle_type || undefined,
                  driverName: w.driver_name || undefined,
                  driverMobile: w.driver_mobile || undefined,
                  transporterName: w.transporter || undefined,
                  materialType: w.material || undefined,
                  ticketNo: w.ticket_no || undefined,
                },
              }).catch(() => {}); // best-effort — GRN is the primary record
            }

            // GRN is now auto-CONFIRMED (weighbridge verified) — sync inventory
            if (poLine.inventoryItemId) {
              try {
                await syncToInventory(
                  'GRN', grn.id, `GRN-${grn.grnNo}`,
                  poLine.inventoryItemId, receivedQty, rate,
                  'IN', 'GRN_RECEIPT',
                  `Auto-GRN from weighbridge: ${w.vehicle_no} | Auto-confirmed`,
                  'system-weighbridge',
                );
              } catch (invErr) {
                console.error(`[WB] Inventory sync failed for GRN-${grn.grnNo}: ${invErr}`);
              }
            }

            // Create approval record if overage exceeds 5%
            if (needsApproval) {
              await prisma.approval.create({
                data: {
                  type: 'PO_OVERAGE',
                  status: 'PENDING',
                  entityType: 'GoodsReceipt',
                  entityId: grn.id,
                  title: `PO-${po.poNo} overage ${overagePercent.toFixed(1)}%`,
                  description: `Vehicle ${w.vehicle_no} delivered ${receivedQty.toFixed(2)} ${poLine.unit} against PO-${po.poNo} (ordered ${poLine.quantity} ${poLine.unit}). Overage: ${overageQty.toFixed(2)} ${poLine.unit} (${overagePercent.toFixed(1)}%). GRN-${grn.grnNo} created as DRAFT for admin review.`,
                  requestedBy: 'system-weighbridge',
                  metadata: { poNo: po.poNo, grnNo: grn.grnNo, orderedQty: poLine.quantity, receivedQty, overageQty: Math.round(overageQty * 100) / 100, overagePercent: Math.round(overagePercent * 10) / 10, vehicleNo: w.vehicle_no },
                },
              }).catch(() => {}); // best-effort
            }

            results.push({ id: grn.id, type: needsApproval ? 'GRN_NEEDS_APPROVAL' : 'GRN', refNo: `GRN-${grn.grnNo}`, sourceWbId: w.id });
            ids.push(grn.id);
            continue;
          }
        }
      }
      // P1-2: PO is cancelled/closed/not receivable — skip entirely, don't create GrainTruck
      if (!po) {
        results.push({ id: w.id, type: 'SKIPPED', refNo: `PO ${w.po_id} not found`, sourceWbId: w.id });
      } else {
        results.push({ id: w.id, type: 'SKIPPED', refNo: `PO-${po.poNo} not receivable (status=${po.status})`, sourceWbId: w.id });
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

      results.push({ id: dp.id, type: 'DirectPurchase', refNo: `DP-${dp.entryNo}`, sourceWbId: w.id });
      ids.push(dp.id);
      continue;
    }

    // ── INBOUND + TRADER → Running PO: find-or-create monthly PO, add delivery as line ──
    if (w.direction === 'IN' && purchaseType === 'TRADER' && w.supplier_id) {
      const netKg = w.weight_net || 0;
      const rate = w.rate || 0;
      const materialName = w.material || 'Unknown';

      // Validate rate and material
      if (!rate || rate <= 0) {
        results.push({ id: w.id, type: 'SKIPPED', refNo: `Trader weighment missing rate`, sourceWbId: w.id });
        continue;
      }
      if (!materialName || materialName === 'Unknown') {
        results.push({ id: w.id, type: 'SKIPPED', refNo: `Trader weighment missing material`, sourceWbId: w.id });
        continue;
      }

      // Find the trader's vendor record and enforce isAgent
      const trader = await prisma.vendor.findUnique({
        where: { id: w.supplier_id },
        select: { id: true, name: true, isAgent: true },
      });
      if (!trader || !trader.isAgent) {
        results.push({ id: w.id, type: 'SKIPPED', refNo: `Trader ${w.supplier_id} not found or not an agent`, sourceWbId: w.id });
        continue;
      }

      // Find matching inventory item by name
      const invItem = await prisma.inventoryItem.findFirst({
        where: { name: { equals: materialName, mode: 'insensitive' }, isActive: true },
        select: { id: true, name: true, unit: true, hsnCode: true, gstPercent: true },
      });

      // Convert KG to item's unit + convert rate from ₹/KG to ₹/unit
      const unit = invItem?.unit?.toUpperCase() || 'KG';
      let receivedQty: number;
      let unitRate: number; // rate in item's unit (e.g., ₹/MT if item is MT)
      switch (unit) {
        case 'MT': receivedQty = netKg / 1000; unitRate = rate * 1000; break;
        case 'QUINTAL': case 'QTL': receivedQty = netKg / 100; unitRate = rate * 100; break;
        default: receivedQty = netKg; unitRate = rate; break; // KG stays as-is
      }

      // Calculate totals for this delivery
      const lineAmount = Math.round(receivedQty * unitRate * 100) / 100;
      const gstPct = invItem?.gstPercent ?? 0;
      const gstAmount = Math.round(lineAmount * gstPct / 100 * 100) / 100;
      const cgst = Math.round(gstAmount / 2 * 100) / 100;
      const sgst = Math.round(gstAmount / 2 * 100) / 100;
      const lineGrandTotal = Math.round((lineAmount + gstAmount) * 100) / 100;

      // ── Running PO: find existing open PO for this trader+material this month ──
      const now = new Date();
      const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

      // Auto-close any stale running POs from previous months
      await prisma.purchaseOrder.updateMany({
        where: {
          vendorId: trader.id,
          dealType: 'OPEN',
          status: { in: ['APPROVED', 'PARTIAL_RECEIVED'] },
          poDate: { lt: firstOfMonth },
        },
        data: { status: 'RECEIVED' },
      });

      // Find active running PO for this trader this month (ONE PO per trader per month, all materials)
      const existingPO = await prisma.purchaseOrder.findFirst({
        where: {
          vendorId: trader.id,
          dealType: 'OPEN',
          status: { in: ['APPROVED', 'PARTIAL_RECEIVED'] },
          poDate: { gte: firstOfMonth },
        },
        orderBy: { poDate: 'desc' },
        include: { lines: { select: { id: true, lineNo: true } } },
      });

      const { po, grn, poLine } = await prisma.$transaction(async (tx) => {
        let po: { id: string; poNo: number; lines: { id: string; lineNo: number }[] };
        let newLineNo: number;

        if (existingPO) {
          // ── Add delivery line to existing running PO ──
          // Read lineNo inside transaction to avoid race with concurrent trucks
          const maxLine = await tx.pOLine.findFirst({
            where: { poId: existingPO.id },
            orderBy: { lineNo: 'desc' },
            select: { lineNo: true },
          });
          newLineNo = (maxLine?.lineNo ?? 0) + 1;

          const poLine = await tx.pOLine.create({
            data: {
              poId: existingPO.id,
              lineNo: newLineNo,
              inventoryItemId: invItem?.id || null,
              description: `${materialName} | ${w.vehicle_no || 'N/A'}`,
              hsnCode: invItem?.hsnCode || '',
              quantity: receivedQty,
              unit: invItem?.unit || 'KG',
              rate: unitRate,
              amount: lineAmount,
              pendingQty: 0,
              receivedQty,
              gstPercent: gstPct,
              cgstAmount: cgst,
              sgstAmount: sgst,
              taxableAmount: lineAmount,
              lineTotal: lineGrandTotal,
            },
          });

          // Update PO totals (add this delivery's amounts)
          await tx.purchaseOrder.update({
            where: { id: existingPO.id },
            data: {
              subtotal: { increment: lineAmount },
              totalCgst: { increment: cgst },
              totalSgst: { increment: sgst },
              totalGst: { increment: gstAmount },
              grandTotal: { increment: lineGrandTotal },
              status: 'PARTIAL_RECEIVED',
              remarks: `Running PO | ${existingPO.lines.length + 1} deliveries | ${trader.name}`,
            },
          });

          po = { id: existingPO.id, poNo: existingPO.poNo, lines: [...existingPO.lines, { id: poLine.id, lineNo: newLineNo }] };

          // Create GRN for this delivery
          const grn = await tx.goodsReceipt.create({
            data: {
              poId: existingPO.id,
              vendorId: trader.id,
              grnDate: new Date(),
              vehicleNo: w.vehicle_no,
              totalQty: receivedQty,
              totalAmount: lineAmount,
              status: 'CONFIRMED',
              remarks: `${wbRef} | Trader: ${trader.name} | Running PO-${existingPO.poNo} | Auto-confirmed (weighbridge verified)`,
              userId: 'system-weighbridge',
              lines: {
                create: [{
                  poLineId: poLine.id,
                  inventoryItemId: invItem?.id || null,
                  description: `${materialName} | ${w.vehicle_no || 'N/A'}`,
                  receivedQty,
                  acceptedQty: receivedQty,
                  rejectedQty: 0,
                  unit: invItem?.unit || 'KG',
                  rate: unitRate,
                  amount: lineAmount,
                }],
              },
            },
          });

          return { po, grn, poLine };
        } else {
          // ── Create new running PO for this trader+material ──
          const newPo = await tx.purchaseOrder.create({
            data: {
              vendorId: trader.id,
              dealType: 'OPEN',
              status: 'PARTIAL_RECEIVED',
              poDate: new Date(),
              paymentTerms: 'ADVANCE',
              subtotal: lineAmount,
              totalCgst: cgst,
              totalSgst: sgst,
              totalGst: gstAmount,
              grandTotal: lineGrandTotal,
              remarks: `Running PO | 1 delivery | ${trader.name}`,
              userId: 'system-weighbridge',
              lines: {
                create: [{
                  lineNo: 1,
                  inventoryItemId: invItem?.id || null,
                  description: `${materialName} | ${w.vehicle_no || 'N/A'}`,
                  hsnCode: invItem?.hsnCode || '',
                  quantity: receivedQty,
                  unit: invItem?.unit || 'KG',
                  rate: unitRate,
                  amount: lineAmount,
                  pendingQty: 0,
                  receivedQty,
                  gstPercent: gstPct,
                  cgstAmount: cgst,
                  sgstAmount: sgst,
                  taxableAmount: lineAmount,
                  lineTotal: lineGrandTotal,
                }],
              },
            },
            include: { lines: { select: { id: true, lineNo: true } } },
          });

          const grn = await tx.goodsReceipt.create({
            data: {
              poId: newPo.id,
              vendorId: trader.id,
              grnDate: new Date(),
              vehicleNo: w.vehicle_no,
              totalQty: receivedQty,
              totalAmount: lineAmount,
              status: 'CONFIRMED',
              remarks: `${wbRef} | Trader: ${trader.name} | Running PO-${newPo.poNo} | Auto-confirmed (weighbridge verified)`,
              userId: 'system-weighbridge',
              lines: {
                create: [{
                  poLineId: newPo.lines[0].id,
                  inventoryItemId: invItem?.id || null,
                  description: `${materialName} | ${w.vehicle_no || 'N/A'}`,
                  receivedQty,
                  acceptedQty: receivedQty,
                  rejectedQty: 0,
                  unit: invItem?.unit || 'KG',
                  rate: unitRate,
                  amount: lineAmount,
                }],
              },
            },
          });

          return { po: newPo, grn, poLine: newPo.lines[0] };
        }
      });

      // Sync inventory (stock posts immediately for confirmed GRN)
      if (invItem?.id) {
        try {
          await syncToInventory(
            'GRN', grn.id, `GRN-${grn.grnNo}`,
            invItem.id, receivedQty, unitRate,
            'IN', 'GRN_RECEIPT',
            `Auto-GRN from trader weighbridge: ${w.vehicle_no} | ${trader.name} | Running PO-${po.poNo}`,
            'system-weighbridge',
          );
        } catch (invErr) {
          console.error(`[TRADER] Inventory sync failed for GRN-${grn.grnNo}: ${invErr}`);
        }
      }

      results.push({ id: grn.id, type: 'TRADER_GRN', refNo: `GRN-${grn.grnNo} | Running PO-${po.poNo}`, sourceWbId: w.id });
      ids.push(grn.id);
      continue;
    }

    // ── OUTBOUND → Route to Ethanol or DDGS handler ──
    if (w.direction === 'OUT') {
      const grossKg = w.weight_gross || 0;
      const tareKg = w.weight_tare || 0;
      const netKg = w.weight_net || 0;
      const netMT = netKg / 1000;
      const partyName = w.customer_name || w.supplier_name || '';
      const dateVal = w.created_at ? new Date(w.created_at) : new Date();
      const gateInVal = w.first_weight_at ? new Date(w.first_weight_at) : dateVal;
      const tareTimeVal = w.first_weight_at ? new Date(w.first_weight_at) : undefined;
      const grossTimeVal = w.second_weight_at ? new Date(w.second_weight_at) : undefined;

      // ── ETHANOL outbound → Update existing DispatchTruck on cloud ──
      // Only trust cloud_gate_pass_id if it looks like a UUID (prevents accidental routing)
      const hasValidGatePassId = w.cloud_gate_pass_id && /^[0-9a-f-]{36}$/i.test(w.cloud_gate_pass_id);
      const isEthanol = (w.material || '').toLowerCase().includes('ethanol') || !!hasValidGatePassId;
      if (isEthanol) {
        const ethResult = await prisma.$transaction(async (tx) => {
          // Find DispatchTruck: prefer cloudGatePassId, fallback to sourceWbId, then vehicleNo
          let dispatchTruck = hasValidGatePassId
            ? await tx.dispatchTruck.findUnique({ where: { id: w.cloud_gate_pass_id! } })
            : null;

          if (!dispatchTruck) {
            dispatchTruck = await tx.dispatchTruck.findFirst({ where: { sourceWbId: w.id } });
          }

          if (!dispatchTruck) {
            const todayStart = new Date(dateVal);
            todayStart.setUTCHours(0, 0, 0, 0);
            const todayEnd = new Date(dateVal);
            todayEnd.setUTCHours(23, 59, 59, 999);
            dispatchTruck = await tx.dispatchTruck.findFirst({
              where: {
                vehicleNo: w.vehicle_no.toUpperCase(),
                date: { gte: todayStart, lte: todayEnd },
                status: { in: ['GATE_IN', 'TARE_WEIGHED'] },
              },
              orderBy: { createdAt: 'desc' },
            });
          }

          // No existing DispatchTruck — auto-create from factory gate entry
          if (!dispatchTruck) {
            const newTruck = await tx.dispatchTruck.create({
              data: {
                date: dateVal,
                vehicleNo: w.vehicle_no.toUpperCase(),
                partyName: partyName,
                destination: '',
                driverName: w.driver_name || null,
                driverPhone: w.driver_mobile || null,
                transporterName: w.transporter || null,
                status: 'GATE_IN',
                gateInTime: gateInVal,
                sourceWbId: w.id,
                userId: 'factory-server',
              },
            });
            // If we have weights, update them
            if (grossKg > 0 && tareKg > 0) {
              await tx.dispatchTruck.update({
                where: { id: newTruck.id },
                data: {
                  weightTare: tareKg,
                  weightGross: grossKg,
                  weightNet: grossKg - tareKg,
                  tareTime: tareTimeVal,
                  grossTime: grossTimeVal,
                  status: 'GROSS_WEIGHED',
                  ...(w.quantity_bl != null ? { quantityBL: w.quantity_bl } : {}),
                  ...(w.ethanol_strength != null ? { strength: w.ethanol_strength } : {}),
                  ...(w.seal_no ? { sealNo: w.seal_no } : {}),
                },
              });
            }
            return { skipped: false, id: newTruck.id };
          }

          // Guard: never overwrite a RELEASED or already GROSS_WEIGHED truck
          if (dispatchTruck.status === 'RELEASED') return { skipped: true, id: dispatchTruck.id };
          if (dispatchTruck.status === 'GROSS_WEIGHED' && dispatchTruck.sourceWbId === w.id) {
            return { skipped: false, id: dispatchTruck.id }; // idempotent re-sync
          }

          // Calculate KL from BL and amount from contract rate
          const bl = w.quantity_bl || dispatchTruck.quantityBL || 0;
          const kl = bl > 0 ? bl / 1000 : 0;
          let productRate: number | null = null;
          let productValue: number | null = null;
          if (dispatchTruck.contractId && bl > 0) {
            const contract = await tx.ethanolContract.findUnique({ where: { id: dispatchTruck.contractId }, select: { contractType: true, ethanolRate: true, conversionRate: true } });
            if (contract) {
              // Product rate is for delivery challan/e-way bill (actual product value)
              // For JOB_WORK: use fixed ethanol value (71.86/L), not the job work conversion rate
              productRate = contract.contractType === 'JOB_WORK' ? 71.86 : (contract.ethanolRate || null);
              productValue = productRate && bl > 0 ? Math.round(bl * productRate) : null;
            }
          }

          // Atomic update with status guard
          const updated = await tx.dispatchTruck.updateMany({
            where: { id: dispatchTruck.id, status: { in: ['GATE_IN', 'TARE_WEIGHED', 'GROSS_WEIGHED'] }, NOT: { status: 'RELEASED' } },
            data: {
              weightTare: tareKg,
              weightGross: grossKg,
              weightNet: grossKg - tareKg,
              tareTime: tareTimeVal,
              grossTime: grossTimeVal,
              status: 'GROSS_WEIGHED',
              sourceWbId: w.id,
              ...(bl > 0 ? { quantityBL: bl, quantityKL: kl } : {}),
              ...(w.ethanol_strength != null ? { strength: w.ethanol_strength } : {}),
              ...(w.seal_no ? { sealNo: w.seal_no } : {}),
              ...(w.rst_no ? { rstNo: w.rst_no } : {}),
              ...(w.driver_license ? { driverLicense: w.driver_license } : {}),
              ...(w.peso_date ? { pesoDate: w.peso_date } : {}),
              ...(productRate != null ? { productRatePerLtr: productRate } : {}),
              ...(productValue != null ? { productValue } : {}),
            },
          });
          return updated.count > 0 ? { skipped: false, id: dispatchTruck.id } : { skipped: true, id: dispatchTruck.id };
        });

        if (ethResult && !ethResult.skipped) {
          results.push({ id: ethResult.id, type: 'EthanolDispatch', refNo: ethResult.id, sourceWbId: w.id });
          ids.push(ethResult.id);
        } else if (!ethResult) {
          // No matching DispatchTruck — do NOT mark as synced so it retries
          console.warn(`[WB-PUSH] Ethanol outbound for ${w.vehicle_no} — no DispatchTruck found, will retry`);
          results.push({ id: w.id, type: 'EthanolDispatch_SKIPPED', refNo: w.vehicle_no, sourceWbId: w.id });
          // NOT pushing to ids[] — syncWorker won't mark this as synced
        } else {
          // Skipped (already released or already synced)
          results.push({ id: ethResult.id, type: 'EthanolDispatch', refNo: ethResult.id, sourceWbId: w.id });
          ids.push(ethResult.id);
        }
        continue;
      }

      // ── DDGS / Other outbound → Upsert DDGSDispatchTruck + Shipment ──
      const txResult = await prisma.$transaction(async (tx) => {
        // 1. Find or create DDGSDispatchTruck by sourceWbId
        const existingDispatch = await tx.dDGSDispatchTruck.findFirst({ where: { sourceWbId: w.id } });
        const dispatch = existingDispatch
          ? await tx.dDGSDispatchTruck.update({
              where: { id: existingDispatch.id },
              data: { weightGross: grossKg, weightTare: tareKg, weightNet: netMT, status: 'GROSS_WEIGHED', grossTime: grossTimeVal },
            })
          : await tx.dDGSDispatchTruck.create({
              data: {
                sourceWbId: w.id, date: dateVal, vehicleNo: w.vehicle_no, partyName,
                driverName: w.driver_name || null, driverMobile: w.driver_mobile || null,
                transporterName: w.transporter || null,
                weightGross: grossKg, weightTare: tareKg, weightNet: netMT,
                bags: w.bags || 0, status: 'GROSS_WEIGHED',
                gateInTime: gateInVal, tareTime: tareTimeVal, grossTime: grossTimeVal,
                remarks: `${wbRef} | ${w.remarks || ''}`.trim(),
              },
            });

        // 2. Find or create Shipment by sourceWbId
        const existingShipment = await tx.shipment.findFirst({ where: { sourceWbId: w.id } });
        const shipment = existingShipment
          ? await tx.shipment.update({
              where: { id: existingShipment.id },
              data: { weightTare: tareKg, weightGross: grossKg, weightNet: netKg, status: 'GROSS_WEIGHED', grossTime: grossTimeVal ? grossTimeVal.toISOString() : undefined },
            })
          : await tx.shipment.create({
              data: {
                sourceWbId: w.id, productName: w.material || 'DDGS', customerName: partyName,
                vehicleNo: w.vehicle_no, driverName: w.driver_name || null, driverMobile: w.driver_mobile || null,
                transporterName: w.transporter || null, vehicleType: w.vehicle_type || null,
                weightTare: tareKg, weightGross: grossKg, weightNet: netKg,
                bags: w.bags || null, status: 'GROSS_WEIGHED',
                gateInTime: gateInVal.toISOString(), tareTime: tareTimeVal ? tareTimeVal.toISOString() : null,
                grossTime: grossTimeVal ? grossTimeVal.toISOString() : null,
                paymentStatus: 'NOT_REQUIRED', remarks: `WB:${w.id}`,
              },
            });

        return { dispatch, shipment };
      });

      results.push({ id: txResult.dispatch.id, type: 'DDGSDispatch', refNo: txResult.dispatch.id, sourceWbId: w.id });
      ids.push(txResult.dispatch.id);
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
          uidRst: wbUidRst,
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
          vehicleType: w.vehicle_type || undefined,
          driverName: w.driver_name || undefined,
          driverMobile: w.driver_mobile || undefined,
          transporterName: w.transporter || undefined,
          materialType: w.material || undefined,
          ticketNo: w.ticket_no || undefined,
        },
      });

      results.push({ id: truck.id, type: isQuarantine ? 'QUARANTINE' : 'GrainTruck', refNo: truck.id, sourceWbId: w.id });
      ids.push(truck.id);
    }
    } catch (e) {
      console.error(`[WB-PUSH] Error processing weighment ${w.id} (${w.vehicle_no}):`, e instanceof Error ? e.message : e);
      // Continue processing remaining weighments — don't fail the whole batch
    }
  }

  // NF-7 FIX: Return per-item processed IDs so factory sync worker can mark individually
  const processedWbIds = results.map((r: any) => r.sourceWbId).filter(Boolean);
  res.json({ ok: true, ids, results, count: ids.length, processedWbIds });
}));


// ==========================================================================
//  PUT /weighment/:wbId — update a previously pushed weighment
//  Called by factory PC when operator corrects weight, vehicle no, etc.
// ==========================================================================

const updateWeighmentSchema = z.object({
  vehicle_no: z.string().optional(),
  supplier_name: z.string().optional(),
  material: z.string().optional(),
  weight_first: z.number().nullable().optional(),
  weight_second: z.number().nullable().optional(),
  weight_gross: z.number().nullable().optional(),
  weight_tare: z.number().nullable().optional(),
  weight_net: z.number().nullable().optional(),
  weight_source: z.string().optional(),
  status: z.string().optional(),
  moisture: z.number().nullable().optional(),
  bags: z.number().nullable().optional(),
  remarks: z.string().nullable().optional(),
  first_weight_at: z.string().nullable().optional(),
  second_weight_at: z.string().nullable().optional(),
  // Lab quality fields
  lab_status: z.string().optional(),
  lab_moisture: z.number().nullable().optional(),
  lab_starch: z.number().nullable().optional(),
  lab_damaged: z.number().nullable().optional(),
  lab_foreign_matter: z.number().nullable().optional(),
  lab_remarks: z.string().nullable().optional(),
  // Spot purchase fields
  rate: z.number().nullable().optional(),
  deductions: z.number().nullable().optional(),
  deduction_reason: z.string().nullable().optional(),
  seller_phone: z.string().nullable().optional(),
  seller_village: z.string().nullable().optional(),
  seller_aadhaar: z.string().nullable().optional(),
  payment_mode: z.string().nullable().optional(),
  payment_ref: z.string().nullable().optional(),
});

router.put('/weighment/:wbId', asyncHandler(async (req: Request, res: Response) => {
  if (!checkWBKey(req, res)) return;

  const { wbId } = req.params;
  const updates = updateWeighmentSchema.parse(req.body);
  const wbMarker = `WB:${wbId}`;

  // Search across all tables that /push creates records in
  const [grainTruck, directPurchase, ddgsDispatch, goodsReceipt] = await Promise.all([
    prisma.grainTruck.findFirst({
      where: { remarks: { contains: wbMarker } },
      select: { id: true, remarks: true, weightNet: true },
    }),
    prisma.directPurchase.findFirst({
      where: { remarks: { contains: wbMarker } },
      select: { id: true, remarks: true },
    }),
    prisma.dDGSDispatchTruck.findFirst({
      where: { remarks: { contains: wbMarker } },
      select: { id: true, remarks: true },
    }),
    prisma.goodsReceipt.findFirst({
      where: { remarks: { contains: wbMarker } },
      select: { id: true, remarks: true, poId: true, lines: { select: { id: true, poLineId: true, receivedQty: true, rate: true, unit: true } } },
    }),
  ]);

  if (!grainTruck && !directPurchase && !ddgsDispatch && !goodsReceipt) {
    return res.status(404).json({ error: `No cloud record found for weighment ${wbId}` });
  }

  const results: Array<{ table: string; id: string; updated: boolean }> = [];

  // ── Update GrainTruck ──
  if (grainTruck) {
    const grossTon = updates.weight_gross != null ? updates.weight_gross / 1000 : undefined;
    const tareTon = updates.weight_tare != null ? updates.weight_tare / 1000 : undefined;
    const netTon = updates.weight_net != null ? updates.weight_net / 1000 : undefined;
    const isQuarantine = updates.lab_status === 'FAIL';

    await prisma.grainTruck.update({
      where: { id: grainTruck.id },
      data: {
        ...(updates.vehicle_no && { vehicleNo: updates.vehicle_no }),
        ...(updates.supplier_name && { supplier: updates.supplier_name }),
        ...(grossTon !== undefined && { weightGross: grossTon }),
        ...(tareTon !== undefined && { weightTare: tareTon }),
        ...(netTon !== undefined && { weightNet: netTon }),
        // Lab moisture takes precedence over raw moisture; skip if both undefined
        ...(updates.lab_moisture !== undefined
          ? { moisture: updates.lab_moisture }
          : updates.moisture !== undefined ? { moisture: updates.moisture } : {}),
        ...(updates.lab_starch !== undefined && { starchPercent: updates.lab_starch }),
        ...(updates.lab_damaged !== undefined && { damagedPercent: updates.lab_damaged }),
        ...(updates.lab_foreign_matter !== undefined && { foreignMatter: updates.lab_foreign_matter }),
        ...(updates.bags !== undefined && { bags: updates.bags }),
        // BUG-1 fix: explicitly clear quarantine fields when lab passes
        ...(updates.lab_status && {
          quarantine: isQuarantine,
          quarantineWeight: isQuarantine && netTon ? netTon : 0,
          quarantineReason: isQuarantine ? (updates.lab_remarks || 'Failed lab test') : '',
        }),
      },
    });
    results.push({ table: 'GrainTruck', id: grainTruck.id, updated: true });
  }

  // ── Update DirectPurchase ──
  if (directPurchase) {
    const netKg = updates.weight_net;
    const rate = updates.rate;
    // Recalc amount if weight or rate changed
    const dpUpdate: Record<string, unknown> = {};
    if (updates.vehicle_no) dpUpdate.vehicleNo = updates.vehicle_no;
    if (updates.supplier_name) dpUpdate.sellerName = updates.supplier_name;
    if (updates.seller_phone !== undefined) dpUpdate.sellerPhone = updates.seller_phone || '';
    if (updates.seller_village !== undefined) dpUpdate.sellerVillage = updates.seller_village || '';
    if (updates.seller_aadhaar !== undefined) dpUpdate.sellerAadhaar = updates.seller_aadhaar || '';
    if (updates.material) dpUpdate.materialName = updates.material;
    if (netKg != null) {
      dpUpdate.quantity = netKg;
      dpUpdate.netWeight = netKg;
    }
    if (updates.weight_gross != null) dpUpdate.grossWeight = updates.weight_gross;
    if (updates.weight_tare != null) dpUpdate.tareWeight = updates.weight_tare;
    if (rate != null) dpUpdate.rate = rate;
    if (updates.payment_mode) dpUpdate.paymentMode = updates.payment_mode;
    if (updates.payment_ref !== undefined) dpUpdate.paymentRef = updates.payment_ref || '';
    if (updates.deductions != null) dpUpdate.deductions = updates.deductions;
    if (updates.deduction_reason !== undefined) dpUpdate.deductionReason = updates.deduction_reason || '';

    // Recalculate amount if weight or rate changed — fetch current values for partial updates
    if (netKg != null || rate != null || updates.deductions != null) {
      const current = await prisma.directPurchase.findUnique({
        where: { id: directPurchase.id },
        select: { quantity: true, rate: true, deductions: true },
      });
      if (current) {
        const finalQty = netKg ?? current.quantity;
        const finalRate = rate ?? current.rate;
        const finalDeductions = updates.deductions ?? current.deductions;
        const amount = Math.round(finalQty * finalRate * 100) / 100;
        dpUpdate.amount = amount;
        dpUpdate.netPayable = Math.round((amount - finalDeductions) * 100) / 100;
      }
    }

    if (Object.keys(dpUpdate).length > 0) {
      await prisma.directPurchase.update({
        where: { id: directPurchase.id },
        data: dpUpdate,
      });
    }
    results.push({ table: 'DirectPurchase', id: directPurchase.id, updated: Object.keys(dpUpdate).length > 0 });
  }

  // ── Update DDGSDispatchTruck ──
  if (ddgsDispatch) {
    const ddgsUpdate: Record<string, unknown> = {};
    if (updates.vehicle_no) ddgsUpdate.vehicleNo = updates.vehicle_no;
    if (updates.supplier_name) ddgsUpdate.partyName = updates.supplier_name;
    if (updates.weight_gross != null) ddgsUpdate.weightGross = updates.weight_gross;
    if (updates.weight_tare != null) ddgsUpdate.weightTare = updates.weight_tare;
    if (updates.weight_net != null) ddgsUpdate.weightNet = updates.weight_net / 1000; // stored as MT
    if (updates.bags != null) ddgsUpdate.bags = updates.bags;

    if (Object.keys(ddgsUpdate).length > 0) {
      await prisma.dDGSDispatchTruck.update({
        where: { id: ddgsDispatch.id },
        data: ddgsUpdate,
      });
    }
    results.push({ table: 'DDGSDispatchTruck', id: ddgsDispatch.id, updated: Object.keys(ddgsUpdate).length > 0 });
  }

  // ── Update GoodsReceipt (GRN) — recalc amounts, update PO line ──
  if (goodsReceipt && goodsReceipt.lines.length > 0) {
    // MISSING-1 fix: reject if GRN has linked vendor invoice
    const linkedInvoice = await prisma.vendorInvoice.findFirst({
      where: { grnId: goodsReceipt.id },
      select: { id: true, invoiceNo: true },
    });
    if (linkedInvoice) {
      return res.status(409).json({
        error: `Cannot update weights — GRN has linked vendor invoice #${linkedInvoice.invoiceNo}. Void the invoice first.`,
      });
    }

    const line = goodsReceipt.lines[0];
    const netKg = updates.weight_net;

    if (netKg != null && line.poLineId) {
      // Convert KG to PO unit
      const unit = line.unit?.toUpperCase() || 'KG';
      let newReceivedQty: number;
      switch (unit) {
        case 'MT': newReceivedQty = netKg / 1000; break;
        case 'QUINTAL': case 'QTL': newReceivedQty = netKg / 100; break;
        default: newReceivedQty = netKg; break;
      }
      const oldReceivedQty = line.receivedQty;
      const qtyDelta = newReceivedQty - oldReceivedQty;
      const rate = line.rate;
      const newAmount = Math.round(newReceivedQty * rate * 100) / 100;

      await prisma.$transaction(async (tx) => {
        // Update GRN line
        await tx.gRNLine.update({
          where: { id: line.id },
          data: {
            receivedQty: newReceivedQty,
            acceptedQty: newReceivedQty,
            amount: newAmount,
            ...(updates.vehicle_no && { remarks: `Vehicle: ${updates.vehicle_no}` }),
          },
        });

        // Update GRN total
        await tx.goodsReceipt.update({
          where: { id: goodsReceipt.id },
          data: {
            totalQty: newReceivedQty,
            totalAmount: newAmount,
            ...(updates.vehicle_no && { vehicleNo: updates.vehicle_no }),
          },
        });

        // RACE-3 fix: use atomic increment/decrement for PO line
        if (line.poLineId && qtyDelta !== 0) {
          await tx.pOLine.update({
            where: { id: line.poLineId },
            data: {
              receivedQty: { increment: qtyDelta },
              pendingQty: { decrement: qtyDelta },
            },
          });

          // ISSUE-3 fix: only update PO status if not CLOSED/CANCELLED/INVOICED
          if (goodsReceipt.poId) {
            const po = await tx.purchaseOrder.findUnique({
              where: { id: goodsReceipt.poId },
              select: { status: true },
            });
            const frozenStatuses = ['CLOSED', 'CANCELLED', 'INVOICED'];
            if (po && !frozenStatuses.includes(po.status)) {
              const allLines = await tx.pOLine.findMany({ where: { poId: goodsReceipt.poId } });
              const allDone = allLines.every(l => l.pendingQty <= 0);
              const anyPartial = allLines.some(l => l.receivedQty > 0 && l.pendingQty > 0);
              if (allDone) {
                await tx.purchaseOrder.update({ where: { id: goodsReceipt.poId }, data: { status: 'RECEIVED' } });
              } else if (anyPartial) {
                await tx.purchaseOrder.update({ where: { id: goodsReceipt.poId }, data: { status: 'PARTIAL_RECEIVED' } });
              }
            }
          }
        }
      });

      // Re-sync inventory if item was tracked
      const grnLine = await prisma.gRNLine.findUnique({
        where: { id: line.id },
        select: { inventoryItemId: true },
      });
      if (grnLine?.inventoryItemId && qtyDelta !== 0) {
        try {
          await syncToInventory(
            'GRN', goodsReceipt.id, `GRN-CORRECTION`,
            grnLine.inventoryItemId,
            Math.abs(qtyDelta),
            line.rate,
            qtyDelta > 0 ? 'IN' : 'OUT',
            'GRN_CORRECTION',
            `Weight correction for WB:${wbId} (delta: ${qtyDelta > 0 ? '+' : ''}${qtyDelta.toFixed(2)})`,
            'system-weighbridge',
          );
        } catch (_invErr) {
          // GRN is updated; inventory can be reconciled manually if sync fails
        }
      }
    }
    results.push({ table: 'GoodsReceipt', id: goodsReceipt.id, updated: netKg != null });
  }

  res.json({ ok: true, wbId, results });
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

// GET /factory-users — list all factory users (ERP admin only)
router.get('/factory-users', authenticate, authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

// POST /factory-users — create factory user (ERP admin only)
router.post('/factory-users', authenticate, authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

// PUT /factory-users/:id — update factory user (ERP admin only)
router.put('/factory-users/:id', authenticate, authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

// PUT /factory-users/:id/password — reset password (ERP admin only)
router.put('/factory-users/:id/password', authenticate, authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

// Helper: get admin JWT from factory server (credentials from env vars)
const FACTORY_ADMIN_USER = process.env.FACTORY_ADMIN_USER || 'admin';
const FACTORY_ADMIN_PASS = process.env.FACTORY_ADMIN_PASS;
let _factoryToken: string | null = null;
let _factoryTokenExpiry = 0;
async function getFactoryAdminToken(): Promise<string | null> {
  if (!FACTORY_ADMIN_PASS) return null; // refuse to use hardcoded password
  if (_factoryToken && Date.now() < _factoryTokenExpiry) return _factoryToken;
  try {
    const resp = await fetch(`${FACTORY_SERVER_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: FACTORY_ADMIN_USER, password: FACTORY_ADMIN_PASS }),
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
