const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  // Export all COMPLETE weighments from factory (last 30 days) — so we can compare to cloud
  const since = new Date(Date.now() - 30 * 86400 * 1000);
  const rows = await p.weighment.findMany({
    where: { status: 'COMPLETE', createdAt: { gte: since } },
    select: { ticketNo: true, vehicleNo: true, grossWeight: true, tareWeight: true, netWeight: true, grossTime: true, tareTime: true, materialName: true, direction: true, purchaseType: true },
    orderBy: { ticketNo: 'asc' },
  });
  console.log(JSON.stringify(rows.map(r => ({
    ticketNo: r.ticketNo,
    vehicleNo: r.vehicleNo,
    g: r.grossWeight, t: r.tareWeight, n: r.netWeight,
    gT: r.grossTime?.toISOString(), tT: r.tareTime?.toISOString(),
    mat: r.materialName, dir: r.direction, pt: r.purchaseType,
  }))));
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
