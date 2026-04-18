import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  console.log('\n=== EthanolContract where status = ACTIVE (what factory queries) ===');
  const ec = await p.ethanolContract.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, contractNo: true, contractType: true, buyerName: true, status: true, companyId: true, startDate: true, endDate: true },
  });
  console.log(JSON.stringify(ec, null, 2));
  console.log(`active eth contracts: ${ec.length}`);

  console.log('\n=== EthanolContract ALL status distribution ===');
  const all = await p.ethanolContract.groupBy({
    by: ['status'],
    _count: true,
  });
  console.log(JSON.stringify(all, null, 2));

  console.log('\n=== All EthanolContract rows (any status) — name + type + company ===');
  const allRows = await p.ethanolContract.findMany({
    select: { id: true, contractNo: true, contractType: true, status: true, companyId: true, startDate: true, endDate: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  console.log(JSON.stringify(allRows, null, 2));

  console.log('\n=== JOB_WORK PurchaseOrder (raw material) status ===');
  const po = await p.purchaseOrder.groupBy({
    by: ['dealType', 'status'],
    _count: true,
    where: { dealType: { in: ['JOB_WORK', 'STANDARD', 'SPOT'] } },
  });
  console.log(JSON.stringify(po, null, 2));

  console.log('\n=== JOB_WORK active POs ===');
  const jpo = await p.purchaseOrder.findMany({
    where: { dealType: 'JOB_WORK', status: { in: ['APPROVED', 'SENT', 'PARTIAL_RECEIVED'] } },
    select: { id: true, poNo: true, vendor: { select: { name: true } }, status: true, companyId: true, deliveryDate: true },
    orderBy: { poNo: 'desc' },
    take: 10,
  });
  console.log(JSON.stringify(jpo, null, 2));

  console.log('\n=== Active Companies ===');
  const cos = await p.company.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true, isDefault: true },
  });
  console.log(JSON.stringify(cos, null, 2));

  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
