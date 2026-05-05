/**
 * Schema drift guard — runs on server startup.
 *
 * Background: On 2026-04-21 a Railway deploy's `prisma db push --skip-generate`
 * silently skipped adding Employee.division + cashPayPercent and PayrollLine
 * cash/bank columns. Server started fine but /api/employees threw P2022 on
 * every request. Had to manually ALTER the prod DB.
 *
 * Same pattern recurred 2026-05-02 — `prisma db push` silently skipped
 * creating Farmer + FarmerPayment tables. /api/farmers threw P2021 on
 * every request. Extended this guard to also create missing tables (not
 * just missing columns) when the Prisma schema adds whole new models.
 *
 * Fix: at startup, check for critical columns AND tables the Prisma client
 * expects. If anything is missing, apply safe additive DDL (CREATE TABLE
 * IF NOT EXISTS, ALTER TABLE ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT
 * EXISTS — all idempotent). Logs loudly if drift detected so we can
 * investigate why the deploy pipeline skipped the push.
 */
import prisma from '../config/prisma';

interface ColumnCheck {
  table: string;
  column: string;
  sql: string;
}

interface TableCheck {
  table: string;
  /** Multi-statement DDL — split on `;` and run sequentially. CREATE TABLE
   * + indexes; FK constraint added separately to handle case where the
   * FK target table doesn't exist yet. */
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
  // 2026-05-02 — Farmer master FK on DirectPurchase
  { table: 'DirectPurchase', column: 'farmerId', sql: `ALTER TABLE "DirectPurchase" ADD COLUMN IF NOT EXISTS "farmerId" TEXT` },
  // 2026-05-04 — RFQ discount extraction (PR #4)
  { table: 'PurchaseRequisitionVendorLine', column: 'discountPercent', sql: `ALTER TABLE "PurchaseRequisitionVendorLine" ADD COLUMN IF NOT EXISTS "discountPercent" DOUBLE PRECISION NOT NULL DEFAULT 0` },
  // 2026-05-04 — Quote Cost Template (PR #6) — packing/freight/insurance/etc flow to PO header
  { table: 'PurchaseRequisitionVendor', column: 'packingPercent',       sql: `ALTER TABLE "PurchaseRequisitionVendor" ADD COLUMN IF NOT EXISTS "packingPercent" DOUBLE PRECISION NOT NULL DEFAULT 0` },
  { table: 'PurchaseRequisitionVendor', column: 'packingAmount',        sql: `ALTER TABLE "PurchaseRequisitionVendor" ADD COLUMN IF NOT EXISTS "packingAmount" DOUBLE PRECISION NOT NULL DEFAULT 0` },
  { table: 'PurchaseRequisitionVendor', column: 'freightPercent',       sql: `ALTER TABLE "PurchaseRequisitionVendor" ADD COLUMN IF NOT EXISTS "freightPercent" DOUBLE PRECISION NOT NULL DEFAULT 0` },
  { table: 'PurchaseRequisitionVendor', column: 'freightAmount',        sql: `ALTER TABLE "PurchaseRequisitionVendor" ADD COLUMN IF NOT EXISTS "freightAmount" DOUBLE PRECISION NOT NULL DEFAULT 0` },
  { table: 'PurchaseRequisitionVendor', column: 'insurancePercent',     sql: `ALTER TABLE "PurchaseRequisitionVendor" ADD COLUMN IF NOT EXISTS "insurancePercent" DOUBLE PRECISION NOT NULL DEFAULT 0` },
  { table: 'PurchaseRequisitionVendor', column: 'insuranceAmount',      sql: `ALTER TABLE "PurchaseRequisitionVendor" ADD COLUMN IF NOT EXISTS "insuranceAmount" DOUBLE PRECISION NOT NULL DEFAULT 0` },
  { table: 'PurchaseRequisitionVendor', column: 'loadingPercent',       sql: `ALTER TABLE "PurchaseRequisitionVendor" ADD COLUMN IF NOT EXISTS "loadingPercent" DOUBLE PRECISION NOT NULL DEFAULT 0` },
  { table: 'PurchaseRequisitionVendor', column: 'loadingAmount',        sql: `ALTER TABLE "PurchaseRequisitionVendor" ADD COLUMN IF NOT EXISTS "loadingAmount" DOUBLE PRECISION NOT NULL DEFAULT 0` },
  { table: 'PurchaseRequisitionVendor', column: 'isRateInclusiveOfGst', sql: `ALTER TABLE "PurchaseRequisitionVendor" ADD COLUMN IF NOT EXISTS "isRateInclusiveOfGst" BOOLEAN NOT NULL DEFAULT false` },
  { table: 'PurchaseRequisitionVendor', column: 'tcsPercent',           sql: `ALTER TABLE "PurchaseRequisitionVendor" ADD COLUMN IF NOT EXISTS "tcsPercent" DOUBLE PRECISION NOT NULL DEFAULT 0` },
  { table: 'PurchaseRequisitionVendor', column: 'deliveryBasis',        sql: `ALTER TABLE "PurchaseRequisitionVendor" ADD COLUMN IF NOT EXISTS "deliveryBasis" TEXT` },
  { table: 'PurchaseRequisitionVendor', column: 'additionalCharges',    sql: `ALTER TABLE "PurchaseRequisitionVendor" ADD COLUMN IF NOT EXISTS "additionalCharges" JSONB NOT NULL DEFAULT '[]'::jsonb` },
  // 2026-05-04 — Contractor Work Orders — link existing ContractorBill back to a WO
  { table: 'ContractorBill', column: 'workOrderId', sql: `ALTER TABLE "ContractorBill" ADD COLUMN IF NOT EXISTS "workOrderId" TEXT` },

