/**
 * Messaging Gateway — Multi-channel broadcast (Telegram + WhatsApp)
 *
 * Replaces direct tgSend/tgSendGroup calls at outbound alert/report sites.
 * Telegram is awaited (primary). WhatsApp is fire-and-forget (graceful degradation).
 *
 * Interactive auto-collect prompts stay Telegram-only — only use this for
 * reports, alerts, and notifications that should reach both channels.
 *
 * Usage: import { broadcastToGroup, broadcastToPrivate, broadcast } from './messagingGateway';
 */

import prisma from '../config/prisma';
import { tgSend, tgSendGroup } from './telegramClient';
import { waSend, waSendGroup } from './whatsappClient';

// ── Settings cache (60s TTL) ──

interface CachedSettings {
  whatsappEnabled: boolean;
  telegramGroupChatId: string | null;
  telegramGroup2ChatId: string | null;
  telegramPrivateChatIds: string | null;
  telegramModuleRouting: string | null;
  whatsappGroupJid: string | null;
  whatsappGroup2Jid: string | null;
  whatsappPrivatePhones: string | null;
  whatsappModuleRouting: string | null;
}

let cached: { settings: CachedSettings; at: number } | null = null;

async function getSettings(): Promise<CachedSettings> {
  if (cached && Date.now() - cached.at < 60_000) return cached.settings;

  const s = await prisma.settings.findFirst({
    select: {
      whatsappEnabled: true,
      telegramGroupChatId: true,
      telegramGroup2ChatId: true,
      telegramPrivateChatIds: true,
      telegramModuleRouting: true,
      whatsappGroupJid: true,
      whatsappGroup2Jid: true,
      whatsappPrivatePhones: true,
      whatsappModuleRouting: true,
    },
  });

  const settings: CachedSettings = {
    whatsappEnabled: s?.whatsappEnabled ?? false,
    telegramGroupChatId: s?.telegramGroupChatId ?? null,
    telegramGroup2ChatId: s?.telegramGroup2ChatId ?? null,
    telegramPrivateChatIds: s?.telegramPrivateChatIds ?? null,
    telegramModuleRouting: s?.telegramModuleRouting ?? null,
    whatsappGroupJid: s?.whatsappGroupJid ?? null,
    whatsappGroup2Jid: s?.whatsappGroup2Jid ?? null,
    whatsappPrivatePhones: s?.whatsappPrivatePhones ?? null,
    whatsappModuleRouting: s?.whatsappModuleRouting ?? null,
  };

  cached = { settings, at: Date.now() };
  return settings;
}

/** Clear settings cache (call when settings are updated) */
export function resetGatewayCache(): void {
  cached = null;
}

// ── Routing helpers ──

const DEFAULT_MODULE_ROUTING: Record<string, string> = {
  'liquefaction': 'group1', 'fermentation': 'group1', 'distillation': 'group1',
  'milling': 'group1', 'evaporation': 'group1', 'decanter': 'group1',
  'dryer': 'group1', 'ethanol-product': 'group1', 'grain': 'group1',
  'ddgs': 'group1', 'ddgs-stock': 'private', 'ddgs-dispatch': 'private',
  'sales': 'private', 'dispatch': 'private', 'procurement': 'private',
  'accounts': 'private', 'inventory': 'private',
};

function parseRouting(json: string | null): Record<string, string> {
  if (!json) return { ...DEFAULT_MODULE_ROUTING };
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch { /* ignore */ }
  return { ...DEFAULT_MODULE_ROUTING };
}

function splitCsv(val: string | null): string[] {
  if (!val) return [];
  return val.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

// ── Public API ──

export interface BroadcastResult {
  telegram: { success: boolean; error?: string };
  whatsapp: { success: boolean; error?: string };
}

/**
 * Send to a Telegram group (awaited) + matching WhatsApp group (fire-and-forget).
 * Maps the Telegram group chat ID to the corresponding WhatsApp group JID.
 */
export async function broadcastToGroup(
  tgGroupChatId: string,
  message: string,
  module?: string
): Promise<BroadcastResult> {
  const tgResult = await tgSendGroup(tgGroupChatId, message, module);

  const waResult: BroadcastResult['whatsapp'] = { success: false, error: 'skipped' };

  // Fire-and-forget WhatsApp
  getSettings().then(s => {
    if (!s.whatsappEnabled) return;

    // Map Telegram group → WhatsApp group
    let waJid: string | null = null;
    if (tgGroupChatId === s.telegramGroupChatId) {
      waJid = s.whatsappGroupJid;
    } else if (tgGroupChatId === s.telegramGroup2ChatId) {
      waJid = s.whatsappGroup2Jid;
    }
    // Fallback: if no specific mapping, try group1
    if (!waJid) waJid = s.whatsappGroupJid;

    if (waJid) {
      waSendGroup(waJid, message, module).catch(() => {});
    }
  }).catch(() => {});

  return { telegram: tgResult, whatsapp: waResult };
}

/**
 * Send to all Telegram private chat IDs + all WhatsApp private phones.
 */
export async function broadcastToPrivate(
  message: string,
  module?: string
): Promise<BroadcastResult> {
  const settings = await getSettings();

  // Telegram private sends
  const tgIds = splitCsv(settings.telegramPrivateChatIds);
  let tgSuccess = false;
  for (const id of tgIds) {
    const r = await tgSend(id, message, module);
    if (r.success) tgSuccess = true;
  }

  // WhatsApp private sends (fire-and-forget)
  if (settings.whatsappEnabled) {
    const waPhones = splitCsv(settings.whatsappPrivatePhones);
    for (const phone of waPhones) {
      waSend(phone, message, module).catch(() => {});
    }
  }

  return {
    telegram: { success: tgSuccess || tgIds.length === 0 },
    whatsapp: { success: false, error: 'fire-and-forget' },
  };
}

/**
 * Smart broadcast — reads module routing config for both channels,
 * resolves targets, and fans out to Telegram + WhatsApp.
 */
export async function broadcast(
  module: string,
  message: string
): Promise<BroadcastResult> {
  const settings = await getSettings();
  const tgRouting = parseRouting(settings.telegramModuleRouting);
  const tgTarget = tgRouting[module] || 'group1';

  // Telegram send (primary, awaited)
  let tgResult: BroadcastResult['telegram'] = { success: false };

  if (tgTarget === 'private') {
    const ids = splitCsv(settings.telegramPrivateChatIds);
    for (const id of ids) {
      const r = await tgSend(id, message, module);
      if (r.success) tgResult = { success: true };
    }
  } else {
    const chatId = tgTarget === 'group2' ? settings.telegramGroup2ChatId : settings.telegramGroupChatId;
    if (chatId) {
      tgResult = await tgSendGroup(chatId, message, module);
    }
  }

  // WhatsApp send (fire-and-forget)
  if (settings.whatsappEnabled) {
    const waRouting = parseRouting(settings.whatsappModuleRouting);
    // Fall back to Telegram routing if WhatsApp routing not configured
    const waTarget = waRouting[module] || tgTarget;

    if (waTarget === 'private') {
      const phones = splitCsv(settings.whatsappPrivatePhones);
      for (const phone of phones) {
        waSend(phone, message, module).catch(() => {});
      }
    } else {
      const jid = waTarget === 'group2' ? settings.whatsappGroup2Jid : settings.whatsappGroupJid;
      if (jid) {
        waSendGroup(jid, message, module).catch(() => {});
      }
    }
  }

  return {
    telegram: tgResult,
    whatsapp: { success: false, error: 'fire-and-forget' },
  };
}
