import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const r = await p.weighment.findMany({
    where: { ticketNo: { in: [532, 533] } },
    select: { ticketNo: true, vehicleNo: true, materialName: true, status: true, netWeight: true, tareWeight: true },
  });
  console.log(JSON.stringify(r, null, 2));
})().finally(() => p.$disconnect());
