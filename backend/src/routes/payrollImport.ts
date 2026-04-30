/**
 * Payroll Import — accepts MSPIL-style salary xlsx files and creates a PayrollRun.
 *
 * Mirrors the team's existing Excel structure (Senior / NPF / PF / Additional / Cane).
 * Workflow:
 *   1. POST /preview — upload files, parse, return preview JSON (no DB writes)
 *   2. POST /commit  — re-upload + month/year + commit=true → writes to DB
 *
 * Replaces the team's manual Excel-only payroll process.
 */
import { Router, Response } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import prisma from '../config/prisma';
import { authenticate, AuthRequest, getActiveCompanyId } from '../middleware/auth';
import { asyncHandler } from '../shared/middleware';

const router = Router();
router.use(authenticate as any);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── Helpers ────────────────────────────────────────────────────
const v = (x: any): any => {
  if (x === null || x === undefined) return null;
  if (typeof x === 'object') {
    if ('result' in x) return v((x as any).result);
    if ('text' in x) return v((x as any).text);
    if ('richText' in x) return (x as any).richText.map((r: any) => r.text).join('');
    if ('formula' in x || 'sharedFormula' in x) return null;
    return null;
  }
  return x;
};
const num = (x: any): number => { const r = v(x); if (r === null || r === '') return 0; const n = Number(r); return Number.isFinite(n) ? n : 0; };
const str = (x: any): string => { const r = v(x); return r === null ? '' : String(r).trim(); };

function normName(n: string): string {
  return n.toLowerCase()
    .replace(/^(shri\.?|smt\.?|mr\.?|mrs\.?|ms\.?|sri\.?)\s+/, '')
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function namesMatch(a: string, b: string): boolean {
  const na = normName(a), nb = normName(b);
  if (na === nb) return true;
  const at = na.split(' ').filter(t => t.length > 2);
  const bt = nb.split(' ').filter(t => t.length > 2);
  if (at.length === 0 || bt.length === 0) return false;
  return at.filter(t => bt.includes(t)).length >= Math.min(2, Math.min(at.length, bt.length));
}

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
  netPayable?: number;
  petrolMobileAmount?: number;
}

// ── Sheet detector & parser ─────────────────────────────────────
type FileType = 'SENIOR' | 'NPF' | 'PF' | 'ADDITIONAL' | 'CANE' | 'UNKNOWN';

function detectFileType(filename: string, sheets: string[]): FileType {
  const f = filename.toLowerCase();
  if (f.includes('senior')) return 'SENIOR';
  if (f.includes('additional')) return 'ADDITIONAL';
  if (f.includes('cane') || f.includes('petrol') || f.includes('mobile')) return 'CANE';
  if (sheets.some(s => s.toLowerCase().includes('pf sheet'))) return 'PF';
  if (sheets.some(s => s.toLowerCase().includes('non pf'))) return 'NPF';
  return 'UNKNOWN';
}

