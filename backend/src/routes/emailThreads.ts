/**
 * Email Threads Router — read-only browsing + reply sync + resend.
 *
 * Works with any entity because entityType+entityId are polymorphic.
 * Supports three lookup modes:
 *   ?entityType=X&entityId=Y — threads for THIS specific entity
 *   ?vendorId=X              — ALL threads with a vendor (across POs/RFQs/invoices)
 *   ?customerId=X            — ALL threads with a customer
 */

import { Router, Response } from 'express';
import { authenticate, AuthRequest, getCompanyFilter } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import prisma from '../config/prisma';
import { syncAndListReplies, markReplySeen, sendThreadEmail } from '../services/emailService';

const router = Router();
router.use(authenticate);

// GET / — list threads by filter
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { entityType, entityId, vendorId, customerId, limit } = req.query;
  const where: Record<string, unknown> = { ...getCompanyFilter(req) };
  if (entityType && entityId) { where.entityType = entityType; where.entityId = entityId; }
  if (vendorId) where.vendorId = vendorId;
  if (customerId) where.customerId = customerId;
  const take = Math.min(parseInt(String(limit || '50')), 200);

  const threads = await prisma.emailThread.findMany({
    where,
    orderBy: { sentAt: 'desc' },
    take,
    include: {
      vendor: { select: { id: true, name: true, email: true, phone: true } },
      customer: { select: { id: true, name: true } },
      _count: { select: { replies: true } },
    },
  });
  res.json({ threads });
}));

// GET /:id — single thread with all persisted replies (no IMAP fetch)
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const thread = await prisma.emailThread.findUnique({
    where: { id: req.params.id },
    include: {
      vendor: { select: { id: true, name: true, email: true, phone: true } },
      customer: { select: { id: true, name: true } },
      replies: { orderBy: { receivedAt: 'asc' } },
    },
  });
  if (!thread) return res.status(404).json({ error: 'Not found' });
  // Strip heavy base64 from attachments in replies — client requests them individually
  const responseReplies = thread.replies.map(r => ({
    ...r,
    attachments: Array.isArray(r.attachments)
      ? (r.attachments as Array<{ filename: string; size: number; contentType: string }>).map(a => ({ filename: a.filename, size: a.size, contentType: a.contentType }))
      : [],
  }));
  res.json({ ...thread, replies: responseReplies });
}));

// POST /:id/sync — fetch new replies from IMAP, persist, return updated list
router.post('/:id/sync', asyncHandler(async (req: AuthRequest, res: Response) => {
  try {
    const result = await syncAndListReplies(req.params.id);
    // Strip heavy base64 from attachments before returning
    const stripped = result.replies.map(r => ({
      ...r,
      attachments: Array.isArray(r.attachments)
        ? (r.attachments as Array<{ filename: string; size: number; contentType: string }>).map(a => ({ filename: a.filename, size: a.size, contentType: a.contentType }))
        : [],
    }));
    res.json({ replies: stripped, newCount: result.newCount, fetchError: result.fetchError });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Sync failed' });
  }
}));

// POST /:id/mark-seen — mark all replies on this thread as seen
router.post('/:id/mark-seen', asyncHandler(async (req: AuthRequest, res: Response) => {
  const replies = await prisma.emailReply.findMany({ where: { threadId: req.params.id, seenAt: null }, select: { id: true } ,
    take: 500,
  });
  for (const r of replies) await markReplySeen(r.id);
  res.json({ marked: replies.length });
}));

// POST /:id/resend — resend the same email to same recipient (with new Message-ID)
router.post('/:id/resend', asyncHandler(async (req: AuthRequest, res: Response) => {
  const thread = await prisma.emailThread.findUnique({ where: { id: req.params.id } });
  if (!thread) return res.status(404).json({ error: 'Not found' });

  // Re-send with the same body. Caller can pass { extraMessage } to prepend a note.
  const { extraMessage } = req.body as { extraMessage?: string };
  const user = req.user!;
  const bodyText = extraMessage ? `${extraMessage}\n\n--- ORIGINAL MESSAGE ---\n${thread.bodyText}` : thread.bodyText;
  const bodyHtml = thread.bodyHtml ? (extraMessage ? `<p>${extraMessage}</p><hr><p>--- ORIGINAL MESSAGE ---</p>${thread.bodyHtml}` : thread.bodyHtml) : undefined;

  const result = await sendThreadEmail({
    entityType: thread.entityType,
    entityId: thread.entityId,
    vendorId: thread.vendorId,
    customerId: thread.customerId,
    subject: thread.subject.startsWith('Re:') ? thread.subject : `Re: ${thread.subject}`,
    to: thread.toEmail,
    cc: thread.ccEmail || undefined,
    bodyText,
    bodyHtml,
    sentBy: user.name || user.email,
    fromName: thread.fromName || undefined,
    companyId: thread.companyId,
  });

  if (!result.success) return res.status(502).json({ error: result.error || 'Resend failed' });
  res.json({ ok: true, newThreadId: result.thread.id, messageId: result.messageId });
}));

// POST /:id/reply — reply to a thread (new message in same subject) — optionally
// attached to a vendor's specific reply if they sent one
router.post('/:id/reply', asyncHandler(async (req: AuthRequest, res: Response) => {
  const thread = await prisma.emailThread.findUnique({ where: { id: req.params.id } });
  if (!thread) return res.status(404).json({ error: 'Not found' });
  const { bodyText, bodyHtml, subject } = req.body as { bodyText?: string; bodyHtml?: string; subject?: string };
  if (!bodyText || !bodyText.trim()) return res.status(400).json({ error: 'bodyText required' });

  const user = req.user!;
  const result = await sendThreadEmail({
    entityType: thread.entityType,
    entityId: thread.entityId,
    vendorId: thread.vendorId,
    customerId: thread.customerId,
    subject: subject || (thread.subject.startsWith('Re:') ? thread.subject : `Re: ${thread.subject}`),
    to: thread.toEmail,
    cc: thread.ccEmail || undefined,
    bodyText,
    bodyHtml,
    sentBy: user.name || user.email,
    fromName: thread.fromName || undefined,
    companyId: thread.companyId,
  });
  if (!result.success) return res.status(502).json({ error: result.error || 'Reply failed' });
  res.json({ ok: true, newThreadId: result.thread.id, messageId: result.messageId });
}));

// GET /:threadId/reply/:replyId/attachment/:filename — proxy an attachment
// stored in base64 inside the EmailReply row
router.get('/:threadId/reply/:replyId/attachment/:filename', asyncHandler(async (req: AuthRequest, res: Response) => {
  const reply = await prisma.emailReply.findUnique({ where: { id: req.params.replyId } });
  if (!reply || reply.threadId !== req.params.threadId) return res.status(404).json({ error: 'Not found' });
  const atts = Array.isArray(reply.attachments)
    ? reply.attachments as Array<{ filename: string; contentType: string; contentBase64: string; size: number }>
    : [];
  const found = atts.find(a => a.filename === req.params.filename);
  if (!found || !found.contentBase64) return res.status(404).json({ error: 'Attachment not found' });

  res.setHeader('Content-Type', found.contentType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${found.filename}"`);
  res.send(Buffer.from(found.contentBase64, 'base64'));
}));

export default router;
