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
  lineRates: Array<{
    lineNo?: number;
    itemName?: string;
    unitRate?: number;
    gstPercent?: number;
    hsnCode?: string;
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

const MODEL = 'gemini-2.5-flash';

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
  "lineRates": [
    {
      "lineNo": 1,                    // line number from RFQ if you can match
      "itemName": "item name as the vendor wrote it",
      "unitRate": 120.50,             // rupees per unit — numeric only, no currency
      "gstPercent": 18,               // numeric GST rate
      "hsnCode": "73089090",          // if mentioned
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

Rules:
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
