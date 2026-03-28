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
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const hh = ist.getUTCHours();
  const mm = ist.getUTCMinutes();
  const timeStr = `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh >= 12 ? 'PM' : 'AM'}`;
  return `🔧 *${step.label}* — ${timeStr}\n\nDecanters: *${nums}*\nSend feed readings (comma separated)\n\nExample: \`${example}\`\n\n_Send fewer numbers if some decanters are off_\n_Type /cancel to stop_`;
}

function parseReply(text: string, step: CollectStep): Record<string, number> | null {
  // Extract all numbers from the reply
  const nums = text.split(/[,\s\n]+/).map(v => parseFloat(v.trim())).filter(v => !isNaN(v) && v >= 0);

  if (nums.length === 0) return null;
  // Accept partial — fewer numbers means some decanters not running
  if (nums.length > step.fields.length) return null;

  // Validate range: feed values should be 0-50 (realistic range)
  if (nums.some(v => v > 50)) return null;

  const data: Record<string, number> = {};
  nums.forEach((val, i) => {
    data[`${step.fields[i]}Feed`] = val;
  });
  return data;
}

function buildConfirmation(step: CollectStep, parsed: Record<string, number>): string {
  const items = step.fields
    .filter(f => parsed[`${f}Feed`] != null)
    .map(f => `${step.fieldLabels[step.fields.indexOf(f)]}: *${parsed[`${f}Feed`]}*`);
  const total = step.fields.reduce((sum, f) => sum + (parsed[`${f}Feed`] || 0), 0);
  return items.join(' | ') + ` (Total: *${total.toFixed(1)}*)`;
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
  return `Just send numbers (0-50 range): \`${example}\``;
}

async function saveData(data: Record<string, number>): Promise<void> {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const hh = ist.getUTCHours();
  const mm = ist.getUTCMinutes();
  const entryTime = `${String(hh % 12 || 12).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${hh >= 12 ? 'pm' : 'am'}`;
  const entry: Record<string, string | number | Date | null> = {
    date: now,
    entryTime,
    remark: 'Auto-collected via Telegram',
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
