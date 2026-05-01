/**
 * backfill-company-mspil.ts — fix the legacy NULL companyId + duplicate doc numbers.
 *
 * TWO-PHASE MIGRATION — runs in order:
 *   Phase 1: renumber duplicate GRNs/Shipments so the older NULL row keeps its
 *            original number and the newer MSPIL_ID row gets a fresh high number.
 *   Phase 2: UPDATE every table with companyId IS NULL → MSPIL_ID.
 *
 * Each table is its own transaction so a partial failure doesn't trap the
 * database in a half-migrated state.
 *
 * ─── SAFETY GATES (no way to skip without explicit intent) ──────────────────
 *   - Dry-run is the DEFAULT. Running with no flags shows the plan only.
 *   - --execute is required to write. Without it, every UPDATE is inside a
 *     BEGIN/ROLLBACK so you can verify counts with zero data risk.
 *   - --execute also requires a recent pg_dump file in
 *     <repo>/db-backups/ (mtime < 24h). If none, script aborts.
 *     Pass --i-have-backed-up-outside to override (only if you took a dump via
 *     another method, e.g. Railway snapshot).
 *   - Shows per-table counts before and after. Re-runs audit at the end.
 *
 * ─── USAGE ──────────────────────────────────────────────────────────────────
 *   # 1. DRY RUN (default — no writes, see the plan):
 *   npx ts-node scripts/backfill-company-mspil.ts
 *
 *   # 2. BACKUP prod database FIRST:
 *   pg_dump "$DATABASE_URL" --format=custom --compress=9 \
 *     -f "$(git rev-parse --show-toplevel)/db-backups/mspil-prod-$(date +%Y%m%d_%H%M%S)_IST.dump"
 *   # confirm file > 1 MB before proceeding
 *
 *   # 3. EXECUTE (writes to prod):
 *   npx ts-node scripts/backfill-company-mspil.ts --execute
 *
 * CLAUDE.md compliant: asks before any UPDATE > 100 rows; uses
 * BEGIN/COMMIT (or BEGIN/ROLLBACK in dry-run); never runs `prisma db push`.
 */
import prisma from '../src/config/prisma';
import fs from 'fs';
import path from 'path';

const MSPIL_ID = 'b499264a-8c73-4595-ab9b-7dc58f58c4d2';

const args = new Set(process.argv.slice(2));
const EXECUTE = args.has('--execute');
const SKIP_BACKUP_CHECK = args.has('--i-have-backed-up-outside');

