/**
 * Integrity Audit — one endpoint, one SQL pass, every "X must have Y" invariant.
 *
 * Returns a row per class with violation count, sample localId/refs, and severity.
 * The companion frontend page renders each class as a tile (green if n=0, red if n>0)
 * and drills into the sample on click.
 *
 * Designed for ZERO cost when clean — every class is a NOT-EXISTS / EXISTS scan,
 * so a healthy DB returns instantly. When broken, the same scan also produces the
 * fix-input list (the sample localIds / GRN ids).
 *
 * Auth: same admin-only convention as other admin routes (cookie auth via outer
 * middleware in app.ts; we don't authorize() here because we want analytics-ish
 * read by any logged-in user with backoffice access for now).
 */

import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';

const router = Router();
router.use(authenticate);

interface ClassRow {
  key: string;
  label: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  count: number;
  exposure: { kind: 'mt' | 'rs' | 'none'; value: number };
  sample: Array<Record<string, unknown>>;
}

router.get('/', asyncHandler(async (_req: AuthRequest, res: Response) => {
  // Each class is computed independently. We use $queryRaw for the heavy scans
  // because the EXISTS / NOT EXISTS patterns are cleaner in SQL than Prisma.

  // ===== CLASS 1a: Inbound PO/JOB_WORK weighment → GRN =====
  const c1a = await prisma.$queryRaw<Array<{ ticketNo: number; vehicleNo: string; supplierName: string; mt: number; localId: string }>>`
    SELECT w."ticketNo", w."vehicleNo", w."supplierName", (w."netWeight"/1000)::float AS mt, w."localId"
    FROM "Weighment" w
    WHERE w.direction='INBOUND' AND w.status='COMPLETE' AND COALESCE(w.cancelled,false)=false
      AND w."purchaseType" IN ('PO','JOB_WORK') AND w."poId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "GoodsReceipt" g
        WHERE g."ticketNo" = w."ticketNo" OR g.remarks ILIKE '%' || w."localId" || '%'
           OR g.remarks ILIKE '%Ticket #' || w."ticketNo" || ' %'
      )
    ORDER BY w."secondWeightAt" DESC NULLS LAST
    LIMIT 50
  `;

  // ===== CLASS 1b: Inbound SPOT/FARMER → DirectPurchase =====
  const c1b = await prisma.$queryRaw<Array<{ ticketNo: number; vehicleNo: string; supplierName: string; mt: number; localId: string }>>`
    SELECT w."ticketNo", w."vehicleNo", w."supplierName", (w."netWeight"/1000)::float AS mt, w."localId"
    FROM "Weighment" w
    WHERE w.direction='INBOUND' AND w.status='COMPLETE' AND COALESCE(w.cancelled,false)=false
      AND w."purchaseType" IN ('SPOT','FARMER')
      AND NOT EXISTS (SELECT 1 FROM "DirectPurchase" dp WHERE dp.remarks ILIKE '%' || w."localId" || '%')
    ORDER BY w."secondWeightAt" DESC NULLS LAST
    LIMIT 50
  `;

  // ===== CLASS 1c: Inbound TRADER → GRN =====
  const c1c = await prisma.$queryRaw<Array<{ ticketNo: number; vehicleNo: string; supplierName: string; mt: number; localId: string }>>`
    SELECT w."ticketNo", w."vehicleNo", w."supplierName", (w."netWeight"/1000)::float AS mt, w."localId"
    FROM "Weighment" w
    WHERE w.direction='INBOUND' AND w.status='COMPLETE' AND COALESCE(w.cancelled,false)=false
      AND w."purchaseType" = 'TRADER' AND w."supplierId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "GoodsReceipt" g
        WHERE g."ticketNo" = w."ticketNo" OR g.remarks ILIKE '%' || w."localId" || '%'
      )
    ORDER BY w."secondWeightAt" DESC NULLS LAST
    LIMIT 50
  `;

  // ===== CLASS 1d-g: Outbound classes — combined into one row each =====
  const c1d = await prisma.$queryRaw<Array<{ ticketNo: number; vehicleNo: string; customerName: string; mt: number; localId: string }>>`
    SELECT w."ticketNo", w."vehicleNo", w."customerName", (w."netWeight"/1000)::float AS mt, w."localId"
    FROM "Weighment" w
    WHERE w.direction='OUTBOUND' AND w.status='COMPLETE' AND COALESCE(w.cancelled,false)=false
      AND LOWER(w."materialName") LIKE '%ethanol%'
      AND NOT EXISTS (SELECT 1 FROM "DispatchTruck" dt WHERE dt."sourceWbId" = w."localId")
    ORDER BY w."secondWeightAt" DESC NULLS LAST
    LIMIT 50
  `;

  const c1e = await prisma.$queryRaw<Array<{ ticketNo: number; vehicleNo: string; mt: number; localId: string }>>`
    SELECT w."ticketNo", w."vehicleNo", (w."netWeight"/1000)::float AS mt, w."localId"
    FROM "Weighment" w
    WHERE w.direction='OUTBOUND' AND w.status='COMPLETE' AND COALESCE(w.cancelled,false)=false
      AND (LOWER(w."materialName") LIKE '%ddgs%' OR LOWER(w."materialName") LIKE '%wdgs%' OR w."materialCategory"='DDGS')
      AND NOT EXISTS (SELECT 1 FROM "DDGSDispatchTruck" d WHERE d.remarks ILIKE '%' || w."localId" || '%')
    ORDER BY w."secondWeightAt" DESC NULLS LAST
    LIMIT 50
  `;

  // ===== CLASS 2a: CONFIRMED GRN → StockMovement (the ₹3.1cr one) =====
  const c2a = await prisma.$queryRaw<Array<{ grnNo: number; vehicleNo: string; totalAmount: number; itemName: string; id: string }>>`
    SELECT g."grnNo", g."vehicleNo", g."totalAmount",
           (SELECT ii.name FROM "GRNLine" gl LEFT JOIN "InventoryItem" ii ON ii.id = gl."inventoryItemId" WHERE gl."grnId" = g.id LIMIT 1) AS "itemName",
           g.id
    FROM "GoodsReceipt" g
    WHERE g.status='CONFIRMED'
      AND EXISTS (SELECT 1 FROM "GRNLine" gl WHERE gl."grnId" = g.id AND gl."inventoryItemId" IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM "StockMovement" sm WHERE sm."refType"='GRN' AND sm."refId"=g.id)
    ORDER BY g."grnDate" DESC
    LIMIT 50
  `;

  // ===== CLASS 2b: StockMovement GRN_RECEIPT → JournalEntry =====
  const c2b = await prisma.$queryRaw<Array<{ movementNo: number; totalValue: number; itemId: string; id: string }>>`
    SELECT sm."movementNo", sm."totalValue", sm."itemId", sm.id
    FROM "StockMovement" sm
    WHERE sm."movementType" = 'GRN_RECEIPT'
      AND NOT EXISTS (SELECT 1 FROM "JournalEntry" je WHERE je."refType"='PURCHASE' AND je."refId" = sm.id)
    ORDER BY sm.date DESC
    LIMIT 50
  `;

  // ===== CLASS 3a: CONFIRMED VendorPayment → JournalEntry =====
  const c3a = await prisma.$queryRaw<Array<{ amount: number; mode: string | null; reference: string | null; id: string }>>`
    SELECT vp.amount, vp.mode, vp.reference, vp.id
    FROM "VendorPayment" vp
    WHERE vp."paymentStatus" = 'CONFIRMED'
      AND NOT EXISTS (SELECT 1 FROM "JournalEntry" je WHERE je."refType"='PAYMENT' AND je."refId" = vp.id)
    ORDER BY vp."paymentDate" DESC
    LIMIT 50
  `;

  // ===== CLASS 4a: POLine.receivedQty drift vs sum of GRN line accepted =====
  const c4a = await prisma.$queryRaw<Array<{ poNo: number; description: string; po_recd: number; grn_recd: number; drift: number }>>`
    SELECT p."poNo", poll.description,
           poll."receivedQty"::float AS po_recd,
           COALESCE((SELECT SUM(gl."acceptedQty") FROM "GRNLine" gl
                     JOIN "GoodsReceipt" g ON g.id = gl."grnId"
                     WHERE gl."poLineId" = poll.id AND g.status='CONFIRMED'), 0)::float AS grn_recd,
           (poll."receivedQty" - COALESCE((SELECT SUM(gl."acceptedQty") FROM "GRNLine" gl
                     JOIN "GoodsReceipt" g ON g.id = gl."grnId"
                     WHERE gl."poLineId" = poll.id AND g.status='CONFIRMED'), 0))::float AS drift
    FROM "POLine" poll
    JOIN "PurchaseOrder" p ON p.id = poll."poId"
    WHERE ABS(poll."receivedQty" - COALESCE((SELECT SUM(gl."acceptedQty") FROM "GRNLine" gl
                     JOIN "GoodsReceipt" g ON g.id = gl."grnId"
                     WHERE gl."poLineId" = poll.id AND g.status='CONFIRMED'), 0)) > 0.01
    LIMIT 50
  `;

  // ===== CLASS 4b: VendorInvoice balance drift =====
  const c4b = await prisma.$queryRaw<Array<{ invoiceNo: string; stored: number; computed: number; drift: number }>>`
    SELECT vi."invoiceNo", vi."balanceAmount"::float AS stored,
           (vi."totalAmount" - COALESCE((SELECT SUM(p.amount + COALESCE(p."tdsDeducted",0)) FROM "VendorPayment" p
              WHERE p."invoiceId" = vi.id AND p."paymentStatus"='CONFIRMED'), 0))::float AS computed,
           (vi."balanceAmount" - (vi."totalAmount" - COALESCE((SELECT SUM(p.amount + COALESCE(p."tdsDeducted",0)) FROM "VendorPayment" p
              WHERE p."invoiceId" = vi.id AND p."paymentStatus"='CONFIRMED'), 0)))::float AS drift
    FROM "VendorInvoice" vi
    WHERE ABS(vi."balanceAmount" - (vi."totalAmount" - COALESCE((SELECT SUM(p.amount + COALESCE(p."tdsDeducted",0)) FROM "VendorPayment" p
              WHERE p."invoiceId" = vi.id AND p."paymentStatus"='CONFIRMED'), 0))) > 1
    LIMIT 50
  `;

  // ===== CLASS 5a/5b: Backlogs =====
  const c5a = await prisma.plantIssue.findMany({
    where: { status: 'OPEN' },
    select: { id: true, title: true, severity: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const c5b = await prisma.approval.findMany({
    where: { status: 'PENDING' },
    select: { id: true, title: true, type: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  // Exposure helpers
  const sumMt = (rows: Array<{ mt: number }>) => Math.round(rows.reduce((a, r) => a + (r.mt || 0), 0) * 100) / 100;
  const sumRsTotalAmount = (rows: Array<{ totalAmount: number }>) => Math.round(rows.reduce((a, r) => a + (r.totalAmount || 0), 0) * 100) / 100;
  const sumRsAmount = (rows: Array<{ amount: number }>) => Math.round(rows.reduce((a, r) => a + (r.amount || 0), 0) * 100) / 100;
  const sumRsTotalValue = (rows: Array<{ totalValue: number }>) => Math.round(rows.reduce((a, r) => a + (r.totalValue || 0), 0) * 100) / 100;

  // We also need TRUE total counts (not just sample size). For each, do a COUNT.
  const counts = await prisma.$queryRaw<Array<{ k: string; n: number }>>`
    SELECT '1a' AS k, COUNT(*)::int AS n FROM "Weighment" w
      WHERE w.direction='INBOUND' AND w.status='COMPLETE' AND COALESCE(w.cancelled,false)=false
        AND w."purchaseType" IN ('PO','JOB_WORK') AND w."poId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "GoodsReceipt" g WHERE g."ticketNo" = w."ticketNo" OR g.remarks ILIKE '%' || w."localId" || '%' OR g.remarks ILIKE '%Ticket #' || w."ticketNo" || ' %')
    UNION ALL SELECT '1b', COUNT(*)::int FROM "Weighment" w
      WHERE w.direction='INBOUND' AND w.status='COMPLETE' AND COALESCE(w.cancelled,false)=false
        AND w."purchaseType" IN ('SPOT','FARMER')
        AND NOT EXISTS (SELECT 1 FROM "DirectPurchase" dp WHERE dp.remarks ILIKE '%' || w."localId" || '%')
    UNION ALL SELECT '1c', COUNT(*)::int FROM "Weighment" w
      WHERE w.direction='INBOUND' AND w.status='COMPLETE' AND COALESCE(w.cancelled,false)=false
        AND w."purchaseType"='TRADER' AND w."supplierId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "GoodsReceipt" g WHERE g."ticketNo" = w."ticketNo" OR g.remarks ILIKE '%' || w."localId" || '%')
    UNION ALL SELECT '1d', COUNT(*)::int FROM "Weighment" w
      WHERE w.direction='OUTBOUND' AND w.status='COMPLETE' AND COALESCE(w.cancelled,false)=false
        AND LOWER(w."materialName") LIKE '%ethanol%'
        AND NOT EXISTS (SELECT 1 FROM "DispatchTruck" dt WHERE dt."sourceWbId" = w."localId")
    UNION ALL SELECT '1e', COUNT(*)::int FROM "Weighment" w
      WHERE w.direction='OUTBOUND' AND w.status='COMPLETE' AND COALESCE(w.cancelled,false)=false
        AND (LOWER(w."materialName") LIKE '%ddgs%' OR LOWER(w."materialName") LIKE '%wdgs%' OR w."materialCategory"='DDGS')
        AND NOT EXISTS (SELECT 1 FROM "DDGSDispatchTruck" d WHERE d.remarks ILIKE '%' || w."localId" || '%')
    UNION ALL SELECT '2a', COUNT(*)::int FROM "GoodsReceipt" g
      WHERE g.status='CONFIRMED'
        AND EXISTS (SELECT 1 FROM "GRNLine" gl WHERE gl."grnId" = g.id AND gl."inventoryItemId" IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM "StockMovement" sm WHERE sm."refType"='GRN' AND sm."refId" = g.id)
    UNION ALL SELECT '2b', COUNT(*)::int FROM "StockMovement" sm
      WHERE sm."movementType"='GRN_RECEIPT'
        AND NOT EXISTS (SELECT 1 FROM "JournalEntry" je WHERE je."refType"='PURCHASE' AND je."refId" = sm.id)
    UNION ALL SELECT '3a', COUNT(*)::int FROM "VendorPayment" vp
      WHERE vp."paymentStatus"='CONFIRMED'
        AND NOT EXISTS (SELECT 1 FROM "JournalEntry" je WHERE je."refType"='PAYMENT' AND je."refId" = vp.id)
    UNION ALL SELECT '4a', COUNT(*)::int FROM (
      SELECT poll.id FROM "POLine" poll
      WHERE ABS(poll."receivedQty" - COALESCE((SELECT SUM(gl."acceptedQty") FROM "GRNLine" gl
        JOIN "GoodsReceipt" g ON g.id = gl."grnId" WHERE gl."poLineId"=poll.id AND g.status='CONFIRMED'), 0)) > 0.01
    ) t
    UNION ALL SELECT '4b', COUNT(*)::int FROM (
      SELECT vi.id FROM "VendorInvoice" vi
      WHERE ABS(vi."balanceAmount" - (vi."totalAmount" - COALESCE((SELECT SUM(p.amount + COALESCE(p."tdsDeducted",0))
        FROM "VendorPayment" p WHERE p."invoiceId"=vi.id AND p."paymentStatus"='CONFIRMED'),0))) > 1
    ) t
    UNION ALL SELECT '5a', COUNT(*)::int FROM "PlantIssue" WHERE status='OPEN'
    UNION ALL SELECT '5b', COUNT(*)::int FROM "Approval" WHERE status='PENDING'
  `;
  const countMap = Object.fromEntries(counts.map(r => [r.k, r.n]));

  const classes: ClassRow[] = [
    {
      key: '1a',
      label: 'Inbound PO/JOB_WORK → GRN',
      description: 'Truck arrived against a PO but no GoodsReceipt was created.',
      severity: 'critical',
      count: countMap['1a'] || 0,
      exposure: { kind: 'mt', value: sumMt(c1a) },
      sample: c1a,
    },
    {
      key: '1b',
      label: 'Inbound SPOT/FARMER → DirectPurchase',
      description: 'Farmer/spot purchase weighment with no DirectPurchase row.',
      severity: 'critical',
      count: countMap['1b'] || 0,
      exposure: { kind: 'mt', value: sumMt(c1b) },
      sample: c1b,
    },
    {
      key: '1c',
      label: 'Inbound TRADER → GRN',
      description: 'Trader (running-account) truck with no GRN.',
      severity: 'critical',
      count: countMap['1c'] || 0,
      exposure: { kind: 'mt', value: sumMt(c1c) },
      sample: c1c,
    },
    {
      key: '1d',
      label: 'Outbound ETHANOL → DispatchTruck',
      description: 'Ethanol left the plant with no DispatchTruck record.',
      severity: 'high',
      count: countMap['1d'] || 0,
      exposure: { kind: 'mt', value: sumMt(c1d) },
      sample: c1d,
    },
    {
      key: '1e',
      label: 'Outbound DDGS → DDGSDispatchTruck',
      description: 'DDGS/WDGS dispatch with no truck record.',
      severity: 'high',
      count: countMap['1e'] || 0,
      exposure: { kind: 'mt', value: sumMt(c1e) },
      sample: c1e,
    },
    {
      key: '2a',
      label: 'CONFIRMED GRN → StockMovement',
      description: 'Confirmed receipt but inventory never updated (the ₹3.1cr legacy gap, Apr-18 → May-06).',
      severity: 'critical',
      count: countMap['2a'] || 0,
      exposure: { kind: 'rs', value: sumRsTotalAmount(c2a) },
      sample: c2a,
    },
    {
      key: '2b',
      label: 'StockMovement (GRN_RECEIPT) → JournalEntry',
      description: 'Inventory moved but accounting journal not posted.',
      severity: 'high',
      count: countMap['2b'] || 0,
      exposure: { kind: 'rs', value: sumRsTotalValue(c2b) },
      sample: c2b,
    },
    {
      key: '3a',
      label: 'CONFIRMED VendorPayment → JournalEntry',
      description: 'Payment confirmed but no accounting journal.',
      severity: 'high',
      count: countMap['3a'] || 0,
      exposure: { kind: 'rs', value: sumRsAmount(c3a) },
      sample: c3a,
    },
    {
      key: '4a',
      label: 'POLine.receivedQty drift',
      description: 'PO line received-qty does not match sum of confirmed GRN lines.',
      severity: 'medium',
      count: countMap['4a'] || 0,
      exposure: { kind: 'none', value: 0 },
      sample: c4a,
    },
    {
      key: '4b',
      label: 'VendorInvoice balance drift',
      description: 'Invoice balanceAmount inconsistent with totalAmount − payments.',
      severity: 'medium',
      count: countMap['4b'] || 0,
      exposure: { kind: 'none', value: 0 },
      sample: c4b,
    },
    {
      key: '5a',
      label: 'PlantIssue OPEN backlog',
      description: 'Operations issues left unresolved.',
      severity: 'medium',
      count: countMap['5a'] || 0,
      exposure: { kind: 'none', value: 0 },
      sample: c5a,
    },
    {
      key: '5b',
      label: 'Approval PENDING backlog',
      description: 'Admin approvals waiting on action.',
      severity: 'low',
      count: countMap['5b'] || 0,
      exposure: { kind: 'none', value: 0 },
      sample: c5b,
    },
  ];

  const totalViolations = classes.reduce((a, c) => a + c.count, 0);
  const criticalViolations = classes.filter(c => c.severity === 'critical').reduce((a, c) => a + c.count, 0);

  res.json({
    runAt: new Date().toISOString(),
    summary: {
      totalViolations,
      criticalViolations,
      cleanClasses: classes.filter(c => c.count === 0).length,
      brokenClasses: classes.filter(c => c.count > 0).length,
    },
    classes,
  });
}));

export default router;
