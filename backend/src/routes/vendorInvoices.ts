import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../config/prisma';
import { authenticate, authorize, AuthRequest, getCompanyFilter, getActiveCompanyId, canAccessCompany } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { z } from 'zod';
import PDFDocument from 'pdfkit';
import { sendEmail } from '../services/messaging';
import { drawLetterhead } from '../utils/letterhead';
import { renderDocumentPdf } from '../services/documentRenderer';
import { nextDocNo } from '../utils/docSequence';
import { getCompanyForPdf } from '../utils/pdfCompanyHelper';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
// RAG indexing removed — only compliance docs go to RAG
import { generateVaultNote } from '../services/vaultWriter';
import { recomputeGrnPaidStateForPO } from '../services/grnPaidState';
import { calculateTds } from '../services/tdsCalculator';
import { onVendorInvoiceBooked } from '../services/autoJournal';

// ── Zod schemas ──
// Per-line shape used by the bulk Smart Upload flow. When `lines` is provided,
// header-level qty/rate/productName/grnId are derived from the lines (header-level
// fields are kept for back-compat with 3-way match + ITC code that reads them).
const vendorInvoiceLineSchema = z.object({
  grnId: z.string().optional().nullable(),
  productName: z.string().min(1),
  hsnCode: z.string().optional().nullable(),
  quantity: z.coerce.number().default(0),
  unit: z.string().optional().default('KG'),
  rate: z.coerce.number().default(0),
  gstPercent: z.coerce.number().default(0),
  remarks: z.string().optional().nullable(),
});

