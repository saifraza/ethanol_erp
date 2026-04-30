import { Router, Response } from 'express';
import { authenticate, AuthRequest, authorize, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import prisma from '../config/prisma';

const router = Router();
router.use(authenticate);

// GET / — list business divisions (+ department count)
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const divisions = await prisma.businessDivision.findMany({
    where: { ...getCompanyFilter(req) },
    orderBy: { name: 'asc' },
    take: 100,
    include: { _count: { select: { departments: true } } },
  });
  res.json(divisions);
}));

// POST / — create a business division
router.post('/', authorize('ADMIN', 'SUPER_ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { name, code, description } = req.body;
  if (!name || !String(name).trim()) { res.status(400).json({ error: 'Name is required' }); return; }
  const division = await prisma.businessDivision.create({
    data: {
      name: String(name).trim(),
      code: code ? String(code).trim().toUpperCase() : null,
      description: description || null,
      companyId: getActiveCompanyId(req),
    },
  });
  res.status(201).json(division);
}));

// PUT /:id — update a business division
router.put('/:id', authorize('ADMIN', 'SUPER_ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { name, code, description, isActive } = req.body;
  const division = await prisma.businessDivision.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined && { name: String(name).trim() }),
      ...(code !== undefined && { code: code ? String(code).trim().toUpperCase() : null }),
      ...(description !== undefined && { description }),
      ...(isActive !== undefined && { isActive }),
    },
  });
  res.json(division);
}));

// DELETE /:id — soft delete
router.delete('/:id', authorize('SUPER_ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.businessDivision.update({
    where: { id: req.params.id },
    data: { isActive: false },
  });
  res.json({ ok: true });
}));

export default router;
