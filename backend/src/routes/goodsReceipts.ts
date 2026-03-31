import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { onStockMovement } from '../services/autoJournal';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import axios from 'axios';

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
  userId: string
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

    const invItem = await prisma.inventoryItem.findUnique({
      where: { id: itemId },
      select: { id: true, name: true, unit: true, currentStock: true, avgCost: true },
    });
    if (!invItem) continue;

    const qty = line.acceptedQty;
    const costRate = line.rate;
    const totalValue = Math.round(qty * costRate * 100) / 100;

    await prisma.$transaction(async (tx) => {
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
      }).catch(() => {});
    });
  }
}

// GET / — list GRNs with filters (poId, vendorId, status)
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const poId = req.query.poId as string | undefined;
    const vendorId = req.query.vendorId as string | undefined;
    const status = req.query.status as string | undefined;

    const archived = req.query.archived === 'true';
    const where: any = { archived };
    if (poId) where.poId = poId;
    if (vendorId) where.vendorId = vendorId;
    if (status) where.status = status;

    const grns = await prisma.goodsReceipt.findMany({
      where,
      include: {
        po: { select: { id: true, poNo: true, status: true } },
        vendor: { select: { id: true, name: true, email: true } },
        lines: true,
      },
      orderBy: { grnDate: 'desc' },
      take: 200,
    });

    res.json({ grns });
}));

// GET /pending-pos — list POs with pending quantities
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
          where: {
            pendingQty: {
              gt: 0,
            },
          },
        },
      },
      take: 200,
    });

    const filtered = pos.filter(po => po.lines.length > 0);
    res.json({ pos: filtered });
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

    // Calculate totals
    const totalAmount = processedLines.reduce((sum: number, line: any) => sum + line.amount, 0);
    const totalQty = processedLines.reduce((sum: number, line: any) => sum + line.acceptedQty, 0);

    // Create GRN, update PO lines, and update PO status in a single transaction
    const { grn, poStatus } = await prisma.$transaction(async (tx) => {
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
          lines: {
            create: processedLines,
          },
        },
        include: { lines: true },
      });

      // Step 2: Update PO lines
      for (const line of processedLines) {
        if (line.poLineId) {
          const poLine = await tx.pOLine.findUnique({
            where: { id: line.poLineId },
          });
          if (poLine) {
            const newReceivedQty = poLine.receivedQty + line.acceptedQty;
            const newPendingQty = poLine.quantity - newReceivedQty;

            await tx.pOLine.update({
              where: { id: line.poLineId },
              data: {
                receivedQty: newReceivedQty,
                pendingQty: newPendingQty,
              },
            });
          }
        }
      }

      // Step 3: Check and update PO status
      let poStatus = 'unchanged';
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

      return { grn, poStatus };
    });

    // Sync to inventory outside transaction (has its own error handling)
    try {
      await syncGrnToInventory(
        grn.id,
        grn.grnNo,
        processedLines,
        b.warehouseId || null,
        req.user!.id
      );
    } catch (_syncErr: unknown) {
      // Swallow — don't fail the GRN creation
    }

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

// PUT /:id/status — status transitions
router.put('/:id/status', asyncHandler(async (req: AuthRequest, res: Response) => {
    const { newStatus } = req.body;
    const grn = await prisma.goodsReceipt.findUnique({
      where: { id: req.params.id },
    });
    if (!grn) return res.status(404).json({ error: 'GRN not found' });

    const validTransitions: Record<string, string[]> = {
      'DRAFT': ['CONFIRMED', 'CANCELLED'],
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

    // Reverse PO line and material stock updates
    for (const line of grn.lines) {
      if (line.poLineId) {
        const poLine = await prisma.pOLine.findUnique({ where: { id: line.poLineId } });
        if (poLine) {
          await prisma.pOLine.update({
            where: { id: line.poLineId },
            data: {
              receivedQty: Math.max(0, poLine.receivedQty - line.acceptedQty),
              pendingQty: poLine.quantity - Math.max(0, poLine.receivedQty - line.acceptedQty),
            },
          });
        }
      }
      // Reverse InventoryItem stock if linked
      const itemId = line.inventoryItemId || line.materialId;
      if (itemId) {
        const invItem = await prisma.inventoryItem.findUnique({ where: { id: itemId }, select: { id: true, currentStock: true, avgCost: true } });
        if (invItem) {
          const newStock = Math.max(0, invItem.currentStock - line.acceptedQty);
          await prisma.inventoryItem.update({
            where: { id: itemId },
            data: { currentStock: newStock, totalValue: Math.round(newStock * invItem.avgCost * 100) / 100 },
          });
          // Reverse StockLevel
          const sl = await prisma.stockLevel.findFirst({ where: { itemId } });
          if (sl) await prisma.stockLevel.update({ where: { id: sl.id }, data: { quantity: Math.max(0, sl.quantity - line.acceptedQty) } });
          // Delete associated stock movements
          await prisma.stockMovement.deleteMany({ where: { refType: 'GRN', refId: grn.id, itemId } });
        }
      }
    }

    await prisma.goodsReceipt.delete({ where: { id: req.params.id } });
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
