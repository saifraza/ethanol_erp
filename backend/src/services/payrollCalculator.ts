/**
 * Payroll Calculator Service
 * Handles all statutory deduction calculations:
 * - EPF (Employee Provident Fund) with EPS/EDLI breakdown
 * - ESI (Employee State Insurance)
 * - Professional Tax (Madhya Pradesh slabs)
 * - TDS on Salary (New + Old regime)
 * - CTC breakdown into salary components
 * - ECR file generation for EPFO
 */

// ── EPF Constants ──
const EPF_EMPLOYEE_RATE = 0.12;
const EPF_EMPLOYER_RATE = 0.12; // total employer (3.67% EPF + 8.33% EPS)
const EPS_RATE = 0.0833;
const EPF_ER_RATE = 0.0367; // employer to EPF account (12% - 8.33%)
const EDLI_RATE = 0.005;
const EPF_ADMIN_RATE = 0.005;
const EPS_WAGE_CEILING = 15000;
const EPF_ADMIN_MIN_MONTHLY = 500; // per establishment, not per employee

// ── ESI Constants ──
const ESI_EMPLOYEE_RATE = 0.0075;
const ESI_EMPLOYER_RATE = 0.0325;
const ESI_WAGE_CEILING = 21000;

// ── Gratuity ──
const GRATUITY_RATE = 15 / 26 / 12; // ~4.81% of basic monthly

// ── TDS New Regime FY 2025-26 ──
const NEW_REGIME_STANDARD_DEDUCTION = 75000;
const NEW_REGIME_SLABS = [
  { from: 0, to: 400000, rate: 0 },
  { from: 400000, to: 800000, rate: 0.05 },
  { from: 800000, to: 1200000, rate: 0.10 },
  { from: 1200000, to: 1600000, rate: 0.15 },
  { from: 1600000, to: 2000000, rate: 0.20 },
  { from: 2000000, to: 2400000, rate: 0.25 },
  { from: 2400000, to: Infinity, rate: 0.30 },
];
const NEW_REGIME_REBATE_LIMIT = 1200000; // 87A rebate if taxable <= 12L
const NEW_REGIME_REBATE_MAX = 60000;

// ── TDS Old Regime FY 2025-26 ──
const OLD_REGIME_STANDARD_DEDUCTION = 50000;
const OLD_REGIME_SLABS = [
  { from: 0, to: 250000, rate: 0 },
  { from: 250000, to: 500000, rate: 0.05 },
  { from: 500000, to: 1000000, rate: 0.20 },
  { from: 1000000, to: Infinity, rate: 0.30 },
];
const OLD_REGIME_REBATE_LIMIT = 500000;
const OLD_REGIME_REBATE_MAX = 12500;
const SECTION_80C_MAX = 150000;

const CESS_RATE = 0.04; // 4% Health & Education Cess

// ── Professional Tax MP Slabs ──
interface PtSlab {
  annualFrom: number;
  annualTo: number;
  monthly: number;
  marchMonthly: number; // March adjustment to hit exact annual
}
const MP_PT_SLABS: PtSlab[] = [
  { annualFrom: 0, annualTo: 225000, monthly: 0, marchMonthly: 0 },
  { annualFrom: 225001, annualTo: 300000, monthly: 125, marchMonthly: 125 },
  { annualFrom: 300001, annualTo: 400000, monthly: 166, marchMonthly: 174 }, // 166*11 + 174 = 2000
  { annualFrom: 400001, annualTo: Infinity, monthly: 208, marchMonthly: 212 }, // 208*11 + 212 = 2500
];

// ═══════════════════════════════════════════════════════════
// EPF Calculation
// ═══════════════════════════════════════════════════════════
export interface EpfResult {
  pfWages: number;
  epfEmployee: number;
  epfEmployerEpf: number; // to EPF account (3.67%)
  epfEmployerEps: number; // to pension (8.33% capped)
  edli: number;
  adminCharge: number;
  totalEmployerCost: number;
}

