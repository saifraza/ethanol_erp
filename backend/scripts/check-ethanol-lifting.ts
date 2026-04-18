import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  const istStart = new Date('2026-04-16T18:30:00.000Z');
  const istEnd   = new Date('2026-04-17T18:30:00.000Z');

  console.log('\n=== EthanolLifting created/liftingDate on 2026-04-17 IST ===');
  const ls = await p.ethanolLifting.findMany({
    where: {
      OR: [
        { liftingDate: { gte: istStart, lt: istEnd } },
        { createdAt: { gte: istStart, lt: istEnd } },
      ],
    },
    select: {
      id: true, contractId: true, liftingDate: true, vehicleNo: true, quantityBL: true,
      quantityKL: true, status: true, invoiceNo: true, invoiceId: true,
      rstNo: true, challanNo: true, createdAt: true, updatedAt: true, deliveredAt: true,
    },
    orderBy: { liftingDate: 'asc' },
  });
  console.log(JSON.stringify(ls, null, 2));
  console.log(`count: ${ls.length}`);

  console.log('\n=== EthanolLifting for MASH contract 2026-01 (last 7 days) ===');
  const mashContract = await p.ethanolContract.findFirst({
    where: { contractNo: { contains: 'MASH/2026-01' } },
    select: { id: true, contractNo: true },
  });
  console.log('contract:', mashContract);
  if (mashContract) {
    const recent = await p.ethanolLifting.findMany({
      where: {
        contractId: mashContract.id,
        liftingDate: { gte: new Date('2026-04-11T18:30:00.000Z') },
      },
      select: {
        id: true, liftingDate: true, vehicleNo: true, quantityBL: true, status: true,
        invoiceNo: true, createdAt: true, updatedAt: true,
      },
      orderBy: { liftingDate: 'desc' },
    });
    console.log(JSON.stringify(recent, null, 2));
  }

  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
