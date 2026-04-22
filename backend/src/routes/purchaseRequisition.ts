import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { createPurchaseOrder } from '../services/purchaseOrderService';
import { COMPANY } from '../shared/config/company';
import { renderDocumentPdf } from '../services/documentRenderer';
import { sendThreadEmail, syncAndListReplies, latestThreadFor } from '../services/emailService';
import { extractQuoteFromReply } from '../services/rfqQuoteExtractor';

const router = Router();
router.use(authenticate as any);

// GET / — list requisitions (with optional status filter)
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { status, urgency } = req.query;
    const where: any = { ...getCompanyFilter(req) };
    if (status) where.status = status;
    if (urgency) where.urgency = urgency;

    const reqs = await prisma.purchaseRequisition.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        vendor: { select: { id: true, name: true, email: true, phone: true } },
        quotes: {
          include: { vendor: { select: { id: true, name: true, email: true, phone: true } } },
          orderBy: { createdAt: 'asc' },
        },
        lines: {
          orderBy: { lineNo: 'asc' },
          include: { inventoryItem: { select: { id: true, name: true, code: true, unit: true, currentStock: true } } },
        },
      },
    });
    res.json({ requisitions: reqs });
}));

// POST /:id/vendors — add a vendor row to the indent (quote candidate)
router.post('/:id/vendors', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { vendorId } = req.body as { vendorId?: string };
    if (!vendorId) return res.status(400).json({ error: 'vendorId required' });
    const exists = await prisma.purchaseRequisitionVendor.findUnique({
      where: { requisitionId_vendorId: { requisitionId: req.params.id, vendorId } },
    });
    if (exists) return res.status(409).json({ error: 'Vendor already added to this indent' });
    const row = await prisma.purchaseRequisitionVendor.create({
      data: { requisitionId: req.params.id, vendorId },
      include: { vendor: { select: { id: true, name: true, email: true, phone: true } } },
    });
    res.status(201).json(row);
}));

// PUT /:id/vendors/:vrId — update quote rate / remarks / email meta
router.put('/:id/vendors/:vrId', asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    if (b.vendorRate !== undefined) {
      const rate = typeof b.vendorRate === 'number' ? b.vendorRate : parseFloat(b.vendorRate as string);
      if (isNaN(rate) || rate < 0) return res.status(400).json({ error: 'Invalid rate' });
      data.vendorRate = rate;
      data.quotedAt = new Date();
      data.quoteSource = b.quoteSource || 'MANUAL';
    }
    if (b.quoteRemarks !== undefined) data.quoteRemarks = b.quoteRemarks;
    if (b.quoteSource !== undefined) data.quoteSource = b.quoteSource;
    if (b.quoteEmailSubject !== undefined) data.quoteEmailSubject = b.quoteEmailSubject;
    if (b.quoteEmailThreadId !== undefined) data.quoteEmailThreadId = b.quoteEmailThreadId;
    if (b.quoteEmailMessageId !== undefined) data.quoteEmailMessageId = b.quoteEmailMessageId;

    const row = await prisma.purchaseRequisitionVendor.update({
      where: { id: req.params.vrId },
      data,
      include: { vendor: { select: { id: true, name: true, email: true, phone: true } } },
    });
    res.json(row);
}));

// POST /:id/vendors/:vrId/request-quote — mark as requested (stores email meta)
router.post('/:id/vendors/:vrId/request-quote', asyncHandler(async (req: AuthRequest, res: Response) => {
    const user = req.user!;
    const { emailSubject, threadId, messageId } = req.body as {
      emailSubject?: string; threadId?: string; messageId?: string;
    };
    const row = await prisma.purchaseRequisitionVendor.update({
      where: { id: req.params.vrId },
      data: {
        quoteRequestedAt: new Date(),
        quoteRequestedBy: user.name || user.email,
        quoteEmailSubject: emailSubject || null,
        quoteEmailThreadId: threadId || null,
        quoteEmailMessageId: messageId || null,
      },
      include: { vendor: { select: { id: true, name: true, email: true, phone: true } } },
    });
    res.json(row);
}));

// POST /:id/vendors/:vrId/award — award this vendor as the winning one.
// Sets PR.vendorId to this vendor, marks this row isAwarded=true, clears others.
router.post('/:id/vendors/:vrId/award', asyncHandler(async (req: AuthRequest, res: Response) => {
    const row = await prisma.purchaseRequisitionVendor.findUnique({ where: { id: req.params.vrId } });
    if (!row || row.requisitionId !== req.params.id) return res.status(404).json({ error: 'Quote row not found' });
    if (row.vendorRate == null || row.vendorRate <= 0) return res.status(400).json({ error: 'Cannot award — enter a rate first' });

    const [, , pr] = await prisma.$transaction([
      prisma.purchaseRequisitionVendor.updateMany({ where: { requisitionId: req.params.id }, data: { isAwarded: false } }),
      prisma.purchaseRequisitionVendor.update({ where: { id: req.params.vrId }, data: { isAwarded: true } }),
      prisma.purchaseRequisition.update({
        where: { id: req.params.id },
        data: { vendorId: row.vendorId, vendorRate: row.vendorRate, vendorQuotedAt: row.quotedAt, quoteSource: row.quoteSource },
        include: {
          vendor: { select: { id: true, name: true, email: true, phone: true } },
          quotes: { include: { vendor: { select: { id: true, name: true, email: true, phone: true } } } },
        },
      }),
    ]);
    res.json(pr);
}));

