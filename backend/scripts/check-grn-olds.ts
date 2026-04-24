import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  for (const n of [17, 21, 424, 427, 471]) {
    const g = await p.goodsReceipt.findFirst({ where: { grnNo: n }, select: { grnNo: true, vehicleNo: true, createdAt: true, netWeight: true, grossWeight: true, tareWeight: true, ticketNo: true } });
    console.log(`GRN#${n}:`, JSON.stringify(g));
  }
})().finally(() => p.$disconnect());
