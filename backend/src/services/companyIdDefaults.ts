/**
 * Company-ID default middleware.
 *
 * Problem: 51 models have `companyId String?` with the schema comment
 * "null = MSPIL default". When a developer forgets to set companyId on create,
 * the row lands with NULL. Then every per-company query (docSequence MAX(),
 * getCompanyFilter, reports, etc.) misses it. Silent data fragmentation.
 *
 * Fix: at the Prisma layer, intercept every CREATE / CREATE_MANY / UPSERT.create
 * on a model that has companyId and fill in MSPIL_ID if the caller didn't set
 * one. Sister-concern writes that explicitly pass their own companyId are left
 * untouched.
 *
 * Intentional scope:
 *   - runs on the cloud backend only (factory-server has its own Prisma client)
 *   - runs on create / createMany / upsert-create only; never on update (we do
 *     not silently rewrite existing rows)
 *   - runs on top-level args.data only — nested relation creates inside
 *     `include`/`create` blocks are Prisma-internal and don't hit middleware.
 *     Audit shows writes in this codebase are flat so this is acceptable.
 *   - explicit `companyId: null` is treated as "use default" to match the
 *     schema comment semantics ("null = MSPIL default")
 *
 * Companion patch: backend/src/utils/docSequence.ts — still needs its
 * `OR "companyId" IS NULL` branch to keep legacy rows on MSPIL's sequence
 * until a separate backfill pass clears them.
 */

import { Prisma } from '@prisma/client';

const MSPIL_ID = 'b499264a-8c73-4595-ab9b-7dc58f58c4d2';

// Pulled from schema.prisma via: awk '/^model/{m=$2}/companyId[[:space:]]+String\?/{print m}'
// Kept as a set for O(1) checks. If a new model with companyId is added, it
// MUST be registered here — the linter can't enforce this.
const MODELS_WITH_COMPANY_ID = new Set<string>([
  'User',
  'DDGSDispatchTruck', 'DispatchTruck', 'GrainTruck',
  'InventoryItem', 'Department', 'Warehouse', 'StockLevel', 'StockMovement',
  'PurchaseRequisition',
  'Customer', 'Product', 'Transporter', 'SalesOrder', 'DispatchRequest',
  'Shipment', 'FreightInquiry', 'FreightQuotation', 'TransporterPayment',
  'Invoice', 'Payment',
  'Vendor', 'Material', 'PurchaseOrder', 'GoodsReceipt', 'VendorInvoice', 'VendorPayment',
  'Contractor', 'ContractorBill', 'ContractorPayment', 'ContractorStoreIssue',
  'DirectPurchase', 'DirectSale',
  'EthanolContract',
  'Account', 'JournalEntry', 'BankTransaction', 'CashVoucher',
  'BankLoan', 'LoanRepayment', 'PostDatedCheque', 'BankPaymentBatch',
  'Approval',
  'DDGSContract', 'SugarDispatchTruck', 'SugarContract',
  'FiscalYear', 'InvoiceSeries',
  'Designation', 'Employee', 'PayrollRun',
]);

function needsDefault(row: any): boolean {
  return row && (row.companyId === undefined || row.companyId === null);
}

export const companyIdDefaultsMiddleware: Prisma.Middleware = async (params, next) => {
  const model = params.model;
  if (!model || !MODELS_WITH_COMPANY_ID.has(model)) {
    return next(params);
  }

  if (params.action === 'create') {
    const data = params.args?.data;
    if (needsDefault(data)) {
      data.companyId = MSPIL_ID;
    }
  } else if (params.action === 'createMany') {
    const data = params.args?.data;
    if (Array.isArray(data)) {
      for (const row of data) {
        if (needsDefault(row)) row.companyId = MSPIL_ID;
      }
    } else if (needsDefault(data)) {
      data.companyId = MSPIL_ID;
    }
  } else if (params.action === 'upsert') {
    // Only the `create` branch gets defaulted. The `update` branch is preserved
    // so existing rows keep whatever companyId they already have.
    const createArg = params.args?.create;
    if (needsDefault(createArg)) {
      createArg.companyId = MSPIL_ID;
    }
  }

  return next(params);
};
