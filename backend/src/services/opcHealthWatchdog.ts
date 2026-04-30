/**
 * OPC Health Watchdog — monitors bridge connectivity via heartbeat and sends Telegram alerts
 * Runs every 3 minutes. Uses bridge heartbeat (phone-home) for faster detection.
 * Also sends daily gap summary at 6 AM IST.
 *
 * 2026-04-08 hardening (after 24h zombie outage):
 *  - Re-alert every 30 min while offline (was single-fire on transition only)
 *  - State persists in Settings.opcWatchdogState (survives Railway restarts)
 *  - Cold-start state is `null` (unknown) — first check establishes baseline, second check can alert
 *  - Detects "fresh heartbeat but stale scans" (scanner zombification): if heartbeat <3min old
 *    but lastScanCompletedAt >10min old → bridge is alive but not scanning → alert
 */

import { broadcastToGroup } from './messagingGateway';
import { getOpcPrisma, isOpcAvailable } from '../config/opcPrisma';

const CHECK_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes
const OFFLINE_THRESHOLD_MS = 3 * 60 * 1000; // 3 min without heartbeat = offline
const SCAN_STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 min without successful scan = scanner zombified
const REALERT_INTERVAL_MS = 30 * 60 * 1000; // re-alert every 30 min while offline

let watchdogInterval: NodeJS.Timeout | null = null;
// State machine: null = unknown (cold start), true = online, false = offline
let wasOnline: boolean | null = null;
let offlineSince: Date | null = null;
let lastAlertSentAt: Date | null = null;
let scannerStuckSince: Date | null = null;
let lastScannerAlertAt: Date | null = null;
let lastGapSummaryDate = ''; // YYYY-MM-DD IST
let stateLoaded = false;

interface PersistedState {
  wasOnline: boolean | null;
  offlineSince: string | null;
  lastAlertSentAt: string | null;
  scannerStuckSince: string | null;
  lastScannerAlertAt: string | null;
}

async function loadState(prisma: any): Promise<void> {
  if (stateLoaded) return;
  try {
    const settings = await prisma.settings.findFirst();
    const raw = (settings as any)?.opcWatchdogState as string | null | undefined;
    if (raw) {
      const s: PersistedState = JSON.parse(raw);
      wasOnline = s.wasOnline;
      offlineSince = s.offlineSince ? new Date(s.offlineSince) : null;
      lastAlertSentAt = s.lastAlertSentAt ? new Date(s.lastAlertSentAt) : null;
      scannerStuckSince = s.scannerStuckSince ? new Date(s.scannerStuckSince) : null;
      lastScannerAlertAt = s.lastScannerAlertAt ? new Date(s.lastScannerAlertAt) : null;
      console.log('[OPC Watchdog] State restored from DB');
    }
  } catch { /* column may not exist yet — first run */ }
  stateLoaded = true;
}

async function saveState(prisma: any): Promise<void> {
  try {
    const settings = await prisma.settings.findFirst();
    if (!settings) return;
    const s: PersistedState = {
      wasOnline,
      offlineSince: offlineSince?.toISOString() ?? null,
      lastAlertSentAt: lastAlertSentAt?.toISOString() ?? null,
      scannerStuckSince: scannerStuckSince?.toISOString() ?? null,
      lastScannerAlertAt: lastScannerAlertAt?.toISOString() ?? null,
    };
    await prisma.settings.update({
      where: { id: settings.id },
      data: { opcWatchdogState: JSON.stringify(s) } as any,
    });
  } catch { /* column may not exist — log column needs migration */ }
}

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

