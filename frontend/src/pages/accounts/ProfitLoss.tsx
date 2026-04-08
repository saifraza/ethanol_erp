import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../services/api';
import { useHotkeys } from '../../hooks/useHotkeys';
import {
  PageToolbar, TipBanner, FilterBar, PresetButtons, DateRangeInputs,
  KpiStrip, KpiTile, HelpModal, TableContainer, Th, computePreset, fmtINR,
} from '../../components/accounts/BooksShell';

interface PLAccount {
  id: string;
  code: string;
  name: string;
  subType: string | null;
  amount: number;
}

interface PLData {
  income: PLAccount[];
  expenses: PLAccount[];
  totalIncome: number;
  totalExpense: number;
  netProfitLoss: number;
  isProfit: boolean;
}

export default function ProfitLoss() {
  const [data, setData] = useState<PLData | null>(null);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => { setDateRange(computePreset('fy')); }, []);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {};
      if (dateRange.from) params.from = dateRange.from;
      if (dateRange.to) params.to = dateRange.to;
      const res = await api.get<PLData>('/journal-entries/profit-loss', { params });
      setData(res.data);
    } catch (err) { console.error('Failed to fetch P&L:', err); }
    finally { setLoading(false); }
  }, [dateRange]);
  useEffect(() => { fetchData(); }, [fetchData]);

  useHotkeys([
    { key: 't', handler: e => { e.preventDefault(); setDateRange(computePreset('today')); } },
    { key: 'm', handler: e => { e.preventDefault(); setDateRange(computePreset('month')); } },
    { key: '?', shift: true, handler: e => { e.preventDefault(); setShowHelp(h => !h); } },
    { key: 'Escape', allowInInputs: true, handler: () => { if (showHelp) setShowHelp(false); } },
  ]);

  // Group accounts by subType (if set), else "Other"
  const group = (accs: PLAccount[]) => {
    const m: Record<string, { accs: PLAccount[]; total: number }> = {};
    for (const a of accs) {
      const key = a.subType || 'Other';
      if (!m[key]) m[key] = { accs: [], total: 0 };
      m[key].accs.push(a);
      m[key].total += a.amount;
    }
    return m;
  };

  const margin = data && data.totalIncome > 0 ? (data.netProfitLoss / data.totalIncome) * 100 : 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        <PageToolbar
          title="Profit & Loss"
          subtitle="Income \u2212 Expenses = Net Profit/Loss"
          statusBadge={data && (
            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${data.isProfit ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200' : 'border-red-400/50 bg-red-500/20 text-red-200'}`}>
              {data.isProfit ? 'Profit' : 'Loss'}
            </span>
          )}
        >
          <button onClick={() => setShowHelp(true)} className="w-6 h-6 border border-slate-600 text-slate-300 text-xs font-bold hover:bg-slate-700" title="Shortcuts (?)">?</button>
        </PageToolbar>

        <TipBanner storageKey="pl_tip_dismissed">
          Press <kbd className="px-1 bg-white border border-amber-300 font-mono">T</kbd>/<kbd className="px-1 bg-white border border-amber-300 font-mono">M</kbd> for presets, <kbd className="px-1 bg-white border border-amber-300 font-mono">?</kbd> for all shortcuts.
        </TipBanner>

        <FilterBar>
          <PresetButtons onPreset={p => setDateRange(computePreset(p))} />
          <DateRangeInputs from={dateRange.from} to={dateRange.to} onChange={setDateRange} />
        </FilterBar>

        {loading && <div className="text-xs text-slate-400 uppercase tracking-widest py-4 px-4">Loading P&L...</div>}

        {data && !loading && (
          <>
            <KpiStrip cols={4}>
              <KpiTile label="Revenue" value={fmtINR(data.totalIncome) || '\u20B90.00'} sub={`${data.income.length} accounts`} color="emerald" valueClass="text-emerald-700" />
              <KpiTile label="Expenses" value={fmtINR(data.totalExpense) || '\u20B90.00'} sub={`${data.expenses.length} accounts`} color="rose" valueClass="text-rose-700" />
              <KpiTile label={data.isProfit ? 'Net Profit' : 'Net Loss'} value={fmtINR(Math.abs(data.netProfitLoss)) || '\u20B90.00'} color={data.isProfit ? 'emerald' : 'red'} valueClass={data.isProfit ? 'text-emerald-700' : 'text-red-700'} />
              <KpiTile label="Margin %" value={`${margin.toFixed(2)}%`} color="indigo" valueClass={margin >= 0 ? 'text-slate-800' : 'text-red-700'} last />
            </KpiStrip>

            <TableContainer>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <Th>Code</Th>
                    <Th>Account</Th>
                    <Th>Category</Th>
                    <Th align="right" last>Amount</Th>
                  </tr>
                </thead>
                <tbody>
                  {/* REVENUE */}
                  <tr className="bg-emerald-100 border-b border-emerald-200">
                    <td colSpan={4} className="px-3 py-1.5 text-[10px] font-bold text-emerald-900 uppercase tracking-widest">Revenue</td>
                  </tr>
                  {Object.entries(group(data.income)).map(([cat, g]) => (
                    <React.Fragment key={`in-${cat}`}>
                      <tr className="bg-slate-200/60 border-b border-slate-300">
                        <td colSpan={3} className="px-3 py-1 pl-6 text-[10px] font-bold text-slate-700 uppercase tracking-widest">{cat}</td>
                        <td className="px-3 py-1 text-right font-mono tabular-nums text-slate-700 font-bold">{fmtINR(g.total)}</td>
                      </tr>
                      {g.accs.map((a, i) => (
                        <tr key={a.id} className={`border-b border-slate-100 hover:bg-blue-50 ${i % 2 ? 'bg-slate-50/50' : ''}`}>
                          <td className="px-3 py-1.5 pl-8 font-mono text-[10px] text-slate-500 border-r border-slate-100">{a.code}</td>
                          <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{a.name}</td>
                          <td className="px-3 py-1.5 text-[10px] text-slate-500 border-r border-slate-100">{a.subType || '--'}</td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums text-emerald-700">{fmtINR(a.amount)}</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                  <tr className="bg-emerald-50 border-b-2 border-emerald-600 font-bold">
                    <td colSpan={3} className="px-3 py-2 text-right text-[11px] uppercase tracking-widest text-emerald-900">Total Revenue</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-emerald-700">{fmtINR(data.totalIncome)}</td>
                  </tr>

                  {/* EXPENSES */}
                  <tr className="bg-rose-100 border-b border-rose-200">
                    <td colSpan={4} className="px-3 py-1.5 text-[10px] font-bold text-rose-900 uppercase tracking-widest">Expenses</td>
                  </tr>
                  {Object.entries(group(data.expenses)).map(([cat, g]) => (
                    <React.Fragment key={`ex-${cat}`}>
                      <tr className="bg-slate-200/60 border-b border-slate-300">
                        <td colSpan={3} className="px-3 py-1 pl-6 text-[10px] font-bold text-slate-700 uppercase tracking-widest">{cat}</td>
                        <td className="px-3 py-1 text-right font-mono tabular-nums text-slate-700 font-bold">{fmtINR(g.total)}</td>
                      </tr>
                      {g.accs.map((a, i) => (
                        <tr key={a.id} className={`border-b border-slate-100 hover:bg-blue-50 ${i % 2 ? 'bg-slate-50/50' : ''}`}>
                          <td className="px-3 py-1.5 pl-8 font-mono text-[10px] text-slate-500 border-r border-slate-100">{a.code}</td>
                          <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{a.name}</td>
                          <td className="px-3 py-1.5 text-[10px] text-slate-500 border-r border-slate-100">{a.subType || '--'}</td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums text-rose-700">{fmtINR(a.amount)}</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                  <tr className="bg-rose-50 border-b-2 border-rose-600 font-bold">
                    <td colSpan={3} className="px-3 py-2 text-right text-[11px] uppercase tracking-widest text-rose-900">Total Expenses</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-rose-700">{fmtINR(data.totalExpense)}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr className="bg-slate-800 text-white font-semibold text-xs">
                    <td colSpan={3} className="px-3 py-2.5 text-right uppercase tracking-widest border-r border-slate-700">
                      {data.isProfit ? 'Net Profit' : 'Net Loss'}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-mono tabular-nums font-bold text-sm ${data.isProfit ? 'text-emerald-300' : 'text-red-300'}`}>
                      {data.isProfit ? '' : '-'}{fmtINR(Math.abs(data.netProfitLoss)) || '\u20B90.00'}
                    </td>
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
          ['T / M', 'Today / This month'],
          ['Esc', 'Close modal'],
          ['?', 'Show this help'],
        ]}
      />
    </div>
  );
}
