import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { NotFoundError } from '../shared/errors';
import { z } from 'zod';
import prisma from '../config/prisma';
import bcrypt from 'bcryptjs';

const router = Router();

const createSchema = z.object({
  code: z.string().min(1).transform((v) => v.toUpperCase()),
  name: z.string().min(1),
  shortName: z.string().optional(),
  gstin: z.string().optional(),
  pan: z.string().optional(),
  gstState: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  contactPerson: z.string().optional(),
  phone: z.string().optional(),
  email: z.union([z.string().email(), z.literal('')]).optional(),
  bankName: z.string().optional(),
  bankBranch: z.string().optional(),
  bankAccount: z.string().optional(),
  bankIfsc: z.string().optional(),
  isDefault: z.boolean().optional(),
});

const updateSchema = createSchema.partial();

// GET / — List all active companies
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const take = Math.min(parseInt(req.query.limit as string) || 50, 500);
  const skip = parseInt(req.query.offset as string) || 0;
  const companies = await prisma.company.findMany({
    where: { isActive: true },
    take,
    skip,
    orderBy: { name: 'asc' },
    select: {
      id: true,
      code: true,
      name: true,
      shortName: true,
      gstin: true,
      isDefault: true,
      isActive: true,
      _count: { select: { users: true } },
    },
  });
  res.json(companies);
}));

// GET /current — Get the current user's company
router.get('/current', asyncHandler(async (req: AuthRequest, res: Response) => {
  const companyId = req.user?.companyId;
  if (!companyId) {
    return res.status(400).json({ error: 'No company associated with current user' });
  }
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) throw new NotFoundError('Company', companyId);
  res.json(company);
}));

// GET /:id — Get company detail (all fields)
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const company = await prisma.company.findUnique({ where: { id: req.params.id } });
  if (!company) throw new NotFoundError('Company', req.params.id);
  res.json(company);
}));

// GET /:id/summary — Procurement summary for a company
router.get('/:id/summary', asyncHandler(async (req: AuthRequest, res: Response) => {
  const companyId = req.params.id;
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
  if (!company) throw new NotFoundError('Company', companyId);

  const [vendorCount, poCount, grnCount] = await Promise.all([
    prisma.vendor.count({ where: { companyId } }),
    prisma.purchaseOrder.count({ where: { companyId } }),
    prisma.goodsReceipt.count({ where: { companyId } }),
  ]);

  res.json({ companyId, vendors: vendorCount, purchaseOrders: poCount, goodsReceipts: grnCount });
}));

// POST / — Create company (admin only) + auto-create admin user
router.post('/', validate(createSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const company = await prisma.company.create({ data: req.body });

  const hashedPassword = await bcrypt.hash('admin123', 10);
  await prisma.user.create({
    data: {
      email: `admin@${company.code.toLowerCase()}.local`,
      password: hashedPassword,
      name: `${company.shortName || company.name} Admin`,
      role: 'ADMIN',
      companyId: company.id,
    },
  });

  res.status(201).json(company);
}));

// PUT /:id — Update company fields
router.put('/:id', validate(updateSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.company.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!existing) throw new NotFoundError('Company', req.params.id);

  const company = await prisma.company.update({
    where: { id: req.params.id },
    data: req.body,
  });
  res.json(company);
}));

export default router;
