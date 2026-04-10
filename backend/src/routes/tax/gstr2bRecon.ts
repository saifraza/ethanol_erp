import { Router, Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { asyncHandler, validate } from '../../shared/middleware';
import { NotFoundError } from '../../shared/errors';
import { z } from 'zod';
import prisma from '../../config/prisma';

const router = Router();

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

/** Normalize invoice number for matching (GSTN truncates to 16 chars, uppercases) */
function normalizeInvNo(inv: string): string {
  return inv.trim().toUpperCase().replace(/\s+/g, '').slice(0, 16);
}

/** Parse GSTN date format dd-mm-yyyy → Date */
function parseGstnDate(d: string): Date | null {
  if (!d) return null;
  const parts = d.split('-');
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts;
  return new Date(`${yyyy}-${mm}-${dd}`);
}

/** Parse filing period MMYYYY → { month, year } */
function parseFP(fp: string): { month: number; year: number } {
  return { month: parseInt(fp.slice(0, 2)), year: parseInt(fp.slice(2)) };
}

// ═══════════════════════════════════════════════
// Zod Schemas
// ═══════════════════════════════════════════════

const uploadSchema = z.object({
  returnType: z.enum(['2A', '2B']),
  json: z.object({
    gstin: z.string().min(15).max(15),
    fp: z.string().min(6).max(6),
    docdata: z.object({
      b2b: z.array(z.object({
        ctin: z.string(),
        trdnm: z.string().optional(),
        inv: z.array(z.object({
          inum: z.string(),
          idt: z.string(),
          val: z.number(),
          pos: z.string().optional(),
          rev: z.string().optional(),
          itcavl: z.string().optional(),
          rsn: z.string().optional(),
          diffprcnt: z.number().optional(),
          items: z.array(z.object({
            num: z.number().optional(),
            rt: z.number().optional(),
            txval: z.number().optional().default(0),
            igst: z.number().optional().default(0),
            cgst: z.number().optional().default(0),
            sgst: z.number().optional().default(0),
            cess: z.number().optional().default(0),
          })).optional().default([]),
        })),
      })).optional().default([]),
      cdnr: z.array(z.unknown()).optional().default([]),
      b2ba: z.array(z.unknown()).optional().default([]),
    }).passthrough(),
  }),
});

const manualMatchSchema = z.object({
  entryId: z.string().min(1),
  vendorInvoiceId: z.string().min(1),
});

// ═══════════════════════════════════════════════
// GET /runs — List reconciliation runs
// ═══════════════════════════════════════════════
router.get('/runs', asyncHandler(async (req: AuthRequest, res: Response) => {
  const take = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const skip = parseInt(req.query.offset as string) || 0;

  const [items, total] = await Promise.all([
    prisma.gstReconRun.findMany({
      take, skip,
      orderBy: { uploadedAt: 'desc' },
      select: {
        id: true, returnType: true, filingPeriod: true,
        periodMonth: true, periodYear: true, buyerGstin: true,
        uploadedAt: true, uploadedBy: true, status: true,
        totalPortal: true, totalBooks: true, matched: true,
        onlyInPortal: true, onlyInBooks: true, mismatch: true,
        itcMatched: true, itcAtRisk: true,
      },
    }),
    prisma.gstReconRun.count(),
  ]);
  res.json({ items, total });
}));

// ═══════════════════════════════════════════════
// POST /upload — Parse 2A/2B JSON, create run + entries
// ═══════════════════════════════════════════════
router.post('/upload', validate(uploadSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { returnType, json } = req.body;
  const { month, year } = parseFP(json.fp);

  const run = await prisma.gstReconRun.create({
    data: {
      returnType,
      filingPeriod: json.fp,
      periodMonth: month,
      periodYear: year,
      buyerGstin: json.gstin,
      uploadedBy: req.user!.id,
      rawJson: JSON.stringify(json),
    },
  });

  // Parse b2b invoices
  const entries: Array<{
    runId: string; source: string; supplierGstin: string; supplierName: string;
    invoiceNumber: string; invoiceDate: Date | null; invoiceValue: number;
    taxableValue: number; cgst: number; sgst: number; igst: number; cess: number;
    totalGst: number; isRCM: boolean; itcAvailable: string | null;
  }> = [];

  for (const supplier of (json.docdata.b2b || [])) {
    for (const inv of supplier.inv) {
      // Aggregate items
      let taxableValue = 0, cgst = 0, sgst = 0, igst = 0, cess = 0;
      for (const item of (inv.items || [])) {
        taxableValue += item.txval || 0;
        cgst += item.cgst || 0;
        sgst += item.sgst || 0;
        igst += item.igst || 0;
        cess += item.cess || 0;
      }

      entries.push({
        runId: run.id,
        source: 'PORTAL',
        supplierGstin: supplier.ctin,
        supplierName: supplier.trdnm || '',
        invoiceNumber: inv.inum,
        invoiceDate: parseGstnDate(inv.idt),
        invoiceValue: inv.val,
        taxableValue,
        cgst, sgst, igst, cess,
        totalGst: cgst + sgst + igst + cess,
        isRCM: inv.rev === 'Y',
        itcAvailable: inv.itcavl || null,
      });
    }
  }

  if (entries.length > 0) {
    await prisma.gstReconEntry.createMany({ data: entries });
  }

  await prisma.gstReconRun.update({
    where: { id: run.id },
    data: { totalPortal: entries.length },
  });

  res.status(201).json({ runId: run.id, portalInvoices: entries.length });
}));

