/**
 * E-Way Bill Generation Service
 *
 * Supports three modes:
 * 1. Sandbox Mode (default): Returns mock e-way bill numbers for testing
 * 2. NIC Direct Mode: Direct integration with ewaybillgst.gov.in (RSA+AES encryption)
 * 3. GSP Mode: Uses a GST Suvidha Provider API (MasterIndia, ClearTax, etc.)
 *
 * Configure via environment variables:
 *   EWAY_BILL_MODE=sandbox|nic|gsp
 *
 *   # For NIC Direct mode:
 *   EWAY_NIC_URL=https://gsp.adaequare.com (or NIC sandbox: http://ewaybill2.nic.in)
 *   EWAY_NIC_CLIENT_ID=your_client_id
 *   EWAY_NIC_CLIENT_SECRET=your_client_secret
 *   EWAY_NIC_USERNAME=your_ewb_username
 *   EWAY_NIC_PASSWORD=your_ewb_password
 *   EWAY_NIC_PUBLIC_KEY=base64_encoded_RSA_public_key
 *   EWAY_GSTIN=23AAECM3666P1Z1
 *
 *   # For GSP mode:
 *   EWAY_GSP_URL=https://api.mastersindia.co
 *   EWAY_GSP_TOKEN=your_api_token
 *   EWAY_GSTIN=23AAECM3666P1Z1
 */

import crypto from 'crypto';

// ── Indian State Codes (for GST) ──
const STATE_CODES: Record<string, string> = {
  'jammu and kashmir': '01', 'himachal pradesh': '02', 'punjab': '03',
  'chandigarh': '04', 'uttarakhand': '05', 'haryana': '06', 'delhi': '07',
  'rajasthan': '08', 'uttar pradesh': '09', 'bihar': '10', 'sikkim': '11',
  'arunachal pradesh': '12', 'nagaland': '13', 'manipur': '14', 'mizoram': '15',
  'tripura': '16', 'meghalaya': '17', 'assam': '18', 'west bengal': '19',
  'jharkhand': '20', 'odisha': '21', 'chhattisgarh': '22', 'madhya pradesh': '23',
  'gujarat': '24', 'dadra and nagar haveli': '26', 'daman and diu': '25',
  'maharashtra': '27', 'andhra pradesh': '37', 'karnataka': '29',
  'goa': '30', 'lakshadweep': '31', 'kerala': '32', 'tamil nadu': '33',
  'puducherry': '34', 'andaman and nicobar': '35', 'telangana': '36',
  'ladakh': '38',
};

// ── HSN codes for common products ──
const DEFAULT_HSN: Record<string, string> = {
  'DDGS': '23033000',    // Distillers dried grains with solubles
  'ETHANOL': '22072000', // Ethyl alcohol / Ethanol
  'ENA': '22072000',
  'RS': '22072000',      // Rectified Spirit
  'LFO': '27101990',     // Light Fuel Oil
  'HFO': '27101990',     // Heavy Fuel Oil
};

// ── Unit codes as per GST ──
const UNIT_CODES: Record<string, string> = {
  'TON': 'MTS',   // Metric Ton
  'MT': 'MTS',
  'KL': 'KLR',    // Kilolitre
  'LTR': 'LTR',   // Litre
  'KG': 'KGS',    // Kilogram
  'BAG': 'BAG',
  'NOS': 'NOS',
};

export interface EwayBillInput {
  // Supplier (MSPIL)
  supplierGstin: string;
  supplierName: string;
  supplierAddress: string;
  supplierState: string;
  supplierPincode: string;
  supplierCity?: string; // Optional — derived from address if not provided
  // Recipient
  recipientGstin?: string;
  recipientName: string;
  recipientAddress: string;
  recipientState: string;
  recipientPincode: string;
  // Document
  documentType: 'INV' | 'CHL' | 'BIL' | 'BOE' | 'OTH'; // Invoice, Challan, Bill of Supply, Bill of Entry, Others
  documentNo: string;
  documentDate: string; // DD/MM/YYYY
  // Items
  items: {
    productName: string;
    hsnCode: string;
    quantity: number;
    unit: string;
    taxableValue: number;
    cgstRate: number;
    sgstRate: number;
    igstRate: number;
    cessRate?: number;
  }[];
  // Transport
  transporterId?: string;  // Transporter GSTIN
  transporterName?: string;
  vehicleNo: string;
  vehicleType: 'R' | 'T';  // Regular, Through (multi-modal)
  transportMode: '1' | '2' | '3' | '4'; // Road, Rail, Air, Ship
  distanceKm: number;
  // Supply
  supplyType: 'O' | 'I';  // Outward, Inward
  subType: '1' | '2' | '3' | '4'; // 1=Supply, 2=Export, 3=Job Work, 4=SKD/CKD
}

