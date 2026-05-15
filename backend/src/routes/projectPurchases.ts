import { Router, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { nextDocNo } from '../utils/docSequence';
import { mirrorToS3 } from '../shared/s3Storage';

const router = Router();
router.use(authenticate);

// ── Multer for quotation uploads ──
const uploadDir = path.join(__dirname, '../../uploads/project-quotations');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// ── AI model config ──
// Project quotation parsing is occasional + high-stakes (capital purchase decisions
// rely on it). Per CLAUDE.md feedback_accuracy_over_cost, want the top-tier model.
//
// History on 2026-05-15: tried 'gemini-3-pro' → 404; tried 'gemini-3.1-pro' (AI Studio
// quota dashboard's display name) → also 404. The v1beta REST API uses model IDs that
// don't always match the AI Studio UI name. To find the actual ID hit:
//   GET /api/project-purchases/_diagnostic/list-models
// which calls Google's ListModels and returns the GA list, then set
//   GEMINI_PROJECT_QUOTE_MODEL=<exact-id-from-list>
// in Railway env.
//
// Default stays on gemini-2.5-pro — the only top-tier model we've confirmed working
// on this workspace's v1beta endpoint (proven in rfqQuoteExtractor.ts).
const PROJECT_QUOTE_MODEL = process.env.GEMINI_PROJECT_QUOTE_MODEL || 'gemini-2.5-pro';
const PROJECT_QUOTE_TIMEOUT_MS = 180_000; // 3 min — pro model on a dense 5-page PDF can take >60s

const QUOTATION_PROMPT = `You are reading a vendor quotation / proforma invoice for a capital project purchase (mechanical, civil, electrical, instrumentation, IT, etc.).
Real-world quotes from different vendors vary wildly in structure: some are a flat BOQ; some have a BOQ AND a separate "cost summary" table with extra rows for I&C / packing / freight; some price the same package at multiple volumes ("1 location ₹X / 2 locations ₹2X"); some are "turnkey lumpsum, individual rates indicative"; some bury 20 exclusions in a T&C section; some attach OEM-warranty-passthrough clauses. Your job is to extract ALL of this into a generic shape so any future vendor's PDF can be processed the same way — don't assume any particular vendor's layout.

Return ONLY valid JSON (no markdown) with these keys:
{
  "vendor_name": "string - supplier/vendor name",
  "vendor_contact": "string - email or phone if visible",
  "gstin": "string or null",
  "quotation_number": "string or null",
  "quotation_date": "YYYY-MM-DD or null",
  "validity_days": number or null,
  "delivery_period": "string - e.g. '15 days', '4 weeks', 'ex-stock'",
  "warranty": "string - core warranty (months/years from commissioning or dispatch). Do not paste the full T&C paragraph here; summarize.",
  "payment_terms": "string - e.g. '40% advance, 60% against PI before dispatch'",
  "line_items": [
    {
      "description": "string - item/service name. INCLUDE every priced row from the BOQ AND from any 'Cost Summary' / 'Commercial Summary' table — Installation, Commissioning, Erection, Supervision, Training, Testing, Painting, Insurance, Packing, Forwarding, Loading, Unloading etc. are line items when they have a price next to them, NOT 'other_charges'.",
      "specification": "string - specs, capacity, dimensions, standards",
      "make": "string - brand/make or null",
      "model": "string - model no or null",
      "quantity": number,
      "unit": "string - NOS, SET, KG, MT, LOT, JOB etc.",
      "rate": number,
      "amount": number,
      "hsn_sac": "string or null",
      "gst_percent": number
    }
  ],
  "subtotal": number,
  "gst_amount": number,
  "freight": number,
  "other_charges": number,
  "total_amount": number,
  "currency": "INR / USD / EUR",
  "price_basis": "EXW | FOR_SITE | CIF | DDP | OTHER — read terms carefully; EXW = vendor factory, FOR_SITE = delivered to our site, CIF = port, DDP = duty-paid delivered. Use null if not stated.",
  "gst_inclusive": "boolean — true if the quoted Total INCLUDES GST, false if GST is shown as extra/separate, null if unclear",
  "freight_in_scope": "boolean — true if freight is on vendor's account, false if buyer pays separately, null if unclear",
  "insurance_in_scope": "boolean — true if transit / erection insurance is in vendor scope, null if unclear",
  "install_commission_in_scope": "boolean — true if installation & commissioning is in vendor scope (priced or free), false if explicitly excluded, null if unclear",
  "training_days": "number or null — operator training days at site if mentioned",
  "volume_options": [
    { "label": "string - e.g. '1 location', '2 locations', '500 TPD', '1000 TPD'", "totalAmount": number, "notes": "string or null" }
  ],
  "exclusions": [
    "string - one entry per scope item the vendor explicitly excluded (civil works, transformer, statutory licenses, lightning protection, compressed air plant, water supply, electrical panels, cable trays, storage space for vendor tools, accommodation for workers, etc.). Copy each bullet verbatim. Look at 'Exclusions' / 'Scope of Buyer' / 'Not in our scope' / 'In Client's Scope' sections."
  ],
  "conditional_commercials": [
    {
      "kind": "PACKING_FWD | FREIGHT_INSURANCE | STEEL_ESCALATION | RAW_MATERIAL_ESCALATION | LATE_PICKUP | SUPERVISOR_IDLE | SITE_ENGINEER_IDLE | CANCELLATION_FEE | OEM_WARRANTY | PRICE_VARIATION | LIQUIDATED_DAMAGES | OTHER",
      "label": "string - short human label",
      "formula": "string - exact wording from PDF including %, ₹/day, ₹/sqm/month etc."
    }
  ],
  "is_indicative": "boolean — true if the offer is described as 'turnkey / lumpsum / package basis' AND says individual line-item prices are 'indicative only' / 'not binding individually'. Otherwise false.",
  "bought_out_warranty_clause": "string or null — the clause that passes through OEM warranty (motors / gearboxes / electric items / instruments) to the OEM instead of the prime vendor"
}

Rules:
- If a field is missing in the document, use null for strings/dates/booleans, 0 for numbers, [] for arrays.
- CRITICAL: every priced line in the BOQ AND every priced row in any 'Cost Summary' / 'Commercial Summary' table MUST appear in line_items. Don't drop them just because they're "services". Don't pile them into other_charges. A row reading "Installation & Commissioning ₹32,09,500" is a line_item, not other_charges.
- If a row in the cost summary says 'Included' or 'Client Scope' or 'N/A' (no rupee value), do NOT put it in line_items — instead reflect it in the boolean flags (gst_inclusive, freight_in_scope, etc.).
- volume_options: empty array if the quote prices a single volume only. Populate when you see "for X locations ₹Y" / "for X TPD ₹Y" patterns OR multiple totals shown. The single 'total_amount' field should match the FIRST option (the base case).
- exclusions: take from the T&C section. One string per bullet, verbatim. Empty array if none stated.
- conditional_commercials: capture ALL escalation, idle-charge, late-pickup, packing-percent, freight-actuals, cancellation-fee, OEM-warranty-passthrough clauses you find. Use exact ₹ and % from the document so the buyer can model worst-case cost.
- is_indicative: only set true if the PDF explicitly says individual prices are indicative / for turnkey / lumpsum basis. Don't guess.
- For line items, preserve vendor's wording in description verbatim. Specification should include make/capacity/standards if present.
- Commercial flags (price_basis etc.) come from T&C section. Read both BOQ and T&C carefully.
- Return ONLY JSON — no commentary, no markdown fences.`;

// runQuotationParse — Gemini extraction for one ProjectQuotation row.
// Fire-and-forget from /quotations/upload AND callable from /quotations/:qid/reparse.
// All updates land on the same row; success → parseStatus=PARSED, fail → FAILED.
// Errors are swallowed (logged only) since there's no HTTP request to return them to.
async function runQuotationParse(quotationId: string): Promise<void> {
  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) {
    await prisma.projectQuotation.update({
      where: { id: quotationId },
      data: { parseStatus: 'MANUAL', parseError: 'GEMINI_API_KEY not configured — fill manually' },
    });
    return;
  }

  const quotation = await prisma.projectQuotation.findUnique({ where: { id: quotationId } });
  if (!quotation) {
    console.error(`[runQuotationParse] quotation ${quotationId} not found`);
    return;
  }

  // Locate file on disk. `fileUrl` is stored as "project-quotations/<filename>".
  const filePath = path.join(__dirname, '../../uploads', quotation.fileUrl);
  if (!fs.existsSync(filePath)) {
    await prisma.projectQuotation.update({
      where: { id: quotationId },
      data: { parseStatus: 'FAILED', parseError: `Source file not on disk: ${quotation.fileUrl}` },
    });
    return;
  }

  await prisma.projectQuotation.update({
    where: { id: quotationId },
    data: { parseStatus: 'PARSING', parseError: null },
  });

  try {
    const fileBuffer = fs.readFileSync(filePath);
    const base64 = fileBuffer.toString('base64');
    const mimeType = quotation.mimeType || 'application/pdf';

    const geminiRes = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${PROJECT_QUOTE_MODEL}:generateContent?key=${GEMINI_KEY}`,
      {
        contents: [{
          parts: [
            { text: QUOTATION_PROMPT },
            { inline_data: { mime_type: mimeType.startsWith('image/') ? mimeType : 'application/pdf', data: base64 } },
          ],
        }],
        // Long exclusion lists + 20+ line items can easily exceed 8K tokens.
        // Bump generously — capital-equipment quotes warrant the headroom.
        generationConfig: {
          maxOutputTokens: 32_768,
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      },
      { timeout: PROJECT_QUOTE_TIMEOUT_MS },
    );

    const rawText = geminiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonStr = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    let extracted: any = null;
    try { extracted = JSON.parse(jsonStr); } catch { extracted = null; }

    if (!extracted) {
      await prisma.projectQuotation.update({
        where: { id: quotationId },
        data: { parseStatus: 'FAILED', parseError: 'Could not parse JSON from AI response', extractedJson: { raw: rawText } },
      });
      return;
    }

    // Vendor match by GSTIN or name
    let matchedVendorId: string | null = null;
    if (extracted.gstin) {
      const v = await prisma.vendor.findFirst({ where: { gstin: extracted.gstin }, select: { id: true } });
      if (v) matchedVendorId = v.id;
    }
    if (!matchedVendorId && extracted.vendor_name) {
      const v = await prisma.vendor.findFirst({
        where: { name: { contains: extracted.vendor_name, mode: 'insensitive' } },
        select: { id: true },
      });
      if (v) matchedVendorId = v.id;
    }

    const lineItems = Array.isArray(extracted.line_items) ? extracted.line_items : [];

    // Clear old line items before re-creating — re-parse should not duplicate rows.
    await prisma.projectQuotationLine.deleteMany({ where: { quotationId } });

    await prisma.projectQuotation.update({
      where: { id: quotationId },
      data: {
        vendorId: matchedVendorId,
        vendorNameRaw: extracted.vendor_name || null,
        vendorContact: extracted.vendor_contact || null,
        quotationNo: extracted.quotation_number || null,
        quotationDate: extracted.quotation_date ? new Date(extracted.quotation_date) : null,
        validityDays: extracted.validity_days ?? null,
        deliveryPeriod: extracted.delivery_period || null,
        warranty: extracted.warranty || null,
        paymentTerms: extracted.payment_terms || null,
        subtotal: Number(extracted.subtotal) || 0,
        gstAmount: Number(extracted.gst_amount) || 0,
        freight: Number(extracted.freight) || 0,
        otherCharges: Number(extracted.other_charges) || 0,
        totalAmount: Number(extracted.total_amount) || 0,
        currency: extracted.currency || 'INR',
        priceBasis: ['EXW', 'FOR_SITE', 'CIF', 'DDP', 'OTHER'].includes(extracted.price_basis) ? extracted.price_basis : null,
        gstInclusive: typeof extracted.gst_inclusive === 'boolean' ? extracted.gst_inclusive : null,
        freightInScope: typeof extracted.freight_in_scope === 'boolean' ? extracted.freight_in_scope : null,
        insuranceInScope: typeof extracted.insurance_in_scope === 'boolean' ? extracted.insurance_in_scope : null,
        installCommissionInScope: typeof extracted.install_commission_in_scope === 'boolean' ? extracted.install_commission_in_scope : null,
        trainingDays: typeof extracted.training_days === 'number' ? extracted.training_days : null,
        volumeOptions: Array.isArray(extracted.volume_options) && extracted.volume_options.length > 0
          ? extracted.volume_options
              .map((v: any) => ({
                label: typeof v?.label === 'string' ? v.label : null,
                totalAmount: typeof v?.totalAmount === 'number' ? v.totalAmount : Number(v?.totalAmount) || 0,
                notes: typeof v?.notes === 'string' ? v.notes : null,
              }))
              .filter((v: any) => v.label && v.totalAmount > 0)
          : Prisma.JsonNull,
        exclusions: Array.isArray(extracted.exclusions) && extracted.exclusions.length > 0
          ? extracted.exclusions.filter((x: unknown) => typeof x === 'string' && x.trim().length > 0)
          : Prisma.JsonNull,
        conditionalCommercials: Array.isArray(extracted.conditional_commercials) && extracted.conditional_commercials.length > 0
          ? extracted.conditional_commercials
              .map((c: any) => ({
                kind: typeof c?.kind === 'string' ? c.kind : 'OTHER',
                label: typeof c?.label === 'string' ? c.label : null,
                formula: typeof c?.formula === 'string' ? c.formula : null,
              }))
              .filter((c: any) => c.label && c.formula)
          : Prisma.JsonNull,
        isIndicative: extracted.is_indicative === true,
        boughtOutWarrantyClause: typeof extracted.bought_out_warranty_clause === 'string' ? extracted.bought_out_warranty_clause : null,
        extractedJson: extracted,
        parsedAt: new Date(),
        parseStatus: 'PARSED',
        parseError: null,
        lineItems: {
          create: lineItems.map((li: any, idx: number) => ({
            lineNo: idx + 1,
            description: String(li.description || ''),
            specification: li.specification || null,
            make: li.make || null,
            model: li.model || null,
            quantity: Number(li.quantity) || 1,
            unit: li.unit || 'NOS',
            rate: Number(li.rate) || 0,
            amount: Number(li.amount) || 0,
            hsnSac: li.hsn_sac || null,
            gstPercent: Number(li.gst_percent) || 0,
          })),
        },
      },
    });
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { error?: { message?: string } } }; message?: string })?.response?.data?.error?.message
      || (err as Error)?.message
      || 'AI extraction failed';
    console.error(`[runQuotationParse] ${quotationId}: ${msg}`);
    await prisma.projectQuotation.update({
      where: { id: quotationId },
      data: { parseStatus: 'FAILED', parseError: msg },
    });
  }
}

// ── Zod ──
const createProjectSchema = z.object({
  name: z.string().min(1, 'Project name required'),
  description: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  scopeOfWork: z.string().optional().nullable(),
  budgetAmount: z.coerce.number().nonnegative().optional().default(0),
  targetDate: z.string().optional().nullable(),
  division: z.string().optional().default('ETHANOL'),
  remarks: z.string().optional().nullable(),
});

const updateProjectSchema = createProjectSchema.partial().extend({
  status: z.enum(['DRAFT', 'COLLECTING_QUOTES', 'UNDER_EVALUATION', 'AWARDED', 'PO_RAISED', 'COMPLETED', 'CANCELLED']).optional(),
});

const updateQuotationSchema = z.object({
  vendorId: z.string().optional().nullable(),
  vendorNameRaw: z.string().optional().nullable(),
  vendorContact: z.string().optional().nullable(),
  quotationNo: z.string().optional().nullable(),
  quotationDate: z.string().optional().nullable(),
  validityDays: z.coerce.number().int().optional().nullable(),
  deliveryPeriod: z.string().optional().nullable(),
  warranty: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  subtotal: z.coerce.number().optional(),
  gstAmount: z.coerce.number().optional(),
  freight: z.coerce.number().optional(),
  otherCharges: z.coerce.number().optional(),
  totalAmount: z.coerce.number().optional(),
  // Commercial flags — what the price actually covers
  priceBasis: z.enum(['EXW', 'FOR_SITE', 'CIF', 'DDP', 'OTHER']).optional().nullable(),
  gstInclusive: z.boolean().optional().nullable(),
  freightInScope: z.boolean().optional().nullable(),
  insuranceInScope: z.boolean().optional().nullable(),
  installCommissionInScope: z.boolean().optional().nullable(),
  trainingDays: z.coerce.number().int().optional().nullable(),
  // Complex-quote fields (editable from the modal even after AI extraction)
  volumeOptions: z.array(z.object({
    label: z.string(),
    totalAmount: z.coerce.number(),
    notes: z.string().optional().nullable(),
  })).optional().nullable(),
  selectedVolumeLabel: z.string().optional().nullable(),
  exclusions: z.array(z.string()).optional().nullable(),
  conditionalCommercials: z.array(z.object({
    kind: z.string(),
    label: z.string(),
    formula: z.string(),
  })).optional().nullable(),
  isIndicative: z.boolean().optional(),
  boughtOutWarrantyClause: z.string().optional().nullable(),
  manualNotes: z.string().optional().nullable(),
  lineItems: z.array(z.object({
    description: z.string(),
    specification: z.string().optional().nullable(),
    make: z.string().optional().nullable(),
    model: z.string().optional().nullable(),
    quantity: z.coerce.number().default(1),
    unit: z.string().default('NOS'),
    rate: z.coerce.number().default(0),
    amount: z.coerce.number().default(0),
    hsnSac: z.string().optional().nullable(),
    gstPercent: z.coerce.number().default(0),
    remarks: z.string().optional().nullable(),
  })).optional(),
});

// ═══════════════════════════════════════════════
// GET /_diagnostic/list-models — call Google's ListModels so we can see the
// actual API ids available on the current API key (the AI-Studio UI name
// "Gemini 3.1 Pro" doesn't always match the v1beta API id). Use this when
// the parse endpoint 404s on a model name to find the real id, then set
// GEMINI_PROJECT_QUOTE_MODEL=<id> in env.
// ═══════════════════════════════════════════════
router.get('/_diagnostic/list-models', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) {
    res.status(400).json({ error: 'GEMINI_API_KEY not configured' });
    return;
  }
  try {
    const r = await axios.get(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_KEY}&pageSize=200`,
      { timeout: 10_000 },
    );
    const models: Array<{ name?: string; supportedGenerationMethods?: string[]; displayName?: string }> = r.data?.models || [];
    // Just the ids that support generateContent, ranked with pros first then flashes
    const usable = models
      .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map(m => ({
        id: (m.name || '').replace(/^models\//, ''),
        displayName: m.displayName || null,
      }))
      .sort((a, b) => {
        const score = (id: string) => /-pro\b/.test(id) ? 0 : /-flash\b/.test(id) ? 1 : 2;
        return score(a.id) - score(b.id) || a.id.localeCompare(b.id);
      });
    res.json({
      currentDefault: PROJECT_QUOTE_MODEL,
      currentEnvOverride: process.env.GEMINI_PROJECT_QUOTE_MODEL || null,
      usable,
    });
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { error?: { message?: string } } }; message?: string })?.response?.data?.error?.message
      || (err as Error)?.message || 'list-models call failed';
    res.status(502).json({ error: msg });
  }
}));