  // 2026-05-06 — Manpower supply contracts (new tab on Work Orders page)
  { table: 'WorkOrder',     column: 'contractType',     sql: `ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "contractType" TEXT NOT NULL DEFAULT 'GENERAL'` },
  { table: 'WorkOrder',     column: 'manpowerRateCard', sql: `ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "manpowerRateCard" JSONB` },
  { table: 'WorkOrderLine', column: 'lineKind',         sql: `ALTER TABLE "WorkOrderLine" ADD COLUMN IF NOT EXISTS "lineKind" TEXT NOT NULL DEFAULT 'GENERAL'` },
  { table: 'WorkOrderLine', column: 'skillCategory',    sql: `ALTER TABLE "WorkOrderLine" ADD COLUMN IF NOT EXISTS "skillCategory" TEXT` },
  { table: 'WorkOrderLine', column: 'shiftHours',       sql: `ALTER TABLE "WorkOrderLine" ADD COLUMN IF NOT EXISTS "shiftHours" INTEGER` },
  { table: 'WorkOrderLine', column: 'personCount',      sql: `ALTER TABLE "WorkOrderLine" ADD COLUMN IF NOT EXISTS "personCount" INTEGER` },
  { table: 'WorkOrderLine', column: 'shiftCount',       sql: `ALTER TABLE "WorkOrderLine" ADD COLUMN IF NOT EXISTS "shiftCount" INTEGER` },
];