async function getAlertChatIds(prisma: any): Promise<string[]> {
  const ids: string[] = [];
  try {
    const settings = await prisma.settings.findFirst();
    const groupId = (settings as any)?.telegramGroupChatId;
    const group2Id = (settings as any)?.telegramGroup2ChatId;
    const privateRaw = (settings as any)?.telegramPrivateChatIds as string | undefined;
    if (groupId) ids.push(groupId);
    if (group2Id && !ids.includes(group2Id)) ids.push(group2Id);
    if (privateRaw) {
      for (const p of privateRaw.split(',').map((s) => s.trim()).filter(Boolean)) {
        if (!ids.includes(p)) ids.push(p);
      }
    }
  } catch { /* ignore */ }
  // Env-var fallback so alerts work even if Settings row is missing/broken
  const envChat = process.env.OPC_ALERT_CHAT_ID;
  if (envChat && !ids.includes(envChat)) ids.push(envChat);
  return ids;
}

async function sendAlert(prisma: any, message: string): Promise<boolean> {
  const chats = await getAlertChatIds(prisma);
  if (chats.length === 0) {
    console.warn('[OPC Watchdog] Cannot alert — no chat IDs configured (Settings.telegramGroupChatId / OPC_ALERT_CHAT_ID)');
    return false;
  }
  let any = false;
  for (const chat of chats) {
    try {
      await broadcastToGroup(chat, message, 'opc-health');
      any = true;
    } catch (err) {
      console.error(`[OPC Watchdog] Alert send failed to ${chat}:`, (err as Error).message);
    }
  }
  return any;
}

