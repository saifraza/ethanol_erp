import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler, validate } from '../shared/middleware';
import { NotFoundError, ValidationError } from '../shared/errors';
import { z } from 'zod';
import prisma from '../config/prisma';

const router = Router();
router.use(authenticate as any);

// ── Zod Schemas ──

const REPAYMENT_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'BULLET', 'NONE'] as const;

const createLoanSchema = z.object({
  loanNo: z.string().min(1, 'Loan number is required'),
  bankName: z.string().min(1, 'Bank name is required'),
  bankAccountCode: z.string().optional().nullable(),
  loanType: z.enum(['TERM_LOAN', 'WORKING_CAPITAL', 'CC_LIMIT', 'EQUIPMENT']).default('TERM_LOAN'),
  repaymentFrequency: z.enum(REPAYMENT_FREQUENCIES).default('MONTHLY'),
  sanctionAmount: z.number().positive('Sanction amount must be positive'),
  interestRate: z.number().positive('Interest rate must be positive'),
  tenure: z.number().int().positive('Tenure must be a positive integer'),
  sanctionDate: z.string().or(z.date()),
  disbursementDate: z.string().or(z.date()).optional().nullable(),
  maturityDate: z.string().or(z.date()).optional().nullable(),
  securityDetails: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
});

const updateLoanSchema = z.object({
  bankName: z.string().min(1).optional(),
  repaymentFrequency: z.enum(REPAYMENT_FREQUENCIES).optional(),
  securityDetails: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
  status: z.enum(['ACTIVE', 'CLOSED', 'RESTRUCTURED']).optional(),
});

const recordRepaymentSchema = z.object({
  installmentNo: z.number().int().positive('Installment number is required'),
  paymentMode: z.string().optional().nullable(),
  paymentRef: z.string().optional().nullable(),
  paidDate: z.string().or(z.date()).optional().nullable(),
  remarks: z.string().optional().nullable(),
});

// ── Helpers ──

function calculateEMI(principal: number, annualRate: number, tenureMonths: number): number {
  const r = annualRate / 12 / 100;
  if (r === 0) return principal / tenureMonths;
  const factor = Math.pow(1 + r, tenureMonths);
  return (principal * r * factor) / (factor - 1);
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function monthlyEquivalent(emi: number, freq: string): number {
  if (freq === 'QUARTERLY') return emi / 3;
  if (freq === 'HALF_YEARLY') return emi / 6;
  if (freq === 'NONE' || freq === 'BULLET') return 0;
  return emi; // MONTHLY
}

async function resolveAccount(code: string): Promise<{ id: string; name: string }> {
  const account = await prisma.account.findUnique({
    where: { code },
    select: { id: true, name: true },
  });
  if (!account) throw new ValidationError(`Account with code ${code} not found in Chart of Accounts`);
  return account;
}

// ═══════════════════════════════════════════════
// GET / — List loans with repayment summary
// ═══════════════════════════════════════════════
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const take = Math.min(parseInt(req.query.limit as string) || 50, 500);
  const skip = parseInt(req.query.offset as string) || 0;
  const status = req.query.status as string | undefined;

  const where = status ? { status } : {};

  const loans = await prisma.bankLoan.findMany({
    where,
    take,
    skip,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      loanNo: true,
      bankName: true,
      bankAccountCode: true,
      loanType: true,
      sanctionAmount: true,
      disbursedAmount: true,
      outstandingAmount: true,
      interestRate: true,
      tenure: true,
      emiAmount: true,
      repaymentFrequency: true,
      sanctionDate: true,
      disbursementDate: true,
      maturityDate: true,
      status: true,
      securityDetails: true,
      remarks: true,
      createdAt: true,
      repayments: {
        select: {
          id: true,
          installmentNo: true,
          dueDate: true,
          totalAmount: true,
          status: true,
        },
        orderBy: { dueDate: 'asc' },
      },
    },
  });

  const enriched = loans.map((loan) => {
    const paidCount = loan.repayments.filter((r) => r.status === 'PAID').length;
    const totalCount = loan.repayments.length;
    const nextDue = loan.repayments.find((r) => r.status === 'SCHEDULED' || r.status === 'OVERDUE');
    return {
      ...loan,
      repayments: undefined,
      repaymentSummary: {
        paidCount,
        totalCount,
        nextDueDate: nextDue?.dueDate ?? null,
        nextDueAmount: nextDue?.totalAmount ?? null,
      },
    };
  });

  res.json(enriched);
}));