// DELETE /:id/vendors/:vrId — remove a vendor quote row
router.delete('/:id/vendors/:vrId', asyncHandler(async (req: AuthRequest, res: Response) => {
    await prisma.purchaseRequisitionVendor.delete({ where: { id: req.params.vrId } });
    res.json({ ok: true });
}));

// ── RFQ Email Flow ──
// Helper — build the data passed into the HBS template
async function buildRfqData(prId: string, vrId: string, preparedBy: string) {
  const [pr, vr] = await Promise.all([
    prisma.purchaseRequisition.findUnique({
      where: { id: prId },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    }),
    prisma.purchaseRequisitionVendor.findUnique({
      where: { id: vrId },
      include: { vendor: { select: { id: true, name: true, address: true, email: true, phone: true, contactPerson: true, gstin: true } } },
    }),
  ]);
  if (!pr) throw new Error('Indent not found');
  if (!vr) throw new Error('Vendor quote row not found');

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 7); // default 7-day window

  const lines = (pr.lines.length > 0 ? pr.lines : [{
    lineNo: 1, itemName: pr.itemName, quantity: pr.quantity, unit: pr.unit, remarks: null,
  }]).map(l => ({
    lineNo: l.lineNo,
    itemName: l.itemName,
    quantity: l.quantity,
    unit: l.unit,
    remarks: l.remarks || '',
  }));

  return {
    pr,
    vr,
    data: {
      reqNo: pr.reqNo,
      refSuffix: vrId.slice(0, 6),
      createdAt: new Date().toISOString(),
      validUntil: validUntil.toISOString(),
      department: pr.department,
      justification: pr.justification,
      lines,
      vendor: vr.vendor,
      preparedBy,
    },
  };
}

