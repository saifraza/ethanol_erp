// Bridge PF/Ferm dosing → chemical inventory. Each dosing call looks up the
// chemical by name in the InventoryItem master (category=CHEMICAL), and if a
// match exists, writes a StockMovement (PRODUCTION_ISSUE / OUT) and decrements
// currentStock. Misses are silent — operators sometimes type a chemical that
// isn't on the master yet, and we don't want dosing to fail because of that.

import type { PrismaClient } from '@prisma/client';

type ChemicalIssueParams = {
  chemicalName: string;
  quantity: number;
  unit?: string;
  source: 'PF_DOSING' | 'FERM_DOSING';
  refId: string; // dosing row id
  batchNo?: number | null;
  fermenterNo?: number | null;
  userId: string;
};

type ChemicalReverseParams = {
  source: 'PF_DOSING' | 'FERM_DOSING';
  refId: string;
  userId: string;
};

async function findChemicalItem(prisma: PrismaClient, chemicalName: string) {
  if (!chemicalName) return null;
  const name = chemicalName.trim();
  if (!name) return null;
  // Case-insensitive exact match first; fall back to a contains match for
  // operator typos like "Caustic" vs "Caustic Soda".
  let item = await prisma.inventoryItem.findFirst({
    where: { category: 'CHEMICAL', isActive: true, name: { equals: name, mode: 'insensitive' } },
    select: { id: true, name: true, unit: true, currentStock: true, avgCost: true },
  });
  if (!item) {
    item = await prisma.inventoryItem.findFirst({
      where: { category: 'CHEMICAL', isActive: true, name: { contains: name, mode: 'insensitive' } },
      select: { id: true, name: true, unit: true, currentStock: true, avgCost: true },
    });
  }
  return item;
}

async function defaultWarehouse(prisma: PrismaClient) {
  return prisma.warehouse.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
}

/**
 * Issue chemical from inventory for a dosing event. Best-effort:
 *  - if no matching InventoryItem exists, no-op (operator-friendly)
 *  - if quantity ≤ 0, no-op
 *  - errors are caught and logged so a dosing record never fails because of inventory
 */
export async function issueChemicalForDosing(
  prisma: PrismaClient,
  params: ChemicalIssueParams,
): Promise<void> {
  try {
    if (!params.quantity || params.quantity <= 0) return;
    const item = await findChemicalItem(prisma, params.chemicalName);
    if (!item) return;
    const wh = await defaultWarehouse(prisma);
    if (!wh) return;

    const qty = params.quantity;
    const costRate = item.avgCost || 0;
    const totalValue = Math.round(qty * costRate * 100) / 100;
    const refNoLabel = params.batchNo
      ? `B${params.batchNo}${params.fermenterNo ? `/F${params.fermenterNo}` : ''}`
      : params.refId.slice(0, 8);

    await prisma.$transaction(async (tx) => {
      await tx.stockMovement.create({
        data: {
          itemId: item.id,
          movementType: 'PRODUCTION_ISSUE',
          direction: 'OUT',
          quantity: qty,
          unit: params.unit || item.unit,
          costRate,
          totalValue,
          warehouseId: wh.id,
          refType: params.source,
          refId: params.refId,
          refNo: refNoLabel,
          narration: `${params.source === 'PF_DOSING' ? 'PF' : 'Fermentation'} dosing: ${item.name}`,
          userId: params.userId,
        },
      });

      // Decrement the master stock. Allow going negative — operators sometimes
      // log dosings before the GRN is recorded; we don't want to block them.
      await tx.inventoryItem.update({
        where: { id: item.id },
        data: {
          currentStock: { decrement: qty },
          totalValue: Math.round((item.currentStock - qty) * costRate * 100) / 100,
        },
      });
    });
  } catch (err) {
    // Never let an inventory side-effect break a dosing write.
    // eslint-disable-next-line no-console
    console.error('[chemicalDosingInventory] issue failed', err);
  }
}

/**
 * Reverse a dosing's inventory impact (used when a dosing row is deleted).
 * Looks up the StockMovement by refType+refId and writes a compensating IN.
 */
export async function reverseChemicalForDosing(
  prisma: PrismaClient,
  params: ChemicalReverseParams,
): Promise<void> {
  try {
    const original = await prisma.stockMovement.findFirst({
      where: { refType: params.source, refId: params.refId, direction: 'OUT' },
      orderBy: { createdAt: 'desc' },
    });
    if (!original) return;

    await prisma.$transaction(async (tx) => {
      await tx.stockMovement.create({
        data: {
          itemId: original.itemId,
          movementType: 'RETURN',
          direction: 'IN',
          quantity: original.quantity,
          unit: original.unit,
          costRate: original.costRate,
          totalValue: original.totalValue,
          warehouseId: original.warehouseId,
          refType: params.source,
          refId: params.refId,
          refNo: original.refNo ? `REV-${original.refNo}` : null,
          narration: `Reverse dosing ${original.movementNo}`,
          userId: params.userId,
        },
      });

      await tx.inventoryItem.update({
        where: { id: original.itemId },
        data: { currentStock: { increment: original.quantity } },
      });
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[chemicalDosingInventory] reverse failed', err);
  }
}

/**
 * Adjust an existing dosing's inventory impact when the operator edits the qty.
 * Issues the delta (or returns it back) so currentStock stays in sync.
 */
export async function adjustChemicalForDosing(
  prisma: PrismaClient,
  params: ChemicalReverseParams & { newQuantity: number; chemicalName: string; unit?: string },
): Promise<void> {
  try {
    const original = await prisma.stockMovement.findFirst({
      where: { refType: params.source, refId: params.refId, direction: 'OUT' },
      orderBy: { createdAt: 'desc' },
    });
    if (!original) {
      // No prior movement (maybe the chemical wasn't on master at create time).
      // Try to issue from scratch.
      await issueChemicalForDosing(prisma, {
        chemicalName: params.chemicalName,
        quantity: params.newQuantity,
        unit: params.unit,
        source: params.source,
        refId: params.refId,
        userId: params.userId,
      });
      return;
    }

    const delta = params.newQuantity - original.quantity;
    if (Math.abs(delta) < 1e-6) return;

    await prisma.$transaction(async (tx) => {
      await tx.stockMovement.create({
        data: {
          itemId: original.itemId,
          movementType: delta > 0 ? 'PRODUCTION_ISSUE' : 'RETURN',
          direction: delta > 0 ? 'OUT' : 'IN',
          quantity: Math.abs(delta),
          unit: original.unit,
          costRate: original.costRate,
          totalValue: Math.round(Math.abs(delta) * original.costRate * 100) / 100,
          warehouseId: original.warehouseId,
          refType: params.source,
          refId: params.refId,
          refNo: original.refNo ? `ADJ-${original.refNo}` : null,
          narration: `Adjust dosing ${original.movementNo} (${original.quantity} → ${params.newQuantity})`,
          userId: params.userId,
        },
      });

      await tx.inventoryItem.update({
        where: { id: original.itemId },
        data: { currentStock: delta > 0 ? { decrement: delta } : { increment: -delta } },
      });
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[chemicalDosingInventory] adjust failed', err);
  }
}
