import { Router, Response } from 'express';
import { AuthRequest, authenticate, getCompanyFilter } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import prisma from '../config/prisma';

const router = Router();

// Stores covers everything that isn't a raw material or fuel:
// chemicals, packing, spares, consumables, mechanical/electrical items, services, etc.
const STORE_CATEGORIES = [
  'CHEMICAL', 'PACKING', 'SPARE_PART', 'SPARE', 'CONSUMABLE',
  'MECHANICAL', 'ELECTRICAL', 'TOOL', 'SAFETY', 'SERVICE',
  'GENERAL', 'OTHER',
] as const;

// GET /materials — store inventory items (used for new PO line dropdowns)
router.get('/materials', authenticate, asyncHandler(async (_req: AuthRequest, res: Response) => {
  const items = await prisma.inventoryItem.findMany({
    where: { category: { in: [...STORE_CATEGORIES] }, isActive: true },
    select: {
      id: true, name: true, unit: true, hsnCode: true, gstPercent: true, category: true,
    },
    orderBy: { name: 'asc' },
    take: 500,
  });
  res.json(items);
}));

// GET /deals — running store orders with status, received qty and outstanding
router.get('/deals', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const status = (req.query.status as string | undefined)?.toUpperCase();
  const validStatuses = ['APPROVED', 'SENT', 'PARTIAL_RECEIVED', 'RECEIVED', 'CLOSED'];
  const statusFilter = status && validStatuses.includes(status)
    ? [status]
    : ['APPROVED', 'SENT', 'PARTIAL_RECEIVED', 'RECEIVED'];

  const deals = await prisma.purchaseOrder.findMany({
    where: {
      ...getCompanyFilter(req),
      status: { in: statusFilter },
      // A "store deal" PO has at least one line that is either (a) linked
      // to an InventoryItem in a store category, or (b) free-text — those
      // come from the indent → quote → award flow, which is store work by
      // definition (no other path creates inventoryItemId-null lines).
      lines: {
        some: {
          OR: [
            { inventoryItem: { category: { in: [...STORE_CATEGORIES] } } },
            { inventoryItemId: null },
          ],
        },
      },
    },
    take: 200,
    orderBy: { poDate: 'desc' },
    select: {
      id: true, poNo: true, dealType: true, status: true, poDate: true, deliveryDate: true, remarks: true,
      grandTotal: true,
      vendor: { select: { id: true, name: true, phone: true } },
      lines: {
        select: {
          id: true, description: true, rate: true, unit: true, quantity: true, receivedQty: true, pendingQty: true,
          gstPercent: true,
          inventoryItemId: true,
          inventoryItem: { select: { category: true, name: true } },
        },
      },
      _count: { select: { grns: true } },
    },
  });

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const result = deals.map(deal => {
    // Count both store-category lines AND free-text lines (filter out RM/fuel
    // from mixed POs — they have inventoryItemId set with a non-store category).
    const storeLines = deal.lines.filter(l =>
      !l.inventoryItemId ||
      (l.inventoryItem?.category && STORE_CATEGORIES.includes(l.inventoryItem.category as typeof STORE_CATEGORIES[number]))
    );
    const lines = storeLines.length > 0 ? storeLines : deal.lines;
    const orderedQty = lines.reduce((s, l) => s + (l.quantity || 0), 0);
    const receivedQty = lines.reduce((s, l) => s + (l.receivedQty || 0), 0);
    const pendingQty = lines.reduce((s, l) => s + Math.max((l.quantity || 0) - (l.receivedQty || 0), 0), 0);

    // Per-line base/gst so the totals reflect each line's GST rate (often mixed)
    let orderedBase = 0, orderedGst = 0, receivedBase = 0, receivedGst = 0;
    for (const l of lines) {
      const rate = l.rate || 0;
      const gstPct = l.gstPercent || 0;
      const oBase = (l.quantity || 0) * rate;
      const rBase = (l.receivedQty || 0) * rate;
      orderedBase += oBase;
      orderedGst += oBase * gstPct / 100;
      receivedBase += rBase;
      receivedGst += rBase * gstPct / 100;
    }
    const orderedTotal = orderedBase + orderedGst;
    const receivedTotal = receivedBase + receivedGst;

    return {
      id: deal.id,
      poNo: deal.poNo,
      poDate: deal.poDate,
      deliveryDate: deal.deliveryDate,
      status: deal.status,
      dealType: deal.dealType,
      vendor: deal.vendor,
      remarks: deal.remarks,
      grandTotal: deal.grandTotal,
      lineCount: lines.length,
      orderedQty: round2(orderedQty),
      receivedQty: round2(receivedQty),
      pendingQty: round2(pendingQty),
      // Base (taxable) value
      orderedValue: round2(orderedBase),
      receivedValue: round2(receivedBase),
      // GST amounts
      orderedGst: round2(orderedGst),
      receivedGst: round2(receivedGst),
      // Final amounts (Base + GST)
      orderedTotal: round2(orderedTotal),
      receivedTotal: round2(receivedTotal),
      grnCount: deal._count?.grns ?? 0,
      lines: lines.map(l => {
        const base = (l.quantity || 0) * (l.rate || 0);
        const gstAmt = base * (l.gstPercent || 0) / 100;
        return {
          id: l.id,
          description: l.description,
          category: l.inventoryItem?.category || null,
          unit: l.unit,
          rate: l.rate,
          quantity: l.quantity,
          gstPercent: l.gstPercent || 0,
          baseValue: round2(base),
          gstValue: round2(gstAmt),
          totalValue: round2(base + gstAmt),
          receivedQty: l.receivedQty || 0,
          pendingQty: Math.max((l.quantity || 0) - (l.receivedQty || 0), 0),
        };
      }),
    };
  });

  res.json(result);
}));

