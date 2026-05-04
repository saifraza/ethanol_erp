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

import { GoogleGenAI, Type } from '@google/genai';
import { logAiCall } from './aiCallLogger';

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
// discount or wrong rate goes straight to a real PO).
//
// 2026-05-04: Switched default from gemini-3-flash-preview to gemini-2.5-pro.
// gemini-3-flash-preview hit a degenerate trailing-zero loop on the Gajanan
// PDF — emitted "620.0000000000…" until the output budget was exhausted,
// producing a truncated mid-number response. Verified with the local test
// harness: gemini-2.5-pro extracts everything (discount, packing, delivery
// basis, all 5 line items) with HIGH confidence on the same PDF.
//
// Override per-env via GEMINI_MODEL when a newer model passes the same test:
//   GEMINI_MODEL=gemini-2.5-pro          (default — proven on real procurement PDFs)
//   GEMINI_MODEL=gemini-3-pro            (when GA — top accuracy)
//   GEMINI_MODEL=gemini-3-flash-preview  (cheaper but currently buggy — do not use)
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-pro';

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
  // Audit context — passed through to AiCallLog so the Settings page can
  // group by user / link back to the indent vendor row.
  userId?: string | null;
  contextRef?: string | null;
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

  // Without a responseSchema, Gemini 3 Flash sometimes interleaves top-level
  // keys with nested array element keys, producing invalid JSON. Anvil's
  // gemini provider hit the same problem and fixed it with a schema; same
  // pattern here. Optional fields are NOT marked required so the model can
  // legitimately omit them.
  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      overallRateNote: { type: Type.STRING },
      overallDiscountPercent: { type: Type.NUMBER },
      packingPercent: { type: Type.NUMBER },
      packingAmount: { type: Type.NUMBER },
      freightPercent: { type: Type.NUMBER },
      freightAmount: { type: Type.NUMBER },
      insurancePercent: { type: Type.NUMBER },
      insuranceAmount: { type: Type.NUMBER },
      loadingPercent: { type: Type.NUMBER },
      loadingAmount: { type: Type.NUMBER },
      isRateInclusiveOfGst: { type: Type.BOOLEAN },
      tcsPercent: { type: Type.NUMBER },
      deliveryBasis: { type: Type.STRING, enum: ['EX_WORKS', 'FOR_DESTINATION', 'CIF', 'FOB', 'OTHER'] },
      additionalCharges: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            percent: { type: Type.NUMBER },
            amount: { type: Type.NUMBER },
            basis: { type: Type.STRING },
          },
          required: ['name'],
        },
      },
      lineRates: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            lineNo: { type: Type.INTEGER },
            itemName: { type: Type.STRING },
            unitRate: { type: Type.NUMBER },
            gstPercent: { type: Type.NUMBER },
            hsnCode: { type: Type.STRING },
            discountPercent: { type: Type.NUMBER },
            remarks: { type: Type.STRING },
          },
        },
      },
      deliveryDays: { type: Type.NUMBER },
      paymentTerms: { type: Type.STRING },
      quoteValidityDays: { type: Type.NUMBER },
      freightTerms: { type: Type.STRING },
      currency: { type: Type.STRING },
      extractedTotal: { type: Type.NUMBER },
      notes: { type: Type.STRING },
      confidence: { type: Type.STRING, enum: ['HIGH', 'MEDIUM', 'LOW'] },
    },
    required: ['lineRates', 'confidence'],
  };

  const t0 = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW' | undefined;
  let success = false;
  let errorMessage: string | null = null;
  try {
    const result = await client.models.generateContent({
      model: MODEL,
      config: {
        responseMimeType: 'application/json',
        responseSchema,
        temperature: 0.1,
        maxOutputTokens: 8000,
      },
      contents: [{ role: 'user', parts }],
    });

    inputTokens = result.usageMetadata?.promptTokenCount ?? 0;
    outputTokens = result.usageMetadata?.candidatesTokenCount ?? 0;

    const text = result.text?.trim() ?? '';
    if (!text) {
      const finishReason = result.candidates?.[0]?.finishReason ?? 'unknown';
      console.error(`[rfq-ai] Gemini returned no text (model=${MODEL}, finishReason=${finishReason})`);
      errorMessage = `no content (finishReason: ${finishReason})`;
      confidence = 'LOW';
      return { lineRates: [], confidence, notes: `AI returned no content (finishReason: ${finishReason})` };
    }

    // responseMimeType=application/json should give pure JSON, but fall back
    // to fence-stripping in case the model wraps it anyway.
    const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    try {
      const parsed = JSON.parse(clean) as ExtractedQuote;
      if (!parsed.confidence) parsed.confidence = 'MEDIUM';
      if (!Array.isArray(parsed.lineRates)) parsed.lineRates = [];
      success = true;
      confidence = parsed.confidence;
      return parsed;
    } catch (e) {
      console.error(`[rfq-ai] Non-JSON response from ${MODEL}:`, text.slice(0, 300));
      errorMessage = `non-JSON response: ${(e as Error).message}`;
      confidence = 'LOW';
      return { lineRates: [], confidence, notes: `AI response was not valid JSON (model: ${MODEL})` };
    }
  } catch (err) {
    // Surface the actual SDK error so operators see what went wrong (wrong
    // model, quota, network, etc.) instead of the generic fallback.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[rfq-ai] Gemini call failed (model=${MODEL}):`, message);
    errorMessage = message;
    return null;
  } finally {
    // Best-effort audit log. Never throws.
    void logAiCall({
      feature: 'rfq-extraction',
      provider: 'gemini',
      model: MODEL,
      userId: opts.userId ?? null,
      contextRef: opts.contextRef ?? null,
      inputTokens,
      outputTokens,
      durationMs: Date.now() - t0,
      success,
      errorMessage,
      metadata: {
        confidence: confidence ?? null,
        attachmentCount: (opts.attachments ?? []).length,
        expectedLineCount: opts.expectedLines.length,
      },
    });
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
/**
 * Match an AI-extracted line rate to one of the indent's lines.
 *
 * Strict equality (the original strategy) fails constantly because vendor PDFs
 * write item names slightly differently from how they're stored on the indent
 * ("Sulphuric Acid 98%" vs "Sulphuric acid (98%)" vs "H2SO4 - 98%"). This
 * function tries 4 strategies in order, stopping at the first success:
 *
 *   1. lineNo equality (rare — AI usually doesn't fill this)
 *   2. case-insensitive exact name equality (the old behavior)
 *   3. normalized name equality (lowercased, alphanumeric only)
 *   4. token-overlap (Jaccard ≥ 0.5 on words ≥ 3 chars, ignoring stop-words)
 *
 * Caller should also try positional fallback (when extracted.length === indent.length)
 * separately — that needs the full arrays, not single-line context.
 */
const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'per', 'kgs', 'kg', 'ltr', 'liter', 'litre', 'no', 'mt', 'tonne', 'ton', 'bag', 'bags', 'piece', 'pieces', 'pcs', 'unit', 'units', 'each', 'item', 'items']);

