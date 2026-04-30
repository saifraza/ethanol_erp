import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';

const router = Router();
router.use(authenticate as any);

/* GET all recipes grouped by category */
router.get('/', async (_req: AuthRequest, res: Response) => {
  const recipes = await prisma.dosingRecipe.findMany({
    where: { isActive: true },
    orderBy: [{ category: 'asc' }, { order: 'asc' }]
  ,
    take: 500,
  });
  res.json(recipes);
});

/* GET recipes by category */
router.get('/:category', async (req: AuthRequest, res: Response) => {
  const recipes = await prisma.dosingRecipe.findMany({
    where: { category: req.params.category.toUpperCase(), isActive: true },
    orderBy: { order: 'asc' }
  ,
    take: 500,
  });
  res.json(recipes);
});

/* POST create recipe */
router.post('/', authorize('ADMIN') as any, asyncHandler(async (req: AuthRequest, res: Response) => {
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
}));

/* PATCH update recipe */
router.patch('/:id', authorize('ADMIN') as any, asyncHandler(async (req: AuthRequest, res: Response) => {
  const data: Record<string, unknown> = {};
  const b = req.body;
  if (b.chemicalName !== undefined) data.chemicalName = b.chemicalName;
  if (b.quantity !== undefined) data.quantity = parseFloat(b.quantity) || 0;
  if (b.unit !== undefined) data.unit = b.unit;
  if (b.order !== undefined) data.order = parseInt(b.order) || 0;
  if (b.category !== undefined) data.category = b.category.toUpperCase();
  const recipe = await prisma.dosingRecipe.update({ where: { id: req.params.id }, data });
  res.json(recipe);
}));

/* DELETE (soft) */
router.delete('/:id', authorize('ADMIN') as any, async (req: AuthRequest, res: Response) => {
  await prisma.dosingRecipe.update({ where: { id: req.params.id }, data: { isActive: false } });
  res.json({ ok: true });
});

export default router;
