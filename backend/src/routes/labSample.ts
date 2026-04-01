import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/lab-sample — list recent samples
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { limit = '50', search } = req.query as any;
    const where: any = {};
    if (search) {
      where.rstNumber = { contains: search, mode: 'insensitive' };
    }
    const samples = await prisma.labSample.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
    });
    res.json({ samples });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/lab-sample/by-rst/:rst — lookup by RST number (used by truck form)
router.get('/by-rst/:rst', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const sample = await prisma.labSample.findUnique({
      where: { rstNumber: req.params.rst.trim() },
    });
    if (!sample) return res.status(404).json({ error: 'No lab sample found for this RST' });
    res.json(sample);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /api/lab-sample — create new sample
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { rstNumber, moisture, starchPercent, damagedPercent, foreignMatter,
      fungus, immature, waterDamaged, tfm, remarks, result } = req.body;

    if (!rstNumber || !rstNumber.trim()) {
      return res.status(400).json({ error: 'RST number is required' });
    }

    // Check duplicate
    const existing = await prisma.labSample.findUnique({ where: { rstNumber: rstNumber.trim() } });
    if (existing) {
      return res.status(409).json({ error: `Sample with RST "${rstNumber.trim()}" already exists` });
    }

    const sample = await prisma.labSample.create({
      data: {
        rstNumber: rstNumber.trim(),
        moisture: moisture != null ? parseFloat(moisture) : null,
        starchPercent: starchPercent != null ? parseFloat(starchPercent) : null,
        damagedPercent: damagedPercent != null ? parseFloat(damagedPercent) : null,
        foreignMatter: foreignMatter != null ? parseFloat(foreignMatter) : null,
        fungus: fungus != null ? parseFloat(fungus) : null,
        immature: immature != null ? parseFloat(immature) : null,
        waterDamaged: waterDamaged != null ? parseFloat(waterDamaged) : null,
        tfm: tfm != null ? parseFloat(tfm) : null,
        remarks: remarks || null,
        result: result || 'PENDING',
        userId: req.user!.id,
      },
    });

    // Sync lab result to GrainTruck (for weighbridge sync-back)
    if (result === 'ACCEPTED' || result === 'REJECTED') {
      const truck = await prisma.grainTruck.findFirst({
        where: { uidRst: rstNumber.trim() },
        select: { id: true, weightNet: true, remarks: true },
      });
      if (truck) {
        await prisma.grainTruck.update({
          where: { id: truck.id },
          data: {
            moisture: moisture != null ? parseFloat(moisture) : undefined,
            starchPercent: starchPercent != null ? parseFloat(starchPercent) : undefined,
            damagedPercent: damagedPercent != null ? parseFloat(damagedPercent) : undefined,
            foreignMatter: foreignMatter != null ? parseFloat(foreignMatter) : undefined,
            quarantine: result === 'REJECTED' ? true : false,
            quarantineWeight: result === 'REJECTED' ? truck.weightNet : undefined,
            quarantineReason: result === 'REJECTED' ? (remarks || 'Rejected by lab') : undefined,
          },
        });
      }
    }

    res.status(201).json(sample);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /api/lab-sample/:id — update sample
router.put('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { moisture, starchPercent, damagedPercent, foreignMatter,
      fungus, immature, waterDamaged, tfm, remarks, result } = req.body;

    const sample = await prisma.labSample.update({
      where: { id: req.params.id },
      data: {
        moisture: moisture != null ? parseFloat(moisture) : undefined,
        starchPercent: starchPercent != null ? parseFloat(starchPercent) : undefined,
        damagedPercent: damagedPercent != null ? parseFloat(damagedPercent) : undefined,
        foreignMatter: foreignMatter != null ? parseFloat(foreignMatter) : undefined,
        fungus: fungus != null ? parseFloat(fungus) : undefined,
        immature: immature != null ? parseFloat(immature) : undefined,
        waterDamaged: waterDamaged != null ? parseFloat(waterDamaged) : undefined,
        tfm: tfm != null ? parseFloat(tfm) : undefined,
        remarks: remarks !== undefined ? remarks : undefined,
        result: result || undefined,
      },
    });

    // Sync lab result to GrainTruck (for weighbridge sync-back)
    if (result === 'ACCEPTED' || result === 'REJECTED') {
      const truck = await prisma.grainTruck.findFirst({
        where: { uidRst: sample.rstNumber },
        select: { id: true, weightNet: true },
      });
      if (truck) {
        await prisma.grainTruck.update({
          where: { id: truck.id },
          data: {
            moisture: moisture != null ? parseFloat(moisture) : undefined,
            starchPercent: starchPercent != null ? parseFloat(starchPercent) : undefined,
            damagedPercent: damagedPercent != null ? parseFloat(damagedPercent) : undefined,
            foreignMatter: foreignMatter != null ? parseFloat(foreignMatter) : undefined,
            quarantine: result === 'REJECTED' ? true : false,
            quarantineWeight: result === 'REJECTED' ? truck.weightNet : undefined,
            quarantineReason: result === 'REJECTED' ? (remarks || 'Rejected by lab') : undefined,
          },
        });
      }
    }

    res.json(sample);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/lab-sample/:id — admin only
router.delete('/:id', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.labSample.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
