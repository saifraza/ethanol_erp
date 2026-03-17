import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/auth';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

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
router.get('/shipment/:shipmentId', async (req: Request, res: Response) => {
  try {
    const docs = await prisma.shipmentDocument.findMany({
      where: { shipmentId: req.params.shipmentId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ documents: docs });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /upload — Upload document for a shipment
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
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
        uploadedBy: (req as any).user.id,
        remarks: b.remarks || null,
      },
    });
    res.status(201).json(doc);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /file/:id — Serve document file (inline for PDF/images)
router.get('/file/:id', async (req: Request, res: Response) => {
  try {
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
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /:id — Delete document
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const doc = await prisma.shipmentDocument.findUnique({ where: { id: req.params.id } });
    if (!doc) { res.status(404).json({ error: 'Not found' }); return; }

    // Delete file from disk
    const filePath = path.resolve(__dirname, '../../uploads', doc.filePath);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    await prisma.shipmentDocument.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
