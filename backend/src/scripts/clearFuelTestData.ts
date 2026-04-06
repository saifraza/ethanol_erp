/**
 * One-off script to clear all fuel test data for go-live.
 * Keeps: fuel master items (zeroes stock), vendors, warehouses.
 * Deletes: POs, GRNs, payments, consumption, stock movements, journals.
 *
 * Usage: cd backend && npx tsx src/scripts/clearFuelTestData.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== FUEL TEST DATA CLEANUP ===\n');

  // 1. Find all fuel items
  const fuelItems = await prisma.inventoryItem.findMany({
    where: { category: 'FUEL' },
    select: { id: true, name: true, currentStock: true },
  });
  const fuelItemIds = fuelItems.map(f => f.id);
  console.log(`Fuel items found: ${fuelItems.length}`);
  fuelItems.forEach(f => console.log(`  - ${f.name} (stock: ${f.currentStock})`));

  if (fuelItemIds.length === 0) {
    console.log('\nNo fuel items found. Nothing to clear.');
    return;
  }

  // 2. Find all fuel PO IDs (POs that have POLines referencing fuel items)
  const fuelPOLines = await prisma.pOLine.findMany({
    where: { inventoryItemId: { in: fuelItemIds } },
    select: { poId: true },
  });
  const fuelPOIds = [...new Set(fuelPOLines.map(l => l.poId))];
  console.log(`\nFuel POs: ${fuelPOIds.length}`);

  // 3. Find fuel vendor IDs (from those POs)
  const fuelPOs = await prisma.purchaseOrder.findMany({
    where: { id: { in: fuelPOIds } },
    select: { id: true, poNo: true, vendorId: true },
  });
  const fuelVendorIds = [...new Set(fuelPOs.map(p => p.vendorId))];
  const fuelPONos = fuelPOs.map(p => p.poNo);
  console.log(`Fuel vendors: ${fuelVendorIds.length}`);
  console.log(`Fuel PO numbers: ${fuelPONos.join(', ')}`);

  // 4. Find GRNs linked to fuel POs
  const fuelGRNs = await prisma.goodsReceipt.findMany({
    where: { poId: { in: fuelPOIds } },
    select: { id: true, grnNo: true },
  });
  const fuelGRNIds = fuelGRNs.map(g => g.id);
  console.log(`Fuel GRNs: ${fuelGRNs.length}`);

  // 5. Find auto-journal entries linked to fuel vendor payments
  const fuelPayments = await prisma.vendorPayment.findMany({
    where: {
      OR: [
        { vendorId: { in: fuelVendorIds } },
        { remarks: { contains: 'Fuel deal' } },
      ],
    },
    select: { id: true },
  });
  const fuelPaymentIds = fuelPayments.map(p => p.id);

  // Find journal entries referencing fuel payments
  const fuelJournals = await prisma.journalEntry.findMany({
    where: {
      refType: 'PAYMENT',
      refId: { in: fuelPaymentIds },
    },
    select: { id: true },
  });
  const fuelJournalIds = fuelJournals.map(j => j.id);

  // Pre-deletion counts
  const stockMovements = await prisma.stockMovement.count({ where: { itemId: { in: fuelItemIds } } });
  const fuelConsumption = await prisma.fuelConsumption.count({ where: { fuelItemId: { in: fuelItemIds } } });
  const stockLevels = await prisma.stockLevel.count({ where: { itemId: { in: fuelItemIds } } });

  console.log(`\n--- WILL DELETE ---`);
  console.log(`  JournalEntries (auto): ${fuelJournalIds.length}`);
  console.log(`  VendorPayments:        ${fuelPaymentIds.length}`);
  console.log(`  StockMovements:        ${stockMovements}`);
  console.log(`  FuelConsumption:       ${fuelConsumption}`);
  console.log(`  GRNLines:              (in ${fuelGRNIds.length} GRNs)`);
  console.log(`  GoodsReceipts:         ${fuelGRNs.length}`);
  console.log(`  POLines:               ${fuelPOLines.length}`);
  console.log(`  PurchaseOrders:        ${fuelPOIds.length}`);
  console.log(`  StockLevels:           ${stockLevels}`);
  console.log(`  InventoryItem reset:   ${fuelItems.length} items → stock=0`);

  // 6. Execute deletion sequentially (Railway DB too slow for interactive transaction)
  console.log(`\nExecuting deletion...`);

  // a) Auto-journal entries (JournalLine cascade-deletes)
  if (fuelJournalIds.length > 0) {
    const r = await prisma.journalEntry.deleteMany({ where: { id: { in: fuelJournalIds } } });
    console.log(`  Deleted ${r.count} journal entries`);
  }

  // b) Vendor payments
  if (fuelPaymentIds.length > 0) {
    const r = await prisma.vendorPayment.deleteMany({ where: { id: { in: fuelPaymentIds } } });
    console.log(`  Deleted ${r.count} vendor payments`);
  }

  // c) Stock movements for fuel items
  const smr = await prisma.stockMovement.deleteMany({ where: { itemId: { in: fuelItemIds } } });
  console.log(`  Deleted ${smr.count} stock movements`);

  // d) Fuel consumption
  const fcr = await prisma.fuelConsumption.deleteMany({ where: { fuelItemId: { in: fuelItemIds } } });
  console.log(`  Deleted ${fcr.count} fuel consumption entries`);

  // e) GRN lines for fuel items
  const glr = await prisma.gRNLine.deleteMany({ where: { inventoryItemId: { in: fuelItemIds } } });
  console.log(`  Deleted ${glr.count} GRN lines`);

  // f) GRNs linked to fuel POs
  if (fuelGRNIds.length > 0) {
    const gr = await prisma.goodsReceipt.deleteMany({ where: { id: { in: fuelGRNIds } } });
    console.log(`  Deleted ${gr.count} goods receipts`);
  }

  // g) PO lines for fuel items
  const plr = await prisma.pOLine.deleteMany({ where: { inventoryItemId: { in: fuelItemIds } } });
  console.log(`  Deleted ${plr.count} PO lines`);

  // h) Fuel POs
  if (fuelPOIds.length > 0) {
    const pr = await prisma.purchaseOrder.deleteMany({ where: { id: { in: fuelPOIds } } });
    console.log(`  Deleted ${pr.count} purchase orders`);
  }

  // i) Stock levels for fuel items
  const slr = await prisma.stockLevel.deleteMany({ where: { itemId: { in: fuelItemIds } } });
  console.log(`  Deleted ${slr.count} stock levels`);

  // j) Reset fuel item stock to 0
  const ur = await prisma.inventoryItem.updateMany({
    where: { id: { in: fuelItemIds } },
    data: { currentStock: 0, avgCost: 0, totalValue: 0 },
  });
  console.log(`  Reset ${ur.count} fuel items to stock=0`);

  console.log('\n=== DONE — All fuel test data cleared ===');
  console.log('Fuel master items preserved with stock = 0');
  console.log('Vendors preserved');
}

main()
  .catch(e => { console.error('FAILED:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
