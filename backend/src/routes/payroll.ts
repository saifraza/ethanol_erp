import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, authorize, getCompanyFilter, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';
import { computeEmployeePayroll, generateEcrFileContent, EcrRow } from '../services/payrollCalculator';

const router = Router();
router.use(authenticate as any);

// GET / — list payroll runs
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const runs = await prisma.payrollRun.findMany({
    where: { ...getCompanyFilter(req) },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    take: 50,
  });
  res.json({ runs });
}));

// GET /:id — single run with lines
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const run = await prisma.payrollRun.findUnique({
    where: { id: req.params.id },
    include: {
      lines: {
        include: {
          employee: { select: { id: true, empCode: true, firstName: true, lastName: true, uan: true, bankAccount: true, bankIfsc: true, department: { select: { name: true } }, designation: { select: { title: true } } } },
          components: { include: { component: { select: { code: true, name: true, type: true } } }, orderBy: { component: { sortOrder: 'asc' } } },
        },
        orderBy: { employee: { empNo: 'asc' } },
      },
    },
  });
  if (!run) { res.status(404).json({ error: 'Payroll run not found' }); return; }
  res.json({ run });
}));

// POST / — create payroll run
router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { month, year } = req.body;
  if (!month || !year) { res.status(400).json({ error: 'Month and year required' }); return; }

  const existing = await prisma.payrollRun.findUnique({ where: { month_year: { month: parseInt(month), year: parseInt(year) } } });
  if (existing) { res.status(400).json({ error: `Payroll for ${month}/${year} already exists (Run #${existing.runNo})` }); return; }

  const run = await prisma.payrollRun.create({
    data: { month: parseInt(month), year: parseInt(year), userId: req.user?.id, companyId: getActiveCompanyId(req) },
  });
  res.status(201).json({ run });
}));

