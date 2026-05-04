/**
 * Gemini-powered vendor quote extraction from an email reply.
 *
 * Given a reply email body + any PDF/image attachments, extracts:
 *   - per-line rate (if the vendor quoted each item separately)
 *   - an overall rate / total
 *   - delivery days, payment terms, GST %, validity
 *
 * Returns null if Gemini is not configured or cannot confidently extract.
 *
 * Uses the official @google/genai SDK so we get auth, retry, and endpoint
 * routing for free — same pattern as Anvil's packages/ai/src/providers/gemini.ts.
 * Raw axios calls to v1beta worked for 2.x but stopped working for 3.x models;
 * the SDK abstracts that.
 */

import { GoogleGenAI } from '@google/genai';

// One additional charge line (handling, documentation, courier, etc.) — used
// when the vendor lists a charge that doesn't fit the named buckets below.
// Either percent OR amount, not both. basis defaults to 'BASIC' (i.e. on the
// pre-tax line subtotal).
export interface AdditionalCharge {
  name: string;                                // e.g. "Handling", "Documentation"
  percent?: number;                            // if vendor said "X%"
  amount?: number;                             // if vendor said "Rs.X"
  basis?: 'BASIC' | 'POST_DISCOUNT' | 'TAXABLE';
}

export interface ExtractedQuote {
  overallRateNote?: string;                    // free-text e.g. "Rs.120/kg FOR basis"
  // Footer-level discount applied across all lines (e.g. "Discount - 31%" at
  // the bottom of a Gajanan-style quote). When present, callers should flatten
  // this onto every lineRate that doesn't carry its own discountPercent.
  overallDiscountPercent?: number;

  // ── Structured cost components (the "Quote Cost Template") ──
  // Vendors quote these inline ("Packing Extra @ 2%", "Insurance 0.5%"); we
  // promote them out of free text so they flow to the PO header automatically
  // instead of getting lost in `notes`. Each is optional — only present when
  // the vendor mentioned them. Either percent OR amount, not both.
  packingPercent?: number;
  packingAmount?: number;
  freightPercent?: number;
  freightAmount?: number;
  insurancePercent?: number;
  insuranceAmount?: number;
  loadingPercent?: number;
  loadingAmount?: number;
  // Catchall for any charge that doesn't fit the named buckets above.
  additionalCharges?: AdditionalCharge[];

  // Tax / commercial flags that affect cost math
  isRateInclusiveOfGst?: boolean;              // critical — wrong = 18% off PO totals
  tcsPercent?: number;                         // TCS @ X% applied at vendor invoice booking
  deliveryBasis?: 'EX_WORKS' | 'FOR_DESTINATION' | 'CIF' | 'FOB' | 'OTHER';

  lineRates: Array<{
    lineNo?: number;
    itemName?: string;
    unitRate?: number;
    gstPercent?: number;
    hsnCode?: string;
    discountPercent?: number;                  // per-line discount, if vendor itemized it
    remarks?: string;
  }>;
  deliveryDays?: number;
  paymentTerms?: string;
  quoteValidityDays?: number;
  freightTerms?: string;                       // free text — kept alongside structured freightAmount
  currency?: string;
  extractedTotal?: number;
  notes?: string;                              // anything else worth capturing
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';       // how sure Gemini is
}

interface Line {
  lineNo: number;
  itemName: string;
  quantity: number;
  unit: string;
}

// Model selection — accuracy beats cost for procurement extraction (a missed
// discount or wrong rate goes straight to a real PO). Default is Gemini 3
// Flash (preview): Pro-level accuracy at Flash pricing, stronger long-context
// than 2.5 Flash for footer terms below long line tables.
//
// Override per-env without a deploy via GEMINI_MODEL.
//   GEMINI_MODEL=gemini-3-flash-preview  (default — current best price/accuracy)
//   GEMINI_MODEL=gemini-2.5-pro          (proven fallback if 3-flash misbehaves)
//   GEMINI_MODEL=gemini-3-pro            (when GA — top accuracy)
const MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';

let cachedClient: GoogleGenAI | undefined;
function getClient(): GoogleGenAI | null {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  cachedClient = new GoogleGenAI({ apiKey });
  return cachedClient;
}

