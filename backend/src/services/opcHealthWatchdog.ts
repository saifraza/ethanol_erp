/**
 * OPC Health Watchdog — monitors bridge connectivity and sends WhatsApp alerts
 * Runs every 5 minutes on the ERP server. Detects when the factory bridge
 * goes offline or comes back online, and sends appropriate alerts.
 */

import { waSendGroup } from './whatsappClient';

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const OFFLINE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes without data = offline

let watchdogInterval: NodeJS.Timeout | null = null;
let wasOnline = true;
let offlineSince: Date | null = null;

function nowIST(): Date {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

function fmtIST(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')} IST`;
}

async function checkHealth(): Promise<void> {
  try {
    // Dynamic import to avoid circular deps
    const prisma = (await import('../config/prisma')).default;

    // Get OPC Prisma client
    let lastSyncTime: Date | null = null;
    try {
      if (!process.env.DATABASE_URL_OPC) return; // OPC not configured
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

    const now = Date.now();
    const syncAge = lastSyncTime ? now - new Date(lastSyncTime).getTime() : Infinity;
    const isOnline = syncAge < OFFLINE_THRESHOLD_MS;

    // Transition: online → offline
    if (wasOnline && !isOnline) {
      offlineSince = new Date();
      const settings = await prisma.settings.findFirst();
      const groupJid = (settings as any)?.whatsappGroupJid;
      if (groupJid) {
        const lastSyncStr = lastSyncTime ? fmtIST(lastSyncTime) : 'unknown';
        const message = `⚠️ *OPC BRIDGE OFFLINE*\n\nFactory bridge has not pushed data for 10+ minutes.\n\nPossible causes:\n- Factory internet down\n- Bridge service crashed\n- OPC server unreachable\n\nLast sync: ${lastSyncStr}\nDetected at: ${fmtIST(nowIST())}`;
        await waSendGroup(groupJid, message, 'opc-health').catch(() => {});
        console.log('[OPC Watchdog] Bridge went OFFLINE — WhatsApp alert sent');
      }
    }

    // Transition: offline → online
    if (!wasOnline && isOnline && offlineSince) {
      const downtimeMin = Math.round((now - offlineSince.getTime()) / 60000);
      const settings = await prisma.settings.findFirst();
      const groupJid = (settings as any)?.whatsappGroupJid;
      if (groupJid) {
        const message = `✅ *OPC BRIDGE RECOVERED*\n\nFactory bridge is pushing data again.\nDowntime: ~${downtimeMin} minutes\nRecovered at: ${fmtIST(nowIST())}`;
        await waSendGroup(groupJid, message, 'opc-health').catch(() => {});
        console.log(`[OPC Watchdog] Bridge RECOVERED after ${downtimeMin}min`);
      }
      offlineSince = null;
    }

    wasOnline = isOnline;
  } catch (err) {
    console.error('[OPC Watchdog] Check failed:', (err as Error).message);
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
  console.log('[OPC Watchdog] Started (checks every 5 min, first check in 2 min)');
}

export function stopOpcWatchdog(): void {
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }
}
