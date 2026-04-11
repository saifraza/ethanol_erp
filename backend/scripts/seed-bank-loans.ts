import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface RawLoan {
  name: string;
  type: string;
  disbursalDate: string;
  sanctioned: number;
  disbursed: number;
  tenure: number; // months
  outstanding: number;
  emi: number;
  remainingTenure: number;
  roi: number; // annual %
  collateral: string;
  security: string;
  comments: string;
}

function parseDate(s: string): Date {
  if (!s) return new Date();
  // yyyy-mm-dd HH:mm:ss
  if (s.match(/^\d{4}-\d{2}-\d{2}/)) return new Date(s);
  // dd-mm-yyyy or dd.mm.yyyy or dd.mm.yy
  const parts = s.split(/[.\-\/]/);
  if (parts.length === 3) {
    let [d, m, y] = parts.map(Number);
    if (y < 100) y += 2000;
    return new Date(y, m - 1, d);
  }
  return new Date(s);
}

function mapType(t: string): string {
  const u = t.toUpperCase().trim();
  if (u === 'CC') return 'CC_LIMIT';
  if (u === 'TL') return 'TERM_LOAN';
  if (u === 'AUTO' || u === 'ATUO') return 'EQUIPMENT';
  if (u === 'BUSINESS') return 'WORKING_CAPITAL';
  if (u === 'LAP') return 'TERM_LOAN';
  if (u === 'PLEDGE') return 'WORKING_CAPITAL';
  return 'TERM_LOAN';
}

function extractLoanNo(name: string): string {
  // Try to extract account/loan number from the name
  const patterns = [
    /A\/[cC]\s*(\S+)/,           // A/c 325605010050376
    /No\.\s*(\S+)/,              // No. 109226520000078
    /-([A-Z0-9_]+)$/,            // -MAD0009073891
    /(\d{10,})/,                 // long number
    /([A-Z]{3}\d{10,})/,         // ALN011901488366
    /(\d+-\d+-\d+)/,             // 1-35367141
  ];
  for (const p of patterns) {
    const m = name.match(p);
    if (m) return m[1].replace(/^-/, '');
  }
  // Fallback: use first 30 chars
  return name.slice(0, 40).trim();
}

