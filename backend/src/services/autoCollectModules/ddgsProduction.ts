/**
 * DDGS Production Auto-Collection Module
 *
 * Single-step: asks operator for number of bags in the last hour.
 * Auto-calculates: totalProduction = bags × weightPerBag (default 50 kg = 0.05 Ton)
 * Saves to DDGSProductionEntry with timeFrom/timeTo based on current hour.
 */

import prisma from '../../config/prisma';
import { ModuleConfig, CollectStep } from './types';

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
  // If before 9am, shift belongs to previous day
  const shifted = new Date(now);
  if (shifted.getHours() < 9) {
    shifted.setDate(shifted.getDate() - 1);
  }
  return shifted.toISOString().split('T')[0];
}

/** Get the hourly time window (e.g., "08:00" to "09:00") */
function getTimeWindow(): { timeFrom: string; timeTo: string } {
  const now = new Date();
  const hour = now.getHours();
  const from = `${String(hour).padStart(2, '0')}:00`;
  const toHour = (hour + 1) % 24;
  const to = `${String(toHour).padStart(2, '0')}:00`;
  return { timeFrom: from, timeTo: to };
}

function buildPrompt(_step: CollectStep): string {
  const { timeFrom, timeTo } = getTimeWindow();
  return `📦 *DDGS Production (${timeFrom}–${timeTo})*\n\nHow many bags packed?\nReply with a number (e.g. 300)`;
}

function parseReply(text: string, _step: CollectStep): Record<string, number> | null {
  // Extract a single number from the reply
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
  const { timeFrom, timeTo } = getTimeWindow();
  const lines = [
    `*Period:* ${timeFrom} – ${timeTo}`,
    `*Bags:* ${bags}`,
    `*Weight/Bag:* ${weightPerBag} kg`,
    `*Production:* ${totalKg.toFixed(0)} kg (${totalTon.toFixed(3)} Ton)`,
  ];
  return lines.join('\n');
}

function buildErrorHint(_step: CollectStep): string {
  return `Just send the number of bags, e.g: 300`;
}

async function saveData(data: Record<string, number>): Promise<void> {
  const now = new Date();
  const bags = data.bags || 0;

  // Get weight per bag from settings or default to 50 kg
  const settings = await prisma.settings.findFirst();
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

  console.log(`[AutoCollect:ddgs] Saved ${bags} bags = ${totalProduction.toFixed(3)} Ton for ${timeFrom}–${timeTo}`);
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