// POST /:id/compute — calculate all employee salaries
router.post('/:id/compute', asyncHandler(async (req: AuthRequest, res: Response) => {
  const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
  if (!run) { res.status(404).json({ error: 'Not found' }); return; }
  if (run.status !== 'DRAFT' && run.status !== 'COMPUTED') {
    res.status(400).json({ error: `Cannot compute payroll in ${run.status} status` }); return;
  }

  // Get all active employees with salary components
  const employees = await prisma.employee.findMany({
    where: { isActive: true, status: 'ACTIVE', ctcAnnual: { gt: 0 } },
    include: {
      salaryComponents: { include: { component: true } },
    },
  });

  // Get all salary component definitions for mapping
  const allComponents = await prisma.salaryComponent.findMany({ where: { isActive: true } });
  const componentMap = new Map(allComponents.map(c => [c.code, c]));

  // Delete existing lines for recompute
  await prisma.payrollLineComponent.deleteMany({ where: { payrollLine: { payrollRunId: run.id } } });
  await prisma.payrollLine.deleteMany({ where: { payrollRunId: run.id } });

  // Get YTD TDS for each employee (sum of TDS from previous months in same FY)
  const fyStart = run.month >= 4 ? run.year : run.year - 1; // FY starts April
  const ytdRuns = await prisma.payrollRun.findMany({
    where: {
      status: { in: ['COMPUTED', 'APPROVED', 'PAID'] },
      NOT: { id: run.id },
      OR: [
        { year: fyStart, month: { gte: 4 } },
        { year: fyStart + 1, month: { lt: 4 } },
      ],
    },
    select: { id: true },
  });
  const ytdRunIds = ytdRuns.map(r => r.id);

  const ytdTdsMap: Record<string, number> = {};
  if (ytdRunIds.length > 0) {
    const ytdLines = await prisma.payrollLine.findMany({
      where: { payrollRunId: { in: ytdRunIds } },
      select: { employeeId: true, tds: true },
    });
    for (const l of ytdLines) {
      ytdTdsMap[l.employeeId] = (ytdTdsMap[l.employeeId] || 0) + l.tds;
    }
  }

  let totalGross = 0, totalDeductions = 0, totalNet = 0;
  let totalEpfEe = 0, totalEpfEr = 0, totalEsiEe = 0, totalEsiEr = 0, totalPt = 0, totalTds = 0;
  let processedCount = 0;

  for (const emp of employees) {
    // Build earning components for the calculator
    const earningComponents = emp.salaryComponents
      .filter(sc => sc.component.type === 'EARNING')
      .map(sc => ({ code: sc.component.code, monthlyAmount: sc.monthlyAmount, isPfWage: sc.component.isPfWage }));

    if (earningComponents.length === 0) continue;

    const result = computeEmployeePayroll(
      {
        basicMonthly: emp.basicMonthly,
        ctcAnnual: emp.ctcAnnual,
        epfApplicable: emp.epfApplicable,
        epfOnActualBasic: emp.epfOnActualBasic,
        esiApplicable: emp.esiApplicable,
        ptApplicable: emp.ptApplicable,
        taxRegime: emp.taxRegime,
        isInternationalWorker: emp.isInternationalWorker,
        higherPensionOpt: emp.higherPensionOpt,
        declared80C: emp.declared80C,
        declared80D: emp.declared80D,
        declaredOther: emp.declaredOther,
      },
      earningComponents,
      run.month,
      ytdTdsMap[emp.id] || 0
    );

    // Cash vs Bank split — snapshot from Employee.cashPayPercent at compute time
    const cashPct = Math.max(0, Math.min(100, emp.cashPayPercent || 0));
    const cashAmount = Math.round(result.netPay * cashPct / 100);
    const bankAmount = Math.round(result.netPay - cashAmount);

    // Create payroll line
    const line = await prisma.payrollLine.create({
      data: {
        payrollRunId: run.id,
        employeeId: emp.id,
        grossEarnings: result.grossEarnings,
        totalDeductions: result.totalDeductions,
        netPay: result.netPay,
        cashAmount,
        bankAmount,
        pfWages: result.pfWages,
        epfEmployee: result.epf.epfEmployee,
        epfEmployerEpf: result.epf.epfEmployerEpf,
        epfEmployerEps: result.epf.epfEmployerEps,
        edliEmployer: result.epf.edli,
        epfAdminCharge: result.epf.adminCharge,
        esiEmployee: result.esi.esiEmployee,
        esiEmployer: result.esi.esiEmployer,
        professionalTax: result.professionalTax,
        tds: result.tds.monthlyTds,
        grossWages: result.grossWages,
        epfWages: result.epfWages,
        epsWages: result.epsWages,
        edliWages: result.edliWages,
      },
    });

    // Create component-level detail
    const lineComponents: { payrollLineId: string; componentId: string; amount: number }[] = [];

    // Earnings
    for (const earning of result.earnings) {
      const comp = componentMap.get(earning.code);
      if (comp) lineComponents.push({ payrollLineId: line.id, componentId: comp.id, amount: earning.amount });
    }
    // Deductions
    const deductionEntries = [
      { code: 'EPF_EE', amount: result.epf.epfEmployee },
      { code: 'ESI_EE', amount: result.esi.esiEmployee },
      { code: 'PT', amount: result.professionalTax },
      { code: 'TDS', amount: result.tds.monthlyTds },
    ];
    for (const d of deductionEntries) {
      const comp = componentMap.get(d.code);
      if (comp && d.amount > 0) lineComponents.push({ payrollLineId: line.id, componentId: comp.id, amount: d.amount });
    }
    // Employer contributions
    const employerEntries = [
      { code: 'EPF_ER_EPF', amount: result.epf.epfEmployerEpf },
      { code: 'EPF_ER_EPS', amount: result.epf.epfEmployerEps },
      { code: 'EDLI', amount: result.epf.edli },
      { code: 'EPF_ADMIN', amount: result.epf.adminCharge },
      { code: 'ESI_ER', amount: result.esi.esiEmployer },
    ];
    for (const e of employerEntries) {
      const comp = componentMap.get(e.code);
      if (comp && e.amount > 0) lineComponents.push({ payrollLineId: line.id, componentId: comp.id, amount: e.amount });
    }

    if (lineComponents.length > 0) {
      await prisma.payrollLineComponent.createMany({ data: lineComponents });
    }

    totalGross += result.grossEarnings;
    totalDeductions += result.totalDeductions;
    totalNet += result.netPay;
    totalEpfEe += result.epf.epfEmployee;
    totalEpfEr += result.epf.epfEmployerEpf + result.epf.epfEmployerEps + result.epf.edli + result.epf.adminCharge;
    totalEsiEe += result.esi.esiEmployee;
    totalEsiEr += result.esi.esiEmployer;
    totalPt += result.professionalTax;
    totalTds += result.tds.monthlyTds;
    processedCount++;
  }

  // Update run totals
  const updated = await prisma.payrollRun.update({
    where: { id: run.id },
    data: {
      status: 'COMPUTED',
      totalGross, totalDeductions, totalNet,
      totalEpfEmployee: totalEpfEe, totalEpfEmployer: totalEpfEr,
      totalEsiEmployee: totalEsiEe, totalEsiEmployer: totalEsiEr,
      totalPt, totalTds,
      employeeCount: processedCount,
    },
  });

  res.json({ run: updated, employeesProcessed: processedCount });
}));

