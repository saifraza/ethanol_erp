import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { ValidationError } from '../shared/errors';
import { nextDocNo } from '../utils/docSequence';
import { getCompanyForPdf } from '../utils/pdfCompanyHelper';
import { onStockMovement } from '../services/autoJournal';
import { notify } from '../services/notify';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
// RAG indexing removed — only compliance docs go to RAG
import { generateVaultNote } from '../services/vaultWriter';

const router = Router();
router.use(authenticate as any);

// ── Multer for GRN document uploads ──
const grnUploadDir = path.join(__dirname, '../../uploads/grn-documents');
if (!fs.existsSync(grnUploadDir)) fs.mkdirSync(grnUploadDir, { recursive: true });

const grnStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, grnUploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname)}`),
});
const grnUpload = multer({ storage: grnStorage, limits: { fileSize: 15 * 1024 * 1024 } });

// ─── Helper: sync GRN lines to new inventory system ───
async function syncGrnToInventory(
  grnId: string,
  grnNo: number,
  lines: Array<{ inventoryItemId?: string | null; materialId?: string | null; acceptedQty: number; rate: number; unit: string; batchNo: string; storageLocation: string }>,
  warehouseId: string | null,
  userId: string,
  companyId?: string | null
): Promise<void> {
  // Need a warehouse — use provided one or find default
  let whId = warehouseId;
  if (!whId) {
    const defaultWh = await prisma.warehouse.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (defaultWh) whId = defaultWh.id;
  }
  if (!whId) return; // no warehouses configured, skip inventory sync

  for (const line of lines) {
    // Use inventoryItemId directly (unified material master)
    const itemId = line.inventoryItemId || line.materialId;
    if (!itemId || line.acceptedQty <= 0) continue;

    const qty = line.acceptedQty;
    const costRate = line.rate;
    const totalValue = Math.round(qty * costRate * 100) / 100;

    await prisma.$transaction(async (tx) => {
      // NF-6 FIX: Read invItem INSIDE transaction for concurrency-safe avgCost
      const invItem = await tx.inventoryItem.findUnique({
        where: { id: itemId },
        select: { id: true, name: true, unit: true, currentStock: true, avgCost: true },
      });
      if (!invItem) return;

      // 1. Create StockMovement
      const movement = await tx.stockMovement.create({
        data: {
          itemId: invItem.id,
          movementType: 'GRN_RECEIPT',
          direction: 'IN',
          quantity: qty,
          unit: invItem.unit,
          costRate,
          totalValue,
          warehouseId: whId!,
          refType: 'GRN',
          refId: grnId,
          refNo: `GRN-${grnNo}`,
          narration: `GRN receipt for ${invItem.name}`,
          userId,
        },
      });

      // 2. Upsert StockLevel
      const existing = await tx.stockLevel.findFirst({
        where: { itemId: invItem.id, warehouseId: whId!, binId: null, batchId: null },
      });
      if (existing) {
        await tx.stockLevel.update({
          where: { id: existing.id },
          data: { quantity: { increment: qty } },
        });
      } else {
        await tx.stockLevel.create({
          data: { itemId: invItem.id, warehouseId: whId!, binId: null, batchId: null, quantity: qty },
        });
      }

      // 3. Update InventoryItem — weighted average cost
      const existingQty = invItem.currentStock;
      const existingAvgCost = invItem.avgCost;
      const newTotalQty = existingQty + qty;
      const newAvgCost = newTotalQty > 0
        ? (existingQty * existingAvgCost + qty * costRate) / newTotalQty
        : costRate;

      await tx.inventoryItem.update({
        where: { id: invItem.id },
        data: {
          currentStock: { increment: qty },
          avgCost: Math.round(newAvgCost * 100) / 100,
          totalValue: Math.round(newTotalQty * newAvgCost * 100) / 100,
        },
      });

      // Fire-and-forget auto journal
      onStockMovement(prisma as Parameters<typeof onStockMovement>[0], {
        id: movement.id,
        movementNo: movement.movementNo,
        movementType: movement.movementType,
        direction: movement.direction,
        totalValue: movement.totalValue,
        itemName: invItem.name,
        userId,
        date: movement.date,
        companyId: companyId || undefined,
      }).catch(() => {});
    });
  }
}

// ─── Helper: after GRN confirms, close the loop back to the originating indent ───
// If the PO was auto-created from a PurchaseRequisition, recompute how much of the
// indent's purchase quantity has now arrived, flip PR.status → PARTIAL_RECEIVED / RECEIVED,
// and notify the original requester. Never throws — notification failure shouldn't
// roll back an already-committed GRN.
async function syncRequisitionAfterGrnConfirm(grnId: string): Promise<void> {
  try {
    const grn = await prisma.goodsReceipt.findUnique({
      where: { id: grnId },
      select: { poId: true },
    });
    if (!grn?.poId) return;

    const po = await prisma.purchaseOrder.findUnique({
      where: { id: grn.poId },
      select: { requisitionId: true },
    });
    if (!po?.requisitionId) return;

    const pr = await prisma.purchaseRequisition.findUnique({
      where: { id: po.requisitionId },
      select: {
        id: true, reqNo: true, title: true, itemName: true, unit: true,
        purchaseQty: true, userId: true, inventoryItemId: true, status: true,
      },
    });
    if (!pr || pr.purchaseQty <= 0) return;

    // Sum accepted quantity across every confirmed GRN line belonging to any PO tied to this PR.
    // Filter by inventoryItemId when the PR is linked to a specific item (narrows out unrelated lines
    // on multi-item POs). If PR is a free-text indent (no inventoryItemId), trust the PO→PR link.
    const linkedPos = await prisma.purchaseOrder.findMany({
      where: { requisitionId: pr.id },
      select: { id: true },
    });
    const poIds = linkedPos.map(p => p.id);
    if (poIds.length === 0) return;

    const agg = await prisma.gRNLine.aggregate({
      _sum: { acceptedQty: true },
      where: {
        grn: { poId: { in: poIds }, status: 'CONFIRMED' },
        ...(pr.inventoryItemId ? { inventoryItemId: pr.inventoryItemId } : {}),
      },
    });
    const totalReceived = agg._sum.acceptedQty || 0;

    let newStatus = pr.status;
    if (totalReceived >= pr.purchaseQty) {
      newStatus = 'RECEIVED';
    } else if (totalReceived > 0) {
      newStatus = 'PARTIAL_RECEIVED';
    }

    if (newStatus === pr.status) return; // no change

    await prisma.purchaseRequisition.update({
      where: { id: pr.id },
      data: { status: newStatus },
    });

    const title = newStatus === 'RECEIVED'
      ? `Indent #${pr.reqNo} — material received in store`
      : `Indent #${pr.reqNo} — partial receipt in store`;
    const message = newStatus === 'RECEIVED'
      ? `${pr.itemName} (${pr.purchaseQty} ${pr.unit}) has fully arrived. Store can now issue to you.`
      : `Partial receipt: ${totalReceived}/${pr.purchaseQty} ${pr.unit} of ${pr.itemName} has arrived in store.`;

    await notify({
      category: 'INFO',
      severity: 'INFO',
      title,
      message,
      link: `/inventory/store-indents`,
      userId: pr.userId,
      entityType: 'PurchaseRequisition',
      entityId: pr.id,
      dedupeKey: `pr-receipt:${pr.id}:${newStatus}`,
    });
  } catch (err) {
    console.error('[GRN→PR sync] failed:', err);
  }
}

