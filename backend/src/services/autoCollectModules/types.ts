/**
 * Auto-Collect Module Types
 *
 * Each module that supports WhatsApp auto-collection must implement ModuleConfig.
 * See _template.ts for a starter template.
 */

/** One step in a multi-step collection conversation */
export interface CollectStep {
  key: string;            // unique step ID, e.g. 'dryer1'
  label: string;          // display label, e.g. 'Dryer 1 (D1, D2, D3)'
  fields: string[];       // field prefixes, e.g. ['d1', 'd2', 'd3']
  fieldLabels: string[];  // human labels, e.g. ['D1', 'D2', 'D3']
  subFields: string[];    // sub-field names, e.g. ['Feed', 'WetCake', 'ThinSlopGr']
}

/** Full module configuration for auto-collection */
export interface ModuleConfig {
  /** Module identifier (must match whatsapp routing module name) */
  module: string;

  /** Display name for UI */
  displayName: string;

  /** Collection steps — bot asks one step at a time */
  steps: CollectStep[];

  /** Build the WhatsApp prompt message for a step */
  buildPrompt: (step: CollectStep) => string;

  /** Parse operator's reply into field→value map. Return null if unparseable. */
  parseReply: (text: string, step: CollectStep) => Record<string, number> | null;

  /** Build confirmation text after a step is parsed */
  buildConfirmation: (step: CollectStep, parsed: Record<string, number>) => string;

  /** Build final summary after all steps complete */
  buildSummary: (data: Record<string, number>) => string;

  /** Build error hint when parsing fails */
  buildErrorHint: (step: CollectStep) => string;

  /** Save collected data to the database */
  saveData: (data: Record<string, number>) => Promise<void>;
}
