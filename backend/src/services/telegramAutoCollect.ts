/**
 * Telegram Auto-Collection Service (Generic Engine)
 *
 * Sends scheduled Telegram messages to operators asking for field readings,
 * parses their replies, and saves data to the ERP database.
 *
 * Adapted from whatsappAutoCollect.ts — same module interface, no module changes needed.
 * Session keys use Telegram chatId instead of phone numbers.
 */

import prisma from '../config/prisma';
import { registerIncomingHandler } from './telegramBot';
import { tgSend, tgSendGroup } from './telegramClient';
import { waSend, waSendGroup } from './whatsappClient';
import { MODULE_REGISTRY } from './autoCollectModules';
import { setDdgsLanguage } from './autoCollectModules/ddgsProduction';

// ── Types ──

interface ActiveSession {
  chatId: string;
  module: string;
  stepIndex: number;
  collectedData: Record<string, number>;
  startedAt: Date;
  expiresAt: Date;
  autoShare: boolean;
}

// ── In-memory session store ──
const activeSessions = new Map<string, ActiveSession>(); // key = chatId

// ── Scheduler state ──
let schedulerInterval: ReturnType<typeof setInterval> | null = null;

// ── Core Logic ──

export async function startCollection(chatId: string, moduleName: string, autoShare = true): Promise<{ success: boolean; error?: string }> {
  const config = MODULE_REGISTRY[moduleName];
  if (!config) return { success: false, error: `Unknown module: ${moduleName}. Available: ${Object.keys(MODULE_REGISTRY).join(', ')}` };

  if (activeSessions.has(chatId)) {
    return { success: false, error: `Active session already exists for ${chatId}` };
  }

  // Inject module-specific config
  const initialData: Record<string, number> = {};
  if (moduleName === 'ddgs') {
    let bagWt = 35;
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT "bagWeight" FROM "AutoCollectSchedule" WHERE module = 'ddgs' LIMIT 1`
      ) as Array<{ bagWeight: number }>;
      if (rows.length > 0 && rows[0].bagWeight) bagWt = rows[0].bagWeight;
    } catch { /* table or column may not exist */ }
    initialData._weightPerBag = bagWt;
  }

  const session: ActiveSession = {
    chatId,
    module: moduleName,
    stepIndex: 0,
    collectedData: initialData,
    startedAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    autoShare,
  };

  activeSessions.set(chatId, session);

  const step = config.steps[0];
  const prompt = config.buildPrompt(step);
  const result = await tgSend(chatId, prompt, `auto-collect-${moduleName}`);

  if (!result.success) {
    activeSessions.delete(chatId);
    return { success: false, error: result.error };
  }

  console.log(`[TG-AutoCollect] Started ${moduleName} session for ${chatId}, step 1/${config.steps.length}`);
  return { success: true };
}

async function sendSessionMessage(session: ActiveSession, message: string): Promise<void> {
  await tgSend(session.chatId, message, `auto-collect-${session.module}`);
}

async function handleIncoming(chatId: string, text: string, _name: string | null): Promise<boolean> {
  console.log(`[TG-AutoCollect] handleIncoming: chatId=${chatId}, text=${text}, activeSessions=${JSON.stringify([...activeSessions.keys()])}`);
  const session = activeSessions.get(chatId);
  if (!session) {
    console.log(`[TG-AutoCollect] No session found for chatId=${chatId}`);
    return false;
  }

  if (new Date() > session.expiresAt) {
    activeSessions.delete(chatId);
    await sendSessionMessage(session, '⏰ Session expired. Data collection cancelled.');
    return true;
  }

  const lower = text.toLowerCase().trim();
  if (lower === 'cancel' || lower === 'stop' || lower === '/cancel') {
    activeSessions.delete(chatId);
    await sendSessionMessage(session, '❌ Data collection cancelled.');
    return true;
  }

  const config = MODULE_REGISTRY[session.module];
  if (!config) {
    activeSessions.delete(chatId);
    return true;
  }

  const step = config.steps[session.stepIndex];
  const parsed = config.parseReply(text, step);

  if (!parsed) {
    const hint = config.buildErrorHint(step);
    await sendSessionMessage(session, `❌ Couldn't read that. Please send in this format:\n\n${hint}\n\nType /cancel to stop.`);
    return true;
  }

  Object.assign(session.collectedData, parsed);
  const confirm = config.buildConfirmation(step, parsed);

  session.stepIndex++;

  if (session.stepIndex < config.steps.length) {
    const nextStep = config.steps[session.stepIndex];
    const nextPrompt = config.buildPrompt(nextStep);
    await sendSessionMessage(session, `✅ *${step.label} saved!*\n${confirm}\n\n${nextPrompt}`);
    console.log(`[TG-AutoCollect] ${session.module} step ${session.stepIndex}/${config.steps.length} for ${chatId}`);
  } else {
    try {
      await config.saveData(session.collectedData);
      activeSessions.delete(chatId);

      const summary = config.buildSummary(session.collectedData);
      const istNow = nowIST();
      const istTimeStr = `${String(istNow.getUTCHours() % 12 || 12).padStart(2, '0')}:${String(istNow.getUTCMinutes()).padStart(2, '0')} ${istNow.getUTCHours() >= 12 ? 'pm' : 'am'}`;

      await sendSessionMessage(session,
        `✅ *All ${config.displayName} readings saved!*\n\n${confirm}\n\n📊 *Complete Entry:*\n${summary}\n\n_Saved to ERP at ${istTimeStr}_`
      );

      if (session.autoShare) {
        try {
          const fullReport = `📊 *${config.displayName} Report* — ${istTimeStr}\n\n${summary}\n\n_Auto-collected via Telegram_`;
          const settings = await prisma.settings.findFirst();

          let moduleTarget = config.privateOnly ? 'private' : 'group1';
          try {
            const routingRaw = (settings as any)?.telegramModuleRouting;
            if (routingRaw) {
              const routing = JSON.parse(routingRaw);
              if (routing[config.module]) moduleTarget = routing[config.module];
            }
          } catch { /* ignore */ }

          if (moduleTarget === 'private') {
            const moduleSchedule = schedules.find(s => s.module === session.module);
            const scheduleChatIds = moduleSchedule ? parseChatIds(moduleSchedule.phone) : [];
            const globalChatIds = ((settings as any)?.telegramPrivateChatIds || '')
              .split(',')
              .map((p: string) => p.trim())
              .filter((p: string) => p.length > 0);
            const allRecipients = [...new Set([...scheduleChatIds, ...globalChatIds])];
            for (const id of allRecipients) {
              await tgSend(id, fullReport, config.module);
            }
            if (allRecipients.length > 0) {
              console.log(`[TG-AutoCollect] Shared ${config.module} report to ${allRecipients.length} private chats`);
            }
            // WhatsApp parallel push (fire-and-forget)
            if ((settings as any)?.whatsappEnabled) {
              const waPhones = ((settings as any)?.whatsappPrivatePhones || '')
                .split(',').map((p: string) => p.trim()).filter((p: string) => p.length > 0);
              for (const phone of waPhones) {
                waSend(phone, fullReport, config.module).catch(() => {});
              }
            }
          } else {
            const groupChatId = moduleTarget === 'group2'
              ? (settings as any)?.telegramGroup2ChatId
              : (settings as any)?.telegramGroupChatId;
            if (groupChatId) {
              await tgSendGroup(groupChatId, fullReport, config.module);
              console.log(`[TG-AutoCollect] Shared ${config.module} report to ${moduleTarget}`);
            }
            // WhatsApp parallel push (fire-and-forget)
            if ((settings as any)?.whatsappEnabled) {
              const waJid = moduleTarget === 'group2'
                ? (settings as any)?.whatsappGroup2Jid
                : (settings as any)?.whatsappGroupJid;
              if (waJid) {
                waSendGroup(waJid, fullReport, config.module).catch(() => {});
              }
            }
          }
        } catch (shareErr) {
          console.error(`[TG-AutoCollect] Failed to share ${config.module} report:`, shareErr);
        }
      }

      console.log(`[TG-AutoCollect] ${session.module} completed for ${chatId}`);
    } catch (err: any) {
      activeSessions.delete(chatId);
      await sendSessionMessage(session, `❌ Failed to save: ${err.message}. Please enter manually in the ERP.`);
      console.error('[TG-AutoCollect] Save error:', err);
    }
  }

  return true;
}