export async function extractQuoteFromReply(opts: {
  replyBody: string;
  attachments?: Array<{ filename: string; contentType: string; contentBase64: string }>;
  expectedLines: Line[];         // so Gemini knows what items to match
}): Promise<ExtractedQuote | null> {
  const client = getClient();
  if (!client) return null;

  const itemsPrompt = opts.expectedLines.map(l =>
    `  - Line ${l.lineNo}: ${l.itemName} (qty ${l.quantity} ${l.unit})`
  ).join('\n');

  const prompt = `You are extracting a quotation from a vendor's email reply to a Request for Quotation (RFQ).

The RFQ asked for rates on these items:
${itemsPrompt}

Read the email body and any attached PDF/image below. Return a JSON object with this EXACT shape:

{
  "overallRateNote": "optional one-line summary if the vendor gave a single rate/total",
  "overallDiscountPercent": 31,       // footer / commercial-terms discount applied to ALL lines

  // ── Cost components — promote inline charges out of free text ──
  "packingPercent": 2,                 // e.g. "Packing Extra @ 2%"
  "packingAmount": 500,                // e.g. "Packing Rs. 500"  (use either percent OR amount, never both)
  "freightPercent": 1.5,               // e.g. "Freight 1.5% extra"
  "freightAmount": 2500,               // e.g. "Freight Rs. 2,500"
  "insurancePercent": 0.5,             // e.g. "Insurance @ 0.5%"
  "insuranceAmount": 800,              // e.g. "Insurance Rs. 800"
  "loadingPercent": 1,                 // e.g. "Loading 1%"
  "loadingAmount": 200,                // e.g. "Loading Rs. 200"
  "additionalCharges": [               // catchall for any other charge (handling, docs, courier, etc.)
    { "name": "Documentation", "amount": 150 },
    { "name": "Handling", "percent": 0.5 }
  ],

  // ── Tax / commercial flags ──
  "isRateInclusiveOfGst": false,       // true ONLY if vendor explicitly says "rate inclusive of GST" / "all-inclusive"
  "tcsPercent": 0.1,                   // e.g. "TCS @ 0.1% extra applicable"
  "deliveryBasis": "EX_WORKS",         // EX_WORKS | FOR_DESTINATION | CIF | FOB | OTHER — derived from freight terms

  "lineRates": [
    {
      "lineNo": 1,                    // line number from RFQ if you can match
      "itemName": "item name as the vendor wrote it",
      "unitRate": 120.50,             // rupees per unit — numeric only, no currency, ALWAYS the gross/list rate (do NOT pre-apply the discount)
      "gstPercent": 18,               // numeric GST rate
      "hsnCode": "73089090",          // if mentioned
      "discountPercent": 10,          // per-line discount, only if the vendor itemized one for THIS line
      "remarks": "brand, origin, etc."
    }
  ],
  "deliveryDays": 7,                  // numeric, number of days from PO
  "paymentTerms": "50% advance, 50% on delivery",
  "quoteValidityDays": 15,
  "freightTerms": "FOR site / ex-works / included",  // KEEP this free-text version too even if you fill freightAmount/freightPercent
  "currency": "INR",
  "extractedTotal": 12500.00,         // grand total if vendor gave one
  "notes": "anything else noteworthy that doesn't fit the structured fields above",
  "confidence": "HIGH"                // HIGH if you parsed clear numeric rates, MEDIUM if you inferred, LOW if unsure
}

Discount extraction (CRITICAL — vendors often hide this):
- Scan the ENTIRE document, including footer / commercial terms / "Terms & Conditions" / handwritten notes / email signature.
- Look for phrases like "Discount", "Disc", "Less", "Rebate", followed by a percentage or amount.
- If a SINGLE discount applies to all items (e.g. "Discount - 31%" at the bottom of a quotation), put it in "overallDiscountPercent" — do NOT silently apply it to each line's unitRate.
- If the vendor lists a per-line discount column or note, put it in that line's "discountPercent" and leave overallDiscountPercent empty (unless BOTH are present, in which case keep both).
- Discount is a percentage (numeric, no % sign). If the vendor only gave a discount amount in rupees, convert: discountPercent = round(amount / lineSubtotal × 100, 2).
- "unitRate" must always be the GROSS / pre-discount rate as the vendor printed it. The system will apply the discount downstream.

Cost-component extraction (CRITICAL — these affect the PO total):
- Packing, Freight, Insurance, Loading: each can be a percent or a fixed amount. Pick whichever the vendor gave. NEVER fill both percent and amount for the same charge.
- "Freight Extra" with no number → leave freightPercent / freightAmount empty, only fill freightTerms text.
- "Ex Works <city>" / "FOR <site>" / "CIF" → use deliveryBasis enum AND keep the original phrase in freightTerms.
- ANY other charge the vendor lists (handling, documentation, courier, octroi, etc.) → push to additionalCharges with name + percent OR amount.
- "rate inclusive of GST" / "all-inclusive" / "incl. GST" → isRateInclusiveOfGst: true. Default is false (exclusive). Wrong here = 18% off the PO total.

Other rules:
- Return STRICT JSON only — no markdown, no explanation outside the JSON.
- If a field is not mentioned, omit it (don't include empty strings/nulls).
- "unitRate" must be a number. Strip currency symbols, commas.
- Match lineRates to the RFQ lines by item name similarity where possible.
- ANYTHING you couldn't fit into the structured fields above (warranty terms, packaging spec, brand restrictions, plant location, etc.) goes into "notes" verbatim — do not silently drop information.
- If the vendor's email is just a greeting with no rates, return {"lineRates": [], "confidence": "LOW", "notes": "no quote in reply"}.

--- EMAIL BODY ---
${opts.replyBody.slice(0, 8000)}
--- END EMAIL BODY ---`;

  type GeminiPart =
    | { text: string }
    | { inlineData: { mimeType: string; data: string } };
  const parts: GeminiPart[] = [];

  // PDF/image attachments first (per Anvil's pattern — improves grounding)
  for (const a of opts.attachments || []) {
    if (a.contentType === 'application/pdf' || a.contentType.startsWith('image/')) {
      parts.push({ inlineData: { mimeType: a.contentType, data: a.contentBase64 } });
    }
  }
  parts.push({ text: prompt });

  try {
    const result = await client.models.generateContent({
      model: MODEL,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxOutputTokens: 8000,
      },
      contents: [{ role: 'user', parts }],
    });

    const text = result.text?.trim() ?? '';
    if (!text) {
      const finishReason = result.candidates?.[0]?.finishReason ?? 'unknown';
      console.error(`[rfq-ai] Gemini returned no text (model=${MODEL}, finishReason=${finishReason})`);
      return { lineRates: [], confidence: 'LOW', notes: `AI returned no content (finishReason: ${finishReason})` };
    }

    // responseMimeType=application/json should give pure JSON, but fall back
    // to fence-stripping in case the model wraps it anyway.
    const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    try {
      const parsed = JSON.parse(clean) as ExtractedQuote;
      if (!parsed.confidence) parsed.confidence = 'MEDIUM';
      if (!Array.isArray(parsed.lineRates)) parsed.lineRates = [];
      return parsed;
    } catch {
      console.error('[rfq-ai] Non-JSON response from', MODEL, ':', text.slice(0, 300));
      return { lineRates: [], confidence: 'LOW', notes: `AI response was not valid JSON (model: ${MODEL})` };
    }
  } catch (err) {
    // Surface the actual SDK error so operators see what went wrong (wrong
    // model, quota, network, etc.) instead of the generic fallback.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[rfq-ai] Gemini call failed (model=${MODEL}):`, message);
    return null;
  }
}

