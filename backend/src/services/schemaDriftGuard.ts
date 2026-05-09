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
  // 2026-05-08 — Transport contracts (third tab on Work Orders page)
  { table: 'WorkOrder',     column: 'transportRateCard', sql: `ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "transportRateCard" JSONB` },
  { table: 'WorkOrderLine', column: 'lineKind',         sql: `ALTER TABLE "WorkOrderLine" ADD COLUMN IF NOT EXISTS "lineKind" TEXT NOT NULL DEFAULT 'GENERAL'` },
  { table: 'WorkOrderLine', column: 'skillCategory',    sql: `ALTER TABLE "WorkOrderLine" ADD COLUMN IF NOT EXISTS "skillCategory" TEXT` },
  { table: 'WorkOrderLine', column: 'shiftHours',       sql: `ALTER TABLE "WorkOrderLine" ADD COLUMN IF NOT EXISTS "shiftHours" INTEGER` },
  { table: 'WorkOrderLine', column: 'personCount',      sql: `ALTER TABLE "WorkOrderLine" ADD COLUMN IF NOT EXISTS "personCount" INTEGER` },
  { table: 'WorkOrderLine', column: 'shiftCount',       sql: `ALTER TABLE "WorkOrderLine" ADD COLUMN IF NOT EXISTS "shiftCount" INTEGER` },

  // 2026-05-06 — Attendance & Leave (HR module)
  { table: 'Employee', column: 'defaultShiftId', sql: `ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "defaultShiftId" TEXT` },
  // 2026-05-06 — Biometric Devices (HR Phase A)
  { table: 'Employee', column: 'deviceUserId', sql: `ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "deviceUserId" TEXT` },
  { table: 'Employee', column: 'cardNumber',   sql: `ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "cardNumber" TEXT` },
  // 2026-05-06 — Auto-sync intervals
  { table: 'BiometricDevice', column: 'autoPullMinutes', sql: `ALTER TABLE "BiometricDevice" ADD COLUMN IF NOT EXISTS "autoPullMinutes" INTEGER NOT NULL DEFAULT 0` },
  { table: 'BiometricDevice', column: 'autoPushMinutes', sql: `ALTER TABLE "BiometricDevice" ADD COLUMN IF NOT EXISTS "autoPushMinutes" INTEGER NOT NULL DEFAULT 0` },
  { table: 'BiometricDevice', column: 'lastAutoPullAt',  sql: `ALTER TABLE "BiometricDevice" ADD COLUMN IF NOT EXISTS "lastAutoPullAt" TIMESTAMP(3)` },
  { table: 'BiometricDevice', column: 'lastAutoPushAt',  sql: `ALTER TABLE "BiometricDevice" ADD COLUMN IF NOT EXISTS "lastAutoPushAt" TIMESTAMP(3)` },
  // 2026-05-06 — LaborWorker support: AttendancePunch.employeeId becomes nullable, new laborWorkerId column
  { table: 'AttendancePunch', column: 'laborWorkerId', sql: `ALTER TABLE "AttendancePunch" ADD COLUMN IF NOT EXISTS "laborWorkerId" TEXT` },
  // 2026-05-07 — Factory-led biometric mode (factory-server PC owns the device,
  // pulls punches into its own DB, batches to cloud every minute).
  { table: 'BiometricDevice', column: 'factoryManaged',    sql: `ALTER TABLE "BiometricDevice" ADD COLUMN IF NOT EXISTS "factoryManaged" BOOLEAN NOT NULL DEFAULT false` },
  { table: 'BiometricDevice', column: 'lastFactorySyncAt', sql: `ALTER TABLE "BiometricDevice" ADD COLUMN IF NOT EXISTS "lastFactorySyncAt" TIMESTAMP(3)` },
  // 2026-05-07 — Fuel Payments tab + bulletproof PO ↔ payment join.
  // Replaces the broken `remarks contains "PO-{poNo}"` matcher (PO-1 vs PO-10 collided).
  { table: 'VendorPayment', column: 'purchaseOrderId', sql: `ALTER TABLE "VendorPayment" ADD COLUMN IF NOT EXISTS "purchaseOrderId" TEXT` },
  // 2026-05-07 — Editable T&C on Work Orders (JSON array of {title, body})
  { table: 'WorkOrder', column: 'termsAndConditions', sql: `ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "termsAndConditions" JSONB` },
  // 2026-05-07 — Cash vouchers join the same PO-FK pattern so the per-PO
  // running ledger can interleave bank + cash events with running balance.
  // Replaces legacy `purpose contains "PO-{n}"` matcher.
  { table: 'CashVoucher', column: 'purchaseOrderId', sql: `ALTER TABLE "CashVoucher" ADD COLUMN IF NOT EXISTS "purchaseOrderId" TEXT` },
  // 2026-05-09 — Factory cache watchdog state (Telegram alerts to weighbridge group
  // when factory-server's master-data cache goes stale). Added after 48h silent
  // outage where factory PC's CLOUD_DATABASE_URL pointed at a deleted DB host.
  { table: 'Settings', column: 'factoryCacheState', sql: `ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "factoryCacheState" TEXT` },
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
  // 2026-05-06 — Attendance & Leave (HR module)
  {
    table: 'Shift',
    sql: `
      CREATE TABLE IF NOT EXISTS "Shift" (
        "id" TEXT NOT NULL,
        "code" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "startTime" TEXT NOT NULL,
        "endTime" TEXT NOT NULL,
        "graceMinutes" INTEGER NOT NULL DEFAULT 15,
        "earlyOutMinutes" INTEGER NOT NULL DEFAULT 15,
        "hours" DOUBLE PRECISION NOT NULL DEFAULT 8,
        "active" BOOLEAN NOT NULL DEFAULT true,
        "companyId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "Shift_code_key" ON "Shift"("code");
      CREATE INDEX IF NOT EXISTS "Shift_active_idx" ON "Shift"("active");
      CREATE INDEX IF NOT EXISTS "Shift_companyId_idx" ON "Shift"("companyId");
    `,
  },
  {
    table: 'AttendancePunch',
    sql: `
      CREATE TABLE IF NOT EXISTS "AttendancePunch" (
        "id" TEXT NOT NULL,
        "employeeId" TEXT NOT NULL,
        "punchAt" TIMESTAMP(3) NOT NULL,
        "direction" TEXT NOT NULL DEFAULT 'AUTO',
        "source" TEXT NOT NULL DEFAULT 'DEVICE',
        "deviceId" TEXT,
        "rawEmpCode" TEXT,
        "notes" TEXT,
        "createdBy" TEXT,
        "companyId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "AttendancePunch_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "AttendancePunch_employeeId_punchAt_idx" ON "AttendancePunch"("employeeId", "punchAt");
      CREATE INDEX IF NOT EXISTS "AttendancePunch_punchAt_idx" ON "AttendancePunch"("punchAt");
      CREATE INDEX IF NOT EXISTS "AttendancePunch_deviceId_punchAt_idx" ON "AttendancePunch"("deviceId", "punchAt");
      CREATE INDEX IF NOT EXISTS "AttendancePunch_source_idx" ON "AttendancePunch"("source");
      CREATE INDEX IF NOT EXISTS "AttendancePunch_companyId_idx" ON "AttendancePunch"("companyId");
    `,
  },
  {
    table: 'AttendanceDay',
    sql: `
      CREATE TABLE IF NOT EXISTS "AttendanceDay" (
        "id" TEXT NOT NULL,
        "employeeId" TEXT NOT NULL,
        "date" DATE NOT NULL,
        "shiftId" TEXT,
        "status" TEXT NOT NULL,
        "firstPunchAt" TIMESTAMP(3),
        "lastPunchAt" TIMESTAMP(3),
        "hoursWorked" DOUBLE PRECISION,
        "lateMinutes" INTEGER,
        "earlyOutMinutes" INTEGER,
        "leaveApplicationId" TEXT,
        "manualOverride" BOOLEAN NOT NULL DEFAULT false,
        "overrideReason" TEXT,
        "overrideBy" TEXT,
        "overrideAt" TIMESTAMP(3),
        "companyId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "AttendanceDay_pkey" PRIMARY KEY ("id")
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "AttendanceDay_employeeId_date_key" ON "AttendanceDay"("employeeId", "date");
      CREATE INDEX IF NOT EXISTS "AttendanceDay_date_idx" ON "AttendanceDay"("date");
      CREATE INDEX IF NOT EXISTS "AttendanceDay_status_idx" ON "AttendanceDay"("status");
      CREATE INDEX IF NOT EXISTS "AttendanceDay_shiftId_idx" ON "AttendanceDay"("shiftId");
      CREATE INDEX IF NOT EXISTS "AttendanceDay_leaveApplicationId_idx" ON "AttendanceDay"("leaveApplicationId");
      CREATE INDEX IF NOT EXISTS "AttendanceDay_companyId_idx" ON "AttendanceDay"("companyId");
    `,
  },
  {
    table: 'LeaveType',
    sql: `
      CREATE TABLE IF NOT EXISTS "LeaveType" (
        "id" TEXT NOT NULL,
        "code" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "paid" BOOLEAN NOT NULL DEFAULT true,
        "defaultAnnualEntitlement" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "active" BOOLEAN NOT NULL DEFAULT true,
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "LeaveType_pkey" PRIMARY KEY ("id")
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "LeaveType_code_key" ON "LeaveType"("code");
      CREATE INDEX IF NOT EXISTS "LeaveType_active_idx" ON "LeaveType"("active");
    `,
  },
  {
    table: 'LeaveApplication',
    sql: `
      CREATE TABLE IF NOT EXISTS "LeaveApplication" (
        "id" TEXT NOT NULL,
        "appNo" SERIAL NOT NULL,
        "employeeId" TEXT NOT NULL,
        "leaveTypeId" TEXT NOT NULL,
        "fromDate" DATE NOT NULL,
        "toDate" DATE NOT NULL,
        "days" DOUBLE PRECISION NOT NULL,
        "isHalfDay" BOOLEAN NOT NULL DEFAULT false,
        "reason" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "attachmentUrl" TEXT,
        "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "appliedBy" TEXT NOT NULL,
        "reviewedBy" TEXT,
        "reviewedAt" TIMESTAMP(3),
        "reviewNote" TEXT,
        "companyId" TEXT,
        CONSTRAINT "LeaveApplication_pkey" PRIMARY KEY ("id")
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "LeaveApplication_appNo_key" ON "LeaveApplication"("appNo");
      CREATE INDEX IF NOT EXISTS "LeaveApplication_employeeId_status_idx" ON "LeaveApplication"("employeeId", "status");
      CREATE INDEX IF NOT EXISTS "LeaveApplication_fromDate_toDate_idx" ON "LeaveApplication"("fromDate", "toDate");
      CREATE INDEX IF NOT EXISTS "LeaveApplication_status_idx" ON "LeaveApplication"("status");
      CREATE INDEX IF NOT EXISTS "LeaveApplication_companyId_idx" ON "LeaveApplication"("companyId");
    `,
  },
  // 2026-05-06 — Biometric Devices (HR Phase A)
  {
    table: 'BiometricDevice',
    sql: `
      CREATE TABLE IF NOT EXISTS "BiometricDevice" (
        "id" TEXT NOT NULL,
        "code" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "location" TEXT,
        "ip" TEXT NOT NULL,
        "port" INTEGER NOT NULL DEFAULT 4370,
        "password" INTEGER NOT NULL DEFAULT 0,
        "serialNumber" TEXT,
        "firmware" TEXT,
        "platform" TEXT,
        "active" BOOLEAN NOT NULL DEFAULT true,
        "lastSyncAt" TIMESTAMP(3),
        "lastSyncStatus" TEXT,
        "lastSyncError" TEXT,
        "lastPunchSyncAt" TIMESTAMP(3),
        "notes" TEXT,
        "companyId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "BiometricDevice_pkey" PRIMARY KEY ("id")
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "BiometricDevice_code_key" ON "BiometricDevice"("code");
      CREATE INDEX IF NOT EXISTS "BiometricDevice_active_idx" ON "BiometricDevice"("active");
      CREATE INDEX IF NOT EXISTS "BiometricDevice_companyId_idx" ON "BiometricDevice"("companyId");
    `,
  },
  // 2026-05-07 — BiometricJob (factory-led job queue: cloud writes, factory polls)
  {
    table: 'BiometricJob',
    sql: `
      CREATE TABLE IF NOT EXISTS "BiometricJob" (
        "id" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "deviceId" TEXT NOT NULL,
        "payload" TEXT,
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "requestedBy" TEXT,
        "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "claimedAt" TIMESTAMP(3),
        "completedAt" TIMESTAMP(3),
        "result" TEXT,
        "error" TEXT,
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "maxAttempts" INTEGER NOT NULL DEFAULT 3,
        CONSTRAINT "BiometricJob_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "BiometricJob_status_requestedAt_idx" ON "BiometricJob"("status", "requestedAt");
      CREATE INDEX IF NOT EXISTS "BiometricJob_deviceId_idx" ON "BiometricJob"("deviceId");
    `,
  },
  // 2026-05-06 — LaborWorker (Phase 2 — labor supplier workers, separate from Employee)
  {
    table: 'LaborWorker',
    sql: `
      CREATE TABLE IF NOT EXISTS "LaborWorker" (
        "id" TEXT NOT NULL,
        "workerCode" TEXT NOT NULL,
        "workerNo" SERIAL NOT NULL,
        "firstName" TEXT NOT NULL,
        "lastName" TEXT,
        "fatherName" TEXT,
        "phone" TEXT,
        "aadhaar" TEXT,
        "contractorId" TEXT NOT NULL,
        "workOrderId" TEXT,
        "skillCategory" TEXT,
        "dailyRate" DOUBLE PRECISION,
        "deviceUserId" TEXT,
        "cardNumber" TEXT,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "remarks" TEXT,
        "companyId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "LaborWorker_pkey" PRIMARY KEY ("id")
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "LaborWorker_workerCode_key" ON "LaborWorker"("workerCode");
      CREATE UNIQUE INDEX IF NOT EXISTS "LaborWorker_workerNo_key" ON "LaborWorker"("workerNo");
      CREATE INDEX IF NOT EXISTS "LaborWorker_contractorId_idx" ON "LaborWorker"("contractorId");
      CREATE INDEX IF NOT EXISTS "LaborWorker_workOrderId_idx" ON "LaborWorker"("workOrderId");
      CREATE INDEX IF NOT EXISTS "LaborWorker_deviceUserId_idx" ON "LaborWorker"("deviceUserId");
      CREATE INDEX IF NOT EXISTS "LaborWorker_isActive_idx" ON "LaborWorker"("isActive");
      CREATE INDEX IF NOT EXISTS "LaborWorker_companyId_idx" ON "LaborWorker"("companyId");
      CREATE INDEX IF NOT EXISTS "LaborWorker_skillCategory_idx" ON "LaborWorker"("skillCategory");
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

/**
 * One-shot idempotent backfill: link existing VendorPayment rows to their PO via
 * the new VendorPayment.purchaseOrderId FK, parsing the legacy `PO-{n}` token
 * out of `remarks`.
 *
 * Why: until 2026-05-07 the join between a payment and its PO was a string
 * match `remarks contains "PO-{poNo}"`. That match collided across PO-prefix
 * pairs (PO-1 also matched PO-10 / PO-100 etc.) — surfaced as P1 in
 * AUDIT_FUEL_PO_2026-04-01.md. Fix: use a proper FK going forward, plus this
 * one-time backfill so historical fuel deals + PO ledgers reconcile.
 *
 * Safety: only updates rows where purchaseOrderId IS NULL, so re-runs on a
 * later deploy are a no-op. Uses POSIX `~` with word-boundary so PO-1 doesn't
 * match PO-10. Joins on vendorId so a stray PO-N token in a different vendor's
 * remarks can't cross-link.
 */
/**
 * One-shot backfill for CashVoucher.purchaseOrderId — same approach as
 * the VendorPayment migration. Cash vouchers historically tracked their
 * PO via free-text in `purpose` (e.g. "Fuel payment against PO-112 …").
 * We parse the `PO-{n}` token with word-boundary regex so PO-1 doesn't
 * cross-link to PO-10. There's no vendorId on CashVoucher so we match by
 * payeeName as a soft scope (vouchers can be paid to non-vendors too).
 *
 * Idempotent: only updates rows where purchaseOrderId IS NULL.
 */
async function backfillCashVoucherPoLink(): Promise<void> {
  try {
    // Cheap pre-check: skip the heavy regex×cross-join scan if nothing needs it.
    const pendingRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM "CashVoucher" WHERE "purchaseOrderId" IS NULL AND purpose ~ 'PO-[0-9]'`,
    );
    const pending = Number(pendingRows[0]?.count ?? 0n);
    if (pending === 0) return;
    const result = await prisma.$executeRawUnsafe(
      `UPDATE "CashVoucher" cv
       SET "purchaseOrderId" = po.id
       FROM "PurchaseOrder" po
       INNER JOIN "Vendor" v ON v.id = po."vendorId"
       WHERE cv."purchaseOrderId" IS NULL
         AND cv."payeeName" = v.name
         AND cv.purpose ~ ('(^|[^0-9])PO-' || po."poNo"::text || '([^0-9]|$)')`,
    );
    if (typeof result === 'number' && result > 0) {
      console.warn(`[SchemaDriftGuard] backfilled CashVoucher.purchaseOrderId for ${result} legacy row(s)`);
    }
  } catch (err: unknown) {
    console.error('[SchemaDriftGuard] CashVoucher backfill failed:', (err instanceof Error ? err.message : String(err)));
  }
}