// GET / — list GRNs with filters (poId, vendorId, status)
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const poId = req.query.poId as string | undefined;
    const vendorId = req.query.vendorId as string | undefined;
    const status = req.query.status as string | undefined;

    const archived = req.query.archived === 'true';
    const grnType = req.query.grnType as string | undefined;
    const where: any = { archived, ...getCompanyFilter(req) };
    if (poId) where.poId = poId;
    if (vendorId) where.vendorId = vendorId;
    if (status) where.status = status;
    if (grnType) where.grnType = grnType;

    const grns = await prisma.goodsReceipt.findMany({
      where,
      include: {
        po: { select: { id: true, poNo: true, status: true } },
        vendor: { select: { id: true, name: true, email: true } },
        // Cap lines payload — list view shows line count + totals, not each line.
        // Detail view fetches lines via its own query. Avoids 200 × 20 = 4000 nested rows.
        lines: {
          select: { id: true, receivedQty: true, rate: true, description: true, inventoryItemId: true },
          take: 50,
        },
      },
      orderBy: { grnDate: 'desc' },
      take: 200,
    });

    res.json({ grns });
}));

// GET /unbilled?vendorId=… — GRNs received from a vendor that no VendorInvoice covers yet.
// Used by the bulk Smart Upload modal so accounts can map a freshly-uploaded bill to one
// or more open GRNs in a single click.
router.get('/unbilled', asyncHandler(async (req: AuthRequest, res: Response) => {
  const vendorId = (req.query.vendorId as string | undefined)?.trim();
  if (!vendorId) {
    return res.status(400).json({ error: 'vendorId is required' });
  }

  const where: Record<string, unknown> = {
    vendorId,
    archived: false,
    status: { in: ['CONFIRMED', 'PARTIAL'] },
    ...getCompanyFilter(req),
    AND: [
      { vendorInvoices: { none: {} } },
      { vendorInvoiceLines: { none: {} } },
    ],
  };

  const grns = await prisma.goodsReceipt.findMany({
    where,
    select: {
      id: true,
      grnNo: true,
      grnDate: true,
      ticketNo: true,
      vehicleNo: true,
      status: true,
      qualityStatus: true,
      totalQty: true,
      totalAmount: true,
      poId: true,
      po: { select: { id: true, poNo: true, poType: true } },
      lines: {
        select: { id: true, description: true, receivedQty: true, rate: true, unit: true },
        take: 20,
      },
    },
    orderBy: { grnDate: 'desc' },
    take: 100,
  });

  res.json({ grns });
}));

// GET /pending-pos — list POs with pending quantities (extended with source classification)
router.get('/pending-pos', asyncHandler(async (req: AuthRequest, res: Response) => {
    const pos = await prisma.purchaseOrder.findMany({
      where: {
        status: {
          in: ['SENT', 'PARTIAL_RECEIVED', 'APPROVED'],
        },
      },
      include: {
        vendor: true,
        lines: {
          where: { pendingQty: { gt: 0 } },
          include: { inventoryItem: { select: { id: true, name: true, category: true } } },
        },
      },
      take: 500,
    });

    const filtered = pos
      .filter(po => po.lines.length > 0)
      .map(po => ({
        ...po,
        source: classifyPOSource(po.lines.map(l => l.inventoryItem?.category || null)),
      }));
    res.json({ pos: filtered });
}));

// Helper: classify PO source from line item categories
function classifyPOSource(categories: Array<string | null>): 'FUEL' | 'GRAIN' | 'STORE' {
  if (categories.some(c => c === 'FUEL')) return 'FUEL';
  if (categories.some(c => c === 'RAW_MATERIAL')) return 'GRAIN';
  return 'STORE';
}