export interface EwayBillResponse {
  success: boolean;
  ewayBillNo?: string;
  ewayBillDate?: string;
  validUpto?: string;
  error?: string;
  rawResponse?: any;
}

// ── Helper functions ──
export function getStateCode(stateName: string): string {
  if (!stateName) return '23'; // Default MP
  const normalized = stateName.toLowerCase().trim();
  return STATE_CODES[normalized] || '23';
}

export function getStateCodeFromGstin(gstin: string): string {
  if (!gstin || gstin.length < 2) return '23';
  return gstin.substring(0, 2);
}

export function getHsnCode(productName: string): string {
  const upper = (productName || '').toUpperCase().trim();
  return DEFAULT_HSN[upper] || '99999999';
}

export function getUnitCode(unit: string): string {
  const upper = (unit || '').toUpperCase().trim();
  return UNIT_CODES[upper] || 'OTH';
}

export function formatDateDDMMYYYY(date: Date): string {
  const d = date.getDate().toString().padStart(2, '0');
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

// ══════════════════════════════════════════════════════════════════════
// NIC Direct API — Encryption & Auth
// ══════════════════════════════════════════════════════════════════════

/** Cached auth token (valid 6 hours) */
let nicAuthCache: {
  authtoken: string;
  sek: Buffer;       // decrypted session encryption key
  expiresAt: number;  // timestamp
} | null = null;

/**
 * RSA encrypt: Base64(plaintext) → RSA encrypt with NIC public key → Base64
 * Used for initial authentication only
 */
function rsaEncrypt(plaintext: string, publicKeyPem: string): string {
  const buffer = Buffer.from(plaintext, 'utf8');
  const encrypted = crypto.publicEncrypt(
    {
      key: publicKeyPem,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    buffer
  );
  return encrypted.toString('base64');
}

/**
 * AES-256-ECB encrypt: Base64(plaintext) → AES encrypt with key → Base64
 * Used for all data exchange after authentication
 */
function aesEncrypt(plaintext: string, key: Buffer): string {
  const cipher = crypto.createCipheriv('aes-256-ecb', key, null);
  cipher.setAutoPadding(true); // PKCS7
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return encrypted.toString('base64');
}

/**
 * AES-256-ECB decrypt: Base64(ciphertext) → AES decrypt with key → string
 */
function aesDecrypt(ciphertext: string, key: Buffer): string {
  const decipher = crypto.createDecipheriv('aes-256-ecb', key, null);
  decipher.setAutoPadding(true);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

/**
 * Get NIC public key as PEM string
 */
function getNicPublicKey(): string {
  const keyBase64 = process.env.EWAY_NIC_PUBLIC_KEY || '';
  if (!keyBase64) throw new Error('EWAY_NIC_PUBLIC_KEY not configured');
  // If already PEM formatted, return as-is
  if (keyBase64.includes('BEGIN PUBLIC KEY')) return keyBase64;
  // Otherwise wrap base64 in PEM
  return `-----BEGIN PUBLIC KEY-----\n${keyBase64}\n-----END PUBLIC KEY-----`;
}

/**
 * Authenticate with NIC e-way bill API
 * Returns authtoken + decrypted SEK (session encryption key)
 */
async function nicAuthenticate(): Promise<{ authtoken: string; sek: Buffer }> {
  // Return cached if still valid (with 5 min buffer)
  if (nicAuthCache && nicAuthCache.expiresAt > Date.now() + 300000) {
    return { authtoken: nicAuthCache.authtoken, sek: nicAuthCache.sek };
  }

  const baseUrl = process.env.EWAY_NIC_URL;
  const clientId = process.env.EWAY_NIC_CLIENT_ID;
  const clientSecret = process.env.EWAY_NIC_CLIENT_SECRET;
  const username = process.env.EWAY_NIC_USERNAME;
  const password = process.env.EWAY_NIC_PASSWORD;
  const gstin = process.env.EWAY_GSTIN || MSPIL.gstin;

  if (!baseUrl || !clientId || !clientSecret || !username || !password) {
    throw new Error('NIC e-way bill credentials not configured. Set EWAY_NIC_* environment variables.');
  }

  const publicKeyPem = getNicPublicKey();

  // Generate 32-byte random app key
  const appKey = crypto.randomBytes(32);
  const appKeyBase64 = appKey.toString('base64');

  // Build auth payload
  const authPayload = JSON.stringify({
    action: 'ACCESSTOKEN',
    username: username,
    password: password,
    app_key: appKeyBase64,
  });

  // Encrypt auth payload: Base64 encode → RSA encrypt with public key → Base64
  const encryptedData = rsaEncrypt(authPayload, publicKeyPem);

  console.log('[E-Way Bill NIC] Authenticating...');

  const response = await fetch(`${baseUrl}/ewayapi/auth/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'client-id': clientId,
      'client-secret': clientSecret,
      'Gstin': gstin,
    },
    body: JSON.stringify({ Data: encryptedData }),
  });

  const data: any = await response.json();

  if (data.status !== '1' && data.status !== 1) {
    throw new Error(`NIC Auth failed: ${data.error || JSON.stringify(data)}`);
  }

  // Decrypt SEK using app_key (AES-256-ECB)
  // The SEK returned is encrypted with app_key
  const decryptedSek = aesDecrypt(data.sek, appKey);
  const sekBuffer = Buffer.from(decryptedSek, 'base64');

  // Cache for ~6 hours
  nicAuthCache = {
    authtoken: data.authtoken,
    sek: sekBuffer,
    expiresAt: Date.now() + 5.5 * 60 * 60 * 1000, // 5.5 hours to be safe
  };

  console.log('[E-Way Bill NIC] Authenticated. Token valid until', new Date(nicAuthCache.expiresAt).toISOString());

  return { authtoken: data.authtoken, sek: sekBuffer };
}

/**
 * Call NIC e-way bill API with encrypted data
 */
async function nicApiCall(action: string, payload: any): Promise<any> {
  const { authtoken, sek } = await nicAuthenticate();

  const baseUrl = process.env.EWAY_NIC_URL;
  const clientId = process.env.EWAY_NIC_CLIENT_ID!;
  const clientSecret = process.env.EWAY_NIC_CLIENT_SECRET!;
  const gstin = process.env.EWAY_GSTIN || MSPIL.gstin;

  // Encrypt payload: JSON → Base64 → AES encrypt with SEK → Base64
  const jsonStr = JSON.stringify(payload);
  const base64Json = Buffer.from(jsonStr).toString('base64');
  const encryptedData = aesEncrypt(base64Json, sek);

  const response = await fetch(`${baseUrl}/ewayapi/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'client-id': clientId,
      'client-secret': clientSecret,
      'gstin': gstin,
      'authtoken': authtoken,
    },
    body: JSON.stringify({ action, data: encryptedData }),
  });

  const result: any = await response.json();

  if (result.status === '1' || result.status === 1) {
    // Decrypt response data
    if (result.data) {
      const decryptedBase64 = aesDecrypt(result.data, sek);
      const decryptedJson = Buffer.from(decryptedBase64, 'base64').toString('utf8');
      return JSON.parse(decryptedJson);
    }
    return result;
  } else {
    throw new Error(result.error?.errorCodes
      ? `NIC Error ${result.error.errorCodes}: ${result.error.message || result.info || ''}`
      : result.error || result.info || JSON.stringify(result));
  }
}

// ══════════════════════════════════════════════════════════════════════

/**
 * Build the e-way bill JSON payload in NIC/GSP standard format
 */
export function buildEwayBillPayload(input: EwayBillInput): any {
  const totalTaxableValue = input.items.reduce((s, i) => s + i.taxableValue, 0);
  const totalCgst = input.items.reduce((s, i) => s + (i.taxableValue * i.cgstRate / 100), 0);
  const totalSgst = input.items.reduce((s, i) => s + (i.taxableValue * i.sgstRate / 100), 0);
  const totalIgst = input.items.reduce((s, i) => s + (i.taxableValue * i.igstRate / 100), 0);
  const totalValue = totalTaxableValue + totalCgst + totalSgst + totalIgst;

  const fromStateCode = getStateCodeFromGstin(input.supplierGstin) || getStateCode(input.supplierState);
  const toStateCode = input.recipientGstin
    ? getStateCodeFromGstin(input.recipientGstin)
    : getStateCode(input.recipientState);

  // Determine if inter-state or intra-state
  const isInterState = fromStateCode !== toStateCode;

  return {
    supplyType: input.supplyType,
    subSupplyType: input.subType,
    docType: input.documentType,
    docNo: input.documentNo,
    docDate: input.documentDate,
    fromGstin: input.supplierGstin,
    fromTrdName: input.supplierName,
    fromAddr1: input.supplierAddress.substring(0, 120),
    fromAddr2: '',
    fromPlace: input.supplierCity || input.supplierAddress.split(',').pop()?.trim() || 'Narsinghpur',
    fromPincode: parseInt(input.supplierPincode) || 487001,
    fromStateCode: parseInt(fromStateCode),
    actFromStateCode: parseInt(fromStateCode),
    toGstin: input.recipientGstin || 'URP', // URP = Unregistered Person
    toTrdName: input.recipientName,
    toAddr1: input.recipientAddress.substring(0, 120),
    toAddr2: '',
    toPlace: input.recipientAddress.split(',').slice(-2, -1)[0]?.trim() || '',
    toPincode: parseInt(input.recipientPincode) || 0,
    toStateCode: parseInt(toStateCode),
    actToStateCode: parseInt(toStateCode),
    transactionType: 1, // 1=Regular, 2=Bill To-Ship To, 3=Bill From-Dispatch From, 4=Combination
    totalValue: Math.round(totalTaxableValue * 100) / 100,
    cgstValue: isInterState ? 0 : Math.round(totalCgst * 100) / 100,
    sgstValue: isInterState ? 0 : Math.round(totalSgst * 100) / 100,
    igstValue: isInterState ? Math.round((totalCgst + totalSgst + totalIgst) * 100) / 100 : Math.round(totalIgst * 100) / 100,
    cessValue: 0,
    totInvValue: Math.round(totalValue * 100) / 100,
    transporterId: input.transporterId || '',
    transporterName: input.transporterName || '',
    transDocNo: '',
    transDocDate: '',
    transMode: input.transportMode,
    vehicleNo: input.vehicleNo.replace(/\s/g, '').toUpperCase(),
    vehicleType: input.vehicleType,
    transDistance: Math.round(input.distanceKm),
    itemList: input.items.map((item, idx) => ({
      itemNo: idx + 1,
      productName: item.productName,
      productDesc: item.productName,
      hsnCode: parseInt(item.hsnCode),
      quantity: item.quantity,
      qtyUnit: getUnitCode(item.unit),
      taxableAmount: Math.round(item.taxableValue * 100) / 100,
      cgstRate: isInterState ? 0 : item.cgstRate,
      sgstRate: isInterState ? 0 : item.sgstRate,
      igstRate: isInterState ? (item.cgstRate + item.sgstRate + item.igstRate) : item.igstRate,
      cessRate: item.cessRate || 0,
    })),
  };
}

// ══════════════════════════════════════════════════════════════════════
// Saral GSP — Relyon Softech (saralgsp.com)
// Auth: GET /authentication/Authenticate with Client Id + Client Secret headers
// EWB:  POST /eiewb/v1.03/ewaybill with AuthenticationToken + other headers
// Saral handles NIC encryption internally — no RSA public key needed
// ══════════════════════════════════════════════════════════════════════

export interface SaralAuth {
  saralToken: string;       // Saral GSP's own token
  subscriptionId: string;
  nicAuthToken: string;     // IRP AuthToken (e-Invoice or e-Way Bill)
  nicSek: string;           // IRP session encryption key
  expiresAt: number;
}
let saralAuthCache: SaralAuth | null = null;

/**
 * Get Saral GSP auth (reusable across e-way bill and e-invoice services)
 */
export async function getSaralAuth(): Promise<SaralAuth> {
  return saralAuthenticate();
}

/**
 * Clear Saral auth cache (used on auth failures)
 */
export function clearSaralAuthCache() {
  saralAuthCache = null;
}

async function saralAuthenticate(): Promise<SaralAuth> {
  if (saralAuthCache && saralAuthCache.expiresAt > Date.now() + 300000) {
    return saralAuthCache;
  }

  const baseUrl = (process.env.EWAY_SARAL_URL || 'https://saralgsp.com').replace(/\/+$/, '');
  const clientId = process.env.EWAY_NIC_CLIENT_ID || '';
  const clientSecret = process.env.EWAY_NIC_CLIENT_SECRET || '';
  const gstin = process.env.EWAY_GSTIN || MSPIL.gstin;

  if (!clientId || !clientSecret) {
    throw new Error('Saral GSP credentials not configured');
  }

  // Step 1: Authenticate with Saral GSP
  console.log(`[Saral] Step 1: GSP auth at ${baseUrl}/authentication/Authenticate`);
  const saralResp = await fetch(`${baseUrl}/authentication/Authenticate`, {
    method: 'GET',
    headers: { 'ClientId': clientId, 'ClientSecret': clientSecret },
  });
  const saralData: any = await saralResp.json();
  console.log('[Saral] Step 1 response:', JSON.stringify(saralData).slice(0, 300));

  const saralToken = saralData.authenticationToken || saralData.AuthenticationToken;
  const subscriptionId = saralData.subscriptionId || saralData.SubscriptionId || '';

  if (!saralToken) {
    throw new Error(`Saral GSP auth failed: ${JSON.stringify(saralData).slice(0, 300)}`);
  }

  // Step 2: Authenticate IRP (e-Invoice/e-Way Bill) through Saral
  // Try e-way bill credentials first, then fall back to e-invoice credentials
  let nicAuthToken = '';
  let nicSek = '';
  let tokenExpiresAt = Date.now() + 60 * 60 * 1000; // default 1 hour

  // Use EWB credentials only — same API user works for both EWB and e-Invoice via Saral
  const ewaybillUsername = process.env.EWAY_EWB_USERNAME || process.env.EWAY_NIC_USERNAME || '';
  const ewaybillPassword = process.env.EWAY_EWB_PASSWORD || process.env.EWAY_NIC_PASSWORD || '';

  const credentialsToTry = [
    { username: ewaybillUsername, password: ewaybillPassword, type: 'EWB' },
  ].filter(c => c.username && c.password);

  const irpAuthUrl = `${baseUrl}/eivital/v1.04/auth`;

  for (const cred of credentialsToTry) {
    if (nicAuthToken) break;
    console.log(`[Saral] Step 2: Trying IRP auth (${cred.type}) at ${irpAuthUrl}`);
    try {
      const irpResp = await fetch(irpAuthUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'AuthenticationToken': saralToken,
          'SubscriptionId': subscriptionId,
          'Gstin': gstin,
          'UserName': cred.username,
          'Password': cred.password,
        },
      });
      const irpText = await irpResp.text();
      console.log(`[Saral] Step 2 (${cred.type}) status=${irpResp.status} response: ${irpText.slice(0, 500)}`);

      if (irpText && irpResp.status === 200) {
        try {
          const irpData = JSON.parse(irpText);
          // Response: { status: 1, data: { authToken, sek, tokenExpiry } }
          if (irpData.status === 1 || irpData.status === '1') {
            const d = irpData.data || irpData;
            nicAuthToken = d.authToken || d.AuthToken || d.authtoken || '';
            nicSek = d.sek || d.Sek || d.SEK || '';
            // Parse actual token expiry from IRP response
            const tokenExpiry = d.tokenExpiry || d.TokenExpiry || '';
            if (tokenExpiry) {
              try {
                const expiryDate = new Date(tokenExpiry.replace(' ', 'T') + '+05:30');
                const expiryMs = expiryDate.getTime();
                if (expiryMs > Date.now()) {
                  tokenExpiresAt = expiryMs;
                  console.log(`[Saral] Token expires at: ${tokenExpiry} (${Math.round((expiryMs - Date.now()) / 60000)} min from now)`);
                }
              } catch { /* ignore parse errors */ }
            }
            if (nicAuthToken) {
              console.log(`[Saral] IRP auth SUCCESS via ${cred.type}`);
              break;
            }
          }
        } catch (parseErr) {
          console.log(`[Saral] Failed to parse IRP response: ${parseErr}`);
        }
      }
    } catch (e: any) {
      console.log(`[Saral] IRP auth (${cred.type}) failed: ${e.message}`);
    }
  }

  console.log(`[Saral] Auth complete. IRP token: ${nicAuthToken ? 'YES' : 'NO'}, SEK: ${nicSek ? 'YES' : 'NO'}`);

  saralAuthCache = {
    saralToken,
    subscriptionId,
    nicAuthToken: nicAuthToken || saralToken,
    nicSek: nicSek,
    expiresAt: tokenExpiresAt,
  };
  return saralAuthCache;
}

