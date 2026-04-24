/**
 * Cleanup test JEs + load 37 real loans from "Debt Schedule 2.xlsx".
 *
 * Steps:
 *   1. Ensure account 5999 "Opening Balance Equity" exists
 *   2. Delete 16 pre-go-live / test JEs (list below)
 *   3. Insert 37 BankLoan rows with repayment schedules
 *   4. Post opening-balance JE per loan (Dr 5999, Cr 2400) for CURRENT outstanding
 *
 * Usage:
 *   tsx backend/scripts/cleanup-and-load-loans.ts          # DRY RUN
 *   tsx backend/scripts/cleanup-and-load-loans.ts --apply  # WRITE
 */
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

// JEs identified as test/pre-go-live (user confirmed)
const TEST_JE_NOS = [71, 3, 11, 21, 32, 37, 39, 2, 25, 26, 27, 28, 29, 30, 34, 72];

// ── Excel loan type → ERP enum ──
function mapType(t: string): string {
  const u = t.toUpperCase();
  if (u === 'CC') return 'CC_LIMIT';
  if (u === 'AUTO' || u === 'ATUO') return 'EQUIPMENT';
  if (u === 'BUSINESS') return 'WORKING_CAPITAL';
  if (u === 'LAP' || u === 'TL') return 'TERM_LOAN';
  if (u === 'PLEDGE') return 'WORKING_CAPITAL';
  return 'TERM_LOAN';
}
function mapFreq(t: string, emi: number, emiText: string): string {
  const u = t.toUpperCase();
  if (u === 'CC' || u === 'PLEDGE') return 'NONE';
  if (emiText.toLowerCase().includes('quarterly')) return 'QUARTERLY';
  if (emi > 0) return 'MONTHLY';
  return 'NONE';
}

// Robust date parser: handles "30.11.2019", "2025-12-10 00:00:00", "20.03.24", "10-02-2026", Excel serial
function parseDate(v: any): Date {
  if (v instanceof Date) return v;
  if (typeof v === 'number') {
    // Excel serial date
    return new Date(Math.round((v - 25569) * 86400 * 1000));
  }
  const s = String(v).trim();
  // 2025-12-10 00:00:00 or ISO
  const iso = new Date(s);
  if (!isNaN(iso.getTime()) && s.match(/^\d{4}-\d{2}-\d{2}/)) return iso;
  // dd.mm.yyyy / dd.mm.yy / d.m.yy
  const dot = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (dot) {
    const d = parseInt(dot[1]); const m = parseInt(dot[2]) - 1;
    let y = parseInt(dot[3]); if (y < 100) y += 2000;
    return new Date(Date.UTC(y, m, d));
  }
  // dd-mm-yyyy
  const dash = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dash) {
    const d = parseInt(dash[1]); const m = parseInt(dash[2]) - 1; const y = parseInt(dash[3]);
    return new Date(Date.UTC(y, m, d));
  }
  // American M/D/YYYY or M/D/YY — xlsx reader sometimes emits this
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const mm = parseInt(slash[1]) - 1; const dd = parseInt(slash[2]);
    let y = parseInt(slash[3]); if (y < 100) y += 2000;
    return new Date(Date.UTC(y, mm, dd));
  }
  throw new Error(`Unparseable date: ${s}`);
}

function monthsFromText(s: any): number {
  const m = String(s).match(/(\d+)/);
  return m ? parseInt(m[1]) : 0;
}

function roiToNum(v: any): number {
  if (typeof v === 'number') return v > 1 ? v : v * 100; // 0.1 → 10%
  const s = String(v).replace(/%/g, '').trim();
  const n = parseFloat(s);
  return n > 1 ? n : n * 100;
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + n);
  return r;
}

interface ExcelLoan {
  lender: string; type: string; disbursalDate: Date; sanctioned: number; disbursed: number;
  tenureMonths: number; outstanding: number; emi: number; emiText: string;
  remainingMonths: number; roi: number; security: string;
}

function readExcel(): ExcelLoan[] {
  const wb = XLSX.readFile('/Users/saifraza/Downloads/Debt Schedule 2.xlsx');
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
  const rows: ExcelLoan[] = [];
  for (let i = 3; i < raw.length; i++) {
    const r = raw[i];
    if (!r[0]) continue;
    try {
      const emiText = String(r[7] ?? '').trim();
      const emiNum = parseFloat(emiText.replace(/[^0-9.]/g, '')) || 0;
      rows.push({
        lender: String(r[0]).trim(),
        type: String(r[1]).trim(),
        disbursalDate: parseDate(r[2]),
        sanctioned: Number(r[3]) || 0,
        disbursed: Number(r[4]) || 0,
        tenureMonths: monthsFromText(r[5]),
        outstanding: Number(r[6]) || 0,
        emi: emiNum,
        emiText,
        remainingMonths: monthsFromText(r[8]),
        roi: roiToNum(r[9]),
        security: String(r[10] ?? '').trim(),
      });
    } catch (e) {
      console.error(`Row ${i} skipped: ${e}`);
    }
  }
  return rows;
}

