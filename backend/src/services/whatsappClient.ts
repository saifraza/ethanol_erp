/**
 * WhatsApp Client — HTTP proxy to mspil-whatsapp Baileys worker
 *
 * Outbound-only push channel. Worker runs as separate Railway service.
 * All sends are fire-and-forget (never throw, log errors silently).
 *
 * Usage: import { waSend, waSendGroup, waStatus } from './whatsappClient';
 */

import axios, { AxiosInstance } from 'axios';
import prisma from '../config/prisma';

// ── Cached worker connection ──

let workerApi: AxiosInstance | null = null;
let cachedConfig: { url: string; key: string } | null = null;

async function getWorkerApi(): Promise<AxiosInstance | null> {
  if (workerApi && cachedConfig) return workerApi;

  try {
    const settings = await prisma.settings.findFirst();
    if (!settings?.whatsappEnabled || !settings.whatsappWorkerUrl) return null;

    cachedConfig = {
      url: settings.whatsappWorkerUrl.replace(/\/+$/, ''),
      key: settings.whatsappWorkerApiKey || 'mspil-wa-internal',
    };

    workerApi = axios.create({
      baseURL: cachedConfig.url,
      timeout: 15_000,
      headers: { 'x-api-key': cachedConfig.key },
    });
    return workerApi;
  } catch (err) {
    console.error('[WhatsApp] Failed to init worker API:', (err as Error).message);
    return null;
  }
}

// ── Public API ──

export interface WaSendResult {
  success: boolean;
  error?: string;
}

export interface WaStatusResult {
  connected: boolean;
  qr?: string;
  phone?: string;
}

/** Send message to a private phone number */
export async function waSend(
  phone: string,
  message: string,
  module?: string
): Promise<WaSendResult> {
  const api = await getWorkerApi();
  if (!api) return { success: false, error: 'WhatsApp not configured' };

  try {
    await api.post('/wa/send', { phone, message });
    // Log outgoing message (fire-and-forget)
    prisma.whatsAppMessage.create({
      data: { direction: 'outgoing', recipient: phone, message, module, status: 'sent' },
    }).catch(() => {});
    return { success: true };
  } catch (err) {
    const errMsg = (err as Error).message;
    console.error(`[WhatsApp] Send to ${phone} failed:`, errMsg);
    prisma.whatsAppMessage.create({
      data: { direction: 'outgoing', recipient: phone, message, module, status: 'failed' },
    }).catch(() => {});
    return { success: false, error: errMsg };
  }
}

/** Send message to a WhatsApp group JID */
export async function waSendGroup(
  groupJid: string,
  message: string,
  module?: string
): Promise<WaSendResult> {
  const api = await getWorkerApi();
  if (!api) return { success: false, error: 'WhatsApp not configured' };

  try {
    await api.post('/wa/send-group', { groupJid, message });
    prisma.whatsAppMessage.create({
      data: { direction: 'outgoing', recipient: groupJid, message, module, status: 'sent' },
    }).catch(() => {});
    return { success: true };
  } catch (err) {
    const errMsg = (err as Error).message;
    console.error(`[WhatsApp] Group send failed:`, errMsg);
    prisma.whatsAppMessage.create({
      data: { direction: 'outgoing', recipient: groupJid, message, module, status: 'failed' },
    }).catch(() => {});
    return { success: false, error: errMsg };
  }
}

/** Check worker connection status */
export async function waStatus(): Promise<WaStatusResult> {
  const api = await getWorkerApi();
  if (!api) return { connected: false };

  try {
    const res = await api.get('/wa/status');
    return res.data;
  } catch {
    return { connected: false };
  }
}

/** Fetch QR code from worker (for Settings page) */
export async function waQr(): Promise<{ qr?: string }> {
  const api = await getWorkerApi();
  if (!api) return {};

  try {
    const res = await api.get('/wa/qr');
    return res.data;
  } catch {
    return {};
  }
}

/** Reset cached config (call when WhatsApp settings are updated) */
export function resetWaConfig(): void {
  cachedConfig = null;
  workerApi = null;
}
