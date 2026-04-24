import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
const p = new PrismaClient();

(async () => {
  const stuck = JSON.parse(fs.readFileSync('/tmp/stuck-weighments.json', 'utf-8'));
  console.log(`Fixing ${stuck.length} stuck weighments + their downstream GRN/GrainTruck\n`);

  // Also check for 2 missing ones
  const raw = JSON.parse(fs.readFileSync('/tmp/factory-complete.json', 'utf-8'));
  const tickets = raw.map((r: any) => r.ticketNo);
  const cloudRows = await p.weighment.findMany({ where: { ticketNo: { in: tickets } }, select: { ticketNo: true } });
  const cloudSet = new Set(cloudRows.map(r => r.ticketNo));
  const missing = raw.filter((r: any) => !cloudSet.has(r.ticketNo));
  if (missing.length > 0) {
    console.log('\n=== Cloud MISSING (factory COMPLETE but no Weighment row at all) ===');
    for (const m of missing) console.log(`  t=${m.ticketNo} ${m.vehicleNo} ${m.mat}`);
  }

  let fixed = 0;
  let grnFixed = 0;
  let gtFixed = 0;

  for (const m of stuck) {
    const f = m.factory;
    const netT = f.n / 1000;
    const grossT = f.g / 1000;
    const tareT = f.t / 1000;

    // 1. Update Weighment mirror
    await p.$executeRawUnsafe(`
      UPDATE "Weighment"
      SET status='COMPLETE', "grossWeight"=$1, "tareWeight"=$2, "netWeight"=$3, "secondWeightAt"=$4, "factoryUpdatedAt"=NOW()
      WHERE "ticketNo"=$5
    `, f.g, f.t, f.n, new Date(f.tT > f.gT ? f.tT : f.gT), f.ticketNo);
    fixed++;
    console.log(`✓ Weighment t=${f.ticketNo} ${f.vehicleNo} → COMPLETE net=${netT}T`);

    // 2. Fix downstream tables
    if (f.dir === 'INBOUND') {
      // GrainTruck (for RM/Maize)
      const gts = await p.grainTruck.findMany({ where: { ticketNo: f.ticketNo } });
      for (const gt of gts) {
        await p.grainTruck.update({
          where: { id: gt.id },
          data: { weightGross: grossT, weightTare: tareT, weightNet: netT },
        });
        gtFixed++;
        console.log(`   ↳ GrainTruck ticket=${f.ticketNo} net=${netT}T`);
      }

      // GoodsReceipt (may match by ticketNo OR vehicleNo + date)
      const grns = await p.goodsReceipt.findMany({
        where: {
          OR: [
            { ticketNo: f.ticketNo },
            {
              vehicleNo: f.vehicleNo,
              createdAt: { gte: new Date(new Date(f.gT).getTime() - 1 * 86400000), lte: new Date(new Date(f.gT).getTime() + 2 * 86400000) },
              netWeight: null,
            },
          ],
        },
      });
      for (const grn of grns) {
        await p.goodsReceipt.update({
          where: { id: grn.id },
          data: { grossWeight: grossT, tareWeight: tareT, netWeight: netT },
        });
        grnFixed++;
        console.log(`   ↳ GRN#${grn.grnNo} ${f.vehicleNo} net=${netT}T`);
      }
    }
  }

  console.log(`\n✅ Fixed: ${fixed} Weighment mirror, ${gtFixed} GrainTruck, ${grnFixed} GRN rows`);

  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
