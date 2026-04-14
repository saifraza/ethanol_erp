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
  const lostIds = [];
  for (const f of factory) {
    const direction = (f.direction || '').trim();
    const id = f.id;
    let row = null;
    if (direction === 'INBOUND') {
      row = await p.grainTruck.findFirst({
        where: { OR: [{ factoryLocalId: id }, { remarks: { contains: id } }] },
        select: { id: true },
      });
    } else if (direction === 'OUTBOUND') {
      const mat = (f.materialCategory || '').trim();
      if (mat === 'DDGS') {
        row = await p.dDGSDispatchTruck.findFirst({
          where: { OR: [{ remarks: { contains: id } }, { vehicleNo: f.vehicleNo }] },
          select: { id: true },
        });
      } else {
        row = await p.dispatchTruck.findFirst({
          where: { OR: [{ remarks: { contains: id } }, { vehicleNo: f.vehicleNo }] },
          select: { id: true },
        });
      }
    }
    if (!row) lostIds.push(id);
  }
  fs.writeFileSync('/tmp/lost_ids.txt', lostIds.join('\n') + '\n');
  console.log(`Wrote ${lostIds.length} lost factory weighment IDs to /tmp/lost_ids.txt`);
  p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
