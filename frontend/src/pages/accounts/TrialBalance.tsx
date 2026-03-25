import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface TrialBalanceRow {
  id: string;
  code: string;
  name: string;
  type: string;
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  closingBalance: number;
  debit: number;
  credit: number;
}

interface TrialBalanceData {
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean;
}

const TYPE_ORDER = ['ASSET', 'LIABILITY', 'INCOME', 'EXPENSE', 'EQUITY'];

export default function TrialBalance() {
  const [data, setData] = useState<TrialBalanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({ from: '', to: '' });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {};
      if (dateRange.from) params.from = dateRange.from;
      if (dateRange.to) params.to = dateRange.to;
      const res = await api.get<TrialBalanceData>('/journal-entries/trial-balance', { params });
      setData(res.data);
    } catch (err) {
      console.error('Failed to fetch trial balance:', err);
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fmtCurrency = (n: number): string => {
    if (n === 0) return '--';
    return '\u20B9' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-xs text-slate-400 uppercase tracking-widest">Failed to load data</div>
      </div>
    );
  }

  // Group rows by type
  const groupedRows = TYPE_ORDER.map(type => ({
    type,
    rows: data.rows.filter(r => r.type === type),
    totalDebit: data.rows.filter(r => r.type === type).reduce((s, r) => s + r.debit, 0),
    totalCredit: data.rows.filter(r => r.type === type).reduce((s, r) => s + r.credit, 0),
  })).filter(g => g.rows.length > 0);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Trial Balance</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Debit and credit balances across all accounts</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${data.isBalanced ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200' : 'border-red-400/50 bg-red-500/20 text-red-200'}`}>
              {data.isBalanced ? 'Balanced' : `Unbalanced (Diff: \u20B9${Math.abs(data.totalDebit - data.totalCredit).toFixed(2)})`}
            </span>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-4 flex-wrap">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">From Date</label>
            <input
              type="date"
              value={dateRange.from}
              onChange={e => setDateRange(f => ({ ...f, from: e.target.value }))}
              className="border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">To Date</label>
            <input
              type="date"
              value={dateRange.to}
              onChange={e => setDateRange(f => ({ ...f, to: e.target.value }))}
              className="border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400"
            />
          </div>
          <div className="flex items-end gap-2 ml-auto">
            <div className="bg-white border border-slate-300 px-4 py-2 border-l-4 border-l-blue-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Debit</div>
              <div className="text-lg font-bold text-slate-800 font-mono tabular-nums">{fmtCurrency(data.totalDebit)}</div>
            </div>
            <div className="bg-white border border-slate-300 px-4 py-2 border-l-4 border-l-amber-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Credit</div>
              <div className="text-lg font-bold text-slate-800 font-mono tabular-nums">{fmtCurrency(data.totalCredit)}</div>
            </div>
          </div>
        </div>

        {/* Trial Balance Table */}
        <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Code</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Account Name</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Debit</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Credit</th>
              </tr>
            </thead>
            <tbody>
              {groupedRows.map(group => (
                <React.Fragment key={group.type}>
                  {/* Group Header */}
                  <tr className="bg-slate-200 border-b border-slate-300">
                    <td colSpan={4} className="px-3 py-1.5 text-[10px] font-bold text-slate-600 uppercase tracking-widest">
                      {group.type}
                    </td>
                  </tr>
                  {group.rows.map(row => (
                    <tr key={row.id} className="hover:bg-blue-50 border-b border-slate-100 even:bg-slate-50/50">
                      <td className="px-3 py-1.5 font-mono text-[10px] text-slate-400 border-r border-slate-100">{row.code}</td>
                      <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{row.name}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{row.debit > 0 ? fmtCurrency(row.debit) : ''}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700">{row.credit > 0 ? fmtCurrency(row.credit) : ''}</td>
                    </tr>
                  ))}
                  {/* Group Subtotal */}
                  <tr className="bg-slate-100 border-b border-slate-300">
                    <td colSpan={2} className="px-3 py-1.5 text-right text-[10px] font-bold text-slate-500 uppercase tracking-widest border-r border-slate-100">
                      {group.type} Subtotal
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums font-semibold text-[11px] text-slate-600 border-r border-slate-100">
                      {group.totalDebit > 0 ? fmtCurrency(group.totalDebit) : ''}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums font-semibold text-[11px] text-slate-600">
                      {group.totalCredit > 0 ? fmtCurrency(group.totalCredit) : ''}
                    </td>
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-800 text-white font-semibold">
                <td colSpan={2} className="px-3 py-2 text-right text-[10px] uppercase tracking-widest border-r border-slate-700">Grand Total</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-700">{fmtCurrency(data.totalDebit)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtCurrency(data.totalCredit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {data.rows.length === 0 && (
          <div className="min-h-[200px] flex items-center justify-center">
            <div className="text-xs text-slate-400 uppercase tracking-widest">No transactions found. Create journal entries first.</div>
          </div>
        )}
      </div>
    </div>
  );
}