export function calculateEpf(
  pfWages: number, // Basic + DA
  opts: {
    isInternationalWorker?: boolean;
    higherPensionOpt?: boolean;
    epfOnActualBasic?: boolean;
  } = {}
): EpfResult {
  if (pfWages <= 0) {
    return { pfWages: 0, epfEmployee: 0, epfEmployerEpf: 0, epfEmployerEps: 0, edli: 0, adminCharge: 0, totalEmployerCost: 0 };
  }

  // International workers: no EPS contribution (all goes to EPF), no wage ceiling
  // Higher pension opt: EPS on actual wages instead of capped at 15K
  const epsWages = opts.isInternationalWorker ? 0 : (opts.higherPensionOpt ? pfWages : Math.min(pfWages, EPS_WAGE_CEILING));
  const edliWages = Math.min(pfWages, EPS_WAGE_CEILING);

  const epfEmployee = Math.round(pfWages * EPF_EMPLOYEE_RATE);
  const epfEmployerEps = Math.round(epsWages * EPS_RATE);
  const epfEmployerEpf = Math.max(0, Math.round(pfWages * EPF_EMPLOYER_RATE) - epfEmployerEps);
  const edli = Math.round(edliWages * EDLI_RATE);
  const adminCharge = Math.round(pfWages * EPF_ADMIN_RATE); // admin on PF wages, not capped

  return {
    pfWages,
    epfEmployee,
    epfEmployerEpf,
    epfEmployerEps,
    edli,
    adminCharge,
    totalEmployerCost: epfEmployerEpf + epfEmployerEps + edli + adminCharge,
  };
}

// ═══════════════════════════════════════════════════════════
// ESI Calculation
// ═══════════════════════════════════════════════════════════
export interface EsiResult {
  applicable: boolean;
  esiEmployee: number;
  esiEmployer: number;
}

export function calculateEsi(grossWages: number): EsiResult {
  if (grossWages > ESI_WAGE_CEILING) {
    return { applicable: false, esiEmployee: 0, esiEmployer: 0 };
  }
  return {
    applicable: true,
    esiEmployee: Math.round(grossWages * ESI_EMPLOYEE_RATE),
    esiEmployer: Math.round(grossWages * ESI_EMPLOYER_RATE),
  };
}

// ═══════════════════════════════════════════════════════════
// Professional Tax (Madhya Pradesh)
// ═══════════════════════════════════════════════════════════
export function calculateProfessionalTax(annualGross: number, month: number): number {
  // month: 1=Jan ... 12=Dec; March = 3
  const slab = MP_PT_SLABS.find(s => annualGross >= s.annualFrom && annualGross <= s.annualTo);
  if (!slab) return 0;
  return month === 3 ? slab.marchMonthly : slab.monthly;
}

// ═══════════════════════════════════════════════════════════
// TDS on Salary
// ═══════════════════════════════════════════════════════════
function calculateSlabTax(taxableIncome: number, slabs: typeof NEW_REGIME_SLABS): number {
  let tax = 0;
  for (const slab of slabs) {
    if (taxableIncome <= slab.from) break;
    const taxableInSlab = Math.min(taxableIncome, slab.to) - slab.from;
    tax += taxableInSlab * slab.rate;
  }
  return tax;
}

export interface TdsResult {
  regime: 'NEW' | 'OLD';
  annualGross: number;
  standardDeduction: number;
  section80C: number;
  section80D: number;
  otherDeductions: number;
  taxableIncome: number;
  taxBeforeRebate: number;
  rebate87A: number;
  taxAfterRebate: number;
  cess: number;
  annualTax: number;
  monthlyTds: number;
}

