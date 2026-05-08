/**
 * Telegram Client — thin wrapper around telegramBot.ts.
 * No worker proxy needed — Telegram Bot API is stateless HTTPS.
 *
 * Usage: import { tgSend, tgSendGroup, tgStatus } from './telegramClient';
 */

import { sendTelegramMessage, sendTelegramGroup, getConnectionStatus, getBotInfo } from './telegramBot';

export async function tgSend(
  chatId: string,
  message: string,
  module?: string
): Promise<{ success: boolean; error?: string }> {
  return sendTelegramMessage(chatId, message, module);
}

export async function tgSendGroup(
  chatId: string,
  message: string,
  module?: string
): Promise<{ success: boolean; error?: string }> {
  return sendTelegramGroup(chatId, message, module);
}

export async function tgStatus(): Promise<{ connected: boolean; username?: string }> {
  const status = getConnectionStatus();
  const info = getBotInfo();
  return {
    connected: status === 'connected',
    username: info?.username,
  };
}
