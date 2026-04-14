/**
 * Centralized GST split calculation.
 *
 * Determines INTRA_STATE (CGST+SGST) vs INTER_STATE (IGST) by comparing
 * the customer's state to MSPIL's state (Madhya Pradesh, code 23).
 *
 * Resolution order:
 *   1. customerState string (exact match against 'Madhya Pradesh')
 *   2. customerGstin first 2 digits → state code 23 = MP
 *   3. If neither available → INTRA_STATE (safe default for local plant)
 */

const COMPANY_STATE = 'Madhya Pradesh';
const COMPANY_STATE_CODE = '23';

const GSTIN_STATE_MAP: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan',
  '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
  '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra & Nagar Haveli', '27': 'Maharashtra',
  '29': 'Karnataka', '30': 'Goa', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '36': 'Telangana', '37': 'Andhra Pradesh',
};

/** Derive state name from GSTIN prefix (first 2 digits) */
export function stateFromGstin(gstin: string | null | undefined): string | null {
  if (!gstin || gstin.length < 2) return null;
  return GSTIN_STATE_MAP[gstin.substring(0, 2)] || null;
}

/**
 * Validate GSTIN format.
 *
 * GSTIN format: 2-digit state code + 10-digit PAN + 1-digit entity + 'Z' + 1-digit checksum
 * Example: 21AAACM3666P1Z5 (Odisha, PAN AAACM3666P, entity 1, checksum 5)
 */
export function isValidGstin(gstin: string): boolean {
  if (!gstin || gstin.length !== 15) return false;
  const regex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  return regex.test(gstin.toUpperCase());
}

/** Extract PAN from GSTIN (chars 3–12). Returns null if GSTIN invalid. */
export function panFromGstin(gstin: string | null | undefined): string | null {
  if (!gstin || gstin.length < 12) return null;
  return gstin.substring(2, 12).toUpperCase();
}

export interface CustomerTaxValidation {
  valid: boolean;
  errors: string[];
  /** If valid and state was missing, this is the auto-filled state */
  derivedState?: string;
  /** If valid and PAN was missing, this is the auto-filled PAN */
  derivedPan?: string;
}

/**
 * Validate customer tax identity consistency:
 *   1. GSTIN format (if provided)
 *   2. GSTIN state prefix matches customer.state (if both provided)
 *   3. GSTIN embedded PAN matches customer.pan (if both provided)
 *
 * Returns what can be auto-filled (state from GSTIN, PAN from GSTIN).
 * Does NOT mutate inputs — caller decides whether to apply derivedState/derivedPan.
 *
 * Intentionally lenient when fields are missing (URD customers have no GSTIN).
 * Strict when fields are present and inconsistent — these are data-quality bugs
 * that cause wrong GST splits downstream.
 */
export function validateCustomerTaxIdentity(input: {
  gstNo?: string | null;
  state?: string | null;
  panNo?: string | null;
}): CustomerTaxValidation {
  const errors: string[] = [];
  const result: CustomerTaxValidation = { valid: true, errors };

  const gstin = (input.gstNo || '').trim().toUpperCase();
  const state = (input.state || '').trim();
  const pan = (input.panNo || '').trim().toUpperCase();

  // If no GSTIN, nothing to cross-check. URD customer is legal.
  if (!gstin) return result;

  // GSTIN format
  if (!isValidGstin(gstin)) {
    errors.push(`GSTIN "${gstin}" is not a valid 15-character GSTIN format`);
    result.valid = false;
    return result;
  }

  // GSTIN → state
  const gstinState = stateFromGstin(gstin);
  if (!gstinState) {
    errors.push(`GSTIN state code "${gstin.substring(0, 2)}" is not recognised`);
    result.valid = false;
    return result;
  }

  if (!state) {
    // Auto-fill from GSTIN
    result.derivedState = gstinState;
  } else if (state.toLowerCase() !== gstinState.toLowerCase()) {
    errors.push(
      `State "${state}" doesn't match GSTIN "${gstin}". ` +
      `GSTIN prefix "${gstin.substring(0, 2)}" = ${gstinState}. ` +
      `Either fix the state to "${gstinState}" or correct the GSTIN.`
    );
    result.valid = false;
  }

  // GSTIN → PAN
  const gstinPan = panFromGstin(gstin);
  if (gstinPan) {
    if (!pan) {
      result.derivedPan = gstinPan;
    } else if (pan !== gstinPan) {
      errors.push(
        `PAN "${pan}" doesn't match PAN embedded in GSTIN ("${gstinPan}"). ` +
        `Either fix PAN to "${gstinPan}" or correct the GSTIN.`
      );
      result.valid = false;
    }
  }

  return result;
}

