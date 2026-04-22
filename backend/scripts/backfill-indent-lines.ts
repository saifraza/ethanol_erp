// Backfill PurchaseRequisitionLine table for indents created before multi-line support.
// For each PR that has zero lines, create a single line from the header fields.
// Idempotent.

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const prs = await prisma.purchaseRequisition.findMany({
    select: {
      id: true, reqNo: true, itemName: true, quantity: true, unit: true,
      estimatedCost: true, inventoryItemId: true,
      _count: { select: { lines: true } },
    },
  });
  const needsBackfill = prs.filter(p => p._count.lines === 0);
  console.log(`[backfill] Total PRs: ${prs.length}, already have lines: ${prs.length - needsBackfill.length}, need backfill: ${needsBackfill.length}`);

  let created = 0;
  for (const pr of needsBackfill) {
    await prisma.purchaseRequisitionLine.create({
      data: {
        requisitionId: pr.id,
        lineNo: 1,
        itemName: pr.itemName,
        quantity: pr.quantity,
        unit: pr.unit,
        estimatedCost: pr.estimatedCost,
        inventoryItemId: pr.inventoryItemId,
      },
    });
    created++;
    if (created % 50 === 0) process.stdout.write(`\r  backfilled ${created}/${needsBackfill.length}`);
  }
  console.log(`\n[backfill] Done. Created ${created} line rows.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
