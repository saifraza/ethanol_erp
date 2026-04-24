import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // 1. Vendors with TDS configured
  const vendorsWithTds = await prisma.vendor.findMany({
    where: { OR: [{ tdsSection: { not: null } }, { tdsSectionId: { not: null } }] },
    select: { id: true, name: true, tdsSection: true, tdsPercent: true, tdsSectionId: true, tdsSectionRef: { select: { newSection: true, rateOthers: true, rateIndividual: true } } },
    take: 30,
  });
  console.log(`\n=== Vendors with TDS configured: ${vendorsWithTds.length} ===`);
  for (const v of vendorsWithTds) {
    console.log(`  ${v.name}  legacy_sec=${v.tdsSection} pct=${v.tdsPercent}  ref=${v.tdsSectionRef?.newSection}@${v.tdsSectionRef?.rateOthers}/${v.tdsSectionRef?.rateIndividual}%`);
  }

  // Count vendors WITHOUT TDS
  const totalVendors = await prisma.vendor.count();
  console.log(`\nTotal vendors: ${totalVendors}, with TDS: ${vendorsWithTds.length}, without: ${totalVendors - vendorsWithTds.length}`);

  // 2. The 3 vendors that got paid in FY26 — check their TDS settings
  const vendorIds = [
    'MATRIX CORPORATION', 'Rajasthan sales service transport', 'JAY BAJRANG BHOOSA BHANDAR',
  ];
  const checked = await prisma.vendor.findMany({
    where: { name: { in: vendorIds } },
    select: { id: true, name: true, tdsSection: true, tdsPercent: true, tdsSectionId: true, tdsSectionRef: { select: { newSection: true, rateOthers: true, rateIndividual: true } }, pan: true, tdsApplicable: true },
  });
  console.log(`\n=== TDS config for the 3 paid vendors ===`);
  for (const v of checked) console.log(`  ${v.name}  PAN=${v.pan} tdsApp=${v.tdsApplicable}  legacy_sec=${v.tdsSection}/${v.tdsPercent}%  ref=${v.tdsSectionRef?.newSection}/${v.tdsSectionRef?.rateOthers}%`);

  // 3. TDS section master entries
  const tdsSections = await prisma.tdsSection.findMany({ select: { newSection: true, oldSection: true, nature: true, rateIndividual: true, rateOthers: true, thresholdSingle: true, isActive: true } });
  console.log(`\n=== TDS Section master: ${tdsSections.length} entries ===`);
  for (const s of tdsSections) console.log(`  ${s.newSection}  ${s.nature}  rate=${s.rateOthers}%/${s.rateIndividual}% threshold=${s.thresholdSingle} active=${s.isActive}`);

  // 4. TCS section master
  const tcsSections = await (prisma as any).tcsSection?.findMany?.({});
  console.log(`\n=== TCS Section master: ${tcsSections?.length ?? 'NO MODEL'} ===`);
  if (tcsSections) for (const s of tcsSections) console.log(`  ${s.code}  ${s.description}  rate=${s.ratePercent}%`);

  // 5. Sample POs — do they have any TDS info?
  const pos = await prisma.purchaseOrder.findMany({
    where: { createdAt: { gte: new Date('2026-04-01') } },
    select: { poNo: true, vendor: { select: { name: true } }, tdsApplicable: true, tdsAmount: true, overrideTdsSectionId: true, overrideTdsSection: { select: { newSection: true } }, grandTotal: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  console.log(`\n=== Sample FY26 POs — TDS fields ===`);
  for (const p of pos) console.log(`  PO#${p.poNo}  ${p.vendor?.name}  total=${p.grandTotal}  tdsApp=${p.tdsApplicable} tdsAmt=${p.tdsAmount} override=${p.overrideTdsSection?.newSection}`);

  // 6. VendorInvoices with TDS (look at fields used by autoJournal)
  const visWithTds = await prisma.vendorInvoice.count({ where: { tdsAmount: { gt: 0 } } });
  const visTotal = await prisma.vendorInvoice.count({});
  console.log(`\n=== VendorInvoices total ${visTotal}, with TDS amount > 0: ${visWithTds} ===`);

  // 7. All-time TDS-deducted vendor payments
  const allTdsPayments = await prisma.vendorPayment.count({ where: { tdsDeducted: { gt: 0 } } });
  const allPayments = await prisma.vendorPayment.count({});
  console.log(`\n=== VendorPayments total ${allPayments}, with tdsDeducted > 0: ${allTdsPayments} ===`);
  const recentTds = await prisma.vendorPayment.findMany({
    where: { tdsDeducted: { gt: 0 } },
    select: { paymentNo: true, paymentDate: true, amount: true, tdsDeducted: true, tdsSection: true, vendor: { select: { name: true } } },
    orderBy: { paymentDate: 'desc' },
    take: 10,
  });
  for (const p of recentTds) console.log(`  #${p.paymentNo} ${p.paymentDate.toISOString().slice(0,10)} ${p.vendor?.name} amt=${p.amount} tds=${p.tdsDeducted} sec=${p.tdsSection}`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