// ═══════════════════════════════════════════════
// POST /:runId/auto-match — Three-pass matching
// ═══════════════════════════════════════════════
router.post('/:runId/auto-match', asyncHandler(async (req: AuthRequest, res: Response) => {
  const run = await prisma.gstReconRun.findUnique({ where: { id: req.params.runId } });
  if (!run) throw new NotFoundError('GstReconRun', req.params.runId);

  // Pass 1: Match portal entries to VendorInvoice
  const portalEntries = await prisma.gstReconEntry.findMany({
    where: { runId: run.id, source: 'PORTAL', matchStatus: { in: ['PENDING', 'ONLY_IN_PORTAL'] } },
  });

  let matchedCount = 0;
  let mismatchCount = 0;
  let itcMatched = 0;

  for (const entry of portalEntries) {
    const normInvNo = normalizeInvNo(entry.invoiceNumber);

    // Find vendor invoices where vendor GSTIN matches
    const candidates = await prisma.vendorInvoice.findMany({
      where: {
        vendor: { gstin: entry.supplierGstin },
        vendorInvDate: {
          gte: new Date(run.periodYear, run.periodMonth - 1, 1),
          lt: new Date(run.periodMonth === 12 ? run.periodYear + 1 : run.periodYear, run.periodMonth === 12 ? 0 : run.periodMonth, 1),
        },
      },
      select: {
        id: true, vendorInvNo: true, vendorInvDate: true,
        totalAmount: true, totalGst: true,
        cgstAmount: true, sgstAmount: true, igstAmount: true,
        vendor: { select: { id: true, name: true, gstin: true } },
      },
    });

    // Find best match by normalized invoice number
    const match = candidates.find(c =>
      normalizeInvNo(c.vendorInvNo || '') === normInvNo
    );

    if (match) {
      const diffCgst = entry.cgst - (match.cgstAmount || 0);
      const diffSgst = entry.sgst - (match.sgstAmount || 0);
      const diffIgst = entry.igst - (match.igstAmount || 0);
      const diffTotal = Math.abs(diffCgst) + Math.abs(diffSgst) + Math.abs(diffIgst);

      const isMismatch = diffTotal > 1; // tolerance ±₹1

      await prisma.gstReconEntry.update({
        where: { id: entry.id },
        data: {
          matchStatus: isMismatch ? 'MISMATCH' : 'MATCHED',
          matchMethod: 'AUTO',
          vendorInvoiceId: match.id,
          taxDiffCgst: diffCgst,
          taxDiffSgst: diffSgst,
          taxDiffIgst: diffIgst,
          taxDiffTotal: diffTotal,
        },
      });

      if (isMismatch) {
        mismatchCount++;
      } else {
        matchedCount++;
        itcMatched += entry.totalGst;
      }
    } else {
      await prisma.gstReconEntry.update({
        where: { id: entry.id },
        data: { matchStatus: 'ONLY_IN_PORTAL' },
      });
    }
  }

  // Pass 2: Find vendor invoices in the period NOT matched to any portal entry
  const periodStart = new Date(run.periodYear, run.periodMonth - 1, 1);
  const periodEnd = new Date(run.periodMonth === 12 ? run.periodYear + 1 : run.periodYear, run.periodMonth === 12 ? 0 : run.periodMonth, 1);

  // Get all VendorInvoice IDs already matched in this run
  const matchedVIIds = await prisma.gstReconEntry.findMany({
    where: { runId: run.id, vendorInvoiceId: { not: null } },
    select: { vendorInvoiceId: true },
  });
  const matchedIds = new Set(matchedVIIds.map(e => e.vendorInvoiceId!));

  const bookInvoices = await prisma.vendorInvoice.findMany({
    where: {
      vendorInvDate: { gte: periodStart, lt: periodEnd },
      totalGst: { gt: 0 },
      vendor: { gstin: { not: null } },
    },
    select: {
      id: true, vendorInvNo: true, vendorInvDate: true,
      totalAmount: true, totalGst: true,
      cgstAmount: true, sgstAmount: true, igstAmount: true,
      isRCM: true,
      vendor: { select: { name: true, gstin: true } },
    },
  });

  const booksOnlyEntries: Array<{
    runId: string; source: string; supplierGstin: string; supplierName: string;
    invoiceNumber: string; invoiceDate: Date | null; invoiceValue: number;
    taxableValue: number; cgst: number; sgst: number; igst: number;
    totalGst: number; isRCM: boolean; matchStatus: string; vendorInvoiceId: string;
  }> = [];

  for (const vi of bookInvoices) {
    if (matchedIds.has(vi.id)) continue;
    booksOnlyEntries.push({
      runId: run.id,
      source: 'BOOKS',
      supplierGstin: vi.vendor.gstin || '',
      supplierName: vi.vendor.name,
      invoiceNumber: vi.vendorInvNo || '',
      invoiceDate: vi.vendorInvDate,
      invoiceValue: vi.totalAmount || 0,
      taxableValue: (vi.totalAmount || 0) - (vi.totalGst || 0),
      cgst: vi.cgstAmount || 0,
      sgst: vi.sgstAmount || 0,
      igst: vi.igstAmount || 0,
      totalGst: vi.totalGst || 0,
      isRCM: vi.isRCM || false,
      matchStatus: 'ONLY_IN_BOOKS',
      vendorInvoiceId: vi.id,
    });
  }

  if (booksOnlyEntries.length > 0) {
    await prisma.gstReconEntry.createMany({ data: booksOnlyEntries });
  }

  // Pass 3: Update run summary
  const onlyInPortal = await prisma.gstReconEntry.count({ where: { runId: run.id, matchStatus: 'ONLY_IN_PORTAL' } });
  const onlyInBooks = booksOnlyEntries.length;
  const itcAtRisk = booksOnlyEntries.reduce((sum, e) => sum + e.totalGst, 0);

  await prisma.gstReconRun.update({
    where: { id: run.id },
    data: {
      status: 'MATCHED',
      totalBooks: bookInvoices.length,
      matched: matchedCount,
      onlyInPortal,
      onlyInBooks,
      mismatch: mismatchCount,
      itcMatched,
      itcAtRisk,
    },
  });

  res.json({
    matched: matchedCount,
    mismatch: mismatchCount,
    onlyInPortal,
    onlyInBooks,
    itcMatched,
    itcAtRisk,
  });
}));

