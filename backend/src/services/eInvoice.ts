/**
 * E-Invoice (IRN) Generation Service via Saral GSP
 *
 * Generates IRN (Invoice Reference Number) for invoices using Saral GST Suvidha Provider.
 * Reuses Saral auth from ewayBill service.
 *
 * Configure via environment variables:
 *   EWAY_SARAL_URL=https://saralgsp.com
 *   EWAY_NIC_CLIENT_ID=your_client_id
 *   EWAY_NIC_CLIENT_SECRET=your_client_secret
 *   EWAY_EWB_USERNAME=API_MHKSPIL_RELYON  (same user for both EWB and e-Invoice)
 *   EWAY_EWB_PASSWORD=Reladmin@123
 *   EWAY_GSTIN=23AAECM3666P1Z1
 */

import { getSaralAuth, clearSaralAuthCache } from './ewayBill';

export interface IRNPayload {
  Version: string;
  TranDtls: {
    TaxSch: string;
    SupTyp: string;
    RegRev?: string;
    IgstOnIntra?: string;
  };
  DocDtls: {
    Typ: string;
    No: string;
    Dt: string;
  };
  SellerDtls: {
    Gstin: string;
    LglNm?: string;
    TrdNm?: string;
    Addr1?: string;
    Addr2?: string;
    Loc?: string;
    Pin?: number;
    Stcd?: string;
    Ph?: string;
    Em?: string;
  };
  BuyerDtls: {
    Gstin?: string;
    Lglnm?: string;
    Trdnm?: string;
    Addr1?: string;
    Addr2?: string;
    Loc?: string;
    Pos?: string;
    Pin?: number;
    Stcd?: string;
    Ph?: string;
    Em?: string;
  };
  ItemList: Array<{
    SlNo: string;
    IsServc?: string;
    AssAmt?: number;
    HsnCd?: string;
    BarcodeId?: string;
    Qty: number;
    FreeQty?: number;
    Unit: string;
    UnitPrice: number;
    TotAmt: number;
    Discount?: number;
    PreTaxVal?: number;
    TaxRate: number;
    TaxAmt: number;
    TaxType?: string;
    TaxCatg?: string;
    GstRt?: number;
    IgstAmt?: number;
    CgstAmt?: number;
    SgstAmt?: number;
    CesRt?: number;
    CesAmt?: number;
    CesNonAdvlAmt?: number;
    StateCesRt?: number;
    StateCesAmt?: number;
    StateCesNonAdvlAmt?: number;
    OthChrg?: number;
    TotItemVal: number;
    AssetClass?: string;
    OthItmDesc?: string;
    BchDtls?: object;
    AttribDtls?: object[];
  }>;
  ValDtls: {
    AssVal?: number;
    CgstVal?: number;
    SgstVal?: number;
    IgstVal?: number;
    CesVal?: number;
    StateCesVal?: number;
    Discount?: number;
    OthChrg?: number;
    RndOffAmt?: number;
    TotInvVal: number;
    TotInvValFc?: number;
    Conversion?: number;
  };
  PayDtls?: object;
  RefDtls?: object;
  AddlDtls?: {
    AuthDesc?: string;
    AuthPeriod?: string;
    AuthRlTn?: string;
    AuthDate?: string;
    AuthClNo?: string;
    OthMsg?: string;
    Notes?: string[];
    OthItmDesc?: string;
  };
  ExpDtls?: object;
  ShipDtls?: object;
  DispDtls?: object;
}

export interface IRNResponse {
  success: boolean;
  irn?: string;
  ackNo?: string;
  ackDt?: string;
  signedInvoice?: string;
  signedQRCode?: string;
  status?: string;
  error?: string;
  rawResponse?: any;
}

export interface IRNCancelResponse {
  success: boolean;
  irn?: string;
  cancelDate?: string;
  error?: string;
  rawResponse?: any;
}

/**
 * Build IRN payload from invoice data
 */
