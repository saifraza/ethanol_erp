/**
 * Universal Document Classifier
 *
 * Single endpoint that accepts ANY document, asks Gemini to classify it
 * (vendor invoice / GRN / PO / bank receipt / contractor bill / other),
 * then runs the relevant extractor.
 *
 * Currently supported deeply: VENDOR_INVOICE
 * Other types return classification + raw text only (handlers TBD).
 */
import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import axios from 'axios';

const router = Router();
router.use(authenticate as any);

// Smart Upload touches vendor/invoice data via AI — gate to same roles as chat
const DEFAULT_ALLOWED = ['ADMIN', 'SUPER_ADMIN', 'OWNER', 'ACCOUNTS_MANAGER', 'FINANCE', 'PROCUREMENT_MANAGER'];
const ALLOWED_ROLES = (process.env.AI_ALLOWED_ROLES || DEFAULT_ALLOWED.join(','))
  .split(',')
  .map(r => r.trim().toUpperCase())
  .filter(Boolean);

router.use((req: any, res, next) => {
  const role = (req.user?.role || '').toUpperCase();
  if (!ALLOWED_ROLES.includes(role)) {
    res.status(403).json({ error: `AI Smart Upload restricted. Your role: ${role || 'NONE'}` });
    return;
  }
  next();
});

// Reuse the same upload dir layout as vendorInvoices for consistency
const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'document-classifier');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

type DocType =
  | 'VENDOR_INVOICE'
  | 'CONTRACTOR_BILL'
  | 'PURCHASE_ORDER'
  | 'GRN'
  | 'BANK_RECEIPT'
  | 'BANK_STATEMENT'
  | 'OTHER';

const SUPPORTED_TYPES: DocType[] = ['VENDOR_INVOICE'];

interface ClassifyResult {
  docType: DocType;
  confidence: number;
  reason: string;
  extracted: any;
}

async function classifyAndExtract(buffer: Buffer, mimeType: string): Promise<ClassifyResult> {
  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY not configured');

  const base64 = buffer.toString('base64');
  const prompt = `You are a document classifier and extractor for an Indian distillery ERP.

STEP 1 — Classify the document. Pick exactly one of:
- VENDOR_INVOICE   (a vendor/supplier tax invoice with HSN, GST, items)
- CONTRACTOR_BILL  (a labor contractor bill — service description, manhours/days)
- PURCHASE_ORDER   (a purchase order issued BY us TO a vendor)
- GRN              (goods receipt note — material received with weighbridge/qty)
- BANK_RECEIPT     (a bank's payment confirmation — UTR, NEFT/RTGS receipt)
- BANK_STATEMENT   (a multi-row bank account statement)
- OTHER            (anything else — letters, certificates, IDs, etc.)

STEP 2 — If VENDOR_INVOICE, extract these fields. Otherwise just classify.

Return ONLY valid JSON, no markdown, in this exact shape:
{
  "docType": "VENDOR_INVOICE" | "CONTRACTOR_BILL" | "PURCHASE_ORDER" | "GRN" | "BANK_RECEIPT" | "BANK_STATEMENT" | "OTHER",
  "confidence": 0-100,
  "reason": "one short sentence explaining the classification",
  "extracted": {
    "invoice_number": "string|null",
    "invoice_date": "YYYY-MM-DD|null",
    "vendor_name": "string|null",
    "vendor_gstin": "string|null - 15-char GSTIN if visible",
    "vendor_pan": "string|null - 10-char PAN if visible",
    "buyer_gstin": "string|null - GSTIN of buyer (us)",
    "po_reference": "string|null - PO number referenced on invoice",
    "items": [{"description":"string","hsn":"string|null","qty":number,"unit":"string|null","rate":number,"amount":number}],
    "taxable_amount": number,
    "cgst": number,
    "sgst": number,
    "igst": number,
    "total_gst": number,
    "freight": number,
    "total_amount": number,
    "supply_type": "INTRA_STATE" | "INTER_STATE",
    "tcs_amount": number,
    "tds_section": "string|null - if TDS deducted on the invoice"
  }
}

If the doc is NOT a VENDOR_INVOICE, return "extracted": {} (empty object).
For VENDOR_INVOICE: if a field is not visible, use null for strings and 0 for numbers.`;

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
    { timeout: 60000 }
  );

  const rawText = geminiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const jsonStr = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  let parsed: ClassifyResult;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return { docType: 'OTHER', confidence: 0, reason: 'Could not parse AI response', extracted: { raw: rawText } };
  }

  const validTypes: DocType[] = ['VENDOR_INVOICE', 'CONTRACTOR_BILL', 'PURCHASE_ORDER', 'GRN', 'BANK_RECEIPT', 'BANK_STATEMENT', 'OTHER'];
  if (!validTypes.includes(parsed.docType)) parsed.docType = 'OTHER';
  parsed.confidence = Math.max(0, Math.min(100, parsed.confidence || 0));
  return parsed;
}

