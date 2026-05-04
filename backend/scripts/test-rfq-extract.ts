/**
 * Local test harness for the RFQ quote extractor.
 *
 * Runs the actual Gemini call (no DB, no Express) against a PDF on disk so
 * you can verify model + prompt behaviour without deploying.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/test-rfq-extract.ts /path/to/quotation.pdf
 *
 * Defaults to the Gajanan PDF the team is iterating on. Reads GEMINI_API_KEY
 * (and optional GEMINI_MODEL) from backend/.env.
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { extractQuoteFromReply, matchExtractedToIndentLine } from '../src/services/rfqQuoteExtractor';

const DEFAULT_PDF = '/Users/saifraza/Downloads/14ed0c49-411d-444f-a820-0b75d05794d6.pdf';

// Gajanan's actual line items (from the quotation we're testing against).
// Trimmed to a few representative lines — extractor only uses these for matching.
const GAJANAN_EXPECTED_LINES = [
  { lineNo: 1, itemName: 'Center shaft Pin at Brg housing NYM60B1Y', quantity: 6, unit: 'Nos' },
  { lineNo: 5, itemName: 'Bush (U J Head) NYM60B1Y', quantity: 6, unit: 'Nos' },
  { lineNo: 11, itemName: 'Rubber stator GPSM8064', quantity: 6, unit: 'Nos' },
  { lineNo: 28, itemName: 'Rotor SMF 731C11853A100', quantity: 1, unit: 'Nos' },
  { lineNo: 36, itemName: 'Rotor SMB0801C11653 A100', quantity: 1, unit: 'Nos' },
];

async function main() {
  const pdfPath = process.argv[2] || DEFAULT_PDF;
  const absPath = resolve(pdfPath);
  console.log(`\n[test-rfq-extract] PDF: ${absPath}`);
  console.log(`[test-rfq-extract] Model: ${process.env.GEMINI_MODEL || 'gemini-3-flash-preview'} (default)`);
  console.log(`[test-rfq-extract] Key set: ${process.env.GEMINI_API_KEY ? 'yes' : 'NO — add GEMINI_API_KEY to backend/.env'}`);

  const pdfBytes = readFileSync(absPath);
  const contentBase64 = pdfBytes.toString('base64');

  const t0 = Date.now();
  const result = await extractQuoteFromReply({
    replyBody: 'Please find attached our quotation for the items requested.',
    attachments: [{ filename: 'quotation.pdf', contentType: 'application/pdf', contentBase64 }],
    expectedLines: GAJANAN_EXPECTED_LINES,
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n[test-rfq-extract] elapsed: ${elapsed}s`);
  if (!result) {
    console.error('[test-rfq-extract] ❌ Extractor returned null — check console for the Gemini error above.');
    process.exit(1);
  }

  console.log('\n=== EXTRACTED QUOTE ===');
  console.log(JSON.stringify(result, null, 2));

  // Quick sanity check on the discount
  console.log('\n=== KEY FIELDS ===');
  console.log(`confidence:              ${result.confidence}`);
  console.log(`overallDiscountPercent:  ${result.overallDiscountPercent ?? '(not extracted)'}`);
  console.log(`packingPercent:          ${result.packingPercent ?? '(not extracted)'}`);
  console.log(`packingAmount:           ${result.packingAmount ?? '(not extracted)'}`);
  console.log(`freightPercent:          ${result.freightPercent ?? '(not extracted)'}`);
  console.log(`freightAmount:           ${result.freightAmount ?? '(not extracted)'}`);
  console.log(`insurancePercent:        ${result.insurancePercent ?? '(not extracted)'}`);
  console.log(`insuranceAmount:         ${result.insuranceAmount ?? '(not extracted)'}`);
  console.log(`isRateInclusiveOfGst:    ${result.isRateInclusiveOfGst ?? '(not extracted)'}`);
  console.log(`deliveryBasis:           ${result.deliveryBasis ?? '(not extracted)'}`);
  console.log(`tcsPercent:              ${result.tcsPercent ?? '(not extracted)'}`);
  console.log(`additionalCharges:       ${result.additionalCharges ? JSON.stringify(result.additionalCharges) : '(none)'}`);
  console.log(`paymentTerms:            ${result.paymentTerms ?? '(not extracted)'}`);
  console.log(`deliveryDays:            ${result.deliveryDays ?? '(not extracted)'}`);
  console.log(`freightTerms:            ${result.freightTerms ?? '(not extracted)'}`);
  console.log(`quoteValidityDays:       ${result.quoteValidityDays ?? '(not extracted)'}`);
  console.log(`lineRates count:         ${result.lineRates.length}`);

  const checks: string[] = [];
  if (result.overallDiscountPercent === 31) checks.push('discount 31%');
  if (result.packingPercent === 2) checks.push('packing 2%');
  if (result.deliveryBasis === 'EX_WORKS') checks.push('delivery basis EX_WORKS');
  if (result.confidence === 'HIGH') checks.push('HIGH confidence');
  console.log(`\n✅ Verified: ${checks.join(', ') || 'none'}`);
  const missing: string[] = [];
  if (result.overallDiscountPercent !== 31) missing.push('discount 31%');
  if (result.packingPercent !== 2) missing.push('packing 2%');
  if (missing.length) console.log(`⚠️  Missing: ${missing.join(', ')}`);

  // Now exercise the matcher against the real AI output — this is what
  // PR #13 fixes. Show which extracted lines map to which indent lines and
  // by what strategy.
  console.log('\n=== MATCHER OUTPUT (PR #13 fuzzy matching) ===');
  const indentLite = GAJANAN_EXPECTED_LINES.map((l, i) => ({ id: `idx-${i}`, lineNo: l.lineNo, itemName: l.itemName }));
  let matched = 0;
  let unmatched = 0;
  const usable = result.lineRates.filter(lr => typeof lr.unitRate === 'number' && lr.unitRate > 0);
  const positional = usable.length === GAJANAN_EXPECTED_LINES.length;
  console.log(`  Indent lines: ${GAJANAN_EXPECTED_LINES.length}, AI usable rates: ${usable.length}, positional fallback: ${positional}`);
  for (const lr of result.lineRates) {
    if (!lr.unitRate || lr.unitRate <= 0) continue;
    const m = matchExtractedToIndentLine(lr, indentLite);
    if (m) {
      matched++;
      console.log(`  ✓ "${lr.itemName ?? '(no name)'}" → "${m.line.itemName}" via ${m.strategy} (₹${lr.unitRate})`);
    } else if (positional) {
      const idx = usable.indexOf(lr);
      if (idx >= 0 && idx < GAJANAN_EXPECTED_LINES.length) {
        matched++;
        console.log(`  ↪ "${lr.itemName ?? '(no name)'}" → "${GAJANAN_EXPECTED_LINES[idx].itemName}" via positional[${idx}] (₹${lr.unitRate})`);
      } else {
        unmatched++;
        console.log(`  ✗ "${lr.itemName ?? '(no name)'}" → NO MATCH (₹${lr.unitRate})`);
      }
    } else {
      unmatched++;
      console.log(`  ✗ "${lr.itemName ?? '(no name)'}" → NO MATCH (₹${lr.unitRate})`);
    }
  }
  console.log(`\n  Matched: ${matched}/${matched + unmatched}${unmatched > 0 ? ` — ${unmatched} would need manual mapping in the diagnostics panel` : ''}`);
}

main().catch(err => {
  console.error('[test-rfq-extract] crashed:', err);
  process.exit(1);
});
