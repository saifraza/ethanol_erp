/**
 * Telegram Bot API client
 *
 * Replaces WhatsApp Baileys — uses official Telegram Bot API (simple HTTPS).
 * No QR auth, no session persistence, no fragile WebSocket connections.
 *
 * Usage: import { initTelegram, sendTelegramMessage, sendTelegramGroup } from './telegramBot';
 */

import axios, { AxiosInstance } from 'axios';
import prisma from '../config/prisma';

// ── State ──

let botApi: AxiosInstance | null = null;
let botInfo: { id: number; username: string; firstName: string } | null = null;
let pollingActive = false;
let lastUpdateId = 0;

// ── Incoming message handlers ──
type IncomingHandler = (chatId: string, text: string, name: string | null) => Promise<boolean>;
const incomingHandlers: IncomingHandler[] = [];

export function registerIncomingHandler(handler: IncomingHandler): void {
  incomingHandlers.push(handler);
}

export function removeIncomingHandler(handler: IncomingHandler): void {
  const idx = incomingHandlers.indexOf(handler);
  if (idx >= 0) incomingHandlers.splice(idx, 1);
}

// ── Init ──

export async function initTelegram(): Promise<boolean> {
  const settings = await prisma.settings.findFirst();
  const token = (settings as any)?.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    console.log('[Telegram] No bot token configured — Telegram disabled');
    return false;
  }

  botApi = axios.create({
    baseURL: `https://api.telegram.org/bot${token}`,
    timeout: 30000,
  });

  try {
    const res = await botApi.get('/getMe');
    botInfo = res.data.result;
    console.log(`[Telegram] Bot connected: @${botInfo!.username} (${botInfo!.firstName})`);
    startPolling();
    return true;
  } catch (err: any) {
    console.error('[Telegram] Failed to connect:', err.message);
    botApi = null;
    return false;
  }
}

export function getConnectionStatus(): 'connected' | 'disconnected' {
  return botApi && botInfo ? 'connected' : 'disconnected';
}

export function getBotInfo() {
  return botInfo;
}

// ── Send Messages ──

export async function sendTelegramMessage(
  chatId: string,
  message: string,
  module?: string
): Promise<{ success: boolean; error?: string }> {
  if (!botApi) return { success: false, error: 'Telegram bot not connected' };

  try {
    await botApi.post('/sendMessage', {
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown',
    });

    // Log message
    try {
      await prisma.telegramMessage.create({
        data: { direction: 'outgoing', chatId, message, module: module || null },
      });
    } catch { /* table may not exist yet */ }

    return { success: true };
  } catch (err: any) {
    // Retry without Markdown if parsing fails
    if (err.response?.data?.description?.includes('parse')) {
      try {
        await botApi.post('/sendMessage', { chat_id: chatId, text: message });
        return { success: true };
      } catch (err2: any) {
        const errMsg = err2.response?.data?.description || err2.message;
        console.error(`[Telegram] Send failed (${chatId}): ${errMsg}`);
        return { success: false, error: errMsg };
      }
    }
    const errMsg = err.response?.data?.description || err.message;
    console.error(`[Telegram] Send failed (${chatId}): ${errMsg}`);
    return { success: false, error: errMsg };
  }
}

export async function sendTelegramGroup(
  chatId: string,
  message: string,
  module?: string
): Promise<{ success: boolean; error?: string }> {
  return sendTelegramMessage(chatId, message, module);
}

// ── Long Polling for Incoming Messages ──

function startPolling(): void {
  if (pollingActive) return;
  pollingActive = true;
  console.log('[Telegram] Long-polling started for incoming messages');
  poll();
}

export function stopPolling(): void {
  pollingActive = false;
  console.log('[Telegram] Long-polling stopped');
}

async function poll(): Promise<void> {
  while (pollingActive && botApi) {
    try {
      const res = await botApi.get('/getUpdates', {
        params: { offset: lastUpdateId + 1, timeout: 25 },
        timeout: 35000, // slightly longer than Telegram's long-poll timeout
      });

      const updates = res.data.result || [];
      for (const update of updates) {
        lastUpdateId = update.update_id;
        if (update.message?.text) {
          const msg = update.message;
          const chatId = String(msg.chat.id);
          const text = msg.text;
          const name = msg.from?.first_name || msg.from?.username || null;

          // Log incoming message
          try {
            await prisma.telegramMessage.create({
              data: { direction: 'incoming', chatId, name, message: text },
            });
          } catch { /* table may not exist yet */ }

          // Dispatch to handlers
          for (const handler of incomingHandlers) {
            try {
              const handled = await handler(chatId, text, name);
              if (handled) break;
            } catch (err) {
              console.error('[Telegram] Handler error:', err);
            }
          }
        }
      }
    } catch (err: any) {
      if (pollingActive) {
        console.error('[Telegram] Poll error:', err.message);
        await new Promise(r => setTimeout(r, 5000)); // back off on error
      }
    }
  }
}