/**
 * Resolve the effective per-line discount %. Per-line wins; falls back to the
 * overall (footer) discount. Use this everywhere a line is persisted so the
 * award→PO handoff doesn't drop the footer discount.
 */
export function effectiveLineDiscount(
  line: { discountPercent?: number },
  overall: number | undefined,
): number {
  const perLine = typeof line.discountPercent === 'number' && line.discountPercent > 0 ? line.discountPercent : 0;
  if (perLine > 0) return perLine;
  return typeof overall === 'number' && overall > 0 ? overall : 0;
}

/**
 * Map an ExtractedQuote's structured cost fields to the PurchaseRequisitionVendor
 * row shape. Used by both the manual extract-quote route and the background
 * auto-extract poller so the persisted fields stay in sync.
 *
 * Returns only the cost-template subset — caller decides what else to write
 * (vendorRate, quoteRemarks, etc.).
 */
export function quoteCostFieldsForDb(extracted: ExtractedQuote) {
  return {
    packingPercent: extracted.packingPercent ?? 0,
    packingAmount: extracted.packingAmount ?? 0,
    freightPercent: extracted.freightPercent ?? 0,
    freightAmount: extracted.freightAmount ?? 0,
    insurancePercent: extracted.insurancePercent ?? 0,
    insuranceAmount: extracted.insuranceAmount ?? 0,
    loadingPercent: extracted.loadingPercent ?? 0,
    loadingAmount: extracted.loadingAmount ?? 0,
    isRateInclusiveOfGst: extracted.isRateInclusiveOfGst ?? false,
    tcsPercent: extracted.tcsPercent ?? 0,
    deliveryBasis: extracted.deliveryBasis ?? null,
    // Prisma's Json column wants InputJsonValue, which doesn't accept typed
    // arrays of objects without an index signature. Cast through unknown to
    // satisfy the generated client types — runtime shape is unchanged.
    additionalCharges: (Array.isArray(extracted.additionalCharges) ? extracted.additionalCharges : []) as unknown as object[],
  };
}