// ═══════════════════════════════════════════════
// GET /summary — Comprehensive dashboard KPIs
// ═══════════════════════════════════════════════
router.get('/summary', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const allLoans = await prisma.bankLoan.findMany({
    select: {
      id: true,
      loanType: true,
      sanctionAmount: true,
      outstandingAmount: true,
      emiAmount: true,
      interestRate: true,
      repaymentFrequency: true,
      securityDetails: true,
      status: true,
      maturityDate: true,
      bankName: true,
      loanNo: true,
    },
    take: 500,
  });

  const active = allLoans.filter((l) => l.status === 'ACTIVE');

  // Headline KPIs
  const totalSanctioned = allLoans.reduce((s, l) => s + l.sanctionAmount, 0);
  const totalOutstanding = active.reduce((s, l) => s + l.outstandingAmount, 0);
  const utilizationPercent = totalSanctioned > 0 ? Math.round((totalOutstanding / totalSanctioned) * 100) : 0;

  // Monthly outflow — normalized
  const monthlyOutflow = active.reduce(
    (s, l) => s + monthlyEquivalent(l.emiAmount, l.repaymentFrequency),
    0,
  );

  // Weighted average interest rate
  const weightedSum = active.reduce((s, l) => s + l.outstandingAmount * l.interestRate, 0);
  const weightedAvgRate = totalOutstanding > 0 ? Math.round((weightedSum / totalOutstanding) * 100) / 100 : 0;

  // Counts
  const activeCount = active.length;
  const closedCount = allLoans.filter((l) => l.status === 'CLOSED').length;
  const totalCount = allLoans.length;

  // Secured vs unsecured
  const isUnsecured = (s: string | null) => !s || s.toUpperCase().includes('UNSECURED');
  const securedOutstanding = active.filter((l) => !isUnsecured(l.securityDetails)).reduce((s, l) => s + l.outstandingAmount, 0);
  const unsecuredOutstanding = active.filter((l) => isUnsecured(l.securityDetails)).reduce((s, l) => s + l.outstandingAmount, 0);

  // Type breakdown for chart
  const typeMap: Record<string, { label: string; count: number; outstanding: number; sanctioned: number; monthlyOutflow: number }> = {};
  for (const l of active) {
    const key = l.loanType;
    if (!typeMap[key]) {
      const labels: Record<string, string> = { TERM_LOAN: 'Term Loan', WORKING_CAPITAL: 'Working Capital', CC_LIMIT: 'CC Limit', EQUIPMENT: 'Vehicle' };
      typeMap[key] = { label: labels[key] || key, count: 0, outstanding: 0, sanctioned: 0, monthlyOutflow: 0 };
    }
    typeMap[key].count++;
    typeMap[key].outstanding += l.outstandingAmount;
    typeMap[key].sanctioned += l.sanctionAmount;
    typeMap[key].monthlyOutflow += monthlyEquivalent(l.emiAmount, l.repaymentFrequency);
  }
  const byType = Object.entries(typeMap).map(([loanType, v]) => ({ loanType, ...v }));

  // Rate band distribution
  const bands = [
    { band: '< 10%', min: 0, max: 10 },
    { band: '10 - 14%', min: 10, max: 14 },
    { band: '> 14%', min: 14, max: 100 },
  ];
  const rateBands = bands.map((b) => {
    const matching = active.filter((l) => l.interestRate >= b.min && l.interestRate < b.max);
    return { band: b.band, count: matching.length, outstanding: matching.reduce((s, l) => s + l.outstandingAmount, 0) };
  });

  // Upcoming 3-month outflow (synthetic — no LoanRepayment rows needed)
  const now = new Date();
  const upcomingOutflows: Array<{ month: string; totalOutflow: number }> = [];
  for (let m = 0; m < 3; m++) {
    const target = new Date(now.getFullYear(), now.getMonth() + m, 1);
    const monthLabel = target.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    let outflow = 0;
    for (const l of active) {
      if (l.repaymentFrequency === 'MONTHLY') {
        outflow += l.emiAmount;
      } else if (l.repaymentFrequency === 'QUARTERLY' && l.maturityDate) {
        // Quarterly: check if this month aligns with disbursement quarter cycle
        // Simplified: assume quarterly means every 3 months from disbursal
        outflow += l.emiAmount / 3; // average per month
      }
      // NONE/BULLET: 0 principal outflow
    }
    upcomingOutflows.push({ month: monthLabel, totalOutflow: Math.round(outflow) });
  }

  // Next payment (from repayment schedule if any, otherwise null)
  const nextRepayment = await prisma.loanRepayment.findFirst({
    where: { status: { in: ['SCHEDULED', 'OVERDUE'] } },
    orderBy: { dueDate: 'asc' },
    select: {
      dueDate: true,
      totalAmount: true,
      loan: { select: { loanNo: true, bankName: true, repaymentFrequency: true } },
    },
  });

  res.json({
    totalSanctioned,
    totalOutstanding,
    utilizationPercent,
    monthlyOutflow,
    weightedAvgRate,
    activeCount,
    closedCount,
    totalCount,
    securedOutstanding,
    unsecuredOutstanding,
    byType,
    rateBands,
    upcomingOutflows,
    nextPayment: nextRepayment
      ? {
          dueDate: nextRepayment.dueDate,
          amount: nextRepayment.totalAmount,
          bankName: nextRepayment.loan.bankName,
          loanNo: nextRepayment.loan.loanNo,
          frequency: nextRepayment.loan.repaymentFrequency,
        }
      : null,
  });
}));