/**
 * Internal helper to call any Saral GSP endpoint with proper auth headers, timeout, and error handling.
 */
async function saralApiCall(path: string, payload: any, label: string): Promise<any> {
  const auth = await saralAuthenticate();
  const baseUrl = (process.env.EWAY_SARAL_URL || 'https://saralgsp.com').replace(/\/+$/, '');
  const gstin = process.env.EWAY_GSTIN || MSPIL.gstin;
  const ewaybillUsername = process.env.EWAY_EWB_USERNAME || process.env.EWAY_NIC_USERNAME || '';
  const ewaybillPassword = process.env.EWAY_EWB_PASSWORD || process.env.EWAY_NIC_PASSWORD || '';

  const url = `${baseUrl}${path}`;

  // Build headers — include both Saral tokens and IRP tokens
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

  const bodyStr = JSON.stringify(payload);
  console.log(`[Saral] ${label} at ${url}`);
  console.log(`[Saral] Headers: ${Object.keys(headers).filter(k => k !== 'Content-Type' && k !== 'Password').map(k => `${k}=${String(headers[k]).slice(0, 15)}...`).join(', ')}`);
  console.log(`[Saral] Payload (first 500): ${bodyStr.slice(0, 500)}`);

  // Use AbortController for 45s timeout to prevent hanging
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
    // Surface the real underlying error (Node.js native fetch wraps it in cause)
    const cause = fetchErr.cause ? `${fetchErr.cause.code || fetchErr.cause.message || fetchErr.cause}` : '';
    const detail = cause ? ` (${cause})` : '';
    if (fetchErr.name === 'AbortError') {
      throw new Error(`${label} request timed out after 45s — check if ${url} is reachable${detail}`);
    }
    console.error(`[Saral] Fetch failed for ${url}:`, fetchErr.message, 'cause:', fetchErr.cause);
    throw new Error(`Network error calling ${url}: ${fetchErr.message}${detail}`);
  } finally {
    clearTimeout(timeout);
  }

  const resultText = await response.text();
  console.log(`[Saral] ${label} Response status=${response.status}:`, resultText.slice(0, 500));

  // If we get a non-2xx with HTML response, the endpoint likely doesn't exist
  if (!response.ok && (resultText.startsWith('<') || resultText.startsWith('<!DOCTYPE'))) {
    throw new Error(`${label} endpoint returned HTTP ${response.status} with HTML — ${path} may not exist on Saral GSP`);
  }

  let result: any;
  try { result = JSON.parse(resultText); } catch { throw new Error(`Non-JSON response (HTTP ${response.status}): ${resultText.slice(0, 200)}`); }

  return result;
}

