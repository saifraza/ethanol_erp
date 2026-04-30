import { Router, Response } from 'express';
import { authenticate, AuthRequest, authorize, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import prisma from '../config/prisma';

const router = Router();
router.use(authenticate);

// GET / — list departments (with optional division filter)
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { businessDivisionId } = req.query;
  const where: Record<string, unknown> = { ...getCompanyFilter(req) };
  if (businessDivisionId) where.businessDivisionId = businessDivisionId;
  const departments = await prisma.department.findMany({
    where,
    orderBy: { name: 'asc' },
    take: 200,
    include: { businessDivision: { select: { id: true, name: true, code: true } } },
  });
  res.json(departments);
}));

// POST / — create department
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { name, code, businessDivisionId } = req.body;
  if (!name) { res.status(400).json({ error: 'Name is required' }); return; }
  const dept = await prisma.department.create({
    data: {
      name,
      code: code || null,
      businessDivisionId: businessDivisionId || null,
      companyId: getActiveCompanyId(req),
    },
  });
  res.status(201).json(dept);
}));

// PUT /:id — update department
router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { name, code, isActive, businessDivisionId } = req.body;
  const dept = await prisma.department.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined && { name }),
      ...(code !== undefined && { code }),
      ...(isActive !== undefined && { isActive }),
      ...(businessDivisionId !== undefined && { businessDivisionId: businessDivisionId || null }),
    },
  });
  res.json(dept);
}));

// DELETE /:id — deactivate (soft delete), SUPER_ADMIN only
router.delete('/:id', authorize('SUPER_ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.department.update({
    where: { id: req.params.id },
    data: { isActive: false },
  });
  res.json({ ok: true });
}));

export default router;
