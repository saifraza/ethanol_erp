import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { nextDocNo } from '../utils/docSequence';

const router = Router();
router.use(authenticate as any);

// ── Multer for quotation uploads ──
const uploadDir = path.join(__dirname, '../../uploads/project-quotations');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

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
router.post('/:id/quotations/upload', upload.single('file'), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
  const project = await prisma.projectPurchase.findUnique({ where: { id: req.params.id } });
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  const fileUrl = `project-quotations/${req.file.filename}`;
  const fileBuffer = fs.readFileSync(req.file.path);
  const mimeType = req.file.mimetype;

  // Create quotation stub immediately so client has an ID
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

  // Bump project to COLLECTING_QUOTES if still DRAFT
  if (project.status === 'DRAFT') {
    await prisma.projectPurchase.update({ where: { id: project.id }, data: { status: 'COLLECTING_QUOTES' } });
  }

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) {
    await prisma.projectQuotation.update({
      where: { id: quotation.id },
      data: { parseStatus: 'MANUAL', parseError: 'GEMINI_API_KEY not configured — fill manually' },
    });
    res.json({ quotation, extracted: null, warning: 'AI parsing unavailable — fill fields manually' });
    return;
  }

  try {
    const base64 = fileBuffer.toString('base64');
    const prompt = `You are reading a vendor quotation / proforma invoice for a capital project purchase (mechanical, civil, electrical, instrumentation, IT, etc.).
Return ONLY valid JSON (no markdown) with these keys:
{
  "vendor_name": "string - supplier/vendor name",
  "vendor_contact": "string - email or phone if visible",
  "gstin": "string or null",
  "quotation_number": "string or null",
  "quotation_date": "YYYY-MM-DD or null",
  "validity_days": number or null,
  "delivery_period": "string - e.g. '15 days', '4 weeks', 'ex-stock'",
  "warranty": "string - warranty terms",
  "payment_terms": "string - e.g. '50% advance, 50% on delivery'",
  "line_items": [
    {
      "description": "string - item/service name",
      "specification": "string - specs, capacity, dimensions, standards",
      "make": "string - brand/make or null",
      "model": "string - model no or null",
      "quantity": number,
      "unit": "string - NOS, SET, KG, MT, etc.",
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
  "currency": "INR / USD / EUR"
}
Rules:
- If a field is missing in the document, use null for strings/dates and 0 for numbers.
- For line items, preserve vendor's wording in description.
- specification should include make/capacity/standards if present.
- Return ONLY JSON — no commentary, no markdown fences.`;

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
      { timeout: 60000 },
    );

    const rawText = geminiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonStr = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    let extracted: any = null;
    try { extracted = JSON.parse(jsonStr); } catch { extracted = null; }

    if (!extracted) {
      await prisma.projectQuotation.update({
        where: { id: quotation.id },
        data: { parseStatus: 'FAILED', parseError: 'Could not parse JSON from AI response', extractedJson: { raw: rawText } },
      });
      res.json({ quotation, extracted: null, warning: 'AI parse failed — fill manually' });
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

    const updated = await prisma.projectQuotation.update({
      where: { id: quotation.id },
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
      include: { lineItems: { orderBy: { lineNo: 'asc' } }, vendor: { select: { id: true, name: true, gstin: true } } },
    });

    res.json({ quotation: updated, extracted, matchedVendorId });
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { error?: { message?: string } } }; message?: string })?.response?.data?.error?.message
      || (err as Error)?.message
      || 'AI extraction failed';
    await prisma.projectQuotation.update({
      where: { id: quotation.id },
      data: { parseStatus: 'FAILED', parseError: msg },
    });
    res.json({ quotation, extracted: null, error: msg });
  }
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
  const q = await prisma.projectQuotation.findUnique({ where: { id: req.params.qid }, select: { id: true, isAwarded: true } });
  if (!q) { res.status(404).json({ error: 'Not found' }); return; }
  if (q.isAwarded) { res.status(400).json({ error: 'Cannot delete an awarded quotation' }); return; }
  await prisma.projectQuotation.delete({ where: { id: req.params.qid } });
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
        status: 'AWARDED',
      },
    });
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

  const q = project.awardedQuotation;
  const companyId = getActiveCompanyId(req);
  const poNo = await nextDocNo('PurchaseOrder', 'poNo', companyId);

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
        remarks: [q.warranty ? `Warranty: ${q.warranty}` : '', q.deliveryPeriod ? `Delivery: ${q.deliveryPeriod}` : ''].filter(Boolean).join(' | '),
        subtotal: q.subtotal,
        totalGst: q.gstAmount,
        freightCharge: q.freight,
        otherCharges: q.otherCharges,
        grandTotal: q.totalAmount,
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
            rate: li.rate,
            discountPercent: 0,
            gstPercent: li.gstPercent,
            amount: li.amount,
            taxableAmount: li.amount,
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