const createVendorInvoiceSchema = z.object({
  vendorId: z.string().min(1),
  poId: z.string().optional().nullable(),
  grnId: z.string().optional().nullable(),
  vendorInvNo: z.string().optional().default(''),
  vendorInvDate: z.string().optional(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional().nullable(),
  productName: z.string().optional().default(''),
  quantity: z.coerce.number().default(0),
  unit: z.string().optional().default('kg'),
  rate: z.coerce.number().default(0),
  supplyType: z.enum(['INTRA_STATE', 'INTER_STATE']).optional().default('INTRA_STATE'),
  gstPercent: z.coerce.number().default(0),
  isRCM: z.boolean().optional().default(false),
  freightCharge: z.coerce.number().optional().default(0),
  loadingCharge: z.coerce.number().optional().default(0),
  otherCharges: z.coerce.number().optional().default(0),
  roundOff: z.coerce.number().optional().default(0),
  tdsSection: z.string().optional().nullable(),
  tdsPercent: z.coerce.number().optional().default(0),
  status: z.string().optional().default('PENDING'),
  filePath: z.string().optional().nullable(),
  fileHash: z.string().optional().nullable(),
  originalFileName: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
  // NEW: optional multi-line payload. When present, header qty/rate/etc are derived from these.
  lines: z.array(vendorInvoiceLineSchema).optional(),
});

const updateVendorInvoiceSchema = z.object({
  vendorInvNo: z.string().optional(),
  vendorInvDate: z.string().optional(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional().nullable(),
  productName: z.string().optional(),
  quantity: z.coerce.number().optional(),
  unit: z.string().optional(),
  rate: z.coerce.number().optional(),
  supplyType: z.enum(['INTRA_STATE', 'INTER_STATE']).optional(),
  gstPercent: z.coerce.number().optional(),
  isRCM: z.boolean().optional(),
  freightCharge: z.coerce.number().optional(),
  loadingCharge: z.coerce.number().optional(),
  otherCharges: z.coerce.number().optional(),
  roundOff: z.coerce.number().optional(),
  tdsSection: z.string().optional().nullable(),
  tdsPercent: z.coerce.number().optional(),
  remarks: z.string().optional().nullable(),
  poId: z.string().optional().nullable(),
  grnId: z.string().optional().nullable(),
});

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

// ── Gemini extraction helper (shared by single + bulk routes) ──
const EXTRACT_PROMPT = `Extract these fields from this vendor/supplier invoice document. The invoice may
list MULTIPLE truck deliveries — capture every line. Return ONLY valid JSON with these keys:
{
  "invoice_number": "string - the vendor's invoice/bill number (or comma-separated list if the PDF bundles several invoice numbers)",
  "invoice_date": "string - date in YYYY-MM-DD format",
  "vendor_name": "string - supplier/vendor name",
  "gstin": "string - vendor GSTIN if visible",
  "items": [
    {
      "description": "string - material name like 'Rice Husk', 'Bagasse'",
      "hsn": "string",
      "qty": number,
      "unit": "string - MT, KG, etc.",
      "rate": number,
      "amount": number,
      "vehicle_no": "string - truck registration like 'MP38AC3015' if visible on this line, else null",
      "ticket_no": "string - weighbridge ticket / RST / DC number for this delivery if visible, else null",
      "delivery_date": "string - per-line delivery date in YYYY-MM-DD if different from invoice date, else null"
    }
  ],
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

type ExtractedInvoice = Record<string, unknown> | { raw: string } | null;

async function extractInvoiceFromBuffer(
  buffer: Buffer,
  mimeType: string,
  geminiKey: string,
): Promise<{ extracted: ExtractedInvoice; error?: string }> {
  try {
    const base64 = buffer.toString('base64');
    const geminiRes = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        contents: [{
          parts: [
            { text: EXTRACT_PROMPT },
            { inline_data: { mime_type: mimeType.startsWith('image/') ? mimeType : 'application/pdf', data: base64 } },
          ],
        }],
      },
      { timeout: 45000 },
    );
    const rawText = geminiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonStr = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    try {
      return { extracted: JSON.parse(jsonStr) };
    } catch {
      return { extracted: { raw: rawText } };
    }
  } catch (err: unknown) {
    const msg =
      (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
      'AI extraction failed';
    return { extracted: null, error: msg };
  }
}

// ═══════════════════════════════════════════════
// POST /upload-extract — Upload invoice file + AI extraction
// ═══════════════════════════════════════════════
router.post('/upload-extract', upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

  const filePath = `vendor-invoices/${req.file.filename}`;
  const fileBuffer = fs.readFileSync(req.file.path);
  const mimeType = req.file.mimetype;

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) {
    res.json({ filePath, extracted: null, error: 'AI extraction not configured (no GEMINI_API_KEY)' });
    return;
  }

  const { extracted, error } = await extractInvoiceFromBuffer(fileBuffer, mimeType, GEMINI_KEY);
  res.json({ filePath, extracted, ...(error ? { error } : {}) });

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
}));

// ═══════════════════════════════════════════════
// POST /upload-extract-bulk — Upload N invoice files at once + AI extraction in parallel
// Accepts multipart "files" field (1..20). Returns one result per file.
// Fails individually — one bad file doesn't break the batch.
// ═══════════════════════════════════════════════
router.post('/upload-extract-bulk', upload.array('files', 50), asyncHandler(async (req: AuthRequest, res: Response) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    res.status(400).json({ error: 'No files uploaded' });
    return;
  }

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  const companyFilter = getCompanyFilter(req);

  // Run extractions in parallel; cap to ~5 in flight at a time so we don't slam Gemini.
  // BEFORE calling Gemini we hash the file (SHA-256) and look for an existing
  // VendorInvoice with the same hash. If found, reuse that invoice's data and
  // skip the AI call (saves Gemini API cost on re-uploads).
  const CONCURRENCY = 5;
  // `isMatched` = the existing invoice already has at least one GRN linked
  // (header grnId or any VendorInvoiceLine.grnId). When it's matched, we skip
  // AI extraction entirely. When it's unmatched, we still run AI so accounts
  // can pick a GRN now — and the frontend routes the save to /link-grns on
  // the existing invoice instead of creating a duplicate row.
  type DupInfo = { invoiceId: string; invoiceNo: number; vendorInvNo: string | null; totalAmount: number; vendorName: string | null; isMatched: boolean };
  type BulkResult = {
    filePath: string;
    originalName: string;
    fileHash: string;
    extracted: ExtractedInvoice;
    error?: string;
    duplicateOf?: DupInfo;
  };
  const results: BulkResult[] = [];

  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(
      batch.map(async (file): Promise<BulkResult> => {
        const filePath = `vendor-invoices/${file.filename}`;
        const base: Pick<BulkResult, 'filePath' | 'originalName' | 'fileHash'> = {
          filePath,
          originalName: file.originalname,
          fileHash: '',
        };
        try {
          const buffer = fs.readFileSync(file.path);
          const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');
          base.fileHash = fileHash;

          // Dedup: same hash + same company → look up the existing invoice.
          // If the existing one is already matched (has GRN linked), skip AI.
          // If it's unmatched, still run AI so the user can pick a GRN now.
          const existing = await prisma.vendorInvoice.findFirst({
            where: { fileHash, ...companyFilter },
            select: {
              id: true, invoiceNo: true, vendorInvNo: true, vendorInvDate: true,
              totalAmount: true, subtotal: true, totalGst: true, supplyType: true,
              gstPercent: true, grnId: true,
              vendor: { select: { name: true } },
              lines: { select: { grnId: true }, take: 1, where: { grnId: { not: null } } },
            },
          });
          if (existing) {
            const isMatched = !!existing.grnId || existing.lines.length > 0;
            const dupInfo: DupInfo = {
              invoiceId: existing.id,
              invoiceNo: existing.invoiceNo,
              vendorInvNo: existing.vendorInvNo,
              totalAmount: existing.totalAmount,
              vendorName: existing.vendor?.name || null,
              isMatched,
            };
            if (isMatched) {
              // Already matched — return cached fields, no AI call.
              return {
                ...base,
                extracted: {
                  invoice_number: existing.vendorInvNo || `INV-${existing.invoiceNo}`,
                  invoice_date: existing.vendorInvDate ? existing.vendorInvDate.toISOString().slice(0, 10) : null,
                  vendor_name: existing.vendor?.name || null,
                  taxable_amount: existing.subtotal,
                  total_gst: existing.totalGst,
                  total_amount: existing.totalAmount,
                  supply_type: existing.supplyType === 'INTER_STATE' ? 'INTER_STATE' : 'INTRA_STATE',
                },
                duplicateOf: dupInfo,
              };
            }
            // Unmatched duplicate — run AI so user can review + pick a GRN.
            // Frontend routes the save to /link-grns on the existing id.
            if (!GEMINI_KEY) {
              return { ...base, extracted: null, error: 'AI extraction not configured (no GEMINI_API_KEY)', duplicateOf: dupInfo };
            }
            const { extracted, error } = await extractInvoiceFromBuffer(buffer, file.mimetype, GEMINI_KEY);
            return { ...base, extracted, duplicateOf: dupInfo, ...(error ? { error } : {}) };
          }

          if (!GEMINI_KEY) {
            return { ...base, extracted: null, error: 'AI extraction not configured (no GEMINI_API_KEY)' };
          }
          const { extracted, error } = await extractInvoiceFromBuffer(buffer, file.mimetype, GEMINI_KEY);
          return { ...base, extracted, ...(error ? { error } : {}) };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Read/extract failed';
          return { ...base, extracted: null, error: msg };
        }
      }),
    );
    results.push(...settled);
  }

  res.json({ count: results.length, results });

  // Fire-and-forget vault notes per uploaded file.
  setImmediate(() => {
    for (const file of files) {
      generateVaultNote({
        sourceType: 'VendorInvoice',
        sourceId: `vendor-invoices/${file.filename}`,
        filePath: `vendor-invoices/${file.filename}`,
        title: file.originalname || 'Vendor Invoice',
        category: 'OTHER',
        mimeType: file.mimetype,
      }).catch(err => console.error('[VendorInvoice] Vault note failed:', err));
    }
  });
}));

// ═══════════════════════════════════════════════
// POST /backfill-hashes — one-shot: compute SHA-256 for invoices that have
// a filePath but no fileHash yet. Idempotent — already-hashed rows are
// skipped. Admin-only. Hit once after the dedupe deploy lands.
// ═══════════════════════════════════════════════
router.post('/backfill-hashes', authorize('ADMIN', 'SUPER_ADMIN') as any, asyncHandler(async (req: AuthRequest, res: Response) => {
  const targets = await prisma.vendorInvoice.findMany({
    where: { filePath: { not: null }, fileHash: null },
    select: { id: true, filePath: true },
    take: 1000,
  });

  const uploadsRoot = path.join(__dirname, '../../uploads');
  const result = { scanned: targets.length, updated: 0, missing: 0, failed: 0 };

  for (const inv of targets) {
    if (!inv.filePath) continue;
    const abs = path.join(uploadsRoot, inv.filePath);
    if (!fs.existsSync(abs)) { result.missing++; continue; }
    try {
      const buf = fs.readFileSync(abs);
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      await prisma.vendorInvoice.update({ where: { id: inv.id }, data: { fileHash: hash } });
      result.updated++;
    } catch {
      result.failed++;
    }
  }

  res.json(result);
}));

// GET / — list with filters (vendorId, status)
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const vendorId = req.query.vendorId as string | undefined;
    const status = req.query.status as string | undefined;

    const where: any = { ...getCompanyFilter(req) };
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
}));

// ═══════════════════════════════════════════════
// GET /unmatched — vendor invoices with NO GRN linkage at all
// (header grnId is null AND no VendorInvoiceLine has a grnId).
// These need accounts to manually pick a GRN (one PDF can cover many GRNs,
// but each GRN can only be invoiced once — see the 1-GRN→1-invoice check
// in POST / and POST /:id/link-grns).
// ═══════════════════════════════════════════════
router.get('/unmatched', asyncHandler(async (req: AuthRequest, res: Response) => {
  const invoices = await prisma.vendorInvoice.findMany({
    where: {
      ...getCompanyFilter(req),
      status: { notIn: ['CANCELLED'] },
      grnId: null,
      lines: { none: { grnId: { not: null } } },
    },
    select: {
      id: true,
      invoiceNo: true,
      vendorInvNo: true,
      vendorInvDate: true,
      invoiceDate: true,
      totalAmount: true,
      balanceAmount: true,
      status: true,
      filePath: true,
      poId: true,
      vendor: { select: { id: true, name: true } },
      po: { select: { id: true, poNo: true } },
    },
    orderBy: { invoiceDate: 'desc' },
    take: 500,
  });
  res.json({ invoices });
}));

// GET /outstanding — outstanding vendor invoices grouped by vendor
router.get('/outstanding', asyncHandler(async (req: AuthRequest, res: Response) => {
    const invoices = await prisma.vendorInvoice.findMany({
      where: {
        ...getCompanyFilter(req),
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
}));

// GET /itc-report — ITC report
router.get('/itc-report', asyncHandler(async (req: AuthRequest, res: Response) => {
    const invoices = await prisma.vendorInvoice.findMany({
      where: {
        ...getCompanyFilter(req),
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
}));

// GET /:id — single with vendor, po, grn, payments
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
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
}));

// POST / — create vendor invoice
router.post('/', validate(createVendorInvoiceSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
    const b = req.body;

    // Multi-line path: when `lines` is provided, derive header qty/rate/productName from them.
    // First line's grnId becomes the header `grnId` for back-compat with 3-way match + ITC.
    type LineInput = z.infer<typeof vendorInvoiceLineSchema>;
    const linesIn: LineInput[] = Array.isArray(b.lines) ? b.lines : [];
    const useLines = linesIn.length > 0;

    let quantity: number;
    let rate: number;
    let gstPercent: number;
    let subtotal: number;
    let resolvedGrnId: string | null = b.grnId || null;
    let resolvedProductName: string = b.productName || '';
    let resolvedUnit: string = b.unit || 'kg';

    if (useLines) {
      // Compute totals from line items.
      subtotal = linesIn.reduce((s, l) => s + (l.quantity * l.rate), 0);
      quantity = linesIn.reduce((s, l) => s + l.quantity, 0);
      // Header rate is a weighted average; lets ITC reports keep working.
      rate = quantity > 0 ? subtotal / quantity : 0;
      // Header GST% — if all lines share one rate, mirror it; otherwise pick the dominant (highest taxable).
      const rates = new Set(linesIn.map(l => l.gstPercent));
      gstPercent = rates.size === 1
        ? linesIn[0].gstPercent
        : linesIn.reduce((best, l) => (l.quantity * l.rate) > (best.quantity * best.rate) ? l : best, linesIn[0]).gstPercent;
      // First line's GRN becomes the header GRN — back-compat anchor.
      resolvedGrnId = linesIn.find(l => l.grnId)?.grnId ?? null;
      resolvedProductName = linesIn.length === 1
        ? linesIn[0].productName
        : `${linesIn[0].productName} +${linesIn.length - 1} more`;
      resolvedUnit = linesIn[0].unit || 'KG';
    } else {
      quantity = parseFloat(b.quantity) || 0;
      rate = parseFloat(b.rate) || 0;
      gstPercent = parseFloat(b.gstPercent) || 0;
      subtotal = quantity * rate;
    }

    const freightCharge = parseFloat(b.freightCharge) || 0;
    const loadingCharge = parseFloat(b.loadingCharge) || 0;
    const otherCharges = parseFloat(b.otherCharges) || 0;
    const roundOff = parseFloat(b.roundOff) || 0;

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

    // TDS: authoritative via Phase 2 calculator. Base = contract value excl GST
    // but INCL ancillary charges (freight/loading/other) per 194C / 194Q intent.
    // Client-supplied tdsPercent is ignored in favour of the calculator —
    // anti-tampering + server-authoritative audit trail.
    const tdsBase = subtotal + freightCharge + loadingCharge + otherCharges + roundOff;
    const tds = await calculateTds(b.vendorId, tdsBase);
    const tdsPercent = tds.rate;
    const tdsAmount = tds.tdsAmount;
    const netPayable = totalAmount - tdsAmount;
    const balanceAmount = netPayable;

    // 3-way match — compare invoice qty against GRN accepted qty (not PO ordered qty,
    // because open/truck fuel deals use qty=999999 as placeholder).
    // For multi-line invoices we sum across all referenced GRNs.
    let matchStatus = 'UNMATCHED';
    const grnIdsForMatch = useLines
      ? Array.from(new Set(linesIn.map(l => l.grnId).filter((g): g is string => !!g)))
      : (b.poId && b.grnId ? [b.grnId as string] : []);

    // Enforce 1-GRN→1-invoice: a GRN linked here can't already be on another
    // active VendorInvoice (header grnId or any line). Reject before creating.
    if (grnIdsForMatch.length > 0) {
      const conflicts = await prisma.vendorInvoice.findMany({
        where: {
          status: { notIn: ['CANCELLED'] },
          OR: [
            { grnId: { in: grnIdsForMatch } },
            { lines: { some: { grnId: { in: grnIdsForMatch } } } },
          ],
        },
        select: { id: true, invoiceNo: true, vendorInvNo: true, grnId: true, lines: { select: { grnId: true } } },
      });
      if (conflicts.length > 0) {
        const grnRows = await prisma.goodsReceipt.findMany({
          where: { id: { in: grnIdsForMatch } },
          select: { id: true, grnNo: true },
        });
        const grnNumByGid: Record<string, number> = {};
        for (const g of grnRows) grnNumByGid[g.id] = g.grnNo;
        const taken: Record<string, string> = {};
        for (const c of conflicts) {
          const ids = new Set<string>([c.grnId, ...c.lines.map(l => l.grnId)].filter((g): g is string => !!g));
          for (const gid of ids) if (grnIdsForMatch.includes(gid)) taken[gid] = `INV-${c.invoiceNo}${c.vendorInvNo ? ` (${c.vendorInvNo})` : ''}`;
        }
        const lines = Object.entries(taken).map(([gid, inv]) => `GRN-${grnNumByGid[gid] ?? ''} → ${inv}`);
        return res.status(409).json({
          error: 'One or more GRNs are already linked to another invoice — a GRN can only be invoiced once.',
          conflicts: lines,
        });
      }
    }

    if (b.poId && grnIdsForMatch.length > 0) {
      const grns = await prisma.goodsReceipt.findMany({
        where: { id: { in: grnIdsForMatch } },
        include: { lines: true },
      });
      if (grns.length === grnIdsForMatch.length) {
        const allConfirmed = grns.every(g => g.status === 'CONFIRMED');
        if (!allConfirmed) {
          matchStatus = 'MISMATCH';
        } else {
          const totalGrnQty = grns.reduce((s, g) => s + g.lines.reduce((ls, l) => ls + l.acceptedQty, 0), 0);
          if (Math.abs(totalGrnQty - quantity) / Math.max(totalGrnQty, 0.01) < 0.1) {
            matchStatus = 'MATCHED';
          } else {
            matchStatus = 'MISMATCH';
          }
        }
      }
    }

    const companyId = getActiveCompanyId(req);
    const invoiceNo = await nextDocNo('VendorInvoice', 'invoiceNo', companyId);

    const invoice = await prisma.$transaction(async (tx) => {
      const created = await tx.vendorInvoice.create({
        data: {
          invoiceNo,
          vendorId: b.vendorId,
          poId: b.poId || null,
          grnId: resolvedGrnId,
          vendorInvNo: b.vendorInvNo || '',
          vendorInvDate: ((): Date => { const d = b.vendorInvDate ? new Date(b.vendorInvDate) : null; return d && !isNaN(d.getTime()) ? d : new Date(); })(),
          invoiceDate:  ((): Date => { const d = b.invoiceDate ? new Date(b.invoiceDate) : null; return d && !isNaN(d.getTime()) ? d : new Date(); })(),
          dueDate:      ((): Date | null => { const d = b.dueDate ? new Date(b.dueDate) : null; return d && !isNaN(d.getTime()) ? d : null; })(),
          productName: resolvedProductName,
          quantity,
          unit: resolvedUnit,
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
          tdsSection: tds.sectionCode || b.tdsSection || null,
          tdsPercent,
          tdsAmount,
          tdsReasonSnapshot: { reason: tds.reason, baseRate: tds.baseRate, sectionLabel: tds.sectionLabel },
          tdsComputedAt: new Date(),
          netPayable,
          paidAmount: 0,
          balanceAmount,
          matchStatus,
          status: b.status || 'PENDING',
          filePath: b.filePath || null,
          fileHash: b.fileHash || null,
          originalFileName: b.originalFileName || null,
          remarks: b.remarks || null,
          userId: req.user!.id,
          companyId,
        },
      });

      if (useLines) {
        for (let i = 0; i < linesIn.length; i++) {
          const l = linesIn[i];
          const lineSubtotal = l.quantity * l.rate;
          let lineCgst = 0, lineSgst = 0, lineIgst = 0;
          if ((b.supplyType || 'INTRA_STATE') === 'INTRA_STATE') {
            lineCgst = lineSubtotal * (l.gstPercent / 2 / 100);
            lineSgst = lineSubtotal * (l.gstPercent / 2 / 100);
          } else {
            lineIgst = lineSubtotal * (l.gstPercent / 100);
          }
          await tx.vendorInvoiceLine.create({
            data: {
              invoiceId: created.id,
              grnId: l.grnId || null,
              lineNo: i + 1,
              productName: l.productName,
              hsnCode: l.hsnCode || null,
              quantity: l.quantity,
              unit: l.unit || 'KG',
              rate: l.rate,
              taxableAmount: lineSubtotal,
              gstPercent: l.gstPercent,
              cgstAmount: lineCgst,
              sgstAmount: lineSgst,
              igstAmount: lineIgst,
              totalAmount: lineSubtotal + lineCgst + lineSgst + lineIgst,
              remarks: l.remarks || null,
            },
          });
        }
      }

      return created;
    });

    if (invoice.poId) recomputeGrnPaidStateForPO(invoice.poId).catch(() => {});
    res.status(201).json(invoice);
}));

// ═══════════════════════════════════════════════
// POST /:id/link-grns — manually attach one or more GRNs to an invoice.
// Idempotent: GRNs already linked are skipped, new ones are added as lines.
// Body: { grnIds: string[] }
// Used by the "Link GRN" button on PO detail when the AI couldn't auto-match
// or the user wants to add a missed GRN to an already-saved bill.
// ═══════════════════════════════════════════════
const linkGrnsSchema = z.object({ grnIds: z.array(z.string().min(1)).min(1) });
router.post('/:id/link-grns', validate(linkGrnsSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const invoice = await prisma.vendorInvoice.findUnique({
    where: { id: req.params.id },
    include: { lines: true },
  });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (!canAccessCompany(req, invoice.companyId)) return res.status(403).json({ error: 'Forbidden' });

  const { grnIds } = req.body as { grnIds: string[] };

  // Skip GRNs already linked (header or any existing line).
  const existingLineGrnIds = new Set(invoice.lines.map(l => l.grnId).filter((x): x is string => !!x));
  if (invoice.grnId) existingLineGrnIds.add(invoice.grnId);
  const newGrnIds = grnIds.filter(g => !existingLineGrnIds.has(g));
  if (newGrnIds.length === 0) {
    return res.json({ added: 0, message: 'All GRNs are already linked' });
  }

  // Fetch the new GRNs to derive qty/rate per line.
  const grns = await prisma.goodsReceipt.findMany({
    where: { id: { in: newGrnIds }, vendorId: invoice.vendorId },
    select: { id: true, grnNo: true, totalQty: true, totalAmount: true, lines: { select: { description: true, unit: true }, take: 1 } },
  });
  if (grns.length !== newGrnIds.length) {
    return res.status(400).json({ error: 'One or more GRNs were not found or do not belong to this vendor' });
  }

  // Enforce 1-GRN→1-invoice: if any of the picked GRNs is already linked to
  // ANOTHER invoice (either as header grnId or line grnId), reject the link.
  const conflicts = await prisma.vendorInvoice.findMany({
    where: {
      id: { not: invoice.id },
      status: { notIn: ['CANCELLED'] },
      OR: [
        { grnId: { in: newGrnIds } },
        { lines: { some: { grnId: { in: newGrnIds } } } },
      ],
    },
    select: { id: true, invoiceNo: true, vendorInvNo: true, grnId: true, lines: { select: { grnId: true } } },
  });
  if (conflicts.length > 0) {
    const taken: Record<string, string> = {};
    for (const c of conflicts) {
      const ids = new Set<string>([c.grnId, ...c.lines.map(l => l.grnId)].filter((g): g is string => !!g));
      for (const gid of ids) if (newGrnIds.includes(gid)) taken[gid] = `INV-${c.invoiceNo}${c.vendorInvNo ? ` (${c.vendorInvNo})` : ''}`;
    }
    const grnNumByGid: Record<string, number> = {};
    for (const g of grns) grnNumByGid[g.id] = g.grnNo;
    const lines = Object.entries(taken).map(([gid, inv]) => `GRN-${grnNumByGid[gid] ?? ''} → ${inv}`);
    return res.status(409).json({
      error: 'One or more GRNs are already linked to another invoice — a GRN can only be invoiced once.',
      conflicts: lines,
    });
  }

  // Determine starting lineNo (max existing + 1).
  const startLineNo = (invoice.lines.reduce((m, l) => Math.max(m, l.lineNo), 0) || 0) + 1;

  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < grns.length; i++) {
      const g = grns[i];
      const qty = g.totalQty || 0;
      const rate = qty > 0 ? (g.totalAmount || 0) / qty : 0;
      const taxable = qty * rate;
      const gst = invoice.gstPercent || 0;
      let cg = 0, sg = 0, ig = 0;
      if (invoice.supplyType === 'INTRA_STATE') { cg = taxable * gst / 2 / 100; sg = taxable * gst / 2 / 100; }
      else { ig = taxable * gst / 100; }
      await tx.vendorInvoiceLine.create({
        data: {
          invoiceId: invoice.id,
          grnId: g.id,
          lineNo: startLineNo + i,
          productName: g.lines[0]?.description || `GRN-${g.grnNo}`,
          quantity: qty,
          unit: g.lines[0]?.unit || 'KG',
          rate,
          taxableAmount: taxable,
          gstPercent: gst,
          cgstAmount: cg,
          sgstAmount: sg,
          igstAmount: ig,
          totalAmount: taxable + cg + sg + ig,
        },
      });
    }
    // Promote first new GRN to header grnId if header is still empty.
    if (!invoice.grnId && grns[0]) {
      await tx.vendorInvoice.update({ where: { id: invoice.id }, data: { grnId: grns[0].id } });
    }
  });

  // Recompute the GRN paid-state on the PO since invoice→GRN linkage changed.
  if (invoice.poId) recomputeGrnPaidStateForPO(invoice.poId).catch(() => {});

  res.json({ added: grns.length });
}));

// PUT /:id — edit vendor invoice (only PENDING status)
router.put('/:id', validate(updateVendorInvoiceSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
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

    // TDS via Phase 2 calculator — ignore client-supplied tdsPercent
    // Base = contract value excl GST but incl ancillary (194C/194Q intent).
    const tdsBase = subtotal + freightCharge + loadingCharge + otherCharges + roundOff;
    const tds = await calculateTds(existing.vendorId, tdsBase);
    const tdsPercent = tds.rate;
    const tdsAmount = tds.tdsAmount;
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
        totalAmount,
        tdsSection: tds.sectionCode || existing.tdsSection,
        tdsPercent, tdsAmount,
        tdsReasonSnapshot: { reason: tds.reason, baseRate: tds.baseRate, sectionLabel: tds.sectionLabel },
        tdsComputedAt: new Date(),
        netPayable, balanceAmount: Math.max(0, balanceAmount),
        remarks: b.remarks ?? existing.remarks,
        poId: b.poId !== undefined ? (b.poId || null) : existing.poId,
        grnId: b.grnId !== undefined ? (b.grnId || null) : existing.grnId,
      },
    });
    res.json(invoice);
}));

// PUT /:id/status — status transitions
router.put('/:id/status', asyncHandler(async (req: AuthRequest, res: Response) => {
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

    // On PENDING → VERIFIED, post journal entries (fire-and-forget).
    // GOODS POs: GRN already posted Dr Inventory / Cr Payable; this tops up GST.
    // Non-GOODS POs (SERVICE/CONTRACTOR/RENT/UTILITY/OTHER): no GRN, so this posts
    // BOTH the base expense (Dr Expense) AND GST (Dr GST Input), Cr Trade Payable.
    if (invoice.status === 'PENDING' && newStatus === 'VERIFIED') {
      const poType = invoice.poId
        ? (await prisma.purchaseOrder.findUnique({ where: { id: invoice.poId }, select: { poType: true } }))?.poType
        : undefined;
      onVendorInvoiceBooked(prisma, {
        id: updated.id,
        invoiceNo: updated.invoiceNo,
        vendorInvNo: updated.vendorInvNo,
        cgstAmount: updated.cgstAmount,
        sgstAmount: updated.sgstAmount,
        igstAmount: updated.igstAmount,
        totalGst: updated.totalGst,
        subtotal: updated.subtotal,
        totalAmount: updated.totalAmount,
        isRCM: updated.isRCM,
        itcEligible: updated.itcEligible,
        invoiceDate: updated.invoiceDate,
        userId: updated.userId,
        companyId: updated.companyId || undefined,
        poType: poType || undefined,
      }).catch(err => console.error('[VI] Invoice journal failed:', err));
    }

    res.json(updated);
}));

// PUT /:id/itc — update ITC status
router.put('/:id/itc', asyncHandler(async (req: AuthRequest, res: Response) => {
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
}));

// GET /:id/pdf — Generate Vendor Invoice PDF
router.get('/:id/pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
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

    (viData as any).company = await getCompanyForPdf(inv.companyId);

    const pdfBuffer = await renderDocumentPdf({ docType: 'VENDOR_INVOICE', data: viData, verifyId: inv.id });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="VI-${inv.invoiceNo || inv.id.slice(0, 8)}.pdf"`);
    res.send(pdfBuffer);
}));

// POST /:id/send-email — Send Vendor Invoice via email
router.post('/:id/send-email', asyncHandler(async (req: AuthRequest, res: Response) => {
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
}));

export default router;