// GET /:id/vendors/:vrId/rfq-pdf — RFQ PDF preview (streams PDF)
router.get('/:id/vendors/:vrId/rfq-pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { data, pr } = await buildRfqData(req.params.id, req.params.vrId, req.user!.name || req.user!.email);
    const pdf = await renderDocumentPdf({ docType: 'RFQ', data });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="RFQ-${pr.reqNo}-${req.params.vrId.slice(0, 6)}.pdf"`);
    res.send(pdf);
}));

// POST /:id/vendors/:vrId/send-rfq — generate PDF + email vendor + store messageId
// Body: { extraMessage?: string, cc?: string }
router.post('/:id/vendors/:vrId/send-rfq', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { extraMessage, cc } = req.body as { extraMessage?: string; cc?: string };
    const { pr, vr, data } = await buildRfqData(req.params.id, req.params.vrId, req.user!.name || req.user!.email);

    if (!vr.vendor.email) return res.status(400).json({ error: 'Vendor has no email on file' });

    const pdf = await renderDocumentPdf({ docType: 'RFQ', data });

    const subject = `RFQ-${pr.reqNo}-${req.params.vrId.slice(0, 6)} — Request for Quotation from MSPIL`;
    const linesSummary = data.lines.map(l => `  ${l.lineNo}. ${l.itemName} — ${l.quantity} ${l.unit}`).join('\n');
    const text = `Dear ${vr.vendor.contactPerson || vr.vendor.name},

Please find attached our Request for Quotation (RFQ-${pr.reqNo}-${req.params.vrId.slice(0, 6)}).

Items requested:
${linesSummary}

Kindly send your best rate along with GST %, delivery time, and payment terms.

IMPORTANT: Please REPLY ON THIS SAME EMAIL so our system can match your quote automatically. Do not start a new thread.
${extraMessage ? `\n${extraMessage}\n` : ''}
Regards,
${data.preparedBy}
Mahakaushal Sugar and Power Industries Ltd (MSPIL)
`;

    const html = `<p>Dear ${vr.vendor.contactPerson || vr.vendor.name},</p>
<p>Please find attached our Request for Quotation (<b>RFQ-${pr.reqNo}-${req.params.vrId.slice(0, 6)}</b>).</p>
<p><b>Items requested:</b></p>
<ol>${data.lines.map(l => `<li>${l.itemName} — ${l.quantity} ${l.unit}${l.remarks ? ` (${l.remarks})` : ''}</li>`).join('')}</ol>
<p>Kindly send your best rate along with GST %, delivery time, and payment terms.</p>
<p style="background:#fff7ed;padding:8px;border-left:3px solid #f97316;"><b>IMPORTANT:</b> Please <b>REPLY ON THIS SAME EMAIL</b> so our system can match your quote automatically. Do not start a new thread.</p>
${extraMessage ? `<p>${extraMessage}</p>` : ''}
<p>Regards,<br>${data.preparedBy}<br>Mahakaushal Sugar and Power Industries Ltd (MSPIL)</p>`;

    const result = await sendThreadEmail({
      entityType: 'INDENT_QUOTE',
      entityId: req.params.vrId,
      vendorId: vr.vendorId,
      subject,
      to: vr.vendor.email,
      cc: cc || undefined,
      bodyText: text,
      bodyHtml: html,
      attachments: [{
        filename: `RFQ-${pr.reqNo}-${req.params.vrId.slice(0, 6)}.pdf`,
        content: pdf,
        contentType: 'application/pdf',
      }],
      sentBy: req.user!.name || req.user!.email,
      companyId: pr.companyId,
    });

    if (!result.success) return res.status(502).json({ error: result.error || 'Failed to send email' });

    // Mirror the messageId on the quote row so older UI/reports keep working
    await prisma.purchaseRequisitionVendor.update({
      where: { id: req.params.vrId },
      data: {
        quoteRequestedAt: new Date(),
        quoteRequestedBy: req.user!.name || req.user!.email,
        quoteEmailSubject: subject,
        quoteEmailMessageId: result.messageId || null,
        quoteEmailThreadId: result.messageId || null,
      },
    });

    res.json({ ok: true, messageId: result.messageId, sentTo: vr.vendor.email, threadDbId: result.thread.id });
}));

// GET /:id/vendors/:vrId/replies — sync IMAP + return persisted replies + threadDbId
router.get('/:id/vendors/:vrId/replies', asyncHandler(async (req: AuthRequest, res: Response) => {
    const thread = await latestThreadFor('INDENT_QUOTE', req.params.vrId);
    if (!thread) return res.json({ replies: [], threadDbId: null, error: 'RFQ email not sent yet' });

    const result = await syncAndListReplies(thread.id);
    res.json({
      threadDbId: thread.id,
      replies: result.replies.map(r => ({
        id: r.id,
        messageId: r.providerMessageId,
        from: r.fromEmail,
        fromName: r.fromName,
        subject: r.subject,
        date: r.receivedAt,
        bodyText: r.bodyText,
        bodyHtml: r.bodyHtml,
        attachments: Array.isArray(r.attachments)
          ? (r.attachments as Array<{ filename: string; size: number; contentType: string }>).map(a => ({ filename: a.filename, size: a.size, contentType: a.contentType }))
          : [],
      })),
      newCount: result.newCount,
      fetchError: result.fetchError,
    });
}));

// POST /:id/vendors/:vrId/extract-quote — run Gemini on the latest reply + attachments
router.post('/:id/vendors/:vrId/extract-quote', asyncHandler(async (req: AuthRequest, res: Response) => {
    const vr = await prisma.purchaseRequisitionVendor.findUnique({
      where: { id: req.params.vrId },
      include: {
        vendor: { select: { email: true } },
        requisition: { select: { reqNo: true, lines: { orderBy: { lineNo: 'asc' } }, itemName: true, quantity: true, unit: true } },
      },
    });
    if (!vr) return res.status(404).json({ error: 'Not found' });

    const thread = await latestThreadFor('INDENT_QUOTE', req.params.vrId);
    if (!thread) return res.status(400).json({ error: 'RFQ email not sent yet' });

    // Sync + get the latest reply from the DB (full base64 attachments)
    await syncAndListReplies(thread.id);
    const latestReply = await prisma.emailReply.findFirst({
      where: { threadId: thread.id },
      orderBy: { receivedAt: 'desc' },
    });
    if (!latestReply) return res.status(404).json({ error: 'No replies found yet' });

    const attachments = Array.isArray(latestReply.attachments)
      ? (latestReply.attachments as Array<{ filename: string; contentType: string; contentBase64: string }>)
      : [];

    const expectedLines = (vr.requisition.lines.length > 0 ? vr.requisition.lines : [{
      lineNo: 1, itemName: vr.requisition.itemName, quantity: vr.requisition.quantity, unit: vr.requisition.unit,
    }]).map(l => ({ lineNo: l.lineNo ?? 1, itemName: l.itemName, quantity: l.quantity, unit: l.unit }));

    const extracted = await extractQuoteFromReply({
      replyBody: latestReply.bodyText || latestReply.bodyHtml || '',
      attachments,
      expectedLines,
    });

    if (!extracted) return res.status(503).json({ error: 'AI extraction not configured (GEMINI_API_KEY missing)' });

    // If we got a usable unit rate, optionally auto-save it
    let savedRate: number | null = null;
    if (req.body.autoApply && extracted.confidence !== 'LOW') {
      // Prefer the first line's rate, else the overall extracted total / qty
      const firstLine = extracted.lineRates.find(l => typeof l.unitRate === 'number' && l.unitRate > 0);
      const rate = firstLine?.unitRate
        ?? (extracted.extractedTotal && vr.requisition.quantity > 0
            ? Math.round((extracted.extractedTotal / vr.requisition.quantity) * 100) / 100
            : null);
      if (rate) {
        await prisma.purchaseRequisitionVendor.update({
          where: { id: req.params.vrId },
          data: {
            vendorRate: rate,
            quotedAt: new Date(),
            quoteSource: 'EMAIL_AUTO',
            quoteRemarks: [
              extracted.overallRateNote,
              extracted.paymentTerms ? `Payment: ${extracted.paymentTerms}` : null,
              extracted.deliveryDays ? `Delivery: ${extracted.deliveryDays} days` : null,
              extracted.freightTerms ? `Freight: ${extracted.freightTerms}` : null,
            ].filter(Boolean).join(' · ') || null,
          },
        });
        savedRate = rate;
      }
    }

    // Persist AI extraction on the reply row for future reference
    await prisma.emailReply.update({
      where: { id: latestReply.id },
      data: {
        aiExtractedJson: extracted as unknown as object,
        aiExtractedAt: new Date(),
        aiConfidence: extracted.confidence,
      },
    });

    res.json({ extracted, savedRate, reply: { from: latestReply.fromEmail, subject: latestReply.subject, date: latestReply.receivedAt } });
}));

// GET /:id/vendors/:vrId/attachment/:filename — serve reply attachment from persisted EmailReply
router.get('/:id/vendors/:vrId/attachment/:filename', asyncHandler(async (req: AuthRequest, res: Response) => {
    const thread = await latestThreadFor('INDENT_QUOTE', req.params.vrId);
    if (!thread) return res.status(404).json({ error: 'No thread' });
    const replies = await prisma.emailReply.findMany({ where: { threadId: thread.id } });
    for (const r of replies) {
      const atts = Array.isArray(r.attachments)
        ? r.attachments as Array<{ filename: string; contentType: string; contentBase64: string }>
        : [];
      const att = atts.find(a => a.filename === req.params.filename);
      if (att) {
        res.setHeader('Content-Type', att.contentType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${att.filename}"`);
        res.send(Buffer.from(att.contentBase64, 'base64'));
        return;
      }
    }
    res.status(404).json({ error: 'Attachment not found' });
}));