/**
 * Parse Saral EWB response and extract e-way bill details
 */
function parseSaralEwbResponse(result: any): any {
  if (result.ewayBillNo || result.EwayBillNo || result.EwbNo || result.data?.ewayBillNo || result.data?.EwbNo) {
    return result.data || result;
  }
  if ((result.status === 1 || result.Status === 1) && result.data) {
    return result.data;
  }

  const errors = result.errorDetails || result.ErrorDetails || [];
  const errMsg = errors.map((e: any) => `${e.errorCode || e.ErrorCode}: ${e.errorMessage || e.ErrorMessage}`).join('; ') || result.error || result.message || JSON.stringify(result).slice(0, 300);
  throw new Error(errMsg);
}

/**
 * Generate E-Way Bill from IRN via Saral GSP
 * Production endpoint: POST /eiewb/v1.03/ewaybill
 * Body: { Irn, Distance, TransMode, TransId, TransName, VehNo, VehType, ... }
 */
export async function saralGenerateEwbFromIrn(irn: string, transportDetails: {
  distance: number;
  transMode?: string;    // 1=Road, 2=Rail, 3=Air, 4=Ship
  transporterId?: string;
  transporterName?: string;
  vehicleNo?: string;
  vehicleType?: string;  // R=Regular, O=ODC
  transDocNo?: string;
  transDocDt?: string;   // DD/MM/YYYY
}): Promise<any> {
  const payload: Record<string, any> = {
    Irn: irn,
    Distance: transportDetails.distance || 0,
  };
  if (transportDetails.transMode) payload.TransMode = transportDetails.transMode;
  if (transportDetails.transporterId) payload.TransId = transportDetails.transporterId;
  if (transportDetails.transporterName) payload.TransName = transportDetails.transporterName;
  if (transportDetails.vehicleNo) payload.VehNo = transportDetails.vehicleNo.replace(/\s/g, '').toUpperCase();
  if (transportDetails.vehicleType) payload.VehType = transportDetails.vehicleType;
  if (transportDetails.transDocNo) payload.TransDocNo = transportDetails.transDocNo;
  if (transportDetails.transDocDt) payload.TransDocDt = transportDetails.transDocDt;

  const result = await saralApiCall('/eiewb/v1.03/ewaybill', payload, 'Generate EWB from IRN');
  return parseSaralEwbResponse(result);
}

