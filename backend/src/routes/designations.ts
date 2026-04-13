import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';

const router = Router();
router.use(authenticate as any);

// GET / — list all designations
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const designations = await prisma.designation.findMany({
    where: { ...getCompanyFilter(req) },
    orderBy: [{ level: 'asc' }, { title: 'asc' }],
    include: { _count: { select: { employees: true } } },
  });
  res.json({ designations });
}));

// GET /:id
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const d = await prisma.designation.findUnique({
    where: { id: req.params.id },
    include: { employees: { where: { isActive: true }, select: { id: true, empCode: true, firstName: true, lastName: true } } },
  });
  if (!d) { res.status(404).json({ error: 'Not found' }); return; }
  res.json({ designation: d });
}));

// POST /
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { title, grade, band, level, minSalary, maxSalary } = req.body;
  if (!title?.trim()) { res.status(400).json({ error: 'Title is required' }); return; }
  const designation = await prisma.designation.create({
    data: {
      title: title.trim(),
      grade: grade || null,
      band: band || null,
      level: level ? parseInt(level) : 0,
      minSalary: minSalary ? parseFloat(minSalary) : null,
      maxSalary: maxSalary ? parseFloat(maxSalary) : null,
      companyId: getActiveCompanyId(req),
    },
  });
  res.status(201).json({ designation });
}));

// PUT /:id
router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { title, grade, band, level, minSalary, maxSalary, isActive } = req.body;
  const designation = await prisma.designation.update({
    where: { id: req.params.id },
    data: {
      ...(title !== undefined && { title: title.trim() }),
      ...(grade !== undefined && { grade: grade || null }),
      ...(band !== undefined && { band: band || null }),
      ...(level !== undefined && { level: parseInt(level) }),
      ...(minSalary !== undefined && { minSalary: minSalary ? parseFloat(minSalary) : null }),
      ...(maxSalary !== undefined && { maxSalary: maxSalary ? parseFloat(maxSalary) : null }),
      ...(isActive !== undefined && { isActive }),
    },
  });
  res.json({ designation });
}));

// DELETE /:id — soft delete
router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.designation.update({ where: { id: req.params.id }, data: { isActive: false } });
  res.json({ ok: true });
}));

export default router;
