/**
 * One-time importer — loads March 2026 salary data from MSPIL Excel sheets as
 * the OPENING-BALANCE PayrollRun for the ERP. Replaces the team's manual Excel.
 *
 * Source files (must be at /tmp/march-salary/):
 *   1. Senior staff March 2026- RTGS.xlsx       — Senior managers & directors (RTGS)
 *   2. Ethanol Plant NPF March 2026- Cash.xlsx  — Non-PF employees (Cash)
 *   2. Ethanol Plant NPF March 2026- RTGS.xlsx  — Non-PF employees (RTGS)
 *   2.PF March 2026- RTGS.xlsx                  — PF employees (RTGS)
 *   3. NPF March 2026- Cash.xlsx                — More Non-PF (Cash)
 *   4. Additional March 2026- Cash.xlsx         — Senior bonuses
 *   5. Cane Petrol and Mobile March 2026.xlsx   — Cane dept reimbursements
 *
 * Behaviour:
 *   - Creates SalaryComponent master if missing (BASIC, HRA, CONV, MED, MOBILE, EWA, EW, EPF_EE, etc.)
 *   - Matches employees by name (fuzzy); creates new Employee for unknowns.
 *   - Creates a March 2026 PayrollRun (DRAFT status if --commit, else dry-run).
 *   - Each employee gets ONE PayrollLine with all components, plus extras (additional/petrol/mobile).
 *   - Cash vs RTGS recorded on PayrollLine.cashAmount/bankAmount.
 *
 * Usage:
 *   npx tsx scripts/import-march-2026-salary.ts          # dry-run (prints summary, no DB writes)
 *   npx tsx scripts/import-march-2026-salary.ts --commit # actually write to DB
 *
 * Idempotent: safe to re-run. Uses upsert by name+empCode for employees, and
 * deletes existing March 2026 lines before re-creating if --commit specified.
 */
import ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import prisma from '../src/config/prisma';

const SRC_DIR = '/tmp/march-salary';
const COMMIT = process.argv.includes('--commit');
const RUN_MONTH = 3;
const RUN_YEAR = 2026;

function val(v: any): any {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if ('result' in v) return val((v as any).result);
    if ('text' in v) return val((v as any).text);
    if ('richText' in v) return (v as any).richText.map((x: any) => x.text).join('');
    if ('formula' in v) return null;
    if ('sharedFormula' in v) return null;
    return null;
  }
  return v;
}
const num = (v: any): number => { const x = val(v); if (x === null || x === '') return 0; const n = Number(x); return Number.isFinite(n) ? n : 0; };
const str = (v: any): string => { const x = val(v); return x === null ? '' : String(x).trim(); };

interface SalaryRow {
  source: string;
  paymentMode: 'CASH' | 'RTGS';
  category: 'SENIOR' | 'PF' | 'NPF' | 'ADDITIONAL' | 'CANE_PETROL' | 'CANE_MOBILE';
  section?: string;
  serial?: number;
  name: string;
  designation?: string;
  pfAcNo?: string;
  basic?: number;
  conv?: number;
  medical?: number;
  hra?: number;
  mobileOther?: number;
  totalSalary?: number;
  workingDays?: number;
  presentDays?: number;
  holidayDays?: number;
  holidayAmount?: number;
  ewDays?: number;
  ewAmount?: number;
  netSalary?: number;
  pfDeduction?: number;
  tds?: number;
  advance?: number;
  otherDeduction?: number;
  netPayable?: number;
  petrolMobileAmount?: number;
}

const rows: SalaryRow[] = [];

