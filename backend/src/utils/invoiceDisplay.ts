/**
 * Resolve the printed invoice number for display.
 *
 * Our Invoice.invoiceNo is an internal int (autoincrement), but the number that
 * appears on the customer-facing PDF + e-invoice + BS is stored in `remarks`
 * (e.g. "INV/ETH/040"). Use this everywhere — PDFs, BS narrations, e-invoice
 * API payloads, payment advice, UI — so the same number appears in all places.
 *
 * Accepts arbitrary text in remarks but only passes it through when it matches
 * a doc-series pattern (INV/XYZ/NNN, DCH/XYZ/NNN, GP/XYZ/NNN, CN/XYZ/NNN, DN/XYZ/NNN).
 * Otherwise falls back to `INV-<int>`.
 */
const DOC_SERIES = /^(INV|DCH|GP|CN|DN)\/[A-Z]+\/\d+$/;

export function invoiceDisplayNo(inv: { invoiceNo: number; remarks?: string | null }): string {
  if (inv.remarks && DOC_SERIES.test(inv.remarks)) return inv.remarks;
  return `INV-${inv.invoiceNo}`;
}
