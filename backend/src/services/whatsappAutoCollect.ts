/**
 * WhatsApp Auto-Collection Service (Generic Engine)
 *
 * Sends scheduled WhatsApp messages to operators asking for field readings,
 * parses their replies, and saves data to the ERP database.
 *
 * Module-specific logic lives in ./autoCollectModules/<module>.ts
 * This file is the generic conversation engine + scheduler.
 *
 * To add a new module: see autoCollectModules/_template.ts
 */

import prisma from '../config/prisma';
import { sendWhatsAppMessage, sendToGroup, registerIncomingHandler } from './whatsappBaileys';
import { MODULE_REGISTRY, ModuleConfig } from './autoCollectModules';
import { setDdgsLanguage } from './autoCollectModules/ddgsProduction';

// ── Types ──

interface ActiveSession {
  phone: string;
  module: string;
  stepIndex: number;
  collectedData: Record<string, number>;
  startedAt: Date;
  expiresAt: Date;
  autoShare: boolean;
}

// ── In-memory session store ──
const activeSessions = new Map<string, ActiveSession>(); // key = phone

// ── Scheduler state ──
let schedulerInterval: ReturnType<typeof setInterval> | null = null;

// ── Core Logic ──

/**
 * Start a collection session — sends the first question
 */
export async function startCollection(phone: string, moduleName: string, autoShare = true): Promise<{ success: boolean; error?: string }> {
  const config = MODULE_REGISTRY[moduleName];
  if (!config) return { success: false, error: `Unknown module: ${moduleName}. Available: ${Object.keys(MODULE_REGISTRY).join(', ')}` };

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
    autoShare,
  };

  activeSessions.set(digits, session);

  // Send first question — always private to operator
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

/** Send a message back to the operator privately */
async function sendSessionMessage(session: ActiveSession, message: string): Promise<void> {
  await sendWhatsAppMessage(session.phone, message, `auto-collect-${session.module}`);
}

/**
 * Handle incoming message — check if it's a reply to an active session
 */
async function handleIncoming(rawPhone: string, text: string, _name: string | null): Promise<boolean> {
  // Try direct match first, then resolve @lid by finding matching active session
  let phone = rawPhone;
  let session = activeSessions.get(phone);
  if (!session && rawPhone.includes('@lid')) {
    // Unknown LID — try to match against active sessions
    // This handles WhatsApp multi-device where replies come from LID JIDs
    for (const [sessPhone, sess] of activeSessions.entries()) {
      if (new Date() <= sess.expiresAt) {
        phone = sessPhone;
        session = sess;
        console.log(`[AutoCollect] Matched LID ${rawPhone} → session ${sessPhone}`);
        break;
      }
    }
  }
  if (!session) return false;

  // Check expiry
  if (new Date() > session.expiresAt) {
    activeSessions.delete(phone);
    await sendSessionMessage(session, '⏰ Session expired. Data collection cancelled.');
    return true;
  }

  // Handle "cancel" command
  const lower = text.toLowerCase().trim();
  if (lower === 'cancel' || lower === 'stop') {
    activeSessions.delete(phone);
    await sendSessionMessage(session, '❌ Data collection cancelled.');
    return true;
  }

  const config = MODULE_REGISTRY[session.module];
  if (!config) {
    activeSessions.delete(phone);
    return true;
  }

  const step = config.steps[session.stepIndex];

  // Try to parse the reply
  const parsed = config.parseReply(text, step);

  if (!parsed) {
    // Couldn't parse — ask again with module-specific hint
    const hint = config.buildErrorHint(step);
    await sendSessionMessage(session, `❌ Couldn't read that. Please send in this format:\n\n${hint}\n\nType "cancel" to stop.`);
    return true;
  }

  // Merge parsed data
  Object.assign(session.collectedData, parsed);

  // Build module-specific confirmation
  const confirm = config.buildConfirmation(step, parsed);

  // Move to next step
  session.stepIndex++;

  if (session.stepIndex < config.steps.length) {
    // More steps — send confirmation + next question
    const nextStep = config.steps[session.stepIndex];
    const nextPrompt = config.buildPrompt(nextStep);
    await sendSessionMessage(session, `✅ *${step.label} saved!*\n${confirm}\n\n${nextPrompt}`);
    console.log(`[AutoCollect] ${session.module} step ${session.stepIndex}/${config.steps.length} for ${phone}`);
  } else {
    // All done — save to DB
    try {
      await config.saveData(session.collectedData);
      activeSessions.delete(phone);

      // Build final summary
      const summary = config.buildSummary(session.collectedData);

      // Confirm to operator (group or private)
      const istNow = nowIST();
      const istTimeStr = `${String(istNow.getUTCHours() % 12 || 12).padStart(2, '0')}:${String(istNow.getUTCMinutes()).padStart(2, '0')} ${istNow.getUTCHours() >= 12 ? 'pm' : 'am'}`;
      await sendSessionMessage(session,
        `✅ *All ${config.displayName} readings saved!*\n\n${confirm}\n\n📊 *Complete Entry:*\n${summary}\n\n_Saved to ERP at ${istTimeStr}_`
      );

      // Share to WhatsApp group + private numbers (only if autoShare enabled)
      if (session.autoShare) {
        try {
          const fullReport = `📊 *${config.displayName} Report* — ${istTimeStr}\n\n${summary}\n\n_Auto-collected via WhatsApp_`;
          const settings = await prisma.settings.findFirst();

          // Send report to group (unless module is privateOnly)
          if (!config.privateOnly) {
            const groupJid = (settings as any)?.whatsappGroupJid;
            if (groupJid) {
              await sendToGroup(groupJid, fullReport, config.module);
              console.log(`[AutoCollect] Shared ${config.module} report to group`);
            }
          }

          // Send to private numbers
          const privateNumbers = ((settings as any)?.whatsappNumbers || '')
            .split(',')
            .map((p: string) => p.trim())
            .filter((p: string) => p.length > 0 && p !== phone.replace(/^91/, ''));
          for (const num of privateNumbers) {
            await sendWhatsAppMessage(num, fullReport, config.module);
          }
          if (privateNumbers.length > 0) {
            console.log(`[AutoCollect] Shared ${config.module} report to ${privateNumbers.length} private numbers`);
          }
        } catch (shareErr) {
          console.error(`[AutoCollect] Failed to share ${config.module} report:`, shareErr);
        }
      } else {
        console.log(`[AutoCollect] Auto-share disabled, skipping group report`);
      }

      console.log(`[AutoCollect] ${session.module} completed for ${phone}`);
    } catch (err: any) {
      activeSessions.delete(phone);
      await sendSessionMessage(session, `❌ Failed to save: ${err.message}. Please enter manually in the ERP.`);
      console.error('[AutoCollect] Save error:', err);
    }
  }

  return true;
}

