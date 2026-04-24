import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const c = await p.ethanolContract.findFirst({ where: { contractNo: { contains: 'MASH/2026-01' } }, select: { id: true, contractNo: true } });
  console.log('Contract:', c?.contractNo || 'NOT FOUND');
  if (!c) { await p.$disconnect(); return; }

  const ls = await p.ethanolLifting.findMany({
    where: { contractId: c.id },
    select: { id: true, liftingDate: true, vehicleNo: true, invoiceNo: true, status: true, createdAt: true },
    orderBy: { liftingDate: 'desc' },
    take: 15,
  });
  console.log(`\n=== Last 15 liftings for MASH ===`);
  for (const l of ls) console.log(`  ${l.liftingDate.toISOString().slice(0,10)} | ${l.vehicleNo.padEnd(14)} | ${(l.invoiceNo ?? '').padEnd(14)} | ${l.status}`);

  console.log(`\n=== Weighment mirror — ethanol OUTBOUND last 3 days ===`);
  const wm = await p.weighment.findMany({
    where: { materialName: { contains: 'Ethanol', mode: 'insensitive' } },
    select: { ticketNo: true, vehicleNo: true, secondWeightAt: true, status: true, factoryCreatedAt: true },
    orderBy: { factoryCreatedAt: 'desc' },
    take: 10,
  });
  for (const w of wm) console.log(`  ticket=${w.ticketNo} ${w.vehicleNo?.padEnd(14)} | 2w=${w.secondWeightAt?.toISOString() ?? 'null'} | ${w.status}`);

  console.log(`\n=== All DispatchTruck for MASH in last 3 days ===`);
  const dt = await p.dispatchTruck.findMany({
    where: {
      partyName: { contains: 'MASH', mode: 'insensitive' },
      createdAt: { gte: new Date(Date.now() - 3 * 86400000) },
    },
    select: { id: true, vehicleNo: true, date: true, weightNet: true, status: true, liftingId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  for (const d of dt) console.log(`  ${d.createdAt.toISOString()} ${d.vehicleNo.padEnd(14)} | ${d.status} | net=${d.weightNet ?? 'null'} | lift=${d.liftingId ? 'Y' : 'N'}`);

  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