// PUT /:id/approve
router.put('/:id/approve', authorize('ADMIN', 'SUPER_ADMIN') as any, asyncHandler(async (req: AuthRequest, res: Response) => {
  const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
  if (!run) { res.status(404).json({ error: 'Not found' }); return; }
  if (run.status !== 'COMPUTED') { res.status(400).json({ error: 'Only COMPUTED payroll can be approved' }); return; }

  const updated = await prisma.payrollRun.update({
    where: { id: req.params.id },
    data: { status: 'APPROVED', approvedBy: req.user?.name || req.user?.id, approvedAt: new Date() },
  });
  res.json({ run: updated });
}));

// PUT /:id/mark-paid
router.put('/:id/mark-paid', authorize('ADMIN', 'SUPER_ADMIN') as any, asyncHandler(async (req: AuthRequest, res: Response) => {
  const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
  if (!run) { res.status(404).json({ error: 'Not found' }); return; }
  if (run.status !== 'APPROVED') { res.status(400).json({ error: 'Only APPROVED payroll can be marked paid' }); return; }

  const updated = await prisma.payrollRun.update({
    where: { id: req.params.id },
    data: { status: 'PAID', paidDate: new Date() },
  });

  // Update all lines to PAID
  await prisma.payrollLine.updateMany({
    where: { payrollRunId: req.params.id },
    data: { status: 'PAID' },
  });

  res.json({ run: updated });
}));

