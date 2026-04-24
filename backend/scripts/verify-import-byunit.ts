import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const rows = await prisma.inventoryItem.groupBy({
    by: ['unit'],
    _count: { _all: true },
    _sum: { currentStock: true },
    where: { currentStock: { gt: 0 } },
    orderBy: { _count: { unit: 'desc' } },
  });
  console.log('Items with stock, grouped by unit:');
  for (const r of rows) {
    console.log(`  ${r.unit.padEnd(10)}  items=${String(r._count._all).padStart(5)}   stock=${(r._sum.currentStock || 0).toFixed(2)}`);
  }
  const totalItems = await prisma.inventoryItem.count();
  const withStock = await prisma.inventoryItem.count({ where: { currentStock: { gt: 0 } } });
  console.log(`\nTotal items in DB: ${totalItems}, with stock>0: ${withStock}`);
}
main().catch(e => {console.error(e); process.exit(1);}).finally(() => prisma.$disconnect());
