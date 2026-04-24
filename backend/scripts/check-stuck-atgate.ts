import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const vehicles = ['MP20HB2018', 'UP71AT0207', 'MH46DC4495', 'MP16H1809'];

  for (const v of vehicles) {
    console.log(`\n=== ${v} ===`);

    // DispatchTruck (ethanol)
    const dt = await p.dispatchTruck.findMany({
      where: { vehicleNo: v },
      select: { id: true, status: true, weightNet: true, date: true, createdAt: true, liftingId: true, contractId: true, partyName: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    console.log(`DispatchTruck: ${dt.length}`);
    for (const d of dt) console.log(`  ${d.createdAt.toISOString().slice(0,10)} ${d.status} net=${d.weightNet ?? 'null'} lift=${d.liftingId?'Y':'N'} party=${d.partyName?.slice(0,25)}`);

    // DDGSDispatchTruck
    try {
      const dd = await (p as any).dDGSDispatchTruck?.findMany({
        where: { vehicleNo: v },
        select: { id: true, status: true, weightNet: true, date: true, createdAt: true, buyerName: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
      console.log(`DDGSDispatchTruck: ${dd?.length ?? 0}`);
      for (const d of dd ?? []) console.log(`  ${d.createdAt.toISOString().slice(0,10)} ${d.status} net=${d.weightNet ?? 'null'} buyer=${d.buyerName?.slice(0,25)}`);
    } catch {}

    // Weighment mirror
    const wm = await p.weighment.findMany({
      where: { vehicleNo: v },
      select: { ticketNo: true, materialName: true, status: true, netWeight: true, secondWeightAt: true, factoryCreatedAt: true },
      orderBy: { factoryCreatedAt: 'desc' },
      take: 5,
    });
    console.log(`Weighment mirror: ${wm.length}`);
    for (const w of wm) console.log(`  t=${w.ticketNo} ${w.materialName} ${w.status} net=${w.netWeight} 2w=${w.secondWeightAt?.toISOString().slice(0,16)}`);
  }

  // Duplicate check across all recent DispatchTrucks
  console.log('\n\n=== Duplicate vehicleNo in DispatchTruck last 30 days ===');
  const dups: any[] = await p.$queryRawUnsafe(`
    SELECT "vehicleNo", COUNT(*) as c, array_agg("status") as statuses
    FROM "DispatchTruck"
    WHERE "createdAt" >= NOW() - INTERVAL '30 days'
    GROUP BY "vehicleNo"
    HAVING COUNT(*) > 1
    ORDER BY c DESC LIMIT 20
  `);
  for (const r of dups) console.log(`  ${r.vehicleNo}: ${r.c}x [${r.statuses.join(', ')}]`);

  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
