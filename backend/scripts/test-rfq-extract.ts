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
import { extractQuoteFromReply } from '../src/services/rfqQuoteExtractor';

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
  console.log(`paymentTerms:            ${result.paymentTerms ?? '(not extracted)'}`);
  console.log(`deliveryDays:            ${result.deliveryDays ?? '(not extracted)'}`);
  console.log(`freightTerms:            ${result.freightTerms ?? '(not extracted)'}`);
  console.log(`quoteValidityDays:       ${result.quoteValidityDays ?? '(not extracted)'}`);
  console.log(`lineRates count:         ${result.lineRates.length}`);
  if (result.overallDiscountPercent === 31) {
    console.log('\n✅ SUCCESS — Gajanan footer discount (31%) was extracted correctly.');
  } else {
    console.log('\n⚠️  Footer discount not 31% — check the prompt or model output.');
  }
}

main().catch(err => {
  console.error('[test-rfq-extract] crashed:', err);
  process.exit(1);
});
