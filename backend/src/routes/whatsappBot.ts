import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { getStatus, startBot, stopBot, sendMessage } from '../services/whatsappBot';
import { chat } from '../services/aiChat';

const router = Router();

// Public endpoint: QR code page (no auth — needs to be accessible easily)
router.get('/qr', (_req: Request, res: Response) => {
  const { status, qr, message } = getStatus();
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html><head><title>MSPIL WhatsApp Bot</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:system-ui;background:#0a1628;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .card{background:#1a2744;border-radius:16px;padding:32px;text-align:center;max-width:400px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.3)}
  h1{font-size:20px;margin:0 0 4px}
  .sub{color:#8892a4;font-size:13px;margin-bottom:20px}
  .status{display:inline-block;padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600;margin-bottom:16px}
  .connected{background:#065f46;color:#6ee7b7}
  .qr-status{background:#92400e;color:#fcd34d}
  .disconnected{background:#7f1d1d;color:#fca5a5}
  .qr-box{background:#fff;border-radius:12px;padding:16px;display:inline-block;margin:12px 0}
  .qr-box img{display:block}
  .hint{color:#64748b;font-size:11px;margin-top:12px}
  .btn{display:inline-block;padding:10px 24px;border-radius:8px;border:none;font-size:13px;font-weight:600;cursor:pointer;margin:6px}
  .btn-green{background:#059669;color:#fff}
  .btn-red{background:#dc2626;color:#fff}
  .btn:hover{opacity:.9}
</style>
${status === 'qr' ? '<meta http-equiv="refresh" content="30">' : status !== 'connected' ? '<meta http-equiv="refresh" content="5">' : ''}
</head><body>
<div class="card">
  <h1>MSPIL WhatsApp Bot</h1>
  <p class="sub">AI-powered plant assistant</p>
  <div class="status ${status === 'connected' ? 'connected' : status === 'qr' ? 'qr-status' : 'disconnected'}">
    ${status === 'connected' ? '● Connected' : status === 'qr' ? '◌ Waiting for QR scan' : status === 'connecting' ? '◌ Connecting...' : '○ Disconnected'}
  </div>
  <p style="font-size:13px;color:#94a3b8">${message}</p>
  ${qr ? `
    <div class="qr-box">
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(qr)}" width="256" height="256" alt="QR Code" />
    </div>
    <p class="hint">Open WhatsApp → Settings → Linked Devices → Link a Device → Scan this QR</p>
  ` : ''}
  ${status === 'connected' ? `
    <p style="color:#6ee7b7;font-size:14px;font-weight:600">✓ Bot is running! Send a message to test.</p>
    <form method="POST" action="/api/whatsapp-bot/stop"><button class="btn btn-red" type="submit">Disconnect</button></form>
  ` : status === 'disconnected' ? `
    <form method="POST" action="/api/whatsapp-bot/start"><button class="btn btn-green" type="submit">Start Bot</button></form>
  ` : ''}
</div>
</body></html>`);
});

// Start bot
router.post('/start', (_req: Request, res: Response) => {
  startBot();
  res.redirect('/api/whatsapp-bot/qr');
});

// Stop bot
router.post('/stop', (_req: Request, res: Response) => {
  stopBot();
  res.redirect('/api/whatsapp-bot/qr');
});

// ── API endpoints (auth required) ──
router.use(authenticate as any);

// Status API
router.get('/status', (_req: Request, res: Response) => {
  res.json(getStatus());
});

// Send message API
router.post('/send', async (req: Request, res: Response) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) { res.status(400).json({ error: 'phone and message required' }); return; }
    await sendMessage(phone, message);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Test AI chat (without WhatsApp — for debugging)
router.post('/test-chat', async (req: Request, res: Response) => {
  try {
    const { message } = req.body;
    if (!message) { res.status(400).json({ error: 'message required' }); return; }
    const reply = await chat(message);
    res.json({ reply });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
