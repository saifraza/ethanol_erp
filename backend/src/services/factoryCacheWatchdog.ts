/**
 * Factory Cache Watchdog — monitors factory-server master-data cache freshness
 * and sends Telegram alerts to the weighbridge group when it goes stale or
 * the heartbeat itself stops arriving.
 *
 * Why this exists (2026-05-07 → 2026-05-09 incident):
 *   Railway swapped the cloud Postgres host. Factory PC's CLOUD_DATABASE_URL
 *   stayed pointing at the dead host for 48 hours. Operators saw the
 *   "Cloud data stale" banner on the gate-entry page, but nobody monitored
 *   that screen continuously, so 12 new suppliers added cloud-side were
 *   invisible at the gate the whole time.
 *
 *   Code-level resilience (auto-reconnect, retries) wouldn't help — the env
 *   was wrong. The actual gap was: no one was *notified*.
 *
 *   This watchdog closes that gap by pushing alerts to the same Telegram
 *   group that already gets weighbridge notifications.
 *
 * Detection logic (every 3 min, two independent state machines):
 *   1. Heartbeat health — if no heartbeat from `factory-server` for >5 min,
 *      factory-server itself is down (process crashed, network split,
 *      Tailscale down, etc.). Highest priority.
 *   2. Cache health — heartbeat is fresh but cacheIsStale=true (factory can't
 *      reach cloud DB). This is the May-7 scenario.
 *
 * Re-alerts every 30 min while down. Sends recovery message on transition
 * back to healthy. State persists in Settings.factoryCacheState across
 * Railway restarts (mirrors opcHealthWatchdog pattern).
 *
 * ALERTS ROUTE TO telegramGroup2ChatId ONLY (the weighbridge group), not
 * the general operations group — by design (per user request 2026-05-09).
 */

import { broadcastToGroup } from './messagingGateway';

const CHECK_INTERVAL_MS = 3 * 60 * 1000;          // 3 min poll cadence
const HEARTBEAT_OFFLINE_THRESHOLD_MS = 5 * 60 * 1000;  // 5 min without heartbeat = factory offline
const REALERT_INTERVAL_MS = 30 * 60 * 1000;       // re-alert every 30 min while down

type Health = 'unknown' | 'healthy' | 'cache-stale' | 'heartbeat-offline';

let watchdogInterval: NodeJS.Timeout | null = null;
let lastHealth: Health = 'unknown';
let firstDetectedAt: Date | null = null;     // when current bad state began
let lastAlertSentAt: Date | null = null;
let stateLoaded = false;

interface PersistedState {
  lastHealth: Health;
  firstDetectedAt: string | null;
  lastAlertSentAt: string | null;
}

function nowIST(): Date {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

function fmtIST(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')} IST`;
}

async function loadState(prisma: any): Promise<void> {
  if (stateLoaded) return;
  try {
    const settings = await prisma.settings.findFirst();
    const raw = (settings as any)?.factoryCacheState as string | null | undefined;
    if (raw) {
      const s: PersistedState = JSON.parse(raw);
      lastHealth = s.lastHealth || 'unknown';
      firstDetectedAt = s.firstDetectedAt ? new Date(s.firstDetectedAt) : null;
      lastAlertSentAt = s.lastAlertSentAt ? new Date(s.lastAlertSentAt) : null;
      console.log('[Factory Cache Watchdog] State restored from DB');
    }
  } catch { /* column may not exist on first run */ }
  stateLoaded = true;
}

async function saveState(prisma: any): Promise<void> {
  try {
    const settings = await prisma.settings.findFirst();
    if (!settings) return;
    const s: PersistedState = {
      lastHealth,
      firstDetectedAt: firstDetectedAt?.toISOString() ?? null,
      lastAlertSentAt: lastAlertSentAt?.toISOString() ?? null,
    };
    await prisma.settings.update({
      where: { id: settings.id },
      data: { factoryCacheState: JSON.stringify(s) } as any,
    });
  } catch { /* column may not exist yet — ALTER fires on next deploy */ }
}

/** Get the weighbridge group's chat ID — alerts ONLY go here, not main group. */
async function getWeighbridgeChatId(prisma: any): Promise<string | null> {
  try {
    const settings = await prisma.settings.findFirst();
    return (settings as any)?.telegramGroup2ChatId || null;
  } catch {
    return null;
  }
}

async function sendAlert(prisma: any, message: string): Promise<boolean> {
  const chatId = await getWeighbridgeChatId(prisma);
  if (!chatId) {
    console.warn('[Factory Cache Watchdog] Cannot alert — telegramGroup2ChatId not configured');
    return false;
  }
  try {
    await broadcastToGroup(chatId, message, 'factory-cache');
    return true;
  } catch (err) {
    console.error('[Factory Cache Watchdog] Alert send failed:', (err as Error).message);
    return false;
  }
}

/** Compute current health from the factory-server's latest heartbeat. */
function classifyHealth(hb: ReturnType<typeof getFactoryHeartbeatSafe>): Health {
  if (!hb) return 'heartbeat-offline'; // never heartbeated = same as offline
  const age = Date.now() - new Date(hb.receivedAt).getTime();
  if (age > HEARTBEAT_OFFLINE_THRESHOLD_MS) return 'heartbeat-offline';
  if (hb.cacheIsStale === true) return 'cache-stale';
  return 'healthy';
}

/** Lazy import + getter so the watchdog file doesn't pull route handlers
 *  into the import graph at module load time. */
function getFactoryHeartbeatSafe(): {
  receivedAt: string;
  cacheIsStale?: boolean;
  cacheAgeMs?: number;
  cacheSource?: string;
  cacheCounts?: Record<string, number | undefined>;
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('../routes/weighbridge/endpoints');
    return m.getFactoryHeartbeat?.() ?? null;
  } catch {
    return null;
  }
}

