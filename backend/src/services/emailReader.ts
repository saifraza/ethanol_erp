/**
 * Email Reader — IMAP client for reading vendor replies to RFQ emails.
 *
 * Uses the SAME Gmail creds as SMTP (SMTP_USER + SMTP_PASS as app password).
 * No OAuth setup required — works immediately if SMTP is already working.
 *
 * ENV VARS (inherits from SMTP):
 *   SMTP_USER     — gmail address, also used for IMAP login
 *   SMTP_PASS     — gmail app password (16-char, from https://myaccount.google.com/apppasswords)
 *   IMAP_HOST     — default imap.gmail.com
 *   IMAP_PORT     — default 993
 */

import { ImapFlow } from 'imapflow';
import { simpleParser, ParsedMail, Attachment as ParsedAttachment } from 'mailparser';

export interface ReplyMessage {
  messageId: string;
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  date: string;                  // ISO
  bodyText: string;              // plain text body
  bodyHtml: string | null;
  attachments: Array<{
    filename: string;
    size: number;
    contentType: string;
    contentBase64: string;       // base64 for frontend preview / AI extraction
  }>;
  inReplyTo?: string;
  references?: string[];
}

function isConfigured(): boolean {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

async function openClient(): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: process.env.IMAP_HOST || 'imap.gmail.com',
    port: parseInt(process.env.IMAP_PORT || '993'),
    secure: true,
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
    logger: false,
  });
  await client.connect();
  return client;
}

/**
 * Fetch replies to a specific message we sent (identified by the Message-ID
 * header value we stored on the quote row).
 *
 * Gmail groups by thread automatically — we search for messages whose
 * In-Reply-To or References header contains our original Message-ID.
 * Also returns messages from the same vendor in the last 30 days with the
 * same subject prefix as a fallback.
 */
export async function fetchRepliesToMessage(opts: {
  originalMessageId: string;     // our sent Message-ID (WITHOUT angle brackets)
  fromEmail?: string;            // vendor's email — fallback if header match fails
  subjectContains?: string;      // e.g. "RFQ-123" — fallback match
  sinceDays?: number;            // default 60
}): Promise<ReplyMessage[]> {
  if (!isConfigured()) return [];

  const client = await openClient();
  const results: ReplyMessage[] = [];

  try {
    await client.mailboxOpen('INBOX');

    const since = new Date();
    since.setDate(since.getDate() - (opts.sinceDays || 60));

    // Search 1: By In-Reply-To / References header (gmail X-GM-THRID is best
    // but imapflow doesn't expose it cleanly — use RFC5322 In-Reply-To)
    const msgIdClean = opts.originalMessageId.replace(/^<|>$/g, '');

    const searchQueries: Array<Record<string, unknown>> = [
      { header: { 'in-reply-to': `<${msgIdClean}>` }, since },
      { header: { references: `<${msgIdClean}>` }, since },
    ];
    // Subject fallback
    if (opts.subjectContains) searchQueries.push({ subject: opts.subjectContains, since });

    const seenUids = new Set<number>();
    for (const q of searchQueries) {
      const uids = await client.search(q, { uid: true }) || [];
      for (const uid of uids) {
        if (seenUids.has(uid)) continue;
        seenUids.add(uid);
      }
    }

    if (seenUids.size === 0) { await client.logout(); return []; }

    for await (const msg of client.fetch(Array.from(seenUids), { source: true, envelope: true, uid: true }, { uid: true })) {
      if (!msg.source) continue;
      const parsed = await simpleParser(msg.source as Buffer);

      // Skip messages we sent ourselves (from our own email)
      const fromAddr = parsed.from?.value?.[0]?.address?.toLowerCase();
      if (fromAddr === (process.env.SMTP_USER || '').toLowerCase()) continue;

      // If fromEmail specified, only include matching sender
      if (opts.fromEmail && fromAddr !== opts.fromEmail.toLowerCase()) {
        // But if we matched by header, still include — header match is trust-worthy
        const refs = Array.isArray(parsed.references) ? parsed.references : (parsed.references ? [parsed.references] : []);
        const headerMatched = (parsed.inReplyTo || '').includes(msgIdClean) ||
          refs.some((r: string) => r.includes(msgIdClean));
        if (!headerMatched) continue;
      }

      results.push({
        messageId: parsed.messageId || `uid-${msg.uid}`,
        from: fromAddr || '',
        fromName: parsed.from?.value?.[0]?.name,
        to: (parsed.to as ParsedMail['to'] as { text?: string })?.text || '',
        subject: parsed.subject || '',
        date: (parsed.date || new Date()).toISOString(),
        bodyText: parsed.text || '',
        bodyHtml: parsed.html || null,
        attachments: (parsed.attachments || []).map((a: ParsedAttachment) => ({
          filename: a.filename || 'attachment',
          size: a.size || 0,
          contentType: a.contentType || 'application/octet-stream',
          contentBase64: (a.content as Buffer).toString('base64'),
        })),
        inReplyTo: parsed.inReplyTo,
        references: Array.isArray(parsed.references) ? parsed.references : (parsed.references ? [parsed.references] : []),
      });
    }

    // Sort newest first
    results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    await client.logout();
    return results;
  } catch (err) {
    try { await client.logout(); } catch { /* noop */ }
    throw err;
  }
}
