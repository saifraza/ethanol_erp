/**
 * Back-fill missing journal entries for:
 *   1. Sale invoices with tcsAmount > 0 that failed to journal (unbalanced → silently dropped)
 *   2. Vendor invoices (status VERIFIED/APPROVED/PAID) with totalGst > 0 that never posted Input GST
 *
 * Also ensures account 2250 (TCS Payable u/s 206C) exists in the Chart of Accounts.
 *
 * Usage:
 *   tsx backend/scripts/backfill-missing-journals.ts              # DRY-RUN — counts only
 *   tsx backend/scripts/backfill-missing-journals.ts --apply      # APPLY  — actually post JEs
 *
 * Safety:
 *   - Dry-run by default
 *   - Apply mode skips any invoice that already has a matching refId JE (double-post safe)
 *   - Logs one line per invoice so you can audit the action
 */

import { PrismaClient } from '@prisma/client';
import { onSaleInvoiceCreated, onVendorInvoiceBooked } from '../src/services/autoJournal';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function ensureTcsAccount() {
  // Account.code has a global @unique constraint in the current schema,
  // so 2250 can only exist once overall (not per-company). Create if missing.
  const existing = await prisma.account.findFirst({
    where: { code: '2250' },
    select: { id: true, companyId: true },
  });
  if (existing) {
    console.log(`Account 2250 already exists (id=${existing.id} company=${existing.companyId || '(null)'})`);
    return;
  }
  if (APPLY) {
    // Attach to first company that has accounts (matches majority of seeded CoA)
    const first = await prisma.account.findFirst({
      select: { companyId: true }, orderBy: { createdAt: 'asc' },
    });
    await prisma.account.create({
      data: {
        code: '2250',
        name: 'TCS Payable u/s 206C',
        type: 'LIABILITY',
        subType: 'CURRENT_LIABILITY',
        isSystem: true,
        companyId: first?.companyId ?? null,
      },
    });
    console.log(`Account 2250 created on company ${first?.companyId || '(null)'}`);
  } else {
    console.log(`[DRY] would create account 2250`);
  }
}

async function backfillSaleInvoiceNoJe() {
  console.log('\n── Sale invoices: finding ones with NO journal entry ──');

  const all = await prisma.invoice.findMany({
    where: { status: { not: 'CANCELLED' } },
    select: {
      id: true, invoiceNo: true, remarks: true, totalAmount: true, amount: true,
      gstAmount: true, gstPercent: true, cgstAmount: true, sgstAmount: true, igstAmount: true,
      supplyType: true, freightCharge: true,
      tcsAmount: true, tcsPercent: true, tcsSection: true,
      productName: true, customerId: true, invoiceDate: true, userId: true, companyId: true,
      customer: { select: { state: true } },
    },
    orderBy: { invoiceDate: 'asc' },
  });

  const missing: typeof all = [];
  for (const inv of all) {
    const je = await prisma.journalEntry.findFirst({
      where: { refType: 'SALE', refId: inv.id }, select: { id: true },
    });
    if (!je) missing.push(inv);
  }

  console.log(`Non-cancelled invoices: ${all.length} · Missing JE: ${missing.length}`);
  if (missing.length === 0) return;

  console.log('\nAll missing sale JEs:');
  for (const inv of missing) {
    console.log(`  INV-${inv.invoiceNo} · ${inv.invoiceDate.toISOString().slice(0, 10)} · ${inv.productName} · total=${inv.totalAmount}${inv.tcsAmount ? ` tcs=${inv.tcsAmount}` : ''}`);
  }

  if (!APPLY) { console.log(`\n[DRY] skipping actual JE creation. Pass --apply to post.`); return; }

  console.log('\nPosting missing JEs…');
  let ok = 0, fail = 0;
  for (const inv of missing) {
    try {
      const jeId = await onSaleInvoiceCreated(prisma, {
        id: inv.id, invoiceNo: inv.invoiceNo, remarks: inv.remarks, totalAmount: inv.totalAmount,
        amount: inv.amount, gstAmount: inv.gstAmount, gstPercent: inv.gstPercent,
        cgstAmount: inv.cgstAmount, sgstAmount: inv.sgstAmount, igstAmount: inv.igstAmount,
        supplyType: inv.supplyType, freightCharge: inv.freightCharge,
        tcsAmount: inv.tcsAmount, tcsPercent: inv.tcsPercent, tcsSection: inv.tcsSection,
        productName: inv.productName, customerId: inv.customerId,
        userId: inv.userId, invoiceDate: inv.invoiceDate,
        customer: inv.customer, companyId: inv.companyId || undefined,
      });
      if (jeId) { ok++; console.log(`  ✓ INV-${inv.invoiceNo} → JE ${jeId}`); }
      else      { fail++; console.log(`  ✗ INV-${inv.invoiceNo} → returned null (check logs)`); }
    } catch (err) { fail++; console.error(`  ✗ INV-${inv.invoiceNo} → threw`, err); }
  }
  console.log(`\nSale JE back-fill: ${ok} posted, ${fail} failed`);
}