const EXPECTED_TABLES: TableCheck[] = [
  // 2026-05-02 — Farmer master (separate from Vendor; phone-keyed, RCM, KYC)
  {
    table: 'Farmer',
    sql: `
      CREATE TABLE IF NOT EXISTS "Farmer" (
        "id" TEXT NOT NULL,
        "code" TEXT,
        "name" TEXT NOT NULL,
        "phone" TEXT,
        "aadhaar" TEXT,
        "maanNumber" TEXT,
        "village" TEXT,
        "tehsil" TEXT,
        "district" TEXT,
        "state" TEXT,
        "pincode" TEXT,
        "bankName" TEXT,
        "bankAccount" TEXT,
        "bankIfsc" TEXT,
        "upiId" TEXT,
        "rawMaterialTypes" TEXT,
        "kycStatus" TEXT NOT NULL DEFAULT 'PENDING',
        "kycNotes" TEXT,
        "isRCM" BOOLEAN NOT NULL DEFAULT true,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "remarks" TEXT,
        "division" TEXT DEFAULT 'ETHANOL',
        "companyId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Farmer_pkey" PRIMARY KEY ("id")
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "Farmer_code_key" ON "Farmer"("code");
      CREATE INDEX IF NOT EXISTS "Farmer_phone_idx" ON "Farmer"("phone");
      CREATE INDEX IF NOT EXISTS "Farmer_aadhaar_idx" ON "Farmer"("aadhaar");
      CREATE INDEX IF NOT EXISTS "Farmer_maanNumber_idx" ON "Farmer"("maanNumber");
      CREATE INDEX IF NOT EXISTS "Farmer_companyId_idx" ON "Farmer"("companyId");
      CREATE INDEX IF NOT EXISTS "Farmer_isActive_idx" ON "Farmer"("isActive");
    `,
  },
  // 2026-05-04 — AiCallLog (audit trail for every AI provider call)
  {
    table: 'AiCallLog',
    sql: `
      CREATE TABLE IF NOT EXISTS "AiCallLog" (
        "id" TEXT NOT NULL,
        "feature" TEXT NOT NULL,
        "provider" TEXT NOT NULL DEFAULT 'gemini',
        "model" TEXT NOT NULL,
        "userId" TEXT,
        "contextRef" TEXT,
        "inputTokens" INTEGER NOT NULL DEFAULT 0,
        "outputTokens" INTEGER NOT NULL DEFAULT 0,
        "totalTokens" INTEGER NOT NULL DEFAULT 0,
        "estimatedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "estimatedCostInr" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "durationMs" INTEGER NOT NULL DEFAULT 0,
        "success" BOOLEAN NOT NULL,
        "errorMessage" TEXT,
        "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "AiCallLog_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "AiCallLog_feature_createdAt_idx" ON "AiCallLog"("feature", "createdAt");
      CREATE INDEX IF NOT EXISTS "AiCallLog_model_idx" ON "AiCallLog"("model");
      CREATE INDEX IF NOT EXISTS "AiCallLog_userId_idx" ON "AiCallLog"("userId");
      CREATE INDEX IF NOT EXISTS "AiCallLog_success_idx" ON "AiCallLog"("success");
      CREATE INDEX IF NOT EXISTS "AiCallLog_createdAt_idx" ON "AiCallLog"("createdAt");
    `,
  },
  // 2026-05-02 — FarmerPayment (separate ledger from VendorPayment)
  {
    table: 'FarmerPayment',
    sql: `
      CREATE TABLE IF NOT EXISTS "FarmerPayment" (
        "id" TEXT NOT NULL,
        "paymentNo" SERIAL NOT NULL,
        "farmerId" TEXT NOT NULL,
        "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "amount" DOUBLE PRECISION NOT NULL,
        "mode" TEXT NOT NULL DEFAULT 'CASH',
        "reference" TEXT,
        "remarks" TEXT,
        "purchaseId" TEXT,
        "userId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "companyId" TEXT,
        CONSTRAINT "FarmerPayment_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "FarmerPayment_farmerId_idx" ON "FarmerPayment"("farmerId");
      CREATE INDEX IF NOT EXISTS "FarmerPayment_paymentDate_idx" ON "FarmerPayment"("paymentDate");
      CREATE INDEX IF NOT EXISTS "FarmerPayment_companyId_idx" ON "FarmerPayment"("companyId");
    `,
  },
  // 2026-05-04 — Contractor Work Orders (authorisation for a contractor to perform a job)
  {
    table: 'WorkOrder',
    sql: `
      CREATE TABLE IF NOT EXISTS "WorkOrder" (
        "id" TEXT NOT NULL,
        "woNo" SERIAL NOT NULL,
        "contractorId" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "description" TEXT,
        "startDate" TIMESTAMP(3),
        "endDate" TIMESTAMP(3),
        "siteLocation" TEXT,
        "supplyType" TEXT NOT NULL DEFAULT 'INTRA_STATE',
        "placeOfSupply" TEXT,
        "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "taxableAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "totalCgst" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "totalSgst" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "totalIgst" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "totalGst" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "grandTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "retentionPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "retentionAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "tdsSection" TEXT NOT NULL DEFAULT '194C',
        "tdsPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "tdsAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "billedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "balanceAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "progressPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "status" TEXT NOT NULL DEFAULT 'DRAFT',
        "approvedBy" TEXT,
        "approvedAt" TIMESTAMP(3),
        "startedAt" TIMESTAMP(3),
        "completedAt" TIMESTAMP(3),
        "closedAt" TIMESTAMP(3),
        "cancelledAt" TIMESTAMP(3),
        "cancelReason" TEXT,
        "paymentTerms" TEXT,
        "creditDays" INTEGER NOT NULL DEFAULT 30,
        "remarks" TEXT,
        "userId" TEXT NOT NULL,
        "division" TEXT DEFAULT 'ETHANOL',
        "companyId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "WorkOrder_contractorId_idx" ON "WorkOrder"("contractorId");
      CREATE INDEX IF NOT EXISTS "WorkOrder_status_idx" ON "WorkOrder"("status");
      CREATE INDEX IF NOT EXISTS "WorkOrder_startDate_idx" ON "WorkOrder"("startDate");
      CREATE INDEX IF NOT EXISTS "WorkOrder_division_idx" ON "WorkOrder"("division");
      CREATE INDEX IF NOT EXISTS "WorkOrder_companyId_idx" ON "WorkOrder"("companyId");
    `,
  },
  {
    table: 'WorkOrderLine',
    sql: `
      CREATE TABLE IF NOT EXISTS "WorkOrderLine" (
        "id" TEXT NOT NULL,
        "woId" TEXT NOT NULL,
        "lineNo" INTEGER NOT NULL DEFAULT 1,
        "description" TEXT NOT NULL,
        "hsnSac" TEXT,
        "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
        "unit" TEXT NOT NULL DEFAULT 'NOS',
        "rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "discountPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "taxableAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "gstPercent" DOUBLE PRECISION NOT NULL DEFAULT 18,
        "cgstPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "cgstAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "sgstPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "sgstAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "igstPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "igstAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "totalGst" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "lineTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "completedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "remarks" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "WorkOrderLine_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "WorkOrderLine_woId_idx" ON "WorkOrderLine"("woId");
    `,
  },
  {
    table: 'WorkOrderProgress',
    sql: `
      CREATE TABLE IF NOT EXISTS "WorkOrderProgress" (
        "id" TEXT NOT NULL,
        "woId" TEXT NOT NULL,
        "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "percent" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "workDone" TEXT NOT NULL,
        "photoUrl" TEXT,
        "reportedBy" TEXT NOT NULL,
        "remarks" TEXT,
        CONSTRAINT "WorkOrderProgress_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "WorkOrderProgress_woId_idx" ON "WorkOrderProgress"("woId");
      CREATE INDEX IF NOT EXISTS "WorkOrderProgress_reportedAt_idx" ON "WorkOrderProgress"("reportedAt");
    `,
  },
];

