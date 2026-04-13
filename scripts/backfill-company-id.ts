/**
 * One-time backfill: set companyId = MSPIL for all records where it's null.
 * Safe to run multiple times (idempotent).
 *
 * Usage: cd backend && npx tsx ../scripts/backfill-company-id.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const MSPIL_ID = 'b499264a-8c73-4595-ab9b-7dc58f58c4d2';

const TABLES = [
  'Account', 'JournalEntry', 'PurchaseOrder', 'GoodsReceipt',
  'Vendor', 'VendorInvoice', 'VendorPayment', 'GrainTruck', 'User',
  // New tables
  'Customer', 'SalesOrder', 'Invoice', 'Payment',
  'BankTransaction', 'BankPaymentBatch', 'CashVoucher',
  'PostDatedCheque', 'BankLoan', 'StockMovement', 'StockLevel', 'InventoryItem',
] as const;

async function main() {
  // Verify MSPIL company exists
  const mspil = await prisma.company.findUnique({ where: { id: MSPIL_ID } });
  if (!mspil) {
    console.error(`MSPIL company not found with ID ${MSPIL_ID}`);
    process.exit(1);
  }
  console.log(`Found MSPIL: ${mspil.name} (${mspil.code})`);

  for (const table of TABLES) {
    try {
      // @ts-ignore — dynamic table access
      const count = await prisma[table[0].toLowerCase() + table.slice(1)].updateMany({
        where: { companyId: null },
        data: { companyId: MSPIL_ID },
      });
      console.log(`${table}: ${count.count} records backfilled`);
    } catch (err: any) {
      console.error(`${table}: FAILED — ${err.message}`);
    }
  }

  console.log('\nDone. All null companyId records set to MSPIL.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