// ═══════════════════════════════════════════════
// GET /:id — Loan detail with full repayment schedule
// ═══════════════════════════════════════════════
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const loan = await prisma.bankLoan.findUnique({
    where: { id: req.params.id },
    include: {
      repayments: {
        orderBy: { installmentNo: 'asc' },
      },
    },
  });
  if (!loan) throw new NotFoundError('BankLoan', req.params.id);
  res.json(loan);
}));

// ═══════════════════════════════════════════════
// GET /:id/schedule — Full EMI schedule
// ═══════════════════════════════════════════════
router.get('/:id/schedule', asyncHandler(async (req: AuthRequest, res: Response) => {
  const loan = await prisma.bankLoan.findUnique({
    where: { id: req.params.id },
    select: { id: true },
  });
  if (!loan) throw new NotFoundError('BankLoan', req.params.id);

  const repayments = await prisma.loanRepayment.findMany({
    where: { loanId: req.params.id },
    orderBy: { installmentNo: 'asc' },
    take: 500,
  });

  res.json(repayments);
}));

// ═══════════════════════════════════════════════
// POST / — Create loan + generate EMI schedule + auto-journal
// ═══════════════════════════════════════════════
router.post('/', validate(createLoanSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = req.body;
  const sanctionDate = new Date(data.sanctionDate);
  const disbursementDate = data.disbursementDate ? new Date(data.disbursementDate) : sanctionDate;
  const maturityDate = data.maturityDate ? new Date(data.maturityDate) : addMonths(disbursementDate, data.tenure);

  const emi = calculateEMI(data.sanctionAmount, data.interestRate, data.tenure);
  const roundedEMI = Math.round(emi * 100) / 100;
  const monthlyRate = data.interestRate / 12 / 100;

  // Build repayment schedule
  const repaymentData: Array<{
    installmentNo: number;
    dueDate: Date;
    principalAmount: number;
    interestAmount: number;
    totalAmount: number;
    outstandingAfter: number;
    status: string;
  }> = [];

  let outstanding = data.sanctionAmount;
  for (let i = 1; i <= data.tenure; i++) {
    const interest = Math.round(outstanding * monthlyRate * 100) / 100;
    const principal = Math.round((roundedEMI - interest) * 100) / 100;
    outstanding = Math.round((outstanding - principal) * 100) / 100;
    // Ensure last installment zeroes out
    if (i === data.tenure) {
      outstanding = 0;
    }

    repaymentData.push({
      installmentNo: i,
      dueDate: addMonths(disbursementDate, i),
      principalAmount: principal,
      interestAmount: interest,
      totalAmount: roundedEMI,
      outstandingAfter: Math.max(outstanding, 0),
      status: 'SCHEDULED',
    });
  }

  // Resolve accounts for journal entry
  const bankAccountCode = data.bankAccountCode || '1002'; // Default SBI
  const loanLiabilityCode = '2400'; // Loans-Bank

  const bankAccount = await resolveAccount(bankAccountCode);
  const loanAccount = await resolveAccount(loanLiabilityCode);

  // Create everything in a transaction
  const loan = await prisma.$transaction(async (tx) => {
    const newLoan = await tx.bankLoan.create({
      data: {
        loanNo: data.loanNo,
        bankName: data.bankName,
        bankAccountCode: data.bankAccountCode ?? null,
        loanType: data.loanType,
        repaymentFrequency: data.repaymentFrequency ?? 'MONTHLY',
        sanctionAmount: data.sanctionAmount,
        disbursedAmount: data.sanctionAmount,
        outstandingAmount: data.sanctionAmount,
        interestRate: data.interestRate,
        tenure: data.tenure,
        emiAmount: roundedEMI,
        sanctionDate,
        disbursementDate,
        maturityDate,
        status: 'ACTIVE',
        securityDetails: data.securityDetails ?? null,
        remarks: data.remarks ?? null,
        userId: req.user!.id,
      },
    });

    // Create repayment schedule
    await tx.loanRepayment.createMany({
      data: repaymentData.map((r) => ({
        ...r,
        loanId: newLoan.id,
        userId: req.user!.id,
      })),
    });

    // Auto-journal: Dr Bank, Cr Loans-Bank
    await tx.journalEntry.create({
      data: {
        date: disbursementDate,
        narration: `Loan disbursement: ${data.loanNo} from ${data.bankName} — ₹${data.sanctionAmount.toLocaleString('en-IN')}`,
        refType: 'LOAN_DISBURSEMENT',
        refId: newLoan.id,
        isAutoGenerated: true,
        userId: req.user!.id,
        lines: {
          create: [
            { accountId: bankAccount.id, debit: data.sanctionAmount, credit: 0 },
            { accountId: loanAccount.id, debit: 0, credit: data.sanctionAmount },
          ],
        },
      },
    });

    return newLoan;
  });

  const full = await prisma.bankLoan.findUnique({
    where: { id: loan.id },
    include: { repayments: { orderBy: { installmentNo: 'asc' } } },
  });

  res.status(201).json(full);
}));

