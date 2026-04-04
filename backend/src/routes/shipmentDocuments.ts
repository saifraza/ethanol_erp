import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { lightragUpload, isRagEnabled } from '../services/lightragClient';
import { generateVaultNote } from '../services/vaultWriter';

const router = Router();
router.use(authenticate as any);

// Setup multer for file uploads
const uploadDir = path.resolve(__dirname, '../../uploads/shipment-docs');
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
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.doc', '.docx', '.xls', '.xlsx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`File type ${ext} not allowed`));
  },
});

// GET /shipment/:shipmentId — List documents for a shipment
router.get('/shipment/:shipmentId', asyncHandler(async (req: AuthRequest, res: Response) => {
    const docs = await prisma.shipmentDocument.findMany({
      where: { shipmentId: req.params.shipmentId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ documents: docs });
}));

// POST /upload — Upload document for a shipment
router.post('/upload', upload.single('file'), asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

    const b = req.body;
    const doc = await prisma.shipmentDocument.create({
      data: {
        shipmentId: b.shipmentId,
        docType: b.docType || 'OTHER',
        fileName: req.file.originalname,
        filePath: `shipment-docs/${req.file.filename}`,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        uploadedBy: req.user!.id,
        remarks: b.remarks || null,
      },
    });
    res.status(201).json(doc);

    // Fire-and-forget: index in LightRAG
    if (isRagEnabled()) {
      setImmediate(() => {
        lightragUpload(`shipment-docs/${req.file!.filename}`, {
          sourceType: 'ShipmentDocument',
          sourceId: doc.id,
          title: req.file!.originalname,
        }).catch(err => console.error('[ShipmentDoc] LightRAG indexing failed:', err));
      });
    }

    // Fire-and-forget: generate vault note
    setImmediate(() => {
      generateVaultNote({
        sourceType: 'ShipmentDocument',
        sourceId: doc.id,
        filePath: `shipment-docs/${req.file!.filename}`,
        title: req.file!.originalname,
        category: 'CONTRACT',
        mimeType: req.file!.mimetype,
      }).catch(err => console.error('[ShipmentDoc] Vault note failed:', err));
    });
}));

// POST /upload-general — Upload general document (quotation, etc.) not tied to shipment
router.post('/upload-general', upload.single('file'), asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

    const b = req.body;
    // Store as a shipment doc with optional metadata in remarks
    const doc = await prisma.shipmentDocument.create({
      data: {
        shipmentId: b.shipmentId || 'general',
        docType: b.docType || 'OTHER',
        fileName: req.file.originalname,
        filePath: `shipment-docs/${req.file.filename}`,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        uploadedBy: req.user!.id,
        remarks: [b.inquiryId ? `FI:${b.inquiryId}` : '', b.quotationId ? `Q:${b.quotationId}` : '', b.remarks || ''].filter(Boolean).join(' | ') || null,
      },
    });
    res.status(201).json(doc);
}));

// GET /file/:id — Serve document file (inline for PDF/images)
router.get('/file/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const doc = await prisma.shipmentDocument.findUnique({ where: { id: req.params.id } });
    if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }

    const filePath = path.resolve(__dirname, '../../uploads', doc.filePath);
    if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'File not found on disk' }); return; }

    // Set content type for inline viewing
    const ext = path.extname(doc.fileName).toLowerCase();
    const contentType = doc.mimeType || ({
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.png': 'image/png', '.webp': 'image/webp',
    } as any)[ext] || 'application/octet-stream';

    const isViewable = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'].includes(ext);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `${isViewable ? 'inline' : 'attachment'}; filename="${doc.fileName}"`);
    fs.createReadStream(filePath).pipe(res);
}));

// DELETE /:id — Delete document
router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
    const doc = await prisma.shipmentDocument.findUnique({ where: { id: req.params.id } });
    if (!doc) { res.status(404).json({ error: 'Not found' }); return; }

    // Delete file from disk
    const filePath = path.resolve(__dirname, '../../uploads', doc.filePath);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    await prisma.shipmentDocument.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
}));

export default router;
