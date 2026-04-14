const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

function parseCsv(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n').filter(Boolean);
  const header = lines.shift().split(',');
  return lines.map(line => {
    const cells = line.split(',');
    const o = {};
    header.forEach((h, i) => { o[h] = cells[i]; });
    return o;
  });
}

(async () => {
  const factory = parseCsv('/tmp/factory_weighments.csv');
  console.log(`Factory: ${factory.length} weighments`);

  const lost = [];
  const foundBy = { grainTruck: 0, grn: 0, dp: 0, dt: 0, ddgs: 0, sugar: 0 };

  for (const f of factory) {
    const ticket = Number(f.ticketNo);
    if (!ticket) { lost.push({...f, reason:'no_ticket'}); continue; }
    const marker = `Ticket #${ticket}`;

    const [gt, grn, dp, dt, dd] = await Promise.all([
      p.grainTruck.findFirst({ where: { ticketNo: ticket }, select: { id: true } }),
      p.goodsReceipt.findFirst({ where: { remarks: { contains: marker } }, select: { id: true } }),
      p.directPurchase.findFirst({ where: { remarks: { contains: marker } }, select: { id: true } }),
      p.dispatchTruck.findFirst({ where: { remarks: { contains: marker } }, select: { id: true } }),
      p.dDGSDispatchTruck.findFirst({ where: { OR: [{ rstNo: ticket }, { remarks: { contains: marker } }] }, select: { id: true } }),
    ]);

    if (gt) { foundBy.grainTruck++; continue; }
    if (grn) { foundBy.grn++; continue; }
    if (dp) { foundBy.dp++; continue; }
    if (dt) { foundBy.dt++; continue; }
    if (dd) { foundBy.ddgs++; continue; }
    lost.push({
      ticket, dir: f.direction, mat: f.materialCategory, veh: f.vehicleNo, status: f.status, supplier: f.supplierName, net: f.netWeight,
    });
  }

  console.log(`\nFound: ${factory.length - lost.length}`);
  console.log(`  GrainTruck:     ${foundBy.grainTruck}`);
  console.log(`  GoodsReceipt:   ${foundBy.grn}`);
  console.log(`  DirectPurchase: ${foundBy.dp}`);
  console.log(`  DispatchTruck:  ${foundBy.dt}`);
  console.log(`  DDGSDispatch:   ${foundBy.ddgs}`);
  console.log(`\nLOST: ${lost.length}`);
  if (lost.length) {
    console.log('\n--- LOST ---');
    for (const l of lost.slice(0, 60)) {
      console.log(`#${l.ticket}`.padEnd(6), (l.dir||'').padEnd(9), (l.mat||'-').padEnd(13), (l.veh||'').padEnd(16), (l.status||'').padEnd(12), l.supplier);
    }
  }
  p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
