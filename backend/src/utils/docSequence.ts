/**
 * Company-scoped document number generator.
 * Replaces @default(autoincrement()) with per-company sequences.
 *
 * Usage:
 *   const poNo = await nextDocNo('PurchaseOrder', 'poNo', companyId);
 *   await prisma.purchaseOrder.create({ data: { poNo, ... } });
 *
 * Safety: uses raw SQL MAX() + 1. If two concurrent creates race,
 * the @@unique([companyId, field]) constraint catches it and the retry loop handles it.
 *
 * 2026-04-21 bug fix — MSPIL was restarting at 1 when legacy rows had companyId=null.
 * Schema comment says "null = MSPIL default" — honor that when computing MSPIL's max.
 * For MSPIL, include companyId IS NULL rows. For any other company, strict match only.
 */
import prisma from '../config/prisma';

const MSPIL_ID = 'b499264a-8c73-4595-ab9b-7dc58f58c4d2';

/**
 * Get the next document number for a model+field scoped to a company.
 * @param table   - Prisma model name as it appears in the DB (e.g. "PurchaseOrder")
 * @param field   - The auto-number field (e.g. "poNo")
 * @param companyId - Company UUID. Null = MSPIL.
 */
export async function nextDocNo(table: string, field: string, companyId: string | null): Promise<number> {
  const cid = companyId || MSPIL_ID;

  // Whitelist tables+fields to prevent SQL injection
  const ALLOWED: Record<string, string[]> = {
    PurchaseOrder: ['poNo'],
    Invoice: ['invoiceNo'],
    VendorInvoice: ['invoiceNo'],
    GoodsReceipt: ['grnNo'],
    SalesOrder: ['orderNo'],
    VendorPayment: ['paymentNo'],
    JournalEntry: ['entryNo'],
    Shipment: ['shipmentNo'],
  };
  if (!ALLOWED[table]?.includes(field)) {
    throw new Error(`nextDocNo: invalid table/field: ${table}.${field}`);
  }

  // Pre-multi-company rows have companyId = NULL and must be treated as MSPIL's history
  // (schema comment: "null = MSPIL default"). Without this, every MSPIL document type
  // restarts at 1 after the multi-company rollout, creating duplicate PO/Invoice/GRN
  // numbers with legacy rows.
  const isMspil = cid === MSPIL_ID;
  const whereClause = isMspil
    ? `WHERE "companyId" = $1 OR "companyId" IS NULL`
    : `WHERE "companyId" = $1`;

  const result = await prisma.$queryRawUnsafe<Array<{ max: number | null }>>(
    `SELECT MAX("${field}") as max FROM "${table}" ${whereClause}`,
    cid
  );

  return (result[0]?.max || 0) + 1;
}
