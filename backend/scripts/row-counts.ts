import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const tables = [
    'weighment','grainTruck','dispatchTruck','ethanolLifting','invoice','goodsReceipt',
    'purchaseOrder','purchaseOrderLine','vendor','customer','material','inventoryItem',
    'journalEntry','journalLine','ethanolContract','plantIssue',
    'fuelEntry','ddgsProduction','ethanolProductEntry','siloSnapshot',
  ];
  console.log('table                          | rows    | latest');
  console.log('-------------------------------|---------|---------------------');
  for (const t of tables) {
    try {
      const m: any = (p as any)[t];
      if (!m) { console.log(`${t.padEnd(30)} | MODEL_NOT_FOUND`); continue; }
      const c = await m.count();
      let latest: Date | null = null;
      try { const r = await m.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }); latest = r?.updatedAt ?? null; }
      catch { try { const r = await m.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }); latest = r?.createdAt ?? null; } catch {} }
      console.log(`${t.padEnd(30)} | ${String(c).padStart(7)} | ${latest?.toISOString() ?? 'n/a'}`);
    } catch (e: any) {
      console.log(`${t.padEnd(30)} | ERROR: ${e.message.slice(0,60)}`);
    }
  }
  const raw: any[] = await p.$queryRawUnsafe(`SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size`);
  console.log('\nDB size:', raw[0]?.db_size);
  const tbls: any[] = await p.$queryRawUnsafe(
    `SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS size
     FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 12`
  );
  console.log('\nTop tables:');
  for (const r of tbls) console.log(`  ${String(r.relname).padEnd(40)} ${r.size}`);
  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
