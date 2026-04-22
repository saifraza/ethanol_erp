// Deletes ALL purchase requisitions (indents) and resets the reqNo sequence
// so the next indent starts at #1. Safe cascade — unlinks any POs first.
//
// Run:  cd backend && npx tsx scripts/wipe-indents.ts

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const before = await prisma.purchaseRequisition.findMany({
    select: { id: true, reqNo: true, itemName: true, status: true },
  });
  console.log(`Found ${before.length} indents:`);
  before.forEach(r => console.log(`  #${r.reqNo} [${r.status}] ${r.itemName}`));
  if (before.length === 0) { console.log('Nothing to delete'); return; }

  // Unlink any POs (set requisitionId = null) so we don't orphan them on cascade
  const linkedPOs = await prisma.purchaseOrder.findMany({
    where: { requisitionId: { in: before.map(r => r.id) } },
    select: { poNo: true, status: true },
  });
  if (linkedPOs.length > 0) {
    console.log(`Unlinking ${linkedPOs.length} PO(s) that reference these indents:`);
    linkedPOs.forEach(p => console.log(`  PO #${p.poNo} [${p.status}]`));
    await prisma.purchaseOrder.updateMany({
      where: { requisitionId: { in: before.map(r => r.id) } },
      data: { requisitionId: null },
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.purchaseRequisitionVendor.deleteMany({ where: { requisitionId: { in: before.map(r => r.id) } } });
    await tx.purchaseRequisitionLine.deleteMany({ where: { requisitionId: { in: before.map(r => r.id) } } });
    await tx.purchaseRequisition.deleteMany({ where: { id: { in: before.map(r => r.id) } } });
  });

  // Reset the reqNo autoincrement sequence so next indent starts at #1
  // Postgres names the sequence "<Table>_<column>_seq" — Prisma uses exactly this pattern
  await prisma.$executeRawUnsafe(`ALTER SEQUENCE "PurchaseRequisition_reqNo_seq" RESTART WITH 1`);
  console.log('Sequence reset — next indent will be #1');

  const after = await prisma.purchaseRequisition.count();
  console.log(`Deleted ${before.length}. Remaining: ${after}`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