// ═══════════════════════════════════════════════
// GET / — list projects
// ═══════════════════════════════════════════════
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const status = req.query.status as string | undefined;
  const where: Record<string, unknown> = { ...getCompanyFilter(req) };
  if (status && status !== 'ALL') where.status = status;

  const projects = await prisma.projectPurchase.findMany({
    where,
    select: {
      id: true,
      projectNo: true,
      name: true,
      description: true,
      category: true,
      budgetAmount: true,
      currency: true,
      targetDate: true,
      status: true,
      awardedQuotationId: true,
      awardedAt: true,
      division: true,
      companyId: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { quotations: true } },
      po: { select: { id: true, poNo: true, status: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  res.json({ projects });
}));

// ═══════════════════════════════════════════════
// GET /:id — one project with all quotations + line items
// ═══════════════════════════════════════════════
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const project = await prisma.projectPurchase.findUnique({
    where: { id: req.params.id },
    include: {
      quotations: {
        include: {
          vendor: { select: { id: true, name: true, gstin: true, phone: true, email: true } },
          lineItems: { orderBy: { lineNo: 'asc' } },
        },
        orderBy: { createdAt: 'asc' },
      },
      awardedQuotation: { select: { id: true, totalAmount: true, vendorNameRaw: true, quotationNo: true } },
      po: { select: { id: true, poNo: true, status: true, grandTotal: true } },
    },
  });
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  res.json(project);
}));

