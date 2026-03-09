import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

function getCurrentYearStart(): number {
  return new Date().getFullYear();
}

// Total fine = 100% minus sum of all retained fractions
function calcFine(s1mm: number, s850: number, s600: number, s300: number): number {
  return Math.round((100 - (s1mm + s850 + s600 + s300)) * 100) / 100;
}

// GET /api/milling — list entries (newest first)
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { year, limit = '30', offset = '0' } = req.query as any;
    const yearStart = year ? parseInt(year) : getCurrentYearStart();
    const entries = await prisma.millingEntry.findMany({
      where: { yearStart },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset),
    });
    const total = await prisma.millingEntry.count({ where: { yearStart } });
    res.json({ entries, total, yearStart });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/milling/chart — chronological for charting
router.get('/chart', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { year, limit = '60' } = req.query as any;
    const yearStart = year ? parseInt(year) : getCurrentYearStart();
    const entries = await prisma.millingEntry.findMany({
      where: { yearStart },
      orderBy: { date: 'asc' },
      take: parseInt(limit),
    });
    res.json({ entries, yearStart });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/milling/latest
router.get('/latest', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const yearStart = getCurrentYearStart();
    const latest = await prisma.millingEntry.findFirst({
      where: { yearStart },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ latest, yearStart });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /api/milling
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { date, analysisTime,
      sieve_1mm, sieve_850, sieve_600, sieve_300,
      millA_rpm, millA_load, millB_rpm, millB_load, millC_rpm, millC_load,
      remarks } = req.body;

    const entryDate = new Date(date);
    entryDate.setHours(0, 0, 0, 0);
    const yearStart = entryDate.getFullYear();

    const s1 = sieve_1mm || 0, s8 = sieve_850 || 0, s6 = sieve_600 || 0, s3 = sieve_300 || 0;

    const entry = await prisma.millingEntry.create({
      data: {
        date: entryDate, yearStart,
        analysisTime: analysisTime || '',
        sieve_1mm: s1, sieve_850: s8, sieve_600: s6, sieve_300: s3,
        totalFine: calcFine(s1, s8, s6, s3),
        millA_rpm: millA_rpm || 0, millA_load: millA_load || 0,
        millB_rpm: millB_rpm || 0, millB_load: millB_load || 0,
        millC_rpm: millC_rpm || 0, millC_load: millC_load || 0,
        remarks: remarks || null,
        userId: req.user!.id,
      },
    });
    res.status(201).json(entry);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /api/milling/:id
router.put('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.millingEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Entry not found' });

    const d = req.body;
    const s1 = d.sieve_1mm ?? existing.sieve_1mm;
    const s8 = d.sieve_850 ?? existing.sieve_850;
    const s6 = d.sieve_600 ?? existing.sieve_600;
    const s3 = d.sieve_300 ?? existing.sieve_300;

    const entry = await prisma.millingEntry.update({
      where: { id: req.params.id },
      data: {
        analysisTime: d.analysisTime ?? existing.analysisTime,
        sieve_1mm: s1, sieve_850: s8, sieve_600: s6, sieve_300: s3,
        totalFine: calcFine(s1, s8, s6, s3),
        millA_rpm: d.millA_rpm ?? existing.millA_rpm, millA_load: d.millA_load ?? existing.millA_load,
        millB_rpm: d.millB_rpm ?? existing.millB_rpm, millB_load: d.millB_load ?? existing.millB_load,
        millC_rpm: d.millC_rpm ?? existing.millC_rpm, millC_load: d.millC_load ?? existing.millC_load,
        remarks: d.remarks ?? existing.remarks,
      },
    });
    res.json(entry);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/milling/:id
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.millingEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Entry not found' });
    await prisma.millingEntry.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