/**
 * Determine if the supply is inter-state.
 *
 * Tries customerState first, then falls back to GSTIN-based detection.
 * Returns null (unknown) only if both are missing.
 */
function isInterState(
  customerState: string | null | undefined,
  customerGstin?: string | null
): boolean | null {
  // 1. Explicit state string
  if (customerState) {
    return customerState.toLowerCase() !== COMPANY_STATE.toLowerCase();
  }
  // 2. GSTIN-based fallback
  if (customerGstin && customerGstin.length >= 2) {
    return customerGstin.substring(0, 2) !== COMPANY_STATE_CODE;
  }
  // 3. Unknown — caller decides default
  return null;
}

export interface GstSplitResult {
  supplyType: 'INTRA_STATE' | 'INTER_STATE';
  gstAmount: number;
  cgstPercent: number;
  cgstAmount: number;
  sgstPercent: number;
  sgstAmount: number;
  igstPercent: number;
  igstAmount: number;
}

/**
 * Thrown when calcGstSplit detects customer data so inconsistent that
 * producing a GST split would silently pick the wrong supply type.
 * Callers should catch this, refuse the invoice, and tell the user to
 * fix the customer record.
 */
export class GstSplitError extends Error {
  constructor(message: string) { super(message); this.name = 'GstSplitError'; }
}

/**
 * Calculate GST split (CGST+SGST or IGST) for an invoice line.
 *
 * @param amount      Taxable amount
 * @param gstPercent  Total GST rate (e.g. 5, 18)
 * @param customerState  Customer's state name (e.g. 'Uttar Pradesh')
 * @param customerGstin  Customer's GSTIN — used as fallback if state is null
 *
 * @throws GstSplitError if customerState and customerGstin both provided but
 *   disagree on state code. This prevents silent wrong-GST invoices.
 */
export function calcGstSplit(
  amount: number,
  gstPercent: number,
  customerState: string | null | undefined,
  customerGstin?: string | null
): GstSplitResult {
  const gstAmount = Math.round((amount * gstPercent) / 100 * 100) / 100;

  // SAFETY NET: if both state and GSTIN are provided and disagree, refuse —
  // this catches corrupt customer records before they produce a wrong-GST invoice.
  if (customerState && customerGstin && customerGstin.length >= 2) {
    const gstinState = stateFromGstin(customerGstin);
    if (gstinState && customerState.toLowerCase().trim() !== gstinState.toLowerCase().trim()) {
      throw new GstSplitError(
        `Customer tax data inconsistent: state="${customerState}" but GSTIN="${customerGstin}" ` +
        `resolves to "${gstinState}". Fix the customer record (state must match GSTIN prefix) ` +
        `before invoicing.`
      );
    }
  }

  // Default to INTRA_STATE when state is unknown (safer for local plant)
  const interstate = isInterState(customerState, customerGstin) ?? false;

  if (interstate) {
    return {
      supplyType: 'INTER_STATE',
      gstAmount,
      cgstPercent: 0, cgstAmount: 0,
      sgstPercent: 0, sgstAmount: 0,
      igstPercent: gstPercent, igstAmount: gstAmount,
    };
  }

  const half = Math.round(gstAmount / 2 * 100) / 100;
  return {
    supplyType: 'INTRA_STATE',
    gstAmount,
    cgstPercent: gstPercent / 2, cgstAmount: half,
    sgstPercent: gstPercent / 2, sgstAmount: Math.round((gstAmount - half) * 100) / 100,
    igstPercent: 0, igstAmount: 0,
  };
}
