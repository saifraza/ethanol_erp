// Single source of truth for the product / description TEXT printed on ethanol
// dispatch documents (tax invoice, delivery challan, gate pass, e-way bill).
//
// Why this file exists: the same `JOB_WORK_PRODUCT_NAME = 'Ethanol'` constant used
// to be duplicated in ethanolContracts.ts, dispatch.ts and ethanolGatePass.ts (plus
// hardcoded in the challan template). A fix in one place silently missed the others —
// that drift is the root cause of the recurring #156 / #172 / #173 description bugs.
// Everything now resolves through here.
//
// IMPORTANT — classification is NOT derived from these strings. The GST tax class
// (service SAC 998842 vs goods HSN 22072000) is set EXPLICITLY by contractType at
// every IRN / EWB / PDF path. Changing the printed text here can never change the
// SAC, HSN, IsServc flag, or GST rate. Keep it that way.

// Sale (FIXED_PRICE / OMC) ethanol — statutory DFG + Brucine description.
export const ETHANOL_SALE_PRODUCT_NAME =
  'DENATURED ETHANOL FROM DFG (DAMAGED FOOD GRAINS) - DENATURED WITH BRUCINE SULPHATE 40 PPM';

// Job-work ethanol printed name, by principal:
//   SM PRIMAL  → "Job Work Charges for Ethanol Production"  (user ruling 2026-06-20)
//   all others (e.g. MASH BIO-FUELS) → plain "Ethanol"      (user ruling 2026-06-04 / #173)
export const SM_PRIMAL_JOBWORK_NAME = 'Job Work Charges for Ethanol Production';
export const DEFAULT_JOBWORK_NAME = 'Ethanol';

const SM_PRIMAL_GSTIN = '23ABGCS5473D1ZF';
const SM_PRIMAL_NAME_RE = /s\.?\s*m\.?\s*primal/i;

type ContractBuyer = { buyerGst?: string | null; buyerName?: string | null };

// Identify an SM PRIMAL contract by GSTIN (primary) or buyer name (fallback for rows
// whose GSTIN was not captured). Unknown buyer → false → safe default ("Ethanol").
export function isSmPrimal(c: ContractBuyer): boolean {
  return (c.buyerGst || '').toUpperCase() === SM_PRIMAL_GSTIN || SM_PRIMAL_NAME_RE.test(c.buyerName || '');
}

// Printed product / description for a JOB_WORK ethanol document. Null-tolerant
// (unknown buyer → default "Ethanol") so it's safe at nullable contract call sites.
export function ethanolJobWorkProductName(c: ContractBuyer | null | undefined): string {
  return c && isSmPrimal(c) ? SM_PRIMAL_JOBWORK_NAME : DEFAULT_JOBWORK_NAME;
}

// Printed product / description for ANY ethanol document, resolved by contract type.
// Null-tolerant: a missing contract (or non-JOB_WORK) falls back to the sale name, matching
// the legacy `isJobWork ? jobWork : sale` behaviour at every call site.
export function ethanolDocProductName(
  c: (ContractBuyer & { contractType?: string | null }) | null | undefined,
): string {
  if (c && c.contractType === 'JOB_WORK') return ethanolJobWorkProductName(c);
  return ETHANOL_SALE_PRODUCT_NAME;
}
