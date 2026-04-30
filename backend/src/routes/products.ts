import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';

const router = Router();

router.use(authenticate as any);

// GET / — list all active products
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const products = await prisma.product.findMany({
    where: { isActive: true, ...getCompanyFilter(req) },
    orderBy: { name: 'asc' },
  
    take: 500,
  });
  res.json({ products });
}));

// POST / — create product
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const defaultRate = parseFloat(b.defaultRate) || 0;
  const gstPercent = parseFloat(b.gstPercent) || 0;

  const product = await prisma.product.create({
    data: {
      name: b.name || '',
      unit: b.unit || '',
      hsnCode: b.hsnCode || '',
      defaultRate,
      gstPercent,
      isActive: true,
      companyId: getActiveCompanyId(req),
    }
  });
  res.status(201).json(product);
}));

// PUT /:id — update product
router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const defaultRate = parseFloat(b.defaultRate) || 0;
  const gstPercent = parseFloat(b.gstPercent) || 0;

  const product = await prisma.product.update({
    where: { id: req.params.id },
    data: {
      name: b.name,
      unit: b.unit,
      hsnCode: b.hsnCode,
      defaultRate,
      gstPercent,
    }
  });
  res.json(product);
}));

// POST /seed — seed default products if none exist
router.post('/seed', asyncHandler(async (req: AuthRequest, res: Response) => {
  const existingCount = await prisma.product.count();

  if (existingCount > 0) {
    res.json({ message: 'Products already exist, skipping seed' });
    return;
  }

  const seedProducts = [
    { name: 'DDGS', unit: 'TON', hsnCode: '2303', defaultRate: 4.54, gstPercent: 18, isActive: true },
    { name: 'ETHANOL', unit: 'KL', hsnCode: '2207', defaultRate: 0, gstPercent: 5, isActive: true },
    { name: 'LFO', unit: 'KL', hsnCode: '2710', defaultRate: 0, gstPercent: 18, isActive: true },
    { name: 'HFO', unit: 'KL', hsnCode: '2710', defaultRate: 0, gstPercent: 18, isActive: true },
    { name: 'RS', unit: 'KL', hsnCode: '2207', defaultRate: 0, gstPercent: 18, isActive: true },
  ];

  const result = await prisma.product.createMany({
    data: seedProducts,
    skipDuplicates: true,
  });

  res.status(201).json({ created: result.count, products: seedProducts });
}));

export default router;
