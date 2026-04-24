import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const vehicles = ['MP20HB2018', 'UP71AT0207', 'MH46DC4495', 'MP16H1809'];
  for (const v of vehicles) {
    console.log(`\n=== ${v} DDGSDispatchTruck ===`);
    const rows: any[] = await p.$queryRawUnsafe(`
      SELECT id, "vehicleNo", status, "partyName", "weightNet", "date", "createdAt", "sourceWbId", "invoiceNo"
      FROM "DDGSDispatchTruck"
      WHERE "vehicleNo" = $1
      ORDER BY "createdAt" DESC
    `, v);
    for (const r of rows) console.log(`  ${r.createdAt.toISOString().slice(0,10)} status=${r.status} net=${r.weightNet} inv=${r.invoiceNo ?? '-'} party=${r.partyName?.slice(0,25)} wb=${r.sourceWbId ? 'Y' : 'N'}`);
    if (rows.length === 0) console.log('  (none)');
  }

  console.log('\n\n=== Stuck DDGS trucks (status != RELEASED/DISPATCHED) last 10 days ===');
  const stuck: any[] = await p.$queryRawUnsafe(`
    SELECT id, "vehicleNo", status, "partyName", "weightNet", "date", "createdAt", "sourceWbId"
    FROM "DDGSDispatchTruck"
    WHERE "createdAt" >= NOW() - INTERVAL '10 days'
      AND status NOT IN ('DISPATCHED', 'RELEASED', 'DELIVERED')
    ORDER BY "createdAt" DESC LIMIT 30
  `);
  console.log(`count: ${stuck.length}`);
  for (const r of stuck) console.log(`  ${r.createdAt.toISOString().slice(0,10)} ${r.vehicleNo.padEnd(14)} status=${String(r.status).padEnd(14)} net=${r.weightNet ?? '-'} party=${r.partyName?.slice(0,25)} wb=${r.sourceWbId?'Y':'N'}`);

  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
