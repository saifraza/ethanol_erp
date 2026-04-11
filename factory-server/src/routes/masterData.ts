import { Router, Request, Response } from 'express';
import { getMasterData, getCacheStats } from '../services/masterDataCache';

const router = Router();

// GET /api/master-data — all master data for factory PCs
// Reads from in-memory cache (instant, < 1ms, works offline)
router.get('/', (_req: Request, res: Response) => {
  const data = getMasterData();
  res.json({
    suppliers: data.suppliers,
    materials: data.materials,
    pos: data.pos,
    traders: data.traders,
    customers: data.customers,
    vehicles: data.vehicles,
    ethContracts: data.ethContracts,
    ddgsContracts: data.ddgsContracts,
    scrapOrders: data.scrapOrders,
    source: data.source,
    lastSync: data.lastCloudSync,
  });
});

// GET /api/master-data/status — cache health check
router.get('/status', (_req: Request, res: Response) => {
  res.json(getCacheStats());
});

export default router;
