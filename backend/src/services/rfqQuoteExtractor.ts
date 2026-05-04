/**
 * Gemini-powered vendor quote extraction from an email reply.
 *
 * Given a reply email body + any PDF/image attachments, extracts:
 *   - per-line rate (if the vendor quoted each item separately)
 *   - an overall rate / total
 *   - delivery days, payment terms, GST %, validity
 *
 * Returns null if Gemini is not configured or cannot confidently extract.
 */

import axios from 'axios';

export interface ExtractedQuote {
  overallRateNote?: string;                    // free-text e.g. "Rs.120/kg FOR basis"
  // Footer-level discount applied across all lines (e.g. "Discount - 31%" at
  // the bottom of a Gajanan-style quote). When present, callers should flatten
  // this onto every lineRate that doesn't carry its own discountPercent.
  overallDiscountPercent?: number;
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
  freightTerms?: string;
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

// Gemini 3 Flash (preview) — same price tier as 2.5 Flash but stronger at
// long-context document parsing (catches footer terms like "Discount - 31%"
// that 2.5 Flash often missed when they sat below a long line table).
const MODEL = 'gemini-3-flash-preview';

export async function extractQuoteFromReply(opts: {
  replyBody: string;
  attachments?: Array<{ filename: string; contentType: string; contentBase64: string }>;
  expectedLines: Line[];         // so Gemini knows what items to match
}): Promise<ExtractedQuote | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const itemsPrompt = opts.expectedLines.map(l =>
    `  - Line ${l.lineNo}: ${l.itemName} (qty ${l.quantity} ${l.unit})`
  ).join('\n');

  const prompt = `You are extracting a quotation from a vendor's email reply to a Request for Quotation (RFQ).

The RFQ asked for rates on these items:
${itemsPrompt}

Read the email body and any attached PDF/image below. Return a JSON object with this EXACT shape:

{
  "overallRateNote": "optional one-line summary if the vendor gave a single rate/total",
  "overallDiscountPercent": 31,       // footer / commercial-terms discount applied to ALL lines (see Discount section below)
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
  "freightTerms": "FOR site / ex-works / included",
  "currency": "INR",
  "extractedTotal": 12500.00,         // grand total if vendor gave one
  "notes": "anything else noteworthy",
  "confidence": "HIGH"                // HIGH if you parsed clear numeric rates, MEDIUM if you inferred, LOW if unsure
}

Discount extraction (CRITICAL — vendors often hide this):
- Scan the ENTIRE document, including footer / commercial terms / "Terms & Conditions" / handwritten notes / email signature.
- Look for phrases like "Discount", "Disc", "Less", "Rebate", followed by a percentage or amount.
- If a SINGLE discount applies to all items (e.g. "Discount - 31%" at the bottom of a quotation), put it in "overallDiscountPercent" — do NOT silently apply it to each line's unitRate.
- If the vendor lists a per-line discount column or note, put it in that line's "discountPercent" and leave overallDiscountPercent empty (unless BOTH are present, in which case keep both).
- Discount is a percentage (numeric, no % sign). If the vendor only gave a discount amount in rupees, convert: discountPercent = round(amount / lineSubtotal × 100, 2).
- "unitRate" must always be the GROSS / pre-discount rate as the vendor printed it. The system will apply the discount downstream.

Other rules:
- Return STRICT JSON only — no markdown, no explanation outside the JSON.
- If a field is not mentioned, omit it (don't include empty strings/nulls).
- "unitRate" must be a number. Strip currency symbols, commas.
- Match lineRates to the RFQ lines by item name similarity where possible.
- If the vendor's email is just a greeting with no rates, return {"lineRates": [], "confidence": "LOW", "notes": "no quote in reply"}.

--- EMAIL BODY ---
${opts.replyBody.slice(0, 8000)}
--- END EMAIL BODY ---`;

  const parts: Array<Record<string, unknown>> = [{ text: prompt }];

  // Attach PDF/image files if present
  for (const a of opts.attachments || []) {
    if (a.contentType === 'application/pdf' || a.contentType.startsWith('image/')) {
      parts.push({
        inlineData: { mimeType: a.contentType, data: a.contentBase64 },
      });
    }
  }

  try {
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
      { contents: [{ parts }], generationConfig: { temperature: 0.1 } },
      { timeout: 60000 },
    );

    const text: string = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    // Strip any markdown code fence
    const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    try {
      const parsed = JSON.parse(clean) as ExtractedQuote;
      // Minimal normalization
      if (!parsed.confidence) parsed.confidence = 'MEDIUM';
      if (!Array.isArray(parsed.lineRates)) parsed.lineRates = [];
      return parsed;
    } catch {
      console.error('[rfq-ai] Non-JSON response:', text.slice(0, 300));
      return { lineRates: [], confidence: 'LOW', notes: 'AI response was not valid JSON' };
    }
  } catch (err) {
    console.error('[rfq-ai] Gemini call failed:', err instanceof Error ? err.message : err);
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
