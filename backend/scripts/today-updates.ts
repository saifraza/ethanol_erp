import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  // Look at every table with updatedAt — find bulk updates in today's window
  const tables = ['Vendor','PurchaseOrder','Customer','Invoice','GoodsReceipt','Material',
    'InventoryItem','DispatchTruck','EthanolContract','DDGSContract','Company','Settings'];
  console.log('Bulk updates TODAY (>= 2026-04-18 00:00 UTC), grouped to the second');
  console.log('Table                | updatedAt (UTC)              | rows');
  for (const t of tables) {
    try {
      const rows: any[] = await p.$queryRawUnsafe(`
        SELECT "updatedAt" AT TIME ZONE 'UTC' AS ts, COUNT(*)::int AS n
        FROM "${t}"
        WHERE "updatedAt" >= '2026-04-18 00:00:00'
        GROUP BY 1 HAVING COUNT(*) >= 2
        ORDER BY n DESC, ts
      `);
      for (const r of rows) {
        console.log(`${t.padEnd(20)} | ${r.ts.toISOString()} | ${r.n}`);
      }
    } catch { /* table missing updatedAt */ }
  }
  console.log('\n— singletons (1-row updates today) count per table —');
  for (const t of tables) {
    try {
      const rows: any[] = await p.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${t}" WHERE "updatedAt" >= '2026-04-18 00:00:00'`);
      console.log(`${t.padEnd(20)} | ${rows[0].n} rows updated today`);
    } catch {}
  }
  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
