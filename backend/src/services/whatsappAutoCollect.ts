/**
 * WhatsApp Auto-Collection Service
 *
 * Sends scheduled WhatsApp messages to operators asking for field readings,
 * parses their replies, and saves data to the ERP database.
 *
 * Flow (Decanter example, by dryer group):
 * 1. Bot → "Enter Dryer 1 (D1, D2, D3) readings: Feed, WetCake, ThinSlopGr"
 * 2. Operator → "D1: 12.5, 35, 1.025\nD2: 11.8, 33, 1.030\nD3: 13.0, 36, 1.028"
 * 3. Bot → confirms + asks Dryer 2
 * 4. Repeat until all groups done → save DecanterEntry
 */

import prisma from '../config/prisma';
import { sendWhatsAppMessage, sendToGroup, registerIncomingHandler } from './whatsappBaileys';

// ── Types ──

interface CollectStep {
  key: string;           // e.g. 'dryer1'
  label: string;         // e.g. 'Dryer 1 (D1, D2, D3)'
  fields: string[];      // e.g. ['d1', 'd2', 'd3']
  fieldLabels: string[]; // e.g. ['D1', 'D2', 'D3']
  subFields: string[];   // e.g. ['Feed', 'WetCake', 'ThinSlopGr']
}

interface ModuleConfig {
  module: string;
  steps: CollectStep[];
  buildPrompt: (step: CollectStep) => string;
  parseReply: (text: string, step: CollectStep) => Record<string, number> | null;
  saveData: (data: Record<string, number>) => Promise<void>;
}

interface ActiveSession {
  phone: string;
  module: string;
  stepIndex: number;
  collectedData: Record<string, number>;
  startedAt: Date;
  expiresAt: Date;
}

// ── In-memory session store ──
const activeSessions = new Map<string, ActiveSession>(); // key = phone

// ── Scheduler state ──
let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let lastSendTime: Date | null = null;

// ── Module Configs ──

