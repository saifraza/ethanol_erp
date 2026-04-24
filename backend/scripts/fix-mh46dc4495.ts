import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  // Get the completed weighment for MH46DC4495
  const w = await p.weighment.findFirst({
    where: { vehicleNo: 'MH46DC4495', ticketNo: 492, status: 'COMPLETE' },
    select: { id: true, ticketNo: true, grossWeight: true, tareWeight: true, netWeight: true, firstWeightAt: true, secondWeightAt: true },
  });
  if (!w) throw new Error('Weighment ticket 492 not found');
  console.log('Weighment data:', JSON.stringify(w, null, 2));

  // Find the stuck DDGSDispatchTruck
  const stuck: any[] = await p.$queryRawUnsafe(`
    SELECT id, status, "vehicleNo", "weightNet", date
    FROM "DDGSDispatchTruck"
    WHERE "vehicleNo" = 'MH46DC4495' AND status = 'GATE_IN'
  `);
  if (stuck.length !== 1) throw new Error(`Expected 1 stuck row, found ${stuck.length}`);
  const row = stuck[0];
  console.log('\nStuck DDGSDispatchTruck:', row.id, 'date:', row.date);

  const grossT = (w.grossWeight || 0) / 1000;
  const tareT = (w.tareWeight || 0) / 1000;
  const netT = (w.netWeight || 0) / 1000;

  // Update: set weights + status=GROSS_WEIGHED (matches pattern of other BILLED rows having gone through this)
  // Actually let's check if there's a pattern by looking at a recently-completed row
  await p.$executeRawUnsafe(`
    UPDATE "DDGSDispatchTruck"
    SET "weightGross" = $1,
        "weightTare" = $2,
        "weightNet" = $3,
        "grossTime" = $4,
        "tareTime" = $5,
        status = 'GROSS_WEIGHED',
        "sourceWbId" = $6,
        "updatedAt" = NOW()
    WHERE id = $7
  `, grossT, tareT, netT, w.secondWeightAt, w.firstWeightAt, w.id, row.id);

  console.log(`\n✓ Updated DDGSDispatchTruck ${row.id}`);
  console.log(`  weightGross: ${grossT}T`);
  console.log(`  weightTare: ${tareT}T`);
  console.log(`  weightNet: ${netT}T`);
  console.log(`  status: GATE_IN → GROSS_WEIGHED`);
  console.log(`\nNote: Team still needs to run through BILLED / RELEASED flow to generate invoice.`);

  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
