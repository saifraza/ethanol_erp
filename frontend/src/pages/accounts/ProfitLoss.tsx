import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

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
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({ from: '', to: '' });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {};
      if (dateRange.from) params.from = dateRange.from;
      if (dateRange.to) params.to = dateRange.to;
      const res = await api.get<PLData>('/journal-entries/profit-loss', { params });
      setData(res.data);
    } catch (err) {
      console.error('Failed to fetch P&L:', err);
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fmtCurrency = (n: number): string =>
    '\u20B9' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Financial year defaults (April 1 to March 31)
  const setFY = () => {
    const now = new Date();
    const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    setDateRange({ from: `${year}-04-01`, to: `${year + 1}-03-31` });
  };

  const setCurrentMonth = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
    setDateRange({ from: `${y}-${m}-01`, to: `${y}-${m}-${lastDay}` });
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

  // Group income/expenses by subType
  const groupBySubType = (items: PLAccount[]): Record<string, PLAccount[]> => {
    const groups: Record<string, PLAccount[]> = {};
    items.forEach(item => {
      const key = item.subType || 'Other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });
    return groups;
  };

  const incomeGroups = groupBySubType(data.income);
  const expenseGroups = groupBySubType(data.expenses);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Profit & Loss Statement</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Income and expenditure summary for the period</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${data.isProfit ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200' : 'border-red-400/50 bg-red-500/20 text-red-200'}`}>
              {data.isProfit ? 'Net Profit' : 'Net Loss'}: {fmtCurrency(data.netProfitLoss)}
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
          <div className="flex items-end gap-2">
            <button onClick={setCurrentMonth} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">
              This Month
            </button>
            <button onClick={setFY} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
              Current FY
            </button>
          </div>
          <div className="flex items-end gap-2 ml-auto">
            <div className="bg-white border border-slate-300 px-4 py-2 border-l-4 border-l-emerald-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Income</div>
              <div className="text-lg font-bold text-slate-800 font-mono tabular-nums">{fmtCurrency(data.totalIncome)}</div>
            </div>
            <div className="bg-white border border-slate-300 px-4 py-2 border-l-4 border-l-red-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Expense</div>
              <div className="text-lg font-bold text-slate-800 font-mono tabular-nums">{fmtCurrency(data.totalExpense)}</div>
            </div>
          </div>
        </div>

        {/* Two Column Layout */}
        <div className="grid grid-cols-2 -mx-3 md:-mx-6">
          {/* Income Side */}
          <div className="border-x border-b border-slate-300 overflow-hidden">
            <div className="bg-slate-800 text-white px-4 py-2">
              <h2 className="text-xs font-bold uppercase tracking-wide">Income</h2>
            </div>
            <div>
              {Object.entries(incomeGroups).map(([subType, accs]) => (
                <React.Fragment key={subType}>
                  {/* Sub-type group header */}
                  <div className="bg-slate-200 px-3 py-1 border-b border-slate-300">
                    <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">{subType.replace(/_/g, ' ')}</span>
                  </div>
                  {/* Account rows */}
                  {accs.map(a => (
                    <div key={a.id} className="flex justify-between px-3 py-1.5 text-xs hover:bg-blue-50 border-b border-slate-100">
                      <span className="text-slate-700">{a.name}</span>
                      <span className="font-mono tabular-nums text-slate-800">{fmtCurrency(a.amount)}</span>
                    </div>
                  ))}
                </React.Fragment>
              ))}
              {data.income.length === 0 && (
                <div className="px-3 py-6 text-xs text-slate-400 text-center uppercase tracking-widest">No income entries</div>
              )}
            </div>
            <div className="bg-slate-800 text-white px-3 py-2 flex justify-between font-semibold text-xs">
              <span>Total Income</span>
              <span className="font-mono tabular-nums">{fmtCurrency(data.totalIncome)}</span>
            </div>
          </div>

          {/* Expense Side */}
          <div className="border-r border-b border-slate-300 overflow-hidden">
            <div className="bg-slate-800 text-white px-4 py-2">
              <h2 className="text-xs font-bold uppercase tracking-wide">Expenses</h2>
            </div>
            <div>
              {Object.entries(expenseGroups).map(([subType, accs]) => (
                <React.Fragment key={subType}>
                  {/* Sub-type group header */}
                  <div className="bg-slate-200 px-3 py-1 border-b border-slate-300">
                    <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">{subType.replace(/_/g, ' ')}</span>
                  </div>
                  {/* Account rows */}
                  {accs.map(a => (
                    <div key={a.id} className="flex justify-between px-3 py-1.5 text-xs hover:bg-blue-50 border-b border-slate-100">
                      <span className="text-slate-700">{a.name}</span>
                      <span className="font-mono tabular-nums text-slate-800">{fmtCurrency(a.amount)}</span>
                    </div>
                  ))}
                </React.Fragment>
              ))}
              {data.expenses.length === 0 && (
                <div className="px-3 py-6 text-xs text-slate-400 text-center uppercase tracking-widest">No expense entries</div>
              )}
            </div>
            <div className="bg-slate-800 text-white px-3 py-2 flex justify-between font-semibold text-xs">
              <span>Total Expenses</span>
              <span className="font-mono tabular-nums">{fmtCurrency(data.totalExpense)}</span>
            </div>
          </div>
        </div>

        {/* Net Result Summary Bar */}
        <div className="bg-slate-800 -mx-3 md:-mx-6 overflow-hidden border-x border-b border-slate-300">
          <div className="px-6 py-4 flex justify-between items-center">
            <span className="text-xs font-bold text-white uppercase tracking-widest">{data.isProfit ? 'Net Profit' : 'Net Loss'}</span>
            <span className={`text-2xl font-bold font-mono tabular-nums ${data.isProfit ? 'text-emerald-300' : 'text-red-300'}`}>
              {fmtCurrency(data.netProfitLoss)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