// ═══════════════════════════════════════════════
// POST / — create project
// ═══════════════════════════════════════════════
router.post('/', validate(createProjectSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const companyId = getActiveCompanyId(req);
  const project = await prisma.projectPurchase.create({
    data: {
      name: b.name,
      description: b.description || null,
      category: b.category || null,
      scopeOfWork: b.scopeOfWork || null,
      budgetAmount: b.budgetAmount || 0,
      targetDate: b.targetDate ? new Date(b.targetDate) : null,
      division: b.division || 'ETHANOL',
      remarks: b.remarks || null,
      status: 'DRAFT',
      userId: req.user!.id,
      companyId,
    },
  });
  res.status(201).json(project);
}));

// ═══════════════════════════════════════════════
// PUT /:id — update project
// ═══════════════════════════════════════════════
router.put('/:id', validate(updateProjectSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const project = await prisma.projectPurchase.update({
    where: { id: req.params.id },
    data: {
      name: b.name,
      description: b.description,
      category: b.category,
      scopeOfWork: b.scopeOfWork,
      budgetAmount: b.budgetAmount,
      targetDate: b.targetDate ? new Date(b.targetDate) : b.targetDate === null ? null : undefined,
      status: b.status,
      remarks: b.remarks,
    },
  });
  res.json(project);
}));

