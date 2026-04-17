/**
 * One-shot audit — does NOT write. Reports:
 *   1. All sale invoices with TCS + whether they have a JE
 *   2. All sale invoices in general + JE coverage
 *   3. Vendor invoices by status + totalGst coverage + JE coverage
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('── Sale invoice audit ──\n');

  const tcsInvoices = await prisma.invoice.findMany({
    where: { tcsAmount: { gt: 0 } },
    select: {
      id: true, invoiceNo: true, productName: true, invoiceDate: true,
      amount: true, gstAmount: true, tcsAmount: true, totalAmount: true, status: true,
    },
    orderBy: { invoiceNo: 'asc' },
  });
  console.log(`Sale invoices with TCS: ${tcsInvoices.length}`);
  for (const inv of tcsInvoices) {
    const je = await prisma.journalEntry.findFirst({
      where: { refType: 'SALE', refId: inv.id },
      select: { id: true, entryNo: true, lines: { select: { debit: true, credit: true } } },
    });
    const drSum = je?.lines.reduce((s, l) => s + l.debit, 0) || 0;
    const crSum = je?.lines.reduce((s, l) => s + l.credit, 0) || 0;
    const bal = Math.abs(drSum - crSum) < 0.01;
    console.log(`  INV-${inv.invoiceNo} · ${inv.invoiceDate.toISOString().slice(0, 10)} · ${inv.productName} · total=${inv.totalAmount} tcs=${inv.tcsAmount} · ${inv.status} · JE ${je ? `#${je.entryNo} dr=${drSum} cr=${crSum} ${bal ? 'BALANCED' : 'UNBALANCED'}` : 'MISSING'}`);
  }

  console.log('\n── Sale invoice overall coverage ──');
  const allInvs = await prisma.invoice.count({ where: { status: { not: 'CANCELLED' } } });
  const jeCoverage = await prisma.journalEntry.count({ where: { refType: 'SALE' } });
  console.log(`Non-cancelled invoices: ${allInvs} · SALE journals: ${jeCoverage}`);

  // Find invoices missing JEs
  const recent = await prisma.invoice.findMany({
    where: { status: { not: 'CANCELLED' } },
    select: { id: true, invoiceNo: true, invoiceDate: true, productName: true, totalAmount: true },
    orderBy: { invoiceDate: 'desc' },
    take: 20,
  });
  console.log('\nLast 20 non-cancelled sale invoices + JE status:');
  for (const inv of recent) {
    const je = await prisma.journalEntry.findFirst({
      where: { refType: 'SALE', refId: inv.id },
      select: { id: true, entryNo: true },
    });
    console.log(`  INV-${inv.invoiceNo} · ${inv.invoiceDate.toISOString().slice(0, 10)} · ${inv.productName} · ${je ? `JE #${je.entryNo}` : 'NO JE'}`);
  }

  console.log('\n── Vendor invoice audit ──');
  const viByStatus = await prisma.vendorInvoice.groupBy({
    by: ['status'],
    _count: true,
    _sum: { totalGst: true },
  });
  console.log('\nVendor invoices by status:');
  for (const s of viByStatus) {
    console.log(`  ${s.status}: count=${s._count} totalGst=${s._sum.totalGst?.toFixed(2) || 0}`);
  }

  console.log('\nLast 20 vendor invoices with GST>0:');
  const recentVi = await prisma.vendorInvoice.findMany({
    where: { totalGst: { gt: 0 } },
    select: { id: true, invoiceNo: true, vendorInvNo: true, invoiceDate: true, status: true, totalGst: true, isRCM: true, itcEligible: true, itcClaimed: true },
    orderBy: { invoiceDate: 'desc' },
    take: 20,
  });
  for (const vi of recentVi) {
    const je = await prisma.journalEntry.findFirst({
      where: { refType: 'PURCHASE', refId: vi.id, narration: { contains: 'Input GST' } },
      select: { id: true, entryNo: true },
    });
    const flags = [vi.isRCM && 'RCM', !vi.itcEligible && 'ITC-INELIG', vi.itcClaimed && 'CLAIMED'].filter(Boolean).join(',');
    console.log(`  VI-${vi.invoiceNo}${vi.vendorInvNo ? ` (${vi.vendorInvNo})` : ''} · ${vi.invoiceDate.toISOString().slice(0, 10)} · ${vi.status} · gst=${vi.totalGst} ${flags ? `[${flags}]` : ''} · ${je ? `JE #${je.entryNo}` : 'NO Input-GST JE'}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); }).finally(() => prisma.$disconnect());