/** Round to 2 decimal places — NIC rejects more than 2 decimals */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildIRNPayload(invoice: any): IRNPayload {
  const gstin = process.env.EWAY_GSTIN || '23AAECM3666P1Z1';
  const stateCode = gstin.substring(0, 2);
  const buyerStateCode = invoice.customer?.gstin
    ? invoice.customer.gstin.substring(0, 2)
    : '27';

  const invDate = new Date(invoice.invoiceDate);
  const invoiceDateStr = `${String(invDate.getDate()).padStart(2, '0')}/${String(invDate.getMonth() + 1).padStart(2, '0')}/${invDate.getFullYear()}`;

  const isInterstate = stateCode !== buyerStateCode;
  const gstRate = invoice.gstPercent || 18;
  const baseAmount = round2(invoice.amount || 0);
  const totalTax = round2((baseAmount * gstRate) / 100);
  const cgstAmt = isInterstate ? 0 : round2(totalTax / 2);
  const sgstAmt = isInterstate ? 0 : round2(totalTax / 2);
  const igstAmt = isInterstate ? round2(totalTax) : 0;

  // Invoice number: use as-is if it already has a series prefix (INV/, MSPIL/, etc.), otherwise add INV-
  const rawInvNo = String(invoice.invoiceNo || invoice.id);
  const invoiceNo = /^[A-Z]/.test(rawInvNo) ? rawInvNo : `INV-${rawInvNo}`;

  const payload: IRNPayload = {
    Version: '1.1',
    TranDtls: {
      TaxSch: 'GST',
      SupTyp: 'B2B',
      RegRev: 'N',
    },
    DocDtls: {
      Typ: 'INV',
      No: invoiceNo,
      Dt: invoiceDateStr,
    },
    SellerDtls: {
      Gstin: gstin,
      LglNm: 'Mahakaushal Sugar and Power Industries Ltd.',
      TrdNm: 'MSPIL',
      Addr1: 'Village Bachai, Dist. Narsinghpur',
      Loc: 'Narsinghpur',
      Pin: 487001,
      Stcd: stateCode,
      Ph: '9425154000',
    },
    BuyerDtls: {
      Gstin: invoice.customer?.gstin || undefined,
      Lglnm: invoice.customer?.name || 'Buyer',
      Trdnm: invoice.customer?.name || 'Buyer',
      Pos: buyerStateCode,  // Place of Supply (required)
      Addr1: invoice.customer?.address || '',
      Loc: invoice.customer?.city || invoice.customer?.address?.split(',').pop()?.trim() || 'NA',
      Pin: invoice.customer?.pincode ? parseInt(invoice.customer.pincode) : undefined,
      Stcd: buyerStateCode,
      Ph: (invoice.customer?.phone && invoice.customer.phone.length >= 6) ? invoice.customer.phone : '0000000000',
      Em: (invoice.customer?.email && invoice.customer.email.length >= 6) ? invoice.customer.email : 'na@na.com',
    },
    ItemList: [
      {
        SlNo: '1',
        IsServc: getHsnCode(invoice.productName || 'DDGS').startsWith('99') ? 'Y' : 'N',
        HsnCd: getHsnCode(invoice.productName || 'DDGS'),
        Qty: invoice.quantity || 0,
        Unit: getIRNUnit(invoice.unit || 'KL'),
        UnitPrice: invoice.rate || 0,
        TotAmt: round2(baseAmount),
        PreTaxVal: round2(baseAmount),
        AssAmt: round2(baseAmount),  // Assessable Amount (required)
        TaxRate: gstRate,
        TaxAmt: round2(totalTax),
        TaxType: 'GST',
        GstRt: gstRate,
        IgstAmt: round2(igstAmt),
        CgstAmt: round2(cgstAmt),
        SgstAmt: round2(sgstAmt),
        TotItemVal: round2(baseAmount + totalTax),
      },
    ],
    ValDtls: {
      AssVal: round2(baseAmount),
      CgstVal: round2(cgstAmt),
      SgstVal: round2(sgstAmt),
      IgstVal: round2(igstAmt),
      TotInvVal: round2(baseAmount + totalTax),
    },
  };

  return payload;
}