async function parseFile(buffer: Buffer, filename: string): Promise<SalaryRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const sheets = wb.worksheets.map(w => w.name);
  const type = detectFileType(filename, sheets);
  const out: SalaryRow[] = [];

  // Use Cash/RTGS hint from filename
  const mode: 'CASH' | 'RTGS' = filename.toLowerCase().includes('cash') ? 'CASH' : 'RTGS';

  if (type === 'SENIOR') {
    const ws = wb.worksheets[0]; if (!ws) return out;
    let section = 'DIRECTOR';
    for (let r = 5; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const sr = v(row.getCell(1).value);
      const name = str(row.getCell(2).value);
      const designation = str(row.getCell(3).value);
      if (typeof sr === 'string' && name === designation && !num(row.getCell(4).value)) { section = name; continue; }
      if (designation.startsWith('TOTAL') || !name) continue;
      const total = num(row.getCell(9).value);
      if (!total && !num(row.getCell(4).value)) continue;
      out.push({
        source: filename, paymentMode: mode, category: 'SENIOR', section,
        serial: typeof sr === 'number' ? sr : undefined,
        name, designation,
        basic: num(row.getCell(4).value), conv: num(row.getCell(5).value),
        medical: num(row.getCell(6).value), hra: num(row.getCell(7).value), mobileOther: num(row.getCell(8).value),
        totalSalary: total, workingDays: num(row.getCell(10).value), presentDays: num(row.getCell(11).value),
        holidayDays: num(row.getCell(12).value), holidayAmount: num(row.getCell(13).value),
        netSalary: num(row.getCell(14).value), tds: num(row.getCell(15).value),
        advance: num(row.getCell(16).value), netPayable: num(row.getCell(17).value),
      });
    }
  } else if (type === 'NPF') {
    const ws = wb.getWorksheet('Non PF Employee Salary Sheet') || wb.worksheets[0]; if (!ws) return out;
    let section = '';
    for (let r = 5; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const sr1 = v(row.getCell(1).value);
      const sr2 = v(row.getCell(2).value);
      const name = str(row.getCell(3).value);
      const designation = str(row.getCell(4).value);
      if (!sr1 && typeof sr2 === 'string' && sr2 && !name) { section = sr2; continue; }
      if (designation === 'TOTAL >>>' || !name) continue;
      const total = num(row.getCell(10).value);
      if (!total && !num(row.getCell(5).value)) continue;
      out.push({
        source: filename, paymentMode: mode, category: 'NPF', section,
        serial: typeof sr1 === 'number' ? sr1 : undefined,
        name, designation,
        basic: num(row.getCell(5).value), conv: num(row.getCell(6).value),
        medical: num(row.getCell(7).value), mobileOther: num(row.getCell(8).value), hra: num(row.getCell(9).value),
        totalSalary: total, workingDays: num(row.getCell(11).value), presentDays: num(row.getCell(12).value),
        holidayDays: num(row.getCell(13).value), holidayAmount: num(row.getCell(14).value),
        netSalary: num(row.getCell(15).value), advance: num(row.getCell(16).value), netPayable: num(row.getCell(17).value),
      });
    }
  } else if (type === 'PF') {
    const ws = wb.getWorksheet('PF Sheet ') || wb.getWorksheet('PF Sheet') || wb.worksheets[0]; if (!ws) return out;
    let section = '';
    for (let r = 6; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const sr = v(row.getCell(1).value);
      const name = str(row.getCell(2).value);
      const designation = str(row.getCell(3).value);
      if (typeof sr === 'string' && !designation) { section = sr; continue; }
      if (!name || designation === 'TOTAL >>>') continue;
      const total = num(row.getCell(11).value);
      if (!total && !num(row.getCell(6).value)) continue;
      out.push({
        source: filename, paymentMode: 'RTGS', category: 'PF', section,
        serial: typeof sr === 'number' ? sr : undefined,
        name, designation,
        pfAcNo: str(row.getCell(5).value),
        basic: num(row.getCell(6).value), conv: num(row.getCell(7).value),
        medical: num(row.getCell(8).value), hra: num(row.getCell(9).value), mobileOther: num(row.getCell(10).value),
        totalSalary: total, workingDays: num(row.getCell(12).value), presentDays: num(row.getCell(13).value),
        ewDays: num(row.getCell(14).value), ewAmount: num(row.getCell(15).value),
        netSalary: num(row.getCell(16).value), pfDeduction: num(row.getCell(17).value),
        advance: num(row.getCell(18).value), netPayable: num(row.getCell(19).value),
      });
    }
  } else if (type === 'ADDITIONAL') {
    const ws = wb.worksheets[0]; if (!ws) return out;
    for (let r = 5; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const sr = v(row.getCell(1).value);
      const name = str(row.getCell(2).value);
      const designation = str(row.getCell(3).value);
      if (!name || designation === 'TOTAL >>>') continue;
      out.push({
        source: filename, paymentMode: 'CASH', category: 'ADDITIONAL',
        serial: typeof sr === 'number' ? sr : undefined,
        name, designation,
        basic: num(row.getCell(4).value), workingDays: num(row.getCell(5).value),
        presentDays: num(row.getCell(6).value), ewDays: num(row.getCell(7).value),
        ewAmount: num(row.getCell(8).value), netPayable: num(row.getCell(9).value),
        advance: num(row.getCell(10).value),
      });
    }
  } else if (type === 'CANE') {
    for (const wsName of sheets) {
      const ws = wb.getWorksheet(wsName); if (!ws) continue;
      const isPetrol = wsName.toLowerCase().includes('petrol');
      const isMobile = wsName.toLowerCase().includes('mobile');
      if (!isPetrol && !isMobile) continue;
      for (let r = 4; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const sr = v(row.getCell(1).value);
        const name = str(row.getCell(2).value);
        const designation = str(row.getCell(3).value);
        if (!name || designation === 'TOTAL >>>') continue;
        const amt = num(row.getCell(6).value);
        if (!amt) continue;
        out.push({
          source: filename, paymentMode: 'CASH',
          category: isPetrol ? 'CANE_PETROL' : 'CANE_MOBILE',
          serial: typeof sr === 'number' ? sr : undefined,
          name, designation, petrolMobileAmount: amt,
        });
      }
    }
  }

  return out;
}

