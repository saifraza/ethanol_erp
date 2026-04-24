import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const start = new Date('2026-04-17T18:30:00.000Z');
  const tickets = [570, 571, 572, 573, 574, 575, 576, 577, 578, 579];

  for (const ticketNo of tickets) {
    console.log(`\n=== Ticket ${ticketNo} ===`);
    const w = await p.weighment.findFirst({
      where: { ticketNo },
      select: { vehicleNo: true, materialName: true, purchaseType: true, direction: true, status: true },
    });
    if (!w) { console.log('  not in weighment mirror'); continue; }
    console.log(`  mirror:   ${w.vehicleNo} ${w.materialName} ${w.purchaseType} ${w.status}`);

    // Check GrainTruck (for inbound maize/RM)
    const gt = await p.grainTruck.findFirst({
      where: { vehicleNo: w.vehicleNo, date: { gte: start } },
      select: { id: true, ticketNo: true, weightNet: true, supplier: true, remarks: true },
    });
    if (gt) console.log(`  grainTruck: ticket=${gt.ticketNo} net=${gt.weightNet} supplier=${gt.supplier}`);

    // Check GRN
    const grn = await p.goodsReceipt.findFirst({
      where: { vehicleNo: w.vehicleNo, createdAt: { gte: start } },
      select: { id: true, grnNo: true, netWeight: true, vendorId: true },
    });
    if (grn) console.log(`  GRN:      ${grn.grnNo} net=${grn.netWeight}`);

    // Check DispatchTruck (for outbound ethanol/DDGS)
    const dt = await p.dispatchTruck.findFirst({
      where: { vehicleNo: w.vehicleNo, createdAt: { gte: start } },
      select: { id: true, status: true, weightNet: true, liftingId: true },
    });
    if (dt) console.log(`  Dispatch: ${dt.status} net=${dt.weightNet} lift=${dt.liftingId ? 'Y' : 'N'}`);

    // Check FuelEntry (legacy for fuel)
    try {
      const fe = await (p as any).fuelEntry?.findFirst({
        where: { vehicleNo: w.vehicleNo, createdAt: { gte: start } },
        select: { id: true, quantityMT: true },
      });
      if (fe) console.log(`  FuelEntry: ${fe.id} qty=${fe.quantityMT}`);
    } catch {}
  }

  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