function getHsnCode(productName: string): string {
  const upper = (productName || '').toUpperCase().trim();
  const hsnMap: Record<string, string> = {
    'DDGS': '23033000',         // Ch 23: Residues of starch/distilling — DDGS for animal feed, 5% GST
    'ETHANOL': '22072000',      // Ch 22: Denatured ethyl alcohol (fuel ethanol), 18% GST
    'JOB WORK CHARGES FOR ETHANOL PRODUCTION': '998842',  // SAC: Manufacturing services on physical inputs
    'JOB WORK CHARGES FOR DDGS PRODUCTION': '998817',     // SAC: Maintenance and repair services
    'ENA': '22071090',          // Ch 22: Undenatured ethyl alcohol ≥80% (Extra Neutral Alcohol)
    'RS': '22071019',           // Ch 22: Rectified spirit (other rectified spirit)
    'LFO': '27101960',          // Ch 27: Light diesel oil / light furnace oil
    'HFO': '27101950',          // Ch 27: Furnace oil / heavy furnace oil
    'CO2': '28112100',          // Ch 28: Carbon dioxide
    'MAIZE': '10059000',        // Ch 10: Maize (corn) other
    'RICE': '10063090',         // Ch 10: Rice (broken/other)
  };
  return hsnMap[upper] || '99999999';
}

function getIRNUnit(unit: string): string {
  const upper = (unit || '').toUpperCase().trim();
  const unitMap: Record<string, string> = {
    'TON': 'MTS',
    'MT': 'MTS',
    'KL': 'KLR',
    'LTR': 'LTR',
    'KG': 'KGS',
    'BAG': 'BAG',
    'NOS': 'NOS',
  };
  return unitMap[upper] || 'OTH';
}

/**
 * Build headers for e-Invoice API calls.
 * IMPORTANT: Uses the SAME API user (EWB credentials) for both EWB and e-Invoice.
 * Saral GSP maps one API user to both portals — do NOT use separate EINV credentials.
 */
function buildEInvoiceHeaders(auth: Awaited<ReturnType<typeof getSaralAuth>>): Record<string, string> {
  const gstin = process.env.EWAY_GSTIN || '23AAECM3666P1Z1';
  // Use EWB credentials — same user works for both EWB and e-Invoice via Saral
  const username = process.env.EWAY_EWB_USERNAME || process.env.EWAY_NIC_USERNAME || '';
  const password = process.env.EWAY_EWB_PASSWORD || process.env.EWAY_NIC_PASSWORD || '';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'AuthenticationToken': auth.saralToken,
    'SubscriptionId': auth.subscriptionId,
    'Gstin': gstin,
    'UserName': username,
  };
  if (password) headers['Password'] = password;
  if (auth.nicAuthToken) headers['AuthToken'] = auth.nicAuthToken;
  if (auth.nicSek) headers['sek'] = auth.nicSek;
  return headers;
}

