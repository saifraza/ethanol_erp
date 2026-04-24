import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
const p = new PrismaClient();

(async () => {
  const raw = fs.readFileSync('/tmp/factory-complete.json', 'utf-8');
  const factoryRows: any[] = JSON.parse(raw);
  console.log(`Factory COMPLETE weighments: ${factoryRows.length}`);

  const mismatches: Array<{ ticket: number; vehicle: string; factory: any; cloud: any }> = [];
  let cloudMissing = 0;
  let cloudCorrect = 0;

  // Batch query cloud by ticketNo
  const tickets = factoryRows.map(r => r.ticketNo);
  const cloudRows = await p.weighment.findMany({
    where: { ticketNo: { in: tickets } },
    select: { ticketNo: true, vehicleNo: true, status: true, grossWeight: true, tareWeight: true, netWeight: true },
  });
  const cloudMap = new Map(cloudRows.map(r => [r.ticketNo, r]));

  for (const f of factoryRows) {
    const c = cloudMap.get(f.ticketNo);
    if (!c) { cloudMissing++; continue; }
    // Cloud is stuck if its status != COMPLETE or net is null but factory has net
    if (c.status !== 'COMPLETE' || c.netWeight == null || c.tareWeight == null) {
      mismatches.push({ ticket: f.ticketNo, vehicle: f.vehicleNo, factory: f, cloud: c });
    } else {
      cloudCorrect++;
    }
  }

  console.log(`Cloud correct:   ${cloudCorrect}`);
  console.log(`Cloud missing:   ${cloudMissing}`);
  console.log(`Cloud STUCK (factory COMPLETE but cloud not complete): ${mismatches.length}\n`);

  console.log('Stuck list:');
  console.log('TICKET | VEHICLE          | MATERIAL           | CLOUD STATUS   | FACTORY NET');
  console.log('-------|------------------|--------------------|----------------|------------');
  for (const m of mismatches) {
    console.log(`${String(m.ticket).padEnd(6)} | ${(m.vehicle || '').padEnd(16)} | ${(m.factory.mat || '').slice(0,18).padEnd(18)} | ${m.cloud.status.padEnd(14)} | ${m.factory.n}`);
  }

  // Save the mismatch list for the fix script
  fs.writeFileSync('/tmp/stuck-weighments.json', JSON.stringify(mismatches, null, 2));
  console.log(`\nSaved ${mismatches.length} mismatches to /tmp/stuck-weighments.json`);

  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