/**
 * Generate standalone E-Way Bill via Saral GSP (for sandbox/testing)
 * Sandbox uses /ewaybillapi/v1.03/ewayapi, production does NOT support this
 * For production, use saralGenerateEwbFromIrn() instead
 */
async function saralGenerateEwb(payload: any): Promise<any> {
  // Standalone EWB uses the EWB portal API, not the e-invoice portal
  const ewbPath = process.env.EWAY_SARAL_EWB_PATH || '/ewaybillapi/v1.03/ewayapi';

  const result = await saralApiCall(ewbPath, payload, 'Generate standalone EWB');
  return parseSaralEwbResponse(result);
}

/**
 * Generate E-Way Bill
 *
 * Modes:
 * - sandbox: Returns mock e-way bill number for testing
 * - saral: Via Relyon Saral GSP (simplified, no RSA encryption)
 * - nic: Direct NIC API with RSA+AES encryption
 * - gsp: Via other GSP provider (MasterIndia, ClearTax, etc.)
 */
export async function generateEwayBill(input: EwayBillInput): Promise<EwayBillResponse> {
  const mode = process.env.EWAY_BILL_MODE || 'sandbox';
  const payload = buildEwayBillPayload(input);

  // ── Sandbox Mode: Return mock response ──
  if (mode === 'sandbox') {
    console.log('[E-Way Bill] SANDBOX MODE — generating mock e-way bill');
    console.log('[E-Way Bill] Payload:', JSON.stringify(payload, null, 2));

    const mockEwbNo = `3${Date.now().toString().slice(-11)}`;
    const now = new Date();
    const validUpto = new Date(now.getTime() + (payload.transDistance <= 200 ? 1 : Math.ceil(payload.transDistance / 200)) * 24 * 60 * 60 * 1000);

    return {
      success: true,
      ewayBillNo: mockEwbNo,
      ewayBillDate: now.toISOString(),
      validUpto: validUpto.toISOString(),
      rawResponse: { mode: 'sandbox', payload },
    };
  }

  // ── Saral GSP Mode: Relyon simplified API ──
  // IMPORTANT: Saral's production API only supports EWB from IRN (e-Invoice).
  // For standalone EWB, use generateEwayBill() which will try the standalone endpoint.
  // For production, use the shipment route which generates e-Invoice first, then EWB from IRN.
  if (mode === 'saral') {
    try {
      console.log('[E-Way Bill] SARAL MODE — calling Relyon GSP');
      console.log('[E-Way Bill] NOTE: Saral production only supports EWB from IRN. Standalone EWB may fail.');
      console.log('[E-Way Bill] For production, generate e-Invoice first, then use EWB-from-IRN endpoint.');
      const result = await saralGenerateEwb(payload);
      return {
        success: true,
        ewayBillNo: (result.ewayBillNo || result.EwayBillNo || result.EwbNo)?.toString(),
        ewayBillDate: result.ewayBillDate || result.EwayBillDate || result.EwbDt,
        validUpto: result.validUpto || result.ValidUpto || result.EwbValidTill,
        rawResponse: result,
      };
    } catch (err: unknown) {
      console.error('[E-Way Bill Saral] Error:', (err instanceof Error ? err.message : String(err)));
      if ((err instanceof Error ? err.message : String(err)).includes('auth') || (err instanceof Error ? err.message : String(err)).includes('Auth') || (err instanceof Error ? err.message : String(err)).includes('token')) {
        clearSaralAuthCache();
      }
      return { success: false, error: `Saral GSP error: ${(err instanceof Error ? err.message : String(err))}` };
    }
  }

  // ── NIC Direct Mode: RSA+AES encrypted API ──
  if (mode === 'nic') {
    try {
      console.log('[E-Way Bill] NIC MODE — calling GSTN API');
      console.log('[E-Way Bill] Payload:', JSON.stringify(payload, null, 2));

      const result = await nicApiCall('GENEWAYBILL', payload);

      return {
        success: true,
        ewayBillNo: result.ewayBillNo?.toString(),
        ewayBillDate: result.ewayBillDate,
        validUpto: result.validUpto,
        rawResponse: result,
      };
    } catch (err: unknown) {
      console.error('[E-Way Bill NIC] Error:', (err instanceof Error ? err.message : String(err)));
      // Clear auth cache on auth errors
      if ((err instanceof Error ? err.message : String(err)).includes('Auth') || (err instanceof Error ? err.message : String(err)).includes('token')) {
        nicAuthCache = null;
      }
      return {
        success: false,
        error: `NIC API error: ${(err instanceof Error ? err.message : String(err))}`,
      };
    }
  }

  // ── GSP Mode: Call GSP provider API ──
  try {
    const gspUrl = process.env.EWAY_GSP_URL;
    const gspToken = process.env.EWAY_GSP_TOKEN;
    const gstin = process.env.EWAY_GSTIN || input.supplierGstin;

    if (!gspUrl || !gspToken) {
      return { success: false, error: 'GSP credentials not configured (EWAY_GSP_URL, EWAY_GSP_TOKEN)' };
    }

    console.log('[E-Way Bill] GSP MODE — calling provider API');

    const response = await fetch(`${gspUrl}/ewaybillapi/v1.03/ewayapi/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${gspToken}`,
        'gstin': gstin,
      },
      body: JSON.stringify(payload),
    });

    const data: any = await response.json();

    if (data.success || data.ewayBillNo || data.data?.ewayBillNo) {
      const ewbData = data.data || data;
      return {
        success: true,
        ewayBillNo: ewbData.ewayBillNo?.toString(),
        ewayBillDate: ewbData.ewayBillDate,
        validUpto: ewbData.validUpto,
        rawResponse: data,
      };
    } else {
      return {
        success: false,
        error: data.message || data.error || JSON.stringify(data),
        rawResponse: data,
      };
    }
  } catch (err: unknown) {
    console.error('[E-Way Bill GSP] API call failed:', (err instanceof Error ? err.message : String(err)));
    return {
      success: false,
      error: `GSP API error: ${(err instanceof Error ? err.message : String(err))}`,
    };
  }
}