// GET /arrivals — unified "Expected to Arrive" aggregator across sources
router.get('/arrivals', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const [pendingPOs, grainTrucksInFlight, pendingPRs, partialGRNs, todayCount] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: { status: { in: ['APPROVED', 'SENT', 'PARTIAL_RECEIVED'] } },
      select: {
        id: true, poNo: true, poDate: true, status: true, dealType: true, truckCap: true,
        grandTotal: true,
        vendor: { select: { id: true, name: true } },
        lines: {
          where: { pendingQty: { gt: 0 } },
          select: {
            id: true, description: true, pendingQty: true, quantity: true, receivedQty: true,
            unit: true, rate: true,
            inventoryItem: { select: { id: true, name: true, category: true } },
          },
        },
        grns: { select: { id: true, status: true, fullyPaid: true } },
        vendorInvoices: { select: { paidAmount: true, netPayable: true, totalAmount: true } },
      },
      take: 500,
      orderBy: { poDate: 'desc' },
    }),
    prisma.grainTruck.findMany({
      where: { grnId: null, quarantine: false },
      select: {
        id: true, date: true, vehicleNo: true, supplier: true, weightNet: true, ticketNo: true,
        purchaseOrder: { select: { id: true, poNo: true } },
      },
      orderBy: { date: 'desc' },
      take: 100,
    }),
    prisma.purchaseRequisition.findMany({
      where: {
        status: { in: ['APPROVED', 'PO_PENDING'] },
        purchaseOrders: { none: {} },
      },
      select: {
        id: true, reqNo: true, itemName: true, quantity: true, unit: true, estimatedCost: true,
        urgency: true, requestedByPerson: true, department: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    prisma.goodsReceipt.findMany({
      where: { status: 'PARTIAL', archived: false },
      select: {
        id: true, grnNo: true, grnDate: true, expectedDate: true, fullyPaid: true,
        paymentLinkedAt: true, totalAmount: true,
        po: { select: { id: true, poNo: true, grandTotal: true } },
        vendor: { select: { id: true, name: true } },
        lines: { select: { description: true, receivedQty: true, unit: true, rate: true } },
      },
      orderBy: { grnDate: 'desc' },
      take: 200,
    }),
    prisma.goodsReceipt.count({
      where: {
        status: 'CONFIRMED',
        grnDate: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    }),
  ]);

  type Row = {
    source: 'FUEL' | 'GRAIN' | 'STORE';
    poId: string; poNo: number; vendor: string; vendorId: string;
    dealType: string | null; truckCap: number | null;
    pendingQty: number; pendingValue: number;
    paidStatus: 'UNPAID' | 'ADVANCE' | 'FULL';
    hasOpenGrn: boolean;
    expectedDate: Date | null;
    items: Array<{ name: string; pending: number; unit: string; rate: number }>;
  };

  const derivePaid = (
    invoices: Array<{ paidAmount: number; netPayable: number; totalAmount: number }>,
    grandTotal: number,
  ): Row['paidStatus'] => {
    const paid = invoices.reduce((s, i) => s + (i.paidAmount || 0), 0);
    if (paid <= 0) return 'UNPAID';
    if (grandTotal > 0 && paid + 0.01 >= grandTotal) return 'FULL';
    return 'ADVANCE';
  };

  const fuel: Row[] = [];
  const grain: Row[] = [];
  const store: Row[] = [];

  for (const po of pendingPOs) {
    const cats = po.lines.map(l => l.inventoryItem?.category || null);
    const source = classifyPOSource(cats);
    const pendingQty = po.lines.reduce((s, l) => s + (l.pendingQty || 0), 0);
    const pendingValue = po.lines.reduce((s, l) => s + (l.pendingQty || 0) * (l.rate || 0), 0);
    const row: Row = {
      source,
      poId: po.id,
      poNo: po.poNo,
      vendor: po.vendor.name,
      vendorId: po.vendor.id,
      dealType: po.dealType || null,
      truckCap: po.truckCap || null,
      pendingQty,
      pendingValue: Math.round(pendingValue * 100) / 100,
      paidStatus: derivePaid(po.vendorInvoices, po.grandTotal || 0),
      hasOpenGrn: po.grns.some(g => ['DRAFT', 'PARTIAL'].includes(g.status)),
      expectedDate: null,
      items: po.lines.map(l => ({
        name: l.inventoryItem?.name || l.description,
        pending: l.pendingQty,
        unit: l.unit,
        rate: l.rate,
      })),
    };
    if (source === 'FUEL') fuel.push(row);
    else if (source === 'GRAIN') grain.push(row);
    else store.push(row);
  }

  const expectedValue =
    [...fuel, ...grain, ...store].reduce((s, r) => s + r.pendingValue, 0);
  const expectedLines = [...fuel, ...grain, ...store].reduce((s, r) => s + r.items.length, 0);
  const paidAwaiting = [...fuel, ...grain, ...store].filter(r => r.paidStatus !== 'UNPAID').length;

  res.json({
    fuel,
    grain: { pos: grain, trucksInFlight: grainTrucksInFlight },
    store,
    pr: pendingPRs,
    partial: partialGRNs,
    summary: {
      expectedValue: Math.round(expectedValue * 100) / 100,
      expectedLines,
      paidAwaiting,
      partialCount: partialGRNs.length,
      todayReceived: todayCount,
    },
  });
}));

