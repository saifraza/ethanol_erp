// Normalize InventoryItem.unit values to canonical lowercase forms.
// Safe to re-run.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MAPPING: Record<string, string> = {
  Nos: 'nos',
  NOS: 'nos',
  pcs: 'nos',
  PCS: 'nos',
  kgs: 'kg',
  KGS: 'kg',
  Kg: 'kg',
  litr: 'ltr',
  LTR: 'ltr',
  pr: 'pair',
  PR: 'pair',
  bot: 'bottle',
  bundl: 'bundle',
  BUNDL: 'bundle',
  MT: 'mt',
  mts: 'mt',
  MTS: 'mt',
  'sft.': 'sft',
  SFT: 'sft',
  Ft: 'ft',
  FT: 'ft',
};

async function main() {
  console.log('[normalize] Unit mapping:');
  for (const [from, to] of Object.entries(MAPPING)) console.log(`  "${from}" → "${to}"`);

  let total = 0;
  for (const [from, to] of Object.entries(MAPPING)) {
    const res = await prisma.inventoryItem.updateMany({
      where: { unit: from },
      data: { unit: to },
    });
    if (res.count > 0) {
      console.log(`  ${from.padEnd(8)} → ${to.padEnd(8)}  updated ${res.count}`);
      total += res.count;
    }
  }
  console.log(`[normalize] Done. Total rows updated: ${total}`);

  // Print final unit distribution
  const rows = await prisma.inventoryItem.groupBy({
    by: ['unit'],
    _count: { _all: true },
    orderBy: { _count: { unit: 'desc' } },
  });
  console.log('\nFinal unit distribution:');
  for (const r of rows) console.log(`  ${r.unit.padEnd(10)}  ${r._count._all}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