function extractBankName(name: string): string {
  // Extract bank/lender name (before account number)
  const banks: Record<string, string> = {
    'UBI': 'Union Bank of India',
    'UNION BANK': 'Union Bank of India',
    'AU SMALL': 'AU Small Finance Bank',
    'ICICI': 'ICICI Bank',
    'TOYOTA': 'Toyota Financial Services',
    'YES BANK': 'Yes Bank',
    'ADITYA BIRLA': 'Aditya Birla Finance',
    'BAJAJ': 'Bajaj Finance',
    'HERO FINCORP': 'Hero Fincorp',
    'IDFC': 'IDFC First Bank',
    'KISETSU': 'Kisetsu Saison Finance',
    'KOTAK': 'Kotak Mahindra Bank',
    'POONAWALLA': 'Poonawalla Fincorp',
    'TCFSL': 'Tata Capital Financial Services',
    'HDB': 'HDB Financial Services',
    'IREDA': 'IREDA',
    'AXIS': 'Axis Bank',
  };
  const upper = name.toUpperCase();
  for (const [key, val] of Object.entries(banks)) {
    if (upper.includes(key)) return val;
  }
  return name.split(/[-(/]/)[0].trim();
}

// All 37 loans from the Excel
const loans: RawLoan[] = [
  // CC
  { name: 'UBI CC 2 CR- A/c 325605010050376', type: 'CC', disbursalDate: '30.11.2019', sanctioned: 315000000, disbursed: 315000000, tenure: 12, outstanding: 314925267, emi: 0, remainingTenure: 0, roi: 10.6, collateral: 'STOCK', security: '', comments: '' },
  { name: 'UBI CC 3 CR A/c 325605010050377', type: 'CC', disbursalDate: '30.11.2019', sanctioned: 30000000, disbursed: 30000000, tenure: 12, outstanding: 29952115, emi: 0, remainingTenure: 0, roi: 10.6, collateral: 'STOCK', security: '', comments: '' },

  // AUTO/ATUO
  { name: 'AU SMALL FINANCE BANK FORCE TOOFAN-MAD0009073891', type: 'AUTO', disbursalDate: '2025-12-10', sanctioned: 1040000, disbursed: 1022308, tenure: 36, outstanding: 947501, emi: 34792, remainingTenure: 34, roi: 9.1, collateral: 'CAR', security: '', comments: '' },
  { name: 'AU SMALL FINANCE BANK URBANIA-9001010154721026', type: 'AUTO', disbursalDate: '10.02.2026', sanctioned: 2700000, disbursed: 2656078, tenure: 48, outstanding: 2623020, emi: 72434, remainingTenure: 48, roi: 9.1, collateral: 'CAR', security: '', comments: '' },
  { name: 'ICICI BANK (DUMPER LOAN1)', type: 'AUTO', disbursalDate: '2024-03-07', sanctioned: 4950000, disbursed: 4938436, tenure: 60, outstanding: 3183171, emi: 105231, remainingTenure: 40, roi: 10, collateral: 'DUMPER', security: '', comments: '' },
  { name: 'ICICI BANK (DUMPER LOAN-2)', type: 'AUTO', disbursalDate: '2024-03-07', sanctioned: 4950000, disbursed: 4937669, tenure: 60, outstanding: 3183171, emi: 105231, remainingTenure: 40, roi: 10, collateral: 'DUMPER', security: '', comments: '' },
  { name: 'TOYOTA FINANCIAL SERVICES INDIA LIMITED N Fortuner', type: 'AUTO', disbursalDate: '20.03.24', sanctioned: 5735717, disbursed: 5735717, tenure: 60, outstanding: 3635925, emi: 118902, remainingTenure: 36, roi: 8.96, collateral: 'CAR', security: '', comments: '' },
  { name: 'Toyota Financial Services India Ltd (Camry)', type: 'AUTO', disbursalDate: '20.1.24', sanctioned: 4515350, disbursed: 4515350, tenure: 48, outstanding: 2722674.3, emi: 93604, remainingTenure: 24, roi: 8.96, collateral: 'CAR', security: '', comments: '' },
  { name: 'UNION BANK OF INDIA BOLERO-109226520000124', type: 'AUTO', disbursalDate: '26.01.2026', sanctioned: 850000, disbursed: 850000, tenure: 36, outstanding: 786473, emi: 26655, remainingTenure: 24, roi: 8.05, collateral: 'CAR', security: '', comments: '' },
  { name: 'UBI CAR LOAN IGNIS UBI A/C 109226520000083', type: 'AUTO', disbursalDate: '4.11.24', sanctioned: 745000, disbursed: 745000, tenure: 36, outstanding: 413006, emi: 23691, remainingTenure: 20, roi: 8.5, collateral: 'CAR', security: '', comments: '' },
  { name: 'UBI CAR LOAN KIA-109226520000089', type: 'AUTO', disbursalDate: '17.3.25', sanctioned: 6500000, disbursed: 6500000, tenure: 36, outstanding: 4306270, emi: 205943, remainingTenure: 24, roi: 8.75, collateral: 'CAR', security: '', comments: '' },
  { name: 'UBI CAR LOAN No. 109226520000078', type: 'AUTO', disbursalDate: '3.10.24', sanctioned: 820000, disbursed: 820000, tenure: 36, outstanding: 385976.8, emi: 26050, remainingTenure: 19, roi: 8.9, collateral: 'CAR', security: '', comments: '' },
  { name: 'UBI CAR LOAN No. 109226520000079', type: 'AUTO', disbursalDate: '3.10.24', sanctioned: 820000, disbursed: 820000, tenure: 36, outstanding: 385976.8, emi: 26050, remainingTenure: 19, roi: 8.9, collateral: 'CAR', security: '', comments: '' },
  { name: 'UBI CAR LOAN No. 109226520000080', type: 'AUTO', disbursalDate: '3.10.24', sanctioned: 820000, disbursed: 820000, tenure: 36, outstanding: 405056.8, emi: 26050, remainingTenure: 19, roi: 8.9, collateral: 'CAR', security: '', comments: '' },
  { name: 'UBI Car Loan No. SAFARI- 109226520000098', type: 'AUTO', disbursalDate: '17.06.2025', sanctioned: 2000000, disbursed: 2000000, tenure: 36, outstanding: 1486505, emi: 63136, remainingTenure: 27, roi: 8.5, collateral: 'CAR', security: '', comments: '' },
  { name: 'YES BANK HYRYDER- ALN011901488366', type: 'AUTO', disbursalDate: '15.03.2023', sanctioned: 1767285, disbursed: 1743356, tenure: 84, outstanding: 471291, emi: 45130, remainingTenure: 48, roi: 10.51, collateral: 'CAR', security: '', comments: '' },
  { name: 'Yes Bank NEXON- ALN011901688538', type: 'AUTO', disbursalDate: '15.9.23', sanctioned: 1866154, disbursed: 1837416, tenure: 84, outstanding: 1328171, emi: 31611, remainingTenure: 56, roi: 10.79, collateral: 'CAR', security: '', comments: '' },
  { name: 'YES BANK XUV 700 -ALN011901289628', type: 'AUTO', disbursalDate: '15.09.2022', sanctioned: 1220000, disbursed: 1220000, tenure: 48, outstanding: 150910, emi: 30960, remainingTenure: 8, roi: 10.25, collateral: 'CAR', security: '', comments: '' },

  // BUSINESS
  { name: 'Aditya Birla Finance Ltd.-ABW_BBIL000000942294', type: 'BUSINESS', disbursalDate: '02.09.2025', sanctioned: 3000000, disbursed: 3000000, tenure: 12, outstanding: 1313608, emi: 274327, remainingTenure: 6, roi: 17.5, collateral: 'UNSECURED', security: '', comments: '' },
  { name: 'Bajaj Finance Limited-P430PPS9814495', type: 'BUSINESS', disbursalDate: '2024-01-02', sanctioned: 3479607, disbursed: 3358526, tenure: 36, outstanding: 1060072, emi: 126797, remainingTenure: 11, roi: 18, collateral: 'UNSECURED', security: '', comments: '' },
  { name: 'Hero Fincorp Limited (Bl)-HCFIDJUBL00017869824', type: 'BUSINESS', disbursalDate: '03.09.2025', sanctioned: 4047200, disbursed: 3890463, tenure: 36, outstanding: 3399430, emi: 141291, remainingTenure: 30, roi: 15.5, collateral: 'UNSECURED', security: '', comments: '' },
  { name: 'ICICI BANK BI UPNRS00051321391', type: 'BUSINESS', disbursalDate: '2025-09-05', sanctioned: 9500000, disbursed: 9450690, tenure: 36, outstanding: 8038224, emi: 336070, remainingTenure: 30, roi: 16, collateral: 'UNSECURED', security: '', comments: '' },
  { name: 'IDFC First Bank Business Loan 165593891', type: 'BUSINESS', disbursalDate: '3.2.25', sanctioned: 4960000, disbursed: 4854946, tenure: 36, outstanding: 3305954.13, emi: 174379, remainingTenure: 23, roi: 16, collateral: 'UNSECURED', security: '', comments: '' },
  { name: 'KISETSU SAISON FINANCE INDIA PVT LTD 10800087', type: 'BUSINESS', disbursalDate: '3.10.24', sanctioned: 5000000, disbursed: 4868902, tenure: 36, outstanding: 2796605, emi: 175786, remainingTenure: 19, roi: 16, collateral: 'UNSECURED', security: '', comments: '' },
  { name: 'Kotak Mahindra Bank Ltd Bl CSG-155327787', type: 'BUSINESS', disbursalDate: '10.09.2024', sanctioned: 7500000, disbursed: 7252601, tenure: 24, outstanding: 2109705, emi: 369018, remainingTenure: 8, roi: 16, collateral: 'UNSECURED', security: '', comments: '' },
  { name: 'POONAWALLA FINCORP LIMITED-BLU0197BL_000019355149', type: 'BUSINESS', disbursalDate: '30.07.2025', sanctioned: 5043956, disbursed: 4993357, tenure: 36, outstanding: 4241893, emi: 177331, remainingTenure: 28, roi: 16, collateral: 'UNSECURED', security: '', comments: '' },
  { name: 'TCFSL-TCFBL0280000014002991', type: 'BUSINESS', disbursalDate: '03.10.2025', sanctioned: 5000000, disbursed: 4844805, tenure: 24, outstanding: 3923727, emi: 246012, remainingTenure: 19, roi: 16.5, collateral: 'UNSECURED', security: '', comments: '' },
  { name: 'YES BANK Ltd BL- BLN011901701999', type: 'BUSINESS', disbursalDate: '5.10.23', sanctioned: 5000000, disbursed: 4854153, tenure: 36, outstanding: 977829, emi: 175785, remainingTenure: 7, roi: 16, collateral: 'UNSECURED', security: '', comments: '' },

  // LAP
  { name: 'Bajaj Finance Limited Bpl-P430PLA15366808', type: 'LAP', disbursalDate: '14.11.2024', sanctioned: 44325400, disbursed: 43694000, tenure: 120, outstanding: 40866036, emi: 580289, remainingTenure: 104, roi: 9.7, collateral: 'ABC MALL', security: '', comments: '' },
  { name: 'Hdb Financial Services Ltd-1-35367141', type: 'LAP', disbursalDate: '2023-10-04', sanctioned: 2940000, disbursed: 2905090, tenure: 36, outstanding: 18176954, emi: 94177, remainingTenure: 4, roi: 9.25, collateral: 'BUNGALOW SINGARCHOLI', security: '', comments: '' },
  { name: 'Hdb Financial Services Ltd-2-37287031', type: 'LAP', disbursalDate: '2023-09-04', sanctioned: 22050000, disbursed: 21762486, tenure: 120, outstanding: 549730.39, emi: 285340, remainingTenure: 86, roi: 9.5, collateral: 'BUNGALOW SINGARCHOLI', security: '', comments: '' },

  // TL
  { name: 'UBI TL- A/c No. 325606990000172', type: 'TL', disbursalDate: '31.12.2023', sanctioned: 137200000, disbursed: 137200000, tenure: 36, outstanding: 30488888, emi: 3811111, remainingTenure: 10, roi: 11.1, collateral: 'PLANT & MACHINERY & 21 ACRE LAND', security: '', comments: '' },
  { name: 'UBI TL- A/c No. 788306390000005', type: 'TL', disbursalDate: '20.02.2025', sanctioned: 360000000, disbursed: 360000000, tenure: 96, outstanding: 360000000, emi: 3956044, remainingTenure: 83, roi: 11.1, collateral: '', security: '', comments: '' },
  { name: 'UBI TL-III (42CR) 325606390042131', type: 'TL', disbursalDate: '30.11.2019', sanctioned: 420000000, disbursed: 420000000, tenure: 84, outstanding: 0, emi: 20000000, remainingTenure: 1, roi: 11.1, collateral: '', security: '', comments: '' },
  { name: 'IREDA TL', type: 'TL', disbursalDate: '27.02.2024', sanctioned: 1640000000, disbursed: 1640000000, tenure: 84, outstanding: 1619995971, emi: 63076923, remainingTenure: 59, roi: 12.5, collateral: 'ETHANOL PLANT AND MACHINERY AND 51% SHARE OF MSPIL', security: '', comments: '' },

  // PLEDGE
  { name: 'Axis Bank Ware House Loan', type: 'PLEDGE', disbursalDate: '2025-11-15', sanctioned: 225400000, disbursed: 225400000, tenure: 12, outstanding: 162553892.25, emi: 0, remainingTenure: 0, roi: 12.3, collateral: 'STOCK', security: '', comments: '' },
  { name: 'UBI Ware House A/c 325605050000104', type: 'PLEDGE', disbursalDate: '18.03.2024', sanctioned: 200000000, disbursed: 200000000, tenure: 12, outstanding: 149109722.36, emi: 0, remainingTenure: 0, roi: 10.5, collateral: 'STOCK', security: '', comments: '' },
];

async function main() {
  // Get admin user
  const admin = await prisma.user.findFirst({ where: { email: 'admin@distillery.com' } });
  if (!admin) throw new Error('Admin user not found');

  // Check existing loans
  const existing = await prisma.bankLoan.count();
  if (existing > 0) {
    console.log(`Already ${existing} loans in DB. Skipping seed to avoid duplicates.`);
    console.log('Delete existing loans first if you want to re-seed.');
    return;
  }

  let inserted = 0;
  for (const loan of loans) {
    const disbDate = parseDate(loan.disbursalDate);
    const maturityDate = new Date(disbDate);
    maturityDate.setMonth(maturityDate.getMonth() + loan.tenure);

    const loanNo = extractLoanNo(loan.name);
    const bankName = extractBankName(loan.name);
    const loanType = mapType(loan.type);
    const status = loan.outstanding === 0 ? 'CLOSED' : 'ACTIVE';

    // Build security/collateral string
    const secParts = [loan.collateral, loan.security].filter(Boolean);
    const securityDetails = secParts.length > 0 ? secParts.join('; ') : null;

    // Remarks: original full name for reference
    const remarks = `Imported from Debt Schedule. Original: ${loan.name}. Type: ${loan.type}`;

    try {
      await prisma.bankLoan.create({
        data: {
          loanNo,
          bankName,
          loanType,
          sanctionAmount: loan.sanctioned,
          disbursedAmount: loan.disbursed,
          outstandingAmount: loan.outstanding,
          interestRate: loan.roi,
          tenure: loan.tenure,
          emiAmount: loan.emi,
          sanctionDate: disbDate,
          disbursementDate: disbDate,
          maturityDate,
          status,
          securityDetails,
          remarks,
          userId: admin.id,
        },
      });
      inserted++;
      console.log(`✓ ${bankName} — ${loanType} — ₹${(loan.outstanding / 10000000).toFixed(2)} Cr`);
    } catch (err: any) {
      // Handle duplicate loanNo
      if (err.code === 'P2002') {
        const uniqueNo = `${loanNo}-${inserted}`;
        await prisma.bankLoan.create({
          data: {
            loanNo: uniqueNo,
            bankName,
            loanType,
            sanctionAmount: loan.sanctioned,
            disbursedAmount: loan.disbursed,
            outstandingAmount: loan.outstanding,
            interestRate: loan.roi,
            tenure: loan.tenure,
            emiAmount: loan.emi,
            sanctionDate: disbDate,
            disbursementDate: disbDate,
            maturityDate,
            status,
            securityDetails,
            remarks,
            userId: admin.id,
          },
        });
        inserted++;
        console.log(`✓ ${bankName} — ${loanType} — ₹${(loan.outstanding / 10000000).toFixed(2)} Cr (loanNo: ${uniqueNo})`);
      } else {
        console.error(`✗ Failed: ${loan.name}`, err.message);
      }
    }
  }

  console.log(`\nDone. Inserted ${inserted}/${loans.length} loans.`);

  // Summary
  const summary = await prisma.bankLoan.aggregate({
    _sum: { outstandingAmount: true, sanctionAmount: true },
    _count: true,
  });
  console.log(`Total loans: ${summary._count}`);
  console.log(`Total sanctioned: ₹${((summary._sum.sanctionAmount ?? 0) / 10000000).toFixed(2)} Cr`);
  console.log(`Total outstanding: ₹${((summary._sum.outstandingAmount ?? 0) / 10000000).toFixed(2)} Cr`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
