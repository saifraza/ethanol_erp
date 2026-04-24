/**
 * Audit every account currently showing on the Balance Sheet.
 * For each account: total debits, total credits, closing balance, txn count,
 * first + last transaction date, first customer/vendor, and sample narrations.
 * Grouped by Tally primary head (same order as BS tree).
 *
 * Usage: tsx backend/scripts/audit-bs-data.ts
 * Read-only. Never writes.
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

type PrimaryHead =
  | 'Capital Account' | 'Loans (Liability)' | 'Current Liabilities' | 'Deferred Taxes' | 'Suspense A/c' | 'Profit & Loss A/c'
  | 'Fixed Assets' | 'Investments' | 'Current Assets' | 'Capital Work in Progress' | 'Deposits (Asset)' | 'Loans & Advances (Asset)' | 'Other';

function primaryOf(a: { type: string; subType: string | null; name: string; code: string }): PrimaryHead {
  const st = (a.subType || '').toUpperCase();
  const name = a.name.toLowerCase();
  const code = a.code || '';

  if (a.type === 'EQUITY') return 'Capital Account';
  if (a.type === 'LIABILITY') {
    if (st === 'DEFERRED_TAX' || name.includes('deferred tax')) return 'Deferred Taxes';
    if (name.includes('suspense')) return 'Suspense A/c';
    if (name.includes('profit and loss') || name.includes('p&l')) return 'Profit & Loss A/c';
    if (name.includes('bank od') || name.includes('overdraft') || name.includes('pledge') || name.includes('unsecured') || name.includes('secured') || st.includes('LONG_TERM') || st === 'SHORT_TERM_BORROWING' || name.includes('term loan') || name.includes('borrowing')) return 'Loans (Liability)';
    return 'Current Liabilities';
  }
  // ASSET
  if (name.includes('cwip') || name.includes('work-in-progress') || name.includes('capital work')) return 'Capital Work in Progress';
  if (st === 'FIXED_ASSET' || st === 'PPE' || name.includes('plant') || name.includes('machinery') || name.includes('building') || name.includes('land') || name.includes('vehicle') || name.includes('motor car') || name.includes('equipment') || name.includes('furniture') || name.includes('dumper')) return 'Fixed Assets';
  if (st === 'INVESTMENT' || name.includes('investment') || name.includes('shares in') || name.startsWith('partner ')) return 'Investments';
  if (name.includes('fdr') || name.includes('fixed deposit') || name.includes('security deposit') || name.includes('bsnl') || name.includes('pla ') || name.includes('appeal deposit')) return 'Deposits (Asset)';
  if (name.includes('long-term loan') || name.includes('loans atrf') || (name.includes('loan') && name.includes('long'))) return 'Loans & Advances (Asset)';
  return 'Current Assets';
}

async function main() {
  const accounts = await prisma.account.findMany({
    where: { isActive: true, type: { in: ['ASSET', 'LIABILITY', 'EQUITY'] } },
    select: { id: true, code: true, name: true, type: true, subType: true, openingBalance: true },
  });

  type Row = {
    id: string; code: string; name: string; type: string; subType: string | null;
    primary: PrimaryHead;
    opening: number; dr: number; cr: number; closing: number; count: number;
    firstDate: Date | null; lastDate: Date | null;
    sampleNarrations: string[];
    sampleParties: string[];
  };

  const rows: Row[] = [];
  for (const a of accounts) {
    const lines = await prisma.journalLine.findMany({
      where: { accountId: a.id, journal: { isReversed: false } },
      select: {
        debit: true, credit: true, narration: true,
        journal: { select: { date: true, refType: true, refId: true } },
      },
      orderBy: { journal: { date: 'asc' } },
    });
    if (lines.length === 0 && a.openingBalance === 0) continue; // skip empty unused accounts

    const dr = lines.reduce((s, l) => s + l.debit, 0);
    const cr = lines.reduce((s, l) => s + l.credit, 0);
    const isDrNormal = a.type === 'ASSET';
    const closing = a.openingBalance + (isDrNormal ? dr - cr : cr - dr);
    if (closing === 0 && lines.length === 0) continue;

    // Resolve up to 3 party names via refType + refId
    const partySet = new Set<string>();
    const sampleRefs = lines.slice(0, 50);
    const saleIds = [...new Set(sampleRefs.filter(l => l.journal.refType === 'SALE' && l.journal.refId).map(l => l.journal.refId as string))].slice(0, 10);
    const payIds = [...new Set(sampleRefs.filter(l => l.journal.refType === 'PAYMENT' && l.journal.refId).map(l => l.journal.refId as string))].slice(0, 10);
    const [invs, pays] = await Promise.all([
      saleIds.length ? prisma.invoice.findMany({ where: { id: { in: saleIds } }, select: { customer: { select: { name: true } } } }) : [],
      payIds.length ? prisma.vendorPayment.findMany({ where: { id: { in: payIds } }, select: { vendor: { select: { name: true } } } }) : [],
    ]);
    for (const i of invs) if (i.customer?.name) partySet.add(i.customer.name);
    for (const p of pays) if (p.vendor?.name) partySet.add(p.vendor.name);

    const narrSet = new Set<string>();
    for (const l of lines.slice(0, 20)) {
      if (l.narration) narrSet.add(l.narration);
      if (narrSet.size >= 4) break;
    }

    rows.push({
      id: a.id, code: a.code, name: a.name, type: a.type, subType: a.subType,
      primary: primaryOf(a),
      opening: a.openingBalance, dr, cr, closing: Math.round(closing * 100) / 100, count: lines.length,
      firstDate: lines.length ? lines[0].journal.date : null,
      lastDate: lines.length ? lines[lines.length - 1].journal.date : null,
      sampleNarrations: [...narrSet].slice(0, 4),
      sampleParties: [...partySet].slice(0, 5),
    });
  }

  // Group by primary + print
  const ORDER: PrimaryHead[] = [
    'Capital Account', 'Loans (Liability)', 'Current Liabilities', 'Deferred Taxes', 'Suspense A/c', 'Profit & Loss A/c',
    'Fixed Assets', 'Investments', 'Current Assets', 'Capital Work in Progress', 'Deposits (Asset)', 'Loans & Advances (Asset)', 'Other',
  ];
  const fmt = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (d: Date | null) => d ? d.toISOString().slice(0, 10) : '--';

  for (const head of ORDER) {
    const group = rows.filter(r => r.primary === head);
    if (group.length === 0) continue;
    const sum = group.reduce((s, r) => s + r.closing, 0);
    console.log(`\n══════ ${head}  —  subtotal ₹${fmt(sum)}  (${group.length} accounts)`);
    group.sort((a, b) => Math.abs(b.closing) - Math.abs(a.closing));
    for (const r of group) {
      console.log(`\n  [${r.code}] ${r.name}  ·  ₹${fmt(r.closing)}  ·  ${r.count} txns  ·  ${fmtDate(r.firstDate)}→${fmtDate(r.lastDate)}`);
      if (r.opening) console.log(`    opening=${fmt(r.opening)}  dr=${fmt(r.dr)}  cr=${fmt(r.cr)}`);
      if (r.sampleParties.length) console.log(`    parties: ${r.sampleParties.join(' · ')}`);
      if (r.sampleNarrations.length) console.log(`    sample: ${r.sampleNarrations.join(' | ')}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
