/**
 * WhatsApp Bot using Baileys (QR scan, free)
 * Uses dynamic import() since Baileys v7 is ESM-only
 */
import path from 'path';
import fs from 'fs';
import { chat } from './aiChat';

// ── State ──
let sock: any = null;
let qrCode: string | null = null;
let connectionStatus: 'disconnected' | 'connecting' | 'qr' | 'connected' = 'disconnected';
let statusMessage = 'Not started';

// Conversation history per chat (last 10 messages)
const conversations = new Map<string, { role: string; content: string }[]>();

// Allowed phone numbers (empty = allow all)
const allowedNumbers = (process.env.WHATSAPP_ALLOWED_NUMBERS || '').split(',').filter(Boolean);

const AUTH_DIR = path.resolve(__dirname, '../../whatsapp-auth');

export function getStatus() {
  return { status: connectionStatus, message: statusMessage, qr: qrCode, connected: connectionStatus === 'connected' };
}

export async function startBot() {
  if (sock) {
    console.log('[WA Bot] Already running');
    return;
  }

  // Dynamic import for ESM module
  const baileys = await import('@whiskeysockets/baileys');
  const makeWASocket = baileys.default;
  const { useMultiFileAuthState, DisconnectReason } = baileys;

  // Ensure auth directory exists
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

  connectionStatus = 'connecting';
  statusMessage = 'Connecting...';
  qrCode = null;

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    browser: ['MSPIL ERP', 'Chrome', '1.0'] as any,
  });

  // ── Connection events ──
  sock.ev.on('connection.update', (update: any) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCode = qr;
      connectionStatus = 'qr';
      statusMessage = 'Scan QR code with WhatsApp';
      console.log('[WA Bot] QR code generated — scan from ERP dashboard');
    }

    if (connection === 'close') {
      const reason = (lastDisconnect?.error as any)?.output?.statusCode;
      connectionStatus = 'disconnected';
      sock = null;

      if (reason === DisconnectReason.loggedOut) {
        statusMessage = 'Logged out. Clear session and reconnect.';
        if (fs.existsSync(AUTH_DIR)) {
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        }
        console.log('[WA Bot] Logged out — auth cleared');
      } else {
        statusMessage = `Disconnected (${reason}). Reconnecting in 5s...`;
        console.log(`[WA Bot] Disconnected: ${reason}. Reconnecting...`);
        setTimeout(() => startBot(), 5000);
      }
    }

    if (connection === 'open') {
      qrCode = null;
      connectionStatus = 'connected';
      statusMessage = 'Connected to WhatsApp';
      console.log('[WA Bot] Connected!');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // ── Message handler ──
  sock.ev.on('messages.upsert', async ({ messages, type }: any) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const chatId = msg.key.remoteJid!;
      const senderNumber = chatId.replace('@s.whatsapp.net', '').replace('@g.us', '');

      // Skip group messages
      if (chatId.endsWith('@g.us')) continue;

      // Check allowed numbers
      if (allowedNumbers.length > 0 && !allowedNumbers.includes(senderNumber)) {
        console.log(`[WA Bot] Blocked: ${senderNumber}`);
        continue;
      }

      // Extract text
      const text = msg.message.conversation
        || msg.message.extendedTextMessage?.text
        || '';

      if (!text.trim()) continue;

      console.log(`[WA Bot] ${senderNumber}: ${text}`);

      try {
        const history = conversations.get(chatId) || [];

        // Mark as read + typing
        await sock!.readMessages([msg.key]);
        await sock!.sendPresenceUpdate('composing', chatId);

        // Get AI response
        const reply = await chat(text, history);

        // Send reply
        await sock!.sendMessage(chatId, { text: reply });
        await sock!.sendPresenceUpdate('paused', chatId);

        // Update history (keep last 10 exchanges)
        history.push({ role: 'user', content: text });
        history.push({ role: 'assistant', content: reply });
        if (history.length > 20) history.splice(0, 2);
        conversations.set(chatId, history);

        console.log(`[WA Bot] → ${reply.slice(0, 100)}...`);
      } catch (err: any) {
        console.error(`[WA Bot] Error:`, err.message);
        try {
          await sock!.sendMessage(chatId, { text: 'Sorry, error. Try again.' });
        } catch { /* ignore */ }
      }
    }
  });
}

export async function stopBot() {
  if (sock) {
    await sock.logout().catch(() => {});
    sock = null;
    connectionStatus = 'disconnected';
    statusMessage = 'Stopped';
    qrCode = null;
    if (fs.existsSync(AUTH_DIR)) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    }
  }
}

export async function sendMessage(phone: string, message: string) {
  if (!sock || connectionStatus !== 'connected') {
    throw new Error('WhatsApp not connected');
  }
  const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
  await sock.sendMessage(jid, { text: message });
}
