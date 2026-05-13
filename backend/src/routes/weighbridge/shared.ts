import { Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import prisma from '../../config/prisma';
import { onStockMovement } from '../../services/autoJournal';

// ==========================================================================
//  AUTH — timing-safe weighbridge push key check
// ==========================================================================

const WB_PUSH_KEY = process.env.WB_PUSH_KEY || 'mspil-wb-2026';

export function checkWBKey(req: Request, res: Response): boolean {
  const key = req.headers['x-wb-key'] as string;
  if (!key || key.length !== WB_PUSH_KEY.length) {
    res.status(401).json({ error: 'Invalid weighbridge push key' });
    return false;
  }
  const keyBuf = Buffer.from(key, 'utf8');
  const expectedBuf = Buffer.from(WB_PUSH_KEY, 'utf8');
  if (!crypto.timingSafeEqual(keyBuf, expectedBuf)) {
    res.status(401).json({ error: 'Invalid weighbridge push key' });
    return false;
  }
  return true;
}

// ==========================================================================
//  SCHEMA — incoming weighment payload from factory server
// ==========================================================================

export const weighmentSchema = z.object({
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
  purchase_type: z.enum(['PO', 'SPOT', 'TRADER', 'OUTBOUND', 'JOB_WORK']).optional().default('PO'),
  po_id: z.string().nullable().optional(),
  po_line_id: z.string().nullable().optional(),
  supplier_id: z.string().nullable().optional(),
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
  lab_status: z.string().optional(),
  lab_moisture: z.number().nullable().optional(),
  lab_starch: z.number().nullable().optional(),
  lab_damaged: z.number().nullable().optional(),
  lab_foreign_matter: z.number().nullable().optional(),
  lab_remarks: z.string().nullable().optional(),
  cloud_gate_pass_id: z.string().nullable().optional(),
  // DDGS outbound: cloud DDGSContract UUID picked at gate entry. When set, the
  // DDGS handler binds the truck to this contract directly instead of
  // re-resolving by buyer name (which can race against contract edits).
  cloud_contract_id: z.string().nullable().optional(),
  quantity_bl: z.number().nullable().optional(),
  ethanol_strength: z.number().nullable().optional(),
  seal_no: z.string().nullable().optional(),
  rst_no: z.string().nullable().optional(),
  driver_license: z.string().nullable().optional(),
  peso_date: z.string().nullable().optional(),
  material_category: z.string().nullable().optional(),
  handler_key: z.string().nullable().optional(), // Stage 2: explicit handler override from InventoryItem.handlerKey
  division: z.string().nullable().optional(), // Stage 2: SUGAR | POWER | ETHANOL | COMMON
  // Multi-company tenancy
  company_id: z.string().nullable().optional(),
  company_code: z.string().nullable().optional(),
  // Ship-To (outbound only; when omitted, Bill-To == Ship-To)
  ship_to_customer_id: z.string().nullable().optional(),
  ship_to_name: z.string().nullable().optional(),
  ship_to_gstin: z.string().nullable().optional(),
  ship_to_address: z.string().nullable().optional(),
  ship_to_state: z.string().nullable().optional(),
  ship_to_pincode: z.string().nullable().optional(),
});

export type WeighmentInput = z.infer<typeof weighmentSchema>;

// ==========================================================================
//  HANDLER CONTRACT — types for dispatcher and handlers
// ==========================================================================

export interface PushResultEntry {
  id: string;
  type: string;
  refNo: string;
  sourceWbId: string;
}

export interface PushOutcome {
  ids: string[];
  results: PushResultEntry[];
}

export interface PushContext {
  wbRef: string;          // "WB:{id} | Ticket #{n} | {source}"
  wbUidRst: string;       // "WB-{ticket_no}"
  isFuel: boolean;
  materialCategory: string | undefined;
  purchaseType: string;
}

export type PushHandler = (w: WeighmentInput, ctx: PushContext) => Promise<PushOutcome>;

export function buildContext(w: WeighmentInput): PushContext {
  const materialCategory = w.material_category || (w.remarks?.includes('| FUEL |') ? 'FUEL' : undefined);
  return {
    wbRef: `WB:${w.id} | Ticket #${w.ticket_no} | ${w.weight_source}`,
    wbUidRst: `WB-${w.ticket_no}`,
    isFuel: materialCategory === 'FUEL',
    materialCategory,
    purchaseType: w.purchase_type || 'PO',
  };
}

export function emptyOutcome(): PushOutcome {
  return { ids: [], results: [] };
}

// ==========================================================================
//  UNIT CONVERSION — KG → MT/QUINTAL
// ==========================================================================

export function convertToUnit(netKg: number, unit: string | null | undefined): number {
  const u = (unit || 'KG').toUpperCase();
  switch (u) {
    case 'MT': return netKg / 1000;
    case 'QUINTAL':
    case 'QTL': return netKg / 100;
    default: return netKg;
  }
}

// ==========================================================================
//  DEDUP — check if a weighment was already processed across all tables
// ==========================================================================

/**
 * Check if a COMPLETE weighment has already been processed by any handler.
 * Does NOT check GrainTruck — that's handled separately in pre-phase
 * because GrainTruck stubs may need fall-through to PO/SPOT/TRADER.
 */
export async function checkWbDuplicate(w: WeighmentInput): Promise<{ id: string } | null> {
  const wbMarker = `WB:${w.id}`;

  const dupDP = await prisma.directPurchase.findFirst({
    where: { remarks: { contains: wbMarker } },
    select: { id: true },
  });
  if (dupDP) return dupDP;

  // CRITICAL: exclude partial-state stubs (GATE_IN / TARE_WEIGHED). Those are
  // pre-phase placeholders awaiting promotion by the COMPLETE handler — they
  // are NOT "already processed" duplicates. Without this filter, the COMPLETE
  // weighment dedup-skips the stub and the truck never gets billed.
  // (See pre-phase.ts createOrUpdateDdgsTruckStub.)
  const dupDDGS = await prisma.dDGSDispatchTruck.findFirst({
    where: {
      remarks: { contains: wbMarker },
      status: { notIn: ['GATE_IN', 'TARE_WEIGHED'] },
    },
    select: { id: true },
  });
  if (dupDDGS) return dupDDGS;

  const dupSugar = await prisma.sugarDispatchTruck.findFirst({
    where: {
      remarks: { contains: wbMarker },
      status: { notIn: ['GATE_IN', 'TARE_WEIGHED'] },
    },
    select: { id: true },
  });
  if (dupSugar) return dupSugar;

  // Shipment stubs (scrap outbound pre-phase) — exclude partial states
  const dupShipment = await prisma.shipment.findFirst({
    where: {
      remarks: { contains: wbMarker },
      status: { notIn: ['GATE_IN', 'TARE_WEIGHED'] },
    },
    select: { id: true },
  });
  if (dupShipment) return dupShipment;

  const dupGRN = await prisma.goodsReceipt.findFirst({
    where: { remarks: { contains: wbMarker } },
    select: { id: true },
  });
  if (dupGRN) return dupGRN;

  return null;
}

// ==========================================================================
//  INVENTORY SYNC — reused by PO and TRADER handlers
// ==========================================================================

/**
 * Why this function records its own failures as PlantIssues:
 *
 * 2026-04-18 → 2026-05-06: a 17-day silent outage where this function
 * was failing for 82% of weighbridge GRNs. The handler calling site used
 * `try { syncToInventory(...) } catch (e) { console.error(...) }`, so
 * errors only ever reached Railway logs — which nobody monitors. Result:
 * 440 GRNs (₹3.11 cr) confirmed but never updating inventory. The 2026-05-13
 * audit caught it; the system never did.
 *
 * From now on every failure path here writes a HIGH PlantIssue so the
 * orphan-GRN watchdog + integrity audit dashboard can surface it within
 * 10 minutes. The handler still catches the throw so a single bad GRN
 * doesn't break the rest of the push batch.
 */
async function logSyncFailure(reason: string, ctx: { refType: string; refId: string; refNo: string; itemId: string; qty: number; movementType: string }): Promise<void> {
  try {
    await prisma.plantIssue.create({
      data: {
        title: `Inventory sync failed: ${ctx.refNo} (${ctx.movementType})`,
        description: [
          `syncToInventory aborted before stock movement was written.`,
          ``,
          `Reason: ${reason}`,
          `Ref: ${ctx.refType} ${ctx.refId} (${ctx.refNo})`,
          `Item ID: ${ctx.itemId}`,
          `Qty: ${ctx.qty} (${ctx.movementType})`,
          ``,
          `Inventory level was NOT updated. The orphan-GRN watchdog should pick this up within 10 min and either retry or surface it on /admin/integrity.`,
        ].join('\n'),
        issueType: 'OTHER',
        severity: 'HIGH',
        equipment: 'Weighbridge / Inventory Sync',
        location: 'Cloud ERP',
        status: 'OPEN',
        reportedBy: 'system-sync-to-inventory',
        userId: 'system-sync-to-inventory',
      },
    });
  } catch {
    // PlantIssue create failing too means the DB is in deep trouble — nothing
    // useful we can do here. Don't mask the original error to the caller.
  }
}

export async function syncToInventory(
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
  const ctx = { refType, refId, refNo, itemId, qty, movementType };

  const defaultWh = await prisma.warehouse.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!defaultWh) {
    await logSyncFailure('No active warehouse — `Warehouse.isActive=true` returned no rows.', ctx);
    return;
  }

  const totalValue = Math.round(qty * costRate * 100) / 100;

  try {
    await prisma.$transaction(async (tx) => {
    // NF-6 FIX: Read invItem INSIDE transaction for concurrency-safe avgCost
    const invItem = await tx.inventoryItem.findUnique({
      where: { id: itemId },
      select: { id: true, name: true, unit: true, currentStock: true, avgCost: true },
    });
    if (!invItem) {
      // Throw so we land in the outer catch and log a PlantIssue. Returning
      // silently is what hid 440 receipts in April. The throw also rolls back
      // the transaction (idempotent — nothing has been written yet here).
      throw new Error(`InventoryItem ${itemId} not found`);
    }

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

    onStockMovement(prisma as Parameters<typeof onStockMovement>[0], {
      id: movement.id,
      movementNo: movement.movementNo,
      movementType: movement.movementType,
      direction: movement.direction,
      totalValue: movement.totalValue,
      itemName: invItem.name,
      userId,
      date: movement.date,
    }).catch(async (err: unknown) => {
      // Stock moved successfully but the auto-journal hook failed. Stock is
      // correct; the accounting journal is not. Surface as PlantIssue so the
      // integrity audit catches the "StockMovement → no JournalEntry" class.
      await logSyncFailure(
        `Stock movement ${movement.movementNo} committed but onStockMovement (auto-journal) failed: ${(err as Error)?.message || err}`,
        { ...ctx, refNo: `SM-${movement.movementNo}` },
      ).catch(() => {});
    });
  });
  } catch (err) {
    await logSyncFailure(`Transaction failed: ${(err as Error)?.message || err}`, ctx);
    throw err; // Re-throw so handler still sees failure (and can decide to retry)
  }
}

// ==========================================================================
//  Re-export prisma for handlers
// ==========================================================================

export { prisma };
