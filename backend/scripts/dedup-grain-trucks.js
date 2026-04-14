/**
 * dedup-grain-trucks.js
 *
 * Finds all GrainTruck rows where factoryLocalId is duplicated,
 * keeps the row with the highest weightNet (tie-break: latest createdAt),
 * deletes the rest.
 *
 * Run BEFORE `prisma db push` that adds the @unique constraint on factoryLocalId.
 *
 * Usage:
 *   cd backend && node scripts/dedup-grain-trucks.js
 *
 * Reads DATABASE_URL from .env automatically (via dotenv).
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('=== GrainTruck dedup — start ===\n');

  // 1. Find all factoryLocalId values that appear more than once
  const dupes = await prisma.$queryRaw`
    SELECT "factoryLocalId", COUNT(*) AS cnt
    FROM "GrainTruck"
    WHERE "factoryLocalId" IS NOT NULL
    GROUP BY "factoryLocalId"
    HAVING COUNT(*) > 1
  `;

  if (dupes.length === 0) {
    console.log('No duplicates found. Safe to push unique constraint.\n');
    return;
  }

  console.log(`Found ${dupes.length} factoryLocalId value(s) with duplicates:\n`);
  dupes.forEach(d => console.log(`  factoryLocalId=${d.factoryLocalId}  count=${d.cnt}`));
  console.log('');

  let totalDeleted = 0;

  for (const { factoryLocalId } of dupes) {
    // Fetch all rows for this factoryLocalId, ordered: highest weightNet first, latest createdAt second
    const rows = await prisma.grainTruck.findMany({
      where: { factoryLocalId },
      select: { id: true, weightNet: true, createdAt: true, vehicleNo: true, ticketNo: true },
      orderBy: [{ weightNet: 'desc' }, { createdAt: 'desc' }],
    });

    const [keep, ...discard] = rows;
    const discardIds = discard.map(r => r.id);

    console.log(`factoryLocalId=${factoryLocalId}`);
    console.log(`  KEEP   id=${keep.id}  vehicleNo=${keep.vehicleNo}  weightNet=${keep.weightNet}  createdAt=${keep.createdAt.toISOString()}`);
    discard.forEach(r =>
      console.log(`  DELETE id=${r.id}  vehicleNo=${r.vehicleNo}  weightNet=${r.weightNet}  createdAt=${r.createdAt.toISOString()}`)
    );

    // Delete WeighmentCorrections referencing the discard rows first (FK safety)
    const corrDel = await prisma.weighmentCorrection.deleteMany({
      where: { weighmentId: { in: discardIds }, weighmentKind: 'GrainTruck' },
    });
    if (corrDel.count > 0) {
      console.log(`  Deleted ${corrDel.count} correction(s) linked to discarded rows`);
    }

    const del = await prisma.grainTruck.deleteMany({ where: { id: { in: discardIds } } });
    console.log(`  Deleted ${del.count} duplicate row(s)\n`);
    totalDeleted += del.count;
  }

  console.log(`=== Done. Total rows deleted: ${totalDeleted} ===`);
  console.log('It is now safe to run: cd backend && npx prisma db push');
}

main()
  .catch(e => { console.error('ERROR:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