// ═══════════════════════════════════════════════
// DELETE /:id — delete DRAFT only
// ═══════════════════════════════════════════════
router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const p = await prisma.projectPurchase.findUnique({ where: { id: req.params.id }, select: { status: true } });
  if (!p) { res.status(404).json({ error: 'Not found' }); return; }
  if (p.status !== 'DRAFT' && p.status !== 'COLLECTING_QUOTES' && p.status !== 'CANCELLED') {
    res.status(400).json({ error: `Cannot delete project in status ${p.status}` });
    return;
  }
  await prisma.projectPurchase.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

// ═══════════════════════════════════════════════
// POST /:id/quotations/upload — upload one quote PDF/image + AI parse
// ═══════════════════════════════════════════════
router.post('/:id/quotations/upload', upload.single('file'), mirrorToS3('project-quotations'), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
  const project = await prisma.projectPurchase.findUnique({ where: { id: req.params.id } });
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  const fileUrl = `project-quotations/${req.file.filename}`;
  const mimeType = req.file.mimetype;

  // Create quotation stub immediately so client has an ID + visible row.
  const quotation = await prisma.projectQuotation.create({
    data: {
      projectId: project.id,
      fileUrl,
      fileName: req.file.originalname,
      mimeType,
      fileSize: req.file.size,
      parseStatus: 'PARSING',
    },
  });

  // Bump project to COLLECTING_QUOTES if still DRAFT, and invalidate any cached
  // AI analysis — the prior ranking referenced a stale quotation set.
  await prisma.projectPurchase.update({
    where: { id: project.id },
    data: {
      ...(project.status === 'DRAFT' ? { status: 'COLLECTING_QUOTES' } : {}),
      aiAnalysis: Prisma.JsonNull,
      aiAnalysisAt: null,
    },
  });

  // Fire-and-forget — Gemini parse runs in background; client polls /:id to see
  // parseStatus flip from PARSING → PARSED (or FAILED with parseError). With the
  // pro model + a 5-page PDF this can take 30-120s; we don't want to hold the
  // browser request open that long.
  void runQuotationParse(quotation.id).catch((err) => {
    console.error(`[upload] background parse failed for ${quotation.id}:`, err);
  });

  res.status(202).json({ quotation, status: 'PARSING', message: 'Upload received — AI extraction running in background' });
}));

