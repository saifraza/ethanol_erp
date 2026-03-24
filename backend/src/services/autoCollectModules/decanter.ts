/**
 * Decanter Auto-Collection Module
 *
 * Asks for Feed readings by dryer group:
 *   Dryer 1: D1, D2, D3
 *   Dryer 2: D4, D5
 *   Dryer 3: D6, D7, D8
 *
 * Operator replies with plain numbers (comma or space separated).
 * Fewer numbers = some decanters not running (mapped in order).
 */

import prisma from '../../config/prisma';
import { ModuleConfig, CollectStep } from './types';

const STEPS: CollectStep[] = [
  {
    key: 'dryer1',
    label: 'Dryer 1',
    fields: ['d1', 'd2', 'd3'],
    fieldLabels: ['D1', 'D2', 'D3'],
    subFields: ['Feed'],
  },
  {
    key: 'dryer2',
    label: 'Dryer 2',
    fields: ['d4', 'd5'],
    fieldLabels: ['D4', 'D5'],
    subFields: ['Feed'],
  },
  {
    key: 'dryer3',
    label: 'Dryer 3',
    fields: ['d6', 'd7', 'd8'],
    fieldLabels: ['D6', 'D7', 'D8'],
    subFields: ['Feed'],
  },
];

function buildPrompt(step: CollectStep): string {
  const nums = step.fieldLabels.join(', ');
  const example = step.fields.map((_, i) => (12 + i * 0.5).toFixed(1)).join(', ');
  return `*${step.label} (${nums})*\nReply: ${example}`;
}

function parseReply(text: string, step: CollectStep): Record<string, number> | null {
  // Extract all numbers from the reply
  const nums = text.split(/[,\s\n]+/).map(v => parseFloat(v.trim())).filter(v => !isNaN(v) && v >= 0);

  if (nums.length === 0) return null;
  // Accept partial — fewer numbers means some decanters not running
  if (nums.length > step.fields.length) return null;

  const data: Record<string, number> = {};
  nums.forEach((val, i) => {
    data[`${step.fields[i]}Feed`] = val;
  });
  return data;
}

function buildConfirmation(step: CollectStep, parsed: Record<string, number>): string {
  return step.fields
    .filter(f => parsed[`${f}Feed`] != null)
    .map((f, i) => `${step.fieldLabels[step.fields.indexOf(f)]}: ${parsed[`${f}Feed`]}`)
    .join(' | ');
}

function buildSummary(data: Record<string, number>): string {
  const lines: string[] = [];
  let total = 0;
  for (const step of STEPS) {
    let dryerTotal = 0;
    const vals = step.fields
      .filter(f => data[`${f}Feed`] != null)
      .map(f => {
        const v = data[`${f}Feed`] || 0;
        dryerTotal += v;
        return `${f.toUpperCase()}: ${v}`;
      });
    if (vals.length > 0) {
      lines.push(`*${step.label}:* ${vals.join(', ')} = *${dryerTotal.toFixed(2)}*`);
      total += dryerTotal;
    }
  }
  lines.push(`\n*Total Feed: ${total.toFixed(2)}*`);
  return lines.join('\n');
}

function buildErrorHint(step: CollectStep): string {
  const example = step.fields.map((_, i) => (12 + i * 0.5).toFixed(1)).join(', ');
  return `Just send numbers: ${example}`;
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
