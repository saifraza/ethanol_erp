import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';

const router = Router();
router.use(authenticate as any);

const DEFAULT_COMPONENTS = [
  { code: 'BASIC', name: 'Basic Salary', type: 'EARNING', isStatutory: false, isTaxable: true, isPfWage: true, calculationType: 'PERCENTAGE_OF_GROSS', defaultPct: 50, sortOrder: 1 },
  { code: 'HRA', name: 'House Rent Allowance', type: 'EARNING', isStatutory: false, isTaxable: true, isPfWage: false, calculationType: 'PERCENTAGE_OF_BASIC', defaultPct: 40, sortOrder: 2 },
  { code: 'DA', name: 'Dearness Allowance', type: 'EARNING', isStatutory: false, isTaxable: true, isPfWage: true, calculationType: 'FIXED', defaultPct: null, sortOrder: 3 },
  { code: 'SPECIAL', name: 'Special Allowance', type: 'EARNING', isStatutory: false, isTaxable: true, isPfWage: false, calculationType: 'FORMULA', defaultPct: null, sortOrder: 4 },
  { code: 'CONV', name: 'Conveyance Allowance', type: 'EARNING', isStatutory: false, isTaxable: true, isPfWage: false, calculationType: 'FIXED', defaultPct: null, sortOrder: 5 },
  { code: 'EPF_EE', name: 'EPF (Employee)', type: 'DEDUCTION', isStatutory: true, isTaxable: false, isPfWage: false, calculationType: 'FORMULA', defaultPct: 12, sortOrder: 10 },
  { code: 'ESI_EE', name: 'ESI (Employee)', type: 'DEDUCTION', isStatutory: true, isTaxable: false, isPfWage: false, calculationType: 'FORMULA', defaultPct: 0.75, sortOrder: 11 },
  { code: 'PT', name: 'Professional Tax', type: 'DEDUCTION', isStatutory: true, isTaxable: false, isPfWage: false, calculationType: 'FORMULA', defaultPct: null, sortOrder: 12 },
  { code: 'TDS', name: 'TDS on Salary', type: 'DEDUCTION', isStatutory: true, isTaxable: false, isPfWage: false, calculationType: 'FORMULA', defaultPct: null, sortOrder: 13 },
  { code: 'EPF_ER_EPF', name: 'EPF Employer (EPF a/c)', type: 'EMPLOYER_CONTRIBUTION', isStatutory: true, isTaxable: false, isPfWage: false, calculationType: 'FORMULA', defaultPct: 3.67, sortOrder: 20 },
  { code: 'EPF_ER_EPS', name: 'EPF Employer (EPS)', type: 'EMPLOYER_CONTRIBUTION', isStatutory: true, isTaxable: false, isPfWage: false, calculationType: 'FORMULA', defaultPct: 8.33, sortOrder: 21 },
  { code: 'EDLI', name: 'EDLI (Employer)', type: 'EMPLOYER_CONTRIBUTION', isStatutory: true, isTaxable: false, isPfWage: false, calculationType: 'FORMULA', defaultPct: 0.5, sortOrder: 22 },
  { code: 'EPF_ADMIN', name: 'EPF Admin Charges', type: 'EMPLOYER_CONTRIBUTION', isStatutory: true, isTaxable: false, isPfWage: false, calculationType: 'FORMULA', defaultPct: 0.5, sortOrder: 23 },
  { code: 'ESI_ER', name: 'ESI (Employer)', type: 'EMPLOYER_CONTRIBUTION', isStatutory: true, isTaxable: false, isPfWage: false, calculationType: 'FORMULA', defaultPct: 3.25, sortOrder: 24 },
  { code: 'GRATUITY', name: 'Gratuity Provision', type: 'EMPLOYER_CONTRIBUTION', isStatutory: true, isTaxable: false, isPfWage: false, calculationType: 'FORMULA', defaultPct: 4.81, sortOrder: 25 },
];

async function seedDefaults() {
  const existing = await prisma.salaryComponent.count();
  if (existing === 0) {
    await prisma.salaryComponent.createMany({ data: DEFAULT_COMPONENTS });
  }
}

// GET /
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  await seedDefaults();
  const components = await prisma.salaryComponent.findMany({ orderBy: { sortOrder: 'asc' } ,
    take: 500,
  });
  res.json({ components });
}));

// POST /
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { code, name, type, isStatutory, isTaxable, isPfWage, calculationType, defaultPct, sortOrder } = req.body;
  if (!code?.trim() || !name?.trim()) { res.status(400).json({ error: 'Code and name required' }); return; }
  const component = await prisma.salaryComponent.create({
    data: {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      type: type || 'EARNING',
      isStatutory: isStatutory || false,
      isTaxable: isTaxable !== false,
      isPfWage: isPfWage || false,
      calculationType: calculationType || 'FIXED',
      defaultPct: defaultPct ? parseFloat(defaultPct) : null,
      sortOrder: sortOrder ? parseInt(sortOrder) : 99,
    },
  });
  res.status(201).json(component);
}));

// PUT /:id
router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const component = await prisma.salaryComponent.update({
    where: { id: req.params.id },
    data: {
      ...(b.name !== undefined && { name: b.name.trim() }),
      ...(b.type !== undefined && { type: b.type }),
      ...(b.isTaxable !== undefined && { isTaxable: b.isTaxable }),
      ...(b.isPfWage !== undefined && { isPfWage: b.isPfWage }),
      ...(b.defaultPct !== undefined && { defaultPct: b.defaultPct ? parseFloat(b.defaultPct) : null }),
      ...(b.sortOrder !== undefined && { sortOrder: parseInt(b.sortOrder) }),
      ...(b.isActive !== undefined && { isActive: b.isActive }),
    },
  });
  res.json(component);
}));

export default router;
