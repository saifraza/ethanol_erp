/**
 * Activity Logger — Prisma $use middleware that writes a row to ActivityLog
 * for every CREATE / UPDATE / DELETE on a whitelist of HIGH-VALUE models.
 *
 * Why a whitelist (not "log everything")?
 *   The ERP writes thousands of rows/day (heartbeats, sync queue, OPC tags,
 *   counters, stock levels). Logging all of them buries the high-value events
 *   in noise. The whitelist captures financial, master-data, weighbridge,
 *   contract, and config writes — anything an auditor would care about.
 *
 * How it works:
 *   - Wraps each Prisma write with a SELECT-then-WRITE for UPDATE/DELETE so
 *     we can compute a field-level diff. CREATE just records the new row.
 *   - Reads the user from AsyncLocalStorage (set in requestContext middleware).
 *     Writes outside any request (background workers) get userName='system'.
 *   - Self-write guard: never logs ActivityLog/WeighmentAuditEvent writes
 *     (would loop forever or duplicate the dedicated audit page).
 *   - Failures are swallowed — the activity log must NEVER block a real write.
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { getRequestContext } from './requestContext';

// Track in-flight log writes so CLI scripts can drain them before process.exit.
// Server processes never exit (or exit via SIGTERM which we don't gate); only
// CLI/one-shot scripts need this. Capped implicitly by the rate of writes —
// typical high-value endpoints produce 1-2 logs per request.
const _pendingLogs = new Set<Promise<void>>();

/** Await all in-flight ActivityLog writes. CLI scripts MUST call this before
 *  process.exit(0) or the last few log rows will be dropped. */
export async function flushActivityLogs(): Promise<void> {
  if (_pendingLogs.size === 0) return;
  await Promise.allSettled([..._pendingLogs]);
}

// Whitelist: model name → category. Models not in this map are NOT logged.
// To add a model: pick an existing category or add a new one.
const MODEL_CATEGORY: Record<string, string> = {
  // FINANCIAL
  Invoice: 'FINANCIAL',
  VendorInvoice: 'FINANCIAL',
  VendorPayment: 'FINANCIAL',
  BankPayment: 'FINANCIAL',
  JournalEntry: 'FINANCIAL',
  BankReconciliation: 'FINANCIAL',
  CustomerReceipt: 'FINANCIAL',
  CashTransaction: 'FINANCIAL',
  PettyCashEntry: 'FINANCIAL',

  // MASTER DATA
  Vendor: 'MASTER_DATA',
  Customer: 'MASTER_DATA',
  InventoryItem: 'MASTER_DATA',
  ChartOfAccount: 'MASTER_DATA',
  Bank: 'MASTER_DATA',
  FiscalYear: 'MASTER_DATA',
  GstRate: 'MASTER_DATA',
  HsnCode: 'MASTER_DATA',
  TdsSection: 'MASTER_DATA',
  TcsSection: 'MASTER_DATA',
  Company: 'MASTER_DATA',
  InvoiceSeries: 'MASTER_DATA',

  // INVENTORY / PROCUREMENT
  PurchaseOrder: 'INVENTORY',
  POLine: 'INVENTORY',
  GoodsReceipt: 'INVENTORY',
  GoodsReceiptLine: 'INVENTORY',
  StockMovement: 'INVENTORY',
  DirectPurchase: 'INVENTORY',

  // SALES
  SalesOrder: 'INVENTORY',
  Shipment: 'INVENTORY',

  // WEIGHBRIDGE
  GrainTruck: 'WEIGHBRIDGE',
  DispatchTruck: 'WEIGHBRIDGE',
  DDGSDispatchTruck: 'WEIGHBRIDGE',
  SugarDispatchTruck: 'WEIGHBRIDGE',
  Weighment: 'WEIGHBRIDGE',
  WeighmentCorrection: 'WEIGHBRIDGE',

  // CONTRACTS
  EthanolContract: 'CONTRACT',
  DDGSContract: 'CONTRACT',
  SugarContract: 'CONTRACT',
  DDGSContractDispatch: 'CONTRACT',
  SugarContractDispatch: 'CONTRACT',

  // COMPLIANCE
  ComplianceObligation: 'COMPLIANCE',
  GstReconRun: 'COMPLIANCE',

  // AUTH
  User: 'AUTH',
  FactoryUser: 'AUTH',
};

// Models we MUST NOT log (would create infinite loop or pure noise)
const SELF_WRITE_BLACKLIST = new Set([
  'ActivityLog',
  'WeighmentAuditEvent',
]);

const TRACKED_ACTIONS = new Set(['create', 'update', 'delete', 'updateMany', 'deleteMany', 'upsert']);

/** Truncate big payloads — protect the DB from a 50MB JSON write. */
function truncate(value: unknown, maxLen = 4000): unknown {
  if (value == null) return value;
  const s = JSON.stringify(value);
  if (s.length <= maxLen) return value;
  return { _truncated: true, _originalLength: s.length, preview: s.slice(0, maxLen) };
}