// GET /item-history/:itemId — past POs for an inventory item (last 10)
// Used in the indent detail to show "we've bought this before at these rates".
router.get('/item-history/:itemId', asyncHandler(async (req: AuthRequest, res: Response) => {
    const itemId = req.params.itemId;
    const lines = await prisma.pOLine.findMany({
      where: { inventoryItemId: itemId },
      orderBy: { po: { poDate: 'desc' } },
      take: 10,
      select: {
        id: true,
        rate: true,
        quantity: true,
        unit: true,
        po: {
          select: {
            id: true,
            poNo: true,
            poDate: true,
            status: true,
            vendor: { select: { id: true, name: true, phone: true, email: true } },
          },
        },
      },
    });
    const recent = lines.map(l => ({
      lineId: l.id,
      rate: l.rate,
      quantity: l.quantity,
      unit: l.unit,
      poId: l.po?.id,
      poNo: l.po?.poNo,
      poDate: l.po?.poDate,
      status: l.po?.status,
      vendorId: l.po?.vendor?.id,
      vendorName: l.po?.vendor?.name,
      vendorPhone: l.po?.vendor?.phone,
      vendorEmail: l.po?.vendor?.email,
    }));
    // Also compute stats
    const rates = recent.map(r => r.rate).filter(r => r > 0);
    const stats = rates.length === 0 ? null : {
      minRate: Math.min(...rates),
      maxRate: Math.max(...rates),
      avgRate: Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100) / 100,
      lastRate: rates[0],
      totalPos: rates.length,
    };
    res.json({ recent, stats });
}));

// GET /stats
router.get('/stats', asyncHandler(async (_req: AuthRequest, res: Response) => {
    const reqs = await prisma.purchaseRequisition.findMany({ where: { ...getCompanyFilter(_req) } });
    const byStatus: Record<string, number> = {};
    const byUrgency: Record<string, number> = {};
    let totalValue = 0;
    let pendingValue = 0;
    for (const r of reqs) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      byUrgency[r.urgency] = (byUrgency[r.urgency] || 0) + 1;
      const val = r.quantity * r.estimatedCost;
      totalValue += val;
      if (['DRAFT', 'SUBMITTED'].includes(r.status)) pendingValue += val;
    }
    res.json({ byStatus, byUrgency, total: reqs.length, totalValue, pendingValue });
}));

// GET /:id
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const pr = await prisma.purchaseRequisition.findUnique({ where: { id: req.params.id } });
    if (!pr) return res.status(404).json({ error: 'Requisition not found' });
    res.json(pr);
}));

// POST /bulk — create multiple requisitions in one transaction (Excel-style entry)
router.post('/bulk', asyncHandler(async (req: AuthRequest, res: Response) => {
    const user = req.user!;
    const common = req.body.common || {};
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (rows.length === 0) return res.status(400).json({ error: 'No rows provided' });
    if (rows.length > 100) return res.status(400).json({ error: 'Max 100 rows per bulk submit' });

    // Validate all rows first (fail fast before any DB write)
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const qty = parseFloat(r.quantity);
      if (!r.itemName || !String(r.itemName).trim()) return res.status(400).json({ error: `Row ${i + 1}: item name required` });
      if (isNaN(qty) || qty <= 0) return res.status(400).json({ error: `Row ${i + 1}: quantity must be > 0` });
    }

    const companyId = getActiveCompanyId(req);
    const requestedBy = user.name || user.email;
    const initialStatus = req.body.status === 'SUBMITTED' ? 'SUBMITTED' : 'DRAFT';

    const created = await prisma.$transaction(
      rows.map((r: any) => prisma.purchaseRequisition.create({
        data: {
          title: r.title || `Need ${r.itemName}`,
          itemName: String(r.itemName).trim(),
          quantity: parseFloat(r.quantity),
          unit: r.unit || 'nos',
          estimatedCost: parseFloat(r.estimatedCost) || 0,
          urgency: r.urgency || common.urgency || 'ROUTINE',
          category: r.category || common.category || 'GENERAL',
          justification: r.justification || null,
          supplier: r.supplier || null,
          status: initialStatus,
          remarks: r.remarks || null,
          requestedBy,
          userId: user.id,
          inventoryItemId: r.inventoryItemId || null,
          department: r.department || common.department || null,
          requestedByPerson: r.requestedByPerson || common.requestedByPerson || null,
          companyId,
        },
      }))
    );
    res.status(201).json({ created: created.length, requisitions: created });
}));

