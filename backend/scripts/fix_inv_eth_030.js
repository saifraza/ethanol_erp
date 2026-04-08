// One-off fix for INV/ETH/030 (lifting d8b43e69-c9ba-4a92-83e5-f658109bf823)
// Re-rates the lifting from ₹60/BL → ₹2.689/BL (job work conversion charge)
// Cascades to invoice, dispatch truck, contract totals, and reverses+reposts journal entry.
// Safe because IRN=null and paidAmount=0 (verified).
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const LIFTING_ID = 'd8b43e69-c9ba-4a92-83e5-f658109bf823';
const NEW_RATE = 2.689;
const COMPANY_STATE = 'Madhya Pradesh';

function calcGstSplit(amount, gstPercent, customerState) {
  const gstAmount = Math.round((amount * gstPercent) / 100 * 100) / 100;
  const isInterstate = customerState && customerState !== COMPANY_STATE;
  if (isInterstate) {
    return { supplyType: 'INTER_STATE', cgstPercent: 0, cgstAmount: 0, sgstPercent: 0, sgstAmount: 0, igstPercent: gstPercent, igstAmount: gstAmount, gstAmount };
  }
  const half = Math.round(gstAmount / 2 * 100) / 100;
  return { supplyType: 'INTRA_STATE', cgstPercent: gstPercent / 2, cgstAmount: half, sgstPercent: gstPercent / 2, sgstAmount: Math.round((gstAmount - half) * 100) / 100, igstPercent: 0, igstAmount: 0, gstAmount };
}

