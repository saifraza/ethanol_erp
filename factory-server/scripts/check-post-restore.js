const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const since = new Date('2026-04-18T09:30:00.000Z');
  const rows = await p.weighment.findMany({
    where: { createdAt: { gte: since } },
    select: { ticketNo: true, vehicleNo: true, materialName: true, status: true, direction: true, purchaseType: true, createdAt: true, secondWeightAt: true, cloudSynced: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`Factory weighments since 3:00 PM IST today: ${rows.length}\n`);
  for (const r of rows) {
    const crt = r.createdAt.toISOString().slice(11, 16);
    const sec = r.secondWeightAt ? r.secondWeightAt.toISOString().slice(11, 16) : '-';
    console.log(`  t=${r.ticketNo} ${(r.vehicleNo||'').padEnd(14)} ${(r.materialName||'').slice(0,13).padEnd(13)} ${r.direction}/${r.purchaseType||'-'} ${r.status.padEnd(12)} crt=${crt} 2w=${sec} sync=${r.cloudSynced}`);
  }
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
