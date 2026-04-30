// Auto Goods Receipts — read-only view of GRNs created by weighbridge handlers.
//
// Discriminator: GRN.remarks contains "WB:" (every weighbridge handler writes
// wbRef = `WB:${weighmentId} | Ticket #... | ...` into remarks — see
// backend/src/routes/weighbridge/shared.ts and pre-phase.ts).
//
// This route is READ-ONLY. Corrections flow through the weighbridge admin
// correction endpoints, not through here.
import { Router, Response } from 'express';
import { authenticate, AuthRequest, getCompanyFilter } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { NotFoundError } from '../shared/errors';
import prisma from '../config/prisma';

const router = Router();
router.use(authenticate);

// Source discriminator — keep in sync with storeGoodsReceipts.ts
export const AUTO_SOURCE_WHERE = {
  remarks: { contains: 'WB:' },
} as const;

// GET / — paginated list of auto (weighbridge-sourced) GRNs
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
  const offset = parseInt(req.query.offset as string) || 0;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const vendorId = req.query.vendorId as string | undefined;
  const poId = req.query.poId as string | undefined;
  const q = (req.query.q as string | undefined)?.trim();

  const where: any = {
    ...getCompanyFilter(req),
    archived: false,
    AND: [AUTO_SOURCE_WHERE],
  };
  if (vendorId) where.vendorId = vendorId;
  if (poId) where.poId = poId;
  if (from || to) {
    where.grnDate = {};
    if (from) where.grnDate.gte = new Date(from);
    if (to) where.grnDate.lte = new Date(to);
  }
  if (q) {
    const asInt = parseInt(q, 10);
    const or: any[] = [
      { remarks: { contains: q, mode: 'insensitive' } },
      { vehicleNo: { contains: q, mode: 'insensitive' } },
    ];
    if (!isNaN(asInt)) {
      or.push({ grnNo: asInt });
      or.push({ ticketNo: asInt });
    }
    where.AND.push({ OR: or });
  }

  const [items, total] = await Promise.all([
    prisma.goodsReceipt.findMany({
      where,
      orderBy: { grnDate: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        grnNo: true,
        grnDate: true,
        status: true,
        vehicleNo: true,
        ticketNo: true,
        totalQty: true,
        totalAmount: true,
        remarks: true,
        fullyPaid: true,
        po: { select: { id: true, poNo: true } },
        vendor: { select: { id: true, name: true } },
        lines: {
          select: {
            id: true,
            description: true,
            receivedQty: true,
            acceptedQty: true,
            unit: true,
            rate: true,
            amount: true,
          },
        },
      },
    }),
    prisma.goodsReceipt.count({ where }),
  ]);

  res.json({ items, total, limit, offset });
}));

// GET /:id — single auto GRN (must satisfy AUTO_SOURCE_WHERE)
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const grn = await prisma.goodsReceipt.findFirst({
    where: {
      id: req.params.id,
      AND: [AUTO_SOURCE_WHERE],
    },
    include: {
      po: true,
      vendor: true,
      lines: true,
    },
  });
  if (!grn) throw new NotFoundError('Auto GRN', req.params.id);
  res.json(grn);
}));

export default router;
