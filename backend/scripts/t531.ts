import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const w = await p.weighment.findFirst({
    where: { ticketNo: 531 },
    select: { ticketNo: true, vehicleNo: true, materialName: true, direction: true, purchaseType: true, supplierName: true, customerName: true, status: true, grossWeight: true, tareWeight: true, netWeight: true, factoryCreatedAt: true, firstWeightAt: true, secondWeightAt: true, syncedAt: true, cancelled: true },
  });
  console.log('CLOUD Weighment t=531:', JSON.stringify(w, null, 2));
})().finally(() => p.$disconnect());
