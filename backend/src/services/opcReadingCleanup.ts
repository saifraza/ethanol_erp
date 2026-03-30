/**
 * OPC Reading Cleanup — Purges raw OpcReading rows older than 24h
 * and OpcSyncLog rows older than 7 days. Runs hourly via setInterval.
 */

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const INITIAL_DELAY_MS = 5 * 60 * 1000; // 5 minutes after startup

let cleanupInterval: NodeJS.Timeout | null = null;

async function runCleanup(): Promise<void> {
  try {
    if (!process.env.DATABASE_URL_OPC) return;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaClient } = require('@prisma/opc-client');
    const opc = new PrismaClient();

    // Delete raw readings older than 24 hours
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const readingsDeleted = await opc.opcReading.deleteMany({
      where: { scannedAt: { lt: cutoff24h } },
    });

    // Delete sync logs older than 7 days
    const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const logsDeleted = await opc.opcSyncLog.deleteMany({
      where: { syncedAt: { lt: cutoff7d } },
    });

    if (readingsDeleted.count > 0 || logsDeleted.count > 0) {
      console.log(
        `[OPC Cleanup] Deleted ${readingsDeleted.count} readings (>24h), ${logsDeleted.count} sync logs (>7d)`
      );
    }

    await opc.$disconnect();
  } catch (err) {
    console.error('[OPC Cleanup] Failed:', (err as Error).message);
  }
}

export function startOpcReadingCleanup(): void {
  if (cleanupInterval) return;
  setTimeout(() => {
    runCleanup().catch(() => {});
    cleanupInterval = setInterval(() => {
      runCleanup().catch(() => {});
    }, CLEANUP_INTERVAL_MS);
  }, INITIAL_DELAY_MS);
  console.log('[OPC Cleanup] Started (runs hourly, first run in 5 min)');
}
