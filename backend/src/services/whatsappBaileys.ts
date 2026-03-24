/**
 * WhatsApp via Baileys (WhatsApp Web QR login)
 * - FREE, no per-message cost
 * - Session persisted in PostgreSQL (survives Railway deploys)
 * - QR code displayed in ERP Settings page
 */

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  WASocket,
  ConnectionState,
  AuthenticationState,
  SignalDataTypeMap,
  initAuthCreds,
  proto,
  BufferJSON,
} from '@whiskeysockets/baileys';
import * as QRCode from 'qrcode';
import prisma from '../config/prisma';

// ── Types ──

interface AuthState {
  creds: any;
  keys: any;
}

let sock: WASocket | null = null;
let currentQR: string | null = null;        // base64 data URL of QR
let connectionStatus: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
let retryCount = 0;
const MAX_RETRIES = 5;

// ── DB-backed Auth State Store ──

async function loadAuthFromDB(): Promise<any | null> {
  try {
    const row = await prisma.whatsAppSession.findUnique({ where: { id: 'default' } });
    if (row?.data) {
      return JSON.parse(row.data, BufferJSON.reviver);
    }
  } catch (err) {
    console.error('[WA-Baileys] Failed to load auth from DB:', err);
  }
  return null;
}

async function saveAuthToDB(state: any): Promise<void> {
  try {
    const data = JSON.stringify(state, BufferJSON.replacer);
    await prisma.whatsAppSession.upsert({
      where: { id: 'default' },
      create: { id: 'default', data },
      update: { data },
    });
  } catch (err) {
    console.error('[WA-Baileys] Failed to save auth to DB:', err);
  }
}

async function deleteAuthFromDB(): Promise<void> {
  try {
    await prisma.whatsAppSession.deleteMany({ where: { id: 'default' } });
  } catch (err) {
    console.error('[WA-Baileys] Failed to delete auth from DB:', err);
  }
}

// ── Custom auth state backed by DB ──

function useDatabaseAuthState(existingState: any | null): {
  state: { creds: any; keys: any };
  saveCreds: () => Promise<void>;
} {
  const creds = existingState?.creds || initAuthCreds();
  const keys = existingState?.keys || {};

  const state = {
    creds,
    keys: {
      get: (type: string, ids: string[]) => {
        const data: { [id: string]: any } = {};
        for (const id of ids) {
          const value = keys[`${type}-${id}`];
          if (value) {
            data[id] = value;
          }
        }
        return data;
      },
      set: (data: any) => {
        for (const category in data) {
          for (const id in data[category]) {
            const value = data[category][id];
            const key = `${category}-${id}`;
            if (value) {
              keys[key] = value;
            } else {
              delete keys[key];
            }
          }
        }
      },
    },
  };

  const saveCreds = async () => {
    await saveAuthToDB({ creds: state.creds, keys });
  };

  return { state, saveCreds };
}

// ── Connect ──

export async function connectWhatsApp(): Promise<void> {
  if (sock && connectionStatus === 'connected') {
    console.log('[WA-Baileys] Already connected');
    return;
  }

  connectionStatus = 'connecting';
  currentQR = null;

  try {
    const existingAuth = await loadAuthFromDB();
    const { state, saveCreds } = useDatabaseAuthState(existingAuth);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: ['MSPIL ERP', 'Chrome', '22.0'],
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    // Connection updates
    sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        // Generate QR as base64 data URL for the frontend
        try {
          currentQR = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
          console.log('[WA-Baileys] New QR code generated');
        } catch (err) {
          console.error('[WA-Baileys] QR generation failed:', err);
        }
      }

      if (connection === 'close') {
        currentQR = null;
        connectionStatus = 'disconnected';
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;

        if (statusCode === DisconnectReason.loggedOut) {
          console.log('[WA-Baileys] Logged out — clearing session');
          await deleteAuthFromDB();
          sock = null;
          retryCount = 0;
        } else if (retryCount < MAX_RETRIES) {
          retryCount++;
          console.log(`[WA-Baileys] Reconnecting (attempt ${retryCount})...`);
          setTimeout(() => connectWhatsApp(), 3000 * retryCount);
        } else {
          console.error('[WA-Baileys] Max retries reached, giving up');
          sock = null;
        }
      } else if (connection === 'open') {
        currentQR = null;
        connectionStatus = 'connected';
        retryCount = 0;
        console.log('[WA-Baileys] Connected to WhatsApp!');
      }
    });

    // Save credentials whenever they update
    sock.ev.on('creds.update', saveCreds);

  } catch (err) {
    console.error('[WA-Baileys] Connection error:', err);
    connectionStatus = 'disconnected';
  }
}

// ── Disconnect ──

export async function disconnectWhatsApp(): Promise<void> {
  if (sock) {
    try {
      await sock.logout();
    } catch {
      // ignore
    }
    sock = null;
  }
  currentQR = null;
  connectionStatus = 'disconnected';
  retryCount = 0;
  await deleteAuthFromDB();
  console.log('[WA-Baileys] Disconnected and session cleared');
}

// ── Send Message ──

export async function sendWhatsAppMessage(
  phone: string,
  message: string
): Promise<{ success: boolean; error?: string }> {
  if (!sock || connectionStatus !== 'connected') {
    return { success: false, error: 'WhatsApp not connected. Scan QR in Settings.' };
  }

  try {
    // Normalize Indian phone number
    let digits = phone.replace(/\D/g, '');
    if (digits.length === 10) digits = '91' + digits;
    if (digits.startsWith('0') && digits.length === 11) digits = '91' + digits.slice(1);

    const jid = `${digits}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text: message });
    console.log(`[WA-Baileys] Sent message to ${digits}`);
    return { success: true };
  } catch (err: any) {
    console.error('[WA-Baileys] Send failed:', err.message);
    return { success: false, error: err.message };
  }
}

// ── Status Getters ──

export function getQRCode(): string | null {
  return currentQR;
}

export function getConnectionStatus(): string {
  return connectionStatus;
}

export function getConnectedNumber(): string | null {
  if (sock && connectionStatus === 'connected') {
    try {
      const me = sock.user;
      return me?.id?.split(':')[0] || me?.id?.split('@')[0] || null;
    } catch {
      return null;
    }
  }
  return null;
}

// ── Auto-connect on server start (if session exists in DB) ──

export async function initWhatsApp(): Promise<void> {
  try {
    const existing = await prisma.whatsAppSession.findUnique({ where: { id: 'default' } });
    if (existing) {
      console.log('[WA-Baileys] Found existing session, reconnecting...');
      await connectWhatsApp();
    } else {
      console.log('[WA-Baileys] No existing session. Scan QR in Settings to connect.');
    }
  } catch (err) {
    console.log('[WA-Baileys] Init skipped (table may not exist yet)');
  }
}
