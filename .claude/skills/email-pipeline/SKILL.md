---
name: email-pipeline
description: Outbound SMTP + inbound IMAP polling for the ERP, plus RFQ→vendor-reply→PO Gmail conversation threading. Use before changing emailService.ts, emailReader.ts, messaging.ts, rfqReplyPoller.ts, the EmailThread/EmailReply models, or any route that sends mail. Triggers on email, SMTP, IMAP, Gmail, nodemailer, messageId, sendThreadEmail, EmailThread, EmailReply, RFQ thread, "reply not appearing", "email is broken", In-Reply-To/References, vendor quote email.
when_to_use: Sending email from a route; vendor RFQ → quote reply → PO sent as one Gmail conversation; IMAP reply matching/polling; diagnosing SMTP/IMAP/auth failures or threads stuck FAILED/BOUNCED; adding a new email send path.
---

# Email Pipeline — outbound SMTP, inbound IMAP, RFQ→PO Gmail threading

Read first before changing `emailService.ts`, `emailReader.ts`, `messaging.ts`, `rfqReplyPoller.ts`, or any route that calls `sendThreadEmail`. Threading details are easy to miss and break vendor conversations.

## Hard rules (NEVER / ALWAYS)

- **Routes NEVER call `sendEmail` directly.** Always go through `sendThreadEmail` so every send creates an `EmailThread` row keyed to the entity. Without that row, IMAP can't match the reply, and the audit trail + per-vendor/per-PO ledger views break.
- **NEVER add a new send path that bypasses `sendThreadEmail`.**
- **NEVER strip the `<>` from messageIds when storing** — the helper already does that. Re-stripping corrupts the value. Stored `messageId` is clean (no angle brackets).
- **NEVER change the `In-Reply-To` / `References` format on PO send** — Gmail's threader is strict about RFC 5322. Don't change it without testing on a real Gmail account.
- **NEVER write to `EmailReply` from anywhere except `syncAndListReplies`** — it owns the de-dup logic.

## The four services

| File | Role | Key exports |
|---|---|---|
| `backend/src/services/messaging.ts` | Low-level: nodemailer transport + raw `sendEmail()` (also `sendTelegram` here — historic) | `sendEmail()`, `sendTelegram()` |
| `backend/src/services/emailService.ts` | High-level: `sendEmail` + `EmailThread` DB persistence + reply matching | `sendThreadEmail()`, `syncAndListReplies()`, `latestThreadFor()`, `markReplySeen()` |
| `backend/src/services/emailReader.ts` | IMAP polling. Reuses SMTP creds (Gmail app password works for both) | `fetchRepliesToMessage()`, `isImapConfigured()` |
| `backend/src/services/rfqReplyPoller.ts` | Background poller — sweeps RFQ threads on a schedule and ingests new replies | started on server boot |

## Env vars (Gmail)

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=sales@mspil.in            # also IMAP login
SMTP_PASS=<16-char Gmail app password>
SMTP_FROM=MSPIL Sales <sales@mspil.in>
```

Gmail **app password** — not the account password. Get one at https://myaccount.google.com/apppasswords. After a Railway project migration the egress IP changes; Gmail sometimes blocks the new IP and sends a "Critical security alert" to `sales@mspil.in`. If outbound email starts failing without a code change, check that inbox first.

## RFQ → vendor reply → PO threading (the gold path)

Trickiest part. Goal: vendor sees ONE Gmail conversation from `RFQ-{n}-{vendorId}` → vendor's reply → `PO-{n}` send.

1. **`POST /api/purchase-requisition/:id/vendors/:vrId/send-rfq`** sends the RFQ via `sendThreadEmail({ entityType: 'INDENT_QUOTE', entityId: vrId, ... })`. The MessageId returned from SMTP is stored on `EmailThread.messageId` (clean, no angle brackets) AND mirrored onto `PurchaseRequisitionVendor.quoteEmailMessageId`.

2. **Vendor replies on Gmail.** `rfqReplyPoller` (or `GET /vendors/:vrId/replies` on demand) calls `syncAndListReplies(thread.id)` which calls `fetchRepliesToMessage({ originalMessageId, fromEmail, subjectContains, sinceDays: 90 })`. New replies persist to `EmailReply`. Auto-extract runs on the latest reply if the indent is still in WAITING state.

3. **PO awarded and sent.** `POST /api/purchase-orders/:id/send-email` looks up the awarded `PurchaseRequisitionVendor`, finds its `EmailThread` via `latestThreadFor('INDENT_QUOTE', awardedVr.id)`, then sends the PO with:
   - `inReplyTo: rfqThread.messageId`
   - `references: [rfqThread.messageId, ...replyMessageIds]`
   - `subject: "Re: RFQ-{n}-{prefix} — PO-{m} Purchase Order"` (Re: + RFQ subject prefix)

This RFC 5322 dance is what keeps Gmail rendering all four messages as one conversation.

## EmailThread row — what each field carries

```ts
EmailThread {
  entityType    // 'INDENT_QUOTE' | 'PURCHASE_ORDER' | 'WORK_ORDER' | 'VENDOR_INVOICE' | ...
  entityId      // the source row id
  vendorId / customerId  // for vendor-/customer-centric ledger views
  subject, fromEmail, fromName, toEmail, ccEmail, bccEmail
  bodyText, bodyHtml
  messageId     // RFC 5322 Message-ID — used to match replies (clean, no <>)
  threadId      // provider thread id (Gmail X-GM-THRID if available)
  status        // 'SENT' | 'FAILED' | 'BOUNCED' | 'QUEUED'
  errorMessage  // populated on FAILED — surfaced in EmailThreadDrawer
  attachments   // JSON [{ filename, size, contentType }]
  lastCheckedAt, replyCount, hasUnreadReply  // updated by syncAndListReplies
  companyId     // for multi-company filtering
}
```

`EmailReply` is the IMAP-pulled side, joined back via `threadId` + unique `(threadId, providerMessageId)`.

## Frontend integration

- `frontend/src/components/EmailThreadDrawer.tsx` — drawer used by RFQ + WO send-email panels. Shows the thread + replies + attachment downloads.
- `frontend/src/pages/admin/EmailThreads.tsx` — admin view of all threads (search by entity / vendor / status).

## Diagnostics

- `GET /api/admin/email-diagnostic` (SUPER_ADMIN/ADMIN) — returns SMTP env presence, `transporter.verify()` result, a real `sendMail()` to `SMTP_USER`, and a `puppeteer.launch()` test (PR #79). Use this FIRST when "email is broken" — it isolates SMTP from PDF render from auth from network.
- `GET /api/admin/email-threads/diagnose` — IMAP-side diagnostic.

## Common failures and where to look

| Symptom | Likely cause | Fix |
|---|---|---|
| `send-rfq` returns 500, diagnostic shows `verify.ok=true`, `pdf.ok=false` | Chromium libs missing on Railway image | See [.claude/skills/deploy-railway/SKILL.md](../deploy-railway/SKILL.md) |
| All outbound mail returns auth error after migration | Gmail blocked new egress IP | Check `sales@mspil.in` inbox for security alert; allow login |
| Replies aren't appearing | Vendor started a new thread instead of replying | They must hit Reply on the original email so subject + In-Reply-To match. PR send instructs them via the body. |
| Reply caught but auto-extract didn't run | Indent moved past WAITING state | Re-trigger via the AI extract button on the indent detail |
| EmailThread row created with `status: FAILED` | Inspect `errorMessage` on the row — usually 535 (auth) or ETIMEDOUT |