// GET /:id/ecr — download ECR text file
router.get('/:id/ecr', asyncHandler(async (req: AuthRequest, res: Response) => {
  const lines = await prisma.payrollLine.findMany({
    where: { payrollRunId: req.params.id },
    include: { employee: { select: { uan: true, firstName: true, lastName: true } } },
  });

  const rows: EcrRow[] = lines
    .filter(l => l.epfEmployee > 0) // only EPF-applicable employees
    .map(l => ({
      uan: l.employee.uan || '',
      name: `${l.employee.firstName} ${l.employee.lastName}`.trim(),
      grossWages: l.grossWages,
      epfWages: l.epfWages,
      epsWages: l.epsWages,
      edliWages: l.edliWages,
      epfEmployee: l.epfEmployee,
      epsEmployer: l.epfEmployerEps,
      epfEmployerDiff: l.epfEmployerEpf,
      ncpDays: l.ncpDays,
      refundOfAdvances: 0,
    }));

  const content = generateEcrFileContent(rows);
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename=ECR_${req.params.id}.txt`);
  res.send(content);
}));

// GET /:id/register — salary register
router.get('/:id/register', asyncHandler(async (req: AuthRequest, res: Response) => {
  const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
  if (!run) { res.status(404).json({ error: 'Not found' }); return; }

  const lines = await prisma.payrollLine.findMany({
    where: { payrollRunId: req.params.id },
    include: {
      employee: {
        select: {
          empCode: true, firstName: true, lastName: true, uan: true, pan: true,
          bankAccount: true, bankIfsc: true, bankName: true,
          department: { select: { name: true } },
          designation: { select: { title: true } },
        },
      },
      components: { include: { component: { select: { code: true, name: true, type: true } } } },
    },
    orderBy: { employee: { empNo: 'asc' } },
  });

  res.json({ run, lines });
}));

// GET /:id/pf-register — PF contribution register
router.get('/:id/pf-register', asyncHandler(async (req: AuthRequest, res: Response) => {
  const lines = await prisma.payrollLine.findMany({
    where: { payrollRunId: req.params.id, epfEmployee: { gt: 0 } },
    include: {
      employee: { select: { empCode: true, firstName: true, lastName: true, uan: true, pfMemberNo: true } },
    },
    orderBy: { employee: { empNo: 'asc' } },
  });

  const totals = {
    pfWages: 0, epfEmployee: 0, epfEmployerEpf: 0, epfEmployerEps: 0,
    edli: 0, adminCharge: 0, totalEmployer: 0,
  };
  for (const l of lines) {
    totals.pfWages += l.pfWages;
    totals.epfEmployee += l.epfEmployee;
    totals.epfEmployerEpf += l.epfEmployerEpf;
    totals.epfEmployerEps += l.epfEmployerEps;
    totals.edli += l.edliEmployer;
    totals.adminCharge += l.epfAdminCharge;
    totals.totalEmployer += l.epfEmployerEpf + l.epfEmployerEps + l.edliEmployer + l.epfAdminCharge;
  }

  res.json({ lines, totals, employeeCount: lines.length });
}));

// GET /:id/esi-register — ESI contribution register
router.get('/:id/esi-register', asyncHandler(async (req: AuthRequest, res: Response) => {
  const lines = await prisma.payrollLine.findMany({
    where: { payrollRunId: req.params.id, esiEmployee: { gt: 0 } },
    include: {
      employee: { select: { empCode: true, firstName: true, lastName: true, esicNo: true } },
    },
    orderBy: { employee: { empNo: 'asc' } },
  });

  const totals = { grossWages: 0, esiEmployee: 0, esiEmployer: 0 };
  for (const l of lines) {
    totals.grossWages += l.grossEarnings;
    totals.esiEmployee += l.esiEmployee;
    totals.esiEmployer += l.esiEmployer;
  }

  res.json({ lines, totals, employeeCount: lines.length });
}));

// ═══════════════════════════════════════════════════════════
// POST /pay-today/plan — given a budget, suggest who to pay
// Body: { budget: number, payMode: 'CASH' | 'BANK' | 'BOTH', division?: string, runId?: string,
//         strategy?: 'OLDEST_FIRST' | 'SMALLEST_FIRST' | 'LARGEST_FIRST' | 'BY_DIVISION' }
// ═══════════════════════════════════════════════════════════
router.post('/pay-today/plan', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { budget, payMode = 'BOTH', division, runId, strategy = 'OLDEST_FIRST' } = req.body;
  const budgetNum = Number(budget);
  if (!budgetNum || budgetNum <= 0) { res.status(400).json({ error: 'budget required and must be > 0' }); return; }

  // Load most recent COMPUTED/APPROVED payroll run, or specific runId
  const run = runId
    ? await prisma.payrollRun.findUnique({ where: { id: runId } })
    : await prisma.payrollRun.findFirst({
        where: { status: { in: ['COMPUTED', 'APPROVED'] } },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      });
  if (!run) { res.status(404).json({ error: 'No computed payroll run found. Compute a payroll run first.' }); return; }

  // Pull all unpaid (or partially paid) lines for that run
  const where: any = { payrollRunId: run.id, paidStatus: { not: 'FULLY_PAID' } };
  const lines = await prisma.payrollLine.findMany({
    where,
    include: { employee: { select: { id: true, empCode: true, firstName: true, lastName: true, division: true, workLocation: true, bankAccount: true, bankIfsc: true, department: { select: { name: true } } } } },
    take: 1000,
  });

  // Optional division filter
  let filtered = division ? lines.filter(l => l.employee.division === division) : lines;

  // Compute remaining due per line based on payMode
  const enriched = filtered.map(l => {
    const cashRemaining = (l.paidStatus === 'CASH_PAID' || l.paidStatus === 'FULLY_PAID') ? 0 : l.cashAmount;
    const bankRemaining = (l.paidStatus === 'BANK_PAID' || l.paidStatus === 'FULLY_PAID') ? 0 : l.bankAmount;
    const due = payMode === 'CASH' ? cashRemaining : payMode === 'BANK' ? bankRemaining : (cashRemaining + bankRemaining);
    return {
      payrollLineId: l.id,
      employeeId: l.employeeId,
      empCode: l.employee.empCode,
      name: `${l.employee.firstName} ${l.employee.lastName}`.trim(),
      division: l.employee.division,
      department: l.employee.department?.name || null,
      hasBank: !!(l.employee.bankAccount && l.employee.bankIfsc),
      netPay: l.netPay,
      cashAmount: l.cashAmount,
      bankAmount: l.bankAmount,
      cashRemaining,
      bankRemaining,
      due,
      paidStatus: l.paidStatus,
    };
  }).filter(e => e.due > 0);

  // Sort
  if (strategy === 'SMALLEST_FIRST') enriched.sort((a, b) => a.due - b.due);
  else if (strategy === 'LARGEST_FIRST') enriched.sort((a, b) => b.due - a.due);
  else if (strategy === 'BY_DIVISION') enriched.sort((a, b) => (a.division || '').localeCompare(b.division || '') || a.due - b.due);
  else enriched.sort((a, b) => a.empCode.localeCompare(b.empCode));

  // Greedy fit
  let remaining = budgetNum;
  const canFullyPay: typeof enriched = [];
  const wouldNeedMore: typeof enriched = [];
  let totalUsed = 0;
  for (const e of enriched) {
    if (e.due <= remaining) {
      canFullyPay.push(e);
      remaining -= e.due;
      totalUsed += e.due;
    } else {
      wouldNeedMore.push(e);
    }
  }

  // By-division summary for the affordable set
  const byDivision: Record<string, { division: string; count: number; cash: number; bank: number; total: number }> = {};
  for (const e of canFullyPay) {
    const d = e.division || 'COMMON';
    if (!byDivision[d]) byDivision[d] = { division: d, count: 0, cash: 0, bank: 0, total: 0 };
    byDivision[d].count++;
    byDivision[d].cash += (payMode === 'BANK' ? 0 : e.cashRemaining);
    byDivision[d].bank += (payMode === 'CASH' ? 0 : e.bankRemaining);
    byDivision[d].total += e.due;
  }

  res.json({
    runId: run.id,
    runMonth: run.month,
    runYear: run.year,
    budget: budgetNum,
    payMode,
    strategy,
    division: division || null,
    canFullyPay,
    wouldNeedMore: wouldNeedMore.slice(0, 50),
    summary: {
      employeesPayable: canFullyPay.length,
      totalEmployees: enriched.length,
      totalUsed,
      leftOver: remaining,
      shortfall: wouldNeedMore.length > 0 ? wouldNeedMore[0].due - remaining : 0,
      cashNeeded: canFullyPay.reduce((s, e) => s + (payMode === 'BANK' ? 0 : e.cashRemaining), 0),
      bankNeeded: canFullyPay.reduce((s, e) => s + (payMode === 'CASH' ? 0 : e.bankRemaining), 0),
    },
    byDivision: Object.values(byDivision),
  });
}));

// POST /pay-today/execute — mark selected lines as paid
// Body: { payrollLineIds: string[], payMode: 'CASH' | 'BANK' | 'BOTH', paidDate?: string, reference?: string }
router.post('/pay-today/execute', authorize('ADMIN', 'SUPER_ADMIN') as any, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { payrollLineIds, payMode, paidDate, reference } = req.body;
  if (!Array.isArray(payrollLineIds) || payrollLineIds.length === 0) { res.status(400).json({ error: 'payrollLineIds required' }); return; }
  if (!['CASH', 'BANK', 'BOTH'].includes(payMode)) { res.status(400).json({ error: 'invalid payMode' }); return; }
  const when = paidDate ? new Date(paidDate) : new Date();

  const lines = await prisma.payrollLine.findMany({ where: { id: { in: payrollLineIds } } });
  let updated = 0;
  for (const l of lines) {
    let nextStatus = l.paidStatus;
    const data: any = {};
    if (payMode === 'CASH' || payMode === 'BOTH') { data.cashPaidAt = when; }
    if (payMode === 'BANK' || payMode === 'BOTH') { data.bankPaidAt = when; }

    const cashDone = (l.paidStatus === 'CASH_PAID' || l.paidStatus === 'FULLY_PAID') || payMode === 'CASH' || payMode === 'BOTH';
    const bankDone = (l.paidStatus === 'BANK_PAID' || l.paidStatus === 'FULLY_PAID') || payMode === 'BANK' || payMode === 'BOTH';
    const cashSkippable = l.cashAmount === 0;
    const bankSkippable = l.bankAmount === 0;
    if ((cashDone || cashSkippable) && (bankDone || bankSkippable)) nextStatus = 'FULLY_PAID';
    else if (cashDone || cashSkippable) nextStatus = 'BANK_PAID' === l.paidStatus ? 'FULLY_PAID' : 'CASH_PAID';
    else if (bankDone || bankSkippable) nextStatus = 'CASH_PAID' === l.paidStatus ? 'FULLY_PAID' : 'BANK_PAID';
    data.paidStatus = nextStatus;
    if (reference) data.remarks = `${l.remarks || ''} | ${payMode} ref: ${reference}`.slice(0, 500);

    await prisma.payrollLine.update({ where: { id: l.id }, data });
    updated++;
  }
  res.json({ updated, payMode, paidDate: when });
}));

export default router;
