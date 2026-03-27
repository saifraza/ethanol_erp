/**
 * WhatsApp Client — proxy layer
 *
 * If WA_WORKER_URL is set, routes all WhatsApp calls to the external worker service.
 * Otherwise falls back to the local Baileys connection (legacy).
 *
 * Usage: import { waSend, waSendGroup, waStatus } from './whatsappClient';
 */

import axios from 'axios';
import { sendWhatsAppMessage, sendToGroup, getConnectionStatus, getQRCode } from './whatsappBaileys';

const WORKER_URL = process.env.WA_WORKER_URL; // e.g. https://wa-worker.railway.internal
const API_KEY = process.env.WA_WORKER_API_KEY || 'mspil-wa-internal';

const workerApi = WORKER_URL
  ? axios.create({
      baseURL: WORKER_URL,
      timeout: 15000,
      headers: { 'x-api-key': API_KEY },
    })
  : null;

export async function waSend(
  phone: string,
  message: string,
  module?: string
): Promise<{ success: boolean; error?: string }> {
  if (workerApi) {
    try {
      const res = await workerApi.post('/wa/send', { phone, message, module });
      return { success: res.data.ok };
    } catch (err: any) {
      const errMsg = err.response?.data?.error || err.message;
      console.error(`[WA-Client] Worker send failed: ${errMsg}`);
      return { success: false, error: errMsg };
    }
  }
  return sendWhatsAppMessage(phone, message, module);
}

export async function waSendGroup(
  groupJid: string,
  message: string,
  module?: string
): Promise<{ success: boolean; error?: string }> {
  if (workerApi) {
    try {
      const res = await workerApi.post('/wa/send-group', { groupJid, message, module });
      return { success: res.data.ok };
    } catch (err: any) {
      const errMsg = err.response?.data?.error || err.message;
      console.error(`[WA-Client] Worker group send failed: ${errMsg}`);
      return { success: false, error: errMsg };
    }
  }
  return sendToGroup(groupJid, message, module);
}

export async function waStatus(): Promise<{ connected: boolean; qr?: string }> {
  if (workerApi) {
    try {
      const res = await workerApi.get('/wa/status');
      return res.data;
    } catch (err: any) {
      return { connected: false };
    }
  }
  return { connected: getConnectionStatus() === 'connected', qr: getQRCode() || undefined };
}
