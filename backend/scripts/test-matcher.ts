/**
 * Unit test for matchExtractedToIndentLine — the fuzzy item-name matcher.
 * Run: cd backend && npx ts-node scripts/test-matcher.ts
 *
 * No DB, no API calls. Just feeds realistic vendor-PDF vs indent-line pairs
 * through the matcher and prints whether each strategy fires correctly.
 */

import { matchExtractedToIndentLine, type IndentLineLite } from '../src/services/rfqQuoteExtractor';

type TestCase = {
  name: string;
  indentLines: IndentLineLite[];
  aiLineRates: Array<{ lineNo?: number; itemName?: string }>;
  expect: Array<string | null>; // expected matched indent itemName or null per AI line
  expectStrategy?: Array<string | null>;
};

const cases: TestCase[] = [
  {
    name: 'lineNo wins when AI fills it',
    indentLines: [
      { id: 'a', lineNo: 1, itemName: 'Caustic Soda Flakes' },
      { id: 'b', lineNo: 2, itemName: 'Hydrochloric Acid 33%' },
    ],
    aiLineRates: [
      { lineNo: 2, itemName: 'totally different name' },
      { lineNo: 1 },
    ],
    expect: ['Hydrochloric Acid 33%', 'Caustic Soda Flakes'],
    expectStrategy: ['lineNo', 'lineNo'],
  },
  {
    name: 'exact case-insensitive match',
    indentLines: [
      { id: 'a', lineNo: 1, itemName: 'Caustic Soda Flakes' },
    ],
    aiLineRates: [{ itemName: 'CAUSTIC SODA FLAKES' }],
    expect: ['Caustic Soda Flakes'],
    expectStrategy: ['exact'],
  },
  {
    name: 'normalized strips punctuation/whitespace',
    indentLines: [
      { id: 'a', lineNo: 1, itemName: 'Hydrochloric Acid - 33%' },
      { id: 'b', lineNo: 2, itemName: 'Sulphuric Acid (98%)' },
    ],
    aiLineRates: [
      { itemName: 'Hydrochloric Acid 33%' },
      { itemName: 'Sulphuric Acid 98%' },
    ],
    expect: ['Hydrochloric Acid - 33%', 'Sulphuric Acid (98%)'],
    expectStrategy: ['normalized', 'normalized'],
  },
  {
    name: 'token-overlap catches re-ordered words',
    indentLines: [
      { id: 'a', lineNo: 1, itemName: 'Sulphuric Acid Commercial Grade 98%' },
    ],
    aiLineRates: [{ itemName: 'Commercial Grade Sulphuric Acid' }],
    expect: ['Sulphuric Acid Commercial Grade 98%'],
    expectStrategy: ['tokens'],
  },
  {
    name: 'token-overlap catches paraphrase',
    indentLines: [
      { id: 'a', lineNo: 1, itemName: 'Industrial Grade Hydrochloric Acid' },
    ],
    aiLineRates: [{ itemName: 'Hydrochloric Acid Industrial' }],
    expect: ['Industrial Grade Hydrochloric Acid'],
    expectStrategy: ['tokens'],
  },
  {
    name: 'unrelated names should NOT match (false-positive guard)',
    indentLines: [
      { id: 'a', lineNo: 1, itemName: 'Caustic Soda' },
    ],
    aiLineRates: [{ itemName: 'Diesel Fuel' }],
    expect: [null],
    expectStrategy: [null],
  },
  {
    name: 'short stop-words alone do NOT match (token quality)',
    indentLines: [
      { id: 'a', lineNo: 1, itemName: 'Bag of Cement' },
    ],
    aiLineRates: [{ itemName: 'Bag of Sand' }],
    // both share "bag" only → "bag" is in STOPWORDS so 0 tokens overlap → no match
    expect: [null],
    expectStrategy: [null],
  },
  {
    name: 'real vendor PDF mismatch — chemical formula vs name',
    indentLines: [
      { id: 'a', lineNo: 1, itemName: 'Sulphuric Acid 98%' },
    ],
    aiLineRates: [{ itemName: 'H2SO4 - 98%' }],
    // No common tokens — matcher returns null. Positional fallback (handled by caller) would catch this if N==N.
    expect: [null],
    expectStrategy: [null],
  },
  {
    name: 'multi-word partial token overlap (Jaccard ≥ 0.5)',
    indentLines: [
      { id: 'a', lineNo: 1, itemName: 'Cement OPC 53 Grade' },
      { id: 'b', lineNo: 2, itemName: 'Steel TMT 12mm Rebar' },
    ],
    aiLineRates: [
      { itemName: 'OPC 53 Grade Cement' },
      { itemName: 'TMT Steel 12mm' },
    ],
    expect: ['Cement OPC 53 Grade', 'Steel TMT 12mm Rebar'],
    expectStrategy: ['tokens', 'tokens'],
  },
];

let pass = 0;
let fail = 0;
for (const tc of cases) {
  console.log(`\n── ${tc.name}`);
  for (let i = 0; i < tc.aiLineRates.length; i++) {
    const lr = tc.aiLineRates[i];
    const expected = tc.expect[i];
    const expectedStrat = tc.expectStrategy?.[i];
    const result = matchExtractedToIndentLine(lr, tc.indentLines);
    const got = result?.line.itemName ?? null;
    const gotStrat = result?.strategy ?? null;
    const okMatch = got === expected;
    const okStrat = expectedStrat === undefined || gotStrat === expectedStrat;
    const ok = okMatch && okStrat;
    const aiName = lr.itemName ?? `lineNo:${lr.lineNo}`;
    if (ok) {
      pass++;
      console.log(`  ✓ "${aiName}" → "${got}" via ${gotStrat ?? '—'}`);
    } else {
      fail++;
      console.log(`  ✗ "${aiName}"`);
      console.log(`      expected: "${expected}" via ${expectedStrat ?? 'any'}`);
      console.log(`      got:      "${got}" via ${gotStrat ?? '—'}`);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
