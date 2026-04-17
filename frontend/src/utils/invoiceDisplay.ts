/**
 * Resolve the printed invoice number for display.
 * Mirrors backend/src/utils/invoiceDisplay.ts — keep in sync.
 */
const DOC_SERIES = /^(INV|DCH|GP|CN|DN)\/[A-Z]+\/\d+$/;

export function invoiceDisplayNo(inv: { invoiceNo: number; remarks?: string | null }): string {
  if (inv.remarks && DOC_SERIES.test(inv.remarks)) return inv.remarks;
  return `INV-${inv.invoiceNo}`;
}