/** Small delay helper */
function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export async function generateIRN(invoiceData: any, retryCount = 0): Promise<IRNResponse> {
  const MAX_RETRIES = 2; // up to 3 total attempts (0, 1, 2)
  try {
    // Force fresh auth on retry, with a small delay to let network settle
    if (retryCount > 0) {
      clearSaralAuthCache();
      await delay(2000 * retryCount); // 2s, then 4s
    }

    const auth = await getSaralAuth();
    const baseUrl = (process.env.EWAY_SARAL_URL || 'https://saralgsp.com').replace(/\/+$/, '');
    const apiUsername = process.env.EWAY_EWB_USERNAME || process.env.EWAY_NIC_USERNAME || '';

    if (!apiUsername) {
      return { success: false, error: 'API credentials not configured (EWAY_EWB_USERNAME or EWAY_NIC_USERNAME)' };
    }

    const payload = buildIRNPayload(invoiceData);
    const url = `${baseUrl}/eicore/v1.03/Invoice`;
    const headers = buildEInvoiceHeaders(auth);

    const bodyStr = JSON.stringify(payload);
    console.log(`[E-Invoice] Generating IRN at ${url} (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);
    console.log(`[E-Invoice] Invoice: ${invoiceData.invoiceNo || invoiceData.id}`);
    console.log(`[E-Invoice] Payload (first 500): ${bodyStr.slice(0, 500)}`);

    // 45s timeout to prevent hanging
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: bodyStr,
        signal: controller.signal,
      });
    } catch (fetchErr: any) {
      clearTimeout(timeout);
      const cause = fetchErr.cause ? `${fetchErr.cause.code || fetchErr.cause.message || fetchErr.cause}` : '';
      if (fetchErr.name === 'AbortError') {
        throw new Error(`IRN request timed out after 45s`);
      }
      throw new Error(`Network error: ${fetchErr.message}${cause ? ` (${cause})` : ''}`);
    } finally {
      clearTimeout(timeout);
    }

    const resultText = await response.text();
    console.log(`[E-Invoice] Response status: ${response.status}, body:`, resultText.slice(0, 500));

    let result: any;
    try {
      result = JSON.parse(resultText);
    } catch {
      throw new Error(`Non-JSON response: ${resultText.slice(0, 200)}`);
    }

    if (result.Irn || result.irn) {
      const irn = result.Irn || result.irn;
      return {
        success: true,
        irn,
        ackNo: (result.AckNo || result.ackNo) ? String(result.AckNo || result.ackNo) : undefined,
        ackDt: result.AckDt || result.ackDt,
        signedInvoice: result.SignedInvoice || result.signedInvoice,
        signedQRCode: result.SignedQRCode || result.signedQRCode,
        status: result.Status || 'ACT',
        rawResponse: result,
      };
    }

    const errors = result.ErrorDetails || result.errorDetails || [];
    const errorMsg = errors.length > 0
      ? errors.map((e: any) => `${e.ErrorCode || e.errorCode}: ${e.ErrorMessage || e.errorMessage}`).join('; ')
      : result.Error || result.error || result.Message || JSON.stringify(result).slice(0, 300);

    // Handle Duplicate IRN (2150) — extract existing IRN from response or info details
    const hasDuplicate = errors.some((e: any) => (e.ErrorCode || e.errorCode) === '2150');
    if (hasDuplicate) {
      // NIC often returns the existing IRN in InfoDtls or in the error message itself
      const infoDtls = result.InfoDtls || result.infoDtls || [];
      let existingIrn: string | null = null;
      let existingAckNo: string | null = null;
      let existingAckDt: string | null = null;
      for (const info of infoDtls) {
        const code = info.InfCd || info.infCd || '';
        const desc = info.Desc || info.desc;
        // desc can be string or object like {ackNo, ackDt, irn}
        if (code === 'DUPIRN' && desc && typeof desc === 'object') {
          existingIrn = desc.irn || desc.Irn || null;
          existingAckNo = desc.ackNo ? String(desc.ackNo) : (desc.AckNo ? String(desc.AckNo) : null);
          existingAckDt = desc.ackDt || desc.AckDt || null;
        } else if (code === 'DUPIRN' && typeof desc === 'string' && desc.length === 64) {
          existingIrn = desc;
        } else if (code === 'ACKNO') {
          existingAckNo = typeof desc === 'string' ? desc : String(desc);
        } else if (code === 'ACKDT') {
          existingAckDt = typeof desc === 'string' ? desc : String(desc);
        }
      }
      // Also try to extract IRN from error message text (pattern: 64-hex-char string)
      if (!existingIrn) {
        const irnMatch = errorMsg.match(/([a-f0-9]{64})/i);
        if (irnMatch) existingIrn = irnMatch[1];
      }
      if (existingIrn) {
        console.log(`[E-Invoice] Duplicate IRN — recovering existing: ${existingIrn}`);
        return {
          success: true,
          irn: existingIrn,
          ackNo: existingAckNo || undefined,
          ackDt: existingAckDt || undefined,
          status: 'ACT',
          rawResponse: result,
        };
      }
      // If we can't extract the IRN, return error with hint to fetch it
      return { success: false, error: `Duplicate IRN exists for this invoice. Use getIRNDetails to retrieve it.`, rawResponse: result };
    }

    // Retry on Invalid Token — force fresh auth
    const hasInvalidToken = errors.some((e: any) => (e.ErrorCode || e.errorCode) === '1005' || (e.ErrorMessage || e.errorMessage || '').includes('Invalid Token'));
    if (hasInvalidToken && retryCount < MAX_RETRIES) {
      console.log(`[E-Invoice] Invalid Token — retrying (${retryCount + 1}/${MAX_RETRIES})...`);
      return generateIRN(invoiceData, retryCount + 1);
    }

    return { success: false, error: errorMsg, rawResponse: result };
  } catch (err: any) {
    console.error(`[E-Invoice] Error (attempt ${retryCount + 1}):`, err.message);
    // Retry on network errors (socket, timeout, ECONNRESET)
    if (retryCount < MAX_RETRIES && (err.message.includes('Network error') || err.message.includes('socket') || err.message.includes('ECONNRESET') || err.message.includes('timed out'))) {
      console.log(`[E-Invoice] Network error — retrying (${retryCount + 1}/${MAX_RETRIES})...`);
      return generateIRN(invoiceData, retryCount + 1);
    }
    if (err.message.includes('auth') || err.message.includes('Auth') || err.message.includes('token')) {
      clearSaralAuthCache();
    }
    return { success: false, error: `E-Invoice error: ${err.message}` };
  }
}

export async function cancelIRN(irn: string, cancelReason: string, cancelRemarks?: string): Promise<IRNCancelResponse> {
  try {
    const auth = await getSaralAuth();
    const baseUrl = (process.env.EWAY_SARAL_URL || 'https://saralgsp.com').replace(/\/+$/, '');

    // Saral endpoint: POST /eicore/v1.03/Invoice/Cancel  (IRN goes in body, not URL)
    const url = `${baseUrl}/eicore/v1.03/Invoice/Cancel`;
    const headers = buildEInvoiceHeaders(auth);

    const payload: any = { Irn: irn, CnlRsn: cancelReason, CnlRem: (cancelRemarks || 'Cancelled').slice(0, 100) };

    console.log(`[E-Invoice] Cancelling IRN ${irn}, reason=${cancelReason}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const resultText = await response.text();
    let result: any;
    try {
      result = JSON.parse(resultText);
    } catch {
      throw new Error(`Non-JSON response: ${resultText.slice(0, 200)}`);
    }

    if (result.CancelDate || result.cancelDate || result.Status === 'CAN' || result.status === 'CAN') {
      return {
        success: true,
        irn,
        cancelDate: result.CancelDate || result.cancelDate,
        rawResponse: result,
      };
    }

    const errors = result.ErrorDetails || result.errorDetails || [];
    const errorMsg = errors.length > 0
      ? errors.map((e: any) => `${e.ErrorCode}: ${e.ErrorMessage}`).join('; ')
      : result.Error || result.error || JSON.stringify(result).slice(0, 300);

    return { success: false, irn, error: errorMsg, rawResponse: result };
  } catch (err: any) {
    console.error('[E-Invoice Cancel] Error:', err.message);
    if (err.message.includes('auth') || err.message.includes('Auth') || err.message.includes('token')) {
      clearSaralAuthCache();
    }
    return { success: false, irn, error: `Cancel error: ${err.message}` };
  }
}

export async function getIRNDetails(irn: string): Promise<any> {
  try {
    const auth = await getSaralAuth();
    const baseUrl = (process.env.EWAY_SARAL_URL || 'https://saralgsp.com').replace(/\/+$/, '');

    // Saral endpoint: GET /eicore/v1.03/Invoice?irn_no=XXXX (query param, not path)
    const url = `${baseUrl}/eicore/v1.03/Invoice?irn_no=${irn}`;
    const headers = buildEInvoiceHeaders(auth);

    console.log(`[E-Invoice] Getting IRN details for ${irn}`);

    const response = await fetch(url, {
      method: 'GET',
      headers,
    });

    const resultText = await response.text();
    let result: any;
    try {
      result = JSON.parse(resultText);
    } catch {
      throw new Error(`Non-JSON response: ${resultText.slice(0, 200)}`);
    }

    if (response.ok) {
      return { success: true, data: result };
    }

    const errors = result.ErrorDetails || result.errorDetails || [];
    const errorMsg = errors.length > 0
      ? errors.map((e: any) => `${e.ErrorCode}: ${e.ErrorMessage}`).join('; ')
      : result.Error || result.error || JSON.stringify(result).slice(0, 300);

    return { success: false, error: errorMsg };
  } catch (err: any) {
    console.error('[E-Invoice Details] Error:', err.message);
    if (err.message.includes('auth') || err.message.includes('Auth') || err.message.includes('token')) {
      clearSaralAuthCache();
    }
    return { success: false, error: `Details fetch error: ${err.message}` };
  }
}

export async function generateEWBByIRN(irn: string, ewbData: any, retryCount = 0): Promise<any> {
  const MAX_RETRIES = 2;
  try {
    if (retryCount > 0) {
      clearSaralAuthCache();
      await delay(2000 * retryCount);
    }
    const auth = await getSaralAuth();
    const baseUrl = (process.env.EWAY_SARAL_URL || 'https://saralgsp.com').replace(/\/+$/, '');
    const gstin = process.env.EWAY_GSTIN || '23AAECM3666P1Z1';
    const ewaybillUsername = process.env.EWAY_EWB_USERNAME || process.env.EWAY_NIC_USERNAME || '';
    const ewaybillPassword = process.env.EWAY_EWB_PASSWORD || process.env.EWAY_NIC_PASSWORD || '';

    // Production endpoint for EWB from IRN (NOT /eicore/)
    const url = `${baseUrl}/eiewb/v1.03/ewaybill`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'AuthenticationToken': auth.saralToken,
      'SubscriptionId': auth.subscriptionId,
      'Gstin': gstin,
      'UserName': ewaybillUsername,
    };
    if (ewaybillPassword) {
      headers['Password'] = ewaybillPassword;
    }
    if (auth.nicAuthToken && auth.nicAuthToken !== auth.saralToken) {
      headers['AuthToken'] = auth.nicAuthToken;
    }
    if (auth.nicSek) {
      headers['sek'] = auth.nicSek;
    }

    const payload = { Irn: irn, ...ewbData };

    const bodyStr = JSON.stringify(payload);
    console.log(`[E-Invoice] Generating EWB from IRN ${irn}`);
    console.log(`[E-Invoice] EWB payload: ${bodyStr}`);

    // 45s timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: bodyStr,
        signal: controller.signal,
      });
    } catch (fetchErr: any) {
      clearTimeout(timeout);
      const cause = fetchErr.cause ? `${fetchErr.cause.code || fetchErr.cause.message || fetchErr.cause}` : '';
      if (fetchErr.name === 'AbortError') {
        throw new Error(`EWB-from-IRN request timed out after 45s`);
      }
      throw new Error(`Network error: ${fetchErr.message}${cause ? ` (${cause})` : ''}`);
    } finally {
      clearTimeout(timeout);
    }

    const resultText = await response.text();
    console.log(`[E-Invoice] EWB Response status=${response.status}:`, resultText.slice(0, 500));

    let result: any;
    try {
      result = JSON.parse(resultText);
    } catch {
      throw new Error(`Non-JSON response (HTTP ${response.status}): ${resultText.slice(0, 200)}`);
    }

    const d = result.data || result;
    if (d.EwbNo || d.ewbNo || d.EwayBillNo || d.ewayBillNo || result.EwbNo || result.ewbNo) {
      return {
        success: true,
        ewayBillNo: (d.EwbNo || d.ewbNo || d.EwayBillNo || d.ewayBillNo || result.EwbNo || result.ewbNo)?.toString(),
        ewayBillDate: d.EwbDt || d.ewbDt || d.ewayBillDate || d.EwayBillDate,
        validUpto: d.EwbValidTill || d.ewbValidTill || d.validUpto || d.ValidUpto,
        rawResponse: result,
      };
    }

    const errors = result.ErrorDetails || result.errorDetails || [];
    const errorMsg = errors.length > 0
      ? errors.map((e: any) => `${e.ErrorCode || e.errorCode}: ${e.ErrorMessage || e.errorMessage}`).join('; ')
      : result.Error || result.error || JSON.stringify(result).slice(0, 300);

    return { success: false, error: errorMsg, rawResponse: result };
  } catch (err: any) {
    console.error(`[E-Invoice EWB] Error (attempt ${retryCount + 1}):`, err.message);
    if (retryCount < MAX_RETRIES && (err.message.includes('Network error') || err.message.includes('socket') || err.message.includes('ECONNRESET') || err.message.includes('timed out') || err.message.includes('fetch failed'))) {
      console.log(`[E-Invoice EWB] Network error — retrying (${retryCount + 1}/${MAX_RETRIES})...`);
      return generateEWBByIRN(irn, ewbData, retryCount + 1);
    }
    if (err.message.includes('auth') || err.message.includes('Auth') || err.message.includes('token')) {
      clearSaralAuthCache();
    }
    return { success: false, error: `E-way bill generation error: ${err.message}` };
  }
}