// ── Parsers ──────────────────────────────────────────────────
async function parseSeniorStaffRtgs(file: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet('Sheet1') || wb.worksheets[0];
  if (!ws) return;
  let section = 'DIRECTOR';
  for (let r = 5; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const sr = val(row.getCell(1).value);
    const name = str(row.getCell(2).value);
    const designation = str(row.getCell(3).value);
    if (typeof sr === 'string' && name === designation && !num(row.getCell(4).value)) { section = name; continue; }
    if (designation === 'TOTAL >>>' || designation.startsWith('TOTAL')) continue;
    if (!name) continue;
    const totalSalary = num(row.getCell(9).value);
    if (!totalSalary && !num(row.getCell(4).value)) continue;
    rows.push({
      source: path.basename(file), paymentMode: 'RTGS', category: 'SENIOR', section,
      serial: typeof sr === 'number' ? sr : undefined,
      name, designation,
      basic: num(row.getCell(4).value),
      conv: num(row.getCell(5).value),
      medical: num(row.getCell(6).value),
      hra: num(row.getCell(7).value),
      mobileOther: num(row.getCell(8).value),
      totalSalary,
      workingDays: num(row.getCell(10).value),
      presentDays: num(row.getCell(11).value),
      holidayDays: num(row.getCell(12).value),
      holidayAmount: num(row.getCell(13).value),
      netSalary: num(row.getCell(14).value),
      tds: num(row.getCell(15).value),
      advance: num(row.getCell(16).value),
      netPayable: num(row.getCell(17).value),
    });
  }
}

async function parseNpf(file: string, mode: 'CASH' | 'RTGS') {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet('Non PF Employee Salary Sheet') || wb.worksheets[0];
  if (!ws) return;
  let section = '';
  for (let r = 5; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const sr1 = val(row.getCell(1).value);
    const sr2 = val(row.getCell(2).value);
    const name = str(row.getCell(3).value);
    const designation = str(row.getCell(4).value);
    if (!sr1 && typeof sr2 === 'string' && sr2 && !name) { section = sr2; continue; }
    if (designation === 'TOTAL >>>') continue;
    if (!name) continue;
    const total = num(row.getCell(10).value);
    if (!total && !num(row.getCell(5).value)) continue;
    rows.push({
      source: path.basename(file), paymentMode: mode, category: 'NPF', section,
      serial: typeof sr1 === 'number' ? sr1 : undefined,
      name, designation,
      basic: num(row.getCell(5).value),
      conv: num(row.getCell(6).value),
      medical: num(row.getCell(7).value),
      mobileOther: num(row.getCell(8).value),
      hra: num(row.getCell(9).value),
      totalSalary: total,
      workingDays: num(row.getCell(11).value),
      presentDays: num(row.getCell(12).value),
      holidayDays: num(row.getCell(13).value),
      holidayAmount: num(row.getCell(14).value),
      netSalary: num(row.getCell(15).value),
      advance: num(row.getCell(16).value),
      netPayable: num(row.getCell(17).value),
    });
  }
}

async function parsePfRtgs(file: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet('PF Sheet ') || wb.getWorksheet('PF Sheet') || wb.worksheets[0];
  if (!ws) return;
  let section = '';
  for (let r = 6; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const sr = val(row.getCell(1).value);
    const name = str(row.getCell(2).value);
    const designation = str(row.getCell(3).value);
    if (typeof sr === 'string' && !designation) { section = sr; continue; }
    if (!name || designation === 'TOTAL >>>') continue;
    const total = num(row.getCell(11).value);
    if (!total && !num(row.getCell(6).value)) continue;
    rows.push({
      source: path.basename(file), paymentMode: 'RTGS', category: 'PF', section,
      serial: typeof sr === 'number' ? sr : undefined,
      name, designation,
      pfAcNo: str(row.getCell(5).value),
      basic: num(row.getCell(6).value),
      conv: num(row.getCell(7).value),
      medical: num(row.getCell(8).value),
      hra: num(row.getCell(9).value),
      mobileOther: num(row.getCell(10).value),
      totalSalary: total,
      workingDays: num(row.getCell(12).value),
      presentDays: num(row.getCell(13).value),
      ewDays: num(row.getCell(14).value),
      ewAmount: num(row.getCell(15).value),
      netSalary: num(row.getCell(16).value),
      pfDeduction: num(row.getCell(17).value),
      advance: num(row.getCell(18).value),
      netPayable: num(row.getCell(19).value),
    });
  }
}

