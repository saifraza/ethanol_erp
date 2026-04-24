import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const ambig = ['mts', 'MT', 'gm', 'ml', 'sft', 'sft.', 'ROW'];
  for (const u of ambig) {
    const rows = await prisma.inventoryItem.findMany({
      where: { unit: u, currentStock: { gt: 0 } },
      select: { name: true, currentStock: true, unit: true, subCategory: true },
      take: 10,
    });
    if (rows.length === 0) continue;
    console.log(`\n=== unit "${u}" ===`);
    for (const r of rows) console.log(`  ${r.name.slice(0,60).padEnd(60)} stock=${r.currentStock}  sub=${r.subCategory ?? ''}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
