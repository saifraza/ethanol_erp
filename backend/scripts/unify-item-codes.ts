// Rename ITM-IMP-NNNNN codes to numeric-style codes that match the existing
// old-ERP pattern (~9-digit numeric strings). Uses a safe "990000000+" base
// so they sort after existing codes and don't collide.
//
// Run:  cd backend && npx tsx scripts/unify-item-codes.ts [--dry-run]

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const dry = process.argv.includes('--dry-run');

  const bad = await prisma.inventoryItem.findMany({
    where: { code: { startsWith: 'ITM-IMP-' } },
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' },
  });
  console.log(`Found ${bad.length} items with ITM-IMP-* codes`);
  if (bad.length === 0) return;

  // Find the highest existing numeric code so we don't collide
  const all = await prisma.inventoryItem.findMany({ select: { code: true } });
  let maxNumericCode = 990000000; // safe base — after all 9-digit legacy codes
  for (const { code } of all) {
    if (/^\d{9,}$/.test(code)) {
      const n = parseInt(code, 10);
      if (!isNaN(n) && n > maxNumericCode) maxNumericCode = n;
    }
  }
  console.log(`Starting from ${maxNumericCode + 1}`);

  // Show some before / after pairs
  console.log('\nSample renames:');
  for (let i = 0; i < Math.min(5, bad.length); i++) {
    const newCode = String(maxNumericCode + i + 1);
    console.log(`  ${bad[i].code}  →  ${newCode}   (${bad[i].name.slice(0, 60)})`);
  }
  if (dry) { console.log('\n[dry-run] no writes. Re-run without --dry-run to apply.'); return; }

  let renamed = 0;
  for (let i = 0; i < bad.length; i++) {
    const newCode = String(maxNumericCode + i + 1);
    await prisma.inventoryItem.update({ where: { id: bad[i].id }, data: { code: newCode } });
    renamed++;
    if (renamed % 50 === 0) process.stdout.write(`\r  renamed ${renamed}/${bad.length}`);
  }
  console.log(`\nDone. Renamed ${renamed} items.`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
