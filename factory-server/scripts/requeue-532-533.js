const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const r = await p.weighment.updateMany({
    where: { ticketNo: { in: [532, 533] } },
    data: { cloudSynced: false },
  });
  console.log(`Re-queued ${r.count} weighment(s) for re-sync`);
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
