/**
 * Import "Debt Schedule 2.xlsx" → BankLoan + LoanRepayment.
 *
 * Default mode: DRY RUN — prints exactly what would be inserted, no writes.
 * Pass `--apply` to actually persist.
 * Pass `--no-schedule` to skip generating LoanRepayment rows (useful if you only want headers).
 *
 * Safe to re-run: skips loans where loanNo already exists.
 */
import ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const NO_SCHEDULE = process.argv.includes('--no-schedule');
const XLSX = '/Users/saifraza/Downloads/Debt Schedule 2.xlsx';

interface ParsedLoan {
  rowNo: number;
  lenderName: string;
  loanNo: string;            // derived
  loanType: string;          // BankLoan.loanType
  disbursalDate: Date | null;
  sanctionAmount: number;
  disbursedAmount: number;
  tenureMonths: number;
  outstanding: number;
  emiAmount: number;
  remainingMonths: number | null;
  roiPercent: number;        // ANNUAL %
  collateral: string;
  security: string;
  freq: 'MONTHLY' | 'QUARTERLY' | 'BULLET';
  notes: string[];
}

function parseDate(raw: any): Date | null {
  if (!raw) return null;
  if (raw instanceof Date) return raw;
  const s = String(raw).trim();
  // YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  // DD-MM-YYYY or DD.MM.YYYY or DD/MM/YYYY
  m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})$/);
  if (m) {
    let yr = +m[3];
    if (yr < 100) yr += 2000;
    return new Date(yr, +m[2] - 1, +m[1]);
  }
  // DD.M.YY or D.M.YY
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2})$/);
  if (m) return new Date(2000 + +m[3], +m[2] - 1, +m[1]);
  return null;
}

function parseRoi(raw: any): number {
  if (raw == null) return 0;
  const s = String(raw).replace('%', '').trim();
  const n = parseFloat(s);
  if (isNaN(n)) return 0;
  // Some rows have 0.16 (decimal), some 16 — normalize. Decimals < 1 are fractions.
  return n < 1 ? n * 100 : n;
}

function parseTenure(raw: any): number {
  if (raw == null) return 0;
  const m = String(raw).match(/(\d+)/);
  return m ? +m[1] : 0;
}

function parseEmi(raw: any): { amount: number; freq: 'MONTHLY' | 'QUARTERLY' | 'BULLET' } {
  if (raw == null) return { amount: 0, freq: 'BULLET' };
  const s = String(raw);
  const num = parseFloat(s.replace(/[^\d.]/g, '')) || 0;
  if (/quarter/i.test(s)) return { amount: num, freq: 'QUARTERLY' };
  if (num === 0) return { amount: 0, freq: 'BULLET' };
  return { amount: num, freq: 'MONTHLY' };
}

function makeLoanNo(lender: string, rowNo: number): string {
  // Try to pull an account-like token (digits >= 6) from the lender string
  const m = lender.match(/[A-Z]?\/?[Aa]\/?[Cc]\.?\s*[Nn]?[Oo]?\.?\s*([0-9-]{6,})/) || lender.match(/(\d{6,})/);
  if (m) return `LOAN-${m[1].replace(/-/g, '')}`;
  // Else slug + row number
  const slug = lender.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  return `LOAN-${slug}-R${rowNo}`;
}

function addMonths(d: Date, n: number): Date { const r = new Date(d); r.setMonth(r.getMonth() + n); return r; }

