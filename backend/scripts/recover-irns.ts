/**
 * One-off recovery: for invoices where IRN was wiped (null) but the e-invoice
 * was genuinely filed on the portal, call generateIRN — the portal will return
 * "duplicate" and the service auto-recovers the existing IRN hash.
 *
 * Usage:
 *   npx tsx scripts/recover-irns.ts           # dry-run (lists only)
 *   npx tsx scripts/recover-irns.ts --apply   # actually recover
 *
 * Safety:
 *  - Targets only MASH BIO-FUELS invoices where irn IS NULL and status != CANCELLED
 *  - Processes sequentially (no parallel calls → no portal rate-limit issues)
 *  - Logs each response before writing to DB
 *  - If portal returns a new IRN (no existing on portal), writes that back
 *    (legit outcome — means invoice wasn't on portal, now it is, with correct IGST)
 */
import 'dotenv/config';
import prisma from '../src/config/prisma';
import { generateIRN } from '../src/services/eInvoice';

const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(`=== IRN Recovery ${APPLY ? '(APPLY MODE)' : '(DRY RUN)'} ===\n`);

  // ETHANOL ONLY — DDGS invoices are handled manually by the user on the portal.
  const invoices = await prisma.invoice.findMany({
    where: {
      customer: { name: { contains: 'MASH' } },
      irn: null,
      status: { not: 'CANCELLED' },
      productName: { contains: 'Ethanol', mode: 'insensitive' },
    },
    include: { customer: true },
    orderBy: { invoiceDate: 'asc' },
  });

  console.log(`Found ${invoices.length} invoices with no IRN — will attempt recovery:\n`);
  for (const inv of invoices) {
    console.log(`  ${(inv.remarks || `INV-${inv.invoiceNo}`).padEnd(15)}  ${inv.invoiceDate.toISOString().slice(0,10)}  ${(inv as any).productName?.slice(0,40)}  ₹${(inv as any).totalAmount}`);
  }
  console.log('');

  if (!APPLY) {
    console.log('Dry run — no changes made. Re-run with --apply to execute.');
    return;
  }

  let recovered = 0, freshGenerated = 0, failed = 0;
  for (const inv of invoices) {
    const customer = inv.customer;
    if (!customer) { failed++; console.log(`SKIP  ${inv.remarks}  — no customer`); continue; }

    const invLabel = inv.remarks || `INV-${inv.invoiceNo}`;

    // Build the payload exactly like POST /:id/e-invoice does
    const invoiceData = {
      invoiceNo: inv.remarks || `INV-${inv.invoiceNo}`,
      invoiceDate: inv.invoiceDate,
      productName: inv.productName,
      quantity: inv.quantity,
      unit: inv.unit,
      rate: inv.rate,
      amount: inv.amount,
      gstPercent: inv.gstPercent,
      customer: {
        gstin: customer.gstNo || '',
        name: customer.name,
        address: customer.address || '',
        city: (customer as any).city || '',
        pincode: customer.pincode || '',
        state: customer.state || '',
        phone: customer.phone || '',
        email: customer.email || '',
      },
    };

    try {
      console.log(`\n[${invLabel}] calling portal...`);
      const result = await generateIRN(invoiceData, 0, inv.companyId || undefined);

      if (!result.success) {
        failed++;
        console.log(`  FAIL  ${result.error}`);
        continue;
      }

      const recoveredFromDuplicate = !!result.rawResponse?.ErrorDetails || !!result.rawResponse?.errorDetails;

      await prisma.invoice.update({
        where: { id: inv.id },
        data: {
          irn: result.irn,
          irnDate: new Date(),
          irnStatus: 'GENERATED',
          ackNo: result.ackNo ? String(result.ackNo) : null,
          signedQRCode: result.signedQRCode ? result.signedQRCode.slice(0, 4000) : null,
        } as any,
      });

      if (recoveredFromDuplicate) {
        recovered++;
        console.log(`  RECOVERED  ${result.irn?.slice(0,16)}...  (original IRN from portal)`);
      } else {
        freshGenerated++;
        console.log(`  NEW IRN    ${result.irn?.slice(0,16)}...  (fresh — invoice was not on portal)`);
      }

      // Small delay to avoid portal rate limits
      await new Promise(r => setTimeout(r, 500));
    } catch (err: any) {
      failed++;
      console.log(`  ERROR  ${err.message}`);
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Recovered (existing portal IRN): ${recovered}`);
  console.log(`Fresh IRN (not on portal before): ${freshGenerated}`);
  console.log(`Failed: ${failed}`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
