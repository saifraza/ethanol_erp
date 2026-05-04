/**
 * Auto-extract RFQ rates from a vendor's email reply — but ONLY when the
 * indent is still "waiting" for a quote (no rates saved yet, vendor not
 * awarded, indent not closed).
 *
 * Vendors often send unrelated follow-up emails on the same RFQ thread (sales
 * pitches, payment chasers, etc.). Per Saif: once any rate is saved (manual
 * or AI), subsequent replies must be left alone — they're noise.
 *
 * Used by:
 *   - rfqReplyPoller (every 5 min on new IMAP replies)
 *   - GET /purchase-requisition/.../replies (on-demand sync)
 */

import prisma from '../config/prisma';
import { extractQuoteFromReply, effectiveLineDiscount, quoteCostFieldsForDb } from './rfqQuoteExtractor';

const TERMINAL_STATUSES = ['REJECTED', 'COMPLETED'];

export type AutoExtractResult = {
  ran: boolean;
  reason?: string;
  savedLineCount?: number;
  totalLines?: number;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  headerRate?: number | null;
};

export async function autoExtractIfWaiting(vrId: string): Promise<AutoExtractResult> {
  const vr = await prisma.purchaseRequisitionVendor.findUnique({
    where: { id: vrId },
    include: {
      vendor: { select: { id: true, name: true } },
      requisition: {
        select: {
          id: true, reqNo: true, status: true, itemName: true, quantity: true, unit: true,
          inventoryItemId: true,
          lines: { orderBy: { lineNo: 'asc' }, select: { id: true, lineNo: true, itemName: true, quantity: true, unit: true, inventoryItemId: true } },
        },
      },
    },
  });
  if (!vr) return { ran: false, reason: 'vendor row not found' };
  if (vr.isAwarded) return { ran: false, reason: 'already awarded' };
  if (TERMINAL_STATUSES.includes(vr.requisition.status)) return { ran: false, reason: 'indent closed' };

  // Saif's rule: only auto-extract while WAITING. If any rate exists, treat
  // the new reply as noise.
  if (vr.vendorRate != null && vr.vendorRate > 0) return { ran: false, reason: 'header rate already set' };
  try {
    const existingLineRates = await prisma.purchaseRequisitionVendorLine.count({
      where: { vendorQuoteId: vrId, unitRate: { gt: 0 } },
    });
    if (existingLineRates > 0) return { ran: false, reason: 'line rates already set' };
  } catch {
    // Per-line table missing — fall through, the upsert below will fall back to header
  }

  // Find the latest reply on the latest RFQ thread for this vendor
  const thread = await prisma.emailThread.findFirst({
    where: { entityType: 'INDENT_QUOTE', entityId: vrId },
    orderBy: { sentAt: 'desc' },
  });
  if (!thread) return { ran: false, reason: 'no RFQ thread' };

  const latestReply = await prisma.emailReply.findFirst({
    where: { threadId: thread.id },
    orderBy: { receivedAt: 'desc' },
  });
  if (!latestReply) return { ran: false, reason: 'no reply yet' };

  // Skip if we already extracted from this exact reply (idempotency — poller
  // may run multiple times before the user acts)
  if (latestReply.aiExtractedAt) return { ran: false, reason: 'already extracted from this reply' };

  const attachments = Array.isArray(latestReply.attachments)
    ? (latestReply.attachments as Array<{ filename: string; contentType: string; contentBase64: string }>)
    : [];

  const indentLines = vr.requisition.lines;
  const expectedLines = (indentLines.length > 0 ? indentLines : [{
    id: '', lineNo: 1, itemName: vr.requisition.itemName, quantity: vr.requisition.quantity, unit: vr.requisition.unit, inventoryItemId: null,
  }]).map(l => ({ lineNo: l.lineNo ?? 1, itemName: l.itemName, quantity: l.quantity, unit: l.unit }));

  const extracted = await extractQuoteFromReply({
    replyBody: latestReply.bodyText || latestReply.bodyHtml || '',
    attachments,
    expectedLines,
    contextRef: `vrId:${vrId}`,
    // userId null — background poller has no user context
  });
  if (!extracted) return { ran: false, reason: 'AI not configured (GEMINI_API_KEY missing)' };

  // Always persist the extracted JSON for human review — even if confidence is LOW
  await prisma.emailReply.update({
    where: { id: latestReply.id },
    data: { aiExtractedJson: extracted as unknown as object, aiExtractedAt: new Date(), aiConfidence: extracted.confidence },
  });

  // Persist what AI gave us regardless of confidence — LOW results are tagged
  // EMAIL_AUTO_LOW so the buyer can see/edit them in the panel and the Award
  // handler refuses them until acknowledged. Silent-discard was the bug we
  // patched 4 times (2026-05-04).
  const aiSource = extracted.confidence === 'LOW' ? 'EMAIL_AUTO_LOW' : 'EMAIL_AUTO';

  // Save per-line rates (with try/catch fallback to header-only)
  let savedLineCount = 0;
  let lineTableMissing = false;
  if (indentLines.length > 0) {
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
          where: { vendorQuoteId_requisitionLineId: { vendorQuoteId: vrId, requisitionLineId: target.id } },
          update: { unitRate: lr.unitRate, gstPercent: lr.gstPercent ?? null, hsnCode: lr.hsnCode || null, discountPercent, remarks: lr.remarks || null, source: aiSource },
          create: { vendorQuoteId: vrId, requisitionLineId: target.id, unitRate: lr.unitRate, gstPercent: lr.gstPercent ?? null, hsnCode: lr.hsnCode || null, discountPercent, remarks: lr.remarks || null, source: aiSource },
        });
        savedLineCount++;
      }
    } catch (err) {
      console.warn('[autoExtractIfWaiting] line-quote write failed, falling back to header rate:', (err as Error).message);
      lineTableMissing = true;
      savedLineCount = 0;
    }
  }

  // Always update header remarks + structured cost components from the AI
  await prisma.purchaseRequisitionVendor.update({
    where: { id: vrId },
    data: {
      quoteRemarks: [
        extracted.overallRateNote,
        extracted.paymentTerms ? `Payment: ${extracted.paymentTerms}` : null,
        extracted.deliveryDays ? `Delivery: ${extracted.deliveryDays} days` : null,
        extracted.freightTerms ? `Freight: ${extracted.freightTerms}` : null,
        extracted.notes ? `Notes: ${extracted.notes}` : null,
      ].filter(Boolean).join(' · ') || null,
      ...quoteCostFieldsForDb(extracted),
    },
  });

  // Compute & persist header rate
  let headerRate: number | null = null;
  if (savedLineCount > 0) {
    headerRate = await recomputeHeaderRate(vrId);
  } else if (lineTableMissing) {
    headerRate = await applyHeaderOnlyFallback(vrId, vr.requisition.id, extracted, vr.requisition.quantity, aiSource);
  }

  // Mirror to VendorItem master so item history surfaces this vendor's rate
  if (headerRate && headerRate > 0) {
    await upsertVendorItemsForQuote(vr.requisition.id, vr.vendor.id, headerRate);
  }

  return {
    ran: true,
    savedLineCount,
    totalLines: indentLines.length,
    confidence: extracted.confidence,
    headerRate,
  };
}

