import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { asyncHandler, requireWbKey } from '../middleware';

const router = Router();

// POST /api/weighbridge/push — receive weighment from a PC
router.post('/push', requireWbKey, asyncHandler(async (req: Request, res: Response) => {
  const {
    localId, pcId, pcName, vehicleNo, direction,
    purchaseType, poNumber, supplierName, supplierId,
    materialName, materialId,
    grossWeight, tareWeight, netWeight,
    grossTime, tareTime,
    status, gateEntryNo, driverName, driverPhone, remarks,
  } = req.body;

  if (!localId || !pcId || !vehicleNo) {
    res.status(400).json({ error: 'localId, pcId, vehicleNo required' });
    return;
  }

  // Valid state transitions: GATE_ENTRY → FIRST_DONE → COMPLETE
  // A COMPLETE record cannot go back to FIRST_DONE or GATE_ENTRY
  const VALID_TRANSITIONS: Record<string, string[]> = {
    GATE_ENTRY: ['FIRST_DONE', 'COMPLETE', 'CANCELLED'],
    FIRST_DONE: ['COMPLETE', 'CANCELLED'],
    COMPLETE: [],    // terminal — no further transitions allowed
    CANCELLED: [],   // terminal
  };

  const newStatus = status || 'GATE_ENTRY';

  // Check if record already exists to enforce state machine
  const existing = await prisma.weighment.findUnique({
    where: { localId },
    select: { id: true, status: true },
  });

  if (existing) {
    const allowedNext = VALID_TRANSITIONS[existing.status] || [];
    if (newStatus !== existing.status && !allowedNext.includes(newStatus)) {
      res.status(409).json({
        error: `Invalid transition: ${existing.status} → ${newStatus}`,
        currentStatus: existing.status,
      });
      return;
    }
  }

  // Upsert — PC may re-push same weighment (gross then tare)
  const weighment = await prisma.weighment.upsert({
    where: { localId },
    create: {
      localId, pcId, pcName: pcName || pcId, vehicleNo, direction: direction || 'INBOUND',
      purchaseType, poNumber, supplierName, supplierId,
      materialName, materialId,
      grossWeight: grossWeight ? parseFloat(grossWeight) : null,
      tareWeight: tareWeight ? parseFloat(tareWeight) : null,
      netWeight: netWeight ? parseFloat(netWeight) : null,
      grossTime: grossTime ? new Date(grossTime) : null,
      tareTime: tareTime ? new Date(tareTime) : null,
      status: newStatus,
      gateEntryNo, driverName, driverPhone, remarks,
    },
    update: {
      grossWeight: grossWeight ? parseFloat(grossWeight) : undefined,
      tareWeight: tareWeight ? parseFloat(tareWeight) : undefined,
      netWeight: netWeight ? parseFloat(netWeight) : undefined,
      grossTime: grossTime ? new Date(grossTime) : undefined,
      tareTime: tareTime ? new Date(tareTime) : undefined,
      status: newStatus,
      gateEntryNo, driverName, driverPhone, remarks,
      updatedAt: new Date(),
    },
  });

  console.log(`[WB] ${pcId}: ${vehicleNo} ${status} (${netWeight ? netWeight + ' kg' : 'pending'})`);
  res.json({ success: true, id: weighment.id });
}));

// GET /api/weighbridge/weighments — list weighments (for admin dashboard)
router.get('/weighments', asyncHandler(async (req: Request, res: Response) => {
  const date = req.query.date as string;
  const pcId = req.query.pcId as string;
  const take = Math.min(parseInt(req.query.limit as string) || 50, 500);

  const where: Record<string, unknown> = {};
  if (date) {
    const start = new Date(date + 'T00:00:00+05:30');
    const end = new Date(date + 'T23:59:59+05:30');
    where.createdAt = { gte: start, lte: end };
  }
  if (pcId) where.pcId = pcId;

  const weighments = await prisma.weighment.findMany({
    where,
    take,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, localId: true, pcId: true, pcName: true,
      vehicleNo: true, direction: true, purchaseType: true,
      poNumber: true, supplierName: true, materialName: true,
      grossWeight: true, tareWeight: true, netWeight: true,
      grossTime: true, tareTime: true,
      status: true, gateEntryNo: true,
      cloudSynced: true, createdAt: true,
    },
  });

  res.json(weighments);
}));

// GET /api/weighbridge/stats — today's summary
router.get('/stats', asyncHandler(async (_req: Request, res: Response) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [total, completed, pending, unsynced] = await Promise.all([
    prisma.weighment.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.weighment.count({ where: { createdAt: { gte: todayStart }, status: 'COMPLETE' } }),
    prisma.weighment.count({ where: { createdAt: { gte: todayStart }, status: { not: 'COMPLETE' } } }),
    prisma.weighment.count({ where: { cloudSynced: false, status: 'COMPLETE' } }),
  ]);

  res.json({ today: { total, completed, pending }, unsynced });
}));

export default router;
