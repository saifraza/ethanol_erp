const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const vs = ['MP20HB2018','UP71AT0207','MH46DC4495','MP16H1809','MP20HB3429','MP20HB4902','MP20HB5729','MP20HB2075'];
  for (const v of vs) {
    const rows = await p.weighment.findMany({
      where: { vehicleNo: v },
      select: {
        ticketNo: true, status: true, direction: true, purchaseType: true, materialName: true,
        grossWeight: true, tareWeight: true, netWeight: true,
        createdAt: true, secondWeightAt: true, cloudSynced: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });
    console.log(`\n=== ${v} (factory rows: ${rows.length}) ===`);
    for (const r of rows) {
      const d = r.createdAt.toISOString().slice(0, 10);
      const sec = r.secondWeightAt ? r.secondWeightAt.toISOString().slice(0, 16) : '-';
      console.log(`  t=${r.ticketNo} ${d} ${r.status.padEnd(12)} ${r.direction} ${r.purchaseType?.padEnd(9) || '-        '} ${(r.materialName || '').slice(0,12).padEnd(12)} g=${r.grossWeight ?? '-'} t=${r.tareWeight ?? '-'} n=${r.netWeight ?? '-'} 2w=${sec} sync=${r.cloudSynced}`);
    }
  }
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
