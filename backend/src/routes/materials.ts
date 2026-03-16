import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate as any);

// GET / — list all active materials ordered by name
router.get('/', async (req: Request, res: Response) => {
  try {
    const materials = await prisma.material.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    res.json({ materials });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /:id — single material
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const material = await prisma.material.findUnique({
      where: { id: req.params.id },
    });
    if (!material) return res.status(404).json({ error: 'Material not found' });
    res.json(material);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST / — create material
router.post('/', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const material = await prisma.material.create({
      data: {
        name: b.name,
        category: b.category || 'RAW_MATERIAL',
        subCategory: b.subCategory || null,
        hsnCode: b.hsnCode || null,
        unit: b.unit || 'kg',
        gstPercent: b.gstPercent ? parseFloat(b.gstPercent) : 18,
        defaultRate: b.defaultRate ? parseFloat(b.defaultRate) : 0,
        minStock: b.minStock ? parseFloat(b.minStock) : 0,
        currentStock: 0,
        storageLocation: b.storageLocation || null,
        remarks: b.remarks || null,
        isActive: true,
      },
    });
    res.status(201).json(material);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PUT /:id — update material
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const b = req.body;
    const material = await prisma.material.update({
      where: { id: req.params.id },
      data: {
        name: b.name !== undefined ? b.name : undefined,
        category: b.category !== undefined ? b.category : undefined,
        subCategory: b.subCategory !== undefined ? b.subCategory : undefined,
        hsnCode: b.hsnCode !== undefined ? b.hsnCode : undefined,
        unit: b.unit !== undefined ? b.unit : undefined,
        gstPercent: b.gstPercent !== undefined ? parseFloat(b.gstPercent) : undefined,
        defaultRate: b.defaultRate !== undefined ? parseFloat(b.defaultRate) : undefined,
        minStock: b.minStock !== undefined ? parseFloat(b.minStock) : undefined,
        storageLocation: b.storageLocation !== undefined ? b.storageLocation : undefined,
        remarks: b.remarks !== undefined ? b.remarks : undefined,
      },
    });
    res.json(material);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /seed — seed default materials for distillery
router.post('/seed', authorize('ADMIN') as any, async (req: Request, res: Response) => {
  try {
    const materials = await prisma.material.createMany({
      data: [
        {
          name: 'Maize',
          category: 'RAW_MATERIAL',
          hsnCode: '1005',
          unit: 'MT',
          gstPercent: 5,
          isActive: true,
        },
        {
          name: 'Broken Rice',
          category: 'RAW_MATERIAL',
          hsnCode: '1006',
          unit: 'MT',
          gstPercent: 5,
          isActive: true,
        },
        {
          name: 'Alpha Amylase',
          category: 'CHEMICAL',
          subCategory: 'ENZYME',
          hsnCode: '3507',
          unit: 'LTR',
          gstPercent: 18,
          isActive: true,
        },
        {
          name: 'Gluco Amylase',
          category: 'CHEMICAL',
          subCategory: 'ENZYME',
          hsnCode: '3507',
          unit: 'LTR',
          gstPercent: 18,
          isActive: true,
        },
        {
          name: 'Yeast',
          category: 'CHEMICAL',
          hsnCode: '2102',
          unit: 'KG',
          gstPercent: 18,
          isActive: true,
        },
        {
          name: 'Sulphuric Acid',
          category: 'CHEMICAL',
          hsnCode: '2807',
          unit: 'KG',
          gstPercent: 18,
          isActive: true,
        },
        {
          name: 'Urea',
          category: 'CHEMICAL',
          hsnCode: '3102',
          unit: 'KG',
          gstPercent: 5,
          isActive: true,
        },
        {
          name: 'Antifoam',
          category: 'CHEMICAL',
          hsnCode: '3402',
          unit: 'LTR',
          gstPercent: 18,
          isActive: true,
        },
        {
          name: 'HSD/Diesel',
          category: 'FUEL',
          hsnCode: '2710',
          unit: 'LTR',
          gstPercent: 0,
          isActive: true,
        },
        {
          name: 'Furnace Oil',
          category: 'FUEL',
          hsnCode: '2710',
          unit: 'KL',
          gstPercent: 18,
          isActive: true,
        },
        {
          name: 'PP Bags',
          category: 'PACKING',
          hsnCode: '3923',
          unit: 'NOS',
          gstPercent: 18,
          isActive: true,
        },
        {
          name: 'HDPE Bags',
          category: 'PACKING',
          hsnCode: '3923',
          unit: 'NOS',
          gstPercent: 18,
          isActive: true,
        },
      ],
      skipDuplicates: true,
    });
    res.json({ created: materials.count });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