// POST /quotations/:qid/reparse — re-run Gemini extraction on an existing upload.
// Useful after improving the prompt, after the previous run hit FAILED, or to
// re-extract with the latest model when Google ships an upgrade.
router.post('/quotations/:qid/reparse', asyncHandler(async (req: AuthRequest, res: Response) => {
  const q = await prisma.projectQuotation.findUnique({ where: { id: req.params.qid }, select: { id: true, projectId: true, parseStatus: true } });
  if (!q) { res.status(404).json({ error: 'Quotation not found' }); return; }
  if (q.parseStatus === 'PARSING') {
    res.status(409).json({ error: 'Already parsing — wait for it to finish or fail.' });
    return;
  }
  // A reparse can change line items, totals, exclusions — the cached aiAnalysis
  // ranking is no longer trustworthy. Clear it; user will re-trigger Analyze.
  await prisma.projectPurchase.update({
    where: { id: q.projectId },
    data: { aiAnalysis: Prisma.JsonNull, aiAnalysisAt: null },
  });
  void runQuotationParse(q.id).catch((err) => {
    console.error(`[reparse] background parse failed for ${q.id}:`, err);
  });
  res.status(202).json({ status: 'PARSING', message: 'Re-parse running in background' });
}));


// ═══════════════════════════════════════════════
// PUT /quotations/:qid — edit quotation (vendor link, manual overrides, line items)
// ═══════════════════════════════════════════════
router.put('/quotations/:qid', validate(updateQuotationSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const q = await prisma.projectQuotation.findUnique({ where: { id: req.params.qid } });
  if (!q) { res.status(404).json({ error: 'Quotation not found' }); return; }

  const data: Record<string, unknown> = {};
  if (b.vendorId !== undefined) data.vendorId = b.vendorId || null;
  if (b.vendorNameRaw !== undefined) data.vendorNameRaw = b.vendorNameRaw;
  if (b.vendorContact !== undefined) data.vendorContact = b.vendorContact;
  if (b.quotationNo !== undefined) data.quotationNo = b.quotationNo;
  if (b.quotationDate !== undefined) data.quotationDate = b.quotationDate ? new Date(b.quotationDate) : null;
  if (b.validityDays !== undefined) data.validityDays = b.validityDays;
  if (b.deliveryPeriod !== undefined) data.deliveryPeriod = b.deliveryPeriod;
  if (b.warranty !== undefined) data.warranty = b.warranty;
  if (b.paymentTerms !== undefined) data.paymentTerms = b.paymentTerms;
  if (b.subtotal !== undefined) data.subtotal = b.subtotal;
  if (b.gstAmount !== undefined) data.gstAmount = b.gstAmount;
  if (b.freight !== undefined) data.freight = b.freight;
  if (b.otherCharges !== undefined) data.otherCharges = b.otherCharges;
  if (b.totalAmount !== undefined) data.totalAmount = b.totalAmount;
  if (b.priceBasis !== undefined) data.priceBasis = b.priceBasis;
  if (b.gstInclusive !== undefined) data.gstInclusive = b.gstInclusive;
  if (b.freightInScope !== undefined) data.freightInScope = b.freightInScope;
  if (b.insuranceInScope !== undefined) data.insuranceInScope = b.insuranceInScope;
  if (b.installCommissionInScope !== undefined) data.installCommissionInScope = b.installCommissionInScope;
  if (b.trainingDays !== undefined) data.trainingDays = b.trainingDays;
  if (b.volumeOptions !== undefined) {
    data.volumeOptions = Array.isArray(b.volumeOptions) && b.volumeOptions.length > 0 ? b.volumeOptions : Prisma.JsonNull;
  }
  if (b.selectedVolumeLabel !== undefined) data.selectedVolumeLabel = b.selectedVolumeLabel || null;
  if (b.exclusions !== undefined) {
    data.exclusions = Array.isArray(b.exclusions) && b.exclusions.length > 0 ? b.exclusions : Prisma.JsonNull;
  }
  if (b.conditionalCommercials !== undefined) {
    data.conditionalCommercials = Array.isArray(b.conditionalCommercials) && b.conditionalCommercials.length > 0 ? b.conditionalCommercials : Prisma.JsonNull;
  }
  if (b.isIndicative !== undefined) data.isIndicative = !!b.isIndicative;
  if (b.boughtOutWarrantyClause !== undefined) data.boughtOutWarrantyClause = b.boughtOutWarrantyClause || null;
  if (b.manualNotes !== undefined) data.manualNotes = b.manualNotes;

  const updated = await prisma.$transaction(async (tx) => {
    if (Array.isArray(b.lineItems)) {
      await tx.projectQuotationLine.deleteMany({ where: { quotationId: q.id } });
      await tx.projectQuotationLine.createMany({
        data: b.lineItems.map((li: any, idx: number) => ({
          quotationId: q.id,
          lineNo: idx + 1,
          description: String(li.description || ''),
          specification: li.specification || null,
          make: li.make || null,
          model: li.model || null,
          quantity: Number(li.quantity) || 1,
          unit: li.unit || 'NOS',
          rate: Number(li.rate) || 0,
          amount: Number(li.amount) || 0,
          hsnSac: li.hsnSac || null,
          gstPercent: Number(li.gstPercent) || 0,
          remarks: li.remarks || null,
        })),
      });
    }
    return tx.projectQuotation.update({
      where: { id: q.id },
      data,
      include: { lineItems: { orderBy: { lineNo: 'asc' } }, vendor: { select: { id: true, name: true, gstin: true } } },
    });
  });

  res.json(updated);
}));

