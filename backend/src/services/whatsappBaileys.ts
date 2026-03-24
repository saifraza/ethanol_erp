/**
 * WhatsApp via Baileys (WhatsApp Web QR login)
 * - FREE, no per-message cost
 * - Session persisted in PostgreSQL (survives Railway deploys)
 * - QR code displayed in ERP Settings page
 *
 * NOTE: @whiskeysockets/baileys is ESM-only.
 *       We use dynamic import() to load it from CommonJS.
 */

import prisma from '../config/prisma';

// ── Lazy-loaded ESM modules ──
// Use Function constructor to hide import() from TypeScript compiler,
// which otherwise converts it to require() under "module": "commonjs".

let _baileys: any = null;
let _qrcode: any = null;

const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

async function getBaileys(): Promise<any> {
  if (!_baileys) {
    _baileys = await dynamicImport('@whiskeysockets/baileys');
  }
  return _baileys;
}

async function getQRCodeLib(): Promise<any> {
  if (!_qrcode) {
    _qrcode = await dynamicImport('qrcode');
  }
  return _qrcode;
}

// ── State ──

let sock: any = null;
let currentQR: string | null = null;
let connectionStatus: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
let retryCount = 0;
const MAX_RETRIES = 5;

// ── Incoming message handlers ──
// External services (like auto-collect) can register handlers.
// If any handler returns true, the message is considered "handled".
type IncomingHandler = (phone: string, text: string, name: string | null) => Promise<boolean>;
const incomingHandlers: IncomingHandler[] = [];

export function registerIncomingHandler(handler: IncomingHandler): void {
  incomingHandlers.push(handler);
}

export function removeIncomingHandler(handler: IncomingHandler): void {
  const idx = incomingHandlers.indexOf(handler);
  if (idx >= 0) incomingHandlers.splice(idx, 1);
}

// ── DB-backed Auth State Store ──

async function loadAuthFromDB(): Promise<any | null> {
  try {
    const baileys = await getBaileys();
    const row = await prisma.whatsAppSession.findUnique({ where: { id: 'default' } });
    if (row?.data) {
      return JSON.parse(row.data, baileys.BufferJSON.reviver);
    }
  } catch (err) {
    console.error('[WA-Baileys] Failed to load auth from DB:', err);
  }
  return null;
}

async function saveAuthToDB(state: any): Promise<void> {
  try {
    const baileys = await getBaileys();
    const data = JSON.stringify(state, baileys.BufferJSON.replacer);
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

async function useDatabaseAuthState(existingState: any | null): Promise<{
  state: { creds: any; keys: any };
  saveCreds: () => Promise<void>;
}> {
  const baileys = await getBaileys();
  const creds = existingState?.creds || baileys.initAuthCreds();
  const keys: Record<string, any> = existingState?.keys || {};

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
    const baileys = await getBaileys();
    const QRCode = await getQRCodeLib();
    const existingAuth = await loadAuthFromDB();
    const { state, saveCreds } = await useDatabaseAuthState(existingAuth);
    const { version } = await baileys.fetchLatestBaileysVersion();

    const makeWASocket = baileys.default || baileys.makeWASocket;

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
    sock.ev.on('connection.update', async (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
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

        if (statusCode === baileys.DisconnectReason.loggedOut) {
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

    // Listen for incoming messages and store in DB
    sock.ev.on('messages.upsert', async (m: any) => {
      if (!m.messages) return;
      for (const msg of m.messages) {
        if (!msg.message || msg.key.fromMe) continue;
        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          '[media]';
        const phone = msg.key.remoteJid?.replace('@s.whatsapp.net', '') || '';
        const name = msg.pushName || null;
        try {
          await prisma.whatsAppMessage.create({
            data: { direction: 'incoming', phone, name, message: text },
          });
          console.log(`[WA-Baileys] Incoming from ${phone}: ${text.slice(0, 50)}`);
        } catch (err) {
          console.error('[WA-Baileys] Failed to save incoming msg:', err);
        }

        // Notify registered handlers (e.g. auto-collect)
        for (const handler of incomingHandlers) {
          try {
            const handled = await handler(phone, text, name);
            if (handled) break; // stop after first handler claims it
          } catch (herr) {
            console.error('[WA-Baileys] Handler error:', herr);
          }
        }
      }
    });

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
  message: string,
  module?: string
): Promise<{ success: boolean; error?: string }> {
  if (!sock || connectionStatus !== 'connected') {
    return { success: false, error: 'WhatsApp not connected. Scan QR in Settings.' };
  }

  try {
    let digits = phone.replace(/\D/g, '');
    if (digits.length === 10) digits = '91' + digits;
    if (digits.startsWith('0') && digits.length === 11) digits = '91' + digits.slice(1);

    const jid = `${digits}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text: message });
    console.log(`[WA-Baileys] Sent message to ${digits}`);

    // Log outgoing message
    try {
      await prisma.whatsAppMessage.create({
        data: { direction: 'outgoing', phone: digits, message, module: module || null },
      });
    } catch { /* non-critical */ }

    return { success: true };
  } catch (err: any) {
    console.error('[WA-Baileys] Send failed:', err.message);
    return { success: false, error: err.message };
  }
}

// ── Send to Group ──

export async function sendToGroup(
  groupJid: string,
  message: string,
  module?: string
): Promise<{ success: boolean; error?: string }> {
  if (!sock || connectionStatus !== 'connected') {
    return { success: false, error: 'WhatsApp not connected. Scan QR in Settings.' };
  }

  try {
    await sock.sendMessage(groupJid, { text: message });
    console.log(`[WA-Baileys] Sent to group ${groupJid}`);

    try {
      await prisma.whatsAppMessage.create({
        data: { direction: 'outgoing', phone: groupJid, message, module: module || null },
      });
    } catch { /* non-critical */ }

    return { success: true };
  } catch (err: any) {
    console.error('[WA-Baileys] Group send failed:', err.message);
    return { success: false, error: err.message };
  }
}

// ── List Groups ──

export async function listGroups(): Promise<{ id: string; subject: string; size: number }[]> {
  if (!sock || connectionStatus !== 'connected') return [];
  try {
    const groups = await sock.groupFetchAllParticipating();
    return Object.values(groups).map((g: any) => ({
      id: g.id,
      subject: g.subject,
      size: g.participants?.length || 0,
    }));
  } catch (err) {
    console.error('[WA-Baileys] Failed to list groups:', err);
    return [];
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
