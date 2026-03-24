/**
 * ═══════════════════════════════════════════════════════════
 * AUTO-COLLECT MODULE TEMPLATE
 * ═══════════════════════════════════════════════════════════
 *
 * Copy this file and rename to your module (e.g. evaporation.ts).
 * Then register it in ./index.ts.
 *
 * HOW IT WORKS:
 * 1. Bot sends a WhatsApp message asking for readings (buildPrompt)
 * 2. Operator replies with values
 * 3. Bot parses the reply (parseReply) → shows confirmation (buildConfirmation)
 * 4. If multiple steps, bot asks next step
 * 5. After all steps done → saves to DB (saveData) → shares summary (buildSummary)
 *
 * STEPS:
 * - If your module has many fields, split them into groups (steps)
 * - Each step asks for one group of fields
 * - Example: Decanter has 3 steps (Dryer 1, 2, 3)
 * - Simple modules can have just 1 step
 *
 * FIELDS:
 * - `fields` = row identifiers (e.g. ['d1', 'd2', 'd3'] for decanters)
 * - `subFields` = column values per row (e.g. ['Feed', 'WetCake', 'ThinSlopGr'])
 * - DB key = field + subField → 'd1Feed', 'd1WetCake', 'd1ThinSlopGr'
 *
 * PARSER:
 * - Supports labeled format: "D1: 12.5, 35, 1.025"
 * - Supports unlabeled format (one line per field, values separated by comma/space)
 * - Return null if reply can't be parsed → bot will re-ask
 *
 * REGISTRATION:
 * After creating your module file, add it to ./index.ts:
 *   import myModule from './myModule';
 *   export const MODULE_REGISTRY: Record<string, ModuleConfig> = {
 *     decanter: decanterConfig,
 *     myModule: myModule,   // ← add here
 *   };
 * ═══════════════════════════════════════════════════════════
 */

import prisma from '../../config/prisma';
import { ModuleConfig, CollectStep } from './types';

// ── Define your collection steps ──
const STEPS: CollectStep[] = [
  {
    key: 'step1',                          // unique step ID
    label: 'Section A (Item 1, Item 2)',   // shown in WhatsApp message header
    fields: ['item1', 'item2'],            // field prefixes → become DB column prefixes
    fieldLabels: ['Item 1', 'Item 2'],     // human-readable labels for WhatsApp
    subFields: ['Value1', 'Value2'],       // sub-fields per item → item1Value1, item1Value2
  },
  // Add more steps if needed...
];

// ── Build the question message ──
function buildPrompt(step: CollectStep): string {
  const example = step.fieldLabels.map(l =>
    `${l}: 10.5, 20.3`
  ).join('\n');

  return [
    `📊 *Your Module — ${step.label}*`,
    '',
    `Enter ${step.subFields.join(', ')} for each:`,
    '',
    ...step.fieldLabels.map(l => `${l}: ___, ___`),
    '',
    `Example:`,
    example,
  ].join('\n');
}

// ── Parse the operator's reply ──
function parseReply(text: string, step: CollectStep): Record<string, number> | null {
  const data: Record<string, number> = {};
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);

  // Try labeled: "Item 1: 10.5, 20.3"
  let parsed = 0;
  for (let idx = 0; idx < step.fields.length; idx++) {
    const label = step.fieldLabels[idx];
    const regex = new RegExp(`^${label}\\s*[:=\\-]?\\s*(.+)`, 'i');
    for (const line of lines) {
      const match = line.match(regex);
      if (match) {
        const vals = match[1].split(/[,\s]+/).map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
        if (vals.length >= step.subFields.length) {
          step.subFields.forEach((sf, si) => { data[`${step.fields[idx]}${sf}`] = vals[si]; });
          parsed++;
        }
        break;
      }
    }
  }
  if (parsed === step.fields.length) return data;

  // Fallback: unlabeled lines
  if (lines.length >= step.fields.length) {
    const fallback: Record<string, number> = {};
    let ok = true;
    for (let i = 0; i < step.fields.length; i++) {
      const cleaned = lines[i].replace(/^\w+\s*[:=\-]?\s*/, '');
      const vals = cleaned.split(/[,\s]+/).map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
      if (vals.length >= step.subFields.length) {
        step.subFields.forEach((sf, si) => { fallback[`${step.fields[i]}${sf}`] = vals[si]; });
      } else { ok = false; break; }
    }
    if (ok) return fallback;
  }

  return null;
}

// ── Confirmation after parsing a step ──
function buildConfirmation(step: CollectStep, parsed: Record<string, number>): string {
  return step.fields.map((f, i) => {
    const vals = step.subFields.map(sf => `${sf} ${parsed[`${f}${sf}`] ?? '-'}`);
    return `${step.fieldLabels[i]}: ${vals.join(' | ')}`;
  }).join('\n');
}

// ── Final summary after all steps ──
function buildSummary(data: Record<string, number>): string {
  return STEPS.flatMap(s => s.fields).map(f => {
    const vals = STEPS[0].subFields.map(sf => data[`${f}${sf}`]);
    if (vals.every(v => v == null)) return null;
    return `${f.toUpperCase()}: ${vals.map((v, i) => `${STEPS[0].subFields[i]} ${v ?? '-'}`).join(' | ')}`;
  }).filter(Boolean).join('\n');
}

// ── Error hint when parse fails ──
function buildErrorHint(step: CollectStep): string {
  return step.fieldLabels.map(l => `${l}: ${step.subFields.join(', ')}`).join('\n')
    + `\n\nExample: ${step.fieldLabels[0]}: 10.5, 20.3`;
}

// ── Save to database ──
async function saveData(data: Record<string, number>): Promise<void> {
  const now = new Date();
  // Change 'yourModel' to your Prisma model name
  // await prisma.yourModel.create({
  //   data: {
  //     date: now,
  //     entryTime: now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
  //     remark: 'Auto-collected via WhatsApp',
  //     userId: 'system',
  //     ...data,
  //   },
  // });
  console.log('[AutoCollect:template] Would save', Object.keys(data).length, 'fields');
}

// ── Export ──
const templateConfig: ModuleConfig = {
  module: 'template',          // change to your module name
  displayName: 'Template',    // change to display name
  steps: STEPS,
  buildPrompt,
  parseReply,
  buildConfirmation,
  buildSummary,
  buildErrorHint,
  saveData,
};

export default templateConfig;