// Recompute the header rate (PurchaseRequisitionVendor.vendorRate) from saved
// line rates. Header source is DERIVED from line sources (so the badge reflects
// reality rather than whatever was there before).
async function recomputeHeaderRate(vrId: string): Promise<number | null> {
  const vr = await prisma.purchaseRequisitionVendor.findUnique({
    where: { id: vrId },
    include: { requisition: { include: { lines: { select: { id: true, quantity: true } } } } },
  });
  if (!vr) return null;

  let lineQuotes: Array<{ requisitionLineId: string; unitRate: number | null; source: string | null }> = [];
  try {
    lineQuotes = await prisma.purchaseRequisitionVendorLine.findMany({
      where: { vendorQuoteId: vrId },
      select: { requisitionLineId: true, unitRate: true, source: true },
    
    take: 500,
  });
  } catch {
    return null;
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
  return headerRate;
}

// Header-only fallback path (per-line table missing): save the first usable
// rate so the user at least sees a number.
async function applyHeaderOnlyFallback(
  vrId: string, _prId: string,
  extracted: { lineRates: Array<{ unitRate?: number }>; extractedTotal?: number },
  totalQty: number,
  aiSource: string = 'EMAIL_AUTO',
): Promise<number | null> {
  const firstLine = extracted.lineRates.find(l => typeof l.unitRate === 'number' && l.unitRate > 0);
  const rate = firstLine?.unitRate
    ?? (extracted.extractedTotal && totalQty > 0
        ? Math.round((extracted.extractedTotal / totalQty) * 100) / 100
        : null);
  if (!rate) return null;
  await prisma.purchaseRequisitionVendor.update({
    where: { id: vrId },
    data: { vendorRate: rate, quotedAt: new Date(), quoteSource: aiSource },
  });
  return rate;
}

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
