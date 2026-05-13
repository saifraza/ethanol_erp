import app from './app';
import { config } from './config';
import prisma from './config/prisma';
import bcrypt from 'bcryptjs';
import { initTelegram } from './services/telegramBot';
import { initTelegramAutoCollect } from './services/telegramAutoCollect';
import { initTelegramLabor } from './services/telegramLabor';
import { initImageHandler } from './services/telegramImageHandler';
import { initTelegramAiChat } from './services/telegramAiChat';
import { runSchemaDriftGuard } from './services/schemaDriftGuard';
import { startBiometricScheduler } from './services/biometricScheduler';
import { startInventoryAlerts } from './services/inventoryAlerts';
import { startComplianceAlerts } from './services/complianceAlerts';
import { startWebhookProcessor } from './services/webhookDelivery';
import { startDailyWeighmentReport } from './services/dailyWeighmentReport';

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
      await prisma.user.create({ data: { email: 'admin@distillery.com', password: adminHash, name: 'Admin User', role: 'SUPER_ADMIN' } });
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

// One-time: create SUPER_ADMIN user "saif" and upgrade admin@distillery.com
async function migrateSuperAdmin() {
  try {
    // Upgrade existing admin to SUPER_ADMIN
    await prisma.user.updateMany({
      where: { email: 'admin@distillery.com', role: 'ADMIN' },
      data: { role: 'SUPER_ADMIN' },
    });
    // Create "saif" user if not exists
    const exists = await prisma.user.findFirst({ where: { name: { equals: 'saif', mode: 'insensitive' } } });
    if (!exists) {
      const hash = await bcrypt.hash('1234', 10);
      await prisma.user.create({
        data: { email: 'saif@mspil.in', password: hash, name: 'Saif', role: 'SUPER_ADMIN' },
      });
      console.log('[Migration] Created SUPER_ADMIN user "Saif"');
    }
  } catch (e) { console.error('[Migration] SUPER_ADMIN error:', e); }
}

const PORT = config.port;
const HOST = '0.0.0.0';

const server = app.listen(PORT, HOST, async () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
  await autoSeed();
  await migrateSuperAdmin();
  await seedMashBioContract();

  // Schema drift guard — catches missed prisma db push on deploy
  await runSchemaDriftGuard();

  // Biometric devices auto-sync (per-device pull/push intervals from BiometricDevice rows)
  startBiometricScheduler();

  // Initialize Telegram Bot
  initTelegram().then(() => {
    initTelegramAutoCollect().catch((err) => console.error('[TG-AutoCollect] Init error:', err));
    initTelegramLabor();
    initImageHandler();
    initTelegramAiChat();
  }).catch((err) => console.error('[Telegram] Init error:', err));

  // Inventory low stock alerts via Telegram
  startInventoryAlerts();

  // Compliance alerts via Telegram
  startComplianceAlerts();

  // Daily weighment report email at 9:05 AM IST
  startDailyWeighmentReport();

  // Orphan-GRN watchdog: catches the failure mode that produced the Apr-2026
  // missing GRNs — COMPLETE inbound Weighment with no matching GoodsReceipt.
  // Creates a HIGH PlantIssue per orphan and Telegrams the weighbridge group
  // when new ones appear.
  import('./services/orphanGrnWatchdog').then(m => m.startOrphanGrnWatchdog()).catch(() => {});

  // Webhook delivery processor (cloud → factory server)
  startWebhookProcessor();

  // Daily 2 AM IST backup of /app/backend/uploads → neat-shelf bucket (S3-compatible).
  // No-op if AWS_* env vars aren't set.
  import('./services/uploadBackupJob').then(m => m.startUploadBackupJob()).catch(() => {});

  // OPC health watchdog — monitors bridge connectivity, sends Telegram alerts
  if (process.env.DATABASE_URL_OPC) {
    import('./services/opcHealthWatchdog').then(m => m.startOpcWatchdog()).catch(() => {});
    import('./services/opcReadingCleanup').then(m => m.startOpcReadingCleanup()).catch(() => {});
    import('./services/siloSnapshotJob').then(m => m.startSiloSnapshotJob()).catch(() => {});
    // boilerCombustionAlarm moved to bridge-local — see C:\mspil\sugar-opc\fuel_starvation.py
  }

  // Factory cache watchdog — monitors factory-server master-data cache freshness,
  // alerts the WEIGHBRIDGE Telegram group (only) when cache goes stale or the
  // factory-server stops heartbeating. Closes the 2026-05-07 → 05-09 silent
  // outage gap (factory PC's CLOUD_DATABASE_URL drifted, banner shown but
  // unmonitored for 48h).
  import('./services/factoryCacheWatchdog').then(m => m.startFactoryCacheWatchdog()).catch(() => {});

  // Fermenter fill event detector — runs every 5 min; works OPC-first, falls back to lab
  import('./services/fermentation/fillLive').then(m => m.startFillLive()).catch(() => {});

  // RFQ vendor reply poller — every 5 min; pulls IMAP for open INDENT_QUOTE threads
  import('./services/rfqReplyPoller').then(m => m.startRfqReplyPoller()).catch(() => {});
});