// GET /:id — single GRN with lines, po, vendor
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const grn = await prisma.goodsReceipt.findUnique({
      where: { id: req.params.id },
      include: {
        po: true,
        vendor: true,
        lines: true,
      },
    });
    if (!grn) return res.status(404).json({ error: 'GRN not found' });
    res.json(grn);
}));

// ═══════════════════════════════════════════════
// POST /upload-extract — Upload invoice/e-way bill + AI extraction for GRN
// ═══════════════════════════════════════════════
router.post('/upload-extract',
  grnUpload.fields([
    { name: 'invoice', maxCount: 1 },
    { name: 'ewayBill', maxCount: 1 },
  ]),
  asyncHandler(async (req: Request, res: Response) => {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const invoiceFile = files?.invoice?.[0];
    const ewayBillFile = files?.ewayBill?.[0];

    if (!invoiceFile && !ewayBillFile) {
      res.status(400).json({ error: 'Upload at least one file (invoice or e-way bill)' }); return;
    }

    const invoiceFilePath = invoiceFile ? `grn-documents/${invoiceFile.filename}` : null;
    const ewayBillFilePath = ewayBillFile ? `grn-documents/${ewayBillFile.filename}` : null;

    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_KEY) {
      res.json({ invoiceFilePath, ewayBillFilePath, extracted: null, error: 'AI not configured (no GEMINI_API_KEY)' });
      return;
    }

    try {
      // Build parts for Gemini — send all uploaded files
      const parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = [];

      parts.push({ text: `Extract data from these truck delivery documents (vendor invoice and/or e-way bill) for creating a Goods Receipt Note at an ethanol distillery plant. Return ONLY valid JSON with these keys:
{
  "invoice_number": "string - the vendor's invoice/bill number",
  "invoice_date": "YYYY-MM-DD format",
  "vendor_name": "string - supplier/vendor company name",
  "vendor_gstin": "string - vendor GSTIN number (15 chars) if visible",
  "eway_bill_number": "string - e-way bill number if visible",
  "vehicle_number": "string - truck/vehicle registration number if visible",
  "challan_number": "string - delivery challan number if visible",
  "items": [{"description": "string - material name", "hsn": "string - HSN code", "qty": number, "unit": "string (MT/KG/LTR/NOS/BAG)", "rate": number, "amount": number}],
  "taxable_amount": number,
  "cgst": number,
  "sgst": number,
  "igst": number,
  "total_gst": number,
  "total_amount": number,
  "supply_type": "INTRA_STATE if CGST+SGST present, INTER_STATE if IGST present"
}
If a field is not found in the documents, use null for strings and 0 for numbers. Return ONLY the JSON, no markdown fences.` });

      if (invoiceFile) {
        const buf = fs.readFileSync(invoiceFile.path);
        const mime = invoiceFile.mimetype.startsWith('image/') ? invoiceFile.mimetype : 'application/pdf';
        parts.push({ inline_data: { mime_type: mime, data: buf.toString('base64') } });
      }

      if (ewayBillFile) {
        const buf = fs.readFileSync(ewayBillFile.path);
        const mime = ewayBillFile.mimetype.startsWith('image/') ? ewayBillFile.mimetype : 'application/pdf';
        parts.push({ inline_data: { mime_type: mime, data: buf.toString('base64') } });
      }

      const geminiRes = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
        { contents: [{ parts }] },
        { timeout: 45000 }
      );

      const rawText = geminiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonStr = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      let extracted: Record<string, unknown> | null = null;
      try { extracted = JSON.parse(jsonStr); } catch { extracted = { raw: rawText }; }

      // Vendor matching — try GSTIN first, then name
      let matchedVendor: { id: string; name: string; gstin: string | null } | null = null;
      let matchedPOs: Array<{ id: string; poNo: number; grandTotal: number; status: string }> = [];

      if (extracted && typeof extracted === 'object') {
        const gstin = (extracted as Record<string, unknown>).vendor_gstin as string | null;
        const vendorName = (extracted as Record<string, unknown>).vendor_name as string | null;

        if (gstin && gstin.length >= 10) {
          matchedVendor = await prisma.vendor.findFirst({
            where: { gstin: { contains: gstin, mode: 'insensitive' } },
            select: { id: true, name: true, gstin: true },
          });
        }
        if (!matchedVendor && vendorName && vendorName.length > 2) {
          // Fuzzy name match — take first 3 words
          const words = vendorName.split(/\s+/).slice(0, 3).filter(w => w.length > 2);
          if (words.length > 0) {
            matchedVendor = await prisma.vendor.findFirst({
              where: { name: { contains: words[0], mode: 'insensitive' } },
              select: { id: true, name: true, gstin: true },
            });
          }
        }

        // If vendor found, get their pending POs
        if (matchedVendor) {
          matchedPOs = await prisma.purchaseOrder.findMany({
            where: {
              vendorId: matchedVendor.id,
              status: { in: ['SENT', 'APPROVED', 'PARTIAL_RECEIVED'] },
            },
            select: { id: true, poNo: true, grandTotal: true, status: true },
            orderBy: { poDate: 'desc' },
            take: 10,
          });
        }
      }

      res.json({
        invoiceFilePath,
        ewayBillFilePath,
        extracted,
        matchedVendor,
        matchedPOs,
      });


      // Fire-and-forget: generate vault notes for GRN docs
      setImmediate(() => {
        if (invoiceFilePath) {
          generateVaultNote({
            sourceType: 'GoodsReceipt',
            sourceId: `grn-invoice-${Date.now()}`,
            filePath: invoiceFilePath,
            title: 'GRN Invoice',
            category: 'OTHER',
          }).catch(err => console.error('[GRN] Vault note (invoice) failed:', err));
        }
        if (ewayBillFilePath) {
          generateVaultNote({
            sourceType: 'GoodsReceipt',
            sourceId: `grn-eway-${Date.now()}`,
            filePath: ewayBillFilePath,
            title: 'GRN E-Way Bill',
            category: 'COMPLIANCE',
          }).catch(err => console.error('[GRN] Vault note (e-way) failed:', err));
        }
      });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message || 'AI extraction failed';
      res.json({ invoiceFilePath, ewayBillFilePath, extracted: null, error: msg });
    }
  })
);

