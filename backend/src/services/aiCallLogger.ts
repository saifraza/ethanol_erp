/**
 * AI call audit logger.
 *
 * Every call to an AI provider (Gemini today, future OpenAI/Anthropic) should
 * call `logAiCall()` so the Settings → AI Usage page can show per-feature cost
 * + token usage + failure rate. Append-only.
 *
 * Calls are logged best-effort — a failed log never breaks the caller's flow.
 */
import prisma from '../config/prisma';

export interface LogAiCallInput {
  feature: string;                              // e.g. "rfq-extraction"
  provider?: 'gemini' | 'openai' | 'anthropic'; // default 'gemini'
  model: string;                                // e.g. "gemini-3-flash-preview"
  userId?: string | null;
  contextRef?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  durationMs: number;
  success: boolean;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}

// Approximate per-1M-token pricing in USD as of 2026-05.
// Update when model pricing changes — this is the only place to touch.
const PRICING: Record<string, { input: number; output: number }> = {
  'gemini-3-flash-preview':  { input: 0.075, output: 0.30 },   // same tier as 2.5 Flash
  'gemini-2.5-flash':        { input: 0.075, output: 0.30 },
  'gemini-2.5-pro':          { input: 1.25,  output: 5.00 },
  'gemini-2.5-flash-lite':   { input: 0.0375, output: 0.15 },
  'gemini-3-pro':            { input: 1.25,  output: 5.00 },   // placeholder until GA pricing
};
const FALLBACK_PRICE = { input: 0.075, output: 0.30 };
const USD_TO_INR = 84;  // refresh occasionally; near-enough for cost dashboards

function estimateCost(model: string, inputTokens: number, outputTokens: number): { usd: number; inr: number } {
  const p = PRICING[model] || FALLBACK_PRICE;
  const usd = (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
  return { usd, inr: usd * USD_TO_INR };
}

export async function logAiCall(input: LogAiCallInput): Promise<void> {
  const inputTokens = input.inputTokens ?? 0;
  const outputTokens = input.outputTokens ?? 0;
  const totalTokens = inputTokens + outputTokens;
  const { usd, inr } = estimateCost(input.model, inputTokens, outputTokens);
  try {
    await prisma.aiCallLog.create({
      data: {
        feature: input.feature,
        provider: input.provider ?? 'gemini',
        model: input.model,
        userId: input.userId ?? null,
        contextRef: input.contextRef ?? null,
        inputTokens,
        outputTokens,
        totalTokens,
        estimatedCostUsd: usd,
        estimatedCostInr: inr,
        durationMs: input.durationMs,
        success: input.success,
        errorMessage: input.errorMessage ?? null,
        metadata: (input.metadata ?? {}) as object,
      },
    });
  } catch (err) {
    // Logging is best-effort. Never break the caller because the audit
    // table is missing or write failed. Surface to console for ops.
    console.warn('[aiCallLogger] failed to log AI call:', err instanceof Error ? err.message : err);
  }
}
