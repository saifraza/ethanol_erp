/**
 * Telegram Bot API client
 *
 * Uses the official Telegram Bot API (simple HTTPS, long-polling).
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
type CallbackHandler = (chatId: string, data: string, callbackQueryId: string, name: string | null) => Promise<boolean>;
type PhotoHandler = (chatId: string, fileId: string, caption: string | null, name: string | null) => Promise<boolean>;
const incomingHandlers: IncomingHandler[] = [];
const callbackHandlers: CallbackHandler[] = [];
const photoHandlers: PhotoHandler[] = [];

export function registerIncomingHandler(handler: IncomingHandler): void {
  incomingHandlers.push(handler);
}

export function removeIncomingHandler(handler: IncomingHandler): void {
  const idx = incomingHandlers.indexOf(handler);
  if (idx >= 0) incomingHandlers.splice(idx, 1);
}

export function registerCallbackHandler(handler: CallbackHandler): void {
  callbackHandlers.push(handler);
}

export function registerPhotoHandler(handler: PhotoHandler): void {
  photoHandlers.push(handler);
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
  } catch (err: unknown) {
    console.error('[Telegram] Failed to connect:', (err instanceof Error ? err.message : String(err)));
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
  } catch (err: unknown) {
    // Retry without Markdown if parsing fails
    if (((err as Record<string, any>).response as Record<string, any>)?.data?.description?.includes('parse')) {
      try {
        await botApi.post('/sendMessage', { chat_id: chatId, text: message });
        return { success: true };
      } catch (err2: any) {
        const errMsg = err2.response?.data?.description || err2.message;
        console.error(`[Telegram] Send failed (${chatId}): ${errMsg}`);
        return { success: false, error: errMsg };
      }
    }
    const errMsg = ((err as Record<string, any>).response as Record<string, any>)?.data?.description || (err instanceof Error ? err.message : String(err));
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

/** Send message with inline keyboard buttons */
export async function sendTelegramKeyboard(
  chatId: string,
  message: string,
  buttons: { text: string; callback_data: string }[][],
  module?: string
): Promise<{ success: boolean; error?: string }> {
  if (!botApi) return { success: false, error: 'Telegram bot not connected' };
  try {
    await botApi.post('/sendMessage', {
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons },
    });
    try {
      await prisma.telegramMessage.create({
        data: { direction: 'outgoing', chatId, message, module: module || null },
      });
    } catch { /* table may not exist yet */ }
    return { success: true };
  } catch (err: unknown) {
    // Retry without Markdown
    try {
      await botApi.post('/sendMessage', {
        chat_id: chatId, text: message,
        reply_markup: { inline_keyboard: buttons },
      });
      return { success: true };
    } catch (err2: any) {
      const errMsg = err2.response?.data?.description || err2.message;
      console.error(`[Telegram] Keyboard send failed: ${errMsg}`);
      return { success: false, error: errMsg };
    }
  }
}

/** Download a file from Telegram (for photo/document processing) */
export async function downloadTelegramFile(fileId: string): Promise<Buffer | null> {
  if (!botApi) return null;
  try {
    const fileRes = await botApi.get(`/getFile?file_id=${fileId}`);
    const filePath = fileRes.data.result.file_path;
    const token = botApi.defaults.baseURL?.split('/bot')[1] || '';
    const url = `https://api.telegram.org/file/bot${token}/${filePath}`;
    const dlRes = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
    return Buffer.from(dlRes.data);
  } catch (err: unknown) {
    console.error('[Telegram] File download failed:', (err instanceof Error ? err.message : String(err)));
    return null;
  }
}

/** Answer a callback query (acknowledge button press) */
export async function answerCallback(callbackQueryId: string, text?: string): Promise<void> {
  if (!botApi) return;
  try {
    await botApi.post('/answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text: text || '',
    });
  } catch { /* best effort */ }
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

        // ── Callback query (inline keyboard button press) ──
        if (update.callback_query) {
          const cb = update.callback_query;
          const chatId = String(cb.message?.chat?.id || cb.from?.id);
          const data = cb.data || '';
          const cbName = cb.from?.first_name || cb.from?.username || null;
          console.log(`[Telegram] Callback: chatId=${chatId}, data=${data}`);
          for (const handler of callbackHandlers) {
            try {
              const handled = await handler(chatId, data, cb.id, cbName);
              if (handled) break;
            } catch (err) {
              console.error('[Telegram] Callback handler error:', err);
            }
          }
          continue;
        }

        // ── Photo message ──
        if (update.message?.photo && photoHandlers.length > 0) {
          const msg = update.message;
          const chatId = String(msg.chat.id);
          const name = msg.from?.first_name || msg.from?.username || null;
          const caption = msg.caption || null;
          // Get highest resolution photo
          const photo = msg.photo[msg.photo.length - 1];
          const fileId = photo.file_id;
          console.log(`[Telegram] Photo from ${chatId}, fileId=${fileId}`);
          try {
            await prisma.telegramMessage.create({
              data: { direction: 'incoming', chatId, name, message: caption || '[photo]' },
            });
          } catch { /* table may not exist yet */ }
          for (const handler of photoHandlers) {
            try {
              const handled = await handler(chatId, fileId, caption, name);
              if (handled) break;
            } catch (err) {
              console.error('[Telegram] Photo handler error:', err);
            }
          }
          continue;
        }

        // ── Text message ──
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

          // Auto-reply to /start command
          if (text === '/start') {
            await sendTelegramMessage(chatId,
              `Welcome to *MSPIL ERP Bot*\n\nYour Chat ID: \`${chatId}\`\n\nCopy this ID and paste it in the ERP Settings page to receive private reports.\n\nThis bot will send you plant readings and auto-collect data requests.`,
              'system'
            );
            continue;
          }

          // Dispatch to handlers
          console.log(`[Telegram] Dispatching to ${incomingHandlers.length} handler(s): chatId=${chatId}, text=${text}`);
          let wasHandled = false;
          for (const handler of incomingHandlers) {
            try {
              const handled = await handler(chatId, text, name);
              if (handled) { wasHandled = true; break; }
            } catch (err) {
              console.error('[Telegram] Handler error:', err);
            }
          }
          if (!wasHandled) {
            console.log(`[Telegram] Message not handled by any handler: chatId=${chatId}`);
          }
        }
      }
    } catch (err: unknown) {
      if (pollingActive) {
        console.error('[Telegram] Poll error:', (err instanceof Error ? err.message : String(err)));
        await new Promise(r => setTimeout(r, 5000)); // back off on error
      }
    }
  }
}
