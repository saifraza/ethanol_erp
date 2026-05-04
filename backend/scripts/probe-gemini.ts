/**
 * Minimal Gemini API probe — sends a 1-token prompt to whatever model is
 * configured. Surfaces the exact HTTP status + Gemini error body so you can
 * tell instantly if it's the model name, the key, or something else.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/probe-gemini.ts                                 # uses GEMINI_MODEL or default
 *   GEMINI_MODEL=gemini-2.5-pro npx tsx scripts/probe-gemini.ts     # try a specific model
 */

import 'dotenv/config';
import axios from 'axios';

async function probe(model: string) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error('❌ GEMINI_API_KEY not set in backend/.env');
    process.exit(1);
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  console.log(`\n→ POST ${url}`);
  console.log(`  header: x-goog-api-key=<set, len=${key.length}>`);

  const t0 = Date.now();
  try {
    const res = await axios.post(
      url,
      { contents: [{ parts: [{ text: 'Reply with exactly the word: OK' }] }], generationConfig: { temperature: 0 } },
      { timeout: 30000, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key } },
    );
    const ms = Date.now() - t0;
    const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log(`✅ ${model}: HTTP ${res.status} in ${ms}ms — reply: "${text.trim().slice(0, 50)}"`);
    return true;
  } catch (err) {
    const ms = Date.now() - t0;
    const status = (err as { response?: { status?: number; data?: unknown } }).response?.status;
    const body = (err as { response?: { data?: unknown } }).response?.data;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`❌ ${model}: HTTP ${status ?? 'no-response'} in ${ms}ms`);
    console.log(`   error: ${msg}`);
    if (body) console.log(`   body:  ${JSON.stringify(body).slice(0, 600)}`);
    return false;
  }
}

async function main() {
  const candidates = process.argv[2]
    ? [process.argv[2]]
    : ['gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'];
  for (const m of candidates) {
    await probe(m);
  }
}

main();
