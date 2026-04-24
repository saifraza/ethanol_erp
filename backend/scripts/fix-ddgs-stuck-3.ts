import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  // Factory raw data confirmed earlier via SSH query:
  const fixes = [
    {
      vehicle: 'UP71AT0207',
      ticket: 549,
      gross: 43160, tare: 13270, net: 29890,
      firstAt: '2026-04-17T06:35:00.000Z',  // approx gate entry
      secondAt: '2026-04-18T03:55:00.000Z',
    },
    {
      vehicle: 'MP16H1809',
      ticket: 475,
      gross: 40380, tare: 10900, net: 29480,
      firstAt: '2026-04-15T08:00:00.000Z',
      secondAt: '2026-04-16T15:50:00.000Z',
    },
  ];

  for (const f of fixes) {
    const grossT = f.gross / 1000;
    const tareT = f.tare / 1000;
    const netT = f.net / 1000;

    // 1. Update Weighment mirror (no updatedAt column on this table — uses factoryUpdatedAt)
    await p.$executeRawUnsafe(`
      UPDATE "Weighment"
      SET "grossWeight" = $1, "tareWeight" = $2, "netWeight" = $3,
          status = 'COMPLETE', "secondWeightAt" = $4, "factoryUpdatedAt" = NOW()
      WHERE "vehicleNo" = $5 AND "ticketNo" = $6
    `, f.gross, f.tare, f.net, new Date(f.secondAt), f.vehicle, f.ticket);

    // 2. Update DDGSDispatchTruck
    const stuck: any[] = await p.$queryRawUnsafe(`
      SELECT id FROM "DDGSDispatchTruck"
      WHERE "vehicleNo" = $1 AND status = 'GATE_IN'
      ORDER BY "createdAt" DESC LIMIT 1
    `, f.vehicle);

    if (stuck.length === 0) {
      console.log(`❌ No stuck DDGSDispatchTruck for ${f.vehicle}`);
      continue;
    }

    await p.$executeRawUnsafe(`
      UPDATE "DDGSDispatchTruck"
      SET "weightGross" = $1, "weightTare" = $2, "weightNet" = $3,
          "grossTime" = $4, "tareTime" = $5, status = 'GROSS_WEIGHED',
          "updatedAt" = NOW()
      WHERE id = $6
    `, grossT, tareT, netT, new Date(f.secondAt), new Date(f.firstAt), stuck[0].id);

    console.log(`✓ ${f.vehicle} (ticket ${f.ticket}): GATE_IN → GROSS_WEIGHED, net=${netT}T`);
  }

  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
