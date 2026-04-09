/**
 * One-off cleanup script:
 *  1. Merge RM-00005 "Rice Husk" → FUEL-003 "RICE HUSK" (transfer 20.4 MT, soft-delete RM-00005)
 *  2. Rename FUEL-003 to "Rice Husk", set gstPercent = 0
 *  3. Soft-delete ITM-00002 (HSD/DIESEL) and ITM-00003 (FURNACE OIL) from fuel category
 *  4. Hard-delete specified archived POs (skips any with GRNs or vendor invoices)
 *
 * Run:  cd backend && npx tsx scripts/cleanup_fuel_and_pos.ts
 */
import prisma from '../src/config/prisma';

const ARCHIVED_PO_NOS = [78, 47, 44, 43, 41];

async function mergeFuel() {
  console.log('\n=== FUEL MASTER CLEANUP ===');

  const target = await prisma.inventoryItem.findUnique({ where: { code: 'FUEL-003' } });
  const source = await prisma.inventoryItem.findUnique({ where: { code: 'RM-00005' } });

  if (!target) { console.log('  FUEL-003 not found, skipping merge'); return; }

  if (source) {
    const qty = source.currentStock || 0;
    console.log(`  Merging RM-00005 (${qty} MT) → FUEL-003 (${target.currentStock} MT)`);

    await prisma.$transaction(async (tx) => {
      // Transfer stock
      await tx.inventoryItem.update({
        where: { id: target.id },
        data: {
          currentStock: { increment: qty },
          totalValue: { increment: qty * (source.avgCost || 0) },
          name: 'Rice Husk',
          gstPercent: 0,
        },
      });
      await tx.inventoryItem.update({
        where: { id: source.id },
        data: { currentStock: 0, totalValue: 0, isActive: false },
      });
    });
    console.log('  ✓ Stock transferred, RM-00005 soft-deleted');
  } else {
    // Still apply name/gst fix on target
    await prisma.inventoryItem.update({
      where: { id: target.id },
      data: { name: 'Rice Husk', gstPercent: 0 },
    });
    console.log('  ✓ FUEL-003 renamed to "Rice Husk", gstPercent = 0');
  }

  // Soft-delete ITM items in fuel category
  const itmCodes = ['ITM-00002', 'ITM-00003'];
  for (const code of itmCodes) {
    const it = await prisma.inventoryItem.findUnique({ where: { code } });
    if (it && it.category === 'FUEL') {
      await prisma.inventoryItem.update({
        where: { id: it.id },
        data: { isActive: false },
      });
      console.log(`  ✓ ${code} (${it.name}) soft-deleted from fuel list`);
    }
  }
}

async function deletePOs() {
  console.log('\n=== PURCHASE ORDER DELETION ===');

  for (const poNo of ARCHIVED_PO_NOS) {
    const po = await prisma.purchaseOrder.findFirst({
      where: { poNo },
      include: {
        lines: true,
        _count: { select: { grns: true } },
      },
    });
    if (!po) { console.log(`  PO-${poNo}: not found`); continue; }

    // Check for vendor invoices separately (no cascade)
    const invoiceCount = await prisma.vendorInvoice.count({ where: { poId: po.id } });
    const grnCount = po._count.grns;

    if (grnCount > 0 || invoiceCount > 0) {
      console.log(`  PO-${poNo}: SKIPPED (has ${grnCount} GRNs, ${invoiceCount} invoices) — cannot hard-delete`);
      continue;
    }

    try {
      await prisma.$transaction([
        prisma.purchaseOrderLine.deleteMany({ where: { poId: po.id } }),
        prisma.purchaseOrder.delete({ where: { id: po.id } }),
      ]);
      console.log(`  ✓ PO-${poNo} deleted (${po.lines.length} lines removed)`);
    } catch (e: any) {
      console.log(`  PO-${poNo}: FAILED — ${e.message}`);
    }
  }
}

async function main() {
  await mergeFuel();
  await deletePOs();
  console.log('\nDone.');
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
