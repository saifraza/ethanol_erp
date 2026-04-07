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
  quantity_bl: z.number().nullable().optional(),
  ethanol_strength: z.number().nullable().optional(),
  seal_no: z.string().nullable().optional(),
  rst_no: z.string().nullable().optional(),
  driver_license: z.string().nullable().optional(),
  peso_date: z.string().nullable().optional(),
  material_category: z.string().nullable().optional(),
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

  const dupDDGS = await prisma.dDGSDispatchTruck.findFirst({
    where: { remarks: { contains: wbMarker } },
    select: { id: true },
  });
  if (dupDDGS) return dupDDGS;

  const dupSugar = await prisma.sugarDispatchTruck.findFirst({
    where: { remarks: { contains: wbMarker } },
    select: { id: true },
  });
  if (dupSugar) return dupSugar;

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
    }).catch(() => {});
  });
}

// ==========================================================================
//  Re-export prisma for handlers
// ==========================================================================

export { prisma };
