import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const w = await p.weighment.findFirst({
    where: { ticketNo: 529 },
    select: { ticketNo: true, vehicleNo: true, materialName: true, direction: true, purchaseType: true, supplierName: true, status: true, grossWeight: true, tareWeight: true, netWeight: true, firstWeightAt: true, secondWeightAt: true, syncedAt: true },
  });
  console.log('CLOUD t=529:', JSON.stringify(w, null, 2));
})().finally(() => p.$disconnect());