function normalize(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function tokens(s: string): Set<string> {
  return new Set(
    (s || '').toLowerCase().split(/[^a-z0-9]+/i).filter(t => t.length >= 3 && !STOPWORDS.has(t))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  for (const x of a) if (b.has(x)) intersect++;
  const union = a.size + b.size - intersect;
  return intersect / union;
}

export interface IndentLineLite { id: string; lineNo: number; itemName: string }

export function matchExtractedToIndentLine(
  lr: { lineNo?: number; itemName?: string },
  indentLines: IndentLineLite[],
): { line: IndentLineLite; strategy: 'lineNo' | 'exact' | 'normalized' | 'tokens' } | null {
  if (lr.lineNo) {
    const byLineNo = indentLines.find(l => l.lineNo === lr.lineNo);
    if (byLineNo) return { line: byLineNo, strategy: 'lineNo' };
  }
  if (!lr.itemName) return null;

  const lcExtracted = lr.itemName.toLowerCase().trim();
  const exact = indentLines.find(l => l.itemName.toLowerCase().trim() === lcExtracted);
  if (exact) return { line: exact, strategy: 'exact' };

  const normExtracted = normalize(lr.itemName);
  if (normExtracted) {
    const norm = indentLines.find(l => normalize(l.itemName) === normExtracted);
    if (norm) return { line: norm, strategy: 'normalized' };
  }

  const tokExtracted = tokens(lr.itemName);
  if (tokExtracted.size > 0) {
    let best: { line: IndentLineLite; score: number } | null = null;
    for (const il of indentLines) {
      const score = jaccard(tokExtracted, tokens(il.itemName));
      if (score >= 0.5 && (!best || score > best.score)) best = { line: il, score };
    }
    if (best) return { line: best.line, strategy: 'tokens' };
  }

  return null;
}

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
