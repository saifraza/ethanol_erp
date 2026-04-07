import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { asyncHandler, requireWbKey } from '../middleware';
import { handleHeartbeat } from '../services/pcMonitor';

const router = Router();

// POST /api/heartbeat — receive heartbeat from a PC
router.post('/', requireWbKey, asyncHandler(async (req: Request, res: Response) => {
  const { pcId, pcName, pcRole, tailscaleIp, lanIp,
    cpuPercent, memoryPercent, diskFreeGb, uptime,
    serviceVersion, serialProtocol, dbSizeKb, queueDepth, lastSyncTime } = req.body;

  if (!pcId) {
    res.status(400).json({ error: 'pcId required' });
    return;
  }

  // Auto-register in pcMonitor for dashboard visibility
  handleHeartbeat(pcId, pcName, lanIp || tailscaleIp, undefined, pcRole);

  await prisma.pcHeartbeat.upsert({
    where: { pcId },
    create: {
      pcId, pcName: pcName || pcId, pcRole: pcRole || 'WEIGHBRIDGE',
      tailscaleIp, lanIp,
      cpuPercent, memoryPercent, diskFreeGb, uptime,
      serviceVersion, serialProtocol, dbSizeKb, queueDepth,
      lastSyncTime: lastSyncTime ? new Date(lastSyncTime) : null,
      lastSeen: new Date(),
    },
    update: {
      pcName: pcName || undefined, pcRole: pcRole || undefined,
      tailscaleIp, lanIp,
      cpuPercent, memoryPercent, diskFreeGb, uptime,
      serviceVersion, serialProtocol, dbSizeKb, queueDepth,
      lastSyncTime: lastSyncTime ? new Date(lastSyncTime) : null,
      lastSeen: new Date(),
    },
  });

  res.json({ success: true });
}));

// GET /api/heartbeat/status — all PCs status
router.get('/status', asyncHandler(async (_req: Request, res: Response) => {
  const pcs = await prisma.pcHeartbeat.findMany({
    orderBy: { lastSeen: 'desc' },
  });

  const now = new Date();
  const result = pcs.map(pc => ({
    ...pc,
    alive: (now.getTime() - pc.lastSeen.getTime()) < 120000, // 2 min threshold
  }));

  res.json(result);
}));

export default router;