// ── Scheduler ──

interface AutoCollectSchedule {
  module: string;
  phone: string;
  intervalMinutes: number;
  enabled: boolean;
  autoShare?: boolean;
}

let schedules: AutoCollectSchedule[] = [];

export async function loadSchedules(): Promise<void> {
  try {
    const settings = await prisma.settings.findFirst();
    const raw = (settings as any)?.autoCollectConfig;
    if (raw) {
      schedules = JSON.parse(raw);
      console.log('[AutoCollect] Loaded', schedules.length, 'schedule(s):', JSON.stringify(schedules));
      // Sync per-module config
      const ddgs = schedules.find(s => s.module === 'ddgs');
      if (ddgs) setDdgsLanguage((ddgs as any).language || 'hi');
    } else {
      console.log('[AutoCollect] No autoCollectConfig in DB, starting with empty schedules');
    }
  } catch (err) {
    console.error('[AutoCollect] Failed to load schedules:', err);
  }
}

export async function saveSchedules(newSchedules: AutoCollectSchedule[]): Promise<void> {
  schedules = newSchedules;
  // Sync per-module config
  const ddgs = schedules.find(s => s.module === 'ddgs');
  if (ddgs) setDdgsLanguage((ddgs as any).language || 'hi');
  console.log('[AutoCollect] Schedules updated. New config:', JSON.stringify(schedules));
  try {
    const settings = await prisma.settings.findFirst();
    if (settings) {
      await prisma.settings.update({
        where: { id: settings.id },
        data: { autoCollectConfig: JSON.stringify(schedules) } as any,
      });
      console.log('[AutoCollect] Schedules persisted to DB');
    } else {
      console.warn('[AutoCollect] No settings row found — schedules NOT persisted!');
    }
  } catch (err) {
    console.error('[AutoCollect] Failed to save schedules:', err);
  }
}

export function getSchedules(): AutoCollectSchedule[] {
  return schedules;
}

/**
 * Pick the right phone number based on shift.
 * phone field is comma-separated: "shiftA,shiftB,shiftC"
 * Shift A = 06:00–13:59, Shift B = 14:00–21:59, Shift C = 22:00–05:59
 * Falls back to first non-empty number if current shift slot is blank.
 */
/** Parse comma-separated phone string into array of non-empty numbers */
export function parsePhones(phoneStr: string): string[] {
  return phoneStr.split(',').map(p => p.trim()).filter(p => p.length > 0);
}

/** @deprecated — kept for backward compat, returns first phone */
export function pickShiftPhone(phoneStr: string): string | null {
  const phones = parsePhones(phoneStr);
  return phones[0] || null;
}

