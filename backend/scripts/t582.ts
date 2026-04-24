import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const w = await p.weighment.findFirst({ where: { ticketNo: 582 }, select: { ticketNo: true, vehicleNo: true, materialName: true, status: true, grossWeight: true, tareWeight: true, syncedAt: true } });
  console.log('Cloud Weighment mirror t=582:', JSON.stringify(w, null, 2));
  const dt = await (p as any).dDGSDispatchTruck?.findFirst({ where: { vehicleNo: 'MP65GA1273' }, orderBy: { createdAt: 'desc' }, select: { status: true, weightTare: true, createdAt: true } });
  console.log('DDGSDispatchTruck latest:', JSON.stringify(dt, null, 2));
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
