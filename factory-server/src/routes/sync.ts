import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { asyncHandler } from '../middleware';
import { pushToCloud, pullMasterData, getSyncWorkerStatus } from '../services/syncWorker';

const router = Router();

// POST /api/sync/to-cloud — manual trigger: push completed weighments to cloud ERP
router.post('/to-cloud', asyncHandler(async (_req: Request, res: Response) => {
  const result = await pushToCloud();
  console.log(`[SYNC] Manual push: ${result.synced} synced, ${result.failed} failed`);
  res.json({ ...result, total: result.synced + result.failed });
}));

// POST /api/sync/from-cloud — manual trigger: pull master data from cloud ERP
router.post('/from-cloud', asyncHandler(async (_req: Request, res: Response) => {
  try {
    const counts = await pullMasterData();
    console.log(`[SYNC] Manual pull: ${JSON.stringify(counts)}`);
    res.json({ success: true, counts });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[SYNC] Manual pull failed: ${errMsg}`);
    res.status(502).json({ error: errMsg });
  }
}));

// POST /api/sync/resync-lab — one-time: re-push all weighments with lab data so cloud gets updated moisture/quarantine
router.post('/resync-lab', asyncHandler(async (_req: Request, res: Response) => {
  const result = await prisma.weighment.updateMany({
    where: {
      labStatus: { not: 'PENDING' },
      cloudSynced: true,
      direction: 'INBOUND',
    },
    data: { cloudSynced: false },
  });
  console.log(`[SYNC] Resync-lab: marked ${result.count} weighments for re-sync`);
  res.json({ marked: result.count });
}));

// GET /api/sync/status — sync overview
router.get('/status', asyncHandler(async (_req: Request, res: Response) => {
  const [unsyncedWeighments, unsyncedGateEntries, failedQueue] = await Promise.all([
    prisma.weighment.count({ where: { cloudSynced: false, status: 'COMPLETE' } }),
    prisma.gateEntry.count({ where: { cloudSynced: false } }),
    prisma.syncQueue.count({ where: { status: { in: ['PENDING', 'FAILED'] } } }),
  ]);

  res.json({
    pendingSync: { weighments: unsyncedWeighments, gateEntries: unsyncedGateEntries },
    failedQueue,
    worker: getSyncWorkerStatus(),
  });
}));

// GET /api/sync/weighments — recent weighments with sync status (for admin dashboard)
router.get('/weighments', asyncHandler(async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const filter = req.query.filter as string; // 'pending', 'failed', 'synced', or 'all'

  const where: Record<string, unknown> = {};
  if (filter === 'pending') {
    where.cloudSynced = false;
    where.status = { in: ['GATE_ENTRY', 'FIRST_DONE', 'COMPLETE'] };
  } else if (filter === 'failed') {
    where.cloudError = { not: null };
  } else if (filter === 'synced') {
    where.cloudSynced = true;
  }

  const weighments = await prisma.weighment.findMany({
    where,
    select: {
      id: true,
      localId: true,
      vehicleNo: true,
      materialName: true,
      materialCategory: true,
      direction: true,
      status: true,
      purchaseType: true,
      supplierName: true,
      grossWeight: true,
      tareWeight: true,
      netWeight: true,
      cloudSynced: true,
      cloudSyncedAt: true,
      cloudError: true,
      syncAttempts: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  // Summary counts by category
  const [totalToday, syncedToday, pendingToday, failedToday] = await Promise.all([
    prisma.weighment.count({ where: { createdAt: { gte: todayStart() }, status: 'COMPLETE' } }),
    prisma.weighment.count({ where: { createdAt: { gte: todayStart() }, status: 'COMPLETE', cloudSynced: true } }),
    prisma.weighment.count({ where: { createdAt: { gte: todayStart() }, status: 'COMPLETE', cloudSynced: false } }),
    prisma.weighment.count({ where: { createdAt: { gte: todayStart() }, cloudError: { not: null }, cloudSynced: false } }),
  ]);

  res.json({
    weighments,
    summary: { totalToday, syncedToday, pendingToday, failedToday },
  });
}));

// POST /api/sync/resync — reset specific weighments for re-sync
router.post('/resync', asyncHandler(async (req: Request, res: Response) => {
  const { ids } = req.body; // array of weighment IDs to re-sync
  if (Array.isArray(ids) && ids.length > 0) {
    const result = await prisma.weighment.updateMany({
      where: { id: { in: ids } },
      data: { cloudSynced: false, cloudError: null, syncAttempts: 0 },
    });
    res.json({ reset: result.count });
  } else {
    // Reset all failed
    const result = await prisma.weighment.updateMany({
      where: { cloudError: { not: null }, cloudSynced: true },
      data: { cloudSynced: false, cloudError: null, syncAttempts: 0 },
    });
    res.json({ reset: result.count });
  }
}));

function todayStart(): Date {
  // IST start of day
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate();
  return new Date(Date.UTC(y, m, d) - 5.5 * 60 * 60 * 1000);
}

export default router;
