/**
 * Background poller that periodically syncs IMAP for all open RFQ threads
 * (entityType='INDENT_QUOTE') and emits notifications for any new vendor reply.
 * Skips threads whose indent already has an awarded vendor or is in a terminal
 * state — no point fetching mail for a closed indent.
 */

import prisma from '../config/prisma';
import { syncAndListReplies } from './emailService';
import { notify } from './notify';
import { sendTelegramMessage } from './telegramBot';
import { autoExtractIfWaiting } from './rfqAutoExtract';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const TERMINAL_STATUSES = ['REJECTED', 'COMPLETED'];

let pollInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

/**
 * Notify the purchase team that a new reply has arrived for an RFQ.
 * Called both from the on-demand /replies endpoint and from this poller.
 */
export async function notifyOnNewRfqReply(args: {
  vrId: string;
  newCount: number;
  fromEmail?: string;
}): Promise<void> {
  if (args.newCount <= 0) return;

  const vr = await prisma.purchaseRequisitionVendor.findUnique({
    where: { id: args.vrId },
    include: {
      vendor: { select: { name: true } },
      requisition: { select: { id: true, reqNo: true, title: true, itemName: true } },
    },
  });
  if (!vr) return;

  const indentLink = `/inventory/indents?expand=${vr.requisitionId}&vendor=${args.vrId}`;
  const title = `RFQ reply from ${vr.vendor.name}`;
  const message = `Indent #${vr.requisition.reqNo} (${vr.requisition.title || vr.requisition.itemName}). ${args.newCount} new reply${args.newCount > 1 ? 'ies' : ''}. Open the indent to extract or enter rates.`;

  await notify({
    category: 'RFQ_REPLY',
    severity: 'INFO',
    role: 'ADMIN',
    title,
    message,
    link: indentLink,
    entityType: 'PurchaseRequisitionVendor',
    entityId: args.vrId,
    // dedupe per thread+receivedDate so multiple replies in same minute collapse
    dedupeKey: `rfq-reply:${args.vrId}:${new Date().toISOString().slice(0, 16)}`,
  });

  // Telegram broadcast — same channel as other plant alerts. Skip silently if
  // bot or chat id isn't configured (e.g. local dev).
  const chatId = process.env.TELEGRAM_PROCUREMENT_CHAT_ID || process.env.TELEGRAM_ALERT_CHAT_ID;
  if (chatId) {
    const text =
      `*RFQ Reply Received*\n` +
      `Vendor: ${vr.vendor.name}\n` +
      `Indent: #${vr.requisition.reqNo} — ${vr.requisition.title || vr.requisition.itemName}\n` +
      (args.fromEmail ? `From: ${args.fromEmail}\n` : '') +
      `\nOpen the indent to extract or enter rates manually.`;
    await sendTelegramMessage(chatId, text, 'rfq');
  }
}

async function runOnce(): Promise<void> {
  if (isRunning) return; // Don't overlap if a previous run is still going
  isRunning = true;
  try {
    // Find all RFQ threads tied to indents that aren't closed/awarded yet.
    // Cap to 50 per cycle to avoid hammering IMAP if there's a backlog.
    const threads = await prisma.emailThread.findMany({
      where: { entityType: 'INDENT_QUOTE', status: 'SENT' },
      select: { id: true, entityId: true, toEmail: true },
      orderBy: { lastCheckedAt: { sort: 'asc', nulls: 'first' } },
      take: 50,
    });

    for (const t of threads) {
      // Skip threads whose indent is closed or whose vendor is already awarded
      const vr = await prisma.purchaseRequisitionVendor.findUnique({
        where: { id: t.entityId },
        select: { isAwarded: true, requisition: { select: { status: true } } },
      });
      if (!vr) continue;
      if (vr.isAwarded) continue;
      if (TERMINAL_STATUSES.includes(vr.requisition.status)) continue;

      try {
        const result = await syncAndListReplies(t.id);
        const newCount = result.newCount ?? 0;
        if (newCount > 0) {
          // Pull the latest reply just for the from-email in the alert
          const latest = await prisma.emailReply.findFirst({
            where: { threadId: t.id }, orderBy: { receivedAt: 'desc' }, select: { fromEmail: true },
          });
          await notifyOnNewRfqReply({
            vrId: t.entityId,
            newCount,
            fromEmail: latest?.fromEmail,
          });
          // Auto-extract rates IFF still waiting (no rate saved yet). Vendors
          // send unrelated follow-up emails — those are noise once a rate exists.
          try {
            const auto = await autoExtractIfWaiting(t.entityId);
            if (auto.ran && (auto.savedLineCount || 0) > 0) {
              console.log(`[rfqReplyPoller] auto-extracted ${auto.savedLineCount}/${auto.totalLines} rates (confidence=${auto.confidence}) for vr=${t.entityId}`);
            } else if (!auto.ran) {
              console.log(`[rfqReplyPoller] auto-extract skipped for vr=${t.entityId}: ${auto.reason}`);
            }
          } catch (err) {
            console.error(`[rfqReplyPoller] auto-extract failed for vr=${t.entityId}:`, err);
          }
        }
      } catch (err) {
        console.error(`[rfqReplyPoller] thread ${t.id} sync failed:`, err);
      }
    }
  } catch (err) {
    console.error('[rfqReplyPoller] cycle failed:', err);
  } finally {
    isRunning = false;
  }
}

export function startRfqReplyPoller(): void {
  if (pollInterval) return;
  if (process.env.RFQ_REPLY_POLL_DISABLED === '1') {
    console.log('[rfqReplyPoller] disabled via RFQ_REPLY_POLL_DISABLED');
    return;
  }
  // Stagger the first run by 60s after boot so we don't compete with other startup jobs
  setTimeout(() => { void runOnce(); }, 60_000);
  pollInterval = setInterval(() => { void runOnce(); }, POLL_INTERVAL_MS);
  console.log(`[rfqReplyPoller] started — every ${POLL_INTERVAL_MS / 1000}s`);
}

export function stopRfqReplyPoller(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}
