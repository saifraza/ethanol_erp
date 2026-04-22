/**
 * Unified Email Service — send, persist as EmailThread, match replies.
 *
 * Use this from any ERP module (indent quotes, PO, invoice, payment confirmation,
 * etc.) to get:
 *   - Outbound mail via SMTP (Nodemailer — same transport as messaging.ts)
 *   - DB persistence: one EmailThread row per sent email
 *   - Inbound IMAP polling matched by our stored messageId
 *   - Persistent reply cache so the UI doesn't re-fetch on every open
 */

import prisma from '../config/prisma';
import { sendEmail } from './messaging';
import { fetchRepliesToMessage } from './emailReader';

export interface SendThreadArgs {
  entityType: string;           // 'INDENT_QUOTE' | 'PURCHASE_ORDER' | etc.
  entityId: string;
  vendorId?: string | null;     // link to Vendor so we can show "all emails with this vendor"
  customerId?: string | null;   // symmetric for customer-side emails
  subject: string;
  to: string;                   // recipient email
  cc?: string;
  bcc?: string;
  bodyText: string;
  bodyHtml?: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
  sentBy: string;               // user name/email who triggered
  fromName?: string;
  companyId?: string | null;
}

export async function sendThreadEmail(args: SendThreadArgs) {
  // 1. Send via SMTP — get messageId back
  const result = await sendEmail({
    to: args.cc ? `${args.to}, ${args.cc}` : args.to,
    subject: args.subject,
    text: args.bodyText,
    html: args.bodyHtml,
    attachments: args.attachments?.map(a => ({
      filename: a.filename, content: a.content, contentType: a.contentType,
    })),
  });

  if (!result.success) {
    // Record the failure so the user can see what happened + retry
    const failed = await prisma.emailThread.create({
      data: {
        entityType: args.entityType,
        entityId: args.entityId,
        vendorId: args.vendorId || null,
        customerId: args.customerId || null,
        subject: args.subject,
        fromEmail: process.env.SMTP_USER || 'noreply@mspil.in',
        fromName: args.fromName || 'MSPIL ERP',
        toEmail: args.to,
        ccEmail: args.cc || null,
        bccEmail: args.bcc || null,
        bodyText: args.bodyText,
        bodyHtml: args.bodyHtml || null,
        sentBy: args.sentBy,
        status: 'FAILED',
        errorMessage: result.error || 'Unknown error',
        attachments: args.attachments?.map(a => ({
          filename: a.filename,
          size: a.content.length,
          contentType: a.contentType || 'application/octet-stream',
        })) || [],
        companyId: args.companyId || null,
      },
    });
    return { thread: failed, success: false, error: result.error };
  }

  const cleanMsgId = (result.messageId || '').replace(/^<|>$/g, '');

  const thread = await prisma.emailThread.create({
    data: {
      entityType: args.entityType,
      entityId: args.entityId,
      subject: args.subject,
      fromEmail: process.env.SMTP_USER || 'noreply@mspil.in',
      fromName: args.fromName || 'MSPIL ERP',
      toEmail: args.to,
      ccEmail: args.cc || null,
      bccEmail: args.bcc || null,
      bodyText: args.bodyText,
      bodyHtml: args.bodyHtml || null,
      messageId: cleanMsgId,
      threadId: cleanMsgId,
      sentBy: args.sentBy,
      status: 'SENT',
      attachments: args.attachments?.map(a => ({
        filename: a.filename,
        size: a.content.length,
        contentType: a.contentType || 'application/octet-stream',
      })) || [],
      companyId: args.companyId || null,
    },
  });

  return { thread, success: true, messageId: cleanMsgId };
}

/**
 * Fetch replies from IMAP for a given thread, persist any new ones, and
 * return the full reply history from the DB (oldest first for Gmail-style
 * rendering).
 *
 * Safe to call repeatedly — de-duplicates on (threadId, providerMessageId).
 */
export async function syncAndListReplies(threadDbId: string) {
  const thread = await prisma.emailThread.findUnique({ where: { id: threadDbId } });
  if (!thread) throw new Error('Thread not found');
  if (!thread.messageId) {
    return { replies: [], note: 'No message-id stored — cannot match replies. Resend the email.' };
  }

  let fetchError: string | null = null;
  let newCount = 0;
  try {
    const live = await fetchRepliesToMessage({
      originalMessageId: thread.messageId,
      fromEmail: thread.toEmail.split(',')[0].trim(),
      subjectContains: thread.subject.split(' ')[0], // usually starts with RFQ-... or PO-...
      sinceDays: 90,
    });

    for (const r of live) {
      // Skip if we already persisted it
      const exists = await prisma.emailReply.findUnique({
        where: { threadId_providerMessageId: { threadId: thread.id, providerMessageId: r.messageId } },
      });
      if (exists) continue;

      await prisma.emailReply.create({
        data: {
          threadId: thread.id,
          providerMessageId: r.messageId,
          fromEmail: r.from,
          fromName: r.fromName || null,
          toEmail: r.to || null,
          subject: r.subject || null,
          bodyText: r.bodyText,
          bodyHtml: r.bodyHtml || null,
          inReplyTo: r.inReplyTo || null,
          refsHeaders: (r.references || []).join(' ') || null,
          receivedAt: new Date(r.date),
          attachments: r.attachments.map(a => ({
            filename: a.filename,
            size: a.size,
            contentType: a.contentType,
            contentBase64: a.contentBase64,
          })),
        },
      });
      newCount++;
    }
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'IMAP fetch failed';
  }

  await prisma.emailThread.update({
    where: { id: thread.id },
    data: {
      lastCheckedAt: new Date(),
      replyCount: await prisma.emailReply.count({ where: { threadId: thread.id } }),
      hasUnreadReply: newCount > 0,
    },
  });

  const replies = await prisma.emailReply.findMany({
    where: { threadId: thread.id },
    orderBy: { receivedAt: 'asc' },
  });

  return { replies, newCount, fetchError };
}

/**
 * Find or fallback to empty the EmailThread for a given entity — the most
 * recent one if multiple exist (e.g. if user resent).
 */
export async function latestThreadFor(entityType: string, entityId: string) {
  return prisma.emailThread.findFirst({
    where: { entityType, entityId },
    orderBy: { sentAt: 'desc' },
    include: { replies: { orderBy: { receivedAt: 'asc' } } },
  });
}

/** Mark a reply as seen — removes the unread badge */
export async function markReplySeen(replyId: string) {
  await prisma.emailReply.update({
    where: { id: replyId },
    data: { seenAt: new Date() },
  });
  // Recompute hasUnreadReply on the parent thread
  const r = await prisma.emailReply.findUnique({ where: { id: replyId } });
  if (r) {
    const anyUnread = await prisma.emailReply.count({ where: { threadId: r.threadId, seenAt: null } });
    await prisma.emailThread.update({ where: { id: r.threadId }, data: { hasUnreadReply: anyUnread > 0 } });
  }
}
