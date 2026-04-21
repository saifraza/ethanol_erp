/**
 * audit-company-nulls.ts — READ-ONLY diagnostic.
 *
 * Counts rows with companyId IS NULL across every model that has companyId.
 * Also checks whether backfilling to MSPIL_ID would violate any existing unique
 * constraint (would happen if a NULL row and a MSPIL_ID row share a unique key).
 *
 * Usage:
 *   cd backend
 *   DATABASE_URL=<prod-read-only-url> npx ts-node scripts/audit-company-nulls.ts
 *
 * Safety: NO writes. Read-only SELECTs only. Safe to run at any time.
 */
import prisma from '../src/config/prisma';

const MSPIL_ID = 'b499264a-8c73-4595-ab9b-7dc58f58c4d2';

// Tables with nullable companyId column (pulled from schema.prisma 2026-04-21)
// Each entry is the DB table name (Prisma PascalCase model name).
const TABLES_WITH_COMPANY_ID = [
  'User', 'DDGSDispatchTruck', 'DispatchTruck', 'GrainTruck', 'InventoryItem',
  'Department', 'Warehouse', 'StockLevel', 'StockMovement', 'PurchaseRequisition',
  'Customer', 'Product', 'Transporter', 'SalesOrder', 'DispatchRequest',
  'Shipment', 'FreightInquiry', 'FreightQuotation', 'TransporterPayment',
  'Invoice', 'Payment', 'Vendor', 'Material', 'PurchaseOrder', 'GoodsReceipt',
  'VendorInvoice', 'VendorPayment', 'Contractor', 'ContractorBill',
  'ContractorPayment', 'ContractorStoreIssue', 'DirectPurchase', 'DirectSale',
  'EthanolContract', 'Account', 'JournalEntry', 'BankTransaction', 'CashVoucher',
  'BankLoan', 'LoanRepayment', 'PostDatedCheque', 'BankPaymentBatch', 'Approval',
  'DDGSContract', 'SugarDispatchTruck', 'SugarContract', 'FiscalYear',
  'InvoiceSeries', 'Designation', 'Employee', 'PayrollRun',
];

// Tables with a numbered field whose uniqueness bug manifests as duplicate doc numbers.
// Backfill only matters if NULL rows share a number with an existing MSPIL_ID row.
const NUMBERED_SEQUENCES: Array<{ table: string; field: string }> = [
  { table: 'PurchaseOrder', field: 'poNo' },
  { table: 'Invoice', field: 'invoiceNo' },
  { table: 'VendorInvoice', field: 'invoiceNo' },
  { table: 'GoodsReceipt', field: 'grnNo' },
  { table: 'SalesOrder', field: 'orderNo' },
  { table: 'VendorPayment', field: 'paymentNo' },
  { table: 'JournalEntry', field: 'entryNo' },
  { table: 'Shipment', field: 'shipmentNo' },
];

async function main() {
  console.log('='.repeat(70));
  console.log('COMPANY NULL AUDIT — read-only, no writes');
  console.log('MSPIL_ID =', MSPIL_ID);
  console.log('='.repeat(70));

  // 1) Per-table null counts
  console.log('\nPart 1 — rows with companyId IS NULL per table');
  console.log('-'.repeat(70));
  let totalNulls = 0;
  const tablesWithNulls: string[] = [];
  for (const table of TABLES_WITH_COMPANY_ID) {
    try {
      const r: Array<{ n: bigint }> = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::bigint AS n FROM "${table}" WHERE "companyId" IS NULL`,
      );
      const n = Number(r[0]?.n ?? 0n);
      if (n > 0) {
        console.log(`  ${table.padEnd(30)} ${n.toString().padStart(8)} NULL rows`);
        totalNulls += n;
        tablesWithNulls.push(table);
      }
    } catch (e) {
      console.log(`  ${table.padEnd(30)}   ERROR: ${(e as Error).message}`);
    }
  }
  console.log('-'.repeat(70));
  console.log(`  TOTAL NULL rows across ${tablesWithNulls.length} tables: ${totalNulls}`);

  // 2) Per numbered-sequence: count duplicate numbers between NULL and MSPIL_ID rows
  console.log('\nPart 2 — duplicate document numbers (NULL row ↔ MSPIL_ID row)');
  console.log('These are cases where a backfill WOULD NOT be safe without cleanup first.');
  console.log('-'.repeat(70));
  let totalConflicts = 0;
  for (const { table, field } of NUMBERED_SEQUENCES) {
    try {
      const r: Array<{ n: bigint }> = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::bigint AS n FROM (
           SELECT "${field}" FROM "${table}" WHERE "companyId" IS NULL
           INTERSECT
           SELECT "${field}" FROM "${table}" WHERE "companyId" = $1
         ) AS dup`,
        MSPIL_ID,
      );
      const n = Number(r[0]?.n ?? 0n);
      const status = n === 0 ? 'OK  (no conflicts)' : `CONFLICT (${n} duplicate ${field}s)`;
      console.log(`  ${table.padEnd(20)} ${field.padEnd(12)} ${status}`);
      totalConflicts += n;
    } catch (e) {
      console.log(`  ${table.padEnd(20)} ${field.padEnd(12)} ERROR: ${(e as Error).message}`);
    }
  }
  console.log('-'.repeat(70));
  console.log(`  TOTAL conflicting doc numbers: ${totalConflicts}`);

  // 3) Per numbered-sequence: list the actual duplicate numbers (capped to 20 per table)
  if (totalConflicts > 0) {
    console.log('\nPart 3 — duplicate doc numbers (first 20 per table)');
    console.log('-'.repeat(70));
    for (const { table, field } of NUMBERED_SEQUENCES) {
      try {
        const r: Array<Record<string, unknown>> = await prisma.$queryRawUnsafe(
          `SELECT "${field}" AS v FROM "${table}" WHERE "companyId" IS NULL
           INTERSECT
           SELECT "${field}" AS v FROM "${table}" WHERE "companyId" = $1
           ORDER BY v LIMIT 20`,
          MSPIL_ID,
        );
        if (r.length > 0) {
          console.log(`  ${table}.${field}: ${r.map(x => String(x.v)).join(', ')}`);
        }
      } catch { /* ignore */ }
    }
  }

  console.log('\n='.repeat(70));
  console.log('Summary');
  console.log('='.repeat(70));
  console.log(`  ${totalNulls} rows across ${tablesWithNulls.length} tables have companyId = NULL`);
  console.log(`  ${totalConflicts} document numbers are duplicated (NULL vs MSPIL_ID)`);
  if (totalConflicts === 0) {
    console.log('\n  ✓ Safe to backfill NULL → MSPIL_ID. No unique conflicts.');
  } else {
    console.log('\n  ⚠ Resolve the duplicate doc numbers BEFORE backfilling.');
    console.log('    Typical fix: rename the newer (MSPIL_ID) duplicates to the next free');
    console.log('    number, so backfill of the older NULL rows does not violate uniqueness.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