// ── POST /preview — parse & summarize, no DB writes ─────────────
router.post('/preview', upload.array('files', 10), asyncHandler(async (req: AuthRequest, res: Response) => {
  const files = req.files as Express.Multer.File[];
  if (!files?.length) { res.status(400).json({ error: 'No files uploaded' }); return; }

  const allRows: SalaryRow[] = [];
  for (const f of files) {
    if (!f.originalname.match(/\.xlsx?$/i)) continue;
    const rows = await parseFile(f.buffer, f.originalname);
    allRows.push(...rows);
  }

  // Group by employee
  const empMap: Record<string, SalaryRow[]> = {};
  for (const r of allRows) {
    const k = normName(r.name);
    (empMap[k] = empMap[k] || []).push(r);
  }

  const existing = await prisma.employee.findMany({ select: { id: true, firstName: true, lastName: true, empCode: true } ,
    take: 500,
  });
  let matched = 0, willCreate = 0;
  const employees = Object.entries(empMap).map(([key, srcRows]) => {
    const main = srcRows.filter(r => ['SENIOR', 'PF', 'NPF'].includes(r.category)).sort((a, b) => (b.totalSalary || 0) - (a.totalSalary || 0))[0] || srcRows[0];
    const found = existing.find(e => namesMatch(`${e.firstName} ${e.lastName}`, main.name));
    if (found) matched++; else willCreate++;
    const additional = srcRows.find(r => r.category === 'ADDITIONAL');
    const petrol = srcRows.find(r => r.category === 'CANE_PETROL');
    const mobile = srcRows.find(r => r.category === 'CANE_MOBILE');
    const grossMain = main.totalSalary || 0;
    const grossExtra = (additional?.netPayable || 0) + (petrol?.petrolMobileAmount || 0) + (mobile?.petrolMobileAmount || 0);
    const ewa = main.holidayAmount || 0;
    const ew = main.ewAmount || 0;
    const gross = grossMain + ewa + ew + grossExtra;
    const ded = (main.pfDeduction || 0) + (main.tds || 0) + (main.advance || 0);
    return {
      key,
      name: main.name,
      designation: main.designation,
      category: main.category,
      paymentMode: main.paymentMode,
      section: main.section,
      pfAcNo: main.pfAcNo,
      existingEmpId: found?.id,
      existingEmpCode: found?.empCode,
      action: found ? 'MATCH' : 'CREATE',
      basic: main.basic || 0,
      conv: main.conv || 0,
      medical: main.medical || 0,
      hra: main.hra || 0,
      mobileOther: main.mobileOther || 0,
      ewa, ew,
      additional: additional?.netPayable || 0,
      petrol: petrol?.petrolMobileAmount || 0,
      mobile: mobile?.petrolMobileAmount || 0,
      pfDeduction: main.pfDeduction || 0,
      tds: main.tds || 0,
      advance: main.advance || 0,
      gross, totalDeductions: ded, net: gross - ded,
      sourceFiles: [...new Set(srcRows.map(r => r.source))],
    };
  });

  const totals = employees.reduce((acc, e) => {
    acc.gross += e.gross; acc.ded += e.totalDeductions; acc.net += e.net;
    acc.tds += e.tds; acc.pf += e.pfDeduction; acc.adv += e.advance;
    acc.cash += e.paymentMode === 'CASH' ? e.net : 0;
    acc.bank += e.paymentMode === 'RTGS' ? e.net : 0;
    return acc;
  }, { gross: 0, ded: 0, net: 0, tds: 0, pf: 0, adv: 0, cash: 0, bank: 0 });

  res.json({
    summary: {
      totalRowsParsed: allRows.length,
      uniqueEmployees: Object.keys(empMap).length,
      matched, willCreate,
      filesProcessed: files.map(f => ({ name: f.originalname, size: f.size })),
      totals,
    },
    employees,
    rawRows: allRows.length, // count only
  });
}));

