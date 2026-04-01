import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { asyncHandler } from '../middleware';

const router = Router();

// GET /api/master-data — all cached master data for PCs
// PCs pull this to populate dropdowns (suppliers, materials, POs)
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const [suppliers, materials, purchaseOrders, customers] = await Promise.all([
    prisma.cachedSupplier.findMany({ orderBy: { name: 'asc' } }),
    prisma.cachedMaterial.findMany({ orderBy: { name: 'asc' } }),
    prisma.cachedPurchaseOrder.findMany({
      where: { status: { in: ['APPROVED', 'SENT', 'PARTIAL_RECEIVED'] } },
      orderBy: { poNumber: 'desc' },
    }),
    prisma.cachedCustomer.findMany({ orderBy: { name: 'asc' } }),
  ]);

  res.json({ suppliers, materials, purchaseOrders, customers });
}));

// POST /api/master-data/refresh — pull latest from cloud ERP
// Called periodically by a sync job
router.post('/refresh', asyncHandler(async (_req: Request, res: Response) => {
  // This will be implemented in the sync service
  // For now, return current counts
  const [suppliers, materials, pos, customers] = await Promise.all([
    prisma.cachedSupplier.count(),
    prisma.cachedMaterial.count(),
    prisma.cachedPurchaseOrder.count(),
    prisma.cachedCustomer.count(),
  ]);

  res.json({
    message: 'Master data refresh triggered',
    counts: { suppliers, materials, purchaseOrders: pos, customers },
  });
}));

export default router;
