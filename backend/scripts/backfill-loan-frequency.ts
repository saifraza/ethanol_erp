import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Quarterly term loans
  const quarterlyLoanNos = ['IREDA-TL', '788306390000005', '325606390042131'];
  const r1 = await prisma.bankLoan.updateMany({
    where: { loanNo: { in: quarterlyLoanNos } },
    data: { repaymentFrequency: 'QUARTERLY' },
  });
  console.log(`QUARTERLY (3 TLs): ${r1.count}`);

  // CC_LIMIT → NONE (interest-only revolving)
  const r2 = await prisma.bankLoan.updateMany({
    where: { loanType: 'CC_LIMIT' },
    data: { repaymentFrequency: 'NONE' },
  });
  console.log(`NONE — CC_LIMIT: ${r2.count}`);

  // Pledge/Warehouse → NONE (interest-only)
  const r3 = await prisma.bankLoan.updateMany({
    where: { loanNo: { in: ['AXIS-WAREHOUSE', '325605050000104'] } },
    data: { repaymentFrequency: 'NONE' },
  });
  console.log(`NONE — Pledge/Warehouse: ${r3.count}`);

  // Everything else is already MONTHLY by default — verify
  const counts = await prisma.bankLoan.groupBy({
    by: ['repaymentFrequency'],
    _count: { id: true },
  });
  console.log('\nFinal distribution:');
  for (const c of counts) {
    console.log(`  ${c.repaymentFrequency}: ${c._count.id} loans`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