async function adjustTcsGap() {
  console.log('\n── Sale invoices with TCS: checking if JE reflects TCS ──');

  const tcsInvs = await prisma.invoice.findMany({
    where: { tcsAmount: { gt: 0 }, status: { not: 'CANCELLED' } },
    select: {
      id: true, invoiceNo: true, remarks: true, totalAmount: true, tcsAmount: true, tcsSection: true, tcsPercent: true,
      invoiceDate: true, userId: true, companyId: true, productName: true,
    },
    orderBy: { invoiceDate: 'asc' },
  });

  const gaps: { inv: typeof tcsInvs[0]; existingDr: number; gap: number; jeId: string }[] = [];
  for (const inv of tcsInvs) {
    // Skip if an adjustment JE already exists for this invoice (idempotent re-runs)
    const adj = await prisma.journalEntry.findFirst({
      where: { refType: 'SALE', refId: inv.id, narration: { contains: 'TCS adjustment' } },
      select: { id: true },
    });
    if (adj) continue;

    const je = await prisma.journalEntry.findFirst({
      where: { refType: 'SALE', refId: inv.id, narration: { not: { contains: 'TCS adjustment' } } },
      select: { id: true, lines: { select: { debit: true, credit: true } } },
    });
    if (!je) continue; // handled by backfillSaleInvoiceNoJe
    const drSum = je.lines.reduce((s, l) => s + l.debit, 0);
    const gap = Math.round((inv.totalAmount - drSum) * 100) / 100;
    if (Math.abs(gap) > 0.01) gaps.push({ inv, existingDr: drSum, gap, jeId: je.id });
  }

  console.log(`Invoices with TCS: ${tcsInvs.length} · JE-gap detected: ${gaps.length}`);
  if (gaps.length === 0) return;

  console.log('\nGap detail (will post adjustment: Dr Debtors gap / Cr TCS Payable gap):');
  for (const g of gaps) {
    console.log(`  INV-${g.inv.invoiceNo} · existing dr=${g.existingDr} · total=${g.inv.totalAmount} · gap=${g.gap} · tcs on invoice=${g.inv.tcsAmount}`);
  }

  if (!APPLY) { console.log(`\n[DRY] skipping adjustment posts. Pass --apply.`); return; }

  const accts = new Map<string, Record<string, string>>();
  async function getAccts(companyId: string | null) {
    const key = companyId || '__default__';
    if (accts.has(key)) return accts.get(key)!;
    const rows = await prisma.account.findMany({
      where: { code: { in: ['1100', '2250'] }, ...(companyId ? { companyId } : {}) },
      select: { id: true, code: true },
    });
    const map: Record<string, string> = {};
    for (const r of rows) map[r.code] = r.id;
    accts.set(key, map);
    return map;
  }

  let ok = 0, fail = 0;
  for (const g of gaps) {
    try {
      const a = await getAccts(g.inv.companyId);
      if (!a['1100'] || !a['2250']) {
        fail++;
        console.error(`  ✗ INV-${g.inv.invoiceNo} → missing account 1100 or 2250`);
        continue;
      }
      const isDocNo = /^(INV|DCH|GP|CN|DN)\/[A-Z]+\/\d+$/.test(g.inv.remarks || '');
      const displayNo = isDocNo ? g.inv.remarks! : `INV-${g.inv.invoiceNo}`;
      await prisma.journalEntry.create({
        data: {
          date: g.inv.invoiceDate,
          narration: `${displayNo} ${g.inv.tcsSection || '206C(1)'} TCS adjustment`,
          refType: 'SALE',
          refId: g.inv.id,
          userId: g.inv.userId,
          companyId: g.inv.companyId,
          isAutoGenerated: true,
          lines: {
            create: [
              { accountId: a['1100'], debit: g.gap, credit: 0, narration: `TCS gap on ${displayNo}`, division: 'ETHANOL' },
              { accountId: a['2250'], debit: 0, credit: g.gap, narration: `TCS ${g.inv.tcsSection || '206C(1)'} @${g.inv.tcsPercent || 2}%`, division: 'ETHANOL' },
            ],
          },
        },
      });
      ok++;
      console.log(`  ✓ INV-${g.inv.invoiceNo} adjustment posted (+${g.gap})`);
    } catch (err) {
      fail++;
      console.error(`  ✗ INV-${g.inv.invoiceNo} threw`, err);
    }
  }
  console.log(`\nTCS adjustment: ${ok} posted, ${fail} failed`);
}

