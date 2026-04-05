import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import PDFDocument from 'pdfkit';
import { sendEmail } from '../services/messaging';
import { drawLetterhead } from '../utils/letterhead';
import { renderDocumentPdf } from '../services/documentRenderer';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
// RAG indexing removed — only compliance docs go to RAG
import { generateVaultNote } from '../services/vaultWriter';

const router = Router();
router.use(authenticate as any);

// ── Multer for vendor invoice uploads ──
const uploadDir = path.join(__dirname, '../../uploads/vendor-invoices');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ═══════════════════════════════════════════════
// POST /upload-extract — Upload invoice file + AI extraction
// ═══════════════════════════════════════════════
router.post('/upload-extract', upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

  const filePath = `vendor-invoices/${req.file.filename}`;
  const fileBuffer = fs.readFileSync(req.file.path);
  const mimeType = req.file.mimetype;

  // For PDFs, we send as application/pdf to Gemini (it supports PDF natively)
  // For images, send as image/*
  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) {
    res.json({ filePath, extracted: null, error: 'AI extraction not configured (no GEMINI_API_KEY)' });
    return;
  }

  try {
    const base64 = fileBuffer.toString('base64');
    const prompt = `Extract these fields from this vendor/supplier invoice document. Return ONLY valid JSON with these keys:
{
  "invoice_number": "string - the vendor's invoice/bill number",
  "invoice_date": "string - date in YYYY-MM-DD format",
  "vendor_name": "string - supplier/vendor name",
  "gstin": "string - vendor GSTIN if visible",
  "items": [{"description": "string", "hsn": "string", "qty": number, "unit": "string", "rate": number, "amount": number}],
  "taxable_amount": number,
  "cgst": number,
  "sgst": number,
  "igst": number,
  "total_gst": number,
  "freight": number,
  "total_amount": number,
  "supply_type": "INTRA_STATE or INTER_STATE based on CGST/SGST vs IGST"
}
If a field is not found, use null for strings and 0 for numbers. Return ONLY the JSON, no markdown.`;

    const geminiRes = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType.startsWith('image/') ? mimeType : 'application/pdf', data: base64 } },
          ],
        }],
      },
      { timeout: 45000 }
    );

    const rawText = geminiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    // Parse JSON from response (strip markdown fences if present)
    const jsonStr = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    let extracted = null;
    try { extracted = JSON.parse(jsonStr); } catch { extracted = { raw: rawText }; }

    res.json({ filePath, extracted });


    // Fire-and-forget: generate vault note
    setImmediate(() => {
      generateVaultNote({
        sourceType: 'VendorInvoice',
        sourceId: filePath,
        filePath,
        title: req.file?.originalname || 'Vendor Invoice',
        category: 'OTHER',
        mimeType: req.file?.mimetype,
      }).catch(err => console.error('[VendorInvoice] Vault note failed:', err));
    });
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message || 'AI extraction failed';
    res.json({ filePath, extracted: null, error: msg });
  }
}));