// ═══════════════════════════════════════════════
// POST /:id/repayment — Record EMI payment
// ═══════════════════════════════════════════════
router.post('/:id/repayment', validate(recordRepaymentSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { installmentNo, paymentMode, paymentRef, paidDate, remarks } = req.body;
  const loanId = req.params.id;

  const loan = await prisma.bankLoan.findUnique({
    where: { id: loanId },
    select: { id: true, loanNo: true, bankName: true, bankAccountCode: true, outstandingAmount: true },
  });
  if (!loan) throw new NotFoundError('BankLoan', loanId);

  const repayment = await prisma.loanRepayment.findFirst({
    where: { loanId, installmentNo },
  });
  if (!repayment) throw new NotFoundError('LoanRepayment', `installment ${installmentNo}`);

  if (repayment.status === 'PAID') {
    throw new ValidationError(`Installment ${installmentNo} is already marked as PAID`);
  }

  // Resolve accounts
  const bankAccountCode = loan.bankAccountCode || '1002';
  const loanLiabilityCode = '2400';
  const interestExpenseCode = '4090';

  const bankAccount = await resolveAccount(bankAccountCode);
  const loanAccount = await resolveAccount(loanLiabilityCode);
  const interestAccount = await resolveAccount(interestExpenseCode);

  const paymentDate = paidDate ? new Date(paidDate) : new Date();

  const result = await prisma.$transaction(async (tx) => {
    // Update repayment status
    const updated = await tx.loanRepayment.update({
      where: { id: repayment.id },
      data: {
        status: 'PAID',
        paidDate: paymentDate,
        paymentMode: paymentMode ?? null,
        paymentRef: paymentRef ?? null,
        remarks: remarks ?? null,
        userId: req.user!.id,
      },
    });

    // Update loan outstanding
    const newOutstanding = Math.max(
      Math.round((loan.outstandingAmount - repayment.principalAmount) * 100) / 100,
      0,
    );
    await tx.bankLoan.update({
      where: { id: loanId },
      data: { outstandingAmount: newOutstanding },
    });

    // Auto-journal: Dr Loans-Bank (principal) + Dr Interest Expense (interest), Cr Bank
    const journal = await tx.journalEntry.create({
      data: {
        date: paymentDate,
        narration: `Loan EMI #${installmentNo}: ${loan.loanNo} — Principal ₹${repayment.principalAmount.toLocaleString('en-IN')}, Interest ₹${repayment.interestAmount.toLocaleString('en-IN')}`,
        refType: 'LOAN_REPAYMENT',
        refId: repayment.id,
        isAutoGenerated: true,
        userId: req.user!.id,
        lines: {
          create: [
            { accountId: loanAccount.id, debit: repayment.principalAmount, credit: 0 },
            { accountId: interestAccount.id, debit: repayment.interestAmount, credit: 0 },
            { accountId: bankAccount.id, debit: 0, credit: repayment.totalAmount },
          ],
        },
      },
    });

    // Link journal to repayment
    await tx.loanRepayment.update({
      where: { id: repayment.id },
      data: { journalEntryId: journal.id },
    });

    return updated;
  });

  res.json(result);
}));

// ═══════════════════════════════════════════════
// PUT /:id — Update non-financial loan details
// ═══════════════════════════════════════════════
router.put('/:id', validate(updateLoanSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const loan = await prisma.bankLoan.findUnique({
    where: { id: req.params.id },
    select: { id: true },
  });
  if (!loan) throw new NotFoundError('BankLoan', req.params.id);

  const updated = await prisma.bankLoan.update({
    where: { id: req.params.id },
    data: req.body,
  });

  res.json(updated);
}));

export default router;
