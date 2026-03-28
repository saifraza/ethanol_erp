import app from './app';
import { config } from './config';
import prisma from './config/prisma';
import bcrypt from 'bcryptjs';
import { initWhatsApp } from './services/whatsappBaileys';
import { initAutoCollect } from './services/whatsappAutoCollect';
import { initTelegram } from './services/telegramBot';
import { initTelegramAutoCollect } from './services/telegramAutoCollect';

// Prevent crashes from killing the server
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});

// Auto-seed admin user if DB is empty
async function autoSeed() {
  try {
    const count = await prisma.user.count();
    if (count === 0) {
      console.log('No users found — seeding default accounts...');
      const adminHash = await bcrypt.hash('admin123', 10);
      const opHash = await bcrypt.hash('operator123', 10);
      const labHash = await bcrypt.hash('lab@1234', 10);
      await prisma.user.create({ data: { email: 'admin@distillery.com', password: adminHash, name: 'Admin User', role: 'ADMIN' } });
      await prisma.user.create({ data: { email: 'operator@distillery.com', password: opHash, name: 'Operator User', role: 'OPERATOR' } });
      await prisma.user.create({ data: { email: 'lab@mspil.in', password: labHash, name: 'Lab User', role: 'LAB' } });
      console.log('Seed complete.');
    }
  } catch (e) { console.error('Auto-seed error:', e); }
}

const PORT = config.port;
const HOST = '0.0.0.0';

const server = app.listen(PORT, HOST, async () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
  await autoSeed();

  // Initialize Telegram Bot (replaces WhatsApp)
  initTelegram().catch((err) => console.error('[Telegram] Init error:', err));
  initTelegramAutoCollect().catch((err) => console.error('[TG-AutoCollect] Init error:', err));

  // Legacy WhatsApp: only init if WA_WORKER_URL is NOT set AND no Telegram token
  if (!process.env.TELEGRAM_BOT_TOKEN && !process.env.WA_WORKER_URL) {
    initWhatsApp().catch((err) => console.error('[WA] Init error:', err));
    initAutoCollect().catch((err) => console.error('[AutoCollect] Init error:', err));
  }

  // OPC health watchdog — monitors bridge connectivity, sends Telegram alerts
  if (process.env.DATABASE_URL_OPC) {
    import('./services/opcHealthWatchdog').then(m => m.startOpcWatchdog()).catch(() => {});
  }
});