export function calculateTdsOnSalary(
  annualGross: number,
  regime: 'NEW' | 'OLD',
  month: number, // 1-12 (April=4 is first month of FY)
  ytdTds: number = 0,
  declarations: {
    declared80C?: number;
    declared80D?: number;
    declaredOther?: number;
    epfEmployeeAnnual?: number; // auto-included in 80C
  } = {}
): TdsResult {
  let standardDeduction: number;
  let section80C = 0;
  let section80D = 0;
  let otherDeductions = 0;
  let slabs: typeof NEW_REGIME_SLABS;
  let rebateLimit: number;
  let rebateMax: number;

  if (regime === 'NEW') {
    standardDeduction = NEW_REGIME_STANDARD_DEDUCTION;
    slabs = NEW_REGIME_SLABS;
    rebateLimit = NEW_REGIME_REBATE_LIMIT;
    rebateMax = NEW_REGIME_REBATE_MAX;
    // New regime: no 80C/80D deductions (only standard deduction + employer NPS)
  } else {
    standardDeduction = OLD_REGIME_STANDARD_DEDUCTION;
    slabs = OLD_REGIME_SLABS;
    rebateLimit = OLD_REGIME_REBATE_LIMIT;
    rebateMax = OLD_REGIME_REBATE_MAX;
    // 80C: EPF employee contribution + other declared investments
    const totalDeclared80C = (declarations.epfEmployeeAnnual || 0) + (declarations.declared80C || 0);
    section80C = Math.min(totalDeclared80C, SECTION_80C_MAX);
    section80D = declarations.declared80D || 0;
    otherDeductions = declarations.declaredOther || 0;
  }

  const taxableIncome = Math.max(0, annualGross - standardDeduction - section80C - section80D - otherDeductions);
  const taxBeforeRebate = calculateSlabTax(taxableIncome, slabs);

  let rebate87A = 0;
  if (taxableIncome <= rebateLimit) {
    rebate87A = Math.min(taxBeforeRebate, rebateMax);
  }

  const taxAfterRebate = Math.max(0, taxBeforeRebate - rebate87A);
  const cess = Math.round(taxAfterRebate * CESS_RATE);
  const annualTax = taxAfterRebate + cess;

  // Calculate remaining months in FY (April=4 to March=3)
  // month is calendar month: April=4, May=5, ..., March=3
  const fyMonthIndex = month >= 4 ? month - 4 : month + 8; // 0=Apr, 1=May, ..., 11=Mar
  const remainingMonths = Math.max(1, 12 - fyMonthIndex);
  const monthlyTds = Math.max(0, Math.round((annualTax - ytdTds) / remainingMonths));

  return {
    regime,
    annualGross,
    standardDeduction,
    section80C,
    section80D,
    otherDeductions,
    taxableIncome,
    taxBeforeRebate,
    rebate87A,
    taxAfterRebate,
    cess,
    annualTax,
    monthlyTds,
  };
}

// ═══════════════════════════════════════════════════════════
// CTC Breakdown Calculator
// ═══════════════════════════════════════════════════════════
export interface CtcBreakdown {
  ctcAnnual: number;
  basicMonthly: number;
  basicAnnual: number;
  hraMonthly: number;
  hraAnnual: number;
  daMonthly: number;
  daAnnual: number;
  specialMonthly: number;
  specialAnnual: number;
  grossMonthly: number;
  grossAnnual: number;
  // Employer contributions
  epfEmployerMonthly: number;
  esiEmployerMonthly: number;
  gratuityMonthly: number;
  edliMonthly: number;
  epfAdminMonthly: number;
  totalEmployerMonthly: number;
  // Employee deductions
  epfEmployeeMonthly: number;
  esiEmployeeMonthly: number;
  ptMonthly: number;
  totalDeductionsMonthly: number;
  netMonthly: number;
}

