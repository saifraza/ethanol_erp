import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { z } from 'zod';
import prisma from '../config/prisma';

const router = Router();

// IST offset: UTC+5:30
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function nowIST(): Date {
  return new Date(Date.now() + IST_OFFSET_MS);
}

/** Start of today in IST (00:00:00 IST) as UTC */
function todayStartUTC(): Date {
  const ist = nowIST();
  const dateStr = ist.toISOString().split('T')[0]; // YYYY-MM-DD in IST
  // 00:00 IST = previous day 18:30 UTC
  return new Date(dateStr + 'T00:00:00.000+05:30');
}

// GET /lab-testing/pending — trucks awaiting lab result (last 7 days, moisture is null AND quarantine is default false)
router.get('/pending', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const trucks = await prisma.grainTruck.findMany({
    where: {
      date: { gte: sevenDaysAgo },
      moisture: null,
      quarantine: false,
    },
    orderBy: { date: 'desc' },
    take: 50,
    select: {
      id: true,
      vehicleNo: true,
      supplier: true,
      weightGross: true,
      weightTare: true,
      weightNet: true,
      moisture: true,
      starchPercent: true,
      damagedPercent: true,
      foreignMatter: true,
      quarantine: true,
      date: true,
      remarks: true,
      uidRst: true,
    },
  });
  res.json(trucks);
}));

// GET /lab-testing/history — recently tested trucks
router.get('/history', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const trucks = await prisma.grainTruck.findMany({
    where: {
      OR: [
        { moisture: { not: null } },
        { quarantine: true },
      ],
    },
    orderBy: { date: 'desc' },
    take: 50,
    select: {
      id: true,
      vehicleNo: true,
      supplier: true,
      weightGross: true,
      weightTare: true,
      weightNet: true,
      moisture: true,
      starchPercent: true,
      damagedPercent: true,
      foreignMatter: true,
      quarantine: true,
      quarantineReason: true,
      quarantineWeight: true,
      date: true,
      remarks: true,
      uidRst: true,
    },
  });
  res.json(trucks);
}));

// GET /lab-testing/stats — counts for KPI strip
router.get('/stats', authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const todayStart = todayStartUTC();

  const [pending, passedToday, failedToday, quarantineTotal] = await Promise.all([
    prisma.grainTruck.count({
      where: {
        date: { gte: sevenDaysAgo },
        moisture: null,
        quarantine: false,
      },
    }),
    prisma.grainTruck.count({
      where: {
        date: { gte: todayStart },
        moisture: { not: null },
        quarantine: false,
      },
    }),
    prisma.grainTruck.count({
      where: {
        date: { gte: todayStart },
        quarantine: true,
      },
    }),
    prisma.grainTruck.count({
      where: { quarantine: true },
    }),
  ]);

  res.json({ pending, passedToday, failedToday, quarantineTotal });
}));

// PUT /lab-testing/:id — update lab result
const updateSchema = z.object({
  status: z.enum(['PASS', 'FAIL']),
  moisture: z.number().min(0).max(100),
  starchPercent: z.number().min(0).max(100).optional(),
  damagedPercent: z.number().min(0).max(100).optional(),
  foreignMatter: z.number().min(0).max(100).optional(),
  remarks: z.string().optional(),
});

router.put('/:id', authenticate, validate(updateSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { status, moisture, starchPercent, damagedPercent, foreignMatter, remarks } = req.body;

  // Verify truck exists
  const truck = await prisma.grainTruck.findUnique({ where: { id } });
  if (!truck) {
    res.status(404).json({ error: 'Truck not found' });
    return;
  }

  const updateData: Record<string, unknown> = {
    moisture,
    starchPercent: starchPercent ?? null,
    damagedPercent: damagedPercent ?? null,
    foreignMatter: foreignMatter ?? null,
  };

  if (status === 'FAIL') {
    updateData.quarantine = true;
    updateData.quarantineWeight = truck.weightNet;
    updateData.quarantineReason = remarks || 'Failed lab quality test';
  }

  if (remarks !== undefined) {
    updateData.remarks = remarks;
  }

  const updated = await prisma.grainTruck.update({
    where: { id },
    data: updateData,
  });

  res.json(updated);
}));

export default router;
