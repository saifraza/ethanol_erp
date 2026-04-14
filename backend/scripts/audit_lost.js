const fs = require('fs');
const path = require('path');
process.chdir('/Users/saifraza/Desktop/distillery-erp/backend');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

function parseCsv(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n').filter(Boolean);
  const header = lines.shift().split(',');
  const rows = [];
  for (const line of lines) {
    // naive CSV split — none of our fields contain commas
    const cells = line.split(',');
    const obj = {};
    header.forEach((h, i) => { obj[h] = cells[i]; });
    rows.push(obj);
  }
  return rows;
}

(async () => {
  const factory = parseCsv('/tmp/factory_weighments.csv');
  console.log(`Factory: ${factory.length} weighments marked cloudSynced=true`);

  const lost = [];
  const found = [];
  for (const f of factory) {
    const direction = (f.direction || '').trim();
    const id = f.id;
    let cloudRow = null;
    if (direction === 'INBOUND') {
      cloudRow = await p.grainTruck.findFirst({
        where: {
          OR: [
            { factoryLocalId: id },
            { remarks: { contains: id } },
          ],
        },
        select: { id: true, ticketNo: true, weightNet: true },
      });
    } else if (direction === 'OUTBOUND') {
      // Ethanol or DDGS — try dispatch and ddgs
      const mat = (f.materialCategory || '').trim();
      if (mat === 'DDGS') {
        cloudRow = await p.dDGSDispatchTruck.findFirst({
          where: { OR: [{ remarks: { contains: id } }, { vehicleNo: f.vehicleNo }] },
          select: { id: true, rstNo: true },
        });
      } else {
        cloudRow = await p.dispatchTruck.findFirst({
          where: { OR: [{ remarks: { contains: id } }, { vehicleNo: f.vehicleNo }] },
          select: { id: true },
        });
      }
    }
    if (cloudRow) found.push({ ticket: f.ticketNo, direction, id });
    else lost.push({
      ticket: f.ticketNo,
      direction,
      material: f.materialCategory,
      vehicle: f.vehicleNo,
      supplier: f.supplierName,
      netKg: f.netWeight,
      gateEntry: f.gateEntryAt,
      factoryId: id,
      status: f.status,
    });
  }

  console.log(`\nFound on cloud: ${found.length}`);
  console.log(`LOST (not in cloud): ${lost.length}`);
  if (lost.length) {
    console.log('\n--- LOST TICKETS ---');
    for (const l of lost) {
      console.log(`#${l.ticket}`.padEnd(7), l.direction.padEnd(9), (l.material || '-').padEnd(13), l.vehicle.padEnd(16), (l.netKg || '').padEnd(8), l.supplier);
    }
  }
  p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
