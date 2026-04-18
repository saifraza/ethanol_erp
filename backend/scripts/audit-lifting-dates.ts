import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  // MASH contract
  const c = await p.ethanolContract.findFirst({ where: { contractNo: { contains: 'MASH/2026-01' } }, select: { id: true, contractNo: true } });
  if (!c) throw new Error('contract not found');
  console.log(`Contract: ${c.contractNo} (${c.id})\n`);

  const since = new Date('2026-04-10T18:30:00.000Z');
  const liftings = await p.ethanolLifting.findMany({
    where: { contractId: c.id, liftingDate: { gte: since } },
    select: { id: true, liftingDate: true, vehicleNo: true, quantityBL: true, invoiceNo: true, status: true, createdAt: true },
    orderBy: { liftingDate: 'asc' },
  });

  console.log(`Found ${liftings.length} liftings in last 10 days. Checking weighment match for each...\n`);
  console.log('VEHICLE          LIFTING.DATE   WEIGH.RELEASED         MATCH?  INVOICE');
  console.log('───────────────  ─────────────  ─────────────────────  ──────  ─────────────');

  for (const l of liftings) {
    // find the weighment for this vehicle with ETHANOL, completed in last 14 days
    const w = await p.weighment.findFirst({
      where: {
        vehicleNo: l.vehicleNo,
        materialName: { contains: 'Ethanol', mode: 'insensitive' },
        status: 'COMPLETE',
        secondWeightAt: {
          gte: new Date(l.liftingDate.getTime() - 3 * 24 * 60 * 60 * 1000),
          lt:  new Date(l.liftingDate.getTime() + 3 * 24 * 60 * 60 * 1000),
        },
      },
      select: { id: true, ticketNo: true, secondWeightAt: true },
      orderBy: { secondWeightAt: 'desc' },
    });

    const istLiftStr = l.liftingDate.toISOString().slice(0, 10);
    const istReleaseStr = w?.secondWeightAt
      ? new Date(w.secondWeightAt.getTime() + 5.5 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' IST'
      : 'NO_MATCH';
    const istReleaseDate = w?.secondWeightAt
      ? new Date(w.secondWeightAt.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10)
      : null;
    const match = istReleaseDate === istLiftStr ? '✅' : (w ? '❌ MISMATCH' : '⚠ no wb');
    console.log(`${l.vehicleNo.padEnd(16)} ${istLiftStr}     ${istReleaseStr.padEnd(22)} ${match.padEnd(7)} ${l.invoiceNo ?? ''}`);
  }

  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
