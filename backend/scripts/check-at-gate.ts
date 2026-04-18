import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  console.log('\n=== MASH contract: all DispatchTruck rows (with status) last 7d ===');
  const c = await p.ethanolContract.findFirst({ where: { contractNo: { contains: 'MASH/2026-01' } }, select: { id: true } });
  if (!c) return;
  const since = new Date('2026-04-11T00:00:00.000Z');
  const dt = await p.dispatchTruck.findMany({
    where: { contractId: c.id, createdAt: { gte: since } },
    select: { id: true, vehicleNo: true, status: true, date: true, gateInTime: true, grossTime: true, releaseTime: true, liftingId: true, sourceWbId: true, weightGross: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: 'desc' },
  });
  console.log(`count: ${dt.length}`);
  for (const r of dt) {
    console.log(`  ${r.vehicleNo.padEnd(14)} status=${(r.status||'null').padEnd(15)} gateIn=${r.gateInTime?.toISOString()?.slice(0,16) ?? 'null'} release=${r.releaseTime?.toISOString()?.slice(0,16) ?? 'null'}  lift=${r.liftingId?'Y':'N'} wbSrc=${r.sourceWbId?'Y':'N'} wGross=${r.weightGross ?? 'null'}`);
  }

  console.log('\n=== Currently at gate (status in GATE_IN/TARE_WEIGHED/GROSS_WEIGHED), ALL contracts ===');
  const atGate = await p.dispatchTruck.findMany({
    where: { status: { in: ['GATE_IN', 'TARE_WEIGHED', 'GROSS_WEIGHED'] } },
    select: { id: true, vehicleNo: true, status: true, partyName: true, contractId: true, gateInTime: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  console.log(`count at gate: ${atGate.length}`);
  for (const r of atGate) {
    console.log(`  ${r.vehicleNo.padEnd(14)} ${r.status.padEnd(15)} ${r.partyName?.slice(0,30)} ctr=${r.contractId?.slice(0,8)}`);
  }

  console.log('\n=== Weighment: OUTBOUND ethanol, status != COMPLETE last 3d (could-be-at-gate) ===');
  const recent = new Date('2026-04-15T00:00:00.000Z');
  const w = await p.weighment.findMany({
    where: {
      materialName: { contains: 'Ethanol', mode: 'insensitive' },
      status: { not: 'COMPLETE' },
      factoryCreatedAt: { gte: recent },
    },
    select: { id: true, ticketNo: true, vehicleNo: true, status: true, factoryCreatedAt: true, cancelled: true, cancelledReason: true },
    orderBy: { factoryCreatedAt: 'desc' },
  });
  console.log(JSON.stringify(w, null, 2));

  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