async function matchVendorInvoice(extracted: any) {
  if (!extracted) return { matchedVendor: null, matchedInvoices: [], suggestedAction: 'NO_VENDOR' as const };

  const gstin = (extracted.vendor_gstin || '').trim();
  const pan = (extracted.vendor_pan || '').trim();
  const name = (extracted.vendor_name || '').trim();

  let vendor = null;
  if (gstin && gstin.length === 15) {
    vendor = await prisma.vendor.findFirst({
      where: { gstin: { equals: gstin, mode: 'insensitive' } },
      select: { id: true, name: true, gstin: true, pan: true, tdsApplicable: true, tdsSection: true },
    });
  }
  if (!vendor && pan && pan.length === 10) {
    vendor = await prisma.vendor.findFirst({
      where: { pan: { equals: pan, mode: 'insensitive' } },
      select: { id: true, name: true, gstin: true, pan: true, tdsApplicable: true, tdsSection: true },
    });
  }
  if (!vendor && name && name.length > 2) {
    const candidates = await prisma.vendor.findMany({
      where: { name: { contains: name.split(/\s+/)[0], mode: 'insensitive' } },
      select: { id: true, name: true, gstin: true, pan: true, tdsApplicable: true, tdsSection: true },
      take: 5,
    });
    vendor = candidates[0] || null;
  }

  let matchedInvoices: any[] = [];
  if (vendor) {
    const invNo = (extracted.invoice_number || '').trim();
    matchedInvoices = await prisma.vendorInvoice.findMany({
      where: {
        vendorId: vendor.id,
        ...(invNo ? { vendorInvNo: { equals: invNo, mode: 'insensitive' as const } } : {}),
      },
      select: {
        id: true, invoiceNo: true, vendorInvNo: true, invoiceDate: true,
        netPayable: true, paidAmount: true, balanceAmount: true, status: true,
        po: { select: { id: true, poNo: true } },
      },
      orderBy: { invoiceDate: 'desc' },
      take: 5,
    });
  }

  let suggestedAction: 'PAY_EXISTING' | 'CREATE_NEW' | 'CONFIRM_VENDOR' | 'NO_VENDOR' = 'NO_VENDOR';
  if (!vendor) suggestedAction = 'NO_VENDOR';
  else if (matchedInvoices.length === 1 && matchedInvoices[0].balanceAmount > 0) suggestedAction = 'PAY_EXISTING';
  else if (matchedInvoices.length > 1) suggestedAction = 'CONFIRM_VENDOR';
  else suggestedAction = 'CREATE_NEW';

  return { matchedVendor: vendor, matchedInvoices, suggestedAction };
}

router.post('/classify', upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

  const filePath = `document-classifier/${req.file.filename}`;
  const fileBuffer = fs.readFileSync(req.file.path);
  const mimeType = req.file.mimetype;

  let result: ClassifyResult;
  try {
    result = await classifyAndExtract(fileBuffer, mimeType);
  } catch (err: any) {
    res.json({
      filePath,
      docType: 'OTHER',
      confidence: 0,
      reason: err.message || 'Classification failed',
      supported: false,
      error: err.message,
    });
    return;
  }

  const supported = SUPPORTED_TYPES.includes(result.docType);

  if (!supported) {
    res.json({
      filePath,
      docType: result.docType,
      confidence: result.confidence,
      reason: result.reason,
      supported: false,
      message: `Document classified as ${result.docType.replace(/_/g, ' ')}. Auto-processing for this type is not yet supported — please use the manual upload flow on the relevant page.`,
    });
    return;
  }

  const { matchedVendor, matchedInvoices, suggestedAction } = await matchVendorInvoice(result.extracted);

  res.json({
    filePath,
    docType: result.docType,
    confidence: result.confidence,
    reason: result.reason,
    supported: true,
    extracted: result.extracted,
    matchedVendor,
    matchedInvoices,
    suggestedAction,
    fileName: req.file.originalname,
    fileSize: req.file.size,
  });
}));

export default router;
