import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
const p = new PrismaClient();

// For each GRN, find the factory weighment whose tareTime is closest to GRN.createdAt.
// Apply that weighment's weight instead of the one ticket 529/531 got.
(async () => {
  const factory: any[] = JSON.parse(fs.readFileSync('/tmp/factory-complete.json', 'utf-8'));
  const grnsToRecheck = [17, 21, 424, 427, 471];

  for (const grnNo of grnsToRecheck) {
    const g = await p.goodsReceipt.findFirst({ where: { grnNo }, select: { id: true, grnNo: true, vehicleNo: true, createdAt: true, netWeight: true } });
    if (!g) continue;

    // Find closest weighment for this vehicle
    const candidates = factory.filter(f => f.vehicleNo === g.vehicleNo);
    let best: any = null;
    let bestDelta = Infinity;
    for (const c of candidates) {
      const wTime = new Date(c.tT || c.gT).getTime();
      const delta = Math.abs(wTime - g.createdAt.getTime());
      if (delta < bestDelta) { bestDelta = delta; best = c; }
    }
    if (!best) { console.log(`GRN#${grnNo} no match`); continue; }

    const deltaHr = bestDelta / (3600 * 1000);
    const newNet = best.n / 1000;
    const current = g.netWeight;
    if (deltaHr > 12) {
      console.log(`⚠ GRN#${grnNo} ${g.vehicleNo} best match is ${deltaHr.toFixed(1)}h away — probably wrong, reverting to NULL`);
      await p.goodsReceipt.update({ where: { id: g.id }, data: { grossWeight: null, tareWeight: null, netWeight: null } });
    } else if (Math.abs(current! - newNet) < 0.01) {
      console.log(`✓ GRN#${grnNo} ${g.vehicleNo} already correct (${current}T, ticket ${best.ticketNo}, ${deltaHr.toFixed(1)}h match)`);
    } else {
      console.log(`🔧 GRN#${grnNo} ${g.vehicleNo} ${current}T → ${newNet}T (ticket ${best.ticketNo}, ${deltaHr.toFixed(1)}h away)`);
      await p.goodsReceipt.update({
        where: { id: g.id },
        data: { grossWeight: best.g / 1000, tareWeight: best.t / 1000, netWeight: newNet },
      });
    }
  }
  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