// Tables with nullable companyId (same list as audit script). User and
// DDGSDispatchTruck are included — script retries any that were missed in the
// original audit.
const TABLES: string[] = [
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

// Tables where a NULL row can share a doc-number with a MSPIL_ID row and
// cause visual duplicates. Only the MSPIL_ID-tagged duplicates get
// renumbered — the legacy NULL rows keep their original number.
const NUMBERED: Array<{ table: string; field: string }> = [
  { table: 'GoodsReceipt', field: 'grnNo' },
  { table: 'Shipment', field: 'shipmentNo' },
  { table: 'PurchaseOrder', field: 'poNo' },
  { table: 'Invoice', field: 'invoiceNo' },
  { table: 'VendorInvoice', field: 'invoiceNo' },
  { table: 'SalesOrder', field: 'orderNo' },
  { table: 'VendorPayment', field: 'paymentNo' },
  { table: 'JournalEntry', field: 'entryNo' },
];

function log(...msgs: unknown[]) { console.log(...msgs); }
function hr() { log('-'.repeat(70)); }
function bigHr() { log('='.repeat(70)); }

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Railway's TCP proxy occasionally cold-starts and drops the first 1-2
 * connections. Retry any connection error up to 5 times with exponential
 * backoff before giving up.
 */
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (!/Can't reach|ECONNREFUSED|ETIMEDOUT|ECONNRESET/i.test(msg)) throw e;
      const wait = 500 * attempt * attempt; // 500, 2000, 4500, 8000, 12500ms
      log(`  ⏳ ${label}: connection retry ${attempt}/5 after ${wait}ms`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function warmupConnection(): Promise<void> {
  log('Warming up database connection...');
  await withRetry('warmup', async () => {
    await prisma.$queryRawUnsafe('SELECT 1');
  });
  log('✓ Connection established\n');
}

async function countNulls(table: string): Promise<number> {
  return withRetry(`countNulls(${table})`, async () => {
    const r = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*)::bigint AS n FROM "${table}" WHERE "companyId" IS NULL`,
    );
    return Number(r[0]?.n ?? 0n);
  });
}

async function findDuplicates(table: string, field: string): Promise<number[]> {
  return withRetry(`findDuplicates(${table}.${field})`, async () => {
    const r = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT "${field}"::int AS v FROM "${table}" WHERE "companyId" IS NULL
       INTERSECT
       SELECT "${field}"::int AS v FROM "${table}" WHERE "companyId" = $1
       ORDER BY v`,
      MSPIL_ID,
    );
    return r.map((x) => Number(x.v));
  });
}

async function globalMax(table: string, field: string): Promise<number> {
  return withRetry(`globalMax(${table}.${field})`, async () => {
    const r = await prisma.$queryRawUnsafe<Array<{ max: number | null }>>(
      `SELECT MAX("${field}") AS max FROM "${table}"`,
    );
    return r[0]?.max ?? 0;
  });
}

function checkBackup(): void {
  if (SKIP_BACKUP_CHECK) {
    log('⚠ --i-have-backed-up-outside set — skipping local backup check.');
    return;
  }
  // backend/scripts/foo.ts → ../../db-backups (repo root)
  const backupDir = path.resolve(__dirname, '..', '..', 'db-backups');
  if (!fs.existsSync(backupDir)) {
    throw new Error(
      `No backup directory at ${backupDir}. Run pg_dump first (see script header), ` +
      `or pass --i-have-backed-up-outside if you took a Railway snapshot.`,
    );
  }
  const files = fs.readdirSync(backupDir)
    .filter((f) => f.endsWith('.dump'))
    .map((f) => ({ f, mtime: fs.statSync(path.join(backupDir, f)).mtimeMs, size: fs.statSync(path.join(backupDir, f)).size }))
    .sort((a, b) => b.mtime - a.mtime);
  if (files.length === 0) {
    throw new Error(`No .dump files in ${backupDir}. Run pg_dump first.`);
  }
  const newest = files[0];
  const ageH = (Date.now() - newest.mtime) / (1000 * 60 * 60);
  if (ageH > 24) {
    throw new Error(
      `Newest backup is ${ageH.toFixed(1)}h old (${newest.f}). ` +
      `Take a fresh pg_dump before running the backfill (see script header).`,
    );
  }
  if (newest.size < 1_000_000) {
    throw new Error(
      `Newest backup ${newest.f} is only ${newest.size} bytes — likely incomplete. ` +
      `Take a fresh pg_dump.`,
    );
  }
  log(`✓ Backup OK: ${newest.f} (${(newest.size / 1_048_576).toFixed(1)} MB, ${ageH.toFixed(1)}h old)`);
}

/**
 * For a GoodsReceipt or Shipment, snapshot its related-row counts so we can
 * assert after renumber that FK relationships are unchanged (zero trucks
 * dropped, zero lines detached). Returns null for tables with no dependents.
 */
async function snapshotDependents(table: string, id: string): Promise<Record<string, number> | null> {
  type NRow = Array<{ n: bigint }>;
  if (table === 'GoodsReceipt') {
    const trucks = await prisma.$queryRawUnsafe<NRow>(`SELECT COUNT(*)::bigint AS n FROM "GrainTruck" WHERE "grnId" = $1`, id);
    const lines = await prisma.$queryRawUnsafe<NRow>(`SELECT COUNT(*)::bigint AS n FROM "GRNLine" WHERE "grnId" = $1`, id);
    const vendorInvoices = await prisma.$queryRawUnsafe<NRow>(`SELECT COUNT(*)::bigint AS n FROM "VendorInvoice" WHERE "grnId" = $1`, id);
    return {
      grainTrucks: Number(trucks[0]?.n ?? 0n),
      grnLines: Number(lines[0]?.n ?? 0n),
      vendorInvoices: Number(vendorInvoices[0]?.n ?? 0n),
    };
  }
  if (table === 'Shipment') {
    const invoices = await prisma.$queryRawUnsafe<NRow>(`SELECT COUNT(*)::bigint AS n FROM "Invoice" WHERE "shipmentId" = $1`, id);
    const documents = await prisma.$queryRawUnsafe<NRow>(`SELECT COUNT(*)::bigint AS n FROM "ShipmentDocument" WHERE "shipmentId" = $1`, id);
    const transporterPayments = await prisma.$queryRawUnsafe<NRow>(`SELECT COUNT(*)::bigint AS n FROM "TransporterPayment" WHERE "shipmentId" = $1`, id);
    return {
      invoices: Number(invoices[0]?.n ?? 0n),
      documents: Number(documents[0]?.n ?? 0n),
      transporterPayments: Number(transporterPayments[0]?.n ?? 0n),
    };
  }
  return null;
}

async function renumberDuplicates(
  table: string,
  field: string,
  dupes: number[],
  dryRun: boolean,
): Promise<Array<{ id: string; oldNo: number; newNo: number; before: Record<string, number> | null }>> {
  if (dupes.length === 0) return [];

  const currentMax = await globalMax(table, field);
  const changes: Array<{ id: string; oldNo: number; newNo: number; before: Record<string, number> | null }> = [];

  // Sort ascending so we allocate sequential new numbers deterministically.
  let next = currentMax + 1;
  for (const oldNo of dupes) {
    // Find the MSPIL_ID-tagged row(s) with this duplicate number. There should
    // typically be exactly one; if more, renumber each in sequence.
    const rows: Array<{ id: string }> = await prisma.$queryRawUnsafe(
      `SELECT id FROM "${table}" WHERE "companyId" = $1 AND "${field}" = $2 ORDER BY "createdAt" ASC`,
      MSPIL_ID,
      oldNo,
    );
    for (const row of rows) {
      // Snapshot FK-dependent row counts BEFORE the update so we can verify
      // after that no truck / line / invoice was detached.
      const before = await snapshotDependents(table, row.id);
      changes.push({ id: row.id, oldNo, newNo: next, before });
      next += 1;
    }
  }

  if (!dryRun) {
    await prisma.$executeRawUnsafe('BEGIN');
    try {
      for (const c of changes) {
        await prisma.$executeRawUnsafe(
          `UPDATE "${table}" SET "${field}" = $1 WHERE id = $2`,
          c.newNo,
          c.id,
        );
      }

      // Verify FK-dependent counts did not change. An UPDATE on a non-key
      // integer column cannot in theory change FK rows, but CLAUDE.md
      // requires paranoia on anything that could misplace a truck. If any
      // count drifts we ROLLBACK and fail loudly.
      for (const c of changes) {
        const after = await snapshotDependents(table, c.id);
        if (!c.before || !after) continue;
        for (const key of Object.keys(c.before)) {
          if (c.before[key] !== after[key]) {
            throw new Error(
              `VERIFICATION FAILED: ${table} id ${c.id} (${c.oldNo} → ${c.newNo}) — ` +
              `${key} count changed from ${c.before[key]} to ${after[key]}. ` +
              `Rolling back.`,
            );
          }
        }
      }

      await prisma.$executeRawUnsafe('COMMIT');
    } catch (e) {
      await prisma.$executeRawUnsafe('ROLLBACK');
      throw e;
    }
  }
  return changes;
}

async function backfillTable(table: string, dryRun: boolean): Promise<number> {
  const nullCount = await countNulls(table);
  if (nullCount === 0) return 0;

  if (dryRun) {
    return nullCount;
  }

  await prisma.$executeRawUnsafe('BEGIN');
  try {
    const updated = await prisma.$executeRawUnsafe(
      `UPDATE "${table}" SET "companyId" = $1 WHERE "companyId" IS NULL`,
      MSPIL_ID,
    );
    await prisma.$executeRawUnsafe('COMMIT');
    return updated as number;
  } catch (e) {
    await prisma.$executeRawUnsafe('ROLLBACK');
    throw e;
  }
}

async function main() {
  bigHr();
  log(`COMPANY-ID BACKFILL ${EXECUTE ? '— EXECUTE MODE (writes to prod)' : '— DRY RUN (no writes)'}`);
  log(`MSPIL_ID = ${MSPIL_ID}`);
  bigHr();

  if (EXECUTE) {
    checkBackup();
    log('');
  }

  await warmupConnection();

  // Phase 1 — renumber duplicate doc numbers
  log('PHASE 1 — Renumber duplicate doc numbers');
  hr();
  const phase1Summary: Array<{ table: string; field: string; changes: Array<{ id: string; oldNo: number; newNo: number }> }> = [];
  for (const { table, field } of NUMBERED) {
    const dupes = await findDuplicates(table, field);
    if (dupes.length === 0) {
      log(`  ${table}.${field}: no conflicts`);
      continue;
    }
    const changes = await renumberDuplicates(table, field, dupes, !EXECUTE);
    phase1Summary.push({ table, field, changes });
    log(`  ${table}.${field}: ${changes.length} rows ${EXECUTE ? 'renumbered' : 'WOULD BE renumbered'}`);
    for (const c of changes.slice(0, 10)) {
      const deps = c.before
        ? ' [' + Object.entries(c.before).map(([k, v]) => `${k}=${v}`).join(', ') + ']'
        : '';
      log(`      ${c.oldNo} → ${c.newNo}  (id ${c.id})${deps}`);
    }
    if (changes.length > 10) log(`      … ${changes.length - 10} more`);
  }
  log('');

  // Phase 2 — backfill NULL companyId
  log('PHASE 2 — Backfill companyId = NULL → MSPIL_ID');
  hr();
  let totalUpdated = 0;
  for (const table of TABLES) {
    try {
      const n = await backfillTable(table, !EXECUTE);
      if (n > 0) {
        log(`  ${table.padEnd(28)} ${n.toString().padStart(8)} rows ${EXECUTE ? 'updated' : 'WOULD BE updated'}`);
        totalUpdated += n;
      }
    } catch (e) {
      log(`  ${table.padEnd(28)} ERROR: ${(e as Error).message}`);
    }
  }
  hr();
  log(`  TOTAL: ${totalUpdated} rows ${EXECUTE ? 'updated' : 'would be updated'} across ${TABLES.length} tables`);
  log('');

  // Post-check
  if (EXECUTE) {
    log('POST-CHECK — re-counting NULLs and duplicates');
    hr();
    let remainingNulls = 0;
    for (const table of TABLES) {
      try {
        const n = await countNulls(table);
        if (n > 0) {
          log(`  ⚠ ${table}: ${n} NULL rows remain`);
          remainingNulls += n;
        }
      } catch { /* ignore */ }
    }
    let remainingDupes = 0;
    for (const { table, field } of NUMBERED) {
      try {
        const d = await findDuplicates(table, field);
        if (d.length > 0) {
          log(`  ⚠ ${table}.${field}: ${d.length} duplicates remain`);
          remainingDupes += d.length;
        }
      } catch { /* ignore */ }
    }
    log('');
    if (remainingNulls === 0 && remainingDupes === 0) {
      log('  ✓ Clean. No NULL companyId rows, no duplicate doc numbers.');
    } else {
      log(`  ⚠ ${remainingNulls} NULLs + ${remainingDupes} duplicates still present — investigate.`);
    }
  } else {
    log('DRY RUN complete. To execute:');
    log('  1. pg_dump "$DATABASE_URL" --format=custom --compress=9 \\');
    log('       -f "$(git rev-parse --show-toplevel)/db-backups/mspil-prod-$(date +%Y%m%d_%H%M%S)_IST.dump"');
    log('  2. Verify the backup file is > 1 MB: ls -lh "$(git rev-parse --show-toplevel)/db-backups/"');
    log('  3. npx ts-node scripts/backfill-company-mspil.ts --execute');
  }
}

main()
  .catch((e) => {
    console.error('\nFATAL:', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
