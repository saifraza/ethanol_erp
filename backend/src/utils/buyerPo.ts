/**
 * Resolve the customer's PO number + display label printed on the invoice PDF.
 *
 * Per-invoice override (Invoice.buyerPoNo) wins, else the contract default
 * (EthanolContract.buyerPoNo). The label adapts to the buyer / OMC name
 * (Reliance → "RIL PO No.", IOCL/HPCL/BPCL/Nayara → their short label, else "PO No.").
 *
 * Shared by the live PDF route (routes/invoices.ts) AND the snapshot freezer
 * (services/invoiceSnapshot.ts) so a frozen snapshot renders the PO identically
 * to a live render. Keeping this in ONE place is deliberate: the snapshot losing
 * the PO (because its build path didn't replicate this logic) is the exact bug
 * this helper exists to prevent.
 */
export function resolveBuyerPo(
  invoicePoNo: string | null | undefined,
  contractPoNo: string | null | undefined,
  buyerName: string | null | undefined,
): { buyerPoNo: string | null; poLabel: string } {
  const buyerPoNo = invoicePoNo || contractPoNo || null;
  const buyer = (buyerName || '').toUpperCase();
  let poLabel = 'PO No.';
  if (buyer.includes('RELIANCE')) poLabel = 'RIL PO No.';
  else if (buyer.includes('INDIAN OIL') || buyer.includes('IOCL')) poLabel = 'IOCL PO No.';
  else if (buyer.includes('HINDUSTAN PETROL') || buyer.includes('HPCL')) poLabel = 'HPCL PO No.';
  else if (buyer.includes('BHARAT PETROL') || buyer.includes('BPCL')) poLabel = 'BPCL PO No.';
  else if (buyer.includes('NAYARA')) poLabel = 'NAYARA PO No.';
  return { buyerPoNo, poLabel };
}
