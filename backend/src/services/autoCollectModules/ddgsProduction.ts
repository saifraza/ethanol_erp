/**
 * DDGS Production Auto-Collection Module
 *
 * Single-step: asks operator for number of bags in the last hour.
 * Prompt language: Hindi (default) or English, configurable via schedule.
 * Auto-calculates: totalProduction = bags × weightPerBag (default 50 kg = 0.05 Ton)
 * Saves to DDGSProductionEntry with timeFrom/timeTo based on current hour.
 * After saving, replies with daily totals (bags + tons since morning).
 */

import prisma from '../../config/prisma';
import { ModuleConfig, CollectStep } from './types';

/** Language preference — updated by schedule loader */
let promptLang: 'hi' | 'en' = 'hi';

/** Called by schedule loader to update language from config */
export function setDdgsLanguage(lang: string): void {
  promptLang = lang === 'en' ? 'en' : 'hi';
}

const STEPS: CollectStep[] = [
  {
    key: 'bags',
    label: 'DDGS Bags',
    fields: ['bags'],
    fieldLabels: ['Bags'],
    subFields: [''],
  },
];

/** Get the shift date (9am–9am window) */
function getShiftDate(): string {
  const now = new Date();
  const shifted = new Date(now);
  if (shifted.getHours() < 9) {
    shifted.setDate(shifted.getDate() - 1);
  }
  return shifted.toISOString().split('T')[0];
}

/** Format hour to 12hr AM/PM */
function formatHour(hour24: number): string {
  const h = hour24 % 12 || 12;
  const ampm = hour24 < 12 ? 'AM' : 'PM';
  return `${h}:00 ${ampm}`;
}

/** Get the hourly time window in 24hr for DB, plus AM/PM labels */
function getTimeWindow(): { timeFrom: string; timeTo: string; labelFrom: string; labelTo: string } {
  const now = new Date();
  const hour = now.getHours();
  const from = `${String(hour).padStart(2, '0')}:00`;
  const toHour = (hour + 1) % 24;
  const to = `${String(toHour).padStart(2, '0')}:00`;
  return { timeFrom: from, timeTo: to, labelFrom: formatHour(hour), labelTo: formatHour(toHour) };
}

function buildPrompt(_step: CollectStep): string {
  const { labelFrom, labelTo } = getTimeWindow();
  if (promptLang === 'en') {
    return `📦 *DDGS Production (${labelFrom} – ${labelTo})*\n\nHow many bags packed?\nReply with a number (e.g. 300)`;
  }
  return `📦 *DDGS Production (${labelFrom} – ${labelTo})*\n\nकितने बैग भरे?\nसिर्फ नंबर भेजें (जैसे 300)`;
}

function parseReply(text: string, _step: CollectStep): Record<string, number> | null {
  const cleaned = text.trim().replace(/[,\s]+/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num) || num < 0) return null;
  return { bags: num };
}

function buildConfirmation(_step: CollectStep, parsed: Record<string, number>): string {
  const bags = parsed.bags || 0;
  return `${bags} bags`;
}

function buildSummary(data: Record<string, number>): string {
  const bags = data.bags || 0;
  const weightPerBag = 50; // kg
  const totalKg = bags * weightPerBag;
  const totalTon = totalKg / 1000;
  const { labelFrom, labelTo } = getTimeWindow();
  const lines = [
    `*Period:* ${labelFrom} – ${labelTo}`,
    `*Bags:* ${bags}`,
    `*Weight/Bag:* ${weightPerBag} kg`,
    `*Production:* ${totalKg.toFixed(0)} kg (${totalTon.toFixed(3)} Ton)`,
  ];

  // Daily totals appended by saveData
  if (data._dailyTotalBags != null) {
    const dtBags = data._dailyTotalBags;
    const dtTon = data._dailyTotalTon || 0;
    lines.push('');
    lines.push(`📊 *Today Total:* ${dtBags} bags = ${dtTon.toFixed(3)} Ton`);
  }

  return lines.join('\n');
}

function buildErrorHint(_step: CollectStep): string {
  if (promptLang === 'en') {
    return `Just send the number of bags, e.g: 300`;
  }
  return `सिर्फ नंबर भेजें, जैसे: 300`;
}

async function saveData(data: Record<string, number>): Promise<void> {
  const now = new Date();
  const bags = data.bags || 0;

  const weightPerBag = 50; // kg — standard DDGS bag weight
  const totalProduction = (bags * weightPerBag) / 1000; // convert to Ton

  const shiftDate = getShiftDate();
  const { timeFrom, timeTo } = getTimeWindow();
  const entryTime = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

  await prisma.dDGSProductionEntry.create({
    data: {
      date: now,
      shiftDate,
      entryTime,
      timeFrom,
      timeTo,
      bags,
      weightPerBag,
      totalProduction,
      remark: 'Auto-collected via WhatsApp',
      userId: 'system',
    },
  });

  // Calculate daily totals (all entries for this shift date)
  const dailyEntries = await prisma.dDGSProductionEntry.findMany({
    where: { shiftDate },
    select: { bags: true, totalProduction: true },
  });
  const totalBags = dailyEntries.reduce((sum: number, e: { bags: number | null }) => sum + (e.bags || 0), 0);
  const totalTon = dailyEntries.reduce((sum: number, e: { totalProduction: number | null }) => sum + (e.totalProduction || 0), 0);

  // Store daily totals in data so buildSummary can use them
  data._dailyTotalBags = totalBags;
  data._dailyTotalTon = totalTon;

  console.log(`[AutoCollect:ddgs] Saved ${bags} bags = ${totalProduction.toFixed(3)} Ton for ${timeFrom}–${timeTo}. Day total: ${totalBags} bags = ${totalTon.toFixed(3)} Ton`);
}

const ddgsConfig: ModuleConfig = {
  module: 'ddgs',
  displayName: 'DDGS Production',
  steps: STEPS,
  buildPrompt,
  parseReply,
  buildConfirmation,
  buildSummary,
  buildErrorHint,
  saveData,
};

export default ddgsConfig;