// ═══════════════════════════════════════════════
// DELETE /quotations/:qid
// ═══════════════════════════════════════════════
router.delete('/quotations/:qid', asyncHandler(async (req: AuthRequest, res: Response) => {
  const q = await prisma.projectQuotation.findUnique({ where: { id: req.params.qid }, select: { id: true, isAwarded: true, projectId: true } });
  if (!q) { res.status(404).json({ error: 'Not found' }); return; }
  if (q.isAwarded) { res.status(400).json({ error: 'Cannot delete an awarded quotation' }); return; }
  // Cached AI Analysis references quotationIds. Once a quote is gone, leaving the
  // stale ranking around shows dead IDs in the comparison header — clear it.
  await prisma.$transaction([
    prisma.projectQuotation.delete({ where: { id: req.params.qid } }),
    prisma.projectPurchase.update({
      where: { id: q.projectId },
      data: { aiAnalysis: Prisma.JsonNull, aiAnalysisAt: null },
    }),
  ]);
  res.json({ ok: true });
}));

// ═══════════════════════════════════════════════
// POST /:id/analyze — AI-driven comparison across all quotations
// ═══════════════════════════════════════════════
router.post('/:id/analyze', asyncHandler(async (req: AuthRequest, res: Response) => {
  const project = await prisma.projectPurchase.findUnique({
    where: { id: req.params.id },
    include: {
      quotations: {
        include: {
          vendor: { select: { name: true, gstin: true } },
          lineItems: { orderBy: { lineNo: 'asc' } },
        },
      },
    },
  });
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  if (project.quotations.length < 2) {
    res.status(400).json({ error: 'Need at least 2 quotations to analyze' });
    return;
  }

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) {
    res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    return;
  }

  const quotesSummary = project.quotations.map((q, idx) => ({
    quotationId: q.id,
    tag: `Q${idx + 1}`,
    vendor: q.vendor?.name || q.vendorNameRaw || 'Unknown',
    quotationNo: q.quotationNo,
    quotationDate: q.quotationDate,
    subtotal: q.subtotal,
    gstAmount: q.gstAmount,
    freight: q.freight,
    otherCharges: q.otherCharges,
    totalAmount: q.totalAmount,
    currency: q.currency,
    deliveryPeriod: q.deliveryPeriod,
    warranty: q.warranty,
    paymentTerms: q.paymentTerms,
    validityDays: q.validityDays,
    lineItems: q.lineItems.map((li) => ({
      description: li.description,
      specification: li.specification,
      make: li.make,
      model: li.model,
      quantity: li.quantity,
      unit: li.unit,
      rate: li.rate,
      amount: li.amount,
    })),
  }));

  const prompt = `You are a senior procurement analyst for an industrial plant. Compare these vendor quotations for the project "${project.name}" (${project.category || 'capex'}).
Scope: ${project.scopeOfWork || project.description || 'not provided'}
Budget: ${project.budgetAmount} ${quotesSummary[0]?.currency || 'INR'}

Quotations (JSON):
${JSON.stringify(quotesSummary, null, 2)}

Return ONLY valid JSON (no markdown) with this shape:
{
  "summary": "2-3 sentence executive summary",
  "ranking": [
    { "quotationId": "string - matches quotationId above", "tag": "Q1/Q2/...", "vendor": "string", "score": number 0-100, "rank": number, "pros": ["string", ...], "cons": ["string", ...], "risks": ["string", ...] }
  ],
  "recommendation": {
    "quotationId": "string - the recommended quote",
    "reason": "string - why this one",
    "negotiationPoints": ["string - what to negotiate before PO"]
  },
  "priceComparison": {
    "lowest": { "quotationId": "string", "amount": number },
    "highest": { "quotationId": "string", "amount": number },
    "spreadPercent": number,
    "vsBudget": "UNDER / OVER / WITHIN"
  },
  "redFlags": ["string - anything suspicious or missing across any quote"]
}

Scoring criteria (weighted): price 40%, technical specs/make 25%, delivery 15%, warranty 10%, payment terms 10%.
Be blunt. Flag if specs differ (apples vs oranges), if make is generic vs branded, if warranty is suspiciously short, if payment terms favor vendor heavily.`;

  try {
    const geminiRes = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      { contents: [{ parts: [{ text: prompt }] }] },
      { timeout: 60000 },
    );
    const rawText = geminiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonStr = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    let analysis: any = null;
    try { analysis = JSON.parse(jsonStr); } catch {
      res.status(500).json({ error: 'AI returned malformed JSON', raw: rawText.slice(0, 500) });
      return;
    }

    // Persist scores back on each quote
    if (Array.isArray(analysis?.ranking)) {
      await Promise.all(
        analysis.ranking.map((r: { quotationId?: string; score?: number; pros?: string[]; cons?: string[] }) => {
          if (!r.quotationId) return Promise.resolve();
          return prisma.projectQuotation.update({
            where: { id: r.quotationId },
            data: {
              aiScore: typeof r.score === 'number' ? r.score : null,
              aiNotes: [
                r.pros?.length ? `PROS: ${r.pros.join(' • ')}` : '',
                r.cons?.length ? `CONS: ${r.cons.join(' • ')}` : '',
              ].filter(Boolean).join('\n') || null,
            },
          }).catch(() => undefined);
        }),
      );
    }

    const updated = await prisma.projectPurchase.update({
      where: { id: project.id },
      data: {
        aiAnalysis: analysis,
        aiAnalysisAt: new Date(),
        status: project.status === 'COLLECTING_QUOTES' || project.status === 'DRAFT' ? 'UNDER_EVALUATION' : project.status,
      },
    });

    res.json({ project: updated, analysis });
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { error?: { message?: string } } }; message?: string })?.response?.data?.error?.message
      || (err as Error)?.message
      || 'AI analysis failed';
    res.status(500).json({ error: msg });
  }
}));

