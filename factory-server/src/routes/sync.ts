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

export default router;