// POST / — create GRN against a PO
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body;

    // Get PO for validation
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: b.poId },
      include: { lines: true },
    });
    if (!po) return res.status(404).json({ error: 'PO not found' });

    // NF-8 FIX: Validate PO is in a receivable status
    const receivableStatuses = ['APPROVED', 'SENT', 'PARTIAL_RECEIVED'];
    if (!receivableStatuses.includes(po.status)) {
      return res.status(400).json({ error: `PO is ${po.status} — cannot receive against it` });
    }

    // NF-8 FIX: Validate all poLineId values belong to this PO
    const validLineIds = new Set(po.lines.map((l: any) => l.id));
    for (const line of (b.lines || [])) {
      if (line.poLineId && !validLineIds.has(line.poLineId)) {
        return res.status(400).json({ error: `PO line ${line.poLineId} does not belong to this PO` });
      }
    }

    // NF-4 FIX: Truck cap check moved inside $transaction (C2 race fix)

    // Process lines
    const processedLines = (b.lines || []).map((line: any) => {
      const receivedQty = parseFloat(line.receivedQty) || 0;
      const acceptedQty = parseFloat(line.acceptedQty) || 0;
      const rejectedQty = receivedQty - acceptedQty; // auto-calculate
      const rate = parseFloat(line.rate) || 0;
      const amount = acceptedQty * rate;

      const itemId = line.inventoryItemId || line.materialId || null;
      return {
        poLineId: line.poLineId || null,
        inventoryItemId: itemId,
        materialId: null,
        description: line.description || '',
        receivedQty,
        acceptedQty,
        rejectedQty: Math.max(0, rejectedQty),
        unit: line.unit || 'kg',
        rate,
        amount,
        storageLocation: line.storageLocation || '',
        warehouseCode: line.warehouseCode || '',
        batchNo: line.batchNo || '',
        remarks: line.remarks || '',
      };
    });

    // EX-2 FIX: Validate quantities before creating GRN
    for (const line of processedLines) {
      if (line.receivedQty < 0 || line.acceptedQty < 0) {
        return res.status(400).json({ error: 'Quantities cannot be negative' });
      }
      if (line.acceptedQty > line.receivedQty) {
        return res.status(400).json({
          error: `Accepted qty (${line.acceptedQty}) cannot exceed received qty (${line.receivedQty})`,
        });
      }
      if (line.poLineId) {
        const poLine = po.lines.find((l: any) => l.id === line.poLineId);
        if (poLine && poLine.pendingQty > 0) {
          // Allow 10% tolerance for weighbridge variance
          const tolerance = poLine.pendingQty * 1.1;
          if (line.acceptedQty > tolerance) {
            return res.status(400).json({
              error: `Accepted qty (${line.acceptedQty}) exceeds pending qty (${poLine.pendingQty}) + 10% tolerance`,
            });
          }
        }
      }
    }

    // Calculate totals
    const totalAmount = processedLines.reduce((sum: number, line: any) => sum + line.amount, 0);
    const totalQty = processedLines.reduce((sum: number, line: any) => sum + line.acceptedQty, 0);

    // Create GRN, update PO lines, and update PO status in a single transaction
    const { grn, poStatus } = await prisma.$transaction(async (tx) => {
      // C2 FIX: Truck cap check INSIDE transaction to prevent race condition
      if (po.truckCap) {
        const grnCount = await tx.goodsReceipt.count({ where: { poId: po.id, status: 'CONFIRMED' } });
        if (grnCount >= po.truckCap) {
          throw new ValidationError(`Truck cap (${po.truckCap}) reached for this deal`);
        }
      }

      // Step 1: Create GRN with lines
      const grn = await tx.goodsReceipt.create({
        data: {
          poId: b.poId,
          vendorId: po.vendorId,
          grnDate: b.grnDate ? new Date(b.grnDate) : new Date(),
          vehicleNo: b.vehicleNo || '',
          challanNo: b.challanNo || b.invoiceNo || '',
          challanDate: b.challanDate ? new Date(b.challanDate) : (b.invoiceDate ? new Date(b.invoiceDate) : null),
          invoiceNo: b.invoiceNo || b.challanNo || '',
          invoiceDate: b.invoiceDate ? new Date(b.invoiceDate) : (b.challanDate ? new Date(b.challanDate) : null),
          ewayBill: b.ewayBill || '',
          invoiceFilePath: b.invoiceFilePath || null,
          ewayBillFilePath: b.ewayBillFilePath || null,
          remarks: b.remarks || '',
          totalAmount,
          totalQty,
          status: 'DRAFT',
          userId: req.user!.id,
          companyId: getActiveCompanyId(req),
          lines: {
            create: processedLines,
          },
        },
        include: { lines: true },
      });

      // Step 2: Update PO lines — C1 FIX: atomic increment/decrement (no stale read)
      for (const line of processedLines) {
        if (line.poLineId) {
          await tx.pOLine.update({
            where: { id: line.poLineId },
            data: {
              receivedQty: { increment: line.acceptedQty },
              pendingQty: { decrement: line.acceptedQty },
            },
          });
        }
      }

      // Clamp any pendingQty that went negative (overage) back to 0
      await tx.pOLine.updateMany({
        where: { poId: b.poId, pendingQty: { lt: 0 } },
        data: { pendingQty: 0 },
      });

      // Step 3: Check and update PO status
      // Skip auto-close for OPEN deal POs (trader running POs) — they stay open until manually closed
      let poStatus = 'unchanged';
      const parentPO = await tx.purchaseOrder.findUnique({ where: { id: b.poId }, select: { dealType: true, truckCap: true } });

      if (parentPO?.truckCap) {
        // Truck-based PO: completion by GRN count, not by weight
        const grnCount = await tx.goodsReceipt.count({ where: { poId: b.poId, status: 'CONFIRMED' } });
        if (grnCount >= parentPO.truckCap) {
          await tx.purchaseOrder.update({ where: { id: b.poId }, data: { status: 'RECEIVED' } });
          poStatus = 'RECEIVED';
        } else {
          await tx.purchaseOrder.update({ where: { id: b.poId }, data: { status: 'PARTIAL_RECEIVED' } });
          poStatus = 'PARTIAL_RECEIVED';
        }
      } else if (parentPO?.dealType !== 'OPEN') {
        const updatedPoLines = await tx.pOLine.findMany({
          where: { poId: b.poId },
        });
        const allFullyReceived = updatedPoLines.every((line: any) => line.pendingQty === 0);
        const anyPartialReceived = updatedPoLines.some((line: any) => line.receivedQty > 0 && line.pendingQty > 0);

        if (allFullyReceived) {
          await tx.purchaseOrder.update({
            where: { id: b.poId },
            data: { status: 'RECEIVED' },
          });
          poStatus = 'RECEIVED';
        } else if (anyPartialReceived) {
          await tx.purchaseOrder.update({
            where: { id: b.poId },
            data: { status: 'PARTIAL_RECEIVED' },
          });
          poStatus = 'PARTIAL_RECEIVED';
        }
      }

      return { grn, poStatus };
    });

    // NOTE: Inventory sync only happens on CONFIRM, not on DRAFT creation.
    // DRAFT GRNs should not affect stock levels — they're unverified.

    // Link gate entry to GRN if gateEntryId provided
    if (b.gateEntryId) {
      try {
        await prisma.gateEntry.update({
          where: { id: b.gateEntryId },
          data: { grnId: grn.id },
        });
      } catch (_linkErr: unknown) {
        // Swallow — don't fail GRN creation if gate link fails
      }
    }

    res.status(201).json(grn);
}));