async function parseSheet(): Promise<ParsedLoan[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX);
  const ws = wb.worksheets[0];
  const out: ParsedLoan[] = [];
  for (let rowNo = 4; rowNo <= 60; rowNo++) {
    const row = ws.getRow(rowNo);
    const get = (col: number): any => {
      const c = row.getCell(col).value;
      if (c == null) return null;
      if (typeof c === 'object' && (c as any).richText) return (c as any).richText.map((r: any) => r.text).join('');
      if (typeof c === 'object' && (c as any).result !== undefined) return (c as any).result;
      return c;
    };
    const lender = String(get(1) || '').trim();
    if (!lender || /^total/i.test(lender) || /^debt schedule/i.test(lender) || /^mahakaushal/i.test(lender) || /^lender/i.test(lender)) continue;
    const loanType = String(get(2) || 'TERM_LOAN').trim().toUpperCase();
    const sanctioned = Number(get(4) || 0);
    if (!sanctioned || sanctioned < 1000) continue; // skip headers/blanks
    const disbursed = Number(get(5) || sanctioned);
    const outstanding = Number(get(7) || 0);
    const emiInfo = parseEmi(get(8));
    const tenure = parseTenure(get(6));
    const remTen = (() => { const t = parseTenure(get(9)); return t > 0 ? t : null; })();
    const roi = parseRoi(get(10));
    const collateral = String(get(11) || '').trim();
    const security = String(get(12) || '').trim();
    const notes: string[] = [];
    if (loanType === 'CC' || loanType === 'PLEDGE') notes.push('Working-capital — interest-only / revolving');
    if (emiInfo.freq === 'QUARTERLY') notes.push('Quarterly repayment');
    if (outstanding > sanctioned * 1.05) notes.push('OS exceeds sanction — verify');
    out.push({
      rowNo,
      lenderName: lender,
      loanNo: makeLoanNo(lender, rowNo),
      loanType: ['CC', 'PLEDGE', 'WC'].includes(loanType) ? 'WORKING_CAPITAL' :
                ['AUTO', 'ATUO'].includes(loanType) ? 'EQUIPMENT' :
                ['BUSINESS', 'BL'].includes(loanType) ? 'TERM_LOAN' :
                ['LAP'].includes(loanType) ? 'TERM_LOAN' :
                ['TL'].includes(loanType) ? 'TERM_LOAN' : 'TERM_LOAN',
      disbursalDate: parseDate(get(3)),
      sanctionAmount: sanctioned,
      disbursedAmount: disbursed,
      tenureMonths: tenure,
      outstanding,
      emiAmount: emiInfo.amount,
      remainingMonths: remTen,
      roiPercent: roi,
      collateral,
      security,
      freq: emiInfo.freq,
      notes,
    });
  }
  return out;
}

function genSchedule(loan: ParsedLoan, today: Date): { installmentNo: number; dueDate: Date; principalAmount: number; interestAmount: number; totalAmount: number; outstandingAfter: number; status: string }[] {
  if (loan.freq === 'BULLET' || loan.tenureMonths === 0 || loan.emiAmount === 0) {
    // Bullet: one payment at maturity
    if (!loan.disbursalDate) return [];
    return [{
      installmentNo: 1,
      dueDate: addMonths(loan.disbursalDate, loan.tenureMonths || 12),
      principalAmount: loan.sanctionAmount,
      interestAmount: 0,
      totalAmount: loan.sanctionAmount,
      outstandingAfter: 0,
      status: addMonths(loan.disbursalDate, loan.tenureMonths || 12) < today ? 'PAID' : 'SCHEDULED',
    }];
  }
  if (!loan.disbursalDate) return [];

  const stepMonths = loan.freq === 'QUARTERLY' ? 3 : 1;
  const totalInstallments = loan.freq === 'QUARTERLY' ? Math.ceil(loan.tenureMonths / 3) : loan.tenureMonths;
  const monthlyRate = loan.roiPercent / 12 / 100;
  const stepRate = loan.freq === 'QUARTERLY' ? loan.roiPercent / 4 / 100 : monthlyRate;

  const sched: any[] = [];
  let outstanding = loan.sanctionAmount;
  for (let i = 1; i <= totalInstallments; i++) {
    const interest = Math.round(outstanding * stepRate * 100) / 100;
    const principal = Math.round((loan.emiAmount - interest) * 100) / 100;
    outstanding = Math.max(0, Math.round((outstanding - principal) * 100) / 100);
    if (i === totalInstallments) outstanding = 0;
    const dueDate = addMonths(loan.disbursalDate, i * stepMonths);
    sched.push({
      installmentNo: i,
      dueDate,
      principalAmount: principal,
      interestAmount: interest,
      totalAmount: loan.emiAmount,
      outstandingAfter: outstanding,
      status: dueDate < today ? 'PAID' : 'SCHEDULED',
    });
  }
  return sched;
}

