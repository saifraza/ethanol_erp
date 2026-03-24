/**
 * Decanter Auto-Collection Module
 *
 * Collects D1–D8 Feed readings by dryer group:
 *   Dryer 1: D1, D2, D3
 *   Dryer 2: D4, D5
 *   Dryer 3: D6, D7, D8
 *
 * Only Feed (flow) is collected from field operators.
 * WetCake and ThinSlopGr are lab values entered from the ERP.
 */

import prisma from '../../config/prisma';
import { ModuleConfig, CollectStep } from './types';

const STEPS: CollectStep[] = [
  {
    key: 'dryer1',
    label: 'Dryer 1 (D1, D2, D3)',
    fields: ['d1', 'd2', 'd3'],
    fieldLabels: ['D1', 'D2', 'D3'],
    subFields: ['Feed'],
  },
  {
    key: 'dryer2',
    label: 'Dryer 2 (D4, D5)',
    fields: ['d4', 'd5'],
    fieldLabels: ['D4', 'D5'],
    subFields: ['Feed'],
  },
  {
    key: 'dryer3',
    label: 'Dryer 3 (D6, D7, D8)',
    fields: ['d6', 'd7', 'd8'],
    fieldLabels: ['D6', 'D7', 'D8'],
    subFields: ['Feed'],
  },
];

function buildPrompt(step: CollectStep): string {
  return [
    `📊 *Decanter Feed — ${step.label}*`,
    '',
    `Enter feed for each decanter:`,
    '',
    ...step.fieldLabels.map(l => `${l}: ___`),
    '',
    `Example:`,
    ...step.fieldLabels.map((l, i) => `${l}: ${(12 + i * 0.5).toFixed(1)}`),
  ].join('\n');
}

function parseReply(text: string, step: CollectStep): Record<string, number> | null {
  const data: Record<string, number> = {};
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);

  // Try labeled format: "D1: 12.5" or "D1 12.5"
  let parsed = 0;
  for (let idx = 0; idx < step.fields.length; idx++) {
    const field = step.fields[idx];
    const label = step.fieldLabels[idx];
    const regex = new RegExp(`^${label}\\s*[:=\\-]?\\s*([\\d.]+)`, 'i');
    for (const line of lines) {
      const match = line.match(regex);
      if (match) {
        const val = parseFloat(match[1]);
        if (!isNaN(val)) {
          data[`${field}Feed`] = val;
          parsed++;
        }
        break;
      }
    }
  }
  if (parsed === step.fields.length) return data;

  // Fallback: just numbers, one per line or comma/space separated
  const allNums = text.split(/[,\s\n]+/).map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
  if (allNums.length >= step.fields.length) {
    const fallback: Record<string, number> = {};
    step.fields.forEach((f, i) => { fallback[`${f}Feed`] = allNums[i]; });
    return fallback;
  }

  return null;
}

function buildConfirmation(step: CollectStep, parsed: Record<string, number>): string {
  return step.fields.map((f, i) => {
    const val = parsed[`${f}Feed`] ?? '-';
    return `${step.fieldLabels[i]}: ${val}`;
  }).join('\n');
}

function buildSummary(data: Record<string, number>): string {
  const allFields = STEPS.flatMap(s => s.fields);
  const lines: string[] = [];
  let total = 0;
  for (const f of allFields) {
    const val = data[`${f}Feed`];
    if (val != null) {
      lines.push(`${f.toUpperCase()}: ${val}`);
      total += val;
    }
  }
  lines.push(`*Total Feed: ${total.toFixed(2)}*`);
  return lines.join('\n');
}

function buildErrorHint(step: CollectStep): string {
  return [
    `Send one number per decanter:`,
    '',
    ...step.fieldLabels.map(l => `${l}: 12.5`),
    '',
    `Or just send the numbers:`,
    step.fieldLabels.map((_, i) => (12 + i * 0.5).toFixed(1)).join(', '),
  ].join('\n');
}

async function saveData(data: Record<string, number>): Promise<void> {
  const now = new Date();
  const entry: Record<string, string | number | Date | null> = {
    date: now,
    entryTime: now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
    remark: 'Auto-collected via WhatsApp',
    userId: 'system',
  };
  for (const [key, val] of Object.entries(data)) {
    entry[key] = val;
  }
  // Dynamic fields from auto-collection — keys match schema columns exactly
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma.decanterEntry.create as Function)({ data: entry });
  console.log('[AutoCollect:decanter] Saved with', Object.keys(data).length, 'fields');
}

const decanterConfig: ModuleConfig = {
  module: 'decanter',
  displayName: 'Decanter',
  steps: STEPS,
  buildPrompt,
  parseReply,
  buildConfirmation,
  buildSummary,
  buildErrorHint,
  saveData,
};

export default decanterConfig;