async function backfillVendorInvoiceGst() {
  console.log('\n── Vendor invoices: finding ones missing Input GST JE ──');

  // Vendor invoices that are confirmed (VERIFIED/APPROVED/PAID) with GST > 0
  const candidates = await prisma.vendorInvoice.findMany({
    where: {
      status: { in: ['VERIFIED', 'APPROVED', 'PAID'] },
      totalGst: { gt: 0 },
      isRCM: false,
      itcEligible: true,
    },
    select: {
      id: true, invoiceNo: true, vendorInvNo: true,
      cgstAmount: true, sgstAmount: true, igstAmount: true, totalGst: true,
      isRCM: true, itcEligible: true, invoiceDate: true, userId: true, companyId: true,
    },
    orderBy: { invoiceDate: 'asc' },
  });

  // Find ones with no matching PURCHASE journal whose narration contains "Input GST"
  const missing: typeof candidates = [];
  for (const vi of candidates) {
    const je = await prisma.journalEntry.findFirst({
      where: {
        refType: 'PURCHASE',
        refId: vi.id,
        narration: { contains: 'Input GST' },
      },
      select: { id: true },
    });
    if (!je) missing.push(vi);
  }

  console.log(`Total eligible VIs (VERIFIED+, GST>0, non-RCM, ITC-eligible): ${candidates.length}`);
  console.log(`Missing Input GST JE: ${missing.length}`);

  if (missing.length === 0) return;

  console.log('\nFirst 20 missing VI Input-GST JEs:');
  for (const vi of missing.slice(0, 20)) {
    const ref = vi.vendorInvNo ? ` (${vi.vendorInvNo})` : '';
    console.log(`  VI-${vi.invoiceNo}${ref} · ${vi.invoiceDate.toISOString().slice(0, 10)} · totalGst=${vi.totalGst} (C=${vi.cgstAmount} S=${vi.sgstAmount} I=${vi.igstAmount})`);
  }

  if (!APPLY) {
    console.log(`\n[DRY] skipping actual JE creation. Pass --apply to post.`);
    return;
  }

  console.log('\nPosting missing Input GST JEs…');
  let ok = 0, fail = 0;
  for (const vi of missing) {
    try {
      const jeId = await onVendorInvoiceBooked(prisma, {
        id: vi.id,
        invoiceNo: vi.invoiceNo,
        vendorInvNo: vi.vendorInvNo,
        cgstAmount: vi.cgstAmount,
        sgstAmount: vi.sgstAmount,
        igstAmount: vi.igstAmount,
        totalGst: vi.totalGst,
        isRCM: vi.isRCM,
        itcEligible: vi.itcEligible,
        invoiceDate: vi.invoiceDate,
        userId: vi.userId,
        companyId: vi.companyId || undefined,
      });
      if (jeId) { ok++; console.log(`  ✓ VI-${vi.invoiceNo} → JE ${jeId}`); }
      else      { fail++; console.log(`  ✗ VI-${vi.invoiceNo} → returned null`); }
    } catch (err) {
      fail++;
      console.error(`  ✗ VI-${vi.invoiceNo} → threw`, err);
    }
  }
  console.log(`\nVI Input-GST back-fill: ${ok} posted, ${fail} failed`);
}

async function main() {
  console.log(`── Back-fill missing journal entries ──`);
  console.log(`Mode: ${APPLY ? 'APPLY (will write)' : 'DRY-RUN (no writes)'}`);
  console.log('');

  await ensureTcsAccount();
  await backfillSaleInvoiceNoJe();
  await adjustTcsGap();
  await backfillVendorInvoiceGst();

  console.log('\nDone.');
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
