/**
 * One-off fix: link corn/maize InventoryItems to HSN 10059000 (0% unbranded)
 * so PO lookup pulls the master rate instead of the stale 5% cache.
 *
 *   cd backend
 *   npx ts-node scripts/fix_corn_gst_link.ts --dry-run
 *   npx ts-node scripts/fix_corn_gst_link.ts
 *
 * Assumes Phase 1 seed has run (HSN 10059000 exists).
 */
import prisma from '../src/config/prisma';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(DRY_RUN ? '[fix-corn] DRY RUN — no writes' : '[fix-corn] LIVE');

  // 1. Find the HSN 10059000 master row
  const hsn = await prisma.hsnCode.findUnique({
    where: { code: '10059000' },
    include: { rates: { orderBy: { effectiveFrom: 'desc' }, take: 3 } },
  });
  if (!hsn) {
    console.error('HSN 10059000 not found. Run the tax seed first.');
    process.exit(1);
  }
  const currentRate = hsn.rates[0];
  console.log(`HSN ${hsn.code} → ${hsn.description}`);
  console.log(`  rate: ${currentRate.cgst + currentRate.sgst}% (${currentRate.conditionNote || 'no condition'})`);

  // 2. Find all maize/corn InventoryItems
  const items = await prisma.inventoryItem.findMany({
    where: {
      OR: [
        { name: { contains: 'maize', mode: 'insensitive' } },
        { name: { contains: 'corn', mode: 'insensitive' } },
      ],
      isActive: true,
    },
    select: { id: true, code: true, name: true, hsnCode: true, hsnCodeId: true, gstPercent: true, category: true },
  });

  if (items.length === 0) {
    console.log('No corn/maize InventoryItems found.');
    return;
  }

  console.log(`\nFound ${items.length} corn/maize item(s):`);
  for (const i of items) {
    console.log(`  - ${i.code} | ${i.name} | cat=${i.category} | hsnCode="${i.hsnCode}" | hsnCodeId=${i.hsnCodeId ?? '(null)'} | gstPercent=${i.gstPercent}%`);
  }

  // 3. Target: hsnCode="10059000", hsnCodeId=<master id>, gstPercent=0
  const toFix = items.filter(
    (i) => i.hsnCodeId !== hsn.id || i.hsnCode !== '10059000' || i.gstPercent !== 0,
  );
  if (toFix.length === 0) {
    console.log('\nAll corn items already linked correctly. Nothing to do.');
    return;
  }

  console.log(`\nWill update ${toFix.length} item(s):`);
  for (const i of toFix) {
    console.log(`  - ${i.name}: hsnCode "${i.hsnCode}" → "10059000", gstPercent ${i.gstPercent}% → 0%, hsnCodeId ${i.hsnCodeId ?? 'null'} → ${hsn.id}`);
  }

  if (!DRY_RUN) {
    const updated = await prisma.inventoryItem.updateMany({
      where: { id: { in: toFix.map((i) => i.id) } },
      data: { hsnCodeId: hsn.id, hsnCode: '10059000', gstPercent: 0 },
    });
    console.log(`\nUpdated: ${updated.count} row(s).`);
  }

  // 4. Report: any OPEN POs that still have corn at 5% — those need re-save to refresh
  const draftLines = await prisma.pOLine.findMany({
    where: {
      inventoryItemId: { in: items.map((i) => i.id) },
      po: { status: { in: ['DRAFT', 'APPROVED', 'SENT', 'PARTIAL_RECEIVED'] } },
    },
    select: {
      id: true, gstPercent: true,
      po: { select: { poNo: true, status: true } },
    },
    take: 50,
  });
  if (draftLines.length > 0) {
    const stale = draftLines.filter((l) => l.gstPercent !== 0);
    if (stale.length > 0) {
      console.log(`\n⚠ ${stale.length} open PO line(s) still have corn at non-zero GST:`);
      for (const l of stale) {
        console.log(`  - PO #${l.po.poNo} (${l.po.status}) — line GST ${l.gstPercent}%`);
      }
      console.log('Open each PO and re-save to refresh the GST from master, or leave as-is for history.');
    } else {
      console.log(`\nAll ${draftLines.length} open PO line(s) for corn are already at 0%. Clean.`);
    }
  }

  console.log('\nDone.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
