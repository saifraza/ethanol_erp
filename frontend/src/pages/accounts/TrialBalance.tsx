import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api from '../../services/api';
import { useHotkeys } from '../../hooks/useHotkeys';
import {
  PageToolbar, TipBanner, FilterBar, SecondaryFilterBar, FilterLabel,
  PresetButtons, DateRangeInputs, KpiStrip, KpiTile, HelpModal,
  TableContainer, Th, computePreset, fmtINR,
} from '../../components/accounts/BooksShell';

interface TBRow {
  id: string;
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  closingBalance: number;
  debit: number;
  credit: number;
}

interface TBData {
  rows: TBRow[];
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean;
}

const TYPES: Array<TBRow['type'] | 'ALL'> = ['ALL', 'ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];
type TypeFilter = typeof TYPES[number];

const TYPE_COLOR: Record<string, string> = {
  ASSET: 'border-l-blue-500',
  LIABILITY: 'border-l-rose-500',
  EQUITY: 'border-l-violet-500',
  INCOME: 'border-l-emerald-500',
  EXPENSE: 'border-l-amber-500',
};

export default function TrialBalance() {
  const [data, setData] = useState<TBData | null>(null);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [search, setSearch] = useState('');
  const [showZero, setShowZero] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDateRange(computePreset('fy')); }, []);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {};
      if (dateRange.from) params.from = dateRange.from;
      if (dateRange.to) params.to = dateRange.to;
      const res = await api.get<TBData>('/journal-entries/trial-balance', { params });
      setData(res.data);
    } catch (err) { console.error('Failed to fetch trial balance:', err); }
    finally { setLoading(false); }
  }, [dateRange]);
  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    if (!data) return { rows: [] as TBRow[], totalDebit: 0, totalCredit: 0 };
    const q = search.trim().toLowerCase();
    const out = data.rows.filter(r => {
      if (typeFilter !== 'ALL' && r.type !== typeFilter) return false;
      if (q && !(`${r.code} ${r.name}`.toLowerCase().includes(q))) return false;
      if (!showZero && r.debit === 0 && r.credit === 0) return false;
      return true;
    });
    const totalDebit = out.reduce((s, r) => s + r.debit, 0);
    const totalCredit = out.reduce((s, r) => s + r.credit, 0);
    return { rows: out, totalDebit, totalCredit };
  }, [data, typeFilter, search, showZero]);

  const diff = filtered.totalDebit - filtered.totalCredit;
  const balanced = Math.abs(diff) < 0.01;

  useHotkeys([
    { key: 'f', ctrl: true, handler: e => { e.preventDefault(); searchRef.current?.focus(); } },
    { key: 't', handler: e => { e.preventDefault(); setDateRange(computePreset('today')); } },
    { key: 'm', handler: e => { e.preventDefault(); setDateRange(computePreset('month')); } },
    { key: '?', shift: true, handler: e => { e.preventDefault(); setShowHelp(h => !h); } },
    { key: 'Escape', allowInInputs: true, handler: () => { if (showHelp) setShowHelp(false); else { setSearch(''); setTypeFilter('ALL'); } } },
  ]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        <PageToolbar
          title="Trial Balance"
          subtitle="Debits = Credits · period-based · Dr/Cr normalized by account type"
          statusBadge={data && (
            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${balanced ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200' : 'border-red-400/50 bg-red-500/20 text-red-200'}`}>
              {balanced ? 'Balanced' : 'Out of Balance'}
            </span>
          )}
        >
          <button onClick={() => setShowHelp(true)} className="w-6 h-6 border border-slate-600 text-slate-300 text-xs font-bold hover:bg-slate-700" title="Shortcuts (?)">?</button>
        </PageToolbar>

        <TipBanner storageKey="tb_tip_dismissed">
          Tip: <kbd className="px-1 bg-white border border-amber-300 font-mono">Ctrl+F</kbd> to search accounts.
          Toggle zero-balance rows with the checkbox.
        </TipBanner>

        <FilterBar>
          <PresetButtons onPreset={p => setDateRange(computePreset(p))} />
          <DateRangeInputs from={dateRange.from} to={dateRange.to} onChange={setDateRange} />
          <div>
            <FilterLabel>Account Type</FilterLabel>
            <div className="flex">
              {TYPES.map((t, i) => (
                <button key={t} onClick={() => setTypeFilter(t)}
                  className={`px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest border ${typeFilter === t ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'} ${i > 0 ? '-ml-px' : ''}`}
                >{t === 'ALL' ? 'All' : t}</button>
              ))}
            </div>
          </div>
        </FilterBar>

        <SecondaryFilterBar>
          <div className="flex-1 min-w-[200px]">
            <FilterLabel>Account Search (Ctrl+F)</FilterLabel>
            <input ref={searchRef} type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by code or name…"
              className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
          </div>
          <label className="flex items-center gap-1.5 mt-4 cursor-pointer">
            <input type="checkbox" checked={showZero} onChange={e => setShowZero(e.target.checked)} className="w-3 h-3" />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Show zero-balance</span>
          </label>
        </SecondaryFilterBar>

        {loading && <div className="text-xs text-slate-400 uppercase tracking-widest py-4 px-4">Loading trial balance...</div>}

        {data && !loading && (
          <>
            <KpiStrip cols={4}>
              <KpiTile label="Accounts" value={filtered.rows.length} sub={`of ${data.rows.length} total`} color="slate" />
              <KpiTile label="Total Debit" value={fmtINR(filtered.totalDebit) || '\u20B90.00'} color="emerald" valueClass="text-emerald-700" />
              <KpiTile label="Total Credit" value={fmtINR(filtered.totalCredit) || '\u20B90.00'} color="rose" valueClass="text-rose-700" />
              <KpiTile label="Difference" value={diff < 0 ? '-' + fmtINR(Math.abs(diff)) : fmtINR(diff) || '\u20B90.00'} valueClass={balanced ? 'text-slate-800' : 'text-red-700'} color="amber" last />
            </KpiStrip>

            <TableContainer>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <Th>Code</Th>
                    <Th>Account</Th>
                    <Th>Type</Th>
                    <Th align="right">Opening</Th>
                    <Th align="right">Period Dr</Th>
                    <Th align="right">Period Cr</Th>
                    <Th align="right">Debit</Th>
                    <Th align="right" last>Credit</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.rows.map((r, i) => (
                    <tr key={r.id} className={`border-b border-slate-100 hover:bg-blue-50 ${i % 2 ? 'bg-slate-50/50' : ''}`}>
                      <td className={`px-3 py-1.5 font-mono text-[10px] text-slate-500 border-r border-slate-100 border-l-4 ${TYPE_COLOR[r.type] || 'border-l-slate-300'}`}>{r.code}</td>
                      <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{r.name}</td>
                      <td className="px-3 py-1.5 text-[10px] text-slate-500 border-r border-slate-100">{r.type}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-500 border-r border-slate-100">{fmtINR(r.openingBalance)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-500 border-r border-slate-100">{fmtINR(r.periodDebit)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-500 border-r border-slate-100">{fmtINR(r.periodCredit)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-emerald-700 font-medium border-r border-slate-100">{fmtINR(r.debit)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-rose-700 font-medium">{fmtINR(r.credit)}</td>
                    </tr>
                  ))}
                  {filtered.rows.length === 0 && (
                    <tr><td colSpan={8} className="text-center py-8 text-xs text-slate-400 uppercase tracking-widest">No accounts match filters</td></tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-800 text-white font-semibold">
                    <td colSpan={6} className="px-3 py-2 text-right text-[10px] uppercase tracking-widest border-r border-slate-700">Totals</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-700">{fmtINR(filtered.totalDebit)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtINR(filtered.totalCredit)}</td>
                  </tr>
                </tfoot>
              </table>
            </TableContainer>
          </>
        )}
      </div>

      <HelpModal
        open={showHelp}
        onClose={() => setShowHelp(false)}
        entries={[
          ['Ctrl+F', 'Focus account search'],
          ['T / M', 'Today / This month'],
          ['Esc', 'Clear filters / close modal'],
          ['?', 'Show this help'],
        ]}
      />
    </div>
  );
}