export function calculateCtcBreakdown(
  ctcAnnual: number,
  opts: {
    epfApplicable?: boolean;
    esiApplicable?: boolean;
    epfOnActualBasic?: boolean;
    ptApplicable?: boolean;
  } = {}
): CtcBreakdown {
  const { epfApplicable = true, esiApplicable = true, epfOnActualBasic = false, ptApplicable = true } = opts;

  // Iterative: employer costs depend on basic, which depends on gross, which depends on employer costs
  let basicMonthly = Math.round((ctcAnnual * 0.5) / 12);
  let grossMonthly = 0;

  for (let i = 0; i < 5; i++) {
    const pfWages = basicMonthly; // DA=0 by default
    const epfEmployer = epfApplicable ? Math.round(pfWages * EPF_EMPLOYER_RATE) : 0;
    const edli = epfApplicable ? Math.round(Math.min(pfWages, EPS_WAGE_CEILING) * EDLI_RATE) : 0;
    const epfAdmin = epfApplicable ? Math.round(Math.min(pfWages, EPS_WAGE_CEILING) * EPF_ADMIN_RATE) : 0;
    const gratuity = Math.round(basicMonthly * GRATUITY_RATE);

    grossMonthly = Math.round(ctcAnnual / 12) - epfEmployer - edli - epfAdmin - gratuity;

    // Check ESI applicability based on gross
    const esiEmployer = (esiApplicable && grossMonthly <= ESI_WAGE_CEILING) ? Math.round(grossMonthly * ESI_EMPLOYER_RATE) : 0;
    grossMonthly = Math.round(ctcAnnual / 12) - epfEmployer - edli - epfAdmin - gratuity - esiEmployer;

    // New labour code: Basic >= 50% of gross
    basicMonthly = Math.round(grossMonthly * 0.5);
  }

  const hraMonthly = Math.round(basicMonthly * 0.4); // 40% of basic (non-metro)
  const daMonthly = 0;
  const specialMonthly = Math.max(0, grossMonthly - basicMonthly - hraMonthly - daMonthly);

  // Employer contributions
  const pfWages = basicMonthly + daMonthly;
  const epfResult = epfApplicable ? calculateEpf(pfWages, { epfOnActualBasic }) : null;
  const epfEmployerMonthly = epfResult ? (epfResult.epfEmployerEpf + epfResult.epfEmployerEps) : 0;
  const edliMonthly = epfResult ? epfResult.edli : 0;
  const epfAdminMonthly = epfResult ? epfResult.adminCharge : 0;
  const gratuityMonthly = Math.round(basicMonthly * GRATUITY_RATE);
  const esiEmployerMonthly = (esiApplicable && grossMonthly <= ESI_WAGE_CEILING) ? Math.round(grossMonthly * ESI_EMPLOYER_RATE) : 0;
  const totalEmployerMonthly = epfEmployerMonthly + edliMonthly + epfAdminMonthly + gratuityMonthly + esiEmployerMonthly;

  // Employee deductions
  const epfEmployeeMonthly = epfResult ? epfResult.epfEmployee : 0;
  const esiEmployeeMonthly = (esiApplicable && grossMonthly <= ESI_WAGE_CEILING) ? Math.round(grossMonthly * ESI_EMPLOYEE_RATE) : 0;
  const ptMonthly = ptApplicable ? calculateProfessionalTax(grossMonthly * 12, 1) : 0; // non-March month
  const totalDeductionsMonthly = epfEmployeeMonthly + esiEmployeeMonthly + ptMonthly;
  const netMonthly = grossMonthly - totalDeductionsMonthly;

  return {
    ctcAnnual,
    basicMonthly,
    basicAnnual: basicMonthly * 12,
    hraMonthly,
    hraAnnual: hraMonthly * 12,
    daMonthly,
    daAnnual: daMonthly * 12,
    specialMonthly,
    specialAnnual: specialMonthly * 12,
    grossMonthly,
    grossAnnual: grossMonthly * 12,
    epfEmployerMonthly,
    esiEmployerMonthly,
    gratuityMonthly,
    edliMonthly,
    epfAdminMonthly,
    totalEmployerMonthly,
    epfEmployeeMonthly,
    esiEmployeeMonthly,
    ptMonthly,
    totalDeductionsMonthly,
    netMonthly,
  };
}

// ═══════════════════════════════════════════════════════════
// Compute full payroll for one employee
// ═══════════════════════════════════════════════════════════
export interface PayrollComputation {
  grossEarnings: number;
  earnings: { code: string; amount: number }[];
  pfWages: number;
  epf: EpfResult;
  esi: EsiResult;
  professionalTax: number;
  tds: TdsResult;
  totalDeductions: number;
  netPay: number;
  // ECR fields
  grossWages: number;
  epfWages: number;
  epsWages: number;
  edliWages: number;
}