// PUT /:id/quality — update quality status
router.put('/:id/quality', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { qualityStatus, qualityRemarks, inspectedBy } = req.body;
    const grn = await prisma.goodsReceipt.update({
      where: { id: req.params.id },
      data: {
        qualityStatus,
        qualityRemarks,
        inspectedBy,
      },
      include: { lines: true },
    });
    res.json(grn);
}));

// POST /expected/:poId — create a draft "expected" GRN from an approved PO
// so receivers know in advance what's coming; actuals filled when material arrives.
router.post('/expected/:poId', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { expectedDate } = req.body as { expectedDate?: string };
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.poId },
      include: { lines: true },
    });
    if (!po) return res.status(404).json({ error: 'PO not found' });
    if (!['APPROVED', 'SENT', 'PARTIAL_RECEIVED'].includes(po.status)) {
      return res.status(400).json({ error: `PO must be APPROVED/SENT to create expected GRN (current: ${po.status})` });
    }

    // Prevent duplicate open expected GRN for same PO
    const existing = await prisma.goodsReceipt.findFirst({
      where: { poId: po.id, grnType: 'EXPECTED', status: 'DRAFT', archived: false },
    });
    if (existing) return res.status(400).json({ error: `Expected GRN already exists: GRN-${existing.grnNo}`, grnId: existing.id });

    const companyId = getActiveCompanyId(req);
    const grnNo = await nextDocNo('GoodsReceipt', 'grnNo', companyId);

    const grn = await prisma.goodsReceipt.create({
      data: {
        grnNo,
        poId: po.id,
        vendorId: po.vendorId,
        grnDate: new Date(),
        expectedDate: expectedDate ? new Date(expectedDate) : null,
        grnType: 'EXPECTED',
        status: 'DRAFT',
        qualityStatus: 'PENDING',
        userId: req.user!.id,
        companyId,
        totalQty: 0,
        totalAmount: 0,
        lines: {
          create: po.lines.map(l => ({
            poLineId: l.id,
            materialId: (l as any).materialId || null,
            inventoryItemId: (l as any).inventoryItemId || null,
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
      include: { lines: true },
    });
    res.status(201).json(grn);
}));

// POST /partial/:poId — create a PARTIAL GRN (paid, awaiting physical goods).
// Same shape as /expected but starts in PARTIAL status so it shows in the
// "Paid & Awaiting" tab on the receiving desk.
router.post('/partial/:poId', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { expectedDate } = req.body as { expectedDate?: string };
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: req.params.poId },
    include: { lines: true },
  });
  if (!po) return res.status(404).json({ error: 'PO not found' });
  if (!['APPROVED', 'SENT', 'PARTIAL_RECEIVED'].includes(po.status)) {
    return res.status(400).json({ error: `PO must be APPROVED/SENT to create partial GRN (current: ${po.status})` });
  }

  // Prevent duplicate open DRAFT/PARTIAL GRN
  const existing = await prisma.goodsReceipt.findFirst({
    where: { poId: po.id, status: { in: ['DRAFT', 'PARTIAL'] }, archived: false },
    select: { id: true, grnNo: true, status: true },
  });
  if (existing) {
    return res.status(400).json({
      error: `Open ${existing.status} GRN already exists: GRN-${existing.grnNo}`,
      grnId: existing.id,
    });
  }

  const companyId2 = getActiveCompanyId(req);
  const grnNo2 = await nextDocNo('GoodsReceipt', 'grnNo', companyId2);

  const grn = await prisma.goodsReceipt.create({
    data: {
      grnNo: grnNo2,
      poId: po.id,
      vendorId: po.vendorId,
      grnDate: new Date(),
      expectedDate: expectedDate ? new Date(expectedDate) : null,
      grnType: 'EXPECTED',
      status: 'PARTIAL',
      qualityStatus: 'PENDING',
      userId: req.user!.id,
      companyId: companyId2,
      totalQty: 0,
      totalAmount: 0,
      lines: {
        create: po.lines.map(l => ({
          poLineId: l.id,
          inventoryItemId: (l as any).inventoryItemId || null,
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
    include: { lines: true },
  });

  // Recompute paid flag immediately (in case payments already exist for this PO)
  const { recomputeGrnPaidStateForPO } = await import('../services/grnPaidState');
  await recomputeGrnPaidStateForPO(po.id).catch(() => {});

  res.status(201).json(grn);
}));

// PUT /:id/status — status transitions
router.put('/:id/status', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { newStatus } = req.body;
    const grn = await prisma.goodsReceipt.findUnique({
      where: { id: req.params.id },
    });
    if (!grn) return res.status(404).json({ error: 'GRN not found' });

    const validTransitions: Record<string, string[]> = {
      'DRAFT': ['PARTIAL', 'CONFIRMED', 'CANCELLED'],
      'PARTIAL': ['DRAFT', 'CONFIRMED', 'CANCELLED'],
      'CONFIRMED': [],
      'CANCELLED': [],
    };

    if (!validTransitions[grn.status] || !validTransitions[grn.status].includes(newStatus)) {
      return res.status(400).json({ error: `Invalid status transition from ${grn.status} to ${newStatus}` });
    }

    const updated = await prisma.goodsReceipt.update({
      where: { id: req.params.id },
      data: { status: newStatus },
      include: { lines: true },
    });

    // Sync inventory ONLY when transitioning to CONFIRMED (not on DRAFT create)
    if (newStatus === 'CONFIRMED') {
      try {
        await syncGrnToInventory(
          updated.id,
          updated.grnNo,
          updated.lines.map((l: any) => ({
            inventoryItemId: l.inventoryItemId || l.materialId,
            acceptedQty: l.acceptedQty,
            rate: l.rate,
            unit: l.unit,
            batchNo: l.batchNo || '',
            storageLocation: l.storageLocation || '',
          })),
          null,
          req.user!.id,
          updated.companyId,
        );
      } catch (syncErr: unknown) {
        // Step 6 fix: Revert GRN to DRAFT if inventory sync fails — don't leave orphaned CONFIRMED with no stock
        console.error(`[GRN] Inventory sync failed on confirm for GRN-${updated.grnNo}: ${syncErr}`);
        await prisma.goodsReceipt.update({ where: { id: updated.id }, data: { status: 'DRAFT' } });
        return res.status(500).json({ error: `GRN confirmed but inventory sync failed. Reverted to DRAFT. Error: ${syncErr instanceof Error ? syncErr.message : 'Unknown'}` });
      }

      // Close the loop back to the originating indent (if any). Fire-and-forget —
      // never block GRN confirm on notification or PR status update.
      syncRequisitionAfterGrnConfirm(updated.id).catch(() => {});
    }

    res.json(updated);
}));

