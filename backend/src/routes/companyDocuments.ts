import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { NotFoundError } from '../shared/errors';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { lightragUpload, lightragClassify, isRagEnabled } from '../services/lightragClient';
import { generateVaultNote } from '../services/vaultWriter';

const router = Router();
router.use(authenticate as any);

// ── Multer setup ─────────────────────────────────────────
const uploadDir = path.resolve(__dirname, '../../uploads/company-documents');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB for compliance docs
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.doc', '.docx', '.xls', '.xlsx', '.tif', '.tiff'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`File type ${ext} not allowed`));
  },
});

// ── Schemas ──────────────────────────────────────────────
const createSchema = z.object({
  category: z.string().min(1),
  subcategory: z.string().optional(),
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  issuedBy: z.string().optional(),
  issuedDate: z.string().optional(),
  expiryDate: z.string().optional(),
  referenceNo: z.string().optional(),
  department: z.string().optional(),
  tags: z.string().optional(),
});

const updateSchema = z.object({
  category: z.string().optional(),
  subcategory: z.string().optional(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().optional(),
  issuedBy: z.string().optional(),
  issuedDate: z.string().optional(),
  expiryDate: z.string().optional(),
  referenceNo: z.string().optional(),
  department: z.string().optional(),
  tags: z.string().optional(),
  status: z.enum(['ACTIVE', 'EXPIRED', 'SUPERSEDED', 'ARCHIVED']).optional(),
});

// ═══════════════════════════════════════════════════════════
// GET / — List documents with filters
// ═══════════════════════════════════════════════════════════
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const take = Math.min(parseInt(req.query.limit as string) || 50, 500);
  const skip = parseInt(req.query.offset as string) || 0;
  const category = req.query.category as string;
  const status = req.query.status as string;
  const search = req.query.search as string;
  const expiringDays = parseInt(req.query.expiringDays as string);

  const where: Record<string, unknown> = {};
  if (category) where.category = category;
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { referenceNo: { contains: search, mode: 'insensitive' } },
      { issuedBy: { contains: search, mode: 'insensitive' } },
      { tags: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (expiringDays && expiringDays > 0) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + expiringDays);
    where.expiryDate = { lte: cutoff, gte: new Date() };
    where.status = 'ACTIVE';
  }

  const [docs, total] = await Promise.all([
    prisma.companyDocument.findMany({
      where: where as any,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      select: {
        id: true,
        category: true,
        subcategory: true,
        title: true,
        fileName: true,
        filePath: true,
        issuedBy: true,
        issuedDate: true,
        expiryDate: true,
        referenceNo: true,
        department: true,
        status: true,
        ragIndexed: true,
        createdAt: true,
      },
    }),
    prisma.companyDocument.count({ where: where as any }),
  ]);

  // Optionally include expiring docs in same response (saves a round trip)
  let expiring: any[] | undefined;
  if (req.query.includeExpiring === 'true') {
    const expiringCutoff = new Date();
    expiringCutoff.setDate(expiringCutoff.getDate() + 30);
    expiring = await prisma.companyDocument.findMany({
      where: {
        status: 'ACTIVE',
        expiryDate: { lte: expiringCutoff, gte: new Date() },
      },
      orderBy: { expiryDate: 'asc' },
      take: 50,
      select: {
        id: true, category: true, subcategory: true, title: true,
        expiryDate: true, referenceNo: true, issuedBy: true,
      },
    });

    // Fire-and-forget: mark expired docs (don't block response)
    prisma.companyDocument.updateMany({
      where: { status: 'ACTIVE', expiryDate: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    }).catch(err => console.error('Failed to mark expired docs:', err));
  }

  res.json({ documents: docs, total, ...(expiring !== undefined && { expiring }) });
}));

// ═══════════════════════════════════════════════════════════
// GET /expiring — Documents expiring soon (for alerts)
// ═══════════════════════════════════════════════════════════
router.get('/expiring', asyncHandler(async (req: AuthRequest, res: Response) => {
  const days = parseInt(req.query.days as string) || 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);

  const docs = await prisma.companyDocument.findMany({
    where: {
      status: 'ACTIVE',
      expiryDate: { lte: cutoff, gte: new Date() },
    },
    orderBy: { expiryDate: 'asc' },
    take: 50,
    select: {
      id: true,
      category: true,
      subcategory: true,
      title: true,
      expiryDate: true,
      referenceNo: true,
      issuedBy: true,
    },
  });

  // Fire-and-forget: mark expired docs (don't block response)
  prisma.companyDocument.updateMany({
    where: {
      status: 'ACTIVE',
      expiryDate: { lt: new Date() },
    },
    data: { status: 'EXPIRED' },
  }).catch(err => console.error('Failed to mark expired docs:', err));

  res.json({ documents: docs, withinDays: days });
}));

// ═══════════════════════════════════════════════════════════
// GET /:id — Get document details
// ═══════════════════════════════════════════════════════════
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const doc = await prisma.companyDocument.findUnique({
    where: { id: req.params.id },
  });
  if (!doc) throw new NotFoundError('CompanyDocument', req.params.id);
  res.json(doc);
}));

