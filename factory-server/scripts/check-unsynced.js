const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const since = new Date('2026-04-18T00:00:00.000Z');
  const wms = await p.weighment.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`Factory weighments since midnight UTC: ${wms.length}\n`);
  console.log(`t#  vehicle          material          direction purchaseType status       cloudSynced syncedAt`);
  for (const w of wms) {
    const v = (w.vehicleNo || '').padEnd(16);
    const m = (w.materialName || '').slice(0, 17).padEnd(17);
    const dir = (w.direction || '').padEnd(9);
    const pt = (w.purchaseType || '').padEnd(9);
    const st = (w.status || '').padEnd(13);
    const cs = w.cloudSynced ? 'TRUE ' : 'FALSE';
    const sa = w.syncedAt ? w.syncedAt.toISOString().slice(11, 19) : 'null';
    console.log(`${String(w.ticketNo).padEnd(3)} ${v} ${m} ${dir} ${pt} ${st} ${cs}        ${sa}`);
  }
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