(async () => {
  const lifting = await p.ethanolLifting.findUnique({
    where: { id: LIFTING_ID },
    include: { contract: true, invoice: { include: { customer: { select: { state: true } } } } },
  });
  if (!lifting) throw new Error('Lifting not found');
  if (!lifting.invoice) throw new Error('No invoice linked');

  const inv = lifting.invoice;
  console.log('BEFORE:');
  console.log(`  Lifting rate=${lifting.rate}, amount=${lifting.amount}`);
  console.log(`  Invoice ${inv.invoiceNo}: rate=${inv.rate}, amount=${inv.amount}, gst=${inv.gstAmount}, total=${inv.totalAmount}`);
  console.log(`  IRN=${inv.irn}, paid=${inv.paidAmount}`);

  if (inv.irn || inv.irnStatus === 'GENERATED') throw new Error('IRN already generated — abort, use credit note');
  if ((inv.paidAmount || 0) > 0) throw new Error('Payment received — abort, use credit note');

  const qtyBL = lifting.quantityBL;
  const newAmount = Math.round(qtyBL * NEW_RATE * 100) / 100;
  const gstPercent = inv.gstPercent || lifting.contract.gstPercent || 18;
  const gst = calcGstSplit(newAmount, gstPercent, inv.customer?.state);
  const newTotal = Math.round((newAmount + gst.gstAmount) * 100) / 100;

  console.log('\nAFTER (preview):');
  console.log(`  rate=${NEW_RATE}, amount=${newAmount}, gst=${gst.gstAmount}, total=${newTotal}`);
  console.log(`  cgst=${gst.cgstAmount}, sgst=${gst.sgstAmount}, igst=${gst.igstAmount}, supplyType=${gst.supplyType}`);

  await p.$transaction(async (tx) => {
    // (Railway latency — bump to 30s)
    await tx.invoice.update({
      where: { id: inv.id },
      data: {
        rate: NEW_RATE,
        amount: newAmount,
        gstAmount: gst.gstAmount,
        cgstPercent: gst.cgstPercent,
        cgstAmount: gst.cgstAmount,
        sgstPercent: gst.sgstPercent,
        sgstAmount: gst.sgstAmount,
        igstPercent: gst.igstPercent,
        igstAmount: gst.igstAmount,
        supplyType: gst.supplyType,
        totalAmount: newTotal,
        balanceAmount: newTotal,
      },
    });

    await tx.ethanolLifting.update({
      where: { id: LIFTING_ID },
      data: { rate: NEW_RATE, amount: newAmount },
    });

    await tx.dispatchTruck.updateMany({
      where: { liftingId: LIFTING_ID },
      data: { productRatePerLtr: NEW_RATE, productValue: newAmount },
    });

    const reversed = await tx.journalEntry.updateMany({
      where: { refType: 'SALE', refId: inv.id, isReversed: false },
      data: { isReversed: true },
    });
    console.log(`\n  Reversed ${reversed.count} old journal entries`);

    const liftings = await tx.ethanolLifting.findMany({
      where: { contractId: lifting.contractId },
      select: { quantityKL: true, amount: true },
    });
    const totalKL = liftings.reduce((s, l) => s + (l.quantityKL || 0), 0);
    const totalAmt = liftings.reduce((s, l) => s + (l.amount || 0), 0);
    await tx.ethanolContract.update({
      where: { id: lifting.contractId },
      data: { totalSuppliedKL: totalKL, totalInvoicedAmt: totalAmt },
    });
    console.log(`  Contract totals: ${totalKL} KL, ₹${totalAmt}`);
  }, { timeout: 30000, maxWait: 10000 });

  // Post new journal entry — duplicated here from autoJournal.ts to avoid TS import in plain JS
  // Use raw insert via Prisma using the same account codes
  const ACCT_TRADE_RECEIVABLE = '1100';
  const ACCT_SALES_ETH = '3001';
  const ACCT_GST_CGST = '2100';
  const ACCT_GST_SGST = '2101';
  const ACCT_GST_IGST = '2102';

  // Look up by name as fallback if codes differ
  const codes = [ACCT_TRADE_RECEIVABLE, ACCT_SALES_ETH, ACCT_GST_CGST, ACCT_GST_SGST, ACCT_GST_IGST];
  const accts = await p.account.findMany({ where: { code: { in: codes } }, select: { id: true, code: true, name: true } });
  const byCode = Object.fromEntries(accts.map(a => [a.code, a]));
  console.log('\n  Accounts found:', accts.map(a => `${a.code}=${a.name}`).join(', '));

  const isInterstate = gst.supplyType === 'INTER_STATE';
  const lines = [
    { code: ACCT_TRADE_RECEIVABLE, debit: newTotal, credit: 0, narration: `INV-${inv.invoiceNo}` },
    { code: ACCT_SALES_ETH, debit: 0, credit: newAmount, narration: `${inv.productName} sale (re-rated)` },
  ];
  if (isInterstate) {
    lines.push({ code: ACCT_GST_IGST, debit: 0, credit: gst.igstAmount, narration: `IGST @${gstPercent}%` });
  } else {
    lines.push({ code: ACCT_GST_CGST, debit: 0, credit: gst.cgstAmount, narration: `CGST @${gstPercent / 2}%` });
    lines.push({ code: ACCT_GST_SGST, debit: 0, credit: gst.sgstAmount, narration: `SGST @${gstPercent / 2}%` });
  }

  for (const l of lines) {
    if (!byCode[l.code]) {
      console.warn(`  ⚠ Account ${l.code} not found — journal will NOT be created. Re-run via API after Railway deploy: PATCH /api/ethanol-contracts/liftings/${LIFTING_ID}/rate`);
      await p.$disconnect();
      return;
    }
  }

  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(`Unbalanced journal: D=${totalDebit} C=${totalCredit}`);
  }

  await p.journalEntry.create({
    data: {
      date: inv.invoiceDate,
      narration: `Sale Invoice INV-${inv.invoiceNo} — ${inv.productName} (re-rated from ₹60 → ₹${NEW_RATE})`,
      refType: 'SALE',
      refId: inv.id,
      isAutoGenerated: true,
      userId: 'system',
      lines: {
        create: lines.map(l => ({
          accountId: byCode[l.code].id,
          debit: Math.round(l.debit * 100) / 100,
          credit: Math.round(l.credit * 100) / 100,
          narration: l.narration,
          costCenter: 'DISTILLERY',
          division: 'DISTILLERY',
        })),
      },
    },
  });
  console.log('\n  ✅ New journal entry posted');

  console.log('\nDONE.');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('FAILED:', e);
  await p.$disconnect();
  process.exit(1);
});