// Build unique loanNo from the lender string (extract account no or slugify)
function makeLoanNo(lender: string): string {
  // Try to extract the account number after the last hyphen or dash
  const m = lender.match(/([A-Z0-9]{6,})\s*$/i);
  if (m) return m[1];
  // Else slugify
  return lender.replace(/[^\w]+/g, '_').replace(/_+/g, '_').substring(0, 40);
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (will write)' : 'DRY RUN'}`);

  // ── 1. Ensure 5999 Opening Balance Equity ──
  let openingBalAcc = await prisma.account.findFirst({ where: { code: '5999' }, select: { id: true } });
  if (!openingBalAcc) {
    console.log('\n[1] Need to create account 5999 Opening Balance Equity');
    if (APPLY) {
      openingBalAcc = await prisma.account.create({
        data: { code: '5999', name: 'Opening Balance Equity', type: 'EQUITY', subType: 'RESERVES', isSystem: true },
        select: { id: true },
      });
      console.log(`    ✓ created (id=${openingBalAcc.id})`);
    } else {
      console.log('    [DRY] would create');
    }
  } else {
    console.log('\n[1] Account 5999 already exists');
  }

  const loansAcc = await prisma.account.findFirst({ where: { code: '2400' }, select: { id: true, name: true } });
  if (!loansAcc) { console.error('ERROR: Account 2400 Loans-Bank missing'); return; }

  // ── 2. Delete 16 test JEs ──
  console.log(`\n[2] Deleting ${TEST_JE_NOS.length} test JEs (entryNos: ${TEST_JE_NOS.join(', ')})`);
  const jesToDelete = await prisma.journalEntry.findMany({
    where: { entryNo: { in: TEST_JE_NOS } },
    select: { id: true, entryNo: true, narration: true },
  });
  for (const je of jesToDelete) {
    console.log(`    ${APPLY ? '✓ deleted' : '[DRY] would delete'} JE #${je.entryNo} — "${je.narration}"`);
    if (APPLY) {
      await prisma.journalLine.deleteMany({ where: { journalId: je.id } });
      await prisma.journalEntry.delete({ where: { id: je.id } });
    }
  }
  if (jesToDelete.length !== TEST_JE_NOS.length) {
    const found = new Set(jesToDelete.map(j => j.entryNo));
    const missing = TEST_JE_NOS.filter(n => !found.has(n));
    console.log(`    ⚠ NOT found: ${missing.join(', ')}  (maybe already deleted)`);
  }

  // ── 3. Import 37 loans ──
  const loans = readExcel();
  console.log(`\n[3] Excel loans read: ${loans.length}`);

  // Dedupe loanNo
  const seenLoanNo = new Set<string>();
  let totalOutstanding = 0;

  for (const L of loans) {
    const loanNo = makeLoanNo(L.lender);
    if (seenLoanNo.has(loanNo)) {
      console.log(`    ⚠ duplicate loanNo "${loanNo}" — skipping ${L.lender}`);
      continue;
    }
    seenLoanNo.add(loanNo);

    // Skip if already exists (idempotent)
    const existing = await prisma.bankLoan.findUnique({ where: { loanNo }, select: { id: true } });
    if (existing) {
      console.log(`    = exists: ${loanNo} (${L.lender}) — skipping`);
      continue;
    }

    const loanType = mapType(L.type);
    const freq = mapFreq(L.type, L.emi, L.emiText);
    const maturity = addMonths(L.disbursalDate, L.tenureMonths);
    totalOutstanding += L.outstanding;

    const bankName = L.lender.split(/\s+-|-A\/c|-|\(|\/|A\/c/)[0].trim();

    console.log(`\n    + ${loanNo}`);
    console.log(`      bank=${bankName} · type=${loanType} · freq=${freq} · roi=${L.roi}%`);
    console.log(`      sanction=₹${L.sanctioned.toLocaleString('en-IN')} · outstanding=₹${L.outstanding.toLocaleString('en-IN')} · emi=₹${L.emi.toLocaleString('en-IN')}`);
    console.log(`      disb=${L.disbursalDate.toISOString().slice(0, 10)} · tenure=${L.tenureMonths}mo · maturity=${maturity.toISOString().slice(0, 10)}`);

    if (!APPLY) continue;

    // Build repayment schedule for MONTHLY/QUARTERLY EMI loans
    const repaymentData: any[] = [];
    if (freq === 'MONTHLY' && L.emi > 0 && L.remainingMonths > 0) {
      let remaining = L.outstanding;
      const today = new Date();
      const monthlyRate = L.roi / 12 / 100;
      // Schedule the REMAINING installments from today forward
      const startDate = addMonths(today, 1);
      startDate.setUTCDate(5); // approx due date 5th of each month
      for (let i = 1; i <= L.remainingMonths; i++) {
        const interest = Math.round(remaining * monthlyRate * 100) / 100;
        const principal = Math.min(remaining, Math.round((L.emi - interest) * 100) / 100);
        remaining = Math.round((remaining - principal) * 100) / 100;
        if (i === L.remainingMonths || remaining < 0) remaining = 0;
        repaymentData.push({
          installmentNo: i,
          dueDate: addMonths(startDate, i - 1),
          principalAmount: principal,
          interestAmount: interest,
          totalAmount: L.emi,
          outstandingAfter: Math.max(remaining, 0),
          status: 'SCHEDULED',
        });
      }
    } else if (freq === 'QUARTERLY' && L.emi > 0 && L.remainingMonths > 0) {
      const qtrs = Math.ceil(L.remainingMonths / 3);
      let remaining = L.outstanding;
      const qtrRate = L.roi / 4 / 100;
      const today = new Date(); today.setUTCDate(5);
      for (let i = 1; i <= qtrs; i++) {
        const interest = Math.round(remaining * qtrRate * 100) / 100;
        const principal = Math.min(remaining, Math.round((L.emi - interest) * 100) / 100);
        remaining = Math.round((remaining - principal) * 100) / 100;
        if (i === qtrs) remaining = 0;
        repaymentData.push({
          installmentNo: i,
          dueDate: addMonths(today, i * 3),
          principalAmount: principal,
          interestAmount: interest,
          totalAmount: L.emi,
          outstandingAfter: Math.max(remaining, 0),
          status: 'SCHEDULED',
        });
      }
    }

    const adminUser = await prisma.user.findFirst({ select: { id: true } });
    if (!adminUser) throw new Error('No user exists');

    await prisma.$transaction(async (tx) => {
      const newLoan = await tx.bankLoan.create({
        data: {
          loanNo,
          bankName,
          bankAccountCode: '1002', // Default to SBI (disbursement went long ago)
          loanType,
          repaymentFrequency: freq,
          sanctionAmount: L.sanctioned,
          disbursedAmount: L.disbursed,
          outstandingAmount: L.outstanding,
          interestRate: L.roi,
          tenure: L.tenureMonths,
          emiAmount: L.emi,
          sanctionDate: L.disbursalDate,
          disbursementDate: L.disbursalDate,
          maturityDate: maturity,
          status: 'ACTIVE',
          securityDetails: L.security || null,
          remarks: `Imported from Debt Schedule 2.xlsx · original lender: ${L.lender}`,
          userId: adminUser.id,
        },
      });

      if (repaymentData.length > 0) {
        await tx.loanRepayment.createMany({
          data: repaymentData.map((r) => ({ ...r, loanId: newLoan.id, userId: adminUser.id })),
        });
      }

      // Opening balance JE: Dr 5999 Opening Balance Equity, Cr 2400 Loans-Bank for CURRENT OS
      if (L.outstanding > 0) {
        await tx.journalEntry.create({
          data: {
            date: L.disbursalDate,
            narration: `Opening balance: ${bankName} · ${loanNo} · O/S ₹${L.outstanding.toLocaleString('en-IN')}`,
            refType: 'LOAN_DISBURSEMENT',
            refId: newLoan.id,
            isAutoGenerated: true,
            userId: adminUser.id,
            lines: {
              create: [
                { accountId: openingBalAcc!.id, debit: L.outstanding, credit: 0, narration: 'Opening balance contra', division: 'COMMON', costCenter: 'HEAD_OFFICE' },
                { accountId: loansAcc.id, debit: 0, credit: L.outstanding, narration: `${bankName} ${loanNo} O/S`, division: 'COMMON', costCenter: 'HEAD_OFFICE' },
              ],
            },
          },
        });
      }
    });
    console.log(`      ✓ loan + ${repaymentData.length} installments + opening-balance JE posted`);
  }

  console.log(`\n[summary]`);
  console.log(`  Loans to import: ${loans.length}`);
  console.log(`  Total O/S (Loans-Bank 2400): ₹${totalOutstanding.toLocaleString('en-IN')}`);
  console.log(`  Contra (Opening Balance Equity 5999, Dr): ₹${totalOutstanding.toLocaleString('en-IN')}`);
  console.log(`\nDone.`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