/**
 * Cancel E-Way Bill via NIC API
 */
export async function cancelEwayBill(ewayBillNo: string, cancelReason: number, cancelRemarks: string): Promise<EwayBillResponse> {
  const mode = process.env.EWAY_BILL_MODE || 'sandbox';

  if (mode === 'sandbox') {
    return { success: true, ewayBillNo, rawResponse: { cancelled: true } };
  }

  if (mode === 'nic') {
    try {
      const result = await nicApiCall('CANEWB', {
        ewbNo: parseInt(ewayBillNo),
        cancelRsnCode: cancelReason, // 1=Duplicate, 2=Order cancelled, 3=Data entry mistake, 4=Others
        cancelRmrk: cancelRemarks,
      });
      return { success: true, ewayBillNo, rawResponse: result };
    } catch (err: unknown) {
      return { success: false, error: (err instanceof Error ? err.message : String(err)) };
    }
  }

  if (mode === 'saral' || mode === 'gsp') {
    try {
      const payload = {
        ewbNo: parseInt(ewayBillNo),
        cancelRsnCode: cancelReason,
        cancelRmrk: cancelRemarks || 'Cancelled',
      };
      // Try multiple Saral GSP cancel paths
      const paths = ['/eiewb/v1.03/ewbCancel', '/ewaybillapi/v1.03/ewayapi'];
      let lastErr = '';
      for (const p of paths) {
        try {
          const result = await saralApiCall(p, payload, `Cancel EWB (${p})`);
          return { success: true, ewayBillNo, rawResponse: result };
        } catch (e: any) {
          lastErr = e.message;
          console.log(`[EWB Cancel] Path ${p} failed: ${lastErr}`);
        }
      }
      throw new Error(lastErr || 'All cancel paths failed');
    } catch (err: unknown) {
      return { success: false, error: (err instanceof Error ? err.message : String(err)) };
    }
  }

  return { success: false, error: 'Cancel not supported in current mode' };
}

