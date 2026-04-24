import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const cols: any[] = await p.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'DDGSDispatchTruck' ORDER BY ordinal_position
  `);
  console.log('DDGSDispatchTruck columns:');
  for (const c of cols) console.log('  ' + c.column_name);
  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