/**
 * Generate standalone E-Way Bill via Saral GSP (not from IRN)
 * Used for job work where SAC codes can't generate EWB from IRN.
 * Uses same auth as e-invoice portal but sends NIC EWB payload format.
 */
export async function generateStandaloneEWB(ewbPayload: any, retryCount = 0): Promise<any> {
  const MAX_RETRIES = 2;
  try {
    if (retryCount > 0) {
      clearSaralAuthCache();
      await delay(2000 * retryCount);
    }
    const auth = await getSaralAuth();
    const baseUrl = (process.env.EWAY_SARAL_URL || 'https://saralgsp.com').replace(/\/+$/, '');
    const gstin = process.env.EWAY_GSTIN || '23AAECM3666P1Z1';
    const ewaybillUsername = process.env.EWAY_EWB_USERNAME || process.env.EWAY_NIC_USERNAME || '';
    const ewaybillPassword = process.env.EWAY_EWB_PASSWORD || process.env.EWAY_NIC_PASSWORD || '';

    // Use the eivital EWB generation endpoint (same portal, standalone format)
    const url = `${baseUrl}/eivital/v1.04/ewaybill`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'AuthenticationToken': auth.saralToken,
      'SubscriptionId': auth.subscriptionId,
      'Gstin': gstin,
      'UserName': ewaybillUsername,
    };
    if (ewaybillPassword) headers['Password'] = ewaybillPassword;
    if (auth.nicAuthToken && auth.nicAuthToken !== auth.saralToken) headers['AuthToken'] = auth.nicAuthToken;
    if (auth.nicSek) headers['sek'] = auth.nicSek;

    const bodyStr = JSON.stringify(ewbPayload);
    console.log(`[E-Invoice] Generating standalone EWB at ${url}`);
    console.log(`[E-Invoice] Standalone EWB payload (first 500): ${bodyStr.slice(0, 500)}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    let response: Response;
    try {
      response = await fetch(url, { method: 'POST', headers, body: bodyStr, signal: controller.signal });
    } catch (fetchErr: any) {
      clearTimeout(timeout);
      throw new Error(`Network error: ${fetchErr.message}${fetchErr.cause ? ` (${fetchErr.cause.code || fetchErr.cause.message})` : ''}`);
    } finally {
      clearTimeout(timeout);
    }

    const resultText = await response.text();
    console.log(`[E-Invoice] Standalone EWB Response status=${response.status}:`, resultText.slice(0, 500));

    let result: any;
    try { result = JSON.parse(resultText); } catch { throw new Error(`Non-JSON response (HTTP ${response.status}): ${resultText.slice(0, 200)}`); }

    const d = result.data || result;
    if (d.EwbNo || d.ewbNo || d.EwayBillNo || d.ewayBillNo) {
      return {
        success: true,
        ewayBillNo: (d.EwbNo || d.ewbNo || d.EwayBillNo || d.ewayBillNo)?.toString(),
        ewayBillDate: d.EwbDt || d.ewbDt || d.ewayBillDate,
        validUpto: d.EwbValidTill || d.ewbValidTill || d.validUpto,
        rawResponse: result,
      };
    }

    const errors = result.ErrorDetails || result.errorDetails || [];
    const errorMsg = errors.length > 0
      ? errors.map((e: any) => `${e.ErrorCode || e.errorCode}: ${e.ErrorMessage || e.errorMessage}`).join('; ')
      : JSON.stringify(result).slice(0, 300);
    return { success: false, error: errorMsg, rawResponse: result };
  } catch (err: any) {
    console.error(`[E-Invoice Standalone EWB] Error (attempt ${retryCount + 1}):`, err.message);
    if (retryCount < MAX_RETRIES && (err.message.includes('Network') || err.message.includes('socket') || err.message.includes('fetch failed'))) {
      return generateStandaloneEWB(ewbPayload, retryCount + 1);
    }
    return { success: false, error: `Standalone EWB error: ${err.message}` };
  }
}

/**
 * Get GSTIN details from NIC via Saral GSP
 * Endpoint: GET /eicore/v1.03/Master/gstin/{gstin}
 * Returns: legal name, trade name, address, state, pincode, status, etc.
 */
export async function getGSTINDetails(gstin: string): Promise<any> {
  const MAX_RETRIES = 2;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[E-Invoice GSTIN] Retry attempt ${attempt}/${MAX_RETRIES}`);
        await delay(1500 * attempt);
      }

      const auth = await getSaralAuth();
      const baseUrl = (process.env.EWAY_SARAL_URL || 'https://saralgsp.com').replace(/\/+$/, '');

      // Saral endpoint: GET /eivital/v1.04/Master?gstin=XXXX
      // Note: requires 'user_name' header (lowercase with underscore) not 'UserName'
      const url = `${baseUrl}/eivital/v1.04/Master?gstin=${gstin}`;
      const headers = buildEInvoiceHeaders(auth);
      // This endpoint needs 'user_name' specifically
      const apiUsername = process.env.EWAY_EWB_USERNAME || process.env.EWAY_NIC_USERNAME || '';
      if (apiUsername) headers['user_name'] = apiUsername;

      console.log(`[E-Invoice] Looking up GSTIN: ${gstin} (attempt ${attempt + 1})`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const resultText = await response.text();
      console.log(`[E-Invoice] GSTIN lookup response status=${response.status}:`, resultText.slice(0, 500));

      let result: any;
      try {
        result = JSON.parse(resultText);
      } catch {
        throw new Error(`Non-JSON response: ${resultText.slice(0, 200)}`);
      }

      // Response shape: { Gstin, TradeName, LegalName, AddrBnm, AddrBno, AddrFlno, AddrSt, AddrLoc, StateCode, AddrPncd, TxpType, Status, BlkStatus, DtReg }
      if (result.Gstin || result.gstin) {
        const data = result;
        const addrParts = [data.AddrBno, data.AddrFlno, data.AddrBnm, data.AddrSt, data.AddrLoc].filter(Boolean).map((s: string) => s.trim()).filter(Boolean);
        return {
          success: true,
          gstin: data.Gstin || gstin,
          legalName: data.LegalName || '',
          tradeName: data.TradeName || '',
          address: addrParts.join(', '),
          city: (data.AddrLoc || '').trim(),
          state: String(data.StateCode || ''),
          pincode: String(data.AddrPncd || ''),
          status: data.Status || 'Unknown',
          registrationDate: data.DtReg || '',
          taxpayerType: data.TxpType || '',
          rawResponse: data,
        };
      }

      const errors = result.ErrorDetails || result.errorDetails || [];
      const errorMsg = errors.length > 0
        ? errors.map((e: any) => `${e.ErrorCode || e.errorCode}: ${e.ErrorMessage || e.errorMessage}`).join('; ')
        : result.Error || result.error || JSON.stringify(result).slice(0, 300);

      return { success: false, error: errorMsg };
    } catch (err: any) {
      console.error(`[E-Invoice GSTIN] Error (attempt ${attempt + 1}):`, err.message);
      // Retry on network errors (fetch failed, ECONNRESET, timeout)
      if (attempt < MAX_RETRIES && (err.message.includes('fetch failed') || err.message.includes('ECONNRESET') || err.message.includes('abort'))) {
        continue;
      }
      if (err.message.includes('auth') || err.message.includes('Auth') || err.message.includes('token')) {
        clearSaralAuthCache();
      }
      return { success: false, error: `GSTIN lookup error: ${err.message}` };
    }
  }

  return { success: false, error: 'GSTIN lookup failed after retries' };
}
