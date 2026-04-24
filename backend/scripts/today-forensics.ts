import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  console.log('=== All tables currently in the DB ===');
  const tables: any[] = await p.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `);
  console.log(`Total tables: ${tables.length}`);
  const names = tables.map(t => t.table_name);
  // Tables that reference companyId
  console.log('\n=== Tables with companyId column ===');
  const withCompany: any[] = await p.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema='public' AND column_name='companyId'
    ORDER BY table_name
  `);
  console.log(`Tables with companyId: ${withCompany.length}`);
  for (const t of withCompany) console.log('  ' + t.table_name);

  // Check if ANY table has rows with companyId NOT NULL
  console.log('\n=== Row counts per companyId across ALL companyId-aware tables ===');
  for (const t of withCompany) {
    try {
      const rows: any[] = await p.$queryRawUnsafe(`
        SELECT "companyId"::text AS cid, COUNT(*)::int AS n
        FROM "${t.table_name}" WHERE "companyId" IS NOT NULL GROUP BY "companyId"
      `);
      if (rows.length > 0) {
        for (const r of rows) console.log(`  ${t.table_name.padEnd(30)} | ${r.cid} | ${r.n}`);
      }
    } catch {}
  }

  console.log('\n=== What changed on Company MSPIL today (11:16 AM IST)? ===');
  const mspil = await p.company.findUnique({ where: { code: 'MSPIL' } });
  console.log(JSON.stringify(mspil, null, 2));

  console.log('\n=== Settings row updated today ===');
  const set = await p.settings.findFirst({ orderBy: { updatedAt: 'desc' } });
  console.log(JSON.stringify(set, null, 2).slice(0, 600));

  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
