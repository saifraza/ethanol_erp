import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const loanTabs = await p.$queryRawUnsafe<any[]>(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('BankLoan','LoanRepayment')`);
  console.log('Loan tables:', loanTabs.map(r => r.table_name));
  const accs = await p.account.findMany({ where: { code: { in: ['2250', '5999'] } }, select: { code: true, name: true } });
  console.log('Special accounts:', accs);
  const invCount = await p.invoice.count({ where: { status: { not: 'CANCELLED' } } });
  const saleJeCount = await p.journalEntry.count({ where: { refType: 'SALE' } });
  console.log(`Invoices: ${invCount} · SALE JEs: ${saleJeCount}`);
  const inv203 = await p.invoice.findFirst({ where: { invoiceNo: 203 }, select: { id: true } });
  if (inv203) {
    const jes = await p.journalEntry.findMany({ where: { refId: inv203.id }, select: { entryNo: true, narration: true } });
    console.log(`INV-203 JEs:`, jes);
  }
  const mx = await p.journalEntry.aggregate({ _max: { entryNo: true } });
  console.log(`Max entryNo: ${mx._max.entryNo}`);
  const all = await p.invoice.findMany({ where: { status: { not: 'CANCELLED' } }, select: { id: true, invoiceNo: true }, orderBy: { invoiceDate: 'desc' }, take: 30 });
  const missing: any[] = [];
  for (const inv of all) {
    const je = await p.journalEntry.findFirst({ where: { refType: 'SALE', refId: inv.id }, select: { id: true } });
    if (!je) missing.push(`INV-${inv.invoiceNo}`);
  }
  console.log(`Last 30 invoices missing JE: ${missing.length ? missing.join(', ') : 'none'}`);
  await p.$disconnect();
})();
