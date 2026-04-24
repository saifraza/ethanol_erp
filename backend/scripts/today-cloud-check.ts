import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  // Today IST window: midnight IST = 2026-04-17 18:30 UTC onwards
  const start = new Date('2026-04-17T18:30:00.000Z');

  console.log('=== CLOUD DB — all entries since midnight IST today ===\n');

  // Weighment mirror (source of truth for all weighbridge activity)
  const wms = await p.weighment.findMany({
    where: { factoryCreatedAt: { gte: start } },
    select: { ticketNo: true, vehicleNo: true, materialName: true, materialCategory: true, purchaseType: true, status: true, factoryCreatedAt: true, secondWeightAt: true, syncedAt: true },
    orderBy: { factoryCreatedAt: 'asc' },
  });
  console.log(`Weighment mirror: ${wms.length} rows\n`);
  const buckets: Record<string, any[]> = { RM: [], FUEL: [], ETHANOL: [], DDGS: [], OTHER: [] };
  for (const w of wms) {
    const m = (w.materialName || '').toLowerCase();
    if (m.includes('ethanol')) buckets.ETHANOL.push(w);
    else if (m.includes('ddgs')) buckets.DDGS.push(w);
    else if (m.includes('maize') || m.includes('corn') || m.includes('rice') && !m.includes('husk')) buckets.RM.push(w);
    else if (m.includes('husk') || m.includes('bagasse') || m.includes('coal') || w.materialCategory === 'FUEL') buckets.FUEL.push(w);
    else buckets.OTHER.push(w);
  }
  for (const [key, arr] of Object.entries(buckets)) {
    console.log(`-- ${key}: ${arr.length} --`);
    for (const w of arr) {
      const v = (w.vehicleNo || '').padEnd(14);
      const st = w.status.padEnd(12);
      const ist = new Date(w.factoryCreatedAt!.getTime() + 5.5*3600000).toISOString().slice(11,16);
      const relIst = w.secondWeightAt ? new Date(w.secondWeightAt.getTime() + 5.5*3600000).toISOString().slice(11,16) : '-';
      console.log(`  t=${w.ticketNo} ${v} ${(w.materialName||'').padEnd(15)} ${w.purchaseType.padEnd(9)} ${st} crt=${ist} rel=${relIst}`);
    }
    console.log('');
  }

  // GoodsReceipt (for INBOUND PO/JOB_WORK/SPOT)
  const grns = await p.goodsReceipt.findMany({
    where: { createdAt: { gte: start } },
    select: { id: true, grnNumber: true, vendorName: true, status: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`=== GoodsReceipt today: ${grns.length} ===`);
  for (const g of grns) console.log(`  ${g.grnNumber} | ${g.vendorName} | ${g.status}`);

  // DispatchTruck (for OUTBOUND Ethanol/DDGS)
  const dts = await p.dispatchTruck.findMany({
    where: { createdAt: { gte: start } },
    select: { vehicleNo: true, partyName: true, status: true, weightNet: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`\n=== DispatchTruck today: ${dts.length} ===`);
  for (const d of dts) {
    const ist = new Date(d.createdAt.getTime() + 5.5*3600000).toISOString().slice(11,16);
    console.log(`  ${d.vehicleNo.padEnd(14)} | ${d.partyName} | ${d.status} | net=${d.weightNet ?? 'null'} | crt=${ist}`);
  }

  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