async function checkHealth(): Promise<void> {
  try {
    const prisma = (await import('../config/prisma')).default;
    await loadState(prisma);

    const hb = getFactoryHeartbeatSafe();
    const health = classifyHealth(hb);
    const now = Date.now();

    // Cold start — establish baseline silently, do not alert. We don't know
    // whether the prior state was due to a real outage or a Railway restart;
    // require one full check cycle to establish a fresh baseline.
    if (lastHealth === 'unknown') {
      lastHealth = health;
      if (health !== 'healthy') firstDetectedAt = new Date();
      await saveState(prisma);
      return;
    }

    // ── Transition: healthy → bad (NEW outage) ──
    if (lastHealth === 'healthy' && health !== 'healthy') {
      firstDetectedAt = new Date();
      const msg = formatAlert(health, hb, /*durationMin*/ 0);
      const sent = await sendAlert(prisma, msg);
      if (sent) lastAlertSentAt = new Date();
      lastHealth = health;
      console.log(`[Factory Cache Watchdog] OUTAGE START: ${health} — alert sent: ${sent}`);
      await saveState(prisma);
      return;
    }

    // ── Transition: bad → healthy (RECOVERY) ──
    if (lastHealth !== 'healthy' && health === 'healthy') {
      const downMin = firstDetectedAt
        ? Math.round((now - firstDetectedAt.getTime()) / 60000)
        : 0;
      await sendAlert(
        prisma,
        `✅ *FACTORY CACHE RECOVERED*\n\nMaster-data sync back online after ~${downMin} min.\nRecovered: ${fmtIST(nowIST())}`,
      );
      console.log(`[Factory Cache Watchdog] RECOVERED after ${downMin}min`);
      lastHealth = 'healthy';
      firstDetectedAt = null;
      lastAlertSentAt = null;
      await saveState(prisma);
      return;
    }

    // ── Still bad — re-alert every 30 min ──
    if (lastHealth !== 'healthy' && health !== 'healthy') {
      // If health TYPE changed (e.g. cache-stale → heartbeat-offline), treat
      // as escalation: alert immediately, reset timer.
      if (lastHealth !== health) {
        const sent = await sendAlert(
          prisma,
          formatAlert(health, hb, firstDetectedAt
            ? Math.round((now - firstDetectedAt.getTime()) / 60000)
            : 0),
        );
        if (sent) lastAlertSentAt = new Date();
        lastHealth = health;
        console.log(`[Factory Cache Watchdog] ESCALATED: ${lastHealth} → ${health}`);
        await saveState(prisma);
        return;
      }

      const sinceLast = lastAlertSentAt ? now - lastAlertSentAt.getTime() : Infinity;
      if (sinceLast >= REALERT_INTERVAL_MS) {
        const downMin = firstDetectedAt
          ? Math.round((now - firstDetectedAt.getTime()) / 60000)
          : 0;
        const sent = await sendAlert(prisma, formatAlert(health, hb, downMin));
        if (sent) lastAlertSentAt = new Date();
        console.log(`[Factory Cache Watchdog] Re-alert (down ${downMin}min) sent: ${sent}`);
        await saveState(prisma);
      }
    }
  } catch (err) {
    console.error('[Factory Cache Watchdog] Check failed:', (err as Error).message);
  }
}

function formatAlert(
  health: Health,
  hb: ReturnType<typeof getFactoryHeartbeatSafe>,
  durationMin: number,
): string {
  const detected = fmtIST(nowIST());
  const sinceLine = durationMin > 0 ? `\nDown for: ~${durationMin} min` : '';
  if (health === 'heartbeat-offline') {
    const lastHb = hb?.receivedAt
      ? fmtIST(new Date(hb.receivedAt))
      : 'never';
    return `🚨 *FACTORY SERVER OFFLINE*\n\nNo heartbeat from factory-server (100.126.101.7:5000).\n\nLast heartbeat: ${lastHb}\nDetected: ${detected}${sinceLine}\n\nGate-entry UI may be down. Check Tailscale, FactoryServer scheduled task, and PC reachability.\n\nRe-alerts every 30 min while offline.`;
  }
  // cache-stale
  const ageMin = hb?.cacheAgeMs ? Math.round(hb.cacheAgeMs / 60000) : 0;
  const counts = hb?.cacheCounts || {};
  const countsLine = Object.keys(counts).length
    ? `\nCached: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', ')}`
    : '';
  return `⚠️ *FACTORY MASTER-DATA STALE*\n\nFactory-server is up but its cloud-DB ping has been failing for ~${ageMin} min — gate-entry dropdowns are frozen.${countsLine}\n\nDetected: ${detected}${sinceLine}\n\nLikely cause: \`CLOUD_DATABASE_URL\` on the factory PC is wrong (Railway DB swap, password change, network blip).\n\nFix: \`./factory-server/scripts/deploy-env.sh CLOUD_DATABASE_URL --from-railway\`\n\nRe-alerts every 30 min while stale.`;
}

export function startFactoryCacheWatchdog(): void {
  if (watchdogInterval) return;
  console.log('[Factory Cache Watchdog] Starting — checks every 3 min, alerts to weighbridge group only');
  // First check after 30s to give heartbeat time to land on cold start
  setTimeout(() => { checkHealth().catch(() => {}); }, 30_000);
  watchdogInterval = setInterval(() => {
    checkHealth().catch(() => {});
  }, CHECK_INTERVAL_MS);
}

export function stopFactoryCacheWatchdog(): void {
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }
}
