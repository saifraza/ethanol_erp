/**
 * Backfill ticketNo on historical null-ticket GrainTruck rows.
 * Assigns sequential numbers starting at 1,000,001 in createdAt order.
 * Manual range (>=1,000,000) never collides with factory-allocated tickets.
 * Idempotent — only updates rows with ticketNo=null.
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const MANUAL_BASE = 1_000_000;

(async () => {
  const existingMax = await p.grainTruck.aggregate({
    _max: { ticketNo: true },
    where: { ticketNo: { gte: MANUAL_BASE } },
  });
  let next = (existingMax._max.ticketNo ?? MANUAL_BASE) + 1;
  if (next <= MANUAL_BASE) next = MANUAL_BASE + 1;
  console.log(`Starting ticket number: ${next}`);

  const rows = await p.grainTruck.findMany({
    where: { ticketNo: null },
    select: { id: true, createdAt: true, supplier: true, vehicleNo: true, weightNet: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`Null-ticket rows to backfill: ${rows.length}`);

  let updated = 0;
  for (const row of rows) {
    try {
      await p.grainTruck.update({
        where: { id: row.id },
        data: { ticketNo: next },
      });
      updated++;
      next++;
      if (updated % 50 === 0) console.log(`  ${updated}/${rows.length}...`);
    } catch (e) {
      console.error(`FAIL id=${row.id}: ${e.message}`);
    }
  }

  console.log(`\nDone. Updated ${updated} rows.`);
  console.log(`Manual tickets now range: ${MANUAL_BASE + 1} → ${next - 1}`);
  p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
