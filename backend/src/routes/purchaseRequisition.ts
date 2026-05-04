import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { createPurchaseOrder } from '../services/purchaseOrderService';
import { COMPANY } from '../shared/config/company';
import { renderDocumentPdf } from '../services/documentRenderer';
import { sendThreadEmail, syncAndListReplies, latestThreadFor } from '../services/emailService';
import { extractQuoteFromReply, effectiveLineDiscount, quoteCostFieldsForDb } from '../services/rfqQuoteExtractor';
import { notifyOnNewRfqReply } from '../services/rfqReplyPoller';
import { autoExtractIfWaiting } from '../services/rfqAutoExtract';
import { nextDocNo } from '../utils/docSequence';

const router = Router();
router.use(authenticate);

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
        purchaseOrders: {
          where: { status: { not: 'CANCELLED' } },
          orderBy: { createdAt: 'desc' },
          select: { id: true, poNo: true, status: true, grandTotal: true },
        },
      },
    });

    // Attach priced-line counts per vendor quote. Wrapped in try/catch so the
    // page still loads on a fresh deploy where the PurchaseRequisitionVendorLine
    // table may not yet exist (Railway prisma db push is unreliable for new tables).
    const allVrIds = reqs.flatMap(r => r.quotes.map(q => q.id));
    let countByVrId = new Map<string, number>();
    if (allVrIds.length > 0) {
      try {
        const counts = await prisma.purchaseRequisitionVendorLine.groupBy({
          by: ['vendorQuoteId'],
          where: { vendorQuoteId: { in: allVrIds }, unitRate: { gt: 0 } },
          _count: { _all: true },
        });
        countByVrId = new Map(counts.map(c => [c.vendorQuoteId, c._count._all]));
      } catch (err) {
        console.warn('[purchaseRequisition] line-quote count failed (table may be missing):', (err as Error).message);
      }
    }
    const enriched = reqs.map(r => ({
      ...r,
      quotes: r.quotes.map(q => ({ ...q, pricedLineCount: countByVrId.get(q.id) || 0 })),
    }));
    res.json({ requisitions: enriched });
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

// Link a vendor to every inventory-item on an indent (creates / updates VendorItem
// with the latest rate). Called after a rate is saved or a vendor is awarded so
// the Item Master can surface "we've asked these vendors, at these rates".
async function upsertVendorItemsForQuote(prId: string, vendorId: string, rate: number) {
  const pr = await prisma.purchaseRequisition.findUnique({
    where: { id: prId },
    include: { lines: { select: { inventoryItemId: true } } },
  });
  if (!pr) return;
  const itemIds = pr.lines.map(l => l.inventoryItemId).filter((id): id is string => !!id);
  if (pr.inventoryItemId && !itemIds.includes(pr.inventoryItemId)) itemIds.push(pr.inventoryItemId);
  for (const inventoryItemId of itemIds) {
    await prisma.vendorItem.upsert({
      where: { vendorId_inventoryItemId: { vendorId, inventoryItemId } },
      update: { rate, updatedAt: new Date() },
      create: { vendorId, inventoryItemId, rate, isPreferred: false, isActive: true },
    });
  }
}

// Recompute the header rate (PurchaseRequisitionVendor.vendorRate) from saved
// line rates so existing logic (award gating, totals, reports) keeps working.
// Header source is DERIVED from line sources — not preserved from the previous
// header value — so AI-extracted lines correctly produce an AI header.
async function recomputeHeaderRate(vrId: string): Promise<void> {
  const vr = await prisma.purchaseRequisitionVendor.findUnique({
    where: { id: vrId },
    include: {
      requisition: { include: { lines: { select: { id: true, quantity: true } } } },
    },
  });
  if (!vr) return;
  let lineQuotes: Array<{ requisitionLineId: string; unitRate: number | null; source: string | null }> = [];
  try {
    lineQuotes = await prisma.purchaseRequisitionVendorLine.findMany({
      where: { vendorQuoteId: vrId },
      select: { requisitionLineId: true, unitRate: true, source: true },
    
    take: 500,
  });
  } catch {
    return; // table missing — leave header rate unchanged
  }
  const qtyByLine = new Map(vr.requisition.lines.map(l => [l.id, l.quantity]));
  let weightedSum = 0;
  let totalQty = 0;
  let lineCount = 0;
  const pricedSources = new Set<string>();
  for (const lq of lineQuotes) {
    if (lq.unitRate == null || lq.unitRate <= 0) continue;
    const qty = qtyByLine.get(lq.requisitionLineId) || 0;
    if (qty <= 0) continue;
    weightedSum += lq.unitRate * qty;
    totalQty += qty;
    lineCount++;
    if (lq.source) pricedSources.add(lq.source);
  }
  const totalLines = vr.requisition.lines.length;
  const headerRate = totalQty > 0 ? Math.round((weightedSum / totalQty) * 100) / 100 : null;
  const allLinesPriced = lineCount === totalLines && totalLines > 0;
  let headerSource: string | null = null;
  if (lineCount > 0) {
    if (!allLinesPriced) headerSource = 'EMAIL_PARTIAL';
    else if (pricedSources.size === 1) headerSource = Array.from(pricedSources)[0];
    else if (pricedSources.size === 0) headerSource = 'MANUAL';
    else headerSource = 'MIXED';
  }
  await prisma.purchaseRequisitionVendor.update({
    where: { id: vrId },
    data: {
      vendorRate: headerRate,
      quotedAt: lineCount > 0 ? new Date() : null,
      quoteSource: headerSource,
    },
  });
}

