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

/** Get current time in IST (UTC+5:30) — Railway runs in UTC */
function nowIST(): Date {
  const now = new Date();
  return new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
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

/** Get the shift date (9am–9am window) in IST */
function getShiftDate(): string {
  const ist = nowIST();
  if (ist.getUTCHours() < 9) {
    ist.setUTCDate(ist.getUTCDate() - 1);
  }
  return ist.toISOString().split('T')[0];
}

/** Format hour to 12hr AM/PM */
function formatHour(hour24: number): string {
  const h = hour24 % 12 || 12;
  const ampm = hour24 < 12 ? 'AM' : 'PM';
  return `${h}:00 ${ampm}`;
}

/** Get the PREVIOUS hourly time window using IST hours.
 *  Bot fires during hour H asking about production in hour H-1.
 *  e.g. at 9:26 PM → window is 8:00 PM – 9:00 PM */
function getTimeWindow(): { timeFrom: string; timeTo: string; labelFrom: string; labelTo: string } {
  const ist = nowIST();
  const currentHour = ist.getUTCHours();
  const fromHour = (currentHour - 1 + 24) % 24;
  const toHour = currentHour;
  const from = `${String(fromHour).padStart(2, '0')}:00`;
  const to = `${String(toHour).padStart(2, '0')}:00`;
  return { timeFrom: from, timeTo: to, labelFrom: formatHour(fromHour), labelTo: formatHour(toHour) };
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
  const ist = nowIST();
  const serverTime = `${String(ist.getUTCHours() % 12 || 12).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')} ${ist.getUTCHours() >= 12 ? 'PM' : 'AM'}`;
  const lines = [
    `*Period:* ${labelFrom} – ${labelTo}`,
    `*Saved at:* ${serverTime} (Server IST)`,
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
  const ist = nowIST();
  const bags = data.bags || 0;

  const weightPerBag = 50; // kg — standard DDGS bag weight
  const totalProduction = (bags * weightPerBag) / 1000; // convert to Ton

  const shiftDate = getShiftDate();
  const { timeFrom, timeTo } = getTimeWindow();
  const hh = ist.getUTCHours();
  const mm = ist.getUTCMinutes();
  const ampm = hh >= 12 ? 'pm' : 'am';
  const entryTime = `${String(hh % 12 || 12).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${ampm}`;

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
  privateOnly: false,
};

export default ddgsConfig;
