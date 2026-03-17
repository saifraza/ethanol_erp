/**
 * E-Way Bill Generation Service
 *
 * Supports two modes:
 * 1. GSP Mode (recommended): Uses a GST Suvidha Provider API (MasterIndia, ClearTax, etc.)
 * 2. Direct NIC Mode: Direct integration with ewaybillgst.gov.in (requires 1000+ bills/day)
 *
 * Configure via environment variables:
 *   EWAY_BILL_MODE=sandbox|production
 *   EWAY_GSP_URL=https://api.mastersindia.co  (or your GSP's URL)
 *   EWAY_GSP_TOKEN=your_api_token
 *   EWAY_GSTIN=23AAECM3666P1Z1  (MSPIL's GSTIN)
 */

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
    fromPlace: 'Narsinghpur',
    fromPincode: parseInt(input.supplierPincode) || 487001,
    fromStateCode: parseInt(fromStateCode),
    toGstin: input.recipientGstin || 'URP', // URP = Unregistered Person
    toTrdName: input.recipientName,
    toAddr1: input.recipientAddress.substring(0, 120),
    toAddr2: '',
    toPlace: input.recipientAddress.split(',').slice(-2, -1)[0]?.trim() || '',
    toPincode: parseInt(input.recipientPincode) || 0,
    toStateCode: parseInt(toStateCode),
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

/**
 * Generate E-Way Bill via GSP API
 *
 * In sandbox mode: returns a mock e-way bill number for testing
 * In production mode: calls the configured GSP endpoint
 */
export async function generateEwayBill(input: EwayBillInput): Promise<EwayBillResponse> {
  const mode = process.env.EWAY_BILL_MODE || 'sandbox';
  const payload = buildEwayBillPayload(input);

  // ── Sandbox Mode: Return mock response ──
  if (mode === 'sandbox' || !process.env.EWAY_GSP_URL) {
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

  // ── Production Mode: Call GSP API ──
  try {
    const gspUrl = process.env.EWAY_GSP_URL;
    const gspToken = process.env.EWAY_GSP_TOKEN;
    const gstin = process.env.EWAY_GSTIN || input.supplierGstin;

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
  } catch (err: any) {
    console.error('[E-Way Bill] API call failed:', err.message);
    return {
      success: false,
      error: `GSP API error: ${err.message}`,
    };
  }
}

/**
 * MSPIL company details (supplier side)
 */
export const MSPIL = {
  gstin: process.env.EWAY_GSTIN || '23AAECM3666P1Z1',
  name: 'Mahakaushal Sugar and Power Industries Ltd.',
  address: 'Village Bachai, Dist. Narsinghpur',
  state: 'Madhya Pradesh',
  pincode: '487001',
};
