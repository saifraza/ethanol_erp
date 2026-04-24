const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  // Re-queue all today's weighments for re-push because cloud DB was restored to pre-sync state.
  const since = new Date('2026-04-18T00:00:00.000Z');  // midnight UTC = 5:30 AM IST
  const beforeCount = await p.weighment.count({ where: { createdAt: { gte: since } } });
  const already = await p.weighment.count({ where: { createdAt: { gte: since }, cloudSynced: true } });
  console.log(`Today's weighments: ${beforeCount} (currently cloudSynced=true: ${already})`);

  const r = await p.weighment.updateMany({
    where: { createdAt: { gte: since } },
    data: { cloudSynced: false },
  });
  console.log(`Reset cloudSynced=false on ${r.count} rows.`);

  // Also reset the WeighmentAuditQueue if it has entries
  try {
    const aq = await p.weighmentAuditQueue.updateMany({
      where: { createdAt: { gte: since } },
      data: { syncedToCloud: false, syncedAt: null, cloudError: null },
    });
    console.log(`Reset audit queue: ${aq.count} rows.`);
  } catch (e) {
    console.log('No audit queue reset needed.');
  }

  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
