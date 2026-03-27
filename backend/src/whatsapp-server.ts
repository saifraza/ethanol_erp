/**
 * Standalone WhatsApp Worker Service
 *
 * Runs independently from the main ERP server.
 * Handles: WhatsApp connection (Baileys), auto-collect scheduler, message sending.
 *
 * The ERP communicates with this service via HTTP:
 *   POST /wa/send          — Send a message to a phone number
 *   POST /wa/send-group    — Send a message to a WhatsApp group
 *   POST /wa/send-report   — Send a formatted report
 *   GET  /wa/status        — Check connection status
 *   GET  /wa/qr            — Get QR code for scanning
 *   POST /wa/connect       — Trigger WhatsApp connection
 *   POST /wa/disconnect    — Disconnect WhatsApp
 *
 * Deploy as a separate Railway service:
 *   Start command: cd backend && node dist/whatsapp-server.js
 */

import express from 'express';
import prisma from './config/prisma';
import {
  connectWhatsApp,
  disconnectWhatsApp,
  sendWhatsAppMessage,
  sendToGroup,
  getConnectionStatus,
  getQRCode,
  initWhatsApp,
} from './services/whatsappBaileys';
import { initAutoCollect } from './services/whatsappAutoCollect';

// Prevent crashes
process.on('uncaughtException', (err) => {
  console.error('[WA-Worker] Uncaught Exception:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[WA-Worker] Unhandled Rejection:', err);
});

const app = express();
app.use(express.json());

// Simple shared secret for auth between ERP and worker
const API_KEY = process.env.WA_WORKER_API_KEY || 'mspil-wa-internal';

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const key = req.headers['x-api-key'] || req.query.key;
  if (key !== API_KEY) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// ── Health check (no auth) ──
app.get('/wa/health', (_req, res) => {
  res.json({ ok: true, service: 'whatsapp-worker', uptime: process.uptime() });
});

// ── Status ──
app.get('/wa/status', authMiddleware, (_req, res) => {
  res.json({ connected: getConnectionStatus() === 'connected', status: getConnectionStatus() });
});

// ── QR Code ──
app.get('/wa/qr', authMiddleware, (_req, res) => {
  const qr = getQRCode();
  const connected = getConnectionStatus() === 'connected';
  if (qr) {
    res.json({ qr });
  } else if (connected) {
    res.json({ connected: true, message: 'Already connected' });
  } else {
    res.json({ connected: false, message: 'No QR available, try /wa/connect first' });
  }
});

// ── Connect ──
app.post('/wa/connect', authMiddleware, async (_req, res) => {
  try {
    await connectWhatsApp();
    res.json({ ok: true, message: 'Connection initiated' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Disconnect ──
app.post('/wa/disconnect', authMiddleware, async (_req, res) => {
  try {
    await disconnectWhatsApp();
    res.json({ ok: true, message: 'Disconnected' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Send message to phone ──
app.post('/wa/send', authMiddleware, async (req, res) => {
  const { phone, message, module } = req.body;
  if (!phone || !message) {
    res.status(400).json({ error: 'phone and message required' });
    return;
  }
  const result = await sendWhatsAppMessage(phone, message, module);
  if (result.success) {
    res.json({ ok: true });
  } else {
    res.status(500).json({ error: result.error });
  }
});

// ── Send message to group ──
app.post('/wa/send-group', authMiddleware, async (req, res) => {
  const { groupJid, message, module } = req.body;
  if (!groupJid || !message) {
    res.status(400).json({ error: 'groupJid and message required' });
    return;
  }
  const result = await sendToGroup(groupJid, message, module);
  if (result.success) {
    res.json({ ok: true });
  } else {
    res.status(500).json({ error: result.error });
  }
});

// ── Send report (legacy compatibility) ──
app.post('/wa/send-report', authMiddleware, async (req, res) => {
  const { groupJid, message, module, isPrivate, phones } = req.body;
  const results: any[] = [];

  // Send to group if not private-only
  if (groupJid && !isPrivate) {
    const groupResult = await sendToGroup(groupJid, message, module);
    results.push({ type: 'group', ...groupResult });
  }

  // Send to individual phones
  if (phones && Array.isArray(phones)) {
    for (const phone of phones) {
      const r = await sendWhatsAppMessage(phone, message, module);
      results.push({ type: 'private', phone, ...r });
    }
  }

  res.json({ ok: true, results });
});

// ── Start ──
const PORT = parseInt(process.env.WA_WORKER_PORT || '5001');
const HOST = '0.0.0.0';

app.listen(PORT, HOST, async () => {
  console.log(`[WA-Worker] Running on http://${HOST}:${PORT}`);

  // Connect WhatsApp
  console.log('[WA-Worker] Initializing WhatsApp...');
  await initWhatsApp().catch((err) => console.error('[WA-Worker] WA init error:', err));

  // Start auto-collect scheduler
  console.log('[WA-Worker] Starting auto-collect scheduler...');
  await initAutoCollect().catch((err) => console.error('[WA-Worker] AutoCollect init error:', err));

  console.log('[WA-Worker] Ready!');
});