/** Compute a field-level diff between before/after for UPDATE. */
function computeDiff(before: Record<string, unknown> | null, after: Record<string, unknown>): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  if (!before) return diff;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    const a = before[k];
    const b = after[k];
    // Compare via JSON to handle Date / Decimal / nested objects
    const aStr = a == null ? null : JSON.stringify(a);
    const bStr = b == null ? null : JSON.stringify(b);
    if (aStr !== bStr) diff[k] = { from: truncate(a, 1000), to: truncate(b, 1000) };
  }
  return diff;
}

/** Best-effort summary line ("UPDATE Invoice INV-2026-0042 (amount, dueDate)"). */
function summarize(model: string, action: string, after: Record<string, unknown> | null, diff: Record<string, unknown> | null): string {
  // Try to find a friendly identifier
  const id = (after?.invoiceNo ?? after?.poNo ?? after?.ticketNo ?? after?.name ?? after?.id ?? '') as string | number;
  const idStr = id ? ` ${id}` : '';
  if (action === 'CREATE' || action === 'DELETE') return `${action} ${model}${idStr}`;
  // UPDATE — list changed fields
  const fields = diff ? Object.keys(diff).slice(0, 5) : [];
  const fieldList = fields.length > 0 ? ` (${fields.join(', ')})` : '';
  return `${action} ${model}${idStr}${fieldList}`;
}

/** Write a row to ActivityLog. Errors are swallowed. */
async function writeActivityLog(args: {
  category: string;
  model: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  recordId: string | null;
  changes: unknown;
  summary: string;
}): Promise<void> {
  try {
    const ctx = getRequestContext();
    if (ctx?.skipActivityLog) return;
    await prisma.activityLog.create({
      data: {
        category: args.category,
        model: args.model,
        action: args.action,
        recordId: args.recordId,
        userId: ctx?.userId ?? null,
        userName: ctx?.userName ?? 'system',
        userRole: ctx?.userRole ?? null,
        routePath: ctx?.routePath ?? null,
        ipAddress: ctx?.ipAddress ?? null,
        summary: args.summary,
        changes: args.changes === undefined || args.changes === null
          ? Prisma.JsonNull
          : (args.changes as Prisma.InputJsonValue),
      },
    });
  } catch (err) {
    // Never throw from the activity logger — would break the underlying write.
    console.error('[activity-log] write failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * The Prisma middleware. Registered in config/prisma.ts.
 *
 * For UPDATE/DELETE on tracked models, runs a SELECT first so we can compute
 * the diff. Adds latency only on the whitelisted models (not on hot paths
 * like sync queue, heartbeats, OPC tag writes — those stay middleware-free).
 */
export const activityLogMiddleware: Prisma.Middleware = async (params, next) => {
  const model = params.model;
  const action = params.action;

  // Fast-path: skip everything we don't track
  if (!model || !TRACKED_ACTIONS.has(action) || SELF_WRITE_BLACKLIST.has(model)) {
    return next(params);
  }
  const category = MODEL_CATEGORY[model];
  if (!category) return next(params);

  // For UPDATE / DELETE — capture the BEFORE state so we can diff
  let before: Record<string, unknown> | null = null;
  if (action === 'update' || action === 'delete') {
    try {
      const where = (params.args as { where?: Record<string, unknown> })?.where;
      if (where) {
        // @ts-expect-error — dynamic model accessor
        before = await prisma[lcFirst(model)].findUnique({ where }).catch(() => null);
      }
    } catch { /* ignore */ }
  }

  // Run the actual operation
  const result = await next(params);

  // Log AFTER the write succeeded. Fire-and-forget so the underlying write
  // (and the user's response) isn't blocked on the audit write. We track the
  // promise in _pendingLogs so CLI scripts can drain pending writes before
  // process.exit(0) — otherwise the last few log rows get dropped (the race
  // we hit on T-0450 correction 2026-04-15).
  const logPromise = (async () => {
    try {
      const after = (result && typeof result === 'object' && !Array.isArray(result))
        ? (result as Record<string, unknown>)
        : null;
      const recordId = after?.id ? String(after.id) : (before?.id ? String(before.id) : null);

      let mappedAction: 'CREATE' | 'UPDATE' | 'DELETE';
      let changes: unknown;

      if (action === 'create' || (action === 'upsert' && !before)) {
        mappedAction = 'CREATE';
        changes = truncate(after);
      } else if (action === 'update' || action === 'updateMany' || action === 'upsert') {
        mappedAction = 'UPDATE';
        const diff = before && after ? computeDiff(before, after) : {};
        // Don't log no-op writes
        if (Object.keys(diff).length === 0) return;
        changes = truncate(diff);
      } else { // delete / deleteMany
        mappedAction = 'DELETE';
        changes = truncate(before ?? after);
      }

      const summary = summarize(model, mappedAction, after, changes as Record<string, unknown>);
      await writeActivityLog({ category, model, action: mappedAction, recordId, changes, summary });
    } catch (err) {
      console.error('[activity-log] middleware logging failed:', err instanceof Error ? err.message : err);
    }
  })();
  _pendingLogs.add(logPromise);
  void logPromise.finally(() => _pendingLogs.delete(logPromise));

  return result;
};

function lcFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
