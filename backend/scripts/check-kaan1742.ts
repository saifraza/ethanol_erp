import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  console.log('=== Weighment for KA01AN1742 ===');
  const w = await p.weighment.findFirst({
    where: { vehicleNo: 'KA01AN1742' },
    orderBy: { factoryCreatedAt: 'desc' },
  });
  console.log(JSON.stringify(w, null, 2));

  console.log('\n=== DispatchTruck for KA01AN1742 ===');
  const dt = await p.dispatchTruck.findMany({
    where: { vehicleNo: 'KA01AN1742' },
    orderBy: { createdAt: 'desc' },
  });
  console.log(JSON.stringify(dt, null, 2));

  console.log('\n=== All DispatchTrucks created today (since midnight IST) ===');
  const start = new Date('2026-04-17T18:30:00.000Z');
  const all = await p.dispatchTruck.findMany({
    where: { createdAt: { gte: start } },
    select: { id: true, vehicleNo: true, partyName: true, status: true, liftingId: true, contractId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  for (const r of all) console.log(`  ${r.createdAt.toISOString()} ${r.vehicleNo.padEnd(14)} ${(r.partyName||'').slice(0,30).padEnd(30)} ${r.status.padEnd(14)} ctr=${r.contractId?.slice(0,8) ?? 'NULL    '} lift=${r.liftingId ? 'Y' : 'N'}`);
  console.log(`count: ${all.length}`);

  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
