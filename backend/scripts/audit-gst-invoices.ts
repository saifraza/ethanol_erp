/**
 * Audit script: find invoices where GST type (CGST+SGST vs IGST) doesn't match
 * what it should be based on the customer's state / GSTIN.
 *
 * Run: npx ts-node scripts/audit-gst-invoices.ts
 *   or: npx tsx scripts/audit-gst-invoices.ts
 *
 * Modes:
 *   --dry-run (default): just report mismatches
 *   --fix: update invoices to correct GST split (amounts change, totals change)
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const FIX = process.argv.includes('--fix');

const COMPANY_STATE = 'Madhya Pradesh';
const COMPANY_STATE_CODE = '23';

const GSTIN_STATE_MAP: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan',
  '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
  '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra & Nagar Haveli', '27': 'Maharashtra',
  '29': 'Karnataka', '30': 'Goa', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '36': 'Telangana', '37': 'Andhra Pradesh',
};

function resolveState(state: string | null, gstin: string | null): string | null {
  if (state) return state;
  if (gstin && gstin.length >= 2) return GSTIN_STATE_MAP[gstin.substring(0, 2)] || null;
  return null;
}

function expectedSupplyType(customerState: string | null, customerGstin: string | null): 'INTRA_STATE' | 'INTER_STATE' | null {
  const resolved = resolveState(customerState, customerGstin);
  if (!resolved) return null; // can't determine
  return resolved.toLowerCase() === COMPANY_STATE.toLowerCase() ? 'INTRA_STATE' : 'INTER_STATE';
}

async function main() {
  console.log(`\n=== GST Invoice Audit (${FIX ? 'FIX MODE' : 'DRY RUN'}) ===\n`);

  const invoices = await prisma.invoice.findMany({
    where: { status: { not: 'CANCELLED' } },
    select: {
      id: true, invoiceNo: true, invoiceDate: true,
      productName: true, amount: true, gstPercent: true, gstAmount: true,
      supplyType: true,
      cgstPercent: true, cgstAmount: true,
      sgstPercent: true, sgstAmount: true,
      igstPercent: true, igstAmount: true,
      totalAmount: true, balanceAmount: true, paidAmount: true,
      irn: true, irnStatus: true,
      customer: { select: { id: true, name: true, state: true, gstNo: true } },
    },
    orderBy: { invoiceDate: 'desc' },
  });

  let wrongType = 0;
  let noGst = 0;
  let fixed = 0;
  let skippedIrn = 0;
  const issues: string[] = [];

  for (const inv of invoices) {
    const custState = inv.customer?.state || null;
    const custGstin = inv.customer?.gstNo || null;
    const expected = expectedSupplyType(custState, custGstin);

    // Check 1: No GST at all (gstPercent=0 or null, but product should have GST)
    if (!inv.gstPercent || inv.gstPercent === 0) {
      noGst++;
      issues.push(`NO_GST  ${inv.invoiceNo || inv.id}  ${inv.invoiceDate?.toISOString().slice(0,10)}  ${inv.productName}  customer=${inv.customer?.name}  amt=₹${inv.amount}`);
      continue;
    }

    // Check 2: Wrong supply type
    if (expected && inv.supplyType !== expected) {
      wrongType++;
      const line = `WRONG   ${inv.invoiceNo || inv.id}  ${inv.invoiceDate?.toISOString().slice(0,10)}  ${inv.productName}  customer=${inv.customer?.name}(${custState || custGstin || '?'})  stored=${inv.supplyType}  expected=${expected}  amt=₹${inv.amount}  gst=₹${inv.gstAmount}`;
      issues.push(line);

      if (FIX) {
        // Don't fix if IRN is generated
        if (inv.irn || inv.irnStatus === 'GENERATED') {
          skippedIrn++;
          issues.push(`  SKIP (IRN generated — needs credit note)`);
          continue;
        }

        const gstAmount = inv.gstAmount || 0;
        if (expected === 'INTRA_STATE') {
          const half = Math.round(gstAmount / 2 * 100) / 100;
          await prisma.invoice.update({
            where: { id: inv.id },
            data: {
              supplyType: 'INTRA_STATE',
              cgstPercent: (inv.gstPercent || 0) / 2,
              cgstAmount: half,
              sgstPercent: (inv.gstPercent || 0) / 2,
              sgstAmount: Math.round((gstAmount - half) * 100) / 100,
              igstPercent: 0,
              igstAmount: 0,
            },
          });
        } else {
          await prisma.invoice.update({
            where: { id: inv.id },
            data: {
              supplyType: 'INTER_STATE',
              cgstPercent: 0,
              cgstAmount: 0,
              sgstPercent: 0,
              sgstAmount: 0,
              igstPercent: inv.gstPercent || 0,
              igstAmount: gstAmount,
            },
          });
        }
        fixed++;
        issues.push(`  FIXED → ${expected}`);
      }
      continue;
    }

    // Check 3: Supply type correct but amounts are zero (GST fields never populated)
    if (inv.supplyType === 'INTRA_STATE' && inv.gstAmount && inv.gstAmount > 0 && (!inv.cgstAmount || inv.cgstAmount === 0)) {
      wrongType++;
      issues.push(`EMPTY   ${inv.invoiceNo || inv.id}  ${inv.invoiceDate?.toISOString().slice(0,10)}  supplyType=INTRA but cgst/sgst=0  gstAmt=₹${inv.gstAmount}`);

      if (FIX && !(inv.irn || inv.irnStatus === 'GENERATED')) {
        const half = Math.round(inv.gstAmount / 2 * 100) / 100;
        await prisma.invoice.update({
          where: { id: inv.id },
          data: {
            cgstPercent: (inv.gstPercent || 0) / 2,
            cgstAmount: half,
            sgstPercent: (inv.gstPercent || 0) / 2,
            sgstAmount: Math.round((inv.gstAmount - half) * 100) / 100,
          },
        });
        fixed++;
        issues.push(`  FIXED — populated cgst/sgst from gstAmount`);
      }
    }

    if (inv.supplyType === 'INTER_STATE' && inv.gstAmount && inv.gstAmount > 0 && (!inv.igstAmount || inv.igstAmount === 0)) {
      wrongType++;
      issues.push(`EMPTY   ${inv.invoiceNo || inv.id}  ${inv.invoiceDate?.toISOString().slice(0,10)}  supplyType=INTER but igst=0  gstAmt=₹${inv.gstAmount}`);

      if (FIX && !(inv.irn || inv.irnStatus === 'GENERATED')) {
        await prisma.invoice.update({
          where: { id: inv.id },
          data: {
            igstPercent: inv.gstPercent || 0,
            igstAmount: inv.gstAmount,
            cgstPercent: 0, cgstAmount: 0, sgstPercent: 0, sgstAmount: 0,
          },
        });
        fixed++;
        issues.push(`  FIXED — populated igst from gstAmount`);
      }
    }
  }

  console.log(issues.join('\n'));
  console.log(`\n--- Summary ---`);
  console.log(`Total invoices: ${invoices.length}`);
  console.log(`Wrong supply type: ${wrongType}`);
  console.log(`No GST at all: ${noGst}`);
  if (FIX) {
    console.log(`Fixed: ${fixed}`);
    console.log(`Skipped (IRN): ${skippedIrn}`);
  }
  console.log();

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