// ═══════════════════════════════════════════════
// POST /:id/award — mark a quotation as the winner
// ═══════════════════════════════════════════════
router.post('/:id/award', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { quotationId, reason } = req.body as { quotationId?: string; reason?: string };
  if (!quotationId) { res.status(400).json({ error: 'quotationId required' }); return; }

  const project = await prisma.projectPurchase.findUnique({ where: { id: req.params.id } });
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  const q = await prisma.projectQuotation.findUnique({ where: { id: quotationId } });
  if (!q || q.projectId !== project.id) { res.status(400).json({ error: 'Quotation does not belong to this project' }); return; }

  const updated = await prisma.$transaction(async (tx) => {
    // Clear previous winner flag
    await tx.projectQuotation.updateMany({ where: { projectId: project.id }, data: { isAwarded: false } });
    await tx.projectQuotation.update({ where: { id: quotationId }, data: { isAwarded: true } });
    return tx.projectPurchase.update({
      where: { id: project.id },
      data: {
        awardedQuotationId: quotationId,
        awardedAt: new Date(),
        awardedBy: req.user!.id,
        awardReason: reason || null,
        // Leave negotiatedTotal null — user MUST enter it explicitly in the Negotiate modal
        negotiatedTotal: null,
        status: 'AWARDED',
      },
    });
  });

  res.json(updated);
}));

// ═══════════════════════════════════════════════
// PUT /:id/negotiate — update post-award negotiated total + notes
// ═══════════════════════════════════════════════
router.put('/:id/negotiate', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { negotiatedTotal, negotiationNotes, inclGst, inclFreight, inclErection } = req.body as {
    negotiatedTotal?: number;
    negotiationNotes?: string;
    inclGst?: boolean;
    inclFreight?: boolean;
    inclErection?: boolean;
  };
  const project = await prisma.projectPurchase.findUnique({ where: { id: req.params.id } });
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  if (project.status !== 'AWARDED') { res.status(400).json({ error: 'Project must be AWARDED to set negotiated total' }); return; }
  if (typeof negotiatedTotal !== 'number' || negotiatedTotal <= 0) {
    res.status(400).json({ error: 'negotiatedTotal must be a positive number' });
    return;
  }

  const updated = await prisma.projectPurchase.update({
    where: { id: project.id },
    data: {
      negotiatedTotal,
      negotiationNotes: negotiationNotes ?? project.negotiationNotes,
      negotiationInclGst: typeof inclGst === 'boolean' ? inclGst : project.negotiationInclGst,
      negotiationInclFreight: typeof inclFreight === 'boolean' ? inclFreight : project.negotiationInclFreight,
      negotiationInclErection: typeof inclErection === 'boolean' ? inclErection : project.negotiationInclErection,
    },
  });
  res.json(updated);
}));

// ═══════════════════════════════════════════════
// PUT /:id/pre-po-checklist — save the contractual checklist (PBG/LD/etc.)
// the operator confirms before PO generation. Either set `checklist` with the
// terms map OR `waiverReason` to explicitly skip. Both are read by /generate-po.
// ═══════════════════════════════════════════════
const PRE_PO_CHECKLIST_FIELDS = [
  'pbg', 'ld', 'inspection', 'drawingApproval', 'documentation',
  'performanceGuarantee', 'statutoryClearances', 'spareParts',
] as const;
router.put('/:id/pre-po-checklist', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { checklist, waiverReason } = req.body as {
    checklist?: Record<string, string | null>;
    waiverReason?: string | null;
  };
  const project = await prisma.projectPurchase.findUnique({ where: { id: req.params.id } });
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  let storedChecklist: Record<string, unknown> | null = null;
  if (checklist && typeof checklist === 'object') {
    storedChecklist = {};
    for (const f of PRE_PO_CHECKLIST_FIELDS) {
      const v = checklist[f];
      if (typeof v === 'string' && v.trim().length > 0) storedChecklist[f] = v.trim();
    }
    storedChecklist.completedAt = new Date().toISOString();
    storedChecklist.completedBy = req.user!.id;
  }

  const dataPatch: Record<string, unknown> = {};
  if (storedChecklist) {
    dataPatch.prePOChecklist = storedChecklist;
  } else if (typeof waiverReason === 'string') {
    // Setting a waiver clears any stored checklist so the two paths don't conflict.
    dataPatch.prePOChecklist = Prisma.JsonNull;
  }
  if (typeof waiverReason === 'string') {
    dataPatch.prePOWaiverReason = waiverReason.trim() || null;
  }

  const updated = await prisma.projectPurchase.update({
    where: { id: project.id },
    data: dataPatch,
  });
  res.json(updated);
}));