// ═══════════════════════════════════════════════
// GET /:runId/entries — List entries (paginated, filterable)
// ═══════════════════════════════════════════════
router.get('/:runId/entries', asyncHandler(async (req: AuthRequest, res: Response) => {
  const take = Math.min(parseInt(req.query.limit as string) || 50, 500);
  const skip = parseInt(req.query.offset as string) || 0;
  const matchStatus = req.query.matchStatus as string | undefined;

  const where: Record<string, unknown> = { runId: req.params.runId };
  if (matchStatus && matchStatus !== 'ALL') where.matchStatus = matchStatus;

  const [items, total] = await Promise.all([
    prisma.gstReconEntry.findMany({
      where,
      take, skip,
      orderBy: { supplierGstin: 'asc' },
      select: {
        id: true, source: true, supplierGstin: true, supplierName: true,
        invoiceNumber: true, invoiceDate: true, invoiceValue: true,
        taxableValue: true, cgst: true, sgst: true, igst: true, cess: true,
        totalGst: true, isRCM: true, itcAvailable: true,
        matchStatus: true, matchMethod: true, vendorInvoiceId: true,
        taxDiffCgst: true, taxDiffSgst: true, taxDiffIgst: true, taxDiffTotal: true,
        notes: true,
      },
    }),
    prisma.gstReconEntry.count({ where }),
  ]);

  res.json({ items, total });
}));

