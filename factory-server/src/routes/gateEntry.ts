import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { asyncHandler } from '../middleware';

const router = Router();

// POST /api/gate-entry — create new gate entry
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { vehicleNo, direction, purpose, driverName, driverPhone, personCount, poNumber, supplierName } = req.body;

  if (!vehicleNo || !direction) {
    res.status(400).json({ error: 'vehicleNo and direction required' });
    return;
  }

  const entry = await prisma.gateEntry.create({
    data: {
      vehicleNo: vehicleNo.toUpperCase().replace(/\s/g, ''),
      direction,
      purpose: purpose || 'OTHER',
      driverName, driverPhone,
      personCount: personCount || 1,
      poNumber, supplierName,
    },
  });

  console.log(`[GATE] ${direction} ${vehicleNo} — ${purpose || 'OTHER'}`);
  res.status(201).json(entry);
}));

// PATCH /api/gate-entry/:id/exit — mark vehicle exit
router.patch('/:id/exit', asyncHandler(async (req: Request, res: Response) => {
  const entry = await prisma.gateEntry.update({
    where: { id: req.params.id as string },
    data: { exitTime: new Date(), status: 'EXITED' },
  });

  console.log(`[GATE] EXIT ${entry.vehicleNo}`);
  res.json(entry);
}));

// GET /api/gate-entry — list entries
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const status = req.query.status as string;
  const date = req.query.date as string;
  const take = Math.min(parseInt(req.query.limit as string) || 50, 500);

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (date) {
    const start = new Date(date + 'T00:00:00+05:30');
    const end = new Date(date + 'T23:59:59+05:30');
    where.createdAt = { gte: start, lte: end };
  }

  const entries = await prisma.gateEntry.findMany({
    where,
    take,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, vehicleNo: true, direction: true, purpose: true,
      driverName: true, driverPhone: true, personCount: true,
      poNumber: true, supplierName: true,
      entryTime: true, exitTime: true, status: true,
      createdAt: true,
    },
  });

  res.json(entries);
}));

// GET /api/gate-entry/inside — vehicles currently inside
router.get('/inside', asyncHandler(async (_req: Request, res: Response) => {
  const inside = await prisma.gateEntry.findMany({
    where: { status: 'INSIDE' },
    orderBy: { entryTime: 'desc' },
    take: 100,
    select: {
      id: true, vehicleNo: true, direction: true, purpose: true,
      driverName: true, supplierName: true,
      entryTime: true,
    },
  });

  res.json(inside);
}));

export default router;