// DELETE /:id — delete GRN (DRAFT only), reverse stock and PO line updates
router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const grn = await prisma.goodsReceipt.findUnique({
      where: { id: req.params.id },
      include: { lines: true },
    });
    if (!grn) return res.status(404).json({ error: 'GRN not found' });
    if (grn.status !== 'DRAFT') {
      return res.status(400).json({ error: 'Can only delete GRN in DRAFT status' });
    }

    // EX-4 FIX: Block delete if stock movements exist (legacy data safety guard)
    const movementCount = await prisma.stockMovement.count({
      where: { refType: 'GRN', refId: grn.id },
    });
    if (movementCount > 0) {
      return res.status(409).json({
        error: 'Cannot delete GRN with stock movements. Cancel the GRN instead, or contact admin.',
        movementCount,
      });
    }

    // Reverse PO line, inventory, and stock updates atomically
    await prisma.$transaction(async (tx) => {
      for (const line of grn.lines) {
        if (line.poLineId) {
          const poLine = await tx.pOLine.findUnique({ where: { id: line.poLineId } });
          if (poLine) {
            const newReceivedQty = Math.max(0, poLine.receivedQty - line.acceptedQty);
            await tx.pOLine.update({
              where: { id: line.poLineId },
              data: {
                receivedQty: newReceivedQty,
                pendingQty: poLine.quantity - newReceivedQty,
              },
            });

            // Recalculate PO status from actual line state (skip OPEN deals — trader running POs)
            const parentPOForReverse = await tx.purchaseOrder.findUnique({ where: { id: grn.poId! }, select: { dealType: true } });
            if (parentPOForReverse?.dealType !== 'OPEN') {
              const allLines = await tx.pOLine.findMany({ where: { poId: grn.poId! } });
              const anyReceived = allLines.some((l: any) => l.receivedQty > 0 || (l.id === line.poLineId && newReceivedQty > 0));
              if (!anyReceived) {
                await tx.purchaseOrder.update({
                  where: { id: grn.poId! },
                  data: { status: 'APPROVED' },
                });
              } else {
                const allDone = allLines.every((l: any) => l.pendingQty <= 0);
                await tx.purchaseOrder.update({
                  where: { id: grn.poId! },
                  data: { status: allDone ? 'RECEIVED' : 'PARTIAL_RECEIVED' },
                });
              }
            }
          }
        }

        // Reverse InventoryItem stock if linked (only if GRN was CONFIRMED — DRAFT never synced)
        // For DRAFT GRNs, inventory was never touched, so nothing to reverse.
        // We still delete stock movements just in case (defensive).
        const itemId = line.inventoryItemId || line.materialId;
        if (itemId) {
          // Delete GRN-related stock movements
          const deletedMovements = await tx.stockMovement.findMany({
            where: { refType: 'GRN', refId: grn.id, itemId },
            select: { id: true, quantity: true, direction: true },
          });

          if (deletedMovements.length > 0) {
            // Reverse the stock effect of each movement
            for (const mv of deletedMovements) {
              const reverseQty = mv.direction === 'IN' ? -mv.quantity : mv.quantity;
              await tx.inventoryItem.update({
                where: { id: itemId },
                data: { currentStock: { increment: reverseQty } },
              });
              const sl = await tx.stockLevel.findFirst({ where: { itemId } });
              if (sl) await tx.stockLevel.update({ where: { id: sl.id }, data: { quantity: { increment: reverseQty } } });
            }

            // Recalculate totalValue
            const updatedItem = await tx.inventoryItem.findUnique({ where: { id: itemId }, select: { currentStock: true, avgCost: true } });
            if (updatedItem) {
              const safeStock = Math.max(0, updatedItem.currentStock);
              await tx.inventoryItem.update({
                where: { id: itemId },
                data: { currentStock: safeStock, totalValue: Math.round(safeStock * updatedItem.avgCost * 100) / 100 },
              });
            }

            await tx.stockMovement.deleteMany({ where: { refType: 'GRN', refId: grn.id, itemId } });
          }
        }
      }

      await tx.goodsReceipt.delete({ where: { id: req.params.id } });
    });

    res.json({ ok: true });
}));