async function parseAdditional(file: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet('Additional') || wb.worksheets[0];
  if (!ws) return;
  for (let r = 5; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const sr = val(row.getCell(1).value);
    const name = str(row.getCell(2).value);
    const designation = str(row.getCell(3).value);
    if (!name || designation === 'TOTAL >>>') continue;
    rows.push({
      source: path.basename(file), paymentMode: 'CASH', category: 'ADDITIONAL',
      serial: typeof sr === 'number' ? sr : undefined,
      name, designation,
      basic: num(row.getCell(4).value),
      workingDays: num(row.getCell(5).value),
      presentDays: num(row.getCell(6).value),
      ewDays: num(row.getCell(7).value),
      ewAmount: num(row.getCell(8).value),
      netPayable: num(row.getCell(9).value),
      advance: num(row.getCell(10).value),
    });
  }
}

async function parseCane(file: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  for (const wsName of wb.worksheets.map(w => w.name)) {
    const ws = wb.getWorksheet(wsName);
    if (!ws) continue;
    const isPetrol = wsName.toLowerCase().includes('petrol');
    const isMobile = wsName.toLowerCase().includes('mobile');
    if (!isPetrol && !isMobile) continue;
    for (let r = 4; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const sr = val(row.getCell(1).value);
      const name = str(row.getCell(2).value);
      const designation = str(row.getCell(3).value);
      if (!name || designation === 'TOTAL >>>') continue;
      const amt = num(row.getCell(6).value);
      if (!amt) continue;
      rows.push({
        source: path.basename(file), paymentMode: 'CASH',
        category: isPetrol ? 'CANE_PETROL' : 'CANE_MOBILE',
        serial: typeof sr === 'number' ? sr : undefined,
        name, designation,
        petrolMobileAmount: amt,
      });
    }
  }
}