async function checkAndCreateTables(): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN (${EXPECTED_TABLES.map(t => `'${t.table}'`).join(', ')})`,
  );
  const existing = new Set(rows.map(r => r.table_name));
  const missing = EXPECTED_TABLES.filter(t => !existing.has(t.table));

  if (missing.length === 0) return;

  console.warn(`[SchemaDriftGuard] TABLE DRIFT — ${missing.length} table(s) missing. Creating...`);
  for (const t of missing) {
    console.warn(`  missing table: ${t.table}`);
    // Split on semicolons but keep the statements (SERIAL etc. inside CREATE TABLE
    // doesn't include semicolons so a naive split is safe here).
    const statements = t.sql.split(';').map(s => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      try {
        await prisma.$executeRawUnsafe(stmt);
      } catch (err) {
        console.error(`  failed: ${stmt.slice(0, 80)}... — ${err instanceof Error ? err.message : err}`);
      }
    }
    console.warn(`  created: ${t.table}`);
  }
  console.warn(`[SchemaDriftGuard] table repair complete. Investigate why prisma db push skipped these on the last deploy.`);
}

async function checkAndAddColumns(): Promise<void> {
  const tableNames = [...new Set(EXPECTED_COLUMNS.map(c => c.table))];
  const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string; column_name: string }>>(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN (${tableNames.map(t => `'${t}'`).join(', ')})`,
  );
  const existing = new Set(rows.map(r => `${r.table_name}.${r.column_name}`));
  const missing = EXPECTED_COLUMNS.filter(c => !existing.has(`${c.table}.${c.column}`));

  if (missing.length === 0) return;

  console.warn(`[SchemaDriftGuard] COLUMN DRIFT — ${missing.length} column(s) missing. Applying additive ALTERs...`);
  for (const c of missing) {
    console.warn(`  missing: ${c.table}.${c.column}`);
    await prisma.$executeRawUnsafe(c.sql);
    console.warn(`  applied: ${c.sql.slice(0, 100)}`);
  }
  console.warn(`[SchemaDriftGuard] column repair complete. Investigate why prisma db push skipped these on the last deploy.`);
}

export async function runSchemaDriftGuard(): Promise<void> {
  try {
    // Tables first (so column checks below can reference them)
    await checkAndCreateTables();
    // Then columns
    await checkAndAddColumns();
    // Add the DirectPurchase.farmerId index too — covered above for the column
    // but the index lives separately. Idempotent.
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DirectPurchase_farmerId_idx" ON "DirectPurchase"("farmerId")`);
    // 2026-05-04 — index for ContractorBill ↔ WorkOrder linkage
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ContractorBill_workOrderId_idx" ON "ContractorBill"("workOrderId")`);
    // 2026-05-06 — index for WorkOrder.contractType (Manpower vs General tab filter)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "WorkOrder_contractType_idx" ON "WorkOrder"("contractType")`);
    console.log('[SchemaDriftGuard] OK — all expected columns + tables present');
  } catch (err: unknown) {
    console.error('[SchemaDriftGuard] check failed:', (err instanceof Error ? err.message : String(err)));
  }
}
