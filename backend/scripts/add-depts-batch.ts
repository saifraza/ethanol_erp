import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const sugar = await prisma.businessDivision.findFirst({ where: { name: 'Sugar' } });
  const depts = [
    { name: 'Mill House', code: 'SUG-MILL', divisionId: sugar?.id ?? null },
    { name: 'Boiling House', code: 'SUG-BOIL', divisionId: sugar?.id ?? null },
    { name: 'Sugar House', code: 'SUG-HOUSE', divisionId: sugar?.id ?? null },
    { name: 'ETP', code: 'ETP', divisionId: null }, // common / utilities
  ];
  let added = 0, skipped = 0;
  for (const d of depts) {
    const exists = await prisma.department.findFirst({ where: { name: d.name } });
    if (exists) {
      if (!exists.businessDivisionId && d.divisionId) {
        await prisma.department.update({ where: { id: exists.id }, data: { businessDivisionId: d.divisionId, code: exists.code || d.code } });
        console.log(`  ~ Linked existing: ${d.name}`);
      } else {
        console.log(`  · Already exists: ${d.name}`);
        skipped++;
      }
    } else {
      await prisma.department.create({ data: { name: d.name, code: d.code, businessDivisionId: d.divisionId, companyId: null } });
      console.log(`  + Added: ${d.name}${d.divisionId ? ' → Sugar' : ' (common)'}`);
      added++;
    }
  }
  console.log(`Done. Added ${added}, skipped ${skipped}.`);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