// GET /deals/awaiting-confirmation — DRAFT POs auto-created from indent
// awards. These need user Confirm or Cancel before joining the running deals.
router.get('/deals/awaiting-confirmation', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const deals = await prisma.purchaseOrder.findMany({
    where: {
      ...getCompanyFilter(req),
      status: 'DRAFT',
      requisitionId: { not: null },
    },
    take: 100,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, poNo: true, poDate: true, grandTotal: true, createdAt: true,
      vendor: { select: { id: true, name: true, phone: true } },
      requisition: {
        select: {
          id: true, reqNo: true, title: true, itemName: true, department: true, justification: true,
          quotes: {
            where: { isAwarded: true },
            select: { id: true, vendorId: true },
          },
        },
      },
      lines: {
        select: { id: true, description: true, quantity: true, unit: true, rate: true, gstPercent: true },
      },
    },
  });

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const result = deals.map(po => {
    const awardedVrId = po.requisition?.quotes[0]?.id ?? null;
    let totalBase = 0, totalGst = 0;
    for (const l of po.lines) {
      const base = (l.quantity || 0) * (l.rate || 0);
      totalBase += base;
      totalGst += base * (l.gstPercent || 0) / 100;
    }
    return {
      id: po.id,
      poNo: po.poNo,
      poDate: po.poDate,
      createdAt: po.createdAt,
      vendor: po.vendor,
      grandTotal: po.grandTotal,
      base: round2(totalBase),
      gst: round2(totalGst),
      lineCount: po.lines.length,
      lines: po.lines.map(l => ({
        id: l.id,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        rate: l.rate,
        gstPercent: l.gstPercent || 0,
      })),
      indent: po.requisition ? {
        id: po.requisition.id,
        reqNo: po.requisition.reqNo,
        title: po.requisition.title || po.requisition.itemName,
        department: po.requisition.department,
        justification: po.requisition.justification,
        awardedVrId,
      } : null,
    };
  });

  res.json(result);
}));

// GET /summary — top-line counts for the toolbar KPI strip
router.get('/summary', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const deals = await prisma.purchaseOrder.findMany({
    where: {
      ...getCompanyFilter(req),
      status: { in: ['APPROVED', 'SENT', 'PARTIAL_RECEIVED', 'RECEIVED'] },
      // Same filter as /deals — include free-text PO lines too (indent flow).
      lines: {
        some: {
          OR: [
            { inventoryItem: { category: { in: [...STORE_CATEGORIES] } } },
            { inventoryItemId: null },
          ],
        },
      },
    },
    select: {
      status: true,
      lines: {
        select: {
          quantity: true, receivedQty: true, rate: true, gstPercent: true,
          inventoryItemId: true,
          inventoryItem: { select: { category: true } },
        },
      },
    },
  });

  let openCount = 0, partialCount = 0, receivedCount = 0;
  let orderedBase = 0, orderedGst = 0, receivedBase = 0, receivedGst = 0;
  for (const d of deals) {
    if (d.status === 'APPROVED' || d.status === 'SENT') openCount++;
    else if (d.status === 'PARTIAL_RECEIVED') partialCount++;
    else if (d.status === 'RECEIVED') receivedCount++;
    const storeLines = d.lines.filter(l =>
      !l.inventoryItemId ||
      (l.inventoryItem?.category && STORE_CATEGORIES.includes(l.inventoryItem.category as typeof STORE_CATEGORIES[number]))
    );
    const lines = storeLines.length > 0 ? storeLines : d.lines;
    for (const l of lines) {
      const oBase = (l.quantity || 0) * (l.rate || 0);
      const rBase = (l.receivedQty || 0) * (l.rate || 0);
      const pct = l.gstPercent || 0;
      orderedBase += oBase;
      orderedGst += oBase * pct / 100;
      receivedBase += rBase;
      receivedGst += rBase * pct / 100;
    }
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const orderedTotal = orderedBase + orderedGst;
  const receivedTotal = receivedBase + receivedGst;
  res.json({
    openCount, partialCount, receivedCount,
    totalDeals: deals.length,
    // Base (taxable) totals
    totalOrdered: round2(orderedBase),
    totalReceived: round2(receivedBase),
    // GST
    totalOrderedGst: round2(orderedGst),
    totalReceivedGst: round2(receivedGst),
    // Final (Base + GST)
    totalOrderedWithGst: round2(orderedTotal),
    totalReceivedWithGst: round2(receivedTotal),
    totalOutstandingValue: round2(Math.max(orderedTotal - receivedTotal, 0)),
  });
}));

export default router;