// GET / — list with filters (vendorId, status)
router.get('/', async (req: Request, res: Response) => {
  try {
    const vendorId = req.query.vendorId as string | undefined;
    const status = req.query.status as string | undefined;

    const where: any = {};
    if (vendorId) where.vendorId = vendorId;
    if (status) where.status = status;

    const invoices = await prisma.vendorInvoice.findMany({
      where,
      include: {
        vendor: true,
        po: true,
        grn: true,
      },
      orderBy: { invoiceDate: 'desc' },
    });

    res.json({ invoices });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /outstanding — outstanding vendor invoices grouped by vendor
router.get('/outstanding', async (req: Request, res: Response) => {
  try {
    const invoices = await prisma.vendorInvoice.findMany({
      where: {
        balanceAmount: {
          gt: 0,
        },
      },
      include: {
        vendor: true,
      },
    });

    // Group by vendor
    const grouped: Record<string, any> = {};
    for (const inv of invoices) {
      const vendorId = inv.vendorId;
      if (!grouped[vendorId]) {
        grouped[vendorId] = {
          vendor: inv.vendor,
          invoices: [],
          totalOutstanding: 0,
        };
      }
      grouped[vendorId].invoices.push(inv);
      grouped[vendorId].totalOutstanding += inv.balanceAmount || 0;
    }

    res.json({ outstanding: Object.values(grouped) });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /itc-report — ITC report
router.get('/itc-report', async (req: Request, res: Response) => {
  try {
    const invoices = await prisma.vendorInvoice.findMany({
      where: {
        status: { in: ['VERIFIED', 'APPROVED', 'PAID'] },
      },
      include: {
        vendor: true,
      },
      orderBy: { invoiceDate: 'desc' },
    });

    const report = invoices.map((inv: any) => ({
      ...inv,
      calcCgst: (inv.subtotal || 0) * ((inv.gstPercent || 0) / 2 / 100),
      calcSgst: (inv.subtotal || 0) * ((inv.gstPercent || 0) / 2 / 100),
      calcIgst: (inv.subtotal || 0) * ((inv.gstPercent || 0) / 100),
      itcEligible: inv.isRCM === false,
    }));

    res.json({ report });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /:id — single with vendor, po, grn, payments
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const invoice = await prisma.vendorInvoice.findUnique({
      where: { id: req.params.id },
      include: {
        vendor: true,
        po: true,
        grn: true,
        payments: true,
      },
    });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json(invoice);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST / — create vendor invoice
router.post('/', async (req: Request, res: Response) => {
  try {
    const b = req.body;

    const quantity = parseFloat(b.quantity) || 0;
    const rate = parseFloat(b.rate) || 0;
    const gstPercent = parseFloat(b.gstPercent) || 0;
    const freightCharge = parseFloat(b.freightCharge) || 0;
    const loadingCharge = parseFloat(b.loadingCharge) || 0;
    const otherCharges = parseFloat(b.otherCharges) || 0;
    const roundOff = parseFloat(b.roundOff) || 0;
    const tdsPercent = parseFloat(b.tdsPercent) || 0;

    const subtotal = quantity * rate;

    let cgstAmount = 0, sgstAmount = 0, igstAmount = 0;
    if (b.supplyType === 'INTRA_STATE') {
      cgstAmount = subtotal * ((gstPercent / 2) / 100);
      sgstAmount = subtotal * ((gstPercent / 2) / 100);
    } else if (b.supplyType === 'INTER_STATE') {
      igstAmount = subtotal * (gstPercent / 100);
    }

    const totalGst = cgstAmount + sgstAmount + igstAmount;
    let rcmCgst = 0, rcmSgst = 0, rcmIgst = 0;

    if (b.isRCM) {
      rcmCgst = cgstAmount;
      rcmSgst = sgstAmount;
      rcmIgst = igstAmount;
    }

    const totalAmount = subtotal + totalGst + freightCharge + loadingCharge + otherCharges + roundOff;
    const tdsAmount = subtotal * (tdsPercent / 100);
    const netPayable = totalAmount - tdsAmount;
    const balanceAmount = netPayable;

    // 3-way match — compare invoice qty against GRN accepted qty (not PO ordered qty,
    // because open/truck fuel deals use qty=999999 as placeholder)
    let matchStatus = 'UNMATCHED';
    if (b.poId && b.grnId) {
      const grn = await prisma.goodsReceipt.findUnique({
        where: { id: b.grnId },
        include: { lines: true },
      });

      if (grn) {
        // Step 9 fix: require confirmed GRN for matching
        if (grn.status !== 'CONFIRMED') {
          matchStatus = 'MISMATCH'; // GRN not yet confirmed
        } else {
          const grnQty = grn.lines.reduce((sum, line) => sum + line.acceptedQty, 0);
          // Match invoice qty against GRN qty (10% tolerance for rounding)
          if (Math.abs(grnQty - quantity) / Math.max(grnQty, 0.01) < 0.1) {
            matchStatus = 'MATCHED';
          } else {
            matchStatus = 'MISMATCH';
          }
        }
      }
    }

    const invoice = await prisma.vendorInvoice.create({
      data: {
        vendorId: b.vendorId,
        poId: b.poId || null,
        grnId: b.grnId || null,
        vendorInvNo: b.vendorInvNo || '',
        vendorInvDate: b.vendorInvDate ? new Date(b.vendorInvDate) : new Date(),
        invoiceDate: b.invoiceDate ? new Date(b.invoiceDate) : new Date(),
        dueDate: b.dueDate ? new Date(b.dueDate) : null,
        productName: b.productName || '',
        quantity,
        unit: b.unit || 'kg',
        rate,
        supplyType: b.supplyType || 'INTRA_STATE',
        gstPercent,
        isRCM: b.isRCM || false,
        cgstAmount,
        sgstAmount,
        igstAmount,
        totalGst,
        rcmCgst,
        rcmSgst,
        rcmIgst,
        itcEligible: b.isRCM === false,
        subtotal,
        freightCharge,
        loadingCharge,
        otherCharges,
        roundOff,
        totalAmount,
        tdsSection: b.tdsSection || null,
        tdsPercent,
        tdsAmount,
        netPayable,
        paidAmount: 0,
        balanceAmount,
        matchStatus,
        status: b.status || 'PENDING',
        filePath: b.filePath || null,
        remarks: b.remarks || null,
        userId: (req as any).user.id,
      },
    });

    res.status(201).json(invoice);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /:id — edit vendor invoice (only PENDING status)
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const existing = await prisma.vendorInvoice.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });
    if (existing.status !== 'PENDING') {
      return res.status(400).json({ error: 'Can only edit invoices in PENDING status' });
    }

    const b = req.body;
    const quantity = b.quantity !== undefined ? parseFloat(b.quantity) : existing.quantity;
    const rate = b.rate !== undefined ? parseFloat(b.rate) : existing.rate;
    const gstPercent = b.gstPercent !== undefined ? parseFloat(b.gstPercent) : existing.gstPercent;
    const freightCharge = b.freightCharge !== undefined ? parseFloat(b.freightCharge) : existing.freightCharge;
    const loadingCharge = b.loadingCharge !== undefined ? parseFloat(b.loadingCharge) : existing.loadingCharge;
    const otherCharges = b.otherCharges !== undefined ? parseFloat(b.otherCharges) : existing.otherCharges;
    const roundOff = b.roundOff !== undefined ? parseFloat(b.roundOff) : existing.roundOff;
    const tdsPercent = b.tdsPercent !== undefined ? parseFloat(b.tdsPercent) : existing.tdsPercent;
    const supplyType = b.supplyType || existing.supplyType;

    const subtotal = quantity * rate;
    let cgstAmount = 0, sgstAmount = 0, igstAmount = 0;
    if (supplyType === 'INTRA_STATE') {
      cgstAmount = subtotal * ((gstPercent / 2) / 100);
      sgstAmount = subtotal * ((gstPercent / 2) / 100);
    } else {
      igstAmount = subtotal * (gstPercent / 100);
    }
    const totalGst = cgstAmount + sgstAmount + igstAmount;
    const isRCM = b.isRCM !== undefined ? b.isRCM : existing.isRCM;
    const totalAmount = subtotal + totalGst + freightCharge + loadingCharge + otherCharges + roundOff;
    const tdsAmount = subtotal * (tdsPercent / 100);
    const netPayable = totalAmount - tdsAmount;
    const balanceAmount = netPayable - (existing.paidAmount || 0);

    const invoice = await prisma.vendorInvoice.update({
      where: { id: req.params.id },
      data: {
        vendorInvNo: b.vendorInvNo ?? existing.vendorInvNo,
        vendorInvDate: b.vendorInvDate ? new Date(b.vendorInvDate) : existing.vendorInvDate,
        invoiceDate: b.invoiceDate ? new Date(b.invoiceDate) : existing.invoiceDate,
        dueDate: b.dueDate ? new Date(b.dueDate) : existing.dueDate,
        productName: b.productName ?? existing.productName,
        quantity, unit: b.unit || existing.unit, rate, subtotal,
        supplyType, gstPercent, isRCM,
        cgstAmount, sgstAmount, igstAmount, totalGst,
        rcmCgst: isRCM ? cgstAmount : 0, rcmSgst: isRCM ? sgstAmount : 0, rcmIgst: isRCM ? igstAmount : 0,
        freightCharge, loadingCharge, otherCharges, roundOff,
        totalAmount, tdsSection: b.tdsSection ?? existing.tdsSection,
        tdsPercent, tdsAmount, netPayable, balanceAmount: Math.max(0, balanceAmount),
        remarks: b.remarks ?? existing.remarks,
        poId: b.poId !== undefined ? (b.poId || null) : existing.poId,
        grnId: b.grnId !== undefined ? (b.grnId || null) : existing.grnId,
      },
    });
    res.json(invoice);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /:id/status — status transitions
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const { newStatus } = req.body;
    const invoice = await prisma.vendorInvoice.findUnique({
      where: { id: req.params.id },
    });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const validTransitions: Record<string, string[]> = {
      'PENDING': ['VERIFIED', 'CANCELLED'],
      'VERIFIED': ['APPROVED', 'CANCELLED'],
      'APPROVED': ['PAID', 'CANCELLED'],
      'PAID': [],
      'CANCELLED': [],
    };

    if (!validTransitions[invoice.status] || !validTransitions[invoice.status].includes(newStatus)) {
      return res.status(400).json({ error: `Invalid status transition from ${invoice.status} to ${newStatus}` });
    }

    const updated = await prisma.vendorInvoice.update({
      where: { id: req.params.id },
      data: { status: newStatus },
    });

    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /:id/itc — update ITC status
router.put('/:id/itc', async (req: Request, res: Response) => {
  try {
    const { itcClaimed, itcClaimedDate, itcReversed, itcReversalReason } = req.body;
    const invoice = await prisma.vendorInvoice.update({
      where: { id: req.params.id },
      data: {
        itcClaimed,
        itcClaimedDate: itcClaimedDate ? new Date(itcClaimedDate) : undefined,
        itcReversed,
        itcReversalReason,
      },
    });
    res.json(invoice);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /:id/pdf — Generate Vendor Invoice PDF
router.get('/:id/pdf', async (req: Request, res: Response) => {
  try {
    const inv = await prisma.vendorInvoice.findUnique({
      where: { id: req.params.id },
      include: { vendor: true },
    });
    if (!inv) { res.status(404).json({ error: 'Vendor invoice not found' }); return; }

    const viData = {
      invoiceNo: inv.invoiceNo,
      vendorInvNo: inv.vendorInvNo,
      invoiceDate: inv.invoiceDate,
      status: inv.status,
      vendor: {
        name: (inv as any).vendor?.name,
        gstin: (inv as any).vendor?.gstin,
      },
      productName: inv.productName,
      quantity: inv.quantity,
      unit: inv.unit,
      rate: inv.rate,
      gstPercent: inv.gstPercent,
      subtotal: inv.subtotal,
      totalGst: inv.totalGst,
      netPayable: inv.netPayable,
    };

    const pdfBuffer = await renderDocumentPdf({ docType: 'VENDOR_INVOICE', data: viData, verifyId: inv.id });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="VI-${inv.invoiceNo || inv.id.slice(0, 8)}.pdf"`);
    res.send(pdfBuffer);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /:id/send-email — Send Vendor Invoice via email
router.post('/:id/send-email', async (req: Request, res: Response) => {
  try {
    const inv = await prisma.vendorInvoice.findUnique({
      where: { id: req.params.id },
      include: { vendor: true },
    });
    if (!inv) { res.status(404).json({ error: 'Vendor invoice not found' }); return; }

    const toEmail = req.body.to || (inv as any).vendor?.email;
    if (!toEmail) { res.status(400).json({ error: 'No email address. Add vendor email or provide "to" in request.' }); return; }

    // Generate PDF buffer
    const viData = {
      invoiceNo: inv.invoiceNo,
      vendorInvNo: inv.vendorInvNo,
      invoiceDate: inv.invoiceDate,
      status: inv.status,
      vendor: {
        name: (inv as any).vendor?.name,
        gstin: (inv as any).vendor?.gstin,
      },
      productName: inv.productName,
      quantity: inv.quantity,
      unit: inv.unit,
      rate: inv.rate,
      gstPercent: inv.gstPercent,
      subtotal: inv.subtotal,
      totalGst: inv.totalGst,
      netPayable: inv.netPayable,
    };
    const pdfBuffer = await renderDocumentPdf({ docType: 'VENDOR_INVOICE', data: viData, verifyId: inv.id });

    const label = `VI-${String(inv.invoiceNo).padStart(4, '0')}`;
    const subject = req.body.subject || `${label} — Vendor Invoice from MSPIL`;
    const body = req.body.body || `Dear ${(inv as any).vendor?.name || 'Vendor'},\n\nPlease find attached vendor invoice ${label}.\n\nRegards,\nMSPIL Distillery`;

    const result = await sendEmail({
      to: toEmail, subject, text: body,
      attachments: [{ filename: `${label}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }],
    });

    if (result.success) {
      res.json({ ok: true, messageId: result.messageId, sentTo: toEmail });
    } else {
      res.status(500).json({ error: result.error || 'Email send failed' });
    }
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
