import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const tickets = [570, 572, 573, 574, 575, 577];
  let fixed = 0;
  for (const t of tickets) {
    const w = await p.weighment.findFirst({
      where: { ticketNo: t },
      select: { vehicleNo: true, grossWeight: true, tareWeight: true, netWeight: true, supplierName: true },
    });
    if (!w || !w.netWeight) { console.log(`t=${t} no weighment or net`); continue; }

    const grossT = (w.grossWeight || 0) / 1000;
    const tareT = (w.tareWeight || 0) / 1000;
    const netT = w.netWeight / 1000;

    const start = new Date('2026-04-17T18:30:00.000Z');
    const grns = await p.goodsReceipt.findMany({
      where: { vehicleNo: w.vehicleNo, createdAt: { gte: start }, netWeight: null as any },
    });
    for (const grn of grns) {
      await p.goodsReceipt.update({
        where: { id: grn.id },
        data: { grossWeight: grossT, tareWeight: tareT, netWeight: netT },
      });
      console.log(`✓ t=${t} ${w.vehicleNo} GRN#${grn.grnNo} set net=${netT}T (from ${w.netWeight}kg)`);
      fixed++;
    }
  }
  console.log(`\nTotal GRN rows fixed: ${fixed}`);
  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