// Fallback for when PurchaseRequisitionVendorLine doesn't exist yet — still save
// at least the first line's rate to the header so the user gets something.
async function applyExtractedQuoteHeader(vrId: string, prId: string, extracted: { lineRates: Array<{ unitRate?: number }>; extractedTotal?: number; overallRateNote?: string; paymentTerms?: string; deliveryDays?: number; freightTerms?: string }, totalQty: number): Promise<number | null> {
  const firstLine = extracted.lineRates.find(l => typeof l.unitRate === 'number' && l.unitRate > 0);
  const rate = firstLine?.unitRate
    ?? (extracted.extractedTotal && totalQty > 0
        ? Math.round((extracted.extractedTotal / totalQty) * 100) / 100
        : null);
  if (!rate) return null;
  const updatedRow = await prisma.purchaseRequisitionVendor.update({
    where: { id: vrId },
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
  await upsertVendorItemsForQuote(prId, updatedRow.vendorId, rate);
  return rate;
}

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

    // Cost-template fields — buyer-editable before award. Each is optional;
    // we only write fields the request actually provided so partial saves work.
    const numFields = ['packingPercent', 'packingAmount', 'freightPercent', 'freightAmount',
      'insurancePercent', 'insuranceAmount', 'loadingPercent', 'loadingAmount', 'tcsPercent'] as const;
    for (const f of numFields) {
      if (b[f] !== undefined) {
        const n = typeof b[f] === 'number' ? b[f] as number : parseFloat(b[f] as string);
        if (isNaN(n) || n < 0) return res.status(400).json({ error: `Invalid ${f}` });
        data[f] = n;
      }
    }
    if (b.isRateInclusiveOfGst !== undefined) data.isRateInclusiveOfGst = !!b.isRateInclusiveOfGst;
    if (b.deliveryBasis !== undefined) data.deliveryBasis = b.deliveryBasis || null;
    if (b.additionalCharges !== undefined) {
      if (!Array.isArray(b.additionalCharges)) return res.status(400).json({ error: 'additionalCharges must be an array' });
      data.additionalCharges = b.additionalCharges;
    }

    const row = await prisma.purchaseRequisitionVendor.update({
      where: { id: req.params.vrId },
      data,
      include: { vendor: { select: { id: true, name: true, email: true, phone: true } } },
    });
    // When a rate is saved, link this vendor to all the items on the indent
    if (data.vendorRate != null) {
      await upsertVendorItemsForQuote(req.params.id, row.vendorId, data.vendorRate as number);
    }
    res.json(row);
}));

// GET /:id/vendors/:vrId/line-rates — list per-line rates for this vendor on this indent
router.get('/:id/vendors/:vrId/line-rates', asyncHandler(async (req: AuthRequest, res: Response) => {
    const vr = await prisma.purchaseRequisitionVendor.findUnique({
      where: { id: req.params.vrId },
      include: {
        requisition: {
          include: {
            lines: {
              orderBy: { lineNo: 'asc' },
              include: { inventoryItem: { select: { id: true, name: true, code: true, unit: true } } },
            },
          },
        },
      },
    });
    if (!vr || vr.requisitionId !== req.params.id) return res.status(404).json({ error: 'Not found' });

    // Fetch line quotes separately so we can fail-soft if the new table isn't
    // yet deployed (Railway prisma db push has been unreliable for new tables).
    let lineQuotes: Array<{ requisitionLineId: string; unitRate: number | null; gstPercent: number | null; hsnCode: string | null; discountPercent: number; remarks: string | null; source: string | null }> = [];
    try {
      lineQuotes = await prisma.purchaseRequisitionVendorLine.findMany({
        where: { vendorQuoteId: req.params.vrId },
        select: { requisitionLineId: true, unitRate: true, gstPercent: true, hsnCode: true, discountPercent: true, remarks: true, source: true },

    take: 500,
  });
    } catch (err) {
      return res.status(503).json({
        error: 'Item-wise rate storage not yet available on this server. Run the migration SQL or contact admin.',
        code: 'TABLE_MISSING',
        detail: (err as Error).message,
      });
    }

    const byLine = new Map(lineQuotes.map(lq => [lq.requisitionLineId, lq]));
    const lines = vr.requisition.lines.map(l => {
      const lq = byLine.get(l.id);
      return {
        lineId: l.id,
        lineNo: l.lineNo,
        itemName: l.itemName,
        itemCode: l.inventoryItem?.code || null,
        quantity: l.quantity,
        unit: l.unit,
        estimatedCost: l.estimatedCost,
        unitRate: lq?.unitRate ?? null,
        gstPercent: lq?.gstPercent ?? null,
        hsnCode: lq?.hsnCode ?? null,
        discountPercent: lq?.discountPercent ?? 0,
        remarks: lq?.remarks ?? null,
        source: lq?.source ?? null,
      };
    });
    res.json({ lines, vendorName: (await prisma.vendor.findUnique({ where: { id: vr.vendorId }, select: { name: true } }))?.name });
}));