// ═══════════════════════════════════════════════
// GET /:runId/suggestions/:entryId — Manual match candidates
// ═══════════════════════════════════════════════
router.get('/:runId/suggestions/:entryId', asyncHandler(async (req: AuthRequest, res: Response) => {
  const entry = await prisma.gstReconEntry.findUnique({ where: { id: req.params.entryId } });
  if (!entry || entry.runId !== req.params.runId) throw new NotFoundError('GstReconEntry', req.params.entryId);

  const run = await prisma.gstReconRun.findUnique({ where: { id: req.params.runId } });
  if (!run) throw new NotFoundError('GstReconRun', req.params.runId);

  const periodStart = new Date(run.periodYear, run.periodMonth - 1, 1);
  // Wider window: ±1 month
  const periodEnd = new Date(run.periodMonth >= 11 ? run.periodYear + 1 : run.periodYear, (run.periodMonth + 1) % 12, 1);

  const candidates = await prisma.vendorInvoice.findMany({
    where: {
      vendor: { gstin: entry.supplierGstin },
      vendorInvDate: { gte: periodStart, lt: periodEnd },
    },
    select: {
      id: true, vendorInvNo: true, vendorInvDate: true,
      totalAmount: true, totalGst: true,
      cgstAmount: true, sgstAmount: true, igstAmount: true,
      vendor: { select: { name: true, gstin: true } },
    },
    take: 20,
    orderBy: { vendorInvDate: 'desc' },
  });

  // Score by similarity
  const normTarget = normalizeInvNo(entry.invoiceNumber);
  const scored = candidates.map(c => {
    const normC = normalizeInvNo(c.vendorInvNo || '');
    const invNoMatch = normC === normTarget;
    const gstDiff = Math.abs(entry.totalGst - (c.totalGst || 0));
    return { ...c, invNoMatch, gstDiff };
  }).sort((a, b) => {
    if (a.invNoMatch !== b.invNoMatch) return a.invNoMatch ? -1 : 1;
    return a.gstDiff - b.gstDiff;
  });

  res.json(scored);
}));

// ═══════════════════════════════════════════════
// POST /:runId/manual-match — Link entry to VendorInvoice
// ═══════════════════════════════════════════════
router.post('/:runId/manual-match', validate(manualMatchSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { entryId, vendorInvoiceId } = req.body;
  const entry = await prisma.gstReconEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.runId !== req.params.runId) throw new NotFoundError('GstReconEntry', entryId);

  const vi = await prisma.vendorInvoice.findUnique({
    where: { id: vendorInvoiceId },
    select: { id: true, cgstAmount: true, sgstAmount: true, igstAmount: true, totalGst: true },
  });
  if (!vi) throw new NotFoundError('VendorInvoice', vendorInvoiceId);

  const diffCgst = entry.cgst - (vi.cgstAmount || 0);
  const diffSgst = entry.sgst - (vi.sgstAmount || 0);
  const diffIgst = entry.igst - (vi.igstAmount || 0);
  const diffTotal = Math.abs(diffCgst) + Math.abs(diffSgst) + Math.abs(diffIgst);

  await prisma.gstReconEntry.update({
    where: { id: entryId },
    data: {
      matchStatus: diffTotal > 1 ? 'MISMATCH' : 'MATCHED',
      matchMethod: 'MANUAL',
      vendorInvoiceId,
      taxDiffCgst: diffCgst,
      taxDiffSgst: diffSgst,
      taxDiffIgst: diffIgst,
      taxDiffTotal: diffTotal,
    },
  });

  // If there's a BOOKS entry for the same VI, remove it (now matched)
  await prisma.gstReconEntry.deleteMany({
    where: { runId: req.params.runId, source: 'BOOKS', vendorInvoiceId, id: { not: entryId } },
  });

  // Recompute summary
  await recomputeRunSummary(req.params.runId);

  res.json({ matched: true, diffTotal });
}));

