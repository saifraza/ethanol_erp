import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { NotFoundError } from '../shared/errors';
import { z } from 'zod';
import prisma from '../config/prisma';

const router = Router();
router.use(authenticate as any);

// ─── Schemas ────────────────────────────────────────

const createWarehouseSchema = z.object({
  name: z.string().min(1).max(100),
  address: z.string().nullable().optional(),
});

const updateWarehouseSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  address: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

const createBinSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().optional(),
  capacity: z.number().positive().optional(),
});

const updateBinSchema = z.object({
  code: z.string().min(1).max(30).optional(),
  name: z.string().optional(),
  capacity: z.number().positive().optional(),
  isActive: z.boolean().optional(),
});

// ─── GET / — list warehouses with bin counts and total stock value ───

router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const take = Math.min(parseInt(req.query.limit as string) || 50, 500);
  const skip = parseInt(req.query.offset as string) || 0;

  const warehouses = await prisma.warehouse.findMany({
    where: { ...getCompanyFilter(req) },
    take,
    skip,
    orderBy: { name: 'asc' },
    select: {
      id: true,
      code: true,
      name: true,
      address: true,
      isActive: true,
      createdAt: true,
      _count: { select: { bins: true } },
      stockLevels: {
        select: { quantity: true, item: { select: { avgCost: true } } },
      },
    },
  });

  const result = warehouses.map((wh) => {
    const totalStockValue = wh.stockLevels.reduce(
      (sum, sl) => sum + sl.quantity * sl.item.avgCost,
      0
    );
    return {
      id: wh.id,
      code: wh.code,
      name: wh.name,
      address: wh.address,
      isActive: wh.isActive,
      createdAt: wh.createdAt,
      binCount: wh._count.bins,
      totalStockValue: Math.round(totalStockValue * 100) / 100,
    };
  });

  res.json(result);
}));

// ─── GET /:id — warehouse detail with bins and top items ───

router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const warehouse = await prisma.warehouse.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      code: true,
      name: true,
      address: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      bins: {
        select: {
          id: true,
          code: true,
          name: true,
          capacity: true,
          isActive: true,
        },
        orderBy: { code: 'asc' },
      },
    },
  });

  if (!warehouse) throw new NotFoundError('Warehouse', req.params.id);

  // Top items by stock value in this warehouse
  const topItems = await prisma.stockLevel.findMany({
    where: { warehouseId: req.params.id, quantity: { gt: 0 } },
    take: 20,
    orderBy: { quantity: 'desc' },
    select: {
      id: true,
      quantity: true,
      reservedQty: true,
      item: { select: { id: true, name: true, code: true, unit: true, avgCost: true } },
      bin: { select: { id: true, code: true } },
      batch: { select: { id: true, batchNo: true } },
    },
  });

  res.json({ ...warehouse, topItems });
}));

// Helper: generate next warehouse code (WH-001, WH-002, ...)
async function generateWarehouseCode(): Promise<string> {
  // Get all existing codes to avoid collisions
  const all = await prisma.warehouse.findMany({ select: { code: true } });
  const existingCodes = new Set(all.map(w => w.code));
  let num = all.length + 1;
  let code = `WH-${String(num).padStart(3, '0')}`;
  while (existingCodes.has(code)) {
    num++;
    code = `WH-${String(num).padStart(3, '0')}`;
  }
  return code;
}

// ─── POST / — create warehouse ───

router.post('/', authorize('ADMIN', 'MANAGER') as any, validate(createWarehouseSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const code = await generateWarehouseCode();
  const warehouse = await prisma.warehouse.create({ data: { ...req.body, code, companyId: getActiveCompanyId(req) } });
  res.status(201).json(warehouse);
}));

// ─── PUT /:id — update warehouse ───

router.put('/:id', authorize('ADMIN', 'MANAGER') as any, validate(updateWarehouseSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.warehouse.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new NotFoundError('Warehouse', req.params.id);

  const warehouse = await prisma.warehouse.update({
    where: { id: req.params.id },
    data: req.body,
  });
  res.json(warehouse);
}));

// ─── POST /:id/bins — add bin to warehouse ───

router.post('/:id/bins', authorize('ADMIN', 'MANAGER') as any, validate(createBinSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const warehouse = await prisma.warehouse.findUnique({ where: { id: req.params.id } });
  if (!warehouse) throw new NotFoundError('Warehouse', req.params.id);

  const bin = await prisma.storageBin.create({
    data: {
      warehouseId: req.params.id,
      code: req.body.code,
      name: req.body.name,
      capacity: req.body.capacity,
    },
  });
  res.status(201).json(bin);
}));

// ─── PUT /bins/:binId — update bin ───

router.put('/bins/:binId', authorize('ADMIN', 'MANAGER') as any, validate(updateBinSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.storageBin.findUnique({ where: { id: req.params.binId } });
  if (!existing) throw new NotFoundError('StorageBin', req.params.binId);

  const bin = await prisma.storageBin.update({
    where: { id: req.params.binId },
    data: req.body,
  });
  res.json(bin);
}));

export default router;