const DECANTER_STEPS: CollectStep[] = [
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

function buildDecanterPrompt(step: CollectStep): string {
  const example = step.fields.map((f, i) =>
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

function parseDecanterReply(text: string, step: CollectStep): Record<string, number> | null {
  const data: Record<string, number> = {};
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);

  // Try labeled format: "D1: 12.5, 35, 1.025"
  let parsed = 0;
  for (const field of step.fields) {
    const idx = step.fields.indexOf(field);
    const label = step.fieldLabels[idx];
    // Look for line starting with label (case-insensitive)
    const regex = new RegExp(`^${label}\\s*[:=\\-]?\\s*(.+)`, 'i');
    for (const line of lines) {
      const match = line.match(regex);
      if (match) {
        const vals = match[1].split(/[,\s]+/).map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
        if (vals.length >= 3) {
          data[`${field}Feed`] = vals[0];
          data[`${field}WetCake`] = vals[1];
          data[`${field}ThinSlopGr`] = vals[2];
          parsed++;
        }
        break;
      }
    }
  }

  if (parsed === step.fields.length) return data;

  // Fallback: try unlabeled — one line per decanter, 3 numbers each
  if (lines.length >= step.fields.length) {
    const fallbackData: Record<string, number> = {};
    let ok = true;
    for (let i = 0; i < step.fields.length; i++) {
      // Strip optional label prefix
      const cleaned = lines[i].replace(/^[dD]\d\s*[:=\-]?\s*/, '');
      const vals = cleaned.split(/[,\s]+/).map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
      if (vals.length >= 3) {
        fallbackData[`${step.fields[i]}Feed`] = vals[0];
        fallbackData[`${step.fields[i]}WetCake`] = vals[1];
        fallbackData[`${step.fields[i]}ThinSlopGr`] = vals[2];
      } else {
        ok = false;
        break;
      }
    }
    if (ok) return fallbackData;
  }

  return null; // couldn't parse
}

async function saveDecanterData(data: Record<string, number>): Promise<void> {
  const now = new Date();
  const entry: any = {
    date: now,
    entryTime: now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
    remark: 'Auto-collected via WhatsApp',
    userId: 'system',
  };

  // Map collected data to prisma fields
  for (const [key, val] of Object.entries(data)) {
    entry[key] = val;
  }

  await prisma.decanterEntry.create({ data: entry });
  console.log('[AutoCollect] Saved DecanterEntry with', Object.keys(data).length, 'fields');
}

const DECANTER_CONFIG: ModuleConfig = {
  module: 'decanter',
  steps: DECANTER_STEPS,
  buildPrompt: buildDecanterPrompt,
  parseReply: parseDecanterReply,
  saveData: saveDecanterData,
};

// Registry of all auto-collect modules
const MODULE_CONFIGS: Record<string, ModuleConfig> = {
  decanter: DECANTER_CONFIG,
};

// ── Core Logic ──

/**
 * Start a collection session — sends the first question
 */
export async function startCollection(phone: string, moduleName: string): Promise<{ success: boolean; error?: string }> {
  const config = MODULE_CONFIGS[moduleName];
  if (!config) return { success: false, error: `Unknown module: ${moduleName}` };

  // Clean phone
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 10) digits = '91' + digits;

  // Check for existing session
  if (activeSessions.has(digits)) {
    return { success: false, error: `Active session already exists for ${digits}` };
  }

  const session: ActiveSession = {
    phone: digits,
    module: moduleName,
    stepIndex: 0,
    collectedData: {},
    startedAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min timeout
  };

  activeSessions.set(digits, session);

  // Send first question
  const step = config.steps[0];
  const prompt = config.buildPrompt(step);
  const result = await sendWhatsAppMessage(digits, prompt, `auto-collect-${moduleName}`);

  if (!result.success) {
    activeSessions.delete(digits);
    return { success: false, error: result.error };
  }

  console.log(`[AutoCollect] Started ${moduleName} session for ${digits}, step 1/${config.steps.length}`);
  return { success: true };
}

/**
 * Handle incoming message — check if it's a reply to an active session
 */
async function handleIncoming(phone: string, text: string, _name: string | null): Promise<boolean> {
  const session = activeSessions.get(phone);
  if (!session) return false; // not part of any collection

  // Check expiry
  if (new Date() > session.expiresAt) {
    activeSessions.delete(phone);
    await sendWhatsAppMessage(phone, '⏰ Session expired. Data collection cancelled.', `auto-collect-${session.module}`);
    return true;
  }

  // Handle "cancel" command
  if (text.toLowerCase().trim() === 'cancel' || text.toLowerCase().trim() === 'stop') {
    activeSessions.delete(phone);
    await sendWhatsAppMessage(phone, '❌ Data collection cancelled.', `auto-collect-${session.module}`);
    return true;
  }

  const config = MODULE_CONFIGS[session.module];
  if (!config) {
    activeSessions.delete(phone);
    return true;
  }

  const step = config.steps[session.stepIndex];

  // Try to parse the reply
  const parsed = config.parseReply(text, step);

  if (!parsed) {
    // Couldn't parse — ask again
    const hint = step.fieldLabels.map(l => `${l}: Feed, WetCake, ThinSlopGr`).join('\n');
    await sendWhatsAppMessage(
      phone,
      `❌ Couldn't read that. Please send in this format:\n\n${hint}\n\nExample: ${step.fieldLabels[0]}: 12.5, 35, 1.025\n\nType "cancel" to stop.`,
      `auto-collect-${session.module}`
    );
    return true;
  }

  // Merge parsed data
  Object.assign(session.collectedData, parsed);

  // Build confirmation
  const confirm = step.fields.map((f, i) => {
    const feed = parsed[`${f}Feed`];
    const wet = parsed[`${f}WetCake`];
    const thin = parsed[`${f}ThinSlopGr`];
    return `${step.fieldLabels[i]}: Feed ${feed} | WetCake ${wet} | ThinSlop ${thin}`;
  }).join('\n');

  // Move to next step
  session.stepIndex++;

  if (session.stepIndex < config.steps.length) {
    // More steps — send confirmation + next question
    const nextStep = config.steps[session.stepIndex];
    const nextPrompt = config.buildPrompt(nextStep);
    await sendWhatsAppMessage(
      phone,
      `✅ *${step.label} saved!*\n${confirm}\n\n${nextPrompt}`,
      `auto-collect-${session.module}`
    );
    console.log(`[AutoCollect] ${session.module} step ${session.stepIndex}/${config.steps.length} for ${phone}`);
  } else {
    // All done — save to DB
    try {
      await config.saveData(session.collectedData);
      activeSessions.delete(phone);

      // Build final summary
      const allFields = config.steps.flatMap(s => s.fields);
      const summary = allFields.map(f => {
        const feed = session.collectedData[`${f}Feed`];
        const wet = session.collectedData[`${f}WetCake`];
        const thin = session.collectedData[`${f}ThinSlopGr`];
        if (feed == null && wet == null && thin == null) return null;
        return `${f.toUpperCase()}: ${feed ?? '-'} | ${wet ?? '-'} | ${thin ?? '-'}`;
      }).filter(Boolean).join('\n');

      // Confirm to operator
      await sendWhatsAppMessage(
        phone,
        `✅ *All Decanter readings saved!*\n\n${confirm}\n\n📊 *Complete Entry:*\n${summary}\n\n_Saved to ERP at ${new Date().toLocaleTimeString('en-IN')}_`,
        `auto-collect-${session.module}`
      );

      // Share complete report to WhatsApp group/module routing
      try {
        const fullReport = `📊 *Decanter Report* — ${new Date().toLocaleTimeString('en-IN')}\n\n${summary}\n\n_Auto-collected via WhatsApp_`;
        // Use module routing: send via the decanter module's configured channel
        const settings = await prisma.settings.findFirst();
        const groupJid = (settings as any)?.whatsappGroupJid;
        if (groupJid) {
          await sendToGroup(groupJid, fullReport, 'decanter');
        }
      } catch (shareErr) {
        console.error('[AutoCollect] Failed to share report to group:', shareErr);
      }

      console.log(`[AutoCollect] ${session.module} completed for ${phone}`);
    } catch (err: any) {
      activeSessions.delete(phone);
      await sendWhatsAppMessage(
        phone,
        `❌ Failed to save: ${err.message}. Please enter manually in the ERP.`,
        `auto-collect-${session.module}`
      );
      console.error('[AutoCollect] Save error:', err);
    }
  }

  return true; // message was handled
}

// ── Scheduler ──

interface AutoCollectSchedule {
  module: string;
  phone: string;
  intervalMinutes: number;
  enabled: boolean;
}

let schedules: AutoCollectSchedule[] = [];

export async function loadSchedules(): Promise<void> {
  try {
    const settings = await prisma.settings.findFirst();
    const raw = (settings as any)?.autoCollectConfig;
    if (raw) {
      schedules = JSON.parse(raw);
      console.log('[AutoCollect] Loaded', schedules.length, 'schedule(s)');
    }
  } catch (err) {
    console.error('[AutoCollect] Failed to load schedules:', err);
  }
}

export async function saveSchedules(newSchedules: AutoCollectSchedule[]): Promise<void> {
  schedules = newSchedules;
  try {
    const settings = await prisma.settings.findFirst();
    if (settings) {
      await prisma.settings.update({
        where: { id: settings.id },
        data: { autoCollectConfig: JSON.stringify(schedules) } as any,
      });
    }
  } catch (err) {
    console.error('[AutoCollect] Failed to save schedules:', err);
  }
}

export function getSchedules(): AutoCollectSchedule[] {
  return schedules;
}

async function runScheduler(): Promise<void> {
  const now = new Date();
  for (const sched of schedules) {
    if (!sched.enabled) continue;

    // Check if it's time to run (based on interval)
    const key = `${sched.module}-${sched.phone}`;
    const lastRun = schedulerLastRun.get(key);
    const intervalMs = sched.intervalMinutes * 60 * 1000;

    if (!lastRun || (now.getTime() - lastRun.getTime()) >= intervalMs) {
      // Don't start if there's already an active session for this phone
      const digits = sched.phone.replace(/\D/g, '').length === 10
        ? '91' + sched.phone.replace(/\D/g, '')
        : sched.phone.replace(/\D/g, '');

      if (!activeSessions.has(digits)) {
        console.log(`[AutoCollect] Triggering ${sched.module} for ${sched.phone}`);
        const result = await startCollection(sched.phone, sched.module);
        if (result.success) {
          schedulerLastRun.set(key, now);
        } else {
          console.error(`[AutoCollect] Failed to trigger: ${result.error}`);
        }
      }
    }
  }
}

const schedulerLastRun = new Map<string, Date>();

export function startScheduler(): void {
  if (schedulerInterval) return;
  schedulerInterval = setInterval(() => {
    runScheduler().catch(err => console.error('[AutoCollect] Scheduler error:', err));
  }, 60 * 1000); // Check every minute
  console.log('[AutoCollect] Scheduler started');
}

export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[AutoCollect] Scheduler stopped');
  }
}

// ── Initialization ──

export async function initAutoCollect(): Promise<void> {
  registerIncomingHandler(handleIncoming);
  await loadSchedules();
  startScheduler();
  console.log('[AutoCollect] Initialized');
}

// ── Status ──

export function getActiveSessions(): { phone: string; module: string; step: number; totalSteps: number; startedAt: Date }[] {
  return Array.from(activeSessions.values()).map(s => ({
    phone: s.phone,
    module: s.module,
    step: s.stepIndex + 1,
    totalSteps: MODULE_CONFIGS[s.module]?.steps.length || 0,
    startedAt: s.startedAt,
  }));
}

export function getAvailableModules(): { module: string; fields: string[] }[] {
  return Object.entries(MODULE_CONFIGS).map(([mod, config]) => ({
    module: mod,
    fields: config.steps.flatMap(s =>
      s.fields.flatMap(f => s.subFields.map(sf => `${f}${sf}`))
    ),
  }));
}
