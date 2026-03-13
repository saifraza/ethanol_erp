import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/auth';

const router = Router();
router.use(authenticate as any);

/* GET all recipes grouped by category */
router.get('/', async (_req: Request, res: Response) => {
  const recipes = await prisma.dosingRecipe.findMany({
    where: { isActive: true },
    orderBy: [{ category: 'asc' }, { order: 'asc' }]
  });
  res.json(recipes);
});

/* GET recipes by category */
router.get('/:category', async (req: Request, res: Response) => {
  const recipes = await prisma.dosingRecipe.findMany({
    where: { category: req.params.category.toUpperCase(), isActive: true },
    orderBy: { order: 'asc' }
  });
  res.json(recipes);
});

/* POST create recipe */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { category, chemicalName, quantity, unit, order } = req.body;
    const recipe = await prisma.dosingRecipe.create({
      data: {
        category: (category || 'FERMENTER').toUpperCase(),
        chemicalName: chemicalName || '',
        quantity: parseFloat(quantity) || 0,
        unit: unit || 'kg',
        order: parseInt(order) || 0
      }
    });
    res.status(201).json(recipe);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

/* PATCH update recipe */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const data: any = {};
    const b = req.body;
    if (b.chemicalName !== undefined) data.chemicalName = b.chemicalName;
    if (b.quantity !== undefined) data.quantity = parseFloat(b.quantity) || 0;
    if (b.unit !== undefined) data.unit = b.unit;
    if (b.order !== undefined) data.order = parseInt(b.order) || 0;
    if (b.category !== undefined) data.category = b.category.toUpperCase();
    const recipe = await prisma.dosingRecipe.update({ where: { id: req.params.id }, data });
    res.json(recipe);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

/* DELETE (soft) */
router.delete('/:id', async (req: Request, res: Response) => {
  await prisma.dosingRecipe.update({ where: { id: req.params.id }, data: { isActive: false } });
  res.json({ ok: true });
});

export default router;