// POST / — create new requisition (optionally with multiple lines)
// Body: { department, urgency, category, justification, requestedByPerson, remarks, lines: [{itemName, quantity, unit, estimatedCost, inventoryItemId?, remarks?}, ...] }
// If `lines` is absent, falls back to single-line mode using itemName/quantity/unit on the body (backward compat).
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body;
    const user = req.user!;
    const initialStatus = b.status === 'SUBMITTED' ? 'SUBMITTED' : 'DRAFT';

    // Normalize lines — use body.lines[] if provided, else synthesize a single line
    const rawLines = Array.isArray(b.lines) && b.lines.length > 0 ? b.lines : [{
      itemName: b.itemName,
      quantity: b.quantity,
      unit: b.unit,
      estimatedCost: b.estimatedCost,
      inventoryItemId: b.inventoryItemId,
      remarks: b.remarks,
    }];

    // Validate
    for (let i = 0; i < rawLines.length; i++) {
      const l = rawLines[i];
      if (!l.itemName || !String(l.itemName).trim()) return res.status(400).json({ error: `Line ${i + 1}: item name required` });
      const q = parseFloat(l.quantity);
      if (isNaN(q) || q <= 0) return res.status(400).json({ error: `Line ${i + 1}: quantity must be > 0` });
    }

    // First line drives the PR header (itemName/quantity/unit kept for backward compat)
    const first = rawLines[0];

    const pr = await prisma.$transaction(async (tx) => {
      const created = await tx.purchaseRequisition.create({
        data: {
          title: b.title || `Need ${first.itemName}${rawLines.length > 1 ? ` (+${rawLines.length - 1} more)` : ''}`,
          itemName: String(first.itemName).trim(),
          quantity: parseFloat(first.quantity) || 1,
          unit: first.unit || 'nos',
          estimatedCost: parseFloat(first.estimatedCost) || 0,
          urgency: b.urgency || 'ROUTINE',
          category: b.category || 'GENERAL',
          justification: b.justification || null,
          linkedIssueId: b.linkedIssueId || null,
          supplier: b.supplier || null,
          status: initialStatus,
          remarks: b.remarks || null,
          requestedBy: user.name || user.email,
          userId: user.id,
          inventoryItemId: first.inventoryItemId || null,
          department: b.department || null,
          requestedByPerson: b.requestedByPerson || null,
          vendorId: b.vendorId || null,
          companyId: getActiveCompanyId(req),
        },
      });

      // Create line rows
      await tx.purchaseRequisitionLine.createMany({
        data: rawLines.map((l: Record<string, unknown>, i: number) => ({
          requisitionId: created.id,
          lineNo: i + 1,
          itemName: String(l.itemName).trim(),
          quantity: parseFloat(l.quantity as string) || 1,
          unit: (l.unit as string) || 'nos',
          estimatedCost: parseFloat(l.estimatedCost as string) || 0,
          inventoryItemId: (l.inventoryItemId as string) || null,
          remarks: (l.remarks as string) || null,
        })),
      });

      return tx.purchaseRequisition.findUnique({
        where: { id: created.id },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
    });
    res.status(201).json(pr);
}));

// POST /:id/lines — add a line to an existing indent
router.post('/:id/lines', asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body;
    if (!b.itemName || !String(b.itemName).trim()) return res.status(400).json({ error: 'itemName required' });
    const qty = parseFloat(b.quantity);
    if (isNaN(qty) || qty <= 0) return res.status(400).json({ error: 'quantity must be > 0' });

    const maxLine = await prisma.purchaseRequisitionLine.findFirst({
      where: { requisitionId: req.params.id },
      orderBy: { lineNo: 'desc' },
      select: { lineNo: true },
    });
    const line = await prisma.purchaseRequisitionLine.create({
      data: {
        requisitionId: req.params.id,
        lineNo: (maxLine?.lineNo || 0) + 1,
        itemName: String(b.itemName).trim(),
        quantity: qty,
        unit: b.unit || 'nos',
        estimatedCost: parseFloat(b.estimatedCost) || 0,
        inventoryItemId: b.inventoryItemId || null,
        remarks: b.remarks || null,
      },
    });
    res.status(201).json(line);
}));