// ═══════════════════════════════════════════════════════════
// POST / — Upload new document
// ═══════════════════════════════════════════════════════════
router.post('/', upload.single('file'), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

  // Parse JSON fields from multipart form
  const body = req.body;
  const doc = await prisma.companyDocument.create({
    data: {
      category: body.category || 'OTHER',
      subcategory: body.subcategory || null,
      title: body.title || req.file.originalname,
      description: body.description || null,
      filePath: `company-documents/${req.file.filename}`,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      issuedBy: body.issuedBy || null,
      issuedDate: body.issuedDate ? new Date(body.issuedDate) : null,
      expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
      referenceNo: body.referenceNo || null,
      department: body.department || null,
      tags: body.tags || null,
      uploadedBy: req.user!.id,
    },
  });

  // Fire-and-forget: send to LightRAG for indexing
  if (isRagEnabled()) {
    setImmediate(() => {
      lightragUpload(`company-documents/${req.file!.filename}`, {
        sourceType: 'CompanyDocument',
        sourceId: doc.id,
        title: doc.title,
        deepScan: body.deepScan === 'true',
      })
        .then(result => {
          if (result.success) {
            prisma.companyDocument.update({
              where: { id: doc.id },
              data: { ragIndexed: true, ragTrackId: result.trackId },
            }).catch(() => {});
          }
        })
        .catch(err => console.error('[CompanyDoc] LightRAG indexing failed:', err));
    });
  }

  // Fire-and-forget: generate vault note (Obsidian knowledge base)
  setImmediate(() => {
    generateVaultNote({
      sourceType: 'CompanyDocument',
      sourceId: doc.id,
      filePath: `company-documents/${req.file!.filename}`,
      title: doc.title,
      category: doc.category,
      mimeType: req.file!.mimetype,
      issuedBy: doc.issuedBy || undefined,
      issuedDate: doc.issuedDate?.toISOString().split('T')[0],
      expiryDate: doc.expiryDate?.toISOString().split('T')[0],
      referenceNo: doc.referenceNo || undefined,
    }).catch(err => console.error('[CompanyDoc] Vault note generation failed:', err));
  });

  res.status(201).json(doc);
}));

// ═══════════════════════════════════════════════════════════
// POST /classify — Auto-categorize an uploaded file using AI
// ═══════════════════════════════════════════════════════════
router.post('/classify', upload.single('file'), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
  if (!isRagEnabled()) { res.status(503).json({ error: 'RAG service not configured' }); return; }

  const result = await lightragClassify(`company-documents/${req.file.filename}`);

  // Clean up temp file after classification
  const filePath = path.resolve(__dirname, '../../uploads/company-documents', req.file.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  if (!result.success) {
    res.status(502).json({ error: result.error || 'Classification failed' });
    return;
  }

  res.json(result.metadata);
}));

// ═══════════════════════════════════════════════════════════
// PUT /:id — Update document metadata
// ═══════════════════════════════════════════════════════════
router.put('/:id', validate(updateSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.companyDocument.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new NotFoundError('CompanyDocument', req.params.id);

  const data: Record<string, unknown> = { ...req.body };
  if (data.issuedDate) data.issuedDate = new Date(data.issuedDate as string);
  if (data.expiryDate) data.expiryDate = new Date(data.expiryDate as string);

  const doc = await prisma.companyDocument.update({
    where: { id: req.params.id },
    data: data as any,
  });

  res.json(doc);
}));

// ═══════════════════════════════════════════════════════════
// DELETE /:id — Delete document
// ═══════════════════════════════════════════════════════════
router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const doc = await prisma.companyDocument.findUnique({ where: { id: req.params.id } });
  if (!doc) throw new NotFoundError('CompanyDocument', req.params.id);

  // Delete file from disk (validate path stays within uploads dir)
  const uploadsRoot = path.resolve(__dirname, '../../uploads');
  const absPath = path.resolve(uploadsRoot, doc.filePath);
  if (absPath.startsWith(uploadsRoot) && fs.existsSync(absPath)) {
    fs.unlinkSync(absPath);
  }

  await prisma.companyDocument.delete({ where: { id: req.params.id } });
  res.json({ deleted: true });
}));

// ═══════════════════════════════════════════════════════════
// GET /file/:id — Serve document file
// ═══════════════════════════════════════════════════════════
router.get('/file/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const doc = await prisma.companyDocument.findUnique({
    where: { id: req.params.id },
    select: { filePath: true, fileName: true, mimeType: true },
  });
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }

  const uploadsRoot = path.resolve(__dirname, '../../uploads');
  const absPath = path.resolve(uploadsRoot, doc.filePath);
  if (!absPath.startsWith(uploadsRoot)) { res.status(403).json({ error: 'Invalid file path' }); return; }
  if (!fs.existsSync(absPath)) { res.status(404).json({ error: 'File not found on disk' }); return; }

  const mime = doc.mimeType || 'application/octet-stream';
  const inline = mime.startsWith('image/') || mime === 'application/pdf';
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${doc.fileName}"`);
  fs.createReadStream(absPath).pipe(res);
}));

// ═══════════════════════════════════════════════════════════
// GET /categories/list — Get distinct categories and subcategories
// ═══════════════════════════════════════════════════════════
router.get('/categories/list', asyncHandler(async (req: AuthRequest, res: Response) => {
  const categories = await prisma.companyDocument.groupBy({
    by: ['category'],
    _count: { id: true },
  });
  const subcategories = await prisma.companyDocument.groupBy({
    by: ['subcategory'],
    where: { subcategory: { not: null } },
    _count: { id: true },
  });

  res.json({
    categories: categories.map((c: { category: string; _count: { id: number } }) => ({ name: c.category, count: c._count.id })),
    subcategories: subcategories.map((s: { subcategory: string | null; _count: { id: number } }) => ({ name: s.subcategory, count: s._count.id })),
  });
}));

export default router;