// ═══════════════════════════════════════════════
// POST /:runId/unmatch/:entryId — Revert a match
// ═══════════════════════════════════════════════
router.post('/:runId/unmatch/:entryId', asyncHandler(async (req: AuthRequest, res: Response) => {
  const entry = await prisma.gstReconEntry.findUnique({ where: { id: req.params.entryId } });
  if (!entry || entry.runId !== req.params.runId) throw new NotFoundError('GstReconEntry', req.params.entryId);

  if (entry.source === 'BOOKS') {
    // BOOKS entries are just deleted on unmatch
    await prisma.gstReconEntry.delete({ where: { id: entry.id } });
  } else {
    await prisma.gstReconEntry.update({
      where: { id: entry.id },
      data: {
        matchStatus: 'ONLY_IN_PORTAL',
        matchMethod: null,
        vendorInvoiceId: null,
        taxDiffCgst: null, taxDiffSgst: null, taxDiffIgst: null, taxDiffTotal: null,
      },
    });
  }

  await recomputeRunSummary(req.params.runId);
  res.json({ unmatched: true });
}));

// ═══════════════════════════════════════════════
// GET /:runId/export — CSV download
// ═══════════════════════════════════════════════
router.get('/:runId/export', asyncHandler(async (req: AuthRequest, res: Response) => {
  const run = await prisma.gstReconRun.findUnique({ where: { id: req.params.runId } });
  if (!run) throw new NotFoundError('GstReconRun', req.params.runId);

  const entries = await prisma.gstReconEntry.findMany({
    where: { runId: run.id },
    orderBy: [{ matchStatus: 'asc' }, { supplierGstin: 'asc' }],
  });

  const header = 'Source,Supplier GSTIN,Supplier Name,Invoice No,Invoice Date,Invoice Value,Taxable Value,CGST,SGST,IGST,Cess,Total GST,RCM,ITC Available,Match Status,Match Method,Diff CGST,Diff SGST,Diff IGST,Diff Total';
  const rows = entries.map(e => [
    e.source, e.supplierGstin, `"${(e.supplierName || '').replace(/"/g, '""')}"`,
    e.invoiceNumber, e.invoiceDate ? e.invoiceDate.toISOString().slice(0, 10) : '',
    e.invoiceValue, e.taxableValue, e.cgst, e.sgst, e.igst, e.cess, e.totalGst,
    e.isRCM ? 'Y' : 'N', e.itcAvailable || '',
    e.matchStatus, e.matchMethod || '',
    e.taxDiffCgst ?? '', e.taxDiffSgst ?? '', e.taxDiffIgst ?? '', e.taxDiffTotal ?? '',
  ].join(','));

  const csv = [header, ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="gst-recon-${run.returnType}-${run.filingPeriod}.csv"`);
  res.send(csv);
}));

// ═══════════════════════════════════════════════
// Helper: Recompute run summary counts
// ═══════════════════════════════════════════════
async function recomputeRunSummary(runId: string) {
  const counts = await prisma.gstReconEntry.groupBy({
    by: ['matchStatus'],
    where: { runId },
    _count: { id: true },
    _sum: { totalGst: true },
  });

  const get = (status: string) => counts.find(c => c.matchStatus === status);
  const matched = get('MATCHED')?._count?.id || 0;
  const onlyInPortal = get('ONLY_IN_PORTAL')?._count?.id || 0;
  const onlyInBooks = get('ONLY_IN_BOOKS')?._count?.id || 0;
  const mismatch = get('MISMATCH')?._count?.id || 0;
  const itcMatched = get('MATCHED')?._sum?.totalGst || 0;
  const itcAtRisk = (get('ONLY_IN_BOOKS')?._sum?.totalGst || 0) + (get('MISMATCH')?._sum?.totalGst || 0);

  await prisma.gstReconRun.update({
    where: { id: runId },
    data: { matched, onlyInPortal, onlyInBooks, mismatch, itcMatched, itcAtRisk },
  });
}

export default router;
