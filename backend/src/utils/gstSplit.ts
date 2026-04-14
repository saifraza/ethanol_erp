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
 * Calculate GST split (CGST+SGST or IGST) for an invoice line.
 *
 * @param amount      Taxable amount
 * @param gstPercent  Total GST rate (e.g. 5, 18)
 * @param customerState  Customer's state name (e.g. 'Uttar Pradesh')
 * @param customerGstin  Customer's GSTIN — used as fallback if state is null
 */
export function calcGstSplit(
  amount: number,
  gstPercent: number,
  customerState: string | null | undefined,
  customerGstin?: string | null
): GstSplitResult {
  const gstAmount = Math.round((amount * gstPercent) / 100 * 100) / 100;

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
