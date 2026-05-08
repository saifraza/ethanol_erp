/**
 * Messaging Gateway — Telegram broadcast for outbound alerts/reports.
 *
 * Used by route handlers that fan out lab readings, OPC alarms, dispatch
 * notifications, etc. to operators. Telegram is the only channel — WhatsApp
 * (Baileys + worker) and LightRAG were removed 2026-05-08 to keep the
 * messaging path simple and reliable.
 *
 * Interactive auto-collect prompts use `telegramClient` directly; this
 * gateway is for one-shot broadcasts.
 */

import prisma from '../config/prisma';
import { tgSend, tgSendGroup } from './telegramClient';

interface CachedSettings {
  telegramGroupChatId: string | null;
  telegramGroup2ChatId: string | null;
  telegramPrivateChatIds: string | null;
  telegramModuleRouting: string | null;
}

let cached: { settings: CachedSettings; at: number } | null = null;

async function getSettings(): Promise<CachedSettings> {
  if (cached && Date.now() - cached.at < 60_000) return cached.settings;

  const s = await prisma.settings.findFirst({
    select: {
      telegramGroupChatId: true,
      telegramGroup2ChatId: true,
      telegramPrivateChatIds: true,
      telegramModuleRouting: true,
    },
  });

  const settings: CachedSettings = {
    telegramGroupChatId: s?.telegramGroupChatId ?? null,
    telegramGroup2ChatId: s?.telegramGroup2ChatId ?? null,
    telegramPrivateChatIds: s?.telegramPrivateChatIds ?? null,
    telegramModuleRouting: s?.telegramModuleRouting ?? null,
  };

  cached = { settings, at: Date.now() };
  return settings;
}

export function resetGatewayCache(): void {
  cached = null;
}

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

export interface BroadcastResult {
  telegram: { success: boolean; error?: string };
}

export async function broadcastToGroup(
  tgGroupChatId: string,
  message: string,
  module?: string,
): Promise<BroadcastResult> {
  const tgResult = await tgSendGroup(tgGroupChatId, message, module);
  return { telegram: tgResult };
}

export async function broadcastToPrivate(
  message: string,
  module?: string,
): Promise<BroadcastResult> {
  const settings = await getSettings();
  const tgIds = splitCsv(settings.telegramPrivateChatIds);
  let tgSuccess = false;
  for (const id of tgIds) {
    const r = await tgSend(id, message, module);
    if (r.success) tgSuccess = true;
  }
  return { telegram: { success: tgSuccess || tgIds.length === 0 } };
}

export async function broadcast(
  module: string,
  message: string,
): Promise<BroadcastResult> {
  const settings = await getSettings();
  const tgRouting = parseRouting(settings.telegramModuleRouting);
  const tgTarget = tgRouting[module] || 'group1';

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

  return { telegram: tgResult };
}
