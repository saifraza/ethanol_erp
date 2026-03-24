/**
 * Decanter Auto-Collection Module
 *
 * Collects D1–D8 readings by dryer group:
 *   Dryer 1: D1, D2, D3
 *   Dryer 2: D4, D5
 *   Dryer 3: D6, D7, D8
 *
 * Each decanter has 3 sub-fields: Feed, WetCake, ThinSlopGr
 */

import prisma from '../../config/prisma';
import { ModuleConfig, CollectStep } from './types';

const STEPS: CollectStep[] = [
  {
    key: 'dryer1',
    label: 'Dryer 1 (D1, D2, D3)',
    fields: ['d1', 'd2', 'd3'],
    fieldLabels: ['D1', 'D2', 'D3'],
    subFields: ['Feed', 'WetCake', 'ThinSlopGr'],
  },
  {
    key: 'dryer2',
    label: 'Dryer 2 (D4, D5)',
    fields: ['d4', 'd5'],
    fieldLabels: ['D4', 'D5'],
    subFields: ['Feed', 'WetCake', 'ThinSlopGr'],
  },
  {
    key: 'dryer3',
    label: 'Dryer 3 (D6, D7, D8)',
    fields: ['d6', 'd7', 'd8'],
    fieldLabels: ['D6', 'D7', 'D8'],
    subFields: ['Feed', 'WetCake', 'ThinSlopGr'],
  },
];

function buildPrompt(step: CollectStep): string {
  const example = step.fields.map((_f, i) =>
    `${step.fieldLabels[i]}: 12.5, 35, 1.025`
  ).join('\n');

  return [
    `📊 *Decanter Reading — ${step.label}*`,
    '',
    `Enter ${step.subFields.join(', ')} for each:`,
    '',
    ...step.fieldLabels.map(l => `${l}: ___, ___, ___`),
    '',
    `Example:`,
    example,
  ].join('\n');
}

function parseReply(text: string, step: CollectStep): Record<string, number> | null {
  const data: Record<string, number> = {};
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);

  // Try labeled format: "D1: 12.5, 35, 1.025"
  let parsed = 0;
  for (let idx = 0; idx < step.fields.length; idx++) {
    const field = step.fields[idx];
    const label = step.fieldLabels[idx];
    const regex = new RegExp(`^${label}\\s*[:=\\-]?\\s*(.+)`, 'i');
    for (const line of lines) {
      const match = line.match(regex);
      if (match) {
        const vals = match[1].split(/[,\s]+/).map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
        if (vals.length >= step.subFields.length) {
          step.subFields.forEach((sf, si) => { data[`${field}${sf}`] = vals[si]; });
          parsed++;
        }
        break;
      }
    }
  }
  if (parsed === step.fields.length) return data;

  // Fallback: unlabeled — one line per field, N numbers each
  if (lines.length >= step.fields.length) {
    const fallback: Record<string, number> = {};
    let ok = true;
    for (let i = 0; i < step.fields.length; i++) {
      const cleaned = lines[i].replace(/^[dD]\d\s*[:=\-]?\s*/, '');
      const vals = cleaned.split(/[,\s]+/).map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
      if (vals.length >= step.subFields.length) {
        step.subFields.forEach((sf, si) => { fallback[`${step.fields[i]}${sf}`] = vals[si]; });
      } else { ok = false; break; }
    }
    if (ok) return fallback;
  }

  return null;
}

function buildConfirmation(step: CollectStep, parsed: Record<string, number>): string {
  return step.fields.map((f, i) => {
    const vals = step.subFields.map(sf => parsed[`${f}${sf}`] ?? '-');
    return `${step.fieldLabels[i]}: ${step.subFields.map((sf, si) => `${sf} ${vals[si]}`).join(' | ')}`;
  }).join('\n');
}

function buildSummary(data: Record<string, number>): string {
  const allFields = STEPS.flatMap(s => s.fields);
  return allFields.map(f => {
    const vals = STEPS[0].subFields.map(sf => data[`${f}${sf}`]);
    if (vals.every(v => v == null)) return null;
    return `${f.toUpperCase()}: ${vals.map((v, i) => `${STEPS[0].subFields[i]} ${v ?? '-'}`).join(' | ')}`;
  }).filter(Boolean).join('\n');
}

function buildErrorHint(step: CollectStep): string {
  return step.fieldLabels.map(l =>
    `${l}: ${step.subFields.join(', ')}`
  ).join('\n') + `\n\nExample: ${step.fieldLabels[0]}: 12.5, 35, 1.025`;
}

async function saveData(data: Record<string, number>): Promise<void> {
  const now = new Date();
  const entry: Record<string, any> = {
    date: now,
    entryTime: now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
    remark: 'Auto-collected via WhatsApp',
    userId: 'system',
  };
  for (const [key, val] of Object.entries(data)) {
    entry[key] = val;
  }
  await prisma.decanterEntry.create({ data: entry });
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
