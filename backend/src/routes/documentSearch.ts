import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { z } from 'zod';
import {
  lightragQuery,
  lightragQueryStream,
  lightragStatus,
  lightragSearchEntities,
  lightragHealth,
  lightragUpload,
  isRagEnabled,
} from '../services/lightragClient';
import prisma from '../config/prisma';
import path from 'path';
import fs from 'fs';

const router = Router();
router.use(authenticate);

// ── Schemas ──────────────────────────────────────────────
const querySchema = z.object({
  query: z.string().min(1).max(2000),
  mode: z.enum(['local', 'global', 'hybrid', 'naive', 'mix']).default('hybrid'),
  topK: z.number().int().min(1).max(50).default(10),
});

const streamSchema = z.object({
  query: z.string().min(1).max(2000),
  mode: z.enum(['local', 'global', 'hybrid', 'naive', 'mix']).default('hybrid'),
});

// ═══════════════════════════════════════════════════════════
// POST /query — Ask a question, get AI answer from LightRAG
// ═══════════════════════════════════════════════════════════
router.post('/query', validate(querySchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { query, mode, topK } = req.body;
  const result = await lightragQuery(query, mode, topK);
  if (!result.success) {
    res.status(502).json({ error: result.error || 'LightRAG query failed' });
    return;
  }
  res.json({ answer: result.answer, mode, query });
}));

// ═══════════════════════════════════════════════════════════
// POST /stream — Streaming query response (NDJSON)
// ═══════════════════════════════════════════════════════════
router.post('/stream', validate(streamSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { query, mode } = req.body;
  const result = await lightragQueryStream(query, mode);
  if (!result.success || !result.stream) {
    res.status(502).json({ error: result.error || 'LightRAG stream failed' });
    return;
  }

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  result.stream.pipe(res);
}));

// ═══════════════════════════════════════════════════════════
// GET /status/:trackId — Check document indexing status
// ═══════════════════════════════════════════════════════════
router.get('/status/:trackId', asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await lightragStatus(req.params.trackId);
  if (!result.success) {
    res.status(502).json({ error: result.error });
    return;
  }
  res.json({ trackId: req.params.trackId, status: result.status });
}));

// ═══════════════════════════════════════════════════════════
// GET /entities — Search knowledge graph entities
// ═══════════════════════════════════════════════════════════
router.get('/entities', asyncHandler(async (req: AuthRequest, res: Response) => {
  const query = (req.query.q as string) || '';
  const topK = Math.min(parseInt(req.query.limit as string) || 10, 50);
  if (!query) { res.status(400).json({ error: 'Query parameter q is required' }); return; }

  const result = await lightragSearchEntities(query, topK);
  if (!result.success) {
    res.status(502).json({ error: result.error });
    return;
  }
  res.json({ entities: result.entities });
}));

// ═══════════════════════════════════════════════════════════
// GET /health — LightRAG service health check
// ═══════════════════════════════════════════════════════════
router.get('/health', asyncHandler(async (req: AuthRequest, res: Response) => {
  const health = await lightragHealth();
  res.json({ enabled: isRagEnabled(), ...health });
}));

// ═══════════════════════════════════════════════════════════
// GET /stats — Index statistics
// ═══════════════════════════════════════════════════════════
router.get('/stats', asyncHandler(async (req: AuthRequest, res: Response) => {
  const [companyDocs, indexedDocs] = await Promise.all([
    prisma.companyDocument.count(),
    prisma.companyDocument.count({ where: { ragIndexed: true } }),
  ]);

  const health = await lightragHealth();

  res.json({
    lightragConnected: health.connected,
    companyDocuments: companyDocs,
    indexedDocuments: indexedDocs,
    pendingIndexing: companyDocs - indexedDocs,
  });
}));

// ═══════════════════════════════════════════════════════════
// POST /reindex — Re-upload all existing documents to LightRAG
// ═══════════════════════════════════════════════════════════
router.post('/reindex', asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!isRagEnabled()) {
    res.status(503).json({ error: 'LightRAG not configured' });
    return;
  }

  // Get all company documents not yet indexed
  const docs = await prisma.companyDocument.findMany({
    where: { ragIndexed: false },
    select: { id: true, filePath: true, fileName: true, category: true, title: true },
    take: 100,
  });

  // Also scan upload directories for other document types
  const uploadDirs = ['vendor-invoices', 'shipment-docs', 'grn-documents', 'contractor-bills'];
  const uploadFiles: string[] = [];
  for (const dir of uploadDirs) {
    const absDir = path.resolve(__dirname, '../../uploads', dir);
    if (fs.existsSync(absDir)) {
      const files = fs.readdirSync(absDir)
        .filter(f => /\.(pdf|doc|docx|xls|xlsx)$/i.test(f))
        .map(f => `${dir}/${f}`);
      uploadFiles.push(...files);
    }
  }

  let queued = 0;
  const errors: string[] = [];

  // Index company documents
  for (const doc of docs) {
    const result = await lightragUpload(doc.filePath, {
      sourceType: 'CompanyDocument',
      sourceId: doc.id,
      title: doc.title,
    });
    if (result.success) {
      await prisma.companyDocument.update({
        where: { id: doc.id },
        data: { ragIndexed: true, ragTrackId: result.trackId },
      });
      queued++;
    } else {
      errors.push(`${doc.fileName}: ${result.error}`);
    }
  }

  // Index upload directory files
  for (const filePath of uploadFiles) {
    const sourceType = filePath.startsWith('vendor-invoices') ? 'VendorInvoice'
      : filePath.startsWith('shipment-docs') ? 'ShipmentDocument'
      : filePath.startsWith('grn-documents') ? 'GoodsReceipt'
      : filePath.startsWith('contractor-bills') ? 'ContractorBill'
      : 'Unknown';

    const result = await lightragUpload(filePath, { sourceType });
    if (result.success) queued++;
    else errors.push(`${filePath}: ${result.error}`);
  }

  res.json({
    queued,
    companyDocuments: docs.length,
    uploadFiles: uploadFiles.length,
    errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
  });
}));

export default router;