async function backfillVendorPaymentPoLink(): Promise<void> {
  try {
    // Cheap pre-check: skip the heavy regex×cross-join scan if nothing needs it.
    const pendingRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM "VendorPayment" WHERE "purchaseOrderId" IS NULL AND remarks ~ 'PO-[0-9]'`,
    );
    const pending = Number(pendingRows[0]?.count ?? 0n);
    if (pending === 0) return;
    const result = await prisma.$executeRawUnsafe(
      `UPDATE "VendorPayment" vp
       SET "purchaseOrderId" = po.id
       FROM "PurchaseOrder" po
       WHERE vp."purchaseOrderId" IS NULL
         AND vp."vendorId" = po."vendorId"
         AND vp.remarks ~ ('(^|[^0-9])PO-' || po."poNo"::text || '([^0-9]|$)')`,
    );
    if (typeof result === 'number' && result > 0) {
      console.warn(`[SchemaDriftGuard] backfilled VendorPayment.purchaseOrderId for ${result} legacy row(s)`);
    }
  } catch (err: unknown) {
    console.error('[SchemaDriftGuard] VendorPayment backfill failed:', (err instanceof Error ? err.message : String(err)));
  }
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
    // 2026-05-06 — index for Employee.defaultShiftId (HR attendance)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Employee_defaultShiftId_idx" ON "Employee"("defaultShiftId")`);
    // 2026-05-06 — index for Employee.deviceUserId (biometric mapping)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Employee_deviceUserId_idx" ON "Employee"("deviceUserId")`);
    // 2026-05-06 — AttendancePunch.employeeId becomes nullable (LaborWorker support)
    await prisma.$executeRawUnsafe(`ALTER TABLE "AttendancePunch" ALTER COLUMN "employeeId" DROP NOT NULL`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AttendancePunch_laborWorkerId_punchAt_idx" ON "AttendancePunch"("laborWorkerId", "punchAt")`);
    // 2026-05-07 — VendorPayment ↔ PurchaseOrder FK index. Index is fast; the
    // remarks-regex backfill is fire-and-forget so server boot isn't blocked
    // (Railway "Creating containers" hung on PR #64 because the regex×cross-join
    // could take minutes on prod-sized data — see incident notes 2026-05-07).
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "VendorPayment_purchaseOrderId_idx" ON "VendorPayment"("purchaseOrderId")`);
    // 2026-05-07 — Same shape for CashVoucher: index now, backfill async.
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CashVoucher_purchaseOrderId_idx" ON "CashVoucher"("purchaseOrderId")`);
    setImmediate(() => {
      backfillVendorPaymentPoLink().catch(() => { /* logged inside */ });
      backfillCashVoucherPoLink().catch(() => { /* logged inside */ });
    });
    console.log('[SchemaDriftGuard] OK — all expected columns + tables present');
  } catch (err: unknown) {
    console.error('[SchemaDriftGuard] check failed:', (err instanceof Error ? err.message : String(err)));
  }
}
