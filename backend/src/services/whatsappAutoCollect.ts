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

// ── Types ──

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

// ── Core Logic ──

/**
 * Start a collection session — sends the first question
 */
export async function startCollection(phone: string, moduleName: string): Promise<{ success: boolean; error?: string }> {
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
    await sendWhatsAppMessage(phone, '⏰ Session expired. Data collection cancelled.', `auto-collect-${session.module}`);
    return true;
  }

  // Handle "cancel" command
  const lower = text.toLowerCase().trim();
  if (lower === 'cancel' || lower === 'stop') {
    activeSessions.delete(phone);
    await sendWhatsAppMessage(phone, '❌ Data collection cancelled.', `auto-collect-${session.module}`);
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
    await sendWhatsAppMessage(
      phone,
      `❌ Couldn't read that. Please send in this format:\n\n${hint}\n\nType "cancel" to stop.`,
      `auto-collect-${session.module}`
    );
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
      const summary = config.buildSummary(session.collectedData);

      // Confirm to operator
      await sendWhatsAppMessage(
        phone,
        `✅ *All ${config.displayName} readings saved!*\n\n${confirm}\n\n📊 *Complete Entry:*\n${summary}\n\n_Saved to ERP at ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}_`,
        `auto-collect-${session.module}`
      );

      // Share to WhatsApp group + private numbers
      try {
        const now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
        const fullReport = `📊 *${config.displayName} Report* — ${now}\n\n${summary}\n\n_Auto-collected via WhatsApp_`;
        const settings = await prisma.settings.findFirst();

        // Send to group
        const groupJid = (settings as any)?.whatsappGroupJid;
        if (groupJid) {
          await sendToGroup(groupJid, fullReport, config.module);
          console.log(`[AutoCollect] Shared ${config.module} report to group`);
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

  return true;
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

const schedulerLastRun = new Map<string, Date>();

/**
 * Pick the right phone number based on shift.
 * phone field is comma-separated: "shiftA,shiftB,shiftC"
 * Shift A = 06:00–13:59, Shift B = 14:00–21:59, Shift C = 22:00–05:59
 * Falls back to first non-empty number if current shift slot is blank.
 */
export function pickShiftPhone(phoneStr: string): string | null {
  const parts = phoneStr.split(',').map(p => p.trim());
  const hour = new Date().getHours(); // IST on server
  let idx = hour >= 6 && hour < 14 ? 0 : hour >= 14 && hour < 22 ? 1 : 2;
  // Try current shift first, then fallback to any non-empty
  if (parts[idx]) return parts[idx];
  return parts.find(p => p.length > 0) || null;
}

async function runScheduler(): Promise<void> {
  const now = new Date();
  for (const sched of schedules) {
    if (!sched.enabled) continue;
    if (!MODULE_REGISTRY[sched.module]) continue;

    const key = `${sched.module}-${sched.phone}`;
    const lastRun = schedulerLastRun.get(key);
    const intervalMs = sched.intervalMinutes * 60 * 1000;

    if (!lastRun || (now.getTime() - lastRun.getTime()) >= intervalMs) {
      const phone = pickShiftPhone(sched.phone);
      if (!phone) {
        console.warn(`[AutoCollect] No phone configured for current shift: ${sched.module}`);
        continue;
      }

      let digits = phone.replace(/\D/g, '');
      if (digits.length === 10) digits = '91' + digits;

      if (!activeSessions.has(digits)) {
        console.log(`[AutoCollect] Triggering ${sched.module} for ${phone} (shift-picked)`);
        const result = await startCollection(phone, sched.module);
        if (result.success) {
          schedulerLastRun.set(key, now);
        } else {
          console.error(`[AutoCollect] Failed to trigger: ${result.error}`);
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
