import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  // 1. Check contract's auto-e-invoice toggle
  console.log('=== Ethanol contracts — autoGenerateEInvoice flag ===');
  const contracts = await p.ethanolContract.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, contractNo: true, contractType: true, autoGenerateEInvoice: true, buyerName: true },
  });
  for (const c of contracts) console.log(`  ${c.contractNo.padEnd(30)} auto=${c.autoGenerateEInvoice} ${c.buyerName}`);

  // 2. Recent liftings — check IRN + EWB generation
  console.log('\n=== Last 10 ethanol liftings — IRN/EWB status ===');
  const ls = await p.ethanolLifting.findMany({
    where: { liftingDate: { gte: new Date('2026-04-12T00:00:00Z') } },
    select: {
      liftingDate: true, vehicleNo: true, invoiceNo: true, invoiceId: true,
      invoice: { select: { irnStatus: true, irn: true, ewbStatus: true, ewbNo: true, status: true } },
    },
    orderBy: { liftingDate: 'desc' },
    take: 10,
  });
  console.log('DATE       | VEHICLE        | INVOICE       | IRN         | EWB');
  console.log('-----------|----------------|---------------|-------------|---------');
  for (const l of ls) {
    const d = l.liftingDate.toISOString().slice(0, 10);
    const v = (l.vehicleNo || '').padEnd(14);
    const i = (l.invoiceNo || '-').padEnd(13);
    const irn = (l.invoice?.irnStatus || 'none').padEnd(11);
    const ewb = (l.invoice?.ewbStatus || 'none').padEnd(11);
    console.log(`${d} | ${v} | ${i} | ${irn} | ${ewb}`);
  }

  // 3. Recent PlantIssue errors related to e-invoice
  console.log('\n=== PlantIssue: e-invoice / IRN errors last 3 days ===');
  const issues = await p.plantIssue.findMany({
    where: {
      createdAt: { gte: new Date(Date.now() - 3 * 86400000) },
      OR: [
        { title: { contains: 'IRN', mode: 'insensitive' } },
        { title: { contains: 'e-invoice', mode: 'insensitive' } },
        { title: { contains: 'EWB', mode: 'insensitive' } },
        { description: { contains: 'IRN', mode: 'insensitive' } },
      ],
    },
    select: { title: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  console.log(`found ${issues.length}`);
  for (const i of issues) console.log(`  ${i.createdAt.toISOString().slice(0,16)} [${i.status}] ${i.title}`);

  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