// PUT /:id/vendors/:vrId/line-rates — bulk save per-line rates (manual or AI-edited)
// Body: { lines: [{ lineId, unitRate, gstPercent?, hsnCode?, remarks? }], source?: 'MANUAL'|'EMAIL_AUTO' }
router.put('/:id/vendors/:vrId/line-rates', asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = req.body as {
      lines?: Array<{ lineId: string; unitRate?: number | string | null; gstPercent?: number | string | null; hsnCode?: string | null; discountPercent?: number | string | null; remarks?: string | null }>;
      source?: string;
    };
    if (!Array.isArray(body.lines)) return res.status(400).json({ error: 'lines[] required' });

    const vr = await prisma.purchaseRequisitionVendor.findUnique({
      where: { id: req.params.vrId },
      include: { requisition: { include: { lines: { select: { id: true, inventoryItemId: true } } } } },
    });
    if (!vr || vr.requisitionId !== req.params.id) return res.status(404).json({ error: 'Not found' });

    const validLineIds = new Set(vr.requisition.lines.map(l => l.id));
    const source = body.source === 'EMAIL_AUTO' ? 'EMAIL_AUTO' : 'MANUAL';

    try {
      for (const l of body.lines) {
        if (!validLineIds.has(l.lineId)) continue;
        const rate = l.unitRate == null || l.unitRate === '' ? null : Number(l.unitRate);
        if (rate != null && (isNaN(rate) || rate < 0)) return res.status(400).json({ error: `Invalid rate on line ${l.lineId}` });
        const gst = l.gstPercent == null || l.gstPercent === '' ? null : Number(l.gstPercent);
        if (gst != null && (isNaN(gst) || gst < 0)) return res.status(400).json({ error: `Invalid GST on line ${l.lineId}` });
        const discount = l.discountPercent == null || l.discountPercent === '' ? 0 : Number(l.discountPercent);
        if (isNaN(discount) || discount < 0 || discount > 100) return res.status(400).json({ error: `Invalid discount on line ${l.lineId} (must be 0-100)` });

        if (rate == null && gst == null && !l.hsnCode && !l.remarks && discount === 0) {
          await prisma.purchaseRequisitionVendorLine.deleteMany({
            where: { vendorQuoteId: req.params.vrId, requisitionLineId: l.lineId },
          });
          continue;
        }
        // Preserve the existing source (e.g. EMAIL_AUTO) when the user clicks
        // Save Rates without editing the AI-filled values. Only mark MANUAL
        // when the value actually changed.
        const existing = await prisma.purchaseRequisitionVendorLine.findUnique({
          where: { vendorQuoteId_requisitionLineId: { vendorQuoteId: req.params.vrId, requisitionLineId: l.lineId } },
        });
        const valueChanged = !existing
          || existing.unitRate !== rate
          || existing.gstPercent !== gst
          || (existing.hsnCode || null) !== (l.hsnCode || null)
          || existing.discountPercent !== discount
          || (existing.remarks || null) !== (l.remarks || null);
        const finalSource = valueChanged ? source : (existing?.source || source);

        await prisma.purchaseRequisitionVendorLine.upsert({
          where: { vendorQuoteId_requisitionLineId: { vendorQuoteId: req.params.vrId, requisitionLineId: l.lineId } },
          update: { unitRate: rate, gstPercent: gst, hsnCode: l.hsnCode || null, discountPercent: discount, remarks: l.remarks || null, source: finalSource },
          create: { vendorQuoteId: req.params.vrId, requisitionLineId: l.lineId, unitRate: rate, gstPercent: gst, hsnCode: l.hsnCode || null, discountPercent: discount, remarks: l.remarks || null, source: finalSource },
        });
      }
    } catch (err) {
      return res.status(503).json({
        error: 'Item-wise rate storage not yet available on this server. Ask admin to run the migration SQL.',
        code: 'TABLE_MISSING',
        detail: (err as Error).message,
      });
    }

    await recomputeHeaderRate(req.params.vrId);

    // Mirror header rate onto VendorItem master so it appears in item history
    const updated = await prisma.purchaseRequisitionVendor.findUnique({ where: { id: req.params.vrId }, select: { vendorRate: true, vendorId: true } });
    if (updated?.vendorRate && updated.vendorRate > 0) {
      await upsertVendorItemsForQuote(req.params.id, updated.vendorId, updated.vendorRate);
    }

    res.json({ ok: true });
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

// POST /:id/vendors/:vrId/award — award this vendor and auto-create a draft PO.
// Sets PR.vendorId, marks this quote row isAwarded=true, clears others, then
// builds a multi-line PO from the indent's lines using per-line rates if
// available, falling back to the header rate.
router.post('/:id/vendors/:vrId/award', asyncHandler(async (req: AuthRequest, res: Response) => {
    const row = await prisma.purchaseRequisitionVendor.findUnique({ where: { id: req.params.vrId } });
    if (!row || row.requisitionId !== req.params.id) return res.status(404).json({ error: 'Quote row not found' });
    if (row.vendorRate == null || row.vendorRate <= 0) return res.status(400).json({ error: 'Cannot award — enter a rate first' });

    // Guardrail: AI extracted these rates with LOW self-reported confidence.
    // We persisted them so the buyer can see/edit (instead of silently dropping
    // them like before), but they must explicitly acknowledge before award —
    // a stray click shouldn't push uncertain numbers into a real PO.
    if (req.body?.acknowledgeLowConfidence !== true) {
      if (row.quoteSource === 'EMAIL_AUTO_LOW') {
        return res.status(400).json({
          error: 'AI flagged this quote as LOW confidence. Open the item-wise rates panel, verify each line + cost component, then either (a) edit any rate to clear the flag or (b) confirm award with acknowledgeLowConfidence=true.',
          code: 'LOW_CONFIDENCE_AWARD',
        });
      }
      const hasLowLine = await prisma.purchaseRequisitionVendorLine.count({
        where: { vendorQuoteId: req.params.vrId, source: 'EMAIL_AUTO_LOW' },
      }).catch(() => 0);
      if (hasLowLine > 0) {
        return res.status(400).json({
          error: `${hasLowLine} item rate(s) on this quote came from a LOW-confidence AI read. Verify them in the item-wise rates panel, then re-save or confirm with acknowledgeLowConfidence=true.`,
          code: 'LOW_CONFIDENCE_AWARD',
        });
      }
    }

    const [, , pr] = await prisma.$transaction([
      prisma.purchaseRequisitionVendor.updateMany({ where: { requisitionId: req.params.id }, data: { isAwarded: false } }),
      prisma.purchaseRequisitionVendor.update({ where: { id: req.params.vrId }, data: { isAwarded: true } }),
      prisma.purchaseRequisition.update({
        where: { id: req.params.id },
        data: { vendorId: row.vendorId, vendorRate: row.vendorRate, vendorQuotedAt: row.quotedAt, quoteSource: row.quoteSource },
        include: {
          vendor: { select: { id: true, name: true, email: true, phone: true } },
          quotes: { include: { vendor: { select: { id: true, name: true, email: true, phone: true } } } },
          lines: { include: { inventoryItem: { select: { id: true, name: true, code: true, hsnCode: true, gstPercent: true, unit: true } } } },
        },
      }),
    ]);
    // Mark awarded vendor as PREFERRED for these items
    await upsertVendorItemsForQuote(req.params.id, row.vendorId, row.vendorRate);
    const awardedItemIds = pr.lines.map(l => l.inventoryItemId).filter((id): id is string => !!id);
    for (const inventoryItemId of awardedItemIds) {
      await prisma.vendorItem.updateMany({ where: { inventoryItemId }, data: { isPreferred: false } });
      await prisma.vendorItem.updateMany({ where: { inventoryItemId, vendorId: row.vendorId }, data: { isPreferred: true } });
    }

    // ── Auto-create an APPROVED PO + partial GRN so the workflow continues ──
    // Saif's flow: award → PO + draft/partial GRN visible in /store/receipts → goods arrive → finalize → upload invoice.
    let autoPO: { created: boolean; poId?: string; poNo?: number; grandTotal?: number; reason?: string } = { created: false };
    let autoGRN: { created: boolean; grnId?: string; grnNo?: number; reason?: string } = { created: false };
    try {
      const existing = await prisma.purchaseOrder.findFirst({
        where: { requisitionId: req.params.id, status: { not: 'CANCELLED' } },
        select: { id: true, poNo: true },
      });
      if (existing) {
        autoPO = { created: false, poId: existing.id, poNo: existing.poNo, reason: `PO #${existing.poNo} already exists for this indent` };
      } else {
        // Per-line rate / GST / HSN if available, header rate as fallback.
        // HSN from the vendor quote (AI-extracted from the reply PDF) takes
        // priority over the InventoryItem master so the PO mirrors what the
        // vendor invoiced — same HSN flows PO → GRN → Vendor Invoice.
        let lineRateMap = new Map<string, number>();
        let lineGstMap = new Map<string, number>();
        let lineHsnMap = new Map<string, string>();
        let lineDiscountMap = new Map<string, number>();
        try {
          const rates = await prisma.purchaseRequisitionVendorLine.findMany({
            where: { vendorQuoteId: req.params.vrId },
            select: { requisitionLineId: true, unitRate: true, gstPercent: true, hsnCode: true, discountPercent: true },

    take: 500,
  });
          lineRateMap = new Map(rates.filter(r => r.unitRate != null && r.unitRate > 0).map(r => [r.requisitionLineId, r.unitRate as number]));
          lineGstMap = new Map(rates.filter(r => r.gstPercent != null).map(r => [r.requisitionLineId, r.gstPercent as number]));
          lineHsnMap = new Map(rates.filter(r => r.hsnCode && r.hsnCode.trim()).map(r => [r.requisitionLineId, (r.hsnCode as string).trim()]));
          lineDiscountMap = new Map(rates.filter(r => r.discountPercent > 0).map(r => [r.requisitionLineId, r.discountPercent]));
        } catch { /* per-line table missing — fall back to header rate for every line */ }

        // Build PO lines from indent lines. Free-text items without an
        // inventoryItemId are still allowed — POLine.inventoryItemId is
        // nullable, the line just keeps its description + rate.
        const poLines = pr.lines
          .map(l => {
            const rate = lineRateMap.get(l.id) ?? row.vendorRate ?? 0;
            const gst = lineGstMap.get(l.id) ?? l.inventoryItem?.gstPercent ?? 18;
            const hsn = lineHsnMap.get(l.id) ?? l.inventoryItem?.hsnCode ?? undefined;
            const discountPercent = lineDiscountMap.get(l.id) ?? 0;
            return rate > 0 ? {
              inventoryItemId: l.inventoryItemId,
              description: l.itemName,
              hsnCode: hsn,
              quantity: l.quantity,
              unit: l.inventoryItem?.unit || l.unit,
              rate,
              gstPercent: gst,
              discountPercent,
            } : null;
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);

        if (poLines.length === 0) {
          autoPO = { created: false, reason: 'No PO-eligible lines — every line needs a rate. Enter rates first.' };
        } else {
          const vendor = await prisma.vendor.findUnique({
            where: { id: row.vendorId },
            select: { gstState: true, paymentTerms: true, creditDays: true },
          });
          const vendorStateCode = vendor?.gstState || '';
          const supplyType = vendorStateCode && vendorStateCode !== COMPANY.stateCode ? 'INTER_STATE' : 'INTRA_STATE';
          // Create DRAFT PO — user reviews on the indent page and either
          // confirms (→ APPROVED + partial GRN) or cancels (→ unaward vendor,
          // indent goes back for re-quoting).
          // Compute header charges from the vendor's cost template.
          // Percent-based charges apply to the post-discount basic value (sum
          // of taxableAmount before adding GST). Fixed amounts are added as-is.
          const lineSubtotalBasic = poLines.reduce((s, l) => s + (l.quantity * l.rate * (1 - (l.discountPercent ?? 0) / 100)), 0);
          const pctOnBasic = (pct: number) => lineSubtotalBasic * (pct / 100);
          const freightCharge = pctOnBasic(row.freightPercent) + (row.freightAmount || 0);
          const additionalChargesArr = Array.isArray(row.additionalCharges) ? row.additionalCharges as Array<{ percent?: number; amount?: number }> : [];
          const additionalChargesTotal = additionalChargesArr.reduce((s, c) => s + (c.percent ? pctOnBasic(c.percent) : 0) + (c.amount || 0), 0);
          const otherCharges = pctOnBasic(row.packingPercent) + (row.packingAmount || 0)
            + pctOnBasic(row.insurancePercent) + (row.insuranceAmount || 0)
            + pctOnBasic(row.loadingPercent) + (row.loadingAmount || 0)
            + additionalChargesTotal;

          // Create DRAFT PO — user reviews on the indent page and either
          // confirms (→ APPROVED + partial GRN) or cancels (→ unaward vendor,
          // indent goes back for re-quoting).
          const po = await createPurchaseOrder({
            vendorId: row.vendorId,
            lines: poLines,
            supplyType: supplyType as 'INTRA_STATE' | 'INTER_STATE',
            requisitionId: req.params.id,
            userId: req.user!.id,
            remarks: `Auto-created on award from Indent #${pr.reqNo}`,
            paymentTerms: vendor?.paymentTerms || undefined,
            creditDays: vendor?.creditDays || 30,
            freightCharge,
            otherCharges,
          });
          autoPO = { created: true, poId: po.id, poNo: po.poNo, grandTotal: po.grandTotal };
        }
      }
    } catch (err) {
      autoPO = { created: false, reason: `Auto-PO failed: ${(err as Error).message}` };
    }

    res.json({ ...pr, autoPO, autoGRN });
}));

// Generate next ITM-NNNNN code for auto-created items. Mirrors the
// helper in inventory.ts (kept inline to avoid a cross-file import cycle).
async function generateNextItemCode(): Promise<string> {
  const last = await prisma.inventoryItem.findFirst({
    where: { code: { startsWith: 'ITM-' } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });
  if (!last) return 'ITM-00001';
  const num = parseInt(last.code.replace('ITM-', ''), 10);
  return `ITM-${String((Number.isFinite(num) ? num : 0) + 1).padStart(5, '0')}`;
}

// POST /:id/vendors/:vrId/confirm-po — promote the DRAFT PO to APPROVED and
// create a partial GRN so the workflow moves to /store/receipts.
router.post('/:id/vendors/:vrId/confirm-po', asyncHandler(async (req: AuthRequest, res: Response) => {
    const vr = await prisma.purchaseRequisitionVendor.findUnique({ where: { id: req.params.vrId } });
    if (!vr || vr.requisitionId !== req.params.id) return res.status(404).json({ error: 'Quote row not found' });
    if (!vr.isAwarded) return res.status(400).json({ error: 'This vendor is not the awarded one' });

    const po = await prisma.purchaseOrder.findFirst({
      where: { requisitionId: req.params.id, status: 'DRAFT' },
      include: { lines: true },
    });
    if (!po) return res.status(404).json({ error: 'No DRAFT PO found for this indent' });

    // 1. Approve the PO
    await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: { status: 'APPROVED', approvedBy: req.user!.id, approvedAt: new Date() },
    });

    // 1a. Materialise free-text PO lines into InventoryItem + link the
    // VendorItem master so this vendor↔item↔rate is remembered for next
    // indent. Without this, every typo'd item stays orphaned: the PO PDF
    // is fine but the Item Master / vendor history never gets populated.
    const pr = await prisma.purchaseRequisition.findUnique({
      where: { id: req.params.id },
      select: { companyId: true, lines: { select: { id: true, itemName: true, inventoryItemId: true, unit: true } } },
    });
    const prLineByName = new Map(
      (pr?.lines || [])
        .filter(l => !l.inventoryItemId)
        .map(l => [l.itemName.trim().toLowerCase(), l]),
    );

    for (const line of po.lines) {
      if (line.inventoryItemId) continue; // already linked to master
      const desc = (line.description || '').trim();
      if (!desc) continue;

      // Reuse an existing item with the same name (case-insensitive) before
      // creating a new one — avoids duplicate "Bearing 6204" / "BEARING 6204".
      let itemId: string;
      const existing = await prisma.inventoryItem.findFirst({
        where: {
          name: { equals: desc, mode: 'insensitive' },
          companyId: pr?.companyId ?? null,
        },
        select: { id: true },
      });

      if (existing) {
        itemId = existing.id;
      } else {
        const newItem = await prisma.inventoryItem.create({
          data: {
            name: desc,
            code: await generateNextItemCode(),
            category: 'CONSUMABLE',
            unit: line.unit || 'nos',
            hsnCode: line.hsnCode || null,
            gstPercent: line.gstPercent || 18,
            defaultRate: line.rate || 0,
            companyId: pr?.companyId ?? null,
            remarks: `Auto-created from Indent #${req.params.id} on PO confirm`,
          },
          select: { id: true },
        });
        itemId = newItem.id;
      }

      // Backfill the PO line so the GRN we create next picks up the FK.
      await prisma.pOLine.update({ where: { id: line.id }, data: { inventoryItemId: itemId } });
      (line as { inventoryItemId?: string | null }).inventoryItemId = itemId;

      // Backfill the indent line too — next time someone types the same
      // free-text, it auto-resolves to this master row.
      const prLine = prLineByName.get(desc.toLowerCase());
      if (prLine) {
        await prisma.purchaseRequisitionLine.update({ where: { id: prLine.id }, data: { inventoryItemId: itemId } });
      }

      // Link vendor ↔ item with this rate, mark preferred so future indents
      // for the same item auto-pick this vendor.
      await prisma.vendorItem.upsert({
        where: { vendorId_inventoryItemId: { vendorId: po.vendorId, inventoryItemId: itemId } },
        update: { rate: line.rate || 0, isPreferred: true, isActive: true, updatedAt: new Date() },
        create: { vendorId: po.vendorId, inventoryItemId: itemId, rate: line.rate || 0, isPreferred: true, isActive: true },
      });
      // Other vendors for the same item lose preferred so only one stays preferred.
      await prisma.vendorItem.updateMany({
        where: { inventoryItemId: itemId, vendorId: { not: po.vendorId } },
        data: { isPreferred: false },
      });
    }

    // 2. Create partial GRN (idempotent — skip if one already open)
    let grnInfo: { grnId: string; grnNo: number } | null = null;
    const dupGRN = await prisma.goodsReceipt.findFirst({
      where: { poId: po.id, status: { in: ['DRAFT', 'PARTIAL'] }, archived: false },
      select: { id: true, grnNo: true },
    });
    if (dupGRN) {
      grnInfo = { grnId: dupGRN.id, grnNo: dupGRN.grnNo };
    } else {
      const grnNo = await nextDocNo('GoodsReceipt', 'grnNo', pr?.companyId ?? null);
      const grn = await prisma.goodsReceipt.create({
        data: {
          grnNo,
          poId: po.id,
          vendorId: po.vendorId,
          grnDate: new Date(),
          grnType: 'EXPECTED',
          status: 'PARTIAL',
          qualityStatus: 'PENDING',
          userId: req.user!.id,
          companyId: pr?.companyId ?? null,
          totalQty: 0,
          totalAmount: 0,
          lines: {
            create: po.lines.map(l => ({
              poLineId: l.id,
              inventoryItemId: (l as { inventoryItemId?: string | null }).inventoryItemId || null,
              description: l.description,
              receivedQty: 0,
              acceptedQty: 0,
              rejectedQty: 0,
              unit: l.unit || 'KG',
              rate: l.rate,
              amount: 0,
            })),
          },
        },
        select: { id: true, grnNo: true },
      });
      grnInfo = { grnId: grn.id, grnNo: grn.grnNo };
    }

    res.json({ poId: po.id, poNo: po.poNo, grn: grnInfo });
}));

// POST /:id/vendors/:vrId/cancel-award — undo the award, cancel the DRAFT PO,
// return the indent to a pre-award state so user can re-quote / pick a
// different vendor / change rates.
router.post('/:id/vendors/:vrId/cancel-award', asyncHandler(async (req: AuthRequest, res: Response) => {
    const vr = await prisma.purchaseRequisitionVendor.findUnique({ where: { id: req.params.vrId } });
    if (!vr || vr.requisitionId !== req.params.id) return res.status(404).json({ error: 'Quote row not found' });

    // Only safe to undo if there's a DRAFT PO (no goods received, no payments yet)
    const po = await prisma.purchaseOrder.findFirst({
      where: { requisitionId: req.params.id, status: { not: 'CANCELLED' } },
      select: { id: true, poNo: true, status: true },
    });
    if (po && po.status !== 'DRAFT') {
      return res.status(400).json({
        error: `Cannot cancel — PO #${po.poNo} is already ${po.status}. Cancel from the PO page first.`,
      });
    }

    await prisma.$transaction([
      // Cancel the draft PO if it exists
      ...(po ? [prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: 'CANCELLED' } })] : []),
      // Unaward the vendor
      prisma.purchaseRequisitionVendor.update({
        where: { id: req.params.vrId },
        data: { isAwarded: false },
      }),
      // Clear the indent's awarded-vendor pointer
      prisma.purchaseRequisition.update({
        where: { id: req.params.id },
        data: { vendorId: null, vendorRate: null, vendorQuotedAt: null, quoteSource: null },
      }),
    ]);

    res.json({ ok: true, cancelledPoNo: po?.poNo ?? null });
}));

