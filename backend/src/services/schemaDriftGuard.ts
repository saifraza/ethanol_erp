/**
 * Schema drift guard — runs on server startup.
 *
 * Background: On 2026-04-21 a Railway deploy's `prisma db push --skip-generate`
 * silently skipped adding Employee.division + cashPayPercent and PayrollLine
 * cash/bank columns. Server started fine but /api/employees threw P2022 on
 * every request. Had to manually ALTER the prod DB.
 *
 * Fix: at startup, check for critical columns the Prisma client expects.
 * If any are missing, apply safe additive ALTERs (with DEFAULT so existing
 * rows get sane values). Logs loudly if drift detected so we can investigate
 * why the deploy pipeline skipped the push.
 */
import prisma from '../config/prisma';

interface ColumnCheck {
  table: string;
  column: string;
  sql: string;
}

const EXPECTED_COLUMNS: ColumnCheck[] = [
  { table: 'Employee', column: 'division', sql: `ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "division" TEXT NOT NULL DEFAULT 'ETHANOL'` },
  { table: 'Employee', column: 'cashPayPercent', sql: `ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "cashPayPercent" DOUBLE PRECISION NOT NULL DEFAULT 0` },
  { table: 'PayrollLine', column: 'cashAmount', sql: `ALTER TABLE "PayrollLine" ADD COLUMN IF NOT EXISTS "cashAmount" DOUBLE PRECISION NOT NULL DEFAULT 0` },
  { table: 'PayrollLine', column: 'bankAmount', sql: `ALTER TABLE "PayrollLine" ADD COLUMN IF NOT EXISTS "bankAmount" DOUBLE PRECISION NOT NULL DEFAULT 0` },
  { table: 'PayrollLine', column: 'paidStatus', sql: `ALTER TABLE "PayrollLine" ADD COLUMN IF NOT EXISTS "paidStatus" TEXT NOT NULL DEFAULT 'UNPAID'` },
  { table: 'PayrollLine', column: 'cashPaidAt', sql: `ALTER TABLE "PayrollLine" ADD COLUMN IF NOT EXISTS "cashPaidAt" TIMESTAMP(3)` },
  { table: 'PayrollLine', column: 'bankPaidAt', sql: `ALTER TABLE "PayrollLine" ADD COLUMN IF NOT EXISTS "bankPaidAt" TIMESTAMP(3)` },
];

export async function runSchemaDriftGuard(): Promise<void> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string; column_name: string }>>(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN ('Employee', 'PayrollLine')`
    );
    const existing = new Set(rows.map(r => `${r.table_name}.${r.column_name}`));
    const missing = EXPECTED_COLUMNS.filter(c => !existing.has(`${c.table}.${c.column}`));

    if (missing.length === 0) {
      console.log('[SchemaDriftGuard] OK — all expected columns present');
      return;
    }

    console.warn(`[SchemaDriftGuard] DRIFT DETECTED — ${missing.length} column(s) missing. Applying additive ALTERs...`);
    for (const c of missing) {
      console.warn(`  missing: ${c.table}.${c.column}`);
      await prisma.$executeRawUnsafe(c.sql);
      console.warn(`  applied: ${c.sql.slice(0, 100)}`);
    }
    console.warn(`[SchemaDriftGuard] drift repair complete. Investigate why prisma db push skipped these on the last deploy.`);
  } catch (err: unknown) {
    console.error('[SchemaDriftGuard] check failed:', (err instanceof Error ? err.message : String(err)));
  }
}