// ── POST /commit — write to DB ───────────────────────────────────
router.post('/commit', upload.array('files', 10), asyncHandler(async (req: AuthRequest, res: Response) => {
  const files = req.files as Express.Multer.File[];
  if (!files?.length) { res.status(400).json({ error: 'No files uploaded' }); return; }
  const month = parseInt(req.body.month, 10);
  const year = parseInt(req.body.year, 10);
  if (!month || !year) { res.status(400).json({ error: 'month and year required' }); return; }

  const allRows: SalaryRow[] = [];
  for (const f of files) {
    if (!f.originalname.match(/\.xlsx?$/i)) continue;
    allRows.push(...await parseFile(f.buffer, f.originalname));
  }

  // Component master
  const COMPONENT_DEFS = [
    { code: 'BASIC', name: 'Basic Pay', type: 'EARNING', isPfWage: true, sortOrder: 1 },
    { code: 'CONV', name: 'Conveyance Allowance', type: 'EARNING', isPfWage: false, sortOrder: 10 },
    { code: 'MED', name: 'Medical Allowance', type: 'EARNING', isPfWage: false, sortOrder: 11 },
    { code: 'HRA', name: 'House Rent Allowance', type: 'EARNING', isPfWage: false, sortOrder: 12 },
    { code: 'MOBILE', name: 'Mobile & Other Allowance', type: 'EARNING', isPfWage: false, sortOrder: 13 },
    { code: 'EWA', name: 'Holiday Wage / EWA', type: 'EARNING', isPfWage: false, sortOrder: 20 },
    { code: 'EW', name: 'Extra Work Wage', type: 'EARNING', isPfWage: false, sortOrder: 21 },
    { code: 'ADDITIONAL', name: 'Additional Payment (one-off)', type: 'EARNING', isPfWage: false, sortOrder: 30 },
    { code: 'PETROL', name: 'Petrol Reimbursement', type: 'EARNING', isPfWage: false, sortOrder: 31 },
    { code: 'MOBILE_REIMB', name: 'Mobile Reimbursement', type: 'EARNING', isPfWage: false, sortOrder: 32 },
    { code: 'EPF_EE', name: 'EPF (Employee 12%)', type: 'DEDUCTION', isPfWage: false, sortOrder: 100 },
    { code: 'TDS', name: 'TDS on Salary', type: 'DEDUCTION', isPfWage: false, sortOrder: 103 },
    { code: 'ADVANCE', name: 'Salary Advance Recovery', type: 'DEDUCTION', isPfWage: false, sortOrder: 110 },
  ];
  for (const c of COMPONENT_DEFS) {
    await prisma.salaryComponent.upsert({ where: { code: c.code }, create: c, update: { name: c.name } });
  }
  const allComponents = await prisma.salaryComponent.findMany({ take: 500 });
  const compMap = new Map(allComponents.map(c => [c.code, c]));

  // Group rows by employee
  const empMap: Record<string, SalaryRow[]> = {};
  for (const r of allRows) {
    const k = normName(r.name);
    (empMap[k] = empMap[k] || []).push(r);
  }

  const existing = await prisma.employee.findMany({ select: { id: true, empNo: true, firstName: true, lastName: true } ,
    take: 500,
  });
  let nextEmpNo = (existing.reduce((m, e) => Math.max(m, e.empNo || 0), 0)) + 1;
  const empIds: Record<string, string> = {};

  for (const key in empMap) {
    const sample = empMap[key].filter(r => ['SENIOR', 'PF', 'NPF'].includes(r.category)).sort((a, b) => (b.totalSalary || 0) - (a.totalSalary || 0))[0] || empMap[key][0];
    const found = existing.find(e => namesMatch(`${e.firstName} ${e.lastName}`, sample.name));
    if (found) { empIds[key] = found.id; continue; }
    const tokens = sample.name.replace(/^(shri\.?|smt\.?|mr\.?|mrs\.?|ms\.?|sri\.?)\s+/i, '').trim().split(/\s+/);
    const e = await prisma.employee.create({
      data: {
        empCode: `MSPIL-${String(nextEmpNo).padStart(3, '0')}`,
        firstName: tokens[0] || sample.name,
        lastName: tokens.slice(1).join(' ') || '',
        dateOfJoining: new Date(`${year}-${String(month).padStart(2, '0')}-01`),
        basicMonthly: sample.basic || 0,
        ctcAnnual: (sample.totalSalary || 0) * 12,
        epfApplicable: sample.category === 'PF',
        esiApplicable: false,
        ptApplicable: true,
        taxRegime: 'NEW',
        payCategory: sample.category,
        defaultPayMode: sample.paymentMode === 'RTGS' ? 'BANK' : 'CASH',
        cashPayPercent: sample.paymentMode === 'CASH' ? 100 : 0,
        excelSection: sample.section || null,
        excelSourceFile: sample.source,
        division: 'ETHANOL',
        status: 'ACTIVE',
        isActive: true,
        companyId: getActiveCompanyId(req),
        remarks: `Imported from ${sample.source}`,
      },
    });
    empIds[key] = e.id;
    nextEmpNo++;
  }

  // Get/create payroll run
  let run = await prisma.payrollRun.findUnique({ where: { month_year: { month, year } } });
  if (run) {
    if (run.status === 'PAID' || run.status === 'APPROVED') {
      res.status(400).json({ error: `Cannot re-import: ${month}/${year} run is ${run.status}.` });
      return;
    }
    await prisma.payrollLineComponent.deleteMany({ where: { payrollLine: { payrollRunId: run.id } } });
    await prisma.payrollLine.deleteMany({ where: { payrollRunId: run.id } });
  } else {
    run = await prisma.payrollRun.create({
      data: { month, year, status: 'DRAFT', userId: req.user?.id, companyId: getActiveCompanyId(req), remarks: `Imported from MSPIL Excel · ${files.length} file(s)` },
    });
  }

  // Create lines
  let totalGross = 0, totalDed = 0, totalNet = 0, totalTds = 0, totalPf = 0;
  let lines = 0;

  // Dedupe: two name spellings can map to the same DB employee.
  // Merge source rows by empId so we get exactly one PayrollLine per employee.
  const rowsByEmpId: Record<string, SalaryRow[]> = {};
  for (const key in empMap) {
    const empId = empIds[key]; if (!empId) continue;
    if (!rowsByEmpId[empId]) rowsByEmpId[empId] = [];
    rowsByEmpId[empId].push(...empMap[key]);
  }

  for (const empId in rowsByEmpId) {
    const srcRows = rowsByEmpId[empId];
    const main = srcRows.filter(r => ['SENIOR', 'PF', 'NPF'].includes(r.category)).sort((a, b) => (b.totalSalary || 0) - (a.totalSalary || 0))[0] || srcRows[0];
    const additional = srcRows.find(r => r.category === 'ADDITIONAL');
    const petrol = srcRows.find(r => r.category === 'CANE_PETROL');
    const mobile = srcRows.find(r => r.category === 'CANE_MOBILE');

    const basic = main.basic || 0;
    const conv = main.conv || 0;
    const med = main.medical || 0;
    const hra = main.hra || 0;
    const mob = main.mobileOther || 0;
    const ewa = main.holidayAmount || 0;
    const ew = main.ewAmount || 0;
    const addAmt = additional?.netPayable || 0;
    const petAmt = petrol?.petrolMobileAmount || 0;
    const mobAmt = mobile?.petrolMobileAmount || 0;

    const grossEarnings = (main.totalSalary || basic + conv + med + hra + mob) + ewa + ew + addAmt + petAmt + mobAmt;
    const pfWages = main.category === 'PF' ? basic : 0;
    const epfEmployee = main.pfDeduction || 0;
    const tds = main.tds || 0;
    const advance = main.advance || 0;
    const totalDeductions = epfEmployee + tds + advance;
    const netPay = grossEarnings - totalDeductions;
    const isCash = main.paymentMode === 'CASH';

    const line = await prisma.payrollLine.create({
      data: {
        payrollRunId: run.id, employeeId: empId,
        grossEarnings, totalDeductions, netPay,
        cashAmount: isCash ? netPay : 0,
        bankAmount: isCash ? 0 : netPay,
        paidStatus: 'UNPAID',
        pfWages, epfEmployee, epfEmployerEpf: 0, epfEmployerEps: 0, edliEmployer: 0, epfAdminCharge: 0,
        esiEmployee: 0, esiEmployer: 0, professionalTax: 0, tds,
        grossWages: grossEarnings, epfWages: pfWages, epsWages: 0, edliWages: 0,
        ncpDays: Math.max(0, (main.workingDays || 0) - (main.presentDays || 0)),
        workingDays: main.workingDays || 0,
        presentDays: main.presentDays || 0,
        holidayDays: main.holidayDays || 0,
        holidayAmount: ewa,
        ewDays: main.ewDays || 0,
        ewAmount: ew,
        advanceDeduction: advance,
        otherDeduction: 0,
        additionalAmount: addAmt,
        additionalNote: additional ? `Additional payment (${additional.designation || ''})`.trim() : null,
        petrolAmount: petAmt,
        mobileAllowance: mobAmt,
        category: main.category,
        status: 'COMPUTED',
        remarks: `Imported · ${[...new Set(srcRows.map(r => r.source))].join(' + ')}`,
      },
    });

    const compRows: { code: string; amount: number }[] = [
      { code: 'BASIC', amount: basic },
      { code: 'CONV', amount: conv },
      { code: 'MED', amount: med },
      { code: 'HRA', amount: hra },
      { code: 'MOBILE', amount: mob },
      { code: 'EWA', amount: ewa },
      { code: 'EW', amount: ew },
      { code: 'ADDITIONAL', amount: addAmt },
      { code: 'PETROL', amount: petAmt },
      { code: 'MOBILE_REIMB', amount: mobAmt },
      { code: 'EPF_EE', amount: epfEmployee },
      { code: 'TDS', amount: tds },
      { code: 'ADVANCE', amount: advance },
    ].filter(c => c.amount > 0);
    for (const cr of compRows) {
      const comp = compMap.get(cr.code);
      if (!comp) continue;
      await prisma.payrollLineComponent.create({
        data: { payrollLineId: line.id, componentId: comp.id, amount: cr.amount },
      });
    }

    totalGross += grossEarnings;
    totalDed += totalDeductions;
    totalNet += netPay;
    totalTds += tds;
    totalPf += epfEmployee;
    lines++;
  }

  await prisma.payrollRun.update({
    where: { id: run.id },
    data: {
      totalGross, totalDeductions: totalDed, totalNet,
      totalEpfEmployee: totalPf, totalTds, employeeCount: lines, status: 'COMPUTED',
    },
  });

  res.json({
    runId: run.id,
    month, year,
    linesWritten: lines,
    totals: { gross: totalGross, deductions: totalDed, net: totalNet, tds: totalTds, pf: totalPf },
    redirectUrl: `/hr/payroll`,
  });
}));

export default router;
