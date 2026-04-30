/**
 * Inventory Low Stock Alerts via Telegram
 *
 * Runs daily check: if any item's currentStock < minStock, sends alert
 * to Telegram group and private chat IDs.
 */

import prisma from '../config/prisma';
import { broadcastToGroup } from './messagingGateway';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // Every 6 hours
let alertInterval: NodeJS.Timeout | null = null;
let alertsEnabled = true;

export function isInventoryAlertsEnabled(): boolean { return alertsEnabled; }

export async function toggleInventoryAlerts(): Promise<boolean> {
  alertsEnabled = !alertsEnabled;
  // Persist to Settings
  try {
    const s = await prisma.settings.findFirst();
    if (s) {
      await prisma.settings.update({
        where: { id: s.id },
        data: { inventoryAlertsEnabled: alertsEnabled },
      });
    }
  } catch { /* non-critical */ }
  console.log(`[Inventory] Alerts ${alertsEnabled ? 'ENABLED' : 'DISABLED'}`);
  return alertsEnabled;
}

async function loadAlertState(): Promise<void> {
  try {
    const s = await prisma.settings.findFirst();
    if (s && s.inventoryAlertsEnabled !== undefined) {
      alertsEnabled = s.inventoryAlertsEnabled;
    }
  } catch { /* use default */ }
}

function nowIST(): Date {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

async function checkLowStock(): Promise<void> {
  if (!alertsEnabled) return;
  try {
    const items = await prisma.inventoryItem.findMany({
      where: { isActive: true, minStock: { gt: 0 } },
      select: { id: true, name: true, code: true, currentStock: true, minStock: true, unit: true, category: true },
    
    take: 500,
  });

    const lowStock = items.filter(i => i.currentStock <= i.minStock);
    if (lowStock.length === 0) return;

    const settings = await prisma.settings.findFirst();
    const groupChatId = settings?.telegramGroupChatId;
    if (!groupChatId) return;

    const ist = nowIST();
    const timeStr = `${ist.getUTCHours() % 12 || 12}:${String(ist.getUTCMinutes()).padStart(2, '0')} ${ist.getUTCHours() >= 12 ? 'PM' : 'AM'}`;

    const lines = lowStock.slice(0, 15).map(i => {
      const pct = i.minStock > 0 ? Math.round((i.currentStock / i.minStock) * 100) : 0;
      const icon = pct === 0 ? '🔴' : pct <= 50 ? '🟡' : '🟠';
      return `${icon} *${i.name}* (${i.code})\n   ${i.currentStock} / ${i.minStock} ${i.unit} (${pct}%)`;
    });

    const msg = `⚠️ *LOW STOCK ALERT* — ${timeStr}\n\n${lines.join('\n\n')}${lowStock.length > 15 ? `\n\n_...and ${lowStock.length - 15} more_` : ''}\n\n_${lowStock.length} item(s) below minimum stock level_`;

    await broadcastToGroup(groupChatId, msg, 'inventory-alert');
    console.log(`[Inventory] Sent low stock alert: ${lowStock.length} items`);
  } catch (err) {
    console.error('[Inventory] Alert check failed:', (err as Error).message);
  }
}

export function startInventoryAlerts(): void {
  if (alertInterval) return;
  // Load persisted state
  loadAlertState().catch(() => {});
  // First check after 5 minutes (let server warm up)
  setTimeout(() => {
    checkLowStock().catch(() => {});
    alertInterval = setInterval(() => {
      checkLowStock().catch(() => {});
    }, CHECK_INTERVAL_MS);
  }, 5 * 60 * 1000);
  console.log('[Inventory] Low stock alerts started (checks every 6h)');
}

export function stopInventoryAlerts(): void {
  if (alertInterval) {
    clearInterval(alertInterval);
    alertInterval = null;
  }
}

/** Manual trigger for testing */
export { checkLowStock };