// PUT /:id/lines/:lineId — update a line
router.put('/:id/lines/:lineId', asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body;
    const data: Record<string, unknown> = {};
    if (b.itemName !== undefined) data.itemName = String(b.itemName).trim();
    if (b.quantity !== undefined) data.quantity = parseFloat(b.quantity);
    if (b.unit !== undefined) data.unit = b.unit;
    if (b.estimatedCost !== undefined) data.estimatedCost = parseFloat(b.estimatedCost) || 0;
    if (b.inventoryItemId !== undefined) data.inventoryItemId = b.inventoryItemId || null;
    if (b.remarks !== undefined) data.remarks = b.remarks;
    const line = await prisma.purchaseRequisitionLine.update({
      where: { id: req.params.lineId },
      data,
    });
    res.json(line);
}));

// DELETE /:id/lines/:lineId
router.delete('/:id/lines/:lineId', asyncHandler(async (req: AuthRequest, res: Response) => {
    await prisma.purchaseRequisitionLine.delete({ where: { id: req.params.lineId } });
    res.json({ ok: true });
}));

// GET /:id/stock-check — check available stock for this indent's item
router.get('/:id/stock-check', asyncHandler(async (req: AuthRequest, res: Response) => {
    const pr = await prisma.purchaseRequisition.findUnique({ where: { id: req.params.id } });
    if (!pr) return res.status(404).json({ error: 'Requisition not found' });

    let available = 0;
    let itemUnit = pr.unit;
    if (pr.inventoryItemId) {
      const item = await prisma.inventoryItem.findUnique({ where: { id: pr.inventoryItemId }, select: { currentStock: true, unit: true, costPerUnit: true } });
      if (item) {
        available = item.currentStock;
        itemUnit = item.unit;
      }
    }
    const requested = pr.quantity;
    const canFulfillFromStock = Math.min(available, requested);
    const shortfall = Math.max(0, requested - available);

    res.json({ available, requested, canFulfillFromStock, shortfall, unit: itemUnit });
}));

// POST /:id/request-quote — record that we've asked a vendor for a quote.
// Optionally triggers an email via the Gmail MCP integration (caller passes sendEmail: true).
// For now this just persists the metadata; the Gmail send is a follow-up enhancement.
router.post('/:id/request-quote', asyncHandler(async (req: AuthRequest, res: Response) => {
    const user = req.user!;
    const { vendorId, emailSubject, threadId, messageId } = req.body as {
      vendorId?: string; emailSubject?: string; threadId?: string; messageId?: string;
    };
    if (!vendorId) return res.status(400).json({ error: 'vendorId required' });

    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true, name: true, email: true } });
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

    const pr = await prisma.purchaseRequisition.update({
      where: { id: req.params.id },
      data: {
        vendorId,
        quoteRequestedAt: new Date(),
        quoteRequestedBy: user.name || user.email,
        quoteEmailSubject: emailSubject || null,
        quoteEmailThreadId: threadId || null,
        quoteEmailMessageId: messageId || null,
      },
    });
    res.json({ requisition: pr, vendor });
}));

// PUT /:id/update-quote-rate — manually enter or update the vendor's quoted rate.
// Also used by the future AI email-extractor (source = EMAIL_AUTO).
router.put('/:id/update-quote-rate', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { vendorRate, quoteSource, quoteRemarks, vendorId } = req.body as {
      vendorRate?: number | string; quoteSource?: string; quoteRemarks?: string; vendorId?: string;
    };
    const rate = typeof vendorRate === 'number' ? vendorRate : parseFloat(vendorRate as string);
    if (isNaN(rate) || rate < 0) return res.status(400).json({ error: 'Invalid rate' });

    const data: Record<string, unknown> = {
      vendorRate: rate,
      vendorQuotedAt: new Date(),
      quoteSource: quoteSource || 'MANUAL',
    };
    if (quoteRemarks !== undefined) data.quoteRemarks = quoteRemarks;
    if (vendorId) data.vendorId = vendorId;

    const pr = await prisma.purchaseRequisition.update({
      where: { id: req.params.id },
      data,
    });
    res.json(pr);
}));

