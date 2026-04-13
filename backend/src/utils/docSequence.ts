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

  const result = await prisma.$queryRawUnsafe<Array<{ max: number | null }>>(
    `SELECT MAX("${field}") as max FROM "${table}" WHERE "companyId" = $1`,
    cid
  );

  return (result[0]?.max || 0) + 1;
}
