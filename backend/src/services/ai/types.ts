/**
 * Shared types for the unified AI services layer.
 *
 * Every AI-touched feature in the ERP MUST register here so we have:
 * - one place to view all AI surface area
 * - per-feature on/off toggle
 * - per-feature usage stats
 * - consistent provider routing
 */

export type AIFeatureKind =
  | 'CHAT_TOOL'        // chat assistant tool (e.g. get_fuel_grns)
  | 'DOC_CLASSIFIER'   // single-file classifier (Smart Upload)
  | 'DOC_EXTRACTOR'    // structured extraction from a known doc type
  | 'DOC_VERIFIER';    // cross-check extracted data vs DB

export type AIProvider = 'gemini' | 'anthropic' | 'openai';

export interface AIToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date';
  description: string;
  required?: boolean;
}

/**
 * Each entry is the manifest for ONE AI capability. The runtime catalog
 * (registry.ts) is built from these entries.
 */
export interface AIFeature {
  id: string;                           // unique key, e.g. "chat.tool.fuel_inflow"
  kind: AIFeatureKind;
  module: string;                       // grouping: "procurement" | "production" | "accounts" | "documents"
  title: string;                        // human-readable
  description: string;                  // what this does (also used as LLM tool description)
  parameters?: AIToolParameter[];       // for CHAT_TOOL kind
  examplePrompt?: string;               // for the admin UI / docs

  // Provider hints — most features can use any provider; some need a specific one.
  preferredProvider?: AIProvider;

  // Lazy-loaded executor. Returning JSON-serializable data.
  // For CHAT_TOOL: receives args from LLM, returns data the LLM will then use to answer.
  // For DOC_*: receives { fileBuffer, mimeType, ... } and returns structured output.
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface AIToolCallResult {
  toolId: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs: number;
}

export interface AIChatTurn {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: AIToolCallResult[];
}