// ── Name normalization for fuzzy matching ────────────────────
function normName(n: string): string {
  return n.toLowerCase()
    .replace(/^(shri\.?|smt\.?|mr\.?|mrs\.?|ms\.?|sri\.?)\s+/, '')
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function namesMatch(a: string, b: string): boolean {
  const na = normName(a);
  const nb = normName(b);
  if (na === nb) return true;
  const aTokens = na.split(' ').filter(t => t.length > 2);
  const bTokens = nb.split(' ').filter(t => t.length > 2);
  if (aTokens.length === 0 || bTokens.length === 0) return false;
  const overlap = aTokens.filter(t => bTokens.includes(t)).length;
  return overlap >= Math.min(2, Math.min(aTokens.length, bTokens.length));
}

// ── Main ───────────────────────────────────────────────────
const COMPONENT_CODES = [
  { code: 'BASIC', name: 'Basic Pay', type: 'EARNING', isPfWage: true, isStatutory: false, isTaxable: true, sortOrder: 1 },
  { code: 'CONV', name: 'Conveyance Allowance', type: 'EARNING', isPfWage: false, isStatutory: false, isTaxable: true, sortOrder: 10 },
  { code: 'MED', name: 'Medical Allowance', type: 'EARNING', isPfWage: false, isStatutory: false, isTaxable: true, sortOrder: 11 },
  { code: 'HRA', name: 'House Rent Allowance', type: 'EARNING', isPfWage: false, isStatutory: false, isTaxable: true, sortOrder: 12 },
  { code: 'MOBILE', name: 'Mobile & Other Allowance', type: 'EARNING', isPfWage: false, isStatutory: false, isTaxable: true, sortOrder: 13 },
  { code: 'EWA', name: 'Holiday Wage / EWA', type: 'EARNING', isPfWage: false, isStatutory: false, isTaxable: true, sortOrder: 20 },
  { code: 'EW', name: 'Extra Work Wage', type: 'EARNING', isPfWage: false, isStatutory: false, isTaxable: true, sortOrder: 21 },
  { code: 'ADDITIONAL', name: 'Additional Payment (one-off)', type: 'EARNING', isPfWage: false, isStatutory: false, isTaxable: true, sortOrder: 30 },
  { code: 'PETROL', name: 'Petrol Reimbursement', type: 'EARNING', isPfWage: false, isStatutory: false, isTaxable: false, sortOrder: 31 },
  { code: 'MOBILE_REIMB', name: 'Mobile Reimbursement', type: 'EARNING', isPfWage: false, isStatutory: false, isTaxable: false, sortOrder: 32 },
  { code: 'EPF_EE', name: 'EPF (Employee 12%)', type: 'DEDUCTION', isPfWage: false, isStatutory: true, isTaxable: false, sortOrder: 100 },
  { code: 'ESI_EE', name: 'ESI (Employee 0.75%)', type: 'DEDUCTION', isPfWage: false, isStatutory: true, isTaxable: false, sortOrder: 101 },
  { code: 'PT', name: 'Professional Tax', type: 'DEDUCTION', isPfWage: false, isStatutory: true, isTaxable: false, sortOrder: 102 },
  { code: 'TDS', name: 'TDS on Salary (Section 192)', type: 'DEDUCTION', isPfWage: false, isStatutory: true, isTaxable: false, sortOrder: 103 },
  { code: 'ADVANCE', name: 'Salary Advance Recovery', type: 'DEDUCTION', isPfWage: false, isStatutory: false, isTaxable: false, sortOrder: 110 },
  { code: 'OTHER_DED', name: 'Other Deduction', type: 'DEDUCTION', isPfWage: false, isStatutory: false, isTaxable: false, sortOrder: 111 },
  { code: 'EPF_ER_EPF', name: 'EPF Employer (3.67%)', type: 'EMPLOYER_CONTRIBUTION', isPfWage: false, isStatutory: true, isTaxable: false, sortOrder: 200 },
  { code: 'EPF_ER_EPS', name: 'EPS Employer (8.33%)', type: 'EMPLOYER_CONTRIBUTION', isPfWage: false, isStatutory: true, isTaxable: false, sortOrder: 201 },
  { code: 'EDLI', name: 'EDLI (0.5%)', type: 'EMPLOYER_CONTRIBUTION', isPfWage: false, isStatutory: true, isTaxable: false, sortOrder: 202 },
  { code: 'EPF_ADMIN', name: 'EPF Admin (0.5%)', type: 'EMPLOYER_CONTRIBUTION', isPfWage: false, isStatutory: true, isTaxable: false, sortOrder: 203 },
  { code: 'ESI_ER', name: 'ESI Employer (3.25%)', type: 'EMPLOYER_CONTRIBUTION', isPfWage: false, isStatutory: true, isTaxable: false, sortOrder: 204 },
];

(async () => {
  console.log(`\n${'='.repeat(72)}\n  MSPIL Salary Importer · ${COMMIT ? 'COMMIT MODE' : 'DRY-RUN'}  ·  ${RUN_MONTH}/${RUN_YEAR}\n${'='.repeat(72)}\n`);

  console.log('1/5 Reading Excel files…');
  await parseSeniorStaffRtgs(path.join(SRC_DIR, '1. Senior staff March 2026- RTGS.xlsx'));
  await parseNpf(path.join(SRC_DIR, '2. Ethanol Plant NPF March 2026- Cash.xlsx'), 'CASH');
  await parseNpf(path.join(SRC_DIR, '2. Ethanol Plant NPF March 2026- RTGS.xlsx'), 'RTGS');
  await parsePfRtgs(path.join(SRC_DIR, '2.PF March 2026- RTGS.xlsx'));
  await parseNpf(path.join(SRC_DIR, '3. NPF March 2026- Cash.xlsx'), 'CASH');
  await parseAdditional(path.join(SRC_DIR, '4. Additional March 2026- Cash.xlsx'));
  await parseCane(path.join(SRC_DIR, '5. Cane Petrol and Mobile March 2026- Cash.xlsx'));
  console.log(`    → parsed ${rows.length} rows\n`);

  // Group by category
  const byCat = rows.reduce((acc, r) => { (acc[r.category] = acc[r.category] || []).push(r); return acc; }, {} as Record<string, SalaryRow[]>);
  for (const c in byCat) console.log(`    ${c}: ${byCat[c].length}`);

  // ── 2. Ensure SalaryComponents exist ──
  console.log('\n2/5 Ensuring SalaryComponent master…');
  if (COMMIT) {
    for (const c of COMPONENT_CODES) {
      await prisma.salaryComponent.upsert({
        where: { code: c.code },
        create: c,
        update: { name: c.name, type: c.type, isPfWage: c.isPfWage, isStatutory: c.isStatutory, isTaxable: c.isTaxable, sortOrder: c.sortOrder },
      });
    }
    console.log(`    → upserted ${COMPONENT_CODES.length} components`);
  } else {
    console.log(`    → would upsert ${COMPONENT_CODES.length} components (dry-run)`);
  }

  // ── 3. Match / create employees ──
  console.log('\n3/5 Matching employees…');
  const existingEmps = await prisma.employee.findMany({ select: { id: true, empCode: true, empNo: true, firstName: true, lastName: true } });
  console.log(`    DB has ${existingEmps.length} employees`);

  // Group rows by employee name (normalized)
  const empRows: Record<string, SalaryRow[]> = {};
  for (const r of rows) {
    const key = normName(r.name);
    (empRows[key] = empRows[key] || []).push(r);
  }
  console.log(`    Excel has ${Object.keys(empRows).length} unique employees`);

  // Match or create
  const empIdByName: Record<string, string> = {};
  let matched = 0, created = 0;
  let nextEmpNo = (existingEmps.reduce((m, e) => Math.max(m, e.empNo || 0), 0)) + 1;

  for (const key in empRows) {
    const sample = empRows[key][0];
    const fullName = sample.name;

    // Try direct match
    let found = existingEmps.find(e => namesMatch(`${e.firstName} ${e.lastName}`, fullName));

    if (found) {
      empIdByName[key] = found.id;
      matched++;
      continue;
    }

    // Need to create
    const tokens = fullName.replace(/^(shri\.?|smt\.?|mr\.?|mrs\.?|ms\.?|sri\.?)\s+/i, '').trim().split(/\s+/);
    const firstName = tokens[0] || fullName;
    const lastName = tokens.slice(1).join(' ') || '';
    const empCode = `MSPIL-${String(nextEmpNo).padStart(3, '0')}`;

    if (COMMIT) {
      const e = await prisma.employee.create({
        data: {
          empCode,
          firstName,
          lastName,
          dateOfJoining: new Date(`${RUN_YEAR}-${String(RUN_MONTH).padStart(2, '0')}-01`),
          basicMonthly: sample.basic || 0,
          ctcAnnual: (sample.totalSalary || 0) * 12,
          epfApplicable: sample.category === 'PF',
          esiApplicable: false, // sheets don't track ESI; default off
          ptApplicable: true,
          taxRegime: 'NEW',
          payCategory: sample.category,
          defaultPayMode: sample.paymentMode === 'RTGS' ? 'BANK' : 'CASH',
          cashPayPercent: sample.paymentMode === 'CASH' ? 100 : 0,
          excelSection: sample.section || null,
          excelSourceFile: sample.source,
          division: 'ETHANOL', // default; team can refine post-import
          status: 'ACTIVE',
          isActive: true,
          remarks: `Imported from ${sample.source} on ${new Date().toISOString().slice(0, 10)}`,
        },
      });
      empIdByName[key] = e.id;
    } else {
      empIdByName[key] = `__NEW_${nextEmpNo}`;
    }
    created++;
    nextEmpNo++;
  }
  console.log(`    → matched ${matched} existing, created ${created} new`);

  // ── 4. Create / refresh PayrollRun ──
  console.log('\n4/5 Creating PayrollRun for March 2026…');
  let runId = '__DRY_RUN__';
  if (COMMIT) {
    const existing = await prisma.payrollRun.findUnique({ where: { month_year: { month: RUN_MONTH, year: RUN_YEAR } } });
    if (existing) {
      console.log(`    Existing run found (status=${existing.status}); deleting old lines…`);
      await prisma.payrollLineComponent.deleteMany({ where: { payrollLine: { payrollRunId: existing.id } } });
      await prisma.payrollLine.deleteMany({ where: { payrollRunId: existing.id } });
      runId = existing.id;
    } else {
      const run = await prisma.payrollRun.create({
        data: { month: RUN_MONTH, year: RUN_YEAR, status: 'DRAFT', remarks: 'Imported from MSPIL Excel as opening balance' },
      });
      runId = run.id;
    }
    console.log(`    → run id=${runId}`);
  }

  // ── 5. Create PayrollLine per employee (consolidating multiple sheet entries) ──
  console.log('\n5/5 Creating PayrollLine per employee…');
  const components = COMMIT ? await prisma.salaryComponent.findMany() : COMPONENT_CODES.map(c => ({ ...c, id: `__${c.code}` }));
  const compMap = new Map(components.map(c => [c.code, c]));

  let totalGross = 0, totalDed = 0, totalNet = 0, totalTds = 0, totalPf = 0, totalAdv = 0;
  let linesWritten = 0;

  for (const key in empRows) {
    const empId = empIdByName[key];
    if (!empId || empId.startsWith('__NEW_')) continue; // dry-run doesn't write

    const empSrcRows = empRows[key];
    // Pick "primary" row (largest totalSalary OR first non-additional/cane)
    const main = empSrcRows
      .filter(r => r.category === 'SENIOR' || r.category === 'PF' || r.category === 'NPF')
      .sort((a, b) => (b.totalSalary || 0) - (a.totalSalary || 0))[0]
      || empSrcRows[0];

    const additionalRow = empSrcRows.find(r => r.category === 'ADDITIONAL');
    const petrolRow = empSrcRows.find(r => r.category === 'CANE_PETROL');
    const mobileRow = empSrcRows.find(r => r.category === 'CANE_MOBILE');

    const basic = main.basic || 0;
    const conv = main.conv || 0;
    const med = main.medical || 0;
    const hra = main.hra || 0;
    const mobile = main.mobileOther || 0;
    const ewa = main.holidayAmount || 0;
    const ew = main.ewAmount || 0;
    const additionalAmt = additionalRow?.netPayable || 0;
    const petrolAmt = petrolRow?.petrolMobileAmount || 0;
    const mobileAllowance = mobileRow?.petrolMobileAmount || 0;

    const grossEarnings = (main.totalSalary || (basic + conv + med + hra + mobile)) + ewa + ew + additionalAmt + petrolAmt + mobileAllowance;
    const pfWages = main.category === 'PF' ? basic : 0;
    const epfEmployee = main.pfDeduction || 0;
    const tds = main.tds || 0;
    const advanceDeduction = main.advance || 0;
    const totalDeductions = epfEmployee + tds + advanceDeduction;
    const netPay = grossEarnings - totalDeductions;

    const isCash = main.paymentMode === 'CASH';
    const cashAmount = isCash ? netPay : 0;
    const bankAmount = isCash ? 0 : netPay;

    if (COMMIT) {
      const line = await prisma.payrollLine.create({
        data: {
          payrollRunId: runId,
          employeeId: empId,
          grossEarnings,
          totalDeductions,
          netPay,
          cashAmount,
          bankAmount,
          paidStatus: 'UNPAID',
          pfWages,
          epfEmployee,
          epfEmployerEpf: 0,
          epfEmployerEps: 0,
          edliEmployer: 0,
          epfAdminCharge: 0,
          esiEmployee: 0,
          esiEmployer: 0,
          professionalTax: 0,
          tds,
          grossWages: grossEarnings,
          epfWages: pfWages,
          epsWages: 0,
          edliWages: 0,
          ncpDays: Math.max(0, (main.workingDays || 0) - (main.presentDays || 0)),
          workingDays: main.workingDays || 0,
          presentDays: main.presentDays || 0,
          holidayDays: main.holidayDays || 0,
          holidayAmount: ewa,
          ewDays: main.ewDays || 0,
          ewAmount: ew,
          advanceDeduction,
          otherDeduction: main.otherDeduction || 0,
          additionalAmount: additionalAmt,
          additionalNote: additionalRow ? `Additional payment (${additionalRow.designation || ''})`.trim() : null,
          petrolAmount: petrolAmt,
          mobileAllowance,
          category: main.category as any,
          status: 'COMPUTED',
          remarks: `Imported from ${main.source}${additionalRow ? ` + ${additionalRow.source}` : ''}`,
        },
      });

      // Component-level rows
      const compEntries: { code: string; amount: number }[] = [
        { code: 'BASIC', amount: basic },
        { code: 'CONV', amount: conv },
        { code: 'MED', amount: med },
        { code: 'HRA', amount: hra },
        { code: 'MOBILE', amount: mobile },
        { code: 'EWA', amount: ewa },
        { code: 'EW', amount: ew },
        { code: 'ADDITIONAL', amount: additionalAmt },
        { code: 'PETROL', amount: petrolAmt },
        { code: 'MOBILE_REIMB', amount: mobileAllowance },
        { code: 'EPF_EE', amount: epfEmployee },
        { code: 'TDS', amount: tds },
        { code: 'ADVANCE', amount: advanceDeduction },
      ].filter(c => c.amount > 0);

      for (const ce of compEntries) {
        const comp = compMap.get(ce.code);
        if (!comp) continue;
        await prisma.payrollLineComponent.upsert({
          where: { payrollLineId_componentId: { payrollLineId: line.id, componentId: comp.id } },
          create: { payrollLineId: line.id, componentId: comp.id, amount: ce.amount },
          update: { amount: ce.amount },
        });
      }
    }

    totalGross += grossEarnings;
    totalDed += totalDeductions;
    totalNet += netPay;
    totalTds += tds;
    totalPf += epfEmployee;
    totalAdv += advanceDeduction;
    linesWritten++;
  }

  // Update run totals
  if (COMMIT && runId !== '__DRY_RUN__') {
    await prisma.payrollRun.update({
      where: { id: runId },
      data: {
        totalGross,
        totalDeductions: totalDed,
        totalNet,
        totalEpfEmployee: totalPf,
        totalEpfEmployer: 0,
        totalEsiEmployee: 0,
        totalEsiEmployer: 0,
        totalPt: 0,
        totalTds,
        employeeCount: linesWritten,
      },
    });
  }

  console.log(`\n${'='.repeat(72)}`);
  console.log(`  Summary  ·  ${COMMIT ? 'COMMITTED' : 'DRY-RUN (no DB writes)'}`);
  console.log('='.repeat(72));
  console.log(`  Lines written:     ${linesWritten}`);
  console.log(`  Gross earnings:    ₹${totalGross.toLocaleString('en-IN')}`);
  console.log(`  Deductions (PF+TDS+Adv): ₹${totalDed.toLocaleString('en-IN')}`);
  console.log(`  Net pay:           ₹${totalNet.toLocaleString('en-IN')}`);
  console.log(`  TDS:               ₹${totalTds.toLocaleString('en-IN')}`);
  console.log(`  PF (employee):     ₹${totalPf.toLocaleString('en-IN')}`);
  console.log(`  Advance recovery:  ₹${totalAdv.toLocaleString('en-IN')}`);
  console.log(`  Run ID:            ${runId}`);
  if (!COMMIT) console.log(`\n  Re-run with --commit to write to DB.`);
  await prisma.$disconnect();
})();
