import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const start = new Date('2026-04-17T18:30:00.000Z');

  // 1. Re-queue ticket 576 (KA01AN1742 ethanol) so factory pushes it again + pre-phase links DispatchTruck
  console.log('=== 1. Mark weighment 576 (ethanol) ready for re-sync ===');
  // Actually we need to call factory to reset its cloudSynced. We'll do this separately via SSH.
  // But we can also update the cloud Weighment mirror to flag it for re-handling.
  console.log('  (requires factory-side re-queue — see SSH step)');

  // 2. Fix ALL today's GRNs that have null netWeight (not just fuel)
  console.log('\n=== 2. Fix GRNs with null netWeight ===');
  const nullGrns = await p.goodsReceipt.findMany({
    where: { createdAt: { gte: start }, netWeight: null as any },
  });
  console.log(`Found ${nullGrns.length} null-net GRNs`);
  for (const grn of nullGrns) {
    const w = await p.weighment.findFirst({
      where: { vehicleNo: grn.vehicleNo || undefined, secondWeightAt: { gte: start }, status: 'COMPLETE' },
      orderBy: { secondWeightAt: 'desc' },
      select: { ticketNo: true, grossWeight: true, tareWeight: true, netWeight: true },
    });
    if (!w || !w.netWeight) { console.log(`  GRN#${grn.grnNo} ${grn.vehicleNo} — no completed weighment found`); continue; }
    await p.goodsReceipt.update({
      where: { id: grn.id },
      data: {
        grossWeight: (w.grossWeight || 0) / 1000,
        tareWeight: (w.tareWeight || 0) / 1000,
        netWeight: w.netWeight / 1000,
      },
    });
    console.log(`  ✓ GRN#${grn.grnNo} ${grn.vehicleNo} ← ticket ${w.ticketNo} net=${w.netWeight / 1000}T`);
  }

  // 3. Fix GrainTrucks with net=0 where Weighment is COMPLETE
  console.log('\n=== 3. Fix GrainTrucks with zero weight ===');
  const zeroGTs = await p.grainTruck.findMany({
    where: { date: { gte: start }, weightNet: 0 },
  });
  console.log(`Found ${zeroGTs.length} zero-net GrainTrucks`);
  for (const gt of zeroGTs) {
    const w = await p.weighment.findFirst({
      where: { ticketNo: gt.ticketNo || undefined, status: 'COMPLETE' },
      select: { grossWeight: true, tareWeight: true, netWeight: true },
    });
    if (!w || !w.netWeight) { console.log(`  t=${gt.ticketNo} ${gt.vehicleNo} — weighment not complete yet`); continue; }
    await p.grainTruck.update({
      where: { id: gt.id },
      data: {
        weightGross: (w.grossWeight || 0) / 1000,
        weightTare: (w.tareWeight || 0) / 1000,
        weightNet: w.netWeight / 1000,
      },
    });
    console.log(`  ✓ t=${gt.ticketNo} ${gt.vehicleNo} net=${w.netWeight / 1000}T`);
  }

  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