// ── Scheduler ──

interface AutoCollectScheduleConfig {
  module: string;
  phone: string; // Reuses field name — stores chatId for Telegram
  intervalMinutes: number;
  enabled: boolean;
  autoShare?: boolean;
}

let schedules: AutoCollectScheduleConfig[] = [];

export async function loadSchedules(): Promise<void> {
  try {
    // Primary: read from AutoCollectSchedule table
    const dbSchedules = await prisma.autoCollectSchedule.findMany();
    if (dbSchedules.length > 0) {
      schedules = dbSchedules.map((s: any) => ({
        module: s.module,
        phone: s.phone,
        intervalMinutes: s.intervalMinutes,
        enabled: s.enabled,
        autoShare: s.autoShare !== false,
        language: s.language || 'hi',
        bagWeight: s.bagWeight || 35,
      }));
      console.log('[TG-AutoCollect] Loaded', schedules.length, 'schedule(s) from DB table');
    } else {
      // Fallback: legacy JSON in Settings.autoCollectConfig
      const settings = await prisma.settings.findFirst();
      const raw = (settings as any)?.autoCollectConfig;
      if (raw) {
        schedules = JSON.parse(raw);
        console.log('[TG-AutoCollect] Loaded', schedules.length, 'schedule(s) from legacy JSON');
      }
    }
    const ddgs = schedules.find(s => s.module === 'ddgs');
    if (ddgs) setDdgsLanguage((ddgs as any).language || 'hi');
  } catch (err) {
    console.error('[TG-AutoCollect] Failed to load schedules:', err);
  }
}

