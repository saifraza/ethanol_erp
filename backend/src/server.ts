import app from './app';
import { config } from './config';
import prisma from './config/prisma';
import bcrypt from 'bcryptjs';
import { initTelegram } from './services/telegramBot';
import { initTelegramAutoCollect } from './services/telegramAutoCollect';
import { initImageHandler } from './services/telegramImageHandler';
import { startInventoryAlerts } from './services/inventoryAlerts';
import { startWebhookProcessor } from './services/webhookDelivery';

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

// One-time seed: Mash Bio Job Work Contract
async function seedMashBioContract() {
  try {
    const exists = await prisma.ethanolContract.findFirst({ where: { contractNo: 'MSPIL/JW/MASH/2026-01' } });
    if (exists) return;
    await prisma.ethanolContract.create({
      data: {
        contractNo: 'MSPIL/JW/MASH/2026-01',
        contractType: 'JOB_WORK',
        status: 'ACTIVE',
        buyerName: 'Mash Bio',
        principalName: 'Mash Bio',
        conversionRate: 14,
        startDate: new Date('2026-02-21'),
        endDate: new Date('2026-04-20'),
        contractQtyKL: 10000,
        dailyTargetKL: 175,
        gstPercent: 18,
        supplyType: 'INTRA_STATE',
        logisticsBy: 'BUYER',
        paymentTermsDays: 15,
        paymentMode: 'NEFT',
        remarks: 'Corn-based ethanol job work. Mash Bio supplies corn, MSPIL converts to ethanol at Rs.14/BL. Target: 1 crore liters (10,000 KL) by 20-Apr-2026.',
        userId: 'system',
      },
    });
    console.log('[Seed] Mash Bio Job Work contract created');
  } catch (e) { console.error('[Seed] Mash Bio contract error:', e); }
}

const PORT = config.port;
const HOST = '0.0.0.0';

const server = app.listen(PORT, HOST, async () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
  await autoSeed();
  await seedMashBioContract();

  // Initialize Telegram Bot
  initTelegram().then(() => {
    initTelegramAutoCollect().catch((err) => console.error('[TG-AutoCollect] Init error:', err));
    initImageHandler();
  }).catch((err) => console.error('[Telegram] Init error:', err));

  // Inventory low stock alerts via Telegram
  startInventoryAlerts();

  // Webhook delivery processor (cloud → factory server)
  startWebhookProcessor();

  // OPC health watchdog — monitors bridge connectivity, sends Telegram alerts
  if (process.env.DATABASE_URL_OPC) {
    import('./services/opcHealthWatchdog').then(m => m.startOpcWatchdog()).catch(() => {});
    import('./services/opcReadingCleanup').then(m => m.startOpcReadingCleanup()).catch(() => {});
  }
});

