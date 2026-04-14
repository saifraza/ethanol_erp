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
  console.log(`Factory: ${factory.length} weighments marked cloudSynced=true`);

  const lost = [];
  const foundBy = { grainTruck: 0, dispatchTruck: 0, ddgsTruck: 0, goodsReceipt: 0, directPurchase: 0 };

  for (const f of factory) {
    const id = f.id;
    const wbMarker = `WB:${id}`;
    const direction = (f.direction || '').trim();

    // Check ALL possible cloud tables
    const [gt, grn, dp, dt, dd] = await Promise.all([
      p.grainTruck.findFirst({
        where: { OR: [{ factoryLocalId: id }, { remarks: { contains: id } }] },
        select: { id: true },
      }),
      p.goodsReceipt.findFirst({
        where: { remarks: { contains: id } },
        select: { id: true, grnNo: true },
      }),
      p.directPurchase.findFirst({
        where: { remarks: { contains: id } },
        select: { id: true },
      }),
      p.dispatchTruck.findFirst({
        where: { OR: [{ remarks: { contains: id } }, { vehicleNo: f.vehicleNo }] },
        select: { id: true },
      }),
      p.dDGSDispatchTruck.findFirst({
        where: { OR: [{ remarks: { contains: id } }, { vehicleNo: f.vehicleNo }] },
        select: { id: true },
      }),
    ]);

    if (gt) { foundBy.grainTruck++; continue; }
    if (grn) { foundBy.goodsReceipt++; continue; }
    if (dp) { foundBy.directPurchase++; continue; }
    if (direction === 'OUTBOUND') {
      const mat = (f.materialCategory || '').trim();
      if (mat === 'DDGS' && dd) { foundBy.ddgsTruck++; continue; }
      if (mat !== 'DDGS' && dt) { foundBy.dispatchTruck++; continue; }
    }
    lost.push({
      ticket: f.ticketNo,
      direction,
      material: f.materialCategory,
      vehicle: f.vehicleNo,
      supplier: f.supplierName,
      netKg: f.netWeight,
      status: f.status,
    });
  }

  console.log(`\nFound: ${factory.length - lost.length}`);
  console.log(`  GrainTruck:     ${foundBy.grainTruck}`);
  console.log(`  GoodsReceipt:   ${foundBy.goodsReceipt}`);
  console.log(`  DirectPurchase: ${foundBy.directPurchase}`);
  console.log(`  DispatchTruck:  ${foundBy.dispatchTruck}`);
  console.log(`  DDGSDispatch:   ${foundBy.ddgsTruck}`);
  console.log(`\nLOST (not in any table): ${lost.length}`);
  if (lost.length && lost.length <= 50) {
    console.log('\n--- LOST ---');
    for (const l of lost) {
      console.log(`#${l.ticket}`.padEnd(6), l.direction.padEnd(9), (l.material || '-').padEnd(13), l.vehicle.padEnd(16), l.status.padEnd(12), l.supplier);
    }
  }
  p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