async function main() {
  const today = new Date();
  console.log(`\n${APPLY ? '🟢 APPLY MODE' : '🟡 DRY RUN'} — reading ${XLSX}\n`);
  const loans = await parseSheet();
  console.log(`Parsed ${loans.length} loan rows from xlsx\n`);

  let willInsert = 0, willSkip = 0, totalScheduleRows = 0, totalSanctioned = 0, totalOutstanding = 0;

  for (const l of loans) {
    const exists = APPLY ? await prisma.bankLoan.findUnique({ where: { loanNo: l.loanNo }, include: { _count: { select: { repayments: true } } } }) : null;
    const sched = NO_SCHEDULE ? [] : genSchedule(l, today);
    const paidCount = sched.filter(s => s.status === 'PAID').length;
    const upcomingCount = sched.length - paidCount;

    console.log(`R${l.rowNo}  ${l.loanNo}  ${l.lenderName.slice(0, 40)}`);
    console.log(`        type=${l.loanType} freq=${l.freq} sanc=₹${l.sanctionAmount.toLocaleString('en-IN')} OS=₹${l.outstanding.toLocaleString('en-IN')} EMI=₹${l.emiAmount.toLocaleString('en-IN')} ROI=${l.roiPercent}% tenure=${l.tenureMonths}m`);
    console.log(`        disbursal=${l.disbursalDate?.toISOString().slice(0, 10) || 'UNKNOWN'}  schedule=${sched.length} (paid=${paidCount} upcoming=${upcomingCount})`);
    if (l.notes.length) console.log(`        notes: ${l.notes.join('; ')}`);

    // Zombie repair: loan exists but has zero repayments (failed mid-tx earlier) → fill schedule
    if (exists && exists._count.repayments === 0 && sched.length > 0 && APPLY) {
      console.log(`        🛠 ZOMBIE — loan exists but has 0 repayments. Filling schedule (${sched.length} rows).`);
      const CHUNK = 60;
      for (let i = 0; i < sched.length; i += CHUNK) {
        await prisma.loanRepayment.createMany({
          data: sched.slice(i, i + CHUNK).map(s => ({ ...s, loanId: exists.id, userId: 'system-debt-import' })),
        });
      }
      totalScheduleRows += sched.length;
      willSkip++;
      continue;
    }

    if (exists) { console.log(`        ⏩ EXISTS (with ${exists._count.repayments} repayments) — skipping`); willSkip++; continue; }

    willInsert++;
    totalScheduleRows += sched.length;
    totalSanctioned += l.sanctionAmount;
    totalOutstanding += l.outstanding;

    if (APPLY) {
      // Split into 2 ops (NOT a transaction) — long schedules (120m) blow Prisma's 5s
      // interactive-tx timeout. Re-running the script will fill in any missing schedules.
      const newLoan = await prisma.bankLoan.create({
        data: {
          loanNo: l.loanNo,
          bankName: l.lenderName,
          loanType: l.loanType,
          repaymentFrequency: l.freq,
          sanctionAmount: l.sanctionAmount,
          disbursedAmount: l.disbursedAmount,
          outstandingAmount: l.outstanding,
          interestRate: l.roiPercent,
          tenure: l.tenureMonths,
          emiAmount: l.emiAmount,
          sanctionDate: l.disbursalDate || new Date(),
          disbursementDate: l.disbursalDate || new Date(),
          maturityDate: l.disbursalDate ? addMonths(l.disbursalDate, l.tenureMonths || 12) : null,
          status: l.outstanding === 0 ? 'CLOSED' : 'ACTIVE',
          securityDetails: [l.collateral, l.security].filter(Boolean).join(' | '),
          remarks: l.notes.join('; ') || null,
          userId: 'system-debt-import',
        },
      });
      if (sched.length) {
        // Chunk to keep each createMany small + fast
        const CHUNK = 60;
        for (let i = 0; i < sched.length; i += CHUNK) {
          await prisma.loanRepayment.createMany({
            data: sched.slice(i, i + CHUNK).map(s => ({
              ...s,
              loanId: newLoan.id,
              userId: 'system-debt-import',
            })),
          });
        }
      }
    }
  }

  console.log(`\n========== ${APPLY ? 'APPLIED' : 'DRY-RUN'} SUMMARY ==========`);
  console.log(`Loans to insert : ${willInsert}`);
  console.log(`Loans to skip   : ${willSkip} (already exist)`);
  console.log(`Schedule rows   : ${totalScheduleRows}`);
  console.log(`Total sanctioned: ₹${totalSanctioned.toLocaleString('en-IN')}`);
  console.log(`Total outstanding: ₹${totalOutstanding.toLocaleString('en-IN')}`);
  if (!APPLY) console.log(`\n⚠️  No writes performed. Run with --apply to persist.\n`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
