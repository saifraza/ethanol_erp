/**
 * Surgical DDL — creates ONLY the BankLoan + LoanRepayment tables.
 * Idempotent (uses IF NOT EXISTS). Touches nothing else.
 *
 * Needed because Railway's `prisma db push` has been silently failing due to
 * data-loss warnings on unrelated unique constraints. This is a targeted fix.
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');

const DDL = [
  `CREATE TABLE IF NOT EXISTS "BankLoan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "loanNo" TEXT NOT NULL UNIQUE,
    "bankName" TEXT NOT NULL,
    "bankAccountCode" TEXT,
    "loanType" TEXT NOT NULL DEFAULT 'TERM_LOAN',
    "sanctionAmount" DOUBLE PRECISION NOT NULL,
    "disbursedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outstandingAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "interestRate" DOUBLE PRECISION NOT NULL,
    "tenure" INTEGER NOT NULL,
    "emiAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sanctionDate" TIMESTAMP(3) NOT NULL,
    "disbursementDate" TIMESTAMP(3),
    "maturityDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "repaymentFrequency" TEXT NOT NULL DEFAULT 'MONTHLY',
    "securityDetails" TEXT,
    "remarks" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS "BankLoan_status_idx" ON "BankLoan"("status")`,
  `CREATE INDEX IF NOT EXISTS "BankLoan_bankName_idx" ON "BankLoan"("bankName")`,
  `CREATE INDEX IF NOT EXISTS "BankLoan_companyId_idx" ON "BankLoan"("companyId")`,
  `CREATE TABLE IF NOT EXISTS "LoanRepayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "loanId" TEXT NOT NULL,
    "installmentNo" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "principalAmount" DOUBLE PRECISION NOT NULL,
    "interestAmount" DOUBLE PRECISION NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "outstandingAfter" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "paidDate" TIMESTAMP(3),
    "paymentMode" TEXT,
    "paymentRef" TEXT,
    "journalEntryId" TEXT,
    "remarks" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT,
    CONSTRAINT "LoanRepayment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "BankLoan"("id") ON DELETE RESTRICT ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "LoanRepayment_loanId_idx" ON "LoanRepayment"("loanId")`,
  `CREATE INDEX IF NOT EXISTS "LoanRepayment_dueDate_idx" ON "LoanRepayment"("dueDate")`,
  `CREATE INDEX IF NOT EXISTS "LoanRepayment_status_idx" ON "LoanRepayment"("status")`,
  `CREATE INDEX IF NOT EXISTS "LoanRepayment_companyId_idx" ON "LoanRepayment"("companyId")`,
];

async function main() {
  const before = await prisma.$queryRawUnsafe<any[]>(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('BankLoan','LoanRepayment')`);
  console.log('Existing loan tables:', before.map(r => r.table_name));
  if (before.length === 2) {
    console.log('Both tables already exist. No-op.');
    return;
  }

  console.log(`\nMode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  for (const sql of DDL) {
    const preview = sql.split('\n')[0].trim().slice(0, 100);
    console.log(`  ${APPLY ? 'EXEC' : '[DRY]'}: ${preview}…`);
    if (APPLY) await prisma.$executeRawUnsafe(sql);
  }

  if (APPLY) {
    const after = await prisma.$queryRawUnsafe<any[]>(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('BankLoan','LoanRepayment')`);
    console.log('\nCreated:', after.map(r => r.table_name));
  }
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
