/**
 * Compliance Alerts via Telegram
 *
 * Runs every 6 hours:
 * 1. Auto-marks overdue obligations as NON_COMPLIANT
 * 2. Sends Telegram alerts for expiring/overdue obligations
 */

import prisma from '../config/prisma';
import { tgSendGroup } from './telegramClient';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // Every 6 hours
let alertInterval: NodeJS.Timeout | null = null;

function nowIST(): Date {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

const RISK_ICON: Record<string, string> = {
  CRITICAL: '🔴',
  HIGH: '🟠',
  MEDIUM: '🟡',
  LOW: '🟢',
};

async function checkCompliance(): Promise<void> {
  try {
    const now = new Date();

    // 1. Auto-mark overdue obligations as NON_COMPLIANT
    const overdue = await prisma.complianceObligation.updateMany({
      where: {
        status: { in: ['COMPLIANT', 'PENDING', 'EXPIRING'] },
        dueDate: { lt: now },
      },
      data: { status: 'NON_COMPLIANT' },
    });

    if (overdue.count > 0) {
      console.log(`[Compliance] Auto-marked ${overdue.count} obligation(s) as NON_COMPLIANT`);
    }

    // 2. Mark obligations expiring within lead time (batch update)
    const expiringObs = await prisma.complianceObligation.findMany({
      where: {
        status: { in: ['COMPLIANT', 'PENDING'] },
        dueDate: { gte: now },
      },
      select: { id: true, dueDate: true, leadTimeDays: true },
      take: 500,
    });

    const expiringIds = expiringObs
      .filter(ob => {
        if (!ob.dueDate) return false;
        const daysLeft = Math.ceil((ob.dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return daysLeft <= ob.leadTimeDays;
      })
      .map(ob => ob.id);

    if (expiringIds.length > 0) {
      await prisma.complianceObligation.updateMany({
        where: { id: { in: expiringIds } },
        data: { status: 'EXPIRING' },
      });
    }

    // 3. Get alert-worthy items
    const alertItems = await prisma.complianceObligation.findMany({
      where: {
        status: { in: ['NON_COMPLIANT', 'EXPIRING'] },
      },
      select: { id: true, title: true, category: true, riskLevel: true, status: true, dueDate: true },
      orderBy: [{ riskLevel: 'asc' }, { dueDate: 'asc' }],
      take: 20,
    });

    if (alertItems.length === 0) return;

    // 4. Send Telegram alert
    const settings = await prisma.settings.findFirst();
    const groupChatId = (settings as any)?.telegramGroupChatId;
    if (!groupChatId) return;

    const ist = nowIST();
    const timeStr = `${ist.getUTCHours() % 12 || 12}:${String(ist.getUTCMinutes()).padStart(2, '0')} ${ist.getUTCHours() >= 12 ? 'PM' : 'AM'}`;

    const overdueItems = alertItems.filter(i => i.status === 'NON_COMPLIANT');
    const expiringItems = alertItems.filter(i => i.status === 'EXPIRING');

    const lines: string[] = [];

    if (overdueItems.length > 0) {
      lines.push('*OVERDUE:*');
      overdueItems.slice(0, 10).forEach(i => {
        const days = i.dueDate ? Math.abs(Math.ceil((i.dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))) : 0;
        lines.push(`${RISK_ICON[i.riskLevel] || '⚪'} ${i.title} — ${days}d overdue`);
      });
    }

    if (expiringItems.length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push('*EXPIRING SOON:*');
      expiringItems.slice(0, 10).forEach(i => {
        const days = i.dueDate ? Math.ceil((i.dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : 0;
        lines.push(`${RISK_ICON[i.riskLevel] || '⚪'} ${i.title} — ${days}d left`);
      });
    }

    const msg = `⚖️ *COMPLIANCE ALERT* — ${timeStr}\n\n${lines.join('\n')}\n\n_${overdueItems.length} overdue, ${expiringItems.length} expiring_`;

    await tgSendGroup(groupChatId, msg, 'compliance-alert');
    console.log(`[Compliance] Sent alert: ${overdueItems.length} overdue, ${expiringItems.length} expiring`);
  } catch (err) {
    console.error('[Compliance] Alert check failed:', (err as Error).message);
  }
}

export function startComplianceAlerts(): void {
  if (alertInterval) return;
  // First check after 5 minutes (let server warm up)
  setTimeout(() => {
    checkCompliance().catch(() => {});
    alertInterval = setInterval(() => {
      checkCompliance().catch(() => {});
    }, CHECK_INTERVAL_MS);
  }, 5 * 60 * 1000);
  console.log('[Compliance] Alerts started (checks every 6h)');
}