async function checkHealth(): Promise<void> {
  try {
    const prisma = (await import('../config/prisma')).default;
    await loadState(prisma);

    // ---- Source 1: in-memory heartbeat (fastest) ----
    let lastSyncTime: Date | null = null;
    let useHeartbeat = false;
    let lastScanCompletedAt: Date | null = null;
    try {
      const { getLatestHeartbeat } = await import('../routes/opcBridge');
      const hb = getLatestHeartbeat();
      if (hb) {
        lastSyncTime = hb.receivedAt;
        useHeartbeat = true;
        const lscRaw = (hb as any).lastScanCompletedAt;
        if (lscRaw) lastScanCompletedAt = new Date(lscRaw);
      }
    } catch { /* heartbeat not available yet */ }

    // ---- Source 2: OPC sync log fallback ----
    if (!useHeartbeat) {
      try {
        if (isOpcAvailable()) {
          const opc = getOpcPrisma();
          const latestSync = await opc.opcSyncLog.findFirst({
            orderBy: { syncedAt: 'desc' },
            select: { syncedAt: true },
          });
          lastSyncTime = latestSync?.syncedAt || null;
          // shared singleton — do not disconnect
        }
      } catch (err) {
        console.warn('[OPC Watchdog] Sync log fallback failed:', (err as Error).message);
      }
    }

    const now = Date.now();
    const syncAge = lastSyncTime ? now - new Date(lastSyncTime).getTime() : Infinity;
    const thresholdMs = useHeartbeat ? OFFLINE_THRESHOLD_MS : 10 * 60 * 1000;
    const isOnline = syncAge < thresholdMs;

    // ---- Detect scanner zombification (heartbeat fresh but scans stale) ----
    const scanAge = lastScanCompletedAt ? now - lastScanCompletedAt.getTime() : null;
    const scannerStuck =
      isOnline && scanAge !== null && scanAge > SCAN_STALE_THRESHOLD_MS;

    // ---- OFFLINE handling: alert + re-alert every 30 min ----
    if (wasOnline === null) {
      // Cold start — establish baseline silently, do not alert
      wasOnline = isOnline;
      if (!isOnline) {
        offlineSince = new Date();
      }
    } else if (wasOnline && !isOnline) {
      // Transition online → offline
      offlineSince = new Date();
      const lastSyncStr = lastSyncTime ? fmtIST(lastSyncTime) : 'unknown';
      const method = useHeartbeat ? 'heartbeat' : 'sync log';
      const sent = await sendAlert(
        prisma,
        `⚠️ *OPC BRIDGE OFFLINE*\n\nFactory bridge not responding (${method}).\n\nLast contact: ${lastSyncStr}\nDetected: ${fmtIST(nowIST())}\n\nWill re-alert every 30 min while down.`,
      );
      if (sent) lastAlertSentAt = new Date();
      console.log('[OPC Watchdog] Bridge OFFLINE — alert dispatched:', sent);
      wasOnline = false;
    } else if (!wasOnline && !isOnline) {
      // Still offline — re-alert every 30 min
      const sinceLast = lastAlertSentAt ? now - lastAlertSentAt.getTime() : Infinity;
      if (sinceLast >= REALERT_INTERVAL_MS) {
        const downMin = offlineSince ? Math.round((now - offlineSince.getTime()) / 60000) : 0;
        const sent = await sendAlert(
          prisma,
          `🚨 *OPC BRIDGE STILL OFFLINE*\n\nDown for ~${downMin} min.\nLast contact: ${lastSyncTime ? fmtIST(lastSyncTime) : 'never'}\nNow: ${fmtIST(nowIST())}\n\nCheck factory PC immediately.`,
        );
        if (sent) lastAlertSentAt = new Date();
        console.log(`[OPC Watchdog] Re-alert sent (down ${downMin}min)`);
      }
    } else if (!wasOnline && isOnline) {
      // Recovered
      const downMin = offlineSince ? Math.round((now - offlineSince.getTime()) / 60000) : 0;
      await sendAlert(
        prisma,
        `✅ *OPC BRIDGE RECOVERED*\n\nBack online after ~${downMin} min.\nRecovered: ${fmtIST(nowIST())}`,
      );
      console.log(`[OPC Watchdog] RECOVERED after ${downMin}min`);
      offlineSince = null;
      lastAlertSentAt = null;
      wasOnline = true;
    }

    // ---- Scanner-zombified handling (independent state machine) ----
    if (scannerStuck) {
      if (!scannerStuckSince) scannerStuckSince = new Date();
      const sinceLast = lastScannerAlertAt ? now - lastScannerAlertAt.getTime() : Infinity;
      if (sinceLast >= REALERT_INTERVAL_MS) {
        const stuckMin = scanAge !== null ? Math.round(scanAge / 60000) : 0;
        await sendAlert(
          prisma,
          `🧟 *OPC SCANNER ZOMBIFIED*\n\nBridge heartbeat is fresh but no scans completed for ~${stuckMin} min.\nLast scan: ${lastScanCompletedAt ? fmtIST(lastScanCompletedAt) : 'unknown'}\n\nThe bridge process is alive but the scanner thread is stuck. Restart the OPC bridge on the factory PC.`,
        );
        lastScannerAlertAt = new Date();
        console.log(`[OPC Watchdog] Scanner zombified alert sent (${stuckMin}min stuck)`);
      }
    } else if (scannerStuckSince && lastScanCompletedAt && scanAge !== null && scanAge < SCAN_STALE_THRESHOLD_MS) {
      // Scanner recovered
      const stuckMin = Math.round((now - scannerStuckSince.getTime()) / 60000);
      await sendAlert(
        prisma,
        `✅ *OPC SCANNER RECOVERED*\n\nScans flowing again after ~${stuckMin} min stuck.`,
      );
      scannerStuckSince = null;
      lastScannerAlertAt = null;
    }

    await saveState(prisma);

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
    if (!isOpcAvailable()) return;
    const opc = getOpcPrisma();

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
    
    take: 500,
  });
    const existingHours = new Set(hourlyReadings.map((r: { hour: Date }) => r.hour.toISOString()));
    const gapHours = expectedHours.filter(h => !existingHours.has(h.toISOString()));

    // shared singleton — do not disconnect

    const settings = await prisma.settings.findFirst();
    const groupChatId = (settings as any)?.telegramGroupChatId;
    if (!groupChatId) return;

    if (gapHours.length === 0) {
      await broadcastToGroup(groupChatId, `✅ *OPC Daily Report*\n\n0 data gaps in last 24h. All systems operational.`, 'opc-health').catch(() => {});
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
      await broadcastToGroup(
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
