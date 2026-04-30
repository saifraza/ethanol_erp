/**
 * HR — TDS (Section 192 — Salary)
 *
 * Endpoints:
 *   GET  /declarations                — list employees + tax declarations + projected annual TDS
 *   PUT  /declarations/:employeeId    — update employee tax declarations (regime, 80C, 80D, HRA, rent)
 *   GET  /projection/:employeeId      — annual tax projection breakdown (slab tax, rebate, cess)
 *   GET  /register?fy=&month=&year=   — monthly TDS register (one row per employee, deducted in payroll)
 *   GET  /24q?fy=&quarter=            — Form 24Q quarterly TDS report (CSV export)
 *   GET  /form16/:employeeId?fy=      — Form 16 part-B equivalent JSON
 *   GET  /challans?fy=                — list TDS challans (govt deposits)
 *   POST /challans                    — record a new TDS challan (ITNS-281)
 *   PUT  /challans/:id                — update challan
 *   DELETE /challans/:id              — delete challan
 *   POST /challans/:id/file-24q       — mark challan as filed in Form 24Q
 *   GET  /summary?fy=                 — FY-level summary (total deducted vs deposited vs gap)
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { calculateTdsOnSalary } from '../services/payrollCalculator';

const router = Router();
router.use(authenticate as any);

// ── Helpers ───────────────────────────────────────────────────
function fyFromMonth(month: number, year: number): { fyCode: string; fyStart: Date; fyEnd: Date } {
  const fyStartYear = month >= 4 ? year : year - 1;
  return {
    fyCode: `${fyStartYear}-${String(fyStartYear + 1).slice(-2)}`,
    fyStart: new Date(fyStartYear, 3, 1), // April 1
    fyEnd: new Date(fyStartYear + 1, 2, 31, 23, 59, 59), // March 31
  };
}

function quarterFromMonth(month: number): number {
  // FY quarter: Q1=Apr-Jun(4-6), Q2=Jul-Sep(7-9), Q3=Oct-Dec(10-12), Q4=Jan-Mar(1-3)
  if (month >= 4 && month <= 6) return 1;
  if (month >= 7 && month <= 9) return 2;
  if (month >= 10 && month <= 12) return 3;
  return 4;
}

function monthsInQuarter(quarter: number, fyStartYear: number): { month: number; year: number }[] {
  if (quarter === 1) return [{ month: 4, year: fyStartYear }, { month: 5, year: fyStartYear }, { month: 6, year: fyStartYear }];
  if (quarter === 2) return [{ month: 7, year: fyStartYear }, { month: 8, year: fyStartYear }, { month: 9, year: fyStartYear }];
  if (quarter === 3) return [{ month: 10, year: fyStartYear }, { month: 11, year: fyStartYear }, { month: 12, year: fyStartYear }];
  return [{ month: 1, year: fyStartYear + 1 }, { month: 2, year: fyStartYear + 1 }, { month: 3, year: fyStartYear + 1 }];
}

function fyStartYearFromCode(fyCode: string): number {
  return parseInt(fyCode.split('-')[0], 10);
}

// ════════════════════════════════════════════════════════════
// GET /declarations — employee tax declarations + projected TDS
// ════════════════════════════════════════════════════════════
router.get('/declarations', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { search, regime, division, season } = req.query;
  const where: any = { isActive: true, status: 'ACTIVE', ...getCompanyFilter(req) };
  if (regime) where.taxRegime = regime;
  if (division) where.division = division;
  if (season) where.seasonalStatus = season;
  if (search) {
    const s = search as string;
    where.OR = [
      { firstName: { contains: s, mode: 'insensitive' } },
      { lastName: { contains: s, mode: 'insensitive' } },
      { empCode: { contains: s, mode: 'insensitive' } },
      { pan: { contains: s, mode: 'insensitive' } },
    ];
  }

  const employees = await prisma.employee.findMany({
    where,
    take: 500,
    orderBy: { empNo: 'asc' },
    select: {
      id: true, empCode: true, firstName: true, lastName: true, pan: true, division: true,
      ctcAnnual: true, basicMonthly: true, taxRegime: true, epfApplicable: true,
      declared80C: true, declared80D: true, declaredHRA: true, declaredOther: true, rentPaidMonthly: true,
      seasonalStatus: true,
      department: { select: { name: true } },
      designation: { select: { title: true } },
    },
  });

  // Project TDS for each employee
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const enriched = employees.map(emp => {
    const annualGross = emp.basicMonthly > 0 ? (emp.ctcAnnual || emp.basicMonthly * 12) : 0;
    // Simple gross approximation — for declaration page, use full CTC as cap
    const grossMonthly = emp.ctcAnnual ? Math.round(emp.ctcAnnual / 12) : 0;
    const epfEmployeeAnnual = emp.epfApplicable && emp.basicMonthly > 0
      ? Math.round(Math.min(emp.basicMonthly, 15000) * 0.12 * 12)
      : 0;
    const tds = calculateTdsOnSalary(
      grossMonthly * 12,
      (emp.taxRegime === 'OLD' ? 'OLD' : 'NEW'),
      month,
      0,
      {
        declared80C: emp.declared80C,
        declared80D: emp.declared80D,
        declaredOther: emp.declaredOther,
        epfEmployeeAnnual,
      }
    );
    return {
      id: emp.id,
      empCode: emp.empCode,
      name: `${emp.firstName} ${emp.lastName}`.trim(),
      pan: emp.pan || null,
      panMissing: !emp.pan,
      division: emp.division,
      department: emp.department?.name || null,
      designation: emp.designation?.title || null,
      seasonalStatus: emp.seasonalStatus,
      ctcAnnual: emp.ctcAnnual,
      taxRegime: emp.taxRegime,
      declared80C: emp.declared80C,
      declared80D: emp.declared80D,
      declaredHRA: emp.declaredHRA,
      declaredOther: emp.declaredOther,
      rentPaidMonthly: emp.rentPaidMonthly,
      // Projection
      annualGross: tds.annualGross,
      taxableIncome: tds.taxableIncome,
      annualTax: tds.annualTax,
      monthlyTds: tds.monthlyTds,
    };
  });

  // Aggregates
  const totals = enriched.reduce((acc, e) => {
    acc.employees += 1;
    acc.annualGross += e.annualGross;
    acc.taxableIncome += e.taxableIncome;
    acc.annualTax += e.annualTax;
    acc.monthlyTds += e.monthlyTds;
    if (e.panMissing) acc.panMissing += 1;
    if (e.taxRegime === 'NEW') acc.newRegime += 1; else acc.oldRegime += 1;
    return acc;
  }, { employees: 0, annualGross: 0, taxableIncome: 0, annualTax: 0, monthlyTds: 0, panMissing: 0, newRegime: 0, oldRegime: 0 });

  res.json({ employees: enriched, totals });
}));

// ════════════════════════════════════════════════════════════
// PUT /declarations/:employeeId — update tax declarations
// ════════════════════════════════════════════════════════════
const declarationSchema = z.object({
  taxRegime: z.enum(['NEW', 'OLD']).optional(),
  declared80C: z.number().min(0).max(150000).optional(),
  declared80D: z.number().min(0).max(100000).optional(),
  declaredHRA: z.number().min(0).optional(),
  declaredOther: z.number().min(0).optional(),
  rentPaidMonthly: z.number().min(0).optional(),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Invalid PAN format').optional().or(z.literal('')),
});

router.put('/declarations/:employeeId', validate(declarationSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const data: any = {};
  const b = req.body;
  if (b.taxRegime !== undefined) data.taxRegime = b.taxRegime;
  if (b.declared80C !== undefined) data.declared80C = b.declared80C;
  if (b.declared80D !== undefined) data.declared80D = b.declared80D;
  if (b.declaredHRA !== undefined) data.declaredHRA = b.declaredHRA;
  if (b.declaredOther !== undefined) data.declaredOther = b.declaredOther;
  if (b.rentPaidMonthly !== undefined) data.rentPaidMonthly = b.rentPaidMonthly;
  if (b.pan !== undefined) data.pan = b.pan ? b.pan.toUpperCase() : null;

  const employee = await prisma.employee.update({
    where: { id: req.params.employeeId },
    data,
    select: {
      id: true, empCode: true, firstName: true, lastName: true, pan: true,
      taxRegime: true, declared80C: true, declared80D: true, declaredHRA: true,
      declaredOther: true, rentPaidMonthly: true,
    },
  });
  res.json({ employee });
}));

// ════════════════════════════════════════════════════════════
// GET /projection/:employeeId — full annual tax projection
// ════════════════════════════════════════════════════════════
router.get('/projection/:employeeId', asyncHandler(async (req: AuthRequest, res: Response) => {
  const emp = await prisma.employee.findUnique({
    where: { id: req.params.employeeId },
    include: { department: { select: { name: true } }, designation: { select: { title: true } } },
  });
  if (!emp) { res.status(404).json({ error: 'Employee not found' }); return; }

  const now = new Date();
  const month = now.getMonth() + 1;
  const fyInfo = fyFromMonth(month, now.getFullYear());

  // YTD TDS already deducted this FY
  const ytdLines = await prisma.payrollLine.findMany({
    where: {
      employeeId: emp.id,
      payrollRun: { status: { in: ['COMPUTED', 'APPROVED', 'PAID'] } },
      OR: [
        { payrollRun: { year: fyStartYearFromCode(fyInfo.fyCode), month: { gte: 4 } } },
        { payrollRun: { year: fyStartYearFromCode(fyInfo.fyCode) + 1, month: { lt: 4 } } },
      ],
    },
    select: { tds: true, grossEarnings: true, payrollRun: { select: { month: true, year: true } } },
  
    take: 500,
  });
  const ytdTds = ytdLines.reduce((s, l) => s + (l.tds || 0), 0);
  const ytdGross = ytdLines.reduce((s, l) => s + (l.grossEarnings || 0), 0);

  const annualGross = emp.ctcAnnual || (emp.basicMonthly * 12);
  const epfEmployeeAnnual = emp.epfApplicable && emp.basicMonthly > 0
    ? Math.round(Math.min(emp.basicMonthly, 15000) * 0.12 * 12)
    : 0;

  // Compute both regimes for comparison
  const newProjection = calculateTdsOnSalary(annualGross, 'NEW', month, ytdTds, {
    declared80C: emp.declared80C,
    declared80D: emp.declared80D,
    declaredOther: emp.declaredOther,
    epfEmployeeAnnual,
  });
  const oldProjection = calculateTdsOnSalary(annualGross, 'OLD', month, ytdTds, {
    declared80C: emp.declared80C,
    declared80D: emp.declared80D,
    declaredOther: emp.declaredOther,
    epfEmployeeAnnual,
  });

  const active = emp.taxRegime === 'OLD' ? oldProjection : newProjection;
  const recommended = newProjection.annualTax <= oldProjection.annualTax ? 'NEW' : 'OLD';

  res.json({
    employee: {
      id: emp.id,
      empCode: emp.empCode,
      name: `${emp.firstName} ${emp.lastName}`.trim(),
      pan: emp.pan,
      department: emp.department?.name,
      designation: emp.designation?.title,
      ctcAnnual: emp.ctcAnnual,
      basicMonthly: emp.basicMonthly,
      taxRegime: emp.taxRegime,
      declared80C: emp.declared80C,
      declared80D: emp.declared80D,
      declaredHRA: emp.declaredHRA,
      declaredOther: emp.declaredOther,
      rentPaidMonthly: emp.rentPaidMonthly,
    },
    fyCode: fyInfo.fyCode,
    currentMonth: month,
    epfEmployeeAnnual,
    ytdGross,
    ytdTds,
    ytdMonthBreakdown: ytdLines.map(l => ({
      month: l.payrollRun.month,
      year: l.payrollRun.year,
      gross: l.grossEarnings,
      tds: l.tds,
    })),
    active,
    newRegime: newProjection,
    oldRegime: oldProjection,
    recommendedRegime: recommended,
    savings: Math.abs(newProjection.annualTax - oldProjection.annualTax),
  });
}));

// ════════════════════════════════════════════════════════════
// GET /register — monthly TDS register (Section 192)
// ════════════════════════════════════════════════════════════
router.get('/register', asyncHandler(async (req: AuthRequest, res: Response) => {
  const month = parseInt((req.query.month as string) || String(new Date().getMonth() + 1), 10);
  const year = parseInt((req.query.year as string) || String(new Date().getFullYear()), 10);

  const run = await prisma.payrollRun.findFirst({
    where: { month, year, ...getCompanyFilter(req) },
  });

  if (!run) {
    res.json({ run: null, lines: [], totals: { tds: 0, employees: 0 }, month, year });
    return;
  }

  const lines = await prisma.payrollLine.findMany({
    where: { payrollRunId: run.id, tds: { gt: 0 } },
    orderBy: { employee: { empNo: 'asc' } },
    select: {
      id: true, tds: true, grossEarnings: true,
      employee: {
        select: {
          id: true, empCode: true, firstName: true, lastName: true, pan: true,
          taxRegime: true, division: true,
          department: { select: { name: true } },
          designation: { select: { title: true } },
        },
      },
    },
  
    take: 500,
  });

  const totals = lines.reduce((acc, l) => {
    acc.tds += l.tds;
    acc.gross += l.grossEarnings;
    acc.employees += 1;
    if (!l.employee.pan) acc.panMissing += 1;
    return acc;
  }, { tds: 0, gross: 0, employees: 0, panMissing: 0 });

  res.json({
    run: { id: run.id, month: run.month, year: run.year, status: run.status, totalTds: run.totalTds },
    lines: lines.map(l => ({
      id: l.id,
      empCode: l.employee.empCode,
      name: `${l.employee.firstName} ${l.employee.lastName}`.trim(),
      pan: l.employee.pan,
      panMissing: !l.employee.pan,
      division: l.employee.division,
      department: l.employee.department?.name,
      designation: l.employee.designation?.title,
      regime: l.employee.taxRegime,
      gross: l.grossEarnings,
      tds: l.tds,
      section: '192',
    })),
    totals,
    month,
    year,
  });
}));

// ════════════════════════════════════════════════════════════
// GET /24q — Form 24Q quarterly TDS export
// ════════════════════════════════════════════════════════════
router.get('/24q', asyncHandler(async (req: AuthRequest, res: Response) => {
  const fyCode = (req.query.fy as string) || '';
  const quarter = parseInt((req.query.quarter as string) || '1', 10);
  const format = (req.query.format as string) || 'json'; // json | csv

  if (!fyCode || !quarter) { res.status(400).json({ error: 'fy and quarter required' }); return; }

  const fyStart = fyStartYearFromCode(fyCode);
  const months = monthsInQuarter(quarter, fyStart);

  // Get all payroll runs in the quarter
  const runs = await prisma.payrollRun.findMany({
    where: {
      OR: months.map(m => ({ month: m.month, year: m.year })),
      status: { in: ['COMPUTED', 'APPROVED', 'PAID'] },
      ...getCompanyFilter(req),
    },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  
    take: 500,
  });

  if (runs.length === 0) {
    res.json({ fyCode, quarter, months, runs: [], deductees: [], totals: { tds: 0, employees: 0 }, challans: [] });
    return;
  }

  const lines = await prisma.payrollLine.findMany({
    where: { payrollRunId: { in: runs.map(r => r.id) }, tds: { gt: 0 } },
    select: {
      tds: true, grossEarnings: true,
      payrollRun: { select: { month: true, year: true } },
      employee: {
        select: {
          id: true, empCode: true, firstName: true, lastName: true, pan: true, taxRegime: true,
        },
      },
    },
  
    take: 500,
  });

  // Aggregate per employee (deductee)
  const byEmp: Record<string, any> = {};
  for (const l of lines) {
    const key = l.employee.id;
    if (!byEmp[key]) {
      byEmp[key] = {
        employeeId: l.employee.id,
        empCode: l.employee.empCode,
        name: `${l.employee.firstName} ${l.employee.lastName}`.trim(),
        pan: l.employee.pan || 'PANNOTAVBL',
        regime: l.employee.taxRegime,
        section: '192',
        gross: 0,
        tds: 0,
        months: [] as any[],
      };
    }
    byEmp[key].gross += l.grossEarnings;
    byEmp[key].tds += l.tds;
    byEmp[key].months.push({ month: l.payrollRun.month, year: l.payrollRun.year, tds: l.tds });
  }
  const deductees = Object.values(byEmp);

  // Get challans for this quarter
  const challans = await prisma.tdsChallan.findMany({
    where: { fyCode, quarter, ...getCompanyFilter(req) },
    orderBy: [{ month: 'asc' }, { depositDate: 'asc' }],
  
    take: 500,
  });

  const totals = deductees.reduce((acc: any, d: any) => {
    acc.tds += d.tds;
    acc.gross += d.gross;
    acc.employees += 1;
    if (d.pan === 'PANNOTAVBL') acc.panMissing += 1;
    return acc;
  }, { tds: 0, gross: 0, employees: 0, panMissing: 0 });
  const totalDeposited = challans.reduce((s, c) => s + c.amount, 0);

  if (format === 'csv') {
    const rows = [
      ['SerialNo', 'EmpCode', 'Name', 'PAN', 'Section', 'Regime', 'GrossPaid', 'TDSDeducted'].join(','),
      ...deductees.map((d: any, i: number) =>
        [i + 1, d.empCode, `"${d.name}"`, d.pan, d.section, d.regime, d.gross.toFixed(2), d.tds.toFixed(2)].join(',')),
      '',
      `Totals,,,,,,${totals.gross.toFixed(2)},${totals.tds.toFixed(2)}`,
      `Challans Deposited,,,,,,,${totalDeposited.toFixed(2)}`,
      `Gap,,,,,,,${(totals.tds - totalDeposited).toFixed(2)}`,
    ];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="Form24Q_${fyCode}_Q${quarter}.csv"`);
    res.send(rows.join('\n'));
    return;
  }

  res.json({
    fyCode, quarter, months,
    runs: runs.map(r => ({ id: r.id, month: r.month, year: r.year, totalTds: r.totalTds, status: r.status })),
    deductees,
    challans,
    totals: { ...totals, deposited: totalDeposited, gap: totals.tds - totalDeposited },
  });
}));

// ════════════════════════════════════════════════════════════
// GET /form16/:employeeId — Form 16 part-B equivalent JSON
// ════════════════════════════════════════════════════════════
router.get('/form16/:employeeId', asyncHandler(async (req: AuthRequest, res: Response) => {
  const fyCode = (req.query.fy as string) || '';
  if (!fyCode) { res.status(400).json({ error: 'fy required (e.g. 2025-26)' }); return; }
  const fyStart = fyStartYearFromCode(fyCode);

  const emp = await prisma.employee.findUnique({
    where: { id: req.params.employeeId },
    include: {
      department: { select: { name: true } },
      designation: { select: { title: true } },
    },
  });
  if (!emp) { res.status(404).json({ error: 'Employee not found' }); return; }

  // All 12 months of FY (April current year → March next year)
  const lines = await prisma.payrollLine.findMany({
    where: {
      employeeId: emp.id,
      payrollRun: { status: { in: ['COMPUTED', 'APPROVED', 'PAID'] } },
      OR: [
        { payrollRun: { year: fyStart, month: { gte: 4 } } },
        { payrollRun: { year: fyStart + 1, month: { lt: 4 } } },
      ],
    },
    include: {
      payrollRun: { select: { month: true, year: true } },
      components: { include: { component: { select: { code: true, name: true, type: true } } } },
    },
    orderBy: [{ payrollRun: { year: 'asc' } }, { payrollRun: { month: 'asc' } }],
  
    take: 500,
  });

  if (lines.length === 0) {
    res.status(404).json({ error: `No payroll records found for ${emp.empCode} in FY ${fyCode}` });
    return;
  }

  // Aggregate
  const totalGross = lines.reduce((s, l) => s + l.grossEarnings, 0);
  const totalEpfEmployee = lines.reduce((s, l) => s + l.epfEmployee, 0);
  const totalEsiEmployee = lines.reduce((s, l) => s + l.esiEmployee, 0);
  const totalPt = lines.reduce((s, l) => s + l.professionalTax, 0);
  const totalTds = lines.reduce((s, l) => s + l.tds, 0);

  // Project final annual tax based on actual gross
  const actualAnnualGross = totalGross;
  const tdsCalc = calculateTdsOnSalary(
    actualAnnualGross,
    (emp.taxRegime === 'OLD' ? 'OLD' : 'NEW'),
    3, // March = last month of FY
    totalTds,
    {
      declared80C: emp.declared80C,
      declared80D: emp.declared80D,
      declaredOther: emp.declaredOther,
      epfEmployeeAnnual: totalEpfEmployee,
    }
  );

  // Monthly breakdown
  const monthly = lines.map(l => ({
    month: l.payrollRun.month,
    year: l.payrollRun.year,
    gross: l.grossEarnings,
    epf: l.epfEmployee,
    esi: l.esiEmployee,
    pt: l.professionalTax,
    tds: l.tds,
    net: l.netPay,
  }));

  res.json({
    fyCode,
    employee: {
      empCode: emp.empCode,
      name: `${emp.firstName} ${emp.lastName}`.trim(),
      pan: emp.pan || 'PANNOTAVBL',
      panMissing: !emp.pan,
      designation: emp.designation?.title,
      department: emp.department?.name,
      dateOfJoining: emp.dateOfJoining,
      dateOfLeaving: emp.dateOfLeaving,
      taxRegime: emp.taxRegime,
    },
    employer: {
      name: 'MAHAKAUSHAL SUGAR & POWER INDUSTRIES LTD',
      address: 'Village Sarai, Narsinghpur, Madhya Pradesh 487001',
      pan: 'AADCM4898F',
      tan: 'BPLM03247E', // TODO: pull from company config
      cin: 'L15421MP2001PLC014641',
    },
    monthly,
    earnings: {
      grossSalary: totalGross,
      // Future: split into Basic+HRA+Other based on components
    },
    deductions: {
      epfEmployee: totalEpfEmployee,
      esiEmployee: totalEsiEmployee,
      professionalTax: totalPt,
      tds: totalTds,
    },
    taxComputation: tdsCalc,
    finalTaxLiability: tdsCalc.annualTax,
    refundOrPayable: totalTds - tdsCalc.annualTax, // +ve = refund, -ve = payable
  });
}));

// ════════════════════════════════════════════════════════════
// GET /challans — list TDS challans
// ════════════════════════════════════════════════════════════
router.get('/challans', asyncHandler(async (req: AuthRequest, res: Response) => {
  const fyCode = req.query.fy as string | undefined;
  const quarter = req.query.quarter ? parseInt(req.query.quarter as string, 10) : undefined;
  const where: any = { ...getCompanyFilter(req) };
  if (fyCode) where.fyCode = fyCode;
  if (quarter) where.quarter = quarter;

  const challans = await prisma.tdsChallan.findMany({
    where,
    orderBy: [{ depositDate: 'desc' }],
    take: 200,
  });

  const totals = challans.reduce((acc, c) => {
    acc.amount += c.amount;
    acc.tax += c.taxAmount;
    acc.interest += c.interest;
    acc.cess += c.cess;
    acc.count += 1;
    return acc;
  }, { amount: 0, tax: 0, interest: 0, cess: 0, count: 0 });

  res.json({ challans, totals });
}));

// ════════════════════════════════════════════════════════════
// POST /challans — record a new ITNS-281 challan
// ════════════════════════════════════════════════════════════
const challanSchema = z.object({
  fyCode: z.string().regex(/^\d{4}-\d{2}$/, 'Invalid FY format (expected: 2026-27)'),
  quarter: z.number().int().min(1).max(4),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020).max(2100),
  section: z.string().default('192'),
  challanNo: z.string().min(1, 'Challan no required'),
  bsrCode: z.string().regex(/^\d{7}$/, 'BSR code must be 7 digits'),
  depositDate: z.string(),
  amount: z.number().positive(),
  taxAmount: z.number().min(0).default(0),
  surcharge: z.number().min(0).default(0),
  cess: z.number().min(0).default(0),
  interest: z.number().min(0).default(0),
  penalty: z.number().min(0).default(0),
  others: z.number().min(0).default(0),
  paymentMode: z.enum(['ONLINE', 'OTC_CHEQUE', 'OTC_CASH']).default('ONLINE'),
  bankName: z.string().optional(),
  remarks: z.string().optional(),
});

router.post('/challans', validate(challanSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const challan = await prisma.tdsChallan.create({
    data: {
      fyCode: b.fyCode,
      quarter: b.quarter,
      month: b.month,
      year: b.year,
      section: b.section,
      challanNo: b.challanNo,
      bsrCode: b.bsrCode,
      depositDate: new Date(b.depositDate),
      amount: b.amount,
      taxAmount: b.taxAmount,
      surcharge: b.surcharge,
      cess: b.cess,
      interest: b.interest,
      penalty: b.penalty,
      others: b.others,
      paymentMode: b.paymentMode,
      bankName: b.bankName || null,
      remarks: b.remarks || null,
      userId: req.user?.id,
      companyId: getActiveCompanyId(req),
    },
  });
  res.status(201).json({ challan });
}));

// ════════════════════════════════════════════════════════════
// PUT /challans/:id — update challan
// ════════════════════════════════════════════════════════════
router.put('/challans/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;
  const data: any = {};
  const stringFields = ['challanNo', 'bsrCode', 'paymentMode', 'bankName', 'remarks', 'section'];
  for (const f of stringFields) if (b[f] !== undefined) data[f] = b[f];
  const numFields = ['amount', 'taxAmount', 'surcharge', 'cess', 'interest', 'penalty', 'others', 'quarter', 'month', 'year'];
  for (const f of numFields) if (b[f] !== undefined) data[f] = Number(b[f]);
  if (b.depositDate !== undefined) data.depositDate = new Date(b.depositDate);
  if (b.fyCode !== undefined) data.fyCode = b.fyCode;

  const challan = await prisma.tdsChallan.update({
    where: { id: req.params.id },
    data,
  });
  res.json({ challan });
}));

// ════════════════════════════════════════════════════════════
// DELETE /challans/:id
// ════════════════════════════════════════════════════════════
router.delete('/challans/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.tdsChallan.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

// ════════════════════════════════════════════════════════════
// POST /challans/:id/file-24q — mark filed in Form 24Q
// ════════════════════════════════════════════════════════════
router.post('/challans/:id/file-24q', asyncHandler(async (req: AuthRequest, res: Response) => {
  const challan = await prisma.tdsChallan.update({
    where: { id: req.params.id },
    data: {
      filedInForm24Q: true,
      filedQuarter: req.body.filedQuarter || undefined,
      filedFy: req.body.filedFy || undefined,
      filedAt: new Date(),
    },
  });
  res.json({ challan });
}));

// ════════════════════════════════════════════════════════════
// GET /summary?fy= — FY-level summary
// ════════════════════════════════════════════════════════════
router.get('/summary', asyncHandler(async (req: AuthRequest, res: Response) => {
  const fyCode = (req.query.fy as string) || '';
  if (!fyCode) { res.status(400).json({ error: 'fy required' }); return; }
  const fyStart = fyStartYearFromCode(fyCode);

  // Sum TDS deducted across all 4 quarters
  const lines = await prisma.payrollLine.findMany({
    where: {
      tds: { gt: 0 },
      payrollRun: {
        status: { in: ['COMPUTED', 'APPROVED', 'PAID'] },
        OR: [
          { year: fyStart, month: { gte: 4 } },
          { year: fyStart + 1, month: { lt: 4 } },
        ],
      },
    },
    select: {
      tds: true,
      payrollRun: { select: { month: true } },
    },
  
    take: 500,
  });

  // Sum challans deposited
  const challans = await prisma.tdsChallan.findMany({
    where: { fyCode, ...getCompanyFilter(req) },
    select: { amount: true, quarter: true, month: true },
  
    take: 500,
  });

  const byQuarter = [1, 2, 3, 4].map(q => {
    const months = monthsInQuarter(q, fyStart).map(m => m.month);
    const deducted = lines.filter(l => months.includes(l.payrollRun.month)).reduce((s, l) => s + l.tds, 0);
    const deposited = challans.filter(c => c.quarter === q).reduce((s, c) => s + c.amount, 0);
    return { quarter: q, deducted, deposited, gap: deducted - deposited };
  });

  const totalDeducted = byQuarter.reduce((s, q) => s + q.deducted, 0);
  const totalDeposited = byQuarter.reduce((s, q) => s + q.deposited, 0);

  res.json({
    fyCode,
    byQuarter,
    totals: { deducted: totalDeducted, deposited: totalDeposited, gap: totalDeducted - totalDeposited },
  });
}));

export default router;