export async function saveSchedules(newSchedules: AutoCollectScheduleConfig[]): Promise<void> {
  schedules = newSchedules;
  const ddgs = schedules.find(s => s.module === 'ddgs');
  if (ddgs) setDdgsLanguage((ddgs as any).language || 'hi');
  try {
    const settings = await prisma.settings.findFirst();
    if (settings) {
      await prisma.settings.update({
        where: { id: settings.id },
        data: { autoCollectConfig: JSON.stringify(schedules) } as any,
      });
      console.log('[TG-AutoCollect] Schedules persisted to DB');
    }
  } catch (err) {
    console.error('[TG-AutoCollect] Failed to save schedules:', err);
  }
}

export async function getSchedules(): Promise<AutoCollectScheduleConfig[]> {
  if (schedules.length === 0) await loadSchedules();
  return schedules;
}

function parseChatIds(chatIdStr: string): string[] {
  return chatIdStr.split(',').map(p => p.trim()).filter(p => p.length > 0);
}

function nowIST(): Date {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

function getCurrentSlotStart(intervalMinutes: number): Date {
  const ist = nowIST();
  const minutesSinceMidnight = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const slotIndex = Math.floor(minutesSinceMidnight / intervalMinutes);
  const slotMinutes = slotIndex * intervalMinutes;
  const slotStartIST = new Date(ist);
  slotStartIST.setUTCHours(Math.floor(slotMinutes / 60), slotMinutes % 60, 0, 0);
  return new Date(slotStartIST.getTime() - 5.5 * 60 * 60 * 1000);
}

async function wasAlreadyTriggeredInSlot(module: string, slotStart: Date): Promise<boolean> {
  try {
    const count = await prisma.telegramMessage.count({
      where: {
        module: `auto-collect-${module}`,
        direction: 'outgoing',
        timestamp: { gte: slotStart },
      },
    });
    return count > 0;
  } catch {
    return false;
  }
}

const pendingRetries: { module: string; chatId: string; autoShare: boolean; attempts: number }[] = [];

async function runScheduler(): Promise<void> {
  if (pendingRetries.length > 0) {
    const retries = [...pendingRetries];
    pendingRetries.length = 0;
    for (const retry of retries) {
      if (retry.attempts >= 5) continue;
      const result = await startCollection(retry.chatId, retry.module, retry.autoShare);
      if (!result.success) {
        pendingRetries.push({ ...retry, attempts: retry.attempts + 1 });
      }
    }
  }

  for (const sched of schedules) {
    if (!sched.enabled) continue;
    if (!MODULE_REGISTRY[sched.module]) continue;

    const slotStart = getCurrentSlotStart(sched.intervalMinutes);
    const alreadySent = await wasAlreadyTriggeredInSlot(sched.module, slotStart);
    if (alreadySent) continue;

    const chatIds = parseChatIds(sched.phone);
    if (!chatIds.length) continue;

    const slotIST = new Date(slotStart.getTime() + 5.5 * 60 * 60 * 1000);
    const slotLabel = `${String(slotIST.getUTCHours()).padStart(2, '0')}:${String(slotIST.getUTCMinutes()).padStart(2, '0')} IST`;

    for (const chatId of chatIds) {
      if (!activeSessions.has(chatId)) {
        console.log(`[TG-AutoCollect] Triggering ${sched.module} for ${chatId} (slot ${slotLabel})`);
        const result = await startCollection(chatId, sched.module, sched.autoShare !== false);
        if (!result.success) {
          pendingRetries.push({ module: sched.module, chatId, autoShare: sched.autoShare !== false, attempts: 1 });
        }
      }
    }
  }
}

export function startScheduler(): void {
  if (schedulerInterval) return;
  schedulerInterval = setInterval(() => {
    runScheduler().catch(err => console.error('[TG-AutoCollect] Scheduler error:', err));
  }, 60 * 1000);
  console.log('[TG-AutoCollect] Scheduler started');
}

export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

// ── Initialization ──

export async function initTelegramAutoCollect(): Promise<void> {
  registerIncomingHandler(handleIncoming);
  console.log(`[TG-AutoCollect] Incoming handler registered`);
  await loadSchedules();
  startScheduler();
  console.log(`[TG-AutoCollect] Initialized with modules: ${Object.keys(MODULE_REGISTRY).join(', ')}`);
}

// ── Status ──

export function getActiveSessions(): { chatId: string; module: string; step: number; totalSteps: number; startedAt: Date }[] {
  return Array.from(activeSessions.values()).map(s => ({
    chatId: s.chatId,
    module: s.module,
    step: s.stepIndex + 1,
    totalSteps: MODULE_REGISTRY[s.module]?.steps.length || 0,
    startedAt: s.startedAt,
  }));
}

export function clearSession(chatId: string): boolean {
  if (activeSessions.has(chatId)) {
    activeSessions.delete(chatId);
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
