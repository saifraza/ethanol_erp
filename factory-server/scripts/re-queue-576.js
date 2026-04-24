const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const r = await p.weighment.updateMany({
    where: { ticketNo: 576, vehicleNo: 'KA01AN1742' },
    data: { cloudSynced: false },
  });
  console.log(`Re-queued ticket 576: ${r.count} row(s)`);
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