/**
 * Update Vehicle (Part B) via NIC API
 */
export async function updateVehicle(ewayBillNo: string, vehicleNo: string, fromPlace: string, fromState: number, reasonCode: number, reasonRem: string, transDocNo?: string, transDocDate?: string, transMode?: string): Promise<EwayBillResponse> {
  const mode = process.env.EWAY_BILL_MODE || 'sandbox';

  if (mode === 'sandbox') {
    return { success: true, ewayBillNo, rawResponse: { updated: true, vehicleNo } };
  }

  if (mode === 'nic') {
    try {
      const result = await nicApiCall('VLOPDTL', {
        ewbNo: parseInt(ewayBillNo),
        vehicleNo: vehicleNo.replace(/\s/g, '').toUpperCase(),
        fromPlace,
        fromState,
        reasonCode, // 1=Due to Break Down, 2=Due to Transhipment, 3=Others, 4=First Time
        reasonRem,
        transDocNo: transDocNo || '',
        transDocDate: transDocDate || '',
        transMode: transMode || '1',
      });
      return { success: true, ewayBillNo, rawResponse: result };
    } catch (err: unknown) {
      return { success: false, error: (err instanceof Error ? err.message : String(err)) };
    }
  }

  return { success: false, error: 'Vehicle update not supported in GSP mode yet' };
}

/**
 * Get E-Way Bill details via NIC API
 */
export async function getEwayBillDetails(ewayBillNo: string): Promise<any> {
  const mode = process.env.EWAY_BILL_MODE || 'sandbox';

  if (mode === 'sandbox') {
    return { ewayBillNo, status: 'ACTIVE', mode: 'sandbox' };
  }

  if (mode === 'nic') {
    return nicApiCall('GETWB', { ewbNo: parseInt(ewayBillNo) });
  }

  throw new Error('Not supported in current mode');
}

/**
 * MSPIL company details (supplier side) — FALLBACK ONLY.
 * New multi-company code should use getCompanyById() from shared/config/company.ts instead.
 * This constant is kept for backwards compatibility with existing callers.
 */
export const MSPIL = {
  gstin: process.env.EWAY_GSTIN || '23AAECM3666P1Z1',
  name: 'Mahakaushal Sugar and Power Industries Ltd.',
  address: 'Village Bachai, Dist. Narsinghpur',
  city: 'Narsinghpur',
  state: 'Madhya Pradesh',
  pincode: '487001',
};
