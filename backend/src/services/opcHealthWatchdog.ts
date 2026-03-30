/**
 * OPC Health Watchdog — monitors bridge connectivity via heartbeat and sends Telegram alerts
 * Runs every 3 minutes. Uses bridge heartbeat (phone-home) for faster detection.
 * Also sends daily gap summary at 6 AM IST.
 */

import { tgSendGroup } from './telegramClient';

const CHECK_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes (faster with heartbeat)
const OFFLINE_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes without heartbeat = offline

let watchdogInterval: NodeJS.Timeout | null = null;
let wasOnline = true;
let offlineSince: Date | null = null;
let lastGapSummaryDate = ''; // YYYY-MM-DD IST

function nowIST(): Date {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

function fmtIST(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')} IST`;
}

function istDateStr(): string {
  const ist = nowIST();
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`;
}

async function checkHealth(): Promise<void> {
  try {
    const prisma = (await import('../config/prisma')).default;

    // Try heartbeat-based detection first (faster, no OPC DB query needed)
    let lastSyncTime: Date | null = null;
    let useHeartbeat = false;

    try {
      const { getLatestHeartbeat } = await import('../routes/opcBridge');
      const hb = getLatestHeartbeat();
      if (hb) {
        lastSyncTime = hb.receivedAt;
        useHeartbeat = true;
      }
    } catch { /* heartbeat not available yet */ }

    // Fallback: check OPC sync log if no heartbeat
    if (!useHeartbeat) {
      try {
        if (!process.env.DATABASE_URL_OPC) return;
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { PrismaClient } = require('@prisma/opc-client');
        const opc = new PrismaClient();
        const latestSync = await opc.opcSyncLog.findFirst({
          orderBy: { syncedAt: 'desc' },
          select: { syncedAt: true },
        });
        lastSyncTime = latestSync?.syncedAt || null;
        await opc.$disconnect();
      } catch {
        return; // OPC DB not available
      }
    }

    const now = Date.now();
    const syncAge = lastSyncTime ? now - new Date(lastSyncTime).getTime() : Infinity;
    const thresholdMs = useHeartbeat ? OFFLINE_THRESHOLD_MS : 10 * 60 * 1000; // 10 min for sync log fallback
    const isOnline = syncAge < thresholdMs;

    // Transition: online → offline
    if (wasOnline && !isOnline) {
      offlineSince = new Date();
      const settings = await prisma.settings.findFirst();
      const groupChatId = (settings as any)?.telegramGroupChatId;
      if (groupChatId) {
        const lastSyncStr = lastSyncTime ? fmtIST(lastSyncTime) : 'unknown';
        const detectionMethod = useHeartbeat ? 'heartbeat' : 'sync log';
        const message = `⚠️ *OPC BRIDGE OFFLINE*\n\nFactory bridge not responding (detected via ${detectionMethod}).\n\nPossible causes:\n- Factory internet down\n- Bridge service crashed\n- PC went to sleep\n\nLast contact: ${lastSyncStr}\nDetected at: ${fmtIST(nowIST())}`;
        await tgSendGroup(groupChatId, message, 'opc-health').catch(() => {});
        console.log('[OPC Watchdog] Bridge went OFFLINE — Telegram alert sent');
      }
    }

    // Transition: offline → online
    if (!wasOnline && isOnline && offlineSince) {
      const downtimeMin = Math.round((now - offlineSince.getTime()) / 60000);
      const settings = await prisma.settings.findFirst();
      const groupChatId = (settings as any)?.telegramGroupChatId;
      if (groupChatId) {
        const message = `✅ *OPC BRIDGE RECOVERED*\n\nFactory bridge is back online.\nDowntime: ~${downtimeMin} minutes\nRecovered at: ${fmtIST(nowIST())}`;
        await tgSendGroup(groupChatId, message, 'opc-health').catch(() => {});
        console.log(`[OPC Watchdog] Bridge RECOVERED after ${downtimeMin}min`);
      }
      offlineSince = null;
    }

    wasOnline = isOnline;

    // Daily gap summary at 6 AM IST
    await sendDailyGapSummary(prisma).catch(() => {});
  } catch (err) {
    console.error('[OPC Watchdog] Check failed:', (err as Error).message);
  }
}

async function sendDailyGapSummary(prisma: any): Promise<void> {
  const ist = nowIST();
  const istHour = ist.getUTCHours();
  const todayStr = istDateStr();

  // Send once per day between 6:00-6:10 AM IST
  if (istHour !== 6 || lastGapSummaryDate === todayStr) return;
  lastGapSummaryDate = todayStr;

  try {
    if (!process.env.DATABASE_URL_OPC) return;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaClient } = require('@prisma/opc-client');
    const opc = new PrismaClient();

    const now = new Date();
    const startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Build expected hours
    const expectedHours: Date[] = [];
    const cursor = new Date(startTime);
    cursor.setMinutes(0, 0, 0);
    while (cursor < now) {
      expectedHours.push(new Date(cursor));
      cursor.setTime(cursor.getTime() + 60 * 60 * 1000);
    }

    // Get hours with data
    const hourlyReadings = await opc.opcHourlyReading.findMany({
      where: { hour: { gte: startTime, lte: now } },
      select: { hour: true },
      distinct: ['hour'],
    });
    const existingHours = new Set(hourlyReadings.map((r: { hour: Date }) => r.hour.toISOString()));
    const gapHours = expectedHours.filter(h => !existingHours.has(h.toISOString()));

    await opc.$disconnect();

    const settings = await prisma.settings.findFirst();
    const groupChatId = (settings as any)?.telegramGroupChatId;
    if (!groupChatId) return;

    if (gapHours.length === 0) {
      await tgSendGroup(groupChatId, `✅ *OPC Daily Report*\n\n0 data gaps in last 24h. All systems operational.`, 'opc-health').catch(() => {});
    } else {
      // Group consecutive gaps
      interface GapRange { from: Date; to: Date }
      const gaps: GapRange[] = [];
      for (const gh of gapHours) {
        const last = gaps[gaps.length - 1];
        if (last && gh.getTime() - last.to.getTime() <= 60 * 60 * 1000) {
          last.to = new Date(gh.getTime() + 60 * 60 * 1000);
        } else {
          gaps.push({ from: gh, to: new Date(gh.getTime() + 60 * 60 * 1000) });
        }
      }
      const totalMin = gapHours.length * 60;
      const gapList = gaps.map(g => `  ${fmtIST(g.from)} — ${fmtIST(g.to)}`).join('\n');
      await tgSendGroup(
        groupChatId,
        `⚠️ *OPC Daily Report*\n\n${gaps.length} gap(s) detected in last 24h\nTotal lost: ~${totalMin} minutes\n\n${gapList}`,
        'opc-health'
      ).catch(() => {});
    }

    console.log(`[OPC Watchdog] Daily gap summary sent (${gapHours.length} gap hours)`);
  } catch (err) {
    console.error('[OPC Watchdog] Gap summary failed:', (err as Error).message);
  }
}

export function startOpcWatchdog(): void {
  if (watchdogInterval) return;
  // Wait 2 minutes before first check (let server initialize)
  setTimeout(() => {
    checkHealth().catch(() => {});
    watchdogInterval = setInterval(() => {
      checkHealth().catch(() => {});
    }, CHECK_INTERVAL_MS);
  }, 2 * 60 * 1000);
  console.log('[OPC Watchdog] Started (checks every 3 min via heartbeat, first check in 2 min)');
}

export function stopOpcWatchdog(): void {
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }
}