// PUT /:id/archive — archive a GRN
router.put('/:id/archive', asyncHandler(async (req: AuthRequest, res: Response) => {
    const archived = req.body.archived !== false;
    await prisma.goodsReceipt.update({ where: { id: req.params.id }, data: { archived } });
    res.json({ ok: true, archived });
}));

// ═══════════════════════════════════════════════
// GET /:id/pdf — Generate GRN PDF (uses Handlebars + Puppeteer template system)
// ═══════════════════════════════════════════════
router.get('/:id/pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
    const grn = await prisma.goodsReceipt.findUnique({
      where: { id: req.params.id },
      include: { po: true, vendor: true, lines: true },
    });
    if (!grn) { res.status(404).json({ error: 'GRN not found' }); return; }

    const { renderDocumentPdf } = await import('../services/documentRenderer');

    const grnData = {
      grnNo: grn.grnNo,
      grnDate: grn.grnDate,
      poRef: `PO-${String((grn.po as any).poNo).padStart(4, '0')}`,
      status: grn.status,
      vehicleNo: grn.vehicleNo,
      invoiceNo: grn.invoiceNo,
      invoiceDate: (grn as any).invoiceDate,
      ewayBill: grn.ewayBill,
      challanNo: grn.challanNo,
      qualityStatus: (grn as any).qualityStatus,
      qualityRemarks: (grn as any).qualityRemarks,
      inspectedBy: (grn as any).inspectedBy,
      remarks: grn.remarks,
      vendor: grn.vendor,
      lines: (grn.lines as any[]).map((l: any) => ({
        description: l.description || '',
        unit: l.unit || '',
        receivedQty: l.receivedQty || 0,
        acceptedQty: l.acceptedQty || 0,
        rejectedQty: l.rejectedQty || 0,
        rate: l.rate || 0,
        amount: (l.acceptedQty || 0) * (l.rate || 0),
        batchNo: l.batchNo || '',
      })),
      totalQty: (grn as any).totalQty || (grn.lines as any[]).reduce((s: number, l: any) => s + (l.receivedQty || 0), 0),
      totalAccepted: (grn.lines as any[]).reduce((s: number, l: any) => s + (l.acceptedQty || 0), 0),
      totalRejected: (grn.lines as any[]).reduce((s: number, l: any) => s + (l.rejectedQty || 0), 0),
      totalAmount: grn.totalAmount || 0,
      receivedBy: 'Store Department',
      authorizedSignatory: 'OP Pandey — Unit Head',
    };

    (grnData as any).company = await getCompanyForPdf(grn.companyId);

    const pdfBuffer = await renderDocumentPdf({
      docType: 'GOODS_RECEIPT',
      data: grnData,
      verifyId: grn.id,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="GRN-${grn.grnNo}.pdf"`);
    res.send(pdfBuffer);
}));

export default router;