// DELETE /:id/vendors/:vrId — remove a vendor quote row
router.delete('/:id/vendors/:vrId', asyncHandler(async (req: AuthRequest, res: Response) => {
    await prisma.purchaseRequisitionVendor.delete({ where: { id: req.params.vrId } });
    res.json({ ok: true });
}));

// ── RFQ Email Flow ──
// Helper — build the data passed into the HBS template
async function buildRfqData(prId: string, vrId: string, preparedBy: string, specialRemarks?: string) {
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
      specialRemarks: specialRemarks || null,
      lines,
      vendor: vr.vendor,
      preparedBy,
    },
  };
}

// GET /:id/vendors/:vrId/rfq-pdf — RFQ PDF preview (streams PDF)
// Accepts ?remarks=... query param so the drawer preview can show the same remarks the user will send
router.get('/:id/vendors/:vrId/rfq-pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
    const remarks = typeof req.query.remarks === 'string' ? req.query.remarks : undefined;
    const { data, pr } = await buildRfqData(req.params.id, req.params.vrId, req.user!.name || req.user!.email, remarks);
    const pdf = await renderDocumentPdf({ docType: 'RFQ', data });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="RFQ-${pr.reqNo}-${req.params.vrId.slice(0, 6)}.pdf"`);
    res.send(pdf);
}));

// POST /:id/vendors/:vrId/send-rfq — generate PDF + email vendor + store messageId
// Body: { extraMessage?: string (shown in BOTH the email body and the PDF's "Additional Notes"), cc?: string }
router.post('/:id/vendors/:vrId/send-rfq', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { extraMessage, cc } = req.body as { extraMessage?: string; cc?: string };
    const { pr, vr, data } = await buildRfqData(req.params.id, req.params.vrId, req.user!.name || req.user!.email, extraMessage);

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
    let autoExtractInfo: { savedLineCount?: number; totalLines?: number; confidence?: string; reason?: string } | null = null;
    if (result.newCount && result.newCount > 0) {
      const latest = result.replies[result.replies.length - 1];
      await notifyOnNewRfqReply({ vrId: req.params.vrId, newCount: result.newCount, fromEmail: latest?.fromEmail });
      // Auto-extract IFF still waiting — same guard as the background poller
      try {
        const auto = await autoExtractIfWaiting(req.params.vrId);
        if (auto.ran) autoExtractInfo = { savedLineCount: auto.savedLineCount, totalLines: auto.totalLines, confidence: auto.confidence };
        else autoExtractInfo = { reason: auto.reason };
      } catch (err) {
        console.error('[/replies] auto-extract failed:', err);
      }
    }
    res.json({
      autoExtract: autoExtractInfo,
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
// On autoApply: writes per-line rates to PurchaseRequisitionVendorLine and recomputes header rate.
router.post('/:id/vendors/:vrId/extract-quote', asyncHandler(async (req: AuthRequest, res: Response) => {
    const vr = await prisma.purchaseRequisitionVendor.findUnique({
      where: { id: req.params.vrId },
      include: {
        vendor: { select: { email: true } },
        requisition: { select: { reqNo: true, lines: { orderBy: { lineNo: 'asc' }, select: { id: true, lineNo: true, itemName: true, quantity: true, unit: true } }, itemName: true, quantity: true, unit: true } },
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

    const indentLines = vr.requisition.lines.length > 0
      ? vr.requisition.lines
      : [];
    const expectedLines = (indentLines.length > 0 ? indentLines : [{
      id: '', lineNo: 1, itemName: vr.requisition.itemName, quantity: vr.requisition.quantity, unit: vr.requisition.unit,
    }]).map(l => ({ lineNo: l.lineNo ?? 1, itemName: l.itemName, quantity: l.quantity, unit: l.unit }));

    const extracted = await extractQuoteFromReply({
      replyBody: latestReply.bodyText || latestReply.bodyHtml || '',
      attachments,
      expectedLines,
      userId: req.user?.id ?? null,
      contextRef: `vrId:${req.params.vrId}`,
    });

    if (!extracted) return res.status(503).json({ error: 'AI extraction not configured (GEMINI_API_KEY missing)' });

    // If autoApply, write each extracted line rate to PurchaseRequisitionVendorLine.
    // Always-on remarks summary stays in the header field.
    let savedLineCount = 0;
    let savedHeaderRate: number | null = null;
    let lineTableMissing = false;
    // Persist what the AI gave us regardless of confidence — silently dropping
    // LOW results was the policy bug behind 4 failed prompt patches. We tag
    // LOW lines as EMAIL_AUTO_LOW so the UI can warn the buyer and the Award
    // handler can block/confirm before pushing them into a PO.
    if (req.body.autoApply && indentLines.length > 0) {
      const aiSource = extracted.confidence === 'LOW' ? 'EMAIL_AUTO_LOW' : 'EMAIL_AUTO';
      const byLineNo = new Map(indentLines.map(l => [l.lineNo, l]));
      const byNameLC = new Map(indentLines.map(l => [l.itemName.toLowerCase().trim(), l]));
      try {
        for (const lr of extracted.lineRates) {
          if (!lr.unitRate || lr.unitRate <= 0) continue;
          let target = lr.lineNo ? byLineNo.get(lr.lineNo) : undefined;
          if (!target && lr.itemName) target = byNameLC.get(lr.itemName.toLowerCase().trim());
          if (!target) continue;
          const discountPercent = effectiveLineDiscount(lr, extracted.overallDiscountPercent);
          await prisma.purchaseRequisitionVendorLine.upsert({
            where: { vendorQuoteId_requisitionLineId: { vendorQuoteId: req.params.vrId, requisitionLineId: target.id } },
            update: { unitRate: lr.unitRate, gstPercent: lr.gstPercent ?? null, hsnCode: lr.hsnCode || null, discountPercent, remarks: lr.remarks || null, source: aiSource },
            create: { vendorQuoteId: req.params.vrId, requisitionLineId: target.id, unitRate: lr.unitRate, gstPercent: lr.gstPercent ?? null, hsnCode: lr.hsnCode || null, discountPercent, remarks: lr.remarks || null, source: aiSource },
          });
          savedLineCount++;
        }
      } catch (err) {
        // Per-line table missing — fall through to header-only path below
        console.warn('[purchaseRequisition] line-quote write failed, falling back to header rate:', (err as Error).message);
        lineTableMissing = true;
        savedLineCount = 0;
      }

      // Persist vendor row (quoteRemarks + cost-template fields). Wrapped
      // in its own try/catch so a missing column doesn't abort the whole
      // route — we keep the per-line saves and tell the client what failed.
      const costFields = quoteCostFieldsForDb(extracted);
      console.log('[extract-quote] persisting vendor row', { vrId: req.params.vrId, costFields });
      try {
        await prisma.purchaseRequisitionVendor.update({
          where: { id: req.params.vrId },
          data: {
            quoteRemarks: [
              extracted.overallRateNote,
              extracted.paymentTerms ? `Payment: ${extracted.paymentTerms}` : null,
              extracted.deliveryDays ? `Delivery: ${extracted.deliveryDays} days` : null,
              extracted.freightTerms ? `Freight: ${extracted.freightTerms}` : null,
              extracted.notes ? `Notes: ${extracted.notes}` : null,
            ].filter(Boolean).join(' · ') || null,
            ...costFields,
          },
        });
        console.log('[extract-quote] vendor row update OK');
      } catch (err) {
        console.error('[extract-quote] vendor row update FAILED:', err instanceof Error ? err.message : err);
        // Try a fallback that writes ONLY the columns we know existed before
        // the cost template was added. If even this fails, return 500 with the
        // real error so the UI shows it.
        try {
          await prisma.purchaseRequisitionVendor.update({
            where: { id: req.params.vrId },
            data: {
              quoteRemarks: [
                extracted.overallRateNote,
                extracted.paymentTerms ? `Payment: ${extracted.paymentTerms}` : null,
                extracted.deliveryDays ? `Delivery: ${extracted.deliveryDays} days` : null,
                extracted.freightTerms ? `Freight: ${extracted.freightTerms}` : null,
                extracted.notes ? `Notes: ${extracted.notes}` : null,
              ].filter(Boolean).join(' · ') || null,
            },
          });
          console.warn('[extract-quote] cost columns missing — saved remarks only. Run SchemaDriftGuard or check schema.');
          return res.status(200).json({
            extracted,
            savedRate: null,
            savedLineCount,
            totalLines: indentLines.length,
            warning: `Cost components could not be saved: ${err instanceof Error ? err.message : String(err)}`,
            reply: { from: latestReply.fromEmail, subject: latestReply.subject, date: latestReply.receivedAt },
          });
        } catch (err2) {
          return res.status(500).json({
            error: `Persist failed: ${err2 instanceof Error ? err2.message : String(err2)}`,
            originalError: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (savedLineCount > 0) {
        await recomputeHeaderRate(req.params.vrId);
        const after = await prisma.purchaseRequisitionVendor.findUnique({ where: { id: req.params.vrId }, select: { vendorRate: true, vendorId: true } });
        savedHeaderRate = after?.vendorRate ?? null;
        if (savedHeaderRate && savedHeaderRate > 0) {
          await upsertVendorItemsForQuote(req.params.id, after!.vendorId, savedHeaderRate);
        }
      } else if (lineTableMissing) {
        // Fallback: save the first usable rate to the header field so the user
        // at least gets a number while the migration is pending.
        savedHeaderRate = await applyExtractedQuoteHeader(req.params.vrId, req.params.id, extracted, vr.requisition.quantity);
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

    res.json({
      extracted,
      savedRate: savedHeaderRate,
      savedLineCount,
      totalLines: indentLines.length,
      reply: { from: latestReply.fromEmail, subject: latestReply.subject, date: latestReply.receivedAt },
    });
}));

// GET /:id/vendors/:vrId/attachment/:filename — serve reply attachment from persisted EmailReply
router.get('/:id/vendors/:vrId/attachment/:filename', asyncHandler(async (req: AuthRequest, res: Response) => {
    const thread = await latestThreadFor('INDENT_QUOTE', req.params.vrId);
    if (!thread) return res.status(404).json({ error: 'No thread' });
    const replies = await prisma.emailReply.findMany({ where: { threadId: thread.id } ,
    take: 500,
  });
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
    const reqs = await prisma.purchaseRequisition.findMany({ where: { ...getCompanyFilter(_req) } ,
    take: 500,
  });
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
        const message = err instanceof Error ? (err instanceof Error ? err.message : String(err)) : 'Unknown error';
        autoPO = { created: false, reason: `Auto-PO failed: ${message}` };
      }
    }

    res.json({
      requisition: updated,
      issue: { issuedQty: issueQty, purchaseQty, status: newStatus },
      autoPO,
    });
}));

// PUT /:id/issue-to-requester — after GRN arrives, store hands off the purchased qty to the original requester.
// Only valid in RECEIVED / PARTIAL_RECEIVED state. Increments issuedQty additively, decrements stock,
// and flips status → COMPLETED when everything has been delivered.
router.put('/:id/issue-to-requester', asyncHandler(async (req: AuthRequest, res: Response) => {
    const user = req.user!;
    if (!['ADMIN', 'MANAGER'].includes(user.role)) {
      return res.status(403).json({ error: 'Only ADMIN or MANAGER can issue from store' });
    }

    const pr = await prisma.purchaseRequisition.findUnique({ where: { id: req.params.id } });
    if (!pr) return res.status(404).json({ error: 'Requisition not found' });
    if (!['RECEIVED', 'PARTIAL_RECEIVED'].includes(pr.status)) {
      return res.status(400).json({ error: `Can only issue-to-requester from RECEIVED / PARTIAL_RECEIVED (current: ${pr.status})` });
    }

    const rawQty = req.body.issueNowQty;
    const issueNow = typeof rawQty === 'number' ? rawQty : parseFloat(rawQty);
    const remaining = Math.round((pr.quantity - pr.issuedQty) * 1000) / 1000;
    if (isNaN(issueNow) || issueNow <= 0 || issueNow > remaining) {
      return res.status(400).json({ error: `Invalid qty: must be > 0 and ≤ ${remaining} ${pr.unit}` });
    }

    if (!pr.inventoryItemId) {
      return res.status(400).json({ error: 'Indent has no linked inventory item — cannot decrement stock. Issue manually.' });
    }

    try {
      await prisma.$transaction(async (tx) => {
        const item = await tx.inventoryItem.findUnique({
          where: { id: pr.inventoryItemId! },
          select: { id: true, currentStock: true, avgCost: true, unit: true, name: true },
        });
        if (!item) throw new Error('Inventory item not found');
        if (item.currentStock < issueNow) {
          throw new Error(`Insufficient stock: available ${item.currentStock} ${item.unit}, requested ${issueNow} ${item.unit}`);
        }

        await tx.inventoryTransaction.create({
          data: {
            itemId: pr.inventoryItemId!,
            type: 'OUT',
            quantity: issueNow,
            reference: `INDENT-${pr.reqNo}`,
            department: pr.department || 'Production',
            issuedTo: pr.requestedByPerson || pr.requestedBy,
            remarks: `Indent #${pr.reqNo}: post-GRN issue to requester`,
            userId: user.id,
          },
        });

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
              quantity: issueNow,
              unit: item.unit,
              costRate: item.avgCost,
              totalValue: Math.round(issueNow * item.avgCost * 100) / 100,
              warehouseId: defaultWh.id,
              refType: 'INDENT',
              refId: pr.id,
              refNo: `INDENT-${pr.reqNo}`,
              narration: `Post-GRN issue: ${pr.title} → ${pr.requestedByPerson || pr.requestedBy}`,
              userId: user.id,
            },
          });

          const sl = await tx.stockLevel.findFirst({
            where: { itemId: pr.inventoryItemId!, warehouseId: defaultWh.id, binId: null, batchId: null },
          });
          if (sl) {
            await tx.stockLevel.update({
              where: { id: sl.id },
              data: { quantity: { decrement: issueNow } },
            });
          }
        }

        await tx.inventoryItem.update({
          where: { id: pr.inventoryItemId! },
          data: {
            currentStock: { decrement: issueNow },
            totalValue: { decrement: Math.round(issueNow * item.avgCost * 100) / 100 },
          },
        });
      });
    } catch (txErr: unknown) {
      const msg = txErr instanceof Error ? txErr.message : 'Stock issue failed';
      if (msg.includes('Insufficient stock') || msg.includes('not found')) {
        return res.status(400).json({ error: msg });
      }
      throw txErr;
    }

    const newIssuedQty = Math.round((pr.issuedQty + issueNow) * 1000) / 1000;
    const newStatus = newIssuedQty >= pr.quantity ? 'COMPLETED' : pr.status; // stays RECEIVED/PARTIAL_RECEIVED until fully delivered

    const updated = await prisma.purchaseRequisition.update({
      where: { id: req.params.id },
      data: {
        issuedQty: newIssuedQty,
        issuedBy: user.name || user.email,
        issuedAt: new Date(),
        status: newStatus,
      },
    });

    res.json({ requisition: updated, issuedNow: issueNow, totalIssued: newIssuedQty, status: newStatus });
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
router.delete('/:id', authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
    await prisma.purchaseRequisition.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
}));

export default router;
