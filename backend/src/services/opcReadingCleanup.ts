/**
 * OPC Reading Cleanup + Hourly Aggregation
 * 1. Aggregates raw readings into OpcHourlyReading (avg/min/max per hour per tag+property)
 * 2. Purges raw OpcReading rows older than 24h
 * 3. Purges OpcSyncLog rows older than 7 days
 * Runs hourly via setInterval.
 */

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const INITIAL_DELAY_MS = 5 * 60 * 1000; // 5 minutes after startup

let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Server-side hourly aggregation — computes avg/min/max from raw OpcReading
 * and upserts into OpcHourlyReading. Covers all sources (ETHANOL, SUGAR, etc.)
 * so we don't depend on Windows bridges pushing /push-hourly.
 */
async function runHourlyAggregation(opc: any): Promise<number> {
  // Aggregate all raw readings from the last 2 hours into hourly buckets
  // (2h window ensures we catch stragglers from the previous hour)
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const rows: { hour: Date; tag: string; property: string; source: string; avg: number; min: number; max: number; count: number }[] =
    await opc.$queryRawUnsafe(`
      SELECT date_trunc('hour', "scannedAt") AS hour, tag, property, source,
             AVG(value) AS avg, MIN(value) AS min, MAX(value) AS max, COUNT(*)::int AS count
      FROM "OpcReading"
      WHERE "scannedAt" >= $1
      GROUP BY date_trunc('hour', "scannedAt"), tag, property, source
    `, cutoff);

  let upserted = 0;
  for (const r of rows) {
    await opc.opcHourlyReading.upsert({
      where: { tag_property_hour_source: { tag: r.tag, property: r.property, hour: r.hour, source: r.source } },
      create: { tag: r.tag, property: r.property, hour: r.hour, source: r.source, avg: Number(r.avg), min: Number(r.min), max: Number(r.max), count: Number(r.count) },
      update: { avg: Number(r.avg), min: Number(r.min), max: Number(r.max), count: Number(r.count) },
    });
    upserted++;
  }
  return upserted;
}

async function runCleanup(): Promise<void> {
  try {
    if (!process.env.DATABASE_URL_OPC) return;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaClient } = require('@prisma/opc-client');
    const opc = new PrismaClient();

    // Step 1: Aggregate raw readings into hourly buckets BEFORE cleanup
    const aggregated = await runHourlyAggregation(opc);
    if (aggregated > 0) {
      console.log(`[OPC Cleanup] Aggregated ${aggregated} hourly buckets from raw readings`);
    }

    // Step 2: Delete raw readings older than 24 hours
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const readingsDeleted = await opc.opcReading.deleteMany({
      where: { scannedAt: { lt: cutoff24h } },
    });

    // Step 3: Delete sync logs older than 7 days
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
