import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import prisma from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', '..', 'uploads', 'dispatch');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB max

// GET /api/dispatch — list today's dispatches (or by date query)
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const dateStr = req.query.date as string || new Date().toISOString().split('T')[0];
    const start = new Date(dateStr);
    start.setHours(0, 0, 0, 0);
    const end = new Date(dateStr);
    end.setHours(23, 59, 59, 999);

    const dispatches = await prisma.dispatchTruck.findMany({
      where: { date: { gte: start, lte: end }, entryId: null },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ dispatches });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/dispatch/history — past dispatches grouped by date (before today 9AM cutoff)
router.get('/history', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // History = everything before today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dispatches = await prisma.dispatchTruck.findMany({
      where: { date: { lt: today }, entryId: null },
      orderBy: { date: 'desc' },
      take: 200,
    });

    // Group by date
    const grouped: Record<string, any[]> = {};
    for (const d of dispatches) {
      const key = d.date.toISOString().split('T')[0];
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(d);
    }

    res.json({ history: grouped });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /api/dispatch — create a dispatch entry with optional photo
router.post('/', authenticate, upload.single('photo'), async (req: AuthRequest, res: Response) => {
  try {
    const { vehicleNo, partyName, destination, quantityBL, strength, remarks, date, batchNo } = req.body;
    const dispatchDate = date ? new Date(date) : new Date();
    dispatchDate.setHours(new Date().getHours(), new Date().getMinutes());

    const photoUrl = req.file ? `/uploads/dispatch/${req.file.filename}` : null;

    const dispatch = await prisma.dispatchTruck.create({
      data: {
        date: dispatchDate,
        batchNo: batchNo || '',
        vehicleNo: vehicleNo || '',
        partyName: partyName || '',
        destination: destination || '',
        quantityBL: parseFloat(quantityBL) || 0,
        strength: strength ? parseFloat(strength) : null,
        photoUrl,
        remarks: remarks || null,
        userId: req.user!.id,
      },
    });
    res.status(201).json(dispatch);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/dispatch/:id
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const d = await prisma.dispatchTruck.findUnique({ where: { id: req.params.id } });
    if (d?.photoUrl) {
      const filePath = path.join(__dirname, '..', '..', d.photoUrl);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    await prisma.dispatchTruck.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Serve uploaded photos
router.get('/photo/:filename', (req, res) => {
  const filePath = path.join(uploadsDir, req.params.filename);
  if (fs.existsSync(filePath)) res.sendFile(filePath);
  else res.status(404).json({ error: 'Photo not found' });
});

export default router;
