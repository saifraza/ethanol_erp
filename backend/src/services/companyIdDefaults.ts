/**
 * Cloud-prisma write-time middleware.
 *
 * Two jobs, run on every create / createMany / upsert.create in cloud backend:
 *
 * Job 1 — fill companyId = MSPIL_ID when caller didn't supply one.
 *   51 models have `companyId String?` with the schema comment "null = MSPIL
 *   default". Developers forget to pass companyId → row lands with NULL →
 *   per-company queries (docSequence MAX(), getCompanyFilter, reports) miss it.
 *   Silent data fragmentation. Sister-concern writes that explicitly pass
 *   their own companyId are untouched.
 *
 * Job 2 — auto-generate the numbered-doc field (poNo / invoiceNo / grnNo / …)
 *   when caller didn't supply one. MSPIL has ONE PO series, ONE invoice series,
 *   etc. — but routes like fuel.ts, inventory.ts (auto-draft), and
 *   services/purchaseOrderService.ts were creating POs without calling
 *   nextDocNo, so they fell back to the Postgres `@default(autoincrement())`
 *   sequence, which drifts out of sync with MAX(poNo). That produced low
 *   numbers like PO-1, PO-2 colliding with legitimate PO-76 from the
 *   purchaseOrders.ts route. This middleware now calls nextDocNo for every
 *   numbered-doc create that doesn't specify the number explicitly, so a
 *   developer can never accidentally bypass it.
 *
 * Intentional scope:
 *   - runs on the cloud backend only (factory-server has its own Prisma client)
 *   - runs on create / upsert-create; createMany is excluded because you'd
 *     need pre-allocated numbers per row and the race inside one batch is not
 *     worth solving generically — code that uses createMany must set numbers
 *     itself
 *   - never runs on update (we do not silently rewrite existing rows)
 *   - runs on top-level args.data only — nested relation creates inside
 *     `include`/`create` blocks are Prisma-internal and don't hit middleware.
 *     Audit shows writes in this codebase are flat so this is acceptable.
 *   - explicit `companyId: null` is treated as "use default" to match schema
 *     semantics ("null = MSPIL default"); explicit `poNo: 123` is kept as-is
 *
 * Companion patch: backend/src/utils/docSequence.ts — still needs its
 * `OR "companyId" IS NULL` branch to keep legacy rows on MSPIL's sequence
 * until a separate backfill pass clears them.
 */

import { Prisma } from '@prisma/client';
import { nextDocNo } from '../utils/docSequence';

const MSPIL_ID = 'b499264a-8c73-4595-ab9b-7dc58f58c4d2';

// Numbered-document models — the auto-number field for each. MUST stay in
// sync with ALLOWED in utils/docSequence.ts. Adding a new numbered doc means
// updating BOTH here and there.
const NUMBERED_FIELDS: Record<string, string> = {
  PurchaseOrder: 'poNo',
  Invoice: 'invoiceNo',
  VendorInvoice: 'invoiceNo',
  GoodsReceipt: 'grnNo',
  SalesOrder: 'orderNo',
  VendorPayment: 'paymentNo',
  JournalEntry: 'entryNo',
  Shipment: 'shipmentNo',
};

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

async function fillNumberedField(model: string, data: any): Promise<void> {
  const field = NUMBERED_FIELDS[model];
  if (!field) return;
  if (data[field] !== undefined && data[field] !== null) return; // caller set it
  // companyId has already been filled by this point (see order in the
  // middleware below). Defensive fallback to MSPIL_ID just in case.
  const cid = (typeof data.companyId === 'string' && data.companyId) ? data.companyId : MSPIL_ID;
  data[field] = await nextDocNo(model, field, cid);
}

export const companyIdDefaultsMiddleware: Prisma.Middleware = async (params, next) => {
  const model = params.model;
  if (!model) return next(params);

  const hasCompany = MODELS_WITH_COMPANY_ID.has(model);
  const hasNumber = NUMBERED_FIELDS[model] !== undefined;
  if (!hasCompany && !hasNumber) return next(params);

  if (params.action === 'create') {
    const data = params.args?.data;
    if (data) {
      if (hasCompany && needsDefault(data)) data.companyId = MSPIL_ID;
      if (hasNumber) await fillNumberedField(model, data);
    }
  } else if (params.action === 'createMany') {
    // createMany is NOT auto-numbered — caller must set numbers themselves
    // (pre-allocating a safe batch of numbers is non-trivial and bulk creates
    // of numbered docs are not a supported pattern in this codebase).
    const data = params.args?.data;
    if (hasCompany) {
      if (Array.isArray(data)) {
        for (const row of data) {
          if (needsDefault(row)) row.companyId = MSPIL_ID;
        }
      } else if (needsDefault(data)) {
        data.companyId = MSPIL_ID;
      }
    }
  } else if (params.action === 'upsert') {
    // Only the `create` branch gets defaulted. The `update` branch is preserved
    // so existing rows keep whatever companyId / poNo they already have.
    const createArg = params.args?.create;
    if (createArg) {
      if (hasCompany && needsDefault(createArg)) createArg.companyId = MSPIL_ID;
      if (hasNumber) await fillNumberedField(model, createArg);
    }
  }

  return next(params);
};