// ═══════════════════════════════════════════════
// POST /:id/generate-po — create a PurchaseOrder from the awarded quotation
// ═══════════════════════════════════════════════
router.post('/:id/generate-po', asyncHandler(async (req: AuthRequest, res: Response) => {
  const project = await prisma.projectPurchase.findUnique({
    where: { id: req.params.id },
    include: { awardedQuotation: { include: { lineItems: { orderBy: { lineNo: 'asc' } }, vendor: true } } },
  });
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  if (!project.awardedQuotation) { res.status(400).json({ error: 'No awarded quotation — award one first' }); return; }
  if (!project.awardedQuotation.vendorId) {
    res.status(400).json({ error: 'Awarded quotation has no linked vendor. Edit the quote and select a vendor first.' });
    return;
  }

  const existingPO = await prisma.purchaseOrder.findUnique({ where: { projectPurchaseId: project.id } });
  if (existingPO) {
    res.status(400).json({ error: `PO already generated: PO-${existingPO.poNo}` });
    return;
  }

  // Pre-PO checklist gate — must have either a non-empty checklist with at least
  // the four critical contractual terms (PBG, LD, Inspection, Performance Guarantee)
  // filled, OR an explicit written waiver reason. Soft-gates that are easy to
  // dismiss become wallpaper; this stops POs from going out without recourse terms.
  const checklist = (project.prePOChecklist as Record<string, unknown> | null) || null;
  const waiver = project.prePOWaiverReason && project.prePOWaiverReason.trim().length > 0;
  const requiredKeys = ['pbg', 'ld', 'inspection', 'performanceGuarantee'] as const;
  const missingKeys = requiredKeys.filter(k => !checklist || typeof checklist[k] !== 'string' || (checklist[k] as string).trim().length === 0);
  if (!waiver && missingKeys.length > 0) {
    res.status(400).json({
      error: `Pre-PO checklist incomplete — fill ${missingKeys.join(', ')} (or record a waiver reason).`,
      missingKeys,
    });
    return;
  }

  const q = project.awardedQuotation;
  const companyId = getActiveCompanyId(req);
  const poNo = await nextDocNo('PurchaseOrder', 'poNo', companyId);

  // Resolve what the negotiated amount covers. Default to quote if user never negotiated.
  if (typeof project.negotiatedTotal !== 'number' || project.negotiatedTotal <= 0) {
    res.status(400).json({ error: 'Set a negotiated total before generating PO' });
    return;
  }
  const negotiated = project.negotiatedTotal;
  const inclGst = project.negotiationInclGst;
  const inclFreight = project.negotiationInclFreight;
  const inclErection = project.negotiationInclErection;

  // Denominator = the part of the quote the negotiated amount is meant to represent.
  // GST scales 1:1 with subtotal (line rates × gstPct), so it tracks subtotal always when inclGst.
  const denom = q.subtotal
    + (inclGst ? q.gstAmount : 0)
    + (inclFreight ? q.freight : 0)
    + (inclErection ? q.otherCharges : 0);
  // Without a breakdown we cannot scale into subtotal/GST/freight components.
  // Previously the scaleFactor=1 fallback produced a ₹0 PO. Force the user to fix the quote first.
  if (denom <= 0) {
    res.status(400).json({
      error: 'Awarded quotation has no subtotal / GST / freight breakdown — edit the quote and enter rates before generating PO.',
    });
    return;
  }
  const scaleFactor = negotiated / denom;

  const scaledSubtotal = q.subtotal * scaleFactor;
  const scaledGst = q.gstAmount * scaleFactor; // GST always follows subtotal
  const scaledFreight = inclFreight ? q.freight * scaleFactor : q.freight;
  const scaledOther = inclErection ? q.otherCharges * scaleFactor : q.otherCharges;
  const newGrandTotal = scaledSubtotal + scaledGst + scaledFreight + scaledOther;

  const inclFlags = [
    inclGst ? 'GST' : null,
    inclFreight ? 'Freight' : null,
    inclErection ? 'Erection' : null,
  ].filter(Boolean).join('+') || 'ex-all';

  const remarkParts = [
    q.warranty ? `Warranty: ${q.warranty}` : '',
    q.deliveryPeriod ? `Delivery: ${q.deliveryPeriod}` : '',
    project.negotiationNotes ? `Negotiation: ${project.negotiationNotes}` : '',
    `Negotiated ₹${negotiated.toFixed(0)} (incl ${inclFlags}); quote ₹${q.totalAmount.toFixed(0)}; final PO ₹${newGrandTotal.toFixed(0)}`,
  ].filter(Boolean).join(' | ');

  const po = await prisma.$transaction(async (tx) => {
    const created = await tx.purchaseOrder.create({
      data: {
        poNo,
        vendorId: q.vendorId!,
        poDate: new Date(),
        supplyType: 'INTRA_STATE',
        poType: 'PROJECT',
        dealType: 'STANDARD',
        status: 'DRAFT',
        paymentTerms: q.paymentTerms || '',
        remarks: remarkParts,
        subtotal: scaledSubtotal,
        totalGst: scaledGst,
        freightCharge: scaledFreight,
        otherCharges: scaledOther,
        grandTotal: newGrandTotal,
        quotationNo: q.quotationNo,
        quotationDate: q.quotationDate,
        projectName: project.name,
        projectPurchaseId: project.id,
        userId: req.user!.id,
        companyId,
        lines: {
          create: q.lineItems.map((li) => ({
            lineNo: li.lineNo,
            description: [li.description, li.specification].filter(Boolean).join(' | '),
            hsnCode: li.hsnSac || '',
            quantity: li.quantity,
            unit: li.unit,
            rate: li.rate * scaleFactor,
            discountPercent: 0,
            gstPercent: li.gstPercent,
            amount: li.amount * scaleFactor,
            taxableAmount: li.amount * scaleFactor,
            cgstPercent: 0,
            sgstPercent: 0,
            igstPercent: 0,
            cgstAmount: 0,
            sgstAmount: 0,
            igstAmount: 0,
            rateSnapshotGst: li.gstPercent,
          })),
        },
      },
    });

    await tx.projectPurchase.update({
      where: { id: project.id },
      data: { status: 'PO_RAISED' },
    });

    return created;
  });

  res.json({ po });
}));

export default router;