export function computeEmployeePayroll(
  employee: {
    basicMonthly: number;
    ctcAnnual: number;
    epfApplicable: boolean;
    epfOnActualBasic: boolean;
    esiApplicable: boolean;
    ptApplicable: boolean;
    taxRegime: string;
    isInternationalWorker: boolean;
    higherPensionOpt: boolean;
    declared80C: number;
    declared80D: number;
    declaredOther: number;
  },
  salaryComponents: { code: string; monthlyAmount: number; isPfWage: boolean }[],
  month: number, // calendar month 1-12
  ytdTds: number = 0
): PayrollComputation {
  // Sum earnings
  const earnings = salaryComponents
    .filter(c => c.monthlyAmount > 0)
    .map(c => ({ code: c.code, amount: c.monthlyAmount }));
  const grossEarnings = earnings.reduce((sum, e) => sum + e.amount, 0);

  // PF wages = sum of components marked as isPfWage (Basic + DA typically)
  const pfWages = salaryComponents.filter(c => c.isPfWage).reduce((sum, c) => sum + c.monthlyAmount, 0);

  // EPF
  const epf = employee.epfApplicable
    ? calculateEpf(pfWages, {
        isInternationalWorker: employee.isInternationalWorker,
        higherPensionOpt: employee.higherPensionOpt,
        epfOnActualBasic: employee.epfOnActualBasic,
      })
    : { pfWages: 0, epfEmployee: 0, epfEmployerEpf: 0, epfEmployerEps: 0, edli: 0, adminCharge: 0, totalEmployerCost: 0 };

  // ESI
  const esi = employee.esiApplicable ? calculateEsi(grossEarnings) : { applicable: false, esiEmployee: 0, esiEmployer: 0 };

  // Professional Tax
  const professionalTax = employee.ptApplicable ? calculateProfessionalTax(grossEarnings * 12, month) : 0;

  // TDS
  const annualGross = grossEarnings * 12;
  const regime = (employee.taxRegime === 'OLD' ? 'OLD' : 'NEW') as 'NEW' | 'OLD';
  const tds = calculateTdsOnSalary(annualGross, regime, month, ytdTds, {
    declared80C: employee.declared80C,
    declared80D: employee.declared80D,
    declaredOther: employee.declaredOther,
    epfEmployeeAnnual: epf.epfEmployee * 12,
  });

  const totalDeductions = epf.epfEmployee + esi.esiEmployee + professionalTax + tds.monthlyTds;
  const netPay = grossEarnings - totalDeductions;

  // ECR fields
  const epsWages = employee.isInternationalWorker ? 0 : Math.min(pfWages, employee.higherPensionOpt ? pfWages : EPS_WAGE_CEILING);
  const edliWages = Math.min(pfWages, EPS_WAGE_CEILING);

  return {
    grossEarnings,
    earnings,
    pfWages,
    epf,
    esi,
    professionalTax,
    tds,
    totalDeductions,
    netPay,
    grossWages: grossEarnings,
    epfWages: pfWages,
    epsWages,
    edliWages,
  };
}

// ═══════════════════════════════════════════════════════════
// ECR File Generator
// ═══════════════════════════════════════════════════════════
export interface EcrRow {
  uan: string;
  name: string;
  grossWages: number;
  epfWages: number;
  epsWages: number;
  edliWages: number;
  epfEmployee: number;
  epsEmployer: number;
  epfEmployerDiff: number;
  ncpDays: number;
  refundOfAdvances: number;
}

export function generateEcrFileContent(rows: EcrRow[]): string {
  return rows
    .map(r =>
      [
        r.uan || '',
        r.name,
        Math.round(r.grossWages),
        Math.round(r.epfWages),
        Math.round(r.epsWages),
        Math.round(r.edliWages),
        Math.round(r.epfEmployee),
        Math.round(r.epsEmployer),
        Math.round(r.epfEmployerDiff),
        r.ncpDays,
        r.refundOfAdvances || 0,
      ].join(',')
    )
    .join('\n');
}
