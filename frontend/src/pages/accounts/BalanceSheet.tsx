/**
 * Balance Sheet — Indian Accounting Standards (Ind AS) Schedule III format.
 *
 * Layout per Schedule III of the Companies Act 2013:
 *   I. EQUITY AND LIABILITIES
 *     (1) Shareholders' funds              — Equity share capital, Reserves & surplus
 *     (2) Non-current liabilities          — Long-term borrowings, deferred tax, other LT liab, LT provisions
 *     (3) Current liabilities              — ST borrowings, trade payables, other CL, ST provisions
 *   II. ASSETS
 *     (1) Non-current assets               — PPE, intangibles, CWIP, non-current investments, LT loans & advances
 *     (2) Current assets                   — Inventories, trade receivables, cash & equivalents, ST loans & advances
 *
 * The backend returns flat lists per top-level type (asset/liability/equity).
 * We bucket them into Ind AS sub-heads using the account's `subType` field +
 * a few common code-prefix heuristics. Unmapped accounts go into "Other".
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../services/api';
import { useHotkeys } from '../../hooks/useHotkeys';
import {
  PageToolbar, TipBanner, FilterBar, FilterLabel, KpiStrip, KpiTile,
  HelpModal, TableContainer, Th, fmtINR,
} from '../../components/accounts/BooksShell';

interface BSAccount {
  id: string;
  code: string;
  name: string;
  subType: string | null;
  balance: number;
}

interface BSSection {
  accounts: BSAccount[];
  total: number;
}

interface BSData {
  asOnDate: string;
  assets: BSSection;
  liabilities: BSSection;
  equity: BSSection;
  liabilitiesAndEquity: number;
  isBalanced: boolean;
}

// ── Ind AS Schedule III grouping ──────────────────────────────
type IndASHead =
  // Equity & Liabilities
  | 'Equity share capital'
  | 'Reserves and surplus'
  | 'Long-term borrowings'
  | 'Deferred tax liabilities (net)'
  | 'Other non-current liabilities'
  | 'Long-term provisions'
  | 'Short-term borrowings'
  | 'Trade payables'
  | 'Other current liabilities'
  | 'Short-term provisions'
  // Assets
  | 'Property, plant and equipment'
  | 'Capital work-in-progress'
  | 'Intangible assets'
  | 'Non-current investments'
  | 'Long-term loans and advances'
  | 'Other non-current assets'
  | 'Inventories'
  | 'Trade receivables'
  | 'Cash and cash equivalents'
  | 'Short-term loans and advances'
  | 'Other current assets'
  | 'Other';

const EQUITY_HEADS: IndASHead[] = ['Equity share capital', 'Reserves and surplus'];
const NCL_HEADS: IndASHead[] = ['Long-term borrowings', 'Deferred tax liabilities (net)', 'Other non-current liabilities', 'Long-term provisions'];
const CL_HEADS: IndASHead[] = ['Short-term borrowings', 'Trade payables', 'Other current liabilities', 'Short-term provisions'];
const NCA_HEADS: IndASHead[] = ['Property, plant and equipment', 'Capital work-in-progress', 'Intangible assets', 'Non-current investments', 'Long-term loans and advances', 'Other non-current assets'];
const CA_HEADS: IndASHead[] = ['Inventories', 'Trade receivables', 'Cash and cash equivalents', 'Short-term loans and advances', 'Other current assets'];

function classify(a: BSAccount, topType: 'ASSET' | 'LIABILITY' | 'EQUITY'): IndASHead {
  const st = (a.subType || '').toUpperCase();
  const code = a.code || '';
  const name = a.name.toLowerCase();

  if (topType === 'EQUITY') {
    if (st.includes('CAPITAL') || name.includes('share capital')) return 'Equity share capital';
    return 'Reserves and surplus';
  }

  if (topType === 'LIABILITY') {
    // Order matters. Specific statutory / tax payables must be matched BEFORE the
    // generic "payable/creditor/vendor" trade-payable rule, otherwise "GST Payable",
    // "TDS Payable", "Salary Payable" etc. get swallowed into Trade Payables and
    // Schedule III presentation is wrong.
    if (st === 'DEFERRED_TAX' || name.includes('deferred tax')) return 'Deferred tax liabilities (net)';
    if (st === 'LONG_TERM_BORROWING' || st.includes('LONG') || name.includes('term loan') || name.includes('long-term borrowing')) return 'Long-term borrowings';
    if (st === 'SHORT_TERM_BORROWING' || name.includes('cash credit') || name.includes('cc account') || name.includes('overdraft') || name.includes('short-term borrowing')) return 'Short-term borrowings';
    if (st.includes('PROVISION') && name.includes('long')) return 'Long-term provisions';
    if (st.includes('PROVISION')) return 'Short-term provisions';
    // Statutory dues → Other current liabilities (NOT trade payables)
    if (name.includes('gst') || name.includes('tds') || name.includes('tcs') || name.includes('statutory') ||
        name.includes('pf payable') || name.includes('esi') || name.includes('professional tax') ||
        name.includes('salary payable') || name.includes('wages payable') || name.includes('audit fee') ||
        name.includes('expenses payable') || name.includes('duties') || name.includes('cess'))
      return 'Other current liabilities';
    // True trade payables: sundry creditors for goods/services
    if (st === 'TRADE_PAYABLE' || st === 'ACCOUNTS_PAYABLE' ||
        name.includes('sundry creditor') || name.includes('trade payable') ||
        name.includes('vendor') || name.includes('supplier'))
      return 'Trade payables';
    // Generic "payable" / "creditor" catch-all → Other current liabilities (safer default)
    return 'Other current liabilities';
  }

  // ASSET
  if (st === 'BANK' || code === '1001' || code.startsWith('100') || name.includes('cash') || name.includes('bank')) return 'Cash and cash equivalents';
  if (st === 'RECEIVABLE' || st === 'ACCOUNTS_RECEIVABLE' || st === 'TRADE_RECEIVABLE' || name.includes('receivable') || name.includes('debtor') || name.includes('customer')) return 'Trade receivables';
  if (st === 'INVENTORY' || name.includes('inventory') || name.includes('stock') || name.includes('raw material') || name.includes('finished good') || name.includes('wip')) return 'Inventories';
  if (st === 'FIXED_ASSET' || st === 'PPE' || name.includes('plant') || name.includes('machinery') || name.includes('building') || name.includes('land') || name.includes('vehicle') || name.includes('equipment') || name.includes('furniture')) return 'Property, plant and equipment';
  if (name.includes('cwip') || name.includes('work-in-progress') || name.includes('capital wip')) return 'Capital work-in-progress';
  if (name.includes('intangible') || name.includes('goodwill') || name.includes('software') || name.includes('patent') || name.includes('trademark')) return 'Intangible assets';
  if (st === 'INVESTMENT' || name.includes('investment')) return 'Non-current investments';
  if (name.includes('long-term loan') || name.includes('lt advance') || name.includes('security deposit')) return 'Long-term loans and advances';
  if (name.includes('advance') || name.includes('prepaid') || name.includes('loan')) return 'Short-term loans and advances';
  return 'Other current assets';
}

function bucket(accounts: BSAccount[], topType: 'ASSET' | 'LIABILITY' | 'EQUITY'): Record<string, { accs: BSAccount[]; total: number }> {
  const m: Record<string, { accs: BSAccount[]; total: number }> = {};
  for (const a of accounts) {
    const head = classify(a, topType);
    if (!m[head]) m[head] = { accs: [], total: 0 };
    m[head].accs.push(a);
    m[head].total += a.balance;
  }
  return m;
}

function sumHeads(groups: Record<string, { accs: BSAccount[]; total: number }>, heads: IndASHead[]): number {
  return heads.reduce((s, h) => s + (groups[h]?.total || 0), 0);
}

export default function BalanceSheet() {
  const [data, setData] = useState<BSData | null>(null);
  const [loading, setLoading] = useState(false);
  const [asOn, setAsOn] = useState(new Date().toISOString().split('T')[0]);
  const [showHelp, setShowHelp] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get<BSData>('/journal-entries/balance-sheet', { params: { asOn } });
      setData(res.data);
    } catch (err) { console.error('Failed to fetch balance sheet:', err); }
    finally { setLoading(false); }
  }, [asOn]);
  useEffect(() => { fetchData(); }, [fetchData]);

  useHotkeys([
    { key: 't', handler: e => { e.preventDefault(); setAsOn(new Date().toISOString().split('T')[0]); } },
    { key: '?', shift: true, handler: e => { e.preventDefault(); setShowHelp(h => !h); } },
    { key: 'Escape', allowInInputs: true, handler: () => { if (showHelp) setShowHelp(false); } },
  ]);

  const buckets = useMemo(() => {
    if (!data) return null;
    const liabilityGroups = bucket(data.liabilities.accounts, 'LIABILITY');
    const equityGroups = bucket(data.equity.accounts, 'EQUITY');
    const assetGroups = bucket(data.assets.accounts, 'ASSET');

    const equityTotal = sumHeads(equityGroups, EQUITY_HEADS);
    const nclTotal = sumHeads(liabilityGroups, NCL_HEADS);
    const clTotal = sumHeads(liabilityGroups, CL_HEADS);
    const ncaTotal = sumHeads(assetGroups, NCA_HEADS);
    const caTotal = sumHeads(assetGroups, CA_HEADS);

    return { liabilityGroups, equityGroups, assetGroups, equityTotal, nclTotal, clTotal, ncaTotal, caTotal };
  }, [data]);

  const fmtAsOnLabel = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

  const renderHead = (label: IndASHead, group?: { accs: BSAccount[]; total: number }, noteRef?: number) => {
    if (!group || group.total === 0) return null;
    return (
      <React.Fragment key={label}>
        <tr className="border-b border-slate-100 bg-slate-50/50">
          <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100 font-medium">
            {noteRef && <span className="text-[10px] text-slate-400 mr-2">({noteRef})</span>}
            {label}
          </td>
          <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 font-semibold">{fmtINR(group.total)}</td>
        </tr>
        {group.accs.map(a => (
          <tr key={a.id} className="border-b border-slate-100 text-[11px]">
            <td className="px-3 py-1 pl-10 text-slate-500 border-r border-slate-100">
              <span className="font-mono text-[10px] text-slate-400 mr-2">{a.code}</span>{a.name}
            </td>
            <td className="px-3 py-1 text-right font-mono tabular-nums text-slate-500">{fmtINR(a.balance)}</td>
          </tr>
        ))}
      </React.Fragment>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        <PageToolbar
          title="Balance Sheet"
          subtitle="Ind AS Schedule III · as on a specific date"
          statusBadge={data && (
            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${data.isBalanced ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200' : 'border-red-400/50 bg-red-500/20 text-red-200'}`}>
              {data.isBalanced ? 'Balanced' : 'Out of Balance'}
            </span>
          )}
        >
          <button onClick={() => setShowHelp(true)} className="w-6 h-6 border border-slate-600 text-slate-300 text-xs font-bold hover:bg-slate-700" title="Shortcuts (?)">?</button>
        </PageToolbar>

        <TipBanner storageKey="bs_tip_dismissed">
          Tip: press <kbd className="px-1 bg-white border border-amber-300 font-mono">T</kbd> for today's BS.
          Format follows Ind AS Schedule III of the Companies Act 2013.
        </TipBanner>

        <FilterBar>
          <div>
            <FilterLabel>As on</FilterLabel>
            <input type="date" value={asOn} onChange={e => setAsOn(e.target.value)}
              className="border border-slate-300 px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-slate-400" />
          </div>
          <div className="text-[10px] text-slate-500 mt-4 uppercase tracking-widest">
            As on {fmtAsOnLabel(asOn)}
          </div>
        </FilterBar>

        {loading && <div className="text-xs text-slate-400 uppercase tracking-widest py-4 px-4">Loading balance sheet...</div>}

        {data && buckets && !loading && (
          <>
            <KpiStrip cols={4}>
              <KpiTile label="Total Equity" value={fmtINR(buckets.equityTotal) || '\u20B90.00'} color="violet" />
              <KpiTile label="Total Liabilities" value={fmtINR(buckets.nclTotal + buckets.clTotal) || '\u20B90.00'} color="rose" valueClass="text-rose-700" />
              <KpiTile label="Total Assets" value={fmtINR(data.assets.total) || '\u20B90.00'} color="blue" valueClass="text-blue-700" />
              <KpiTile label="Check (A − L−E)" value={fmtINR(data.assets.total - data.liabilitiesAndEquity) || '\u20B90.00'} color={data.isBalanced ? 'emerald' : 'red'} valueClass={data.isBalanced ? 'text-slate-800' : 'text-red-700'} last />
            </KpiStrip>

            <TableContainer>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <Th>Particulars</Th>
                    <Th align="right" last>Amount (₹)</Th>
                  </tr>
                </thead>
                <tbody>
                  {/* I. EQUITY AND LIABILITIES */}
                  <tr className="bg-slate-900 text-white border-b-2 border-slate-700">
                    <td colSpan={2} className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest">I. Equity and Liabilities</td>
                  </tr>

                  {/* (1) Shareholders' funds */}
                  <tr className="bg-slate-200 border-b border-slate-300">
                    <td className="px-3 py-1.5 text-[10px] font-bold text-slate-700 uppercase tracking-widest">(1) Shareholders' Funds</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 font-bold">{fmtINR(buckets.equityTotal)}</td>
                  </tr>
                  {EQUITY_HEADS.map(h => renderHead(h, buckets.equityGroups[h]))}

                  {/* (2) Non-current liabilities */}
                  <tr className="bg-slate-200 border-b border-slate-300">
                    <td className="px-3 py-1.5 text-[10px] font-bold text-slate-700 uppercase tracking-widest">(2) Non-Current Liabilities</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 font-bold">{fmtINR(buckets.nclTotal)}</td>
                  </tr>
                  {NCL_HEADS.map(h => renderHead(h, buckets.liabilityGroups[h]))}

                  {/* (3) Current liabilities */}
                  <tr className="bg-slate-200 border-b border-slate-300">
                    <td className="px-3 py-1.5 text-[10px] font-bold text-slate-700 uppercase tracking-widest">(3) Current Liabilities</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 font-bold">{fmtINR(buckets.clTotal)}</td>
                  </tr>
                  {CL_HEADS.map(h => renderHead(h, buckets.liabilityGroups[h]))}

                  <tr className="bg-slate-700 text-white border-b-2 border-slate-900 font-semibold">
                    <td className="px-3 py-2 text-[11px] uppercase tracking-widest">Total — Equity and Liabilities</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtINR(data.liabilitiesAndEquity)}</td>
                  </tr>

                  {/* II. ASSETS */}
                  <tr className="bg-slate-900 text-white border-b-2 border-slate-700">
                    <td colSpan={2} className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest">II. Assets</td>
                  </tr>

                  {/* (1) Non-current assets */}
                  <tr className="bg-slate-200 border-b border-slate-300">
                    <td className="px-3 py-1.5 text-[10px] font-bold text-slate-700 uppercase tracking-widest">(1) Non-Current Assets</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 font-bold">{fmtINR(buckets.ncaTotal)}</td>
                  </tr>
                  {NCA_HEADS.map(h => renderHead(h, buckets.assetGroups[h]))}

                  {/* (2) Current assets */}
                  <tr className="bg-slate-200 border-b border-slate-300">
                    <td className="px-3 py-1.5 text-[10px] font-bold text-slate-700 uppercase tracking-widest">(2) Current Assets</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 font-bold">{fmtINR(buckets.caTotal)}</td>
                  </tr>
                  {CA_HEADS.map(h => renderHead(h, buckets.assetGroups[h]))}

                  <tr className="bg-slate-700 text-white border-b-2 border-slate-900 font-semibold">
                    <td className="px-3 py-2 text-[11px] uppercase tracking-widest">Total — Assets</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtINR(data.assets.total)}</td>
                  </tr>
                </tbody>
              </table>
            </TableContainer>

            {!data.isBalanced && (
              <div className="bg-red-50 border-x border-b border-red-200 -mx-3 md:-mx-6 px-4 py-2 text-[11px] text-red-700">
                ⚠ Balance Sheet is out of balance by {fmtINR(Math.abs(data.assets.total - data.liabilitiesAndEquity))}. Check for unposted or orphaned journal entries.
              </div>
            )}
          </>
        )}
      </div>

      <HelpModal
        open={showHelp}
        onClose={() => setShowHelp(false)}
        entries={[
          ['T', 'As on today'],
          ['Esc', 'Close modal'],
          ['?', 'Show this help'],
        ]}
      />
    </div>
  );
}
