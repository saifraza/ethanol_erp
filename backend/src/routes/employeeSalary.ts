import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { calculateCtcBreakdown } from '../services/payrollCalculator';

const router = Router();
router.use(authenticate as any);

// GET /:employeeId — get salary breakdown
router.get('/:employeeId', asyncHandler(async (req: AuthRequest, res: Response) => {
  const employee = await prisma.employee.findUnique({
    where: { id: req.params.employeeId },
    select: { id: true, empCode: true, firstName: true, lastName: true, ctcAnnual: true, basicMonthly: true, epfApplicable: true, epfOnActualBasic: true, esiApplicable: true, ptApplicable: true },
  });
  if (!employee) { res.status(404).json({ error: 'Employee not found' }); return; }

  const components = await prisma.employeeSalaryComponent.findMany({
    where: { employeeId: req.params.employeeId },
    include: { component: true },
    orderBy: { component: { sortOrder: 'asc' } },
  
    take: 500,
  });

  // Also compute a live breakdown for comparison
  const breakdown = employee.ctcAnnual > 0
    ? calculateCtcBreakdown(employee.ctcAnnual, {
        epfApplicable: employee.epfApplicable,
        esiApplicable: employee.esiApplicable,
        epfOnActualBasic: employee.epfOnActualBasic,
        ptApplicable: true,
      })
    : null;

  res.json({ employee, components, breakdown });
}));

// PUT /:employeeId — set CTC and auto-calculate components
router.put('/:employeeId', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { ctcAnnual } = req.body;
  if (!ctcAnnual || parseFloat(ctcAnnual) <= 0) {
    res.status(400).json({ error: 'CTC must be greater than 0' }); return;
  }

  const employee = await prisma.employee.findUnique({ where: { id: req.params.employeeId } });
  if (!employee) { res.status(404).json({ error: 'Employee not found' }); return; }

  const ctc = parseFloat(ctcAnnual);
  const breakdown = calculateCtcBreakdown(ctc, {
    epfApplicable: employee.epfApplicable,
    esiApplicable: employee.esiApplicable,
    epfOnActualBasic: employee.epfOnActualBasic,
    ptApplicable: employee.ptApplicable,
  });

  // Update employee CTC and basic
  await prisma.employee.update({
    where: { id: req.params.employeeId },
    data: { ctcAnnual: ctc, basicMonthly: breakdown.basicMonthly },
  });

  // Get all salary component definitions
  const allComponents = await prisma.salaryComponent.findMany({ where: { isActive: true } ,
    take: 500,
  });
  const componentMap = new Map(allComponents.map(c => [c.code, c]));

  // Map breakdown to component amounts
  const componentAmounts: { code: string; monthly: number; annual: number }[] = [
    { code: 'BASIC', monthly: breakdown.basicMonthly, annual: breakdown.basicAnnual },
    { code: 'HRA', monthly: breakdown.hraMonthly, annual: breakdown.hraAnnual },
    { code: 'DA', monthly: breakdown.daMonthly, annual: breakdown.daAnnual },
    { code: 'SPECIAL', monthly: breakdown.specialMonthly, annual: breakdown.specialAnnual },
    { code: 'EPF_EE', monthly: breakdown.epfEmployeeMonthly, annual: breakdown.epfEmployeeMonthly * 12 },
    { code: 'ESI_EE', monthly: breakdown.esiEmployeeMonthly, annual: breakdown.esiEmployeeMonthly * 12 },
    { code: 'PT', monthly: breakdown.ptMonthly, annual: breakdown.ptMonthly * 12 },
    { code: 'EPF_ER_EPF', monthly: Math.round(breakdown.epfEmployerMonthly * 0.306), annual: Math.round(breakdown.epfEmployerMonthly * 0.306) * 12 }, // 3.67/12 ratio
    { code: 'EPF_ER_EPS', monthly: Math.round(breakdown.epfEmployerMonthly * 0.694), annual: Math.round(breakdown.epfEmployerMonthly * 0.694) * 12 }, // 8.33/12 ratio
    { code: 'EDLI', monthly: breakdown.edliMonthly, annual: breakdown.edliMonthly * 12 },
    { code: 'EPF_ADMIN', monthly: breakdown.epfAdminMonthly, annual: breakdown.epfAdminMonthly * 12 },
    { code: 'ESI_ER', monthly: breakdown.esiEmployerMonthly, annual: breakdown.esiEmployerMonthly * 12 },
    { code: 'GRATUITY', monthly: breakdown.gratuityMonthly, annual: breakdown.gratuityMonthly * 12 },
  ];

  // Upsert each component
  for (const ca of componentAmounts) {
    const comp = componentMap.get(ca.code);
    if (!comp) continue;
    await prisma.employeeSalaryComponent.upsert({
      where: { employeeId_componentId: { employeeId: req.params.employeeId, componentId: comp.id } },
      create: { employeeId: req.params.employeeId, componentId: comp.id, monthlyAmount: ca.monthly, annualAmount: ca.annual },
      update: { monthlyAmount: ca.monthly, annualAmount: ca.annual },
    });
  }

  const components = await prisma.employeeSalaryComponent.findMany({
    where: { employeeId: req.params.employeeId },
    include: { component: true },
    orderBy: { component: { sortOrder: 'asc' } },
  
    take: 500,
  });

  res.json({ breakdown, components });
}));

// POST /:employeeId/recalculate — recalculate from current CTC
router.post('/:employeeId/recalculate', asyncHandler(async (req: AuthRequest, res: Response) => {
  const employee = await prisma.employee.findUnique({ where: { id: req.params.employeeId } });
  if (!employee) { res.status(404).json({ error: 'Employee not found' }); return; }
  if (employee.ctcAnnual <= 0) { res.status(400).json({ error: 'No CTC set for this employee' }); return; }

  // Redirect to PUT with current CTC
  req.body = { ctcAnnual: employee.ctcAnnual };
  // Re-use the PUT logic by forwarding
  const breakdown = calculateCtcBreakdown(employee.ctcAnnual, {
    epfApplicable: employee.epfApplicable,
    esiApplicable: employee.esiApplicable,
    epfOnActualBasic: employee.epfOnActualBasic,
    ptApplicable: employee.ptApplicable,
  });
  res.json({ breakdown, message: 'Use PUT to persist changes' });
}));

export default router;
