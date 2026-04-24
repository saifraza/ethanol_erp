import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  // UP71AT0207 → ticket 549 COMPLETE 29890kg
  // MP16H1809  → ticket 475 COMPLETE 29480kg
  const fixes = [
    { vehicle: 'UP71AT0207', ticket: 549 },
    { vehicle: 'MP16H1809',  ticket: 475 },
  ];

  for (const fix of fixes) {
    const w = await p.weighment.findFirst({
      where: { vehicleNo: fix.vehicle, ticketNo: fix.ticket, status: 'COMPLETE' },
      select: { id: true, grossWeight: true, tareWeight: true, netWeight: true, firstWeightAt: true, secondWeightAt: true },
    });
    if (!w) { console.log(`❌ No completed weighment for ${fix.vehicle} t=${fix.ticket}`); continue; }

    const stuck: any[] = await p.$queryRawUnsafe(`
      SELECT id, status FROM "DDGSDispatchTruck"
      WHERE "vehicleNo" = $1 AND status = 'GATE_IN'
      ORDER BY "createdAt" DESC LIMIT 1
    `, fix.vehicle);
    if (stuck.length === 0) { console.log(`❌ No stuck DDGSDispatchTruck for ${fix.vehicle}`); continue; }

    const grossT = (w.grossWeight || 0) / 1000;
    const tareT  = (w.tareWeight  || 0) / 1000;
    const netT   = (w.netWeight   || 0) / 1000;

    await p.$executeRawUnsafe(`
      UPDATE "DDGSDispatchTruck"
      SET "weightGross" = $1, "weightTare" = $2, "weightNet" = $3,
          "grossTime" = $4, "tareTime" = $5, status = 'GROSS_WEIGHED',
          "sourceWbId" = $6, "updatedAt" = NOW()
      WHERE id = $7
    `, grossT, tareT, netT, w.secondWeightAt, w.firstWeightAt, w.id, stuck[0].id);

    console.log(`✓ ${fix.vehicle}: GATE_IN → GROSS_WEIGHED, net=${netT}T`);
  }

  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
