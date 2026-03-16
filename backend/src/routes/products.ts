import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate as any);

// GET / — list all active products
router.get('/', async (req: Request, res: Response) => {
  try {
    const products = await prisma.product.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    res.json({ products });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST / — create product
router.post('/', async (req: Request, res: Response) => {
  try {
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
      }
    });
    res.status(201).json(product);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /:id — update product
router.put('/:id', async (req: Request, res: Response) => {
  try {
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
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /seed — seed default products if none exist
router.post('/seed', async (req: Request, res: Response) => {
  try {
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
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