// PUT /:id/issue — warehouse issues stock and splits remaining to purchase
// Role-guarded: only ADMIN/MANAGER can issue stock and trigger auto-PO
router.put('/:id/issue', asyncHandler(async (req: AuthRequest, res: Response) => {
    const user = req.user!;
    if (!['ADMIN', 'MANAGER'].includes(user.role)) {
      return res.status(403).json({ error: 'Only ADMIN or MANAGER can issue from store' });
    }

    let pr = await prisma.purchaseRequisition.findUnique({ where: { id: req.params.id } });
    if (!pr) return res.status(404).json({ error: 'Requisition not found' });

    // Fast-track: auto-approve DRAFT/SUBMITTED indents when store manager issues directly
    if (['DRAFT', 'SUBMITTED'].includes(pr.status)) {
      pr = await prisma.purchaseRequisition.update({
        where: { id: pr.id },
        data: { status: 'APPROVED', approvedBy: user.name || user.email, approvedAt: new Date() },
      });
    }
    if (pr.status !== 'APPROVED') return res.status(400).json({ error: 'Can only issue from APPROVED status' });

    // Validate issuedQty with strict parsing (Codex: don't let malformed input become 0)
    const rawQty = req.body.issuedQty;
    const issueQty = typeof rawQty === 'number' ? rawQty : parseFloat(rawQty);
    if (isNaN(issueQty) || issueQty < 0 || issueQty > pr.quantity) {
      return res.status(400).json({ error: `Invalid issue quantity: must be 0–${pr.quantity}` });
    }

    const purchaseQty = Math.round((pr.quantity - issueQty) * 1000) / 1000;

    // If issuing from stock, validate availability and create proper stock movement
    if (issueQty > 0 && pr.inventoryItemId) {
      // Stock check + deduction inside transaction to prevent oversell (Codex race condition fix)
      try {
        await prisma.$transaction(async (tx) => {
          const item = await tx.inventoryItem.findUnique({
            where: { id: pr.inventoryItemId! },
            select: { id: true, currentStock: true, avgCost: true, unit: true, name: true },
          });
          if (!item) throw new Error('Inventory item not found');
          if (item.currentStock < issueQty) {
            throw new Error(`Insufficient stock: available ${item.currentStock} ${item.unit}, requested ${issueQty} ${item.unit}`);
          }

          // Create legacy InventoryTransaction (for backward compat)
          await tx.inventoryTransaction.create({
            data: {
              itemId: pr.inventoryItemId!,
              type: 'OUT',
              quantity: issueQty,
              reference: `INDENT-${pr.reqNo}`,
              department: pr.department || 'Production',
              issuedTo: pr.requestedByPerson || pr.requestedBy,
              remarks: `Indent #${pr.reqNo}: ${pr.title}`,
              userId: user.id,
            },
          });

          // Create proper StockMovement (new ledger)
          const defaultWh = await tx.warehouse.findFirst({
            where: { isActive: true },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
          });
          if (defaultWh) {
            await tx.stockMovement.create({
              data: {
                itemId: pr.inventoryItemId!,
                movementType: 'STORE_ISSUE',
                direction: 'OUT',
                quantity: issueQty,
                unit: item.unit,
                costRate: item.avgCost,
                totalValue: Math.round(issueQty * item.avgCost * 100) / 100,
                warehouseId: defaultWh.id,
                refType: 'INDENT',
                refId: pr.id,
                refNo: `INDENT-${pr.reqNo}`,
                narration: `Store issue: ${pr.title} (${pr.requestedByPerson || pr.requestedBy})`,
                userId: user.id,
              },
            });

            // Update StockLevel
            const sl = await tx.stockLevel.findFirst({
              where: { itemId: pr.inventoryItemId!, warehouseId: defaultWh.id, binId: null, batchId: null },
            });
            if (sl) {
              await tx.stockLevel.update({
                where: { id: sl.id },
                data: { quantity: { decrement: issueQty } },
              });
            }
          }

          // Decrement global stock
          await tx.inventoryItem.update({
            where: { id: pr.inventoryItemId! },
            data: {
              currentStock: { decrement: issueQty },
              totalValue: { decrement: Math.round(issueQty * item.avgCost * 100) / 100 },
            },
          });
        });
      } catch (txErr: unknown) {
        // Map known validation errors to 400 instead of letting them bubble as 500
        const msg = txErr instanceof Error ? txErr.message : 'Stock issue failed';
        if (msg.includes('Insufficient stock') || msg.includes('not found')) {
          return res.status(400).json({ error: msg });
        }
        throw txErr; // re-throw unknown errors for asyncHandler to handle as 500
      }
    }

    // Determine new status
    const newStatus = issueQty >= pr.quantity ? 'COMPLETED' : purchaseQty > 0 ? 'PO_PENDING' : 'COMPLETED';

    const updated = await prisma.purchaseRequisition.update({
      where: { id: req.params.id },
      data: {
        issuedQty: issueQty,
        purchaseQty,
        issuedBy: user.name || user.email,
        issuedAt: issueQty > 0 ? new Date() : null,
        status: newStatus,
      },
    });

    // Auto-create DRAFT PO for purchase shortfall (outside stock transaction — failure is non-fatal)
    let autoPO: { created: boolean; poId?: string; poNo?: number; vendorName?: string; rate?: number; quantity?: number; grandTotal?: number; reason?: string } | null = null;

    if (purchaseQty > 0 && pr.inventoryItemId) {
      try {
        // Idempotency check: don't create duplicate PO for same indent (Codex fix)
        const existingPO = await prisma.purchaseOrder.findFirst({
          where: { requisitionId: pr.id, status: { not: 'CANCELLED' } },
          select: { id: true, poNo: true },
        });
        if (existingPO) {
          autoPO = { created: false, reason: `PO #${existingPO.poNo} already exists for this indent` };
        } else {
          // Find preferred vendor — also check vendor.isActive (Codex fix)
          const vendorItem = await prisma.vendorItem.findFirst({
            where: {
              inventoryItemId: pr.inventoryItemId,
              isPreferred: true,
              isActive: true,
              vendor: { isActive: true },
            },
            orderBy: { updatedAt: 'desc' }, // deterministic: most recently updated preferred vendor
            include: {
              vendor: { select: { id: true, name: true, gstState: true, paymentTerms: true, creditDays: true } },
              item: { select: { name: true, hsnCode: true, gstPercent: true, unit: true } },
            },
          });

          if (vendorItem && vendorItem.rate > 0) {
            // Determine GST supply type: compare vendor state code with company state code
            const vendorStateCode = vendorItem.vendor.gstState || '';
            const supplyType = vendorStateCode && vendorStateCode !== COMPANY.stateCode ? 'INTER_STATE' : 'INTRA_STATE';

            const po = await createPurchaseOrder({
              vendorId: vendorItem.vendor.id,
              lines: [{
                inventoryItemId: pr.inventoryItemId,
                description: vendorItem.item.name,
                hsnCode: vendorItem.item.hsnCode || undefined,
                quantity: purchaseQty,
                unit: vendorItem.item.unit || pr.unit,
                rate: vendorItem.rate,
                gstPercent: vendorItem.item.gstPercent || 18,
              }],
              supplyType: supplyType as 'INTRA_STATE' | 'INTER_STATE',
              requisitionId: pr.id,
              userId: user.id,
              remarks: `Auto-created from Indent #${pr.reqNo}`,
              paymentTerms: vendorItem.vendor.paymentTerms || undefined,
              creditDays: vendorItem.vendor.creditDays || 30,
            });

            autoPO = {
              created: true,
              poId: po.id,
              poNo: po.poNo,
              vendorName: vendorItem.vendor.name,
              rate: vendorItem.rate,
              quantity: purchaseQty,
              grandTotal: po.grandTotal,
            };
          } else {
            autoPO = {
              created: false,
              reason: !vendorItem
                ? 'No approved vendor found for this item — manual PO required'
                : 'Vendor rate is 0 — manual PO required with negotiated rate',
            };
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        autoPO = { created: false, reason: `Auto-PO failed: ${message}` };
      }
    }

    res.json({
      requisition: updated,
      issue: { issuedQty: issueQty, purchaseQty, status: newStatus },
      autoPO,
    });
}));

// PUT /:id — update requisition
router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body;
    const data: any = {};
    // Editable fields
    if (b.title !== undefined) data.title = b.title;
    if (b.itemName !== undefined) data.itemName = b.itemName;
    if (b.quantity !== undefined) data.quantity = parseFloat(b.quantity);
    if (b.unit !== undefined) data.unit = b.unit;
    if (b.estimatedCost !== undefined) data.estimatedCost = parseFloat(b.estimatedCost);
    if (b.urgency !== undefined) data.urgency = b.urgency;
    if (b.category !== undefined) data.category = b.category;
    if (b.justification !== undefined) data.justification = b.justification;
    if (b.supplier !== undefined) data.supplier = b.supplier;
    if (b.remarks !== undefined) data.remarks = b.remarks;
    if (b.department !== undefined) data.department = b.department;
    if (b.requestedByPerson !== undefined) data.requestedByPerson = b.requestedByPerson;
    if (b.inventoryItemId !== undefined) data.inventoryItemId = b.inventoryItemId;
    if (b.vendorId !== undefined) data.vendorId = b.vendorId || null;
    // Status transitions — enforce valid paths server-side
    if (b.status !== undefined) {
      const existing = await prisma.purchaseRequisition.findUnique({ where: { id: req.params.id }, select: { status: true } });
      if (!existing) return res.status(404).json({ error: 'Requisition not found' });

      const validTransitions: Record<string, string[]> = {
        'DRAFT': ['SUBMITTED', 'APPROVED', 'CANCELLED'],
        'SUBMITTED': ['APPROVED', 'REJECTED', 'DRAFT'],
        'APPROVED': ['ISSUED', 'PO_PENDING', 'COMPLETED', 'CANCELLED'],
        'REJECTED': ['DRAFT'],
        'PO_PENDING': ['ORDERED', 'COMPLETED', 'CANCELLED'],
        'ORDERED': ['RECEIVED', 'COMPLETED', 'CANCELLED'],
        'RECEIVED': ['COMPLETED'],
        'ISSUED': ['COMPLETED'],
        'COMPLETED': [],
        'CANCELLED': ['DRAFT'],
      };

      const allowed = validTransitions[existing.status] || [];
      if (!allowed.includes(b.status)) {
        return res.status(400).json({ error: `Invalid status transition: ${existing.status} → ${b.status}` });
      }

      // Role-based authorization for approval actions
      const userRole = req.user!.role;
      if (b.status === 'APPROVED' && !['ADMIN', 'MANAGER'].includes(userRole)) {
        return res.status(403).json({ error: 'Only ADMIN or MANAGER can approve requisitions' });
      }
      if (b.status === 'REJECTED' && !['ADMIN', 'MANAGER'].includes(userRole)) {
        return res.status(403).json({ error: 'Only ADMIN or MANAGER can reject requisitions' });
      }

      data.status = b.status;
      if (b.status === 'APPROVED') {
        data.approvedBy = req.user!.name || req.user!.email;
        data.approvedAt = new Date();
      }
      if (b.status === 'REJECTED') {
        data.rejectionReason = b.rejectionReason || null;
      }
    }

    const pr = await prisma.purchaseRequisition.update({
      where: { id: req.params.id },
      data,
    });
    res.json(pr);
}));

// DELETE /:id
router.delete('/:id', authorize('ADMIN') as any, asyncHandler(async (req: AuthRequest, res: Response) => {
    await prisma.purchaseRequisition.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
}));

export default router;