/**
 * Clock-based scheduler — survives deploys.
 *
 * Instead of tracking "time since last trigger" in memory, we compute the
 * current time-slot based on real clock time and check if we already sent
 * a message in that slot by querying the WhatsAppMessage table.
 *
 * For interval=60 min:  slots are 00:00, 01:00, 02:00, ...
 * For interval=120 min: slots are 00:00, 02:00, 04:00, ...
 * For interval=30 min:  slots are 00:00, 00:30, 01:00, ...
 *
 * After a deploy, the scheduler checks: "Am I in a slot that already had
 * a message sent?" — if yes, skip. If no, trigger.
 */
/** Get current IST time (UTC+5:30) — Railway runs in UTC */
function nowIST(): Date {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

function getCurrentSlotStart(intervalMinutes: number): Date {
  const ist = nowIST();
  // Use IST hours/minutes for slot calculation
  const minutesSinceMidnight = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const slotIndex = Math.floor(minutesSinceMidnight / intervalMinutes);
  const slotMinutes = slotIndex * intervalMinutes;
  // Build slot start in real UTC (subtract IST offset back)
  const slotStartIST = new Date(ist);
  slotStartIST.setUTCHours(Math.floor(slotMinutes / 60), slotMinutes % 60, 0, 0);
  return new Date(slotStartIST.getTime() - 5.5 * 60 * 60 * 1000); // convert back to UTC for DB query
}

async function wasAlreadyTriggeredInSlot(module: string, slotStart: Date): Promise<boolean> {
  try {
    const count = await prisma.whatsAppMessage.count({
      where: {
        module: `auto-collect-${module}`,
        direction: 'outgoing',
        timestamp: { gte: slotStart },
      },
    });
    return count > 0;
  } catch (err) {
    console.error(`[AutoCollect] DB check failed for ${module}:`, err);
    return false; // fail-open: trigger if DB check fails
  }
}

async function runScheduler(): Promise<void> {
  for (const sched of schedules) {
    if (!sched.enabled) continue;
    if (!MODULE_REGISTRY[sched.module]) continue;

    const slotStart = getCurrentSlotStart(sched.intervalMinutes);
    const alreadySent = await wasAlreadyTriggeredInSlot(sched.module, slotStart);

    if (alreadySent) continue;

    const phones = parsePhones(sched.phone);
    if (!phones.length) {
      console.warn(`[AutoCollect] No phone configured: ${sched.module}`);
      continue;
    }

    // Show slot time in IST for logging
    const slotIST = new Date(slotStart.getTime() + 5.5 * 60 * 60 * 1000);
    const slotLabel = `${String(slotIST.getUTCHours()).padStart(2, '0')}:${String(slotIST.getUTCMinutes()).padStart(2, '0')} IST`;

    for (const phone of phones) {
      let digits = phone.replace(/\D/g, '');
      if (digits.length === 10) digits = '91' + digits;

      if (!activeSessions.has(digits)) {
        console.log(`[AutoCollect] Triggering ${sched.module} for ${phone} (slot ${slotLabel}, interval ${sched.intervalMinutes}min)`);
        const result = await startCollection(phone, sched.module, sched.autoShare !== false);
        if (!result.success) {
          console.error(`[AutoCollect] Failed to trigger ${sched.module} for ${phone}: ${result.error}`);
        }
      }
    }
  }
}

export function startScheduler(): void {
  if (schedulerInterval) return;
  schedulerInterval = setInterval(() => {
    runScheduler().catch(err => console.error('[AutoCollect] Scheduler error:', err));
  }, 60 * 1000);
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
  console.log(`[AutoCollect] Initialized with modules: ${Object.keys(MODULE_REGISTRY).join(', ')}`);
}

// ── Status ──

export function getActiveSessions(): { phone: string; module: string; step: number; totalSteps: number; startedAt: Date }[] {
  return Array.from(activeSessions.values()).map(s => ({
    phone: s.phone,
    module: s.module,
    step: s.stepIndex + 1,
    totalSteps: MODULE_REGISTRY[s.module]?.steps.length || 0,
    startedAt: s.startedAt,
  }));
}

export function clearSession(phone: string): boolean {
  // Try exact match first
  if (activeSessions.has(phone)) {
    activeSessions.delete(phone);
    return true;
  }
  // Try with 91 prefix
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 10) digits = '91' + digits;
  if (activeSessions.has(digits)) {
    activeSessions.delete(digits);
    return true;
  }
  return false;
}

export function clearAllSessions(): number {
  const count = activeSessions.size;
  activeSessions.clear();
  return count;
}

export function getAvailableModules(): { module: string; displayName: string; steps: number; fields: string[] }[] {
  return Object.entries(MODULE_REGISTRY).map(([mod, config]) => ({
    module: mod,
    displayName: config.displayName,
    steps: config.steps.length,
    fields: config.steps.flatMap(s =>
      s.fields.flatMap(f => s.subFields.map(sf => `${f}${sf}`))
    ),
  }));
}
