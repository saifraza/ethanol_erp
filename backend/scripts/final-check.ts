import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  console.log('=== KA01AN1742 DispatchTruck (should have tare weight after sync) ===');
  const dt = await p.dispatchTruck.findFirst({
    where: { vehicleNo: 'KA01AN1742', createdAt: { gte: new Date('2026-04-18T00:00:00.000Z') } },
    select: { id: true, status: true, weightTare: true, weightGross: true, weightNet: true, tareTime: true, sourceWbId: true, contractId: true, liftingId: true },
  });
  console.log(JSON.stringify(dt, null, 2));

  console.log('\n=== All today\'s entries final state ===');
  const start = new Date('2026-04-17T18:30:00.000Z');
  const dts = await p.dispatchTruck.findMany({
    where: { createdAt: { gte: start } },
    select: { vehicleNo: true, partyName: true, status: true, weightTare: true, weightGross: true, weightNet: true, liftingId: true },
  });
  console.log(`DispatchTrucks today: ${dts.length}`);
  for (const r of dts) console.log(`  ${r.vehicleNo.padEnd(14)} ${r.status.padEnd(14)} tare=${r.weightTare ?? '-'} gross=${r.weightGross ?? '-'} net=${r.weightNet ?? '-'} lift=${r.liftingId ? 'Y' : 'N'}`);

  const grns = await p.goodsReceipt.findMany({
    where: { createdAt: { gte: start } },
    select: { grnNo: true, vehicleNo: true, netWeight: true, vendorId: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`\nGRNs today: ${grns.length}`);
  const nullNet = grns.filter(g => g.netWeight == null);
  console.log(`  with weight: ${grns.length - nullNet.length}`);
  console.log(`  still null:  ${nullNet.length}`);
  for (const g of nullNet) console.log(`    GRN#${g.grnNo} ${g.vehicleNo} — null`);

  const gts = await p.grainTruck.findMany({
    where: { date: { gte: start } },
    select: { ticketNo: true, vehicleNo: true, weightNet: true, supplier: true },
  });
  console.log(`\nGrainTrucks today: ${gts.length}`);
  for (const g of gts) console.log(`  t=${g.ticketNo} ${g.vehicleNo} net=${g.weightNet}T supplier=${g.supplier}`);

  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
