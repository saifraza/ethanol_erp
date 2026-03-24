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
      const res = await api.get<PLData>('/api/journal-entries/profit-loss', { params });
      setData(res.data);
    } catch (err) {
      console.error('Failed to fetch P&L:', err);
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fmtCurrency = (n: number): string =>
    '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

  if (loading) return <div className="p-6 text-gray-500">Loading Profit & Loss...</div>;
  if (!data) return <div className="p-6 text-gray-500">Failed to load data</div>;

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
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Profit & Loss Statement</h1>
        <div className={`px-4 py-2 rounded-lg font-bold text-lg ${data.isProfit ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          {data.isProfit ? 'Net Profit' : 'Net Loss'}: {fmtCurrency(data.netProfitLoss)}
        </div>
      </div>

      {/* Period Selector */}
      <div className="flex gap-3 items-center flex-wrap">
        <input type="date" value={dateRange.from} onChange={e => setDateRange(f => ({ ...f, from: e.target.value }))} className="border rounded px-3 py-1.5 text-sm" />
        <span className="text-gray-400">to</span>
        <input type="date" value={dateRange.to} onChange={e => setDateRange(f => ({ ...f, to: e.target.value }))} className="border rounded px-3 py-1.5 text-sm" />
        <button onClick={setCurrentMonth} className="px-3 py-1.5 bg-gray-100 rounded text-sm hover:bg-gray-200">This Month</button>
        <button onClick={setFY} className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded text-sm hover:bg-blue-200">Current FY</button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Income Side */}
        <div className="bg-white rounded-lg border">
          <div className="px-4 py-3 bg-green-50 border-b">
            <h2 className="font-bold text-green-800">Income</h2>
          </div>
          <div className="p-4 space-y-3">
            {Object.entries(incomeGroups).map(([subType, accs]) => (
              <div key={subType}>
                <div className="text-xs font-medium text-gray-500 uppercase mb-1">{subType.replace(/_/g, ' ')}</div>
                {accs.map(a => (
                  <div key={a.id} className="flex justify-between py-1 text-sm">
                    <span className="text-gray-700">{a.name}</span>
                    <span className="font-mono">{fmtCurrency(a.amount)}</span>
                  </div>
                ))}
              </div>
            ))}
            {data.income.length === 0 && <div className="text-gray-400 text-sm">No income entries</div>}
          </div>
          <div className="px-4 py-3 bg-green-50 border-t flex justify-between font-bold">
            <span>Total Income</span>
            <span className="font-mono">{fmtCurrency(data.totalIncome)}</span>
          </div>
        </div>

        {/* Expense Side */}
        <div className="bg-white rounded-lg border">
          <div className="px-4 py-3 bg-red-50 border-b">
            <h2 className="font-bold text-red-800">Expenses</h2>
          </div>
          <div className="p-4 space-y-3">
            {Object.entries(expenseGroups).map(([subType, accs]) => (
              <div key={subType}>
                <div className="text-xs font-medium text-gray-500 uppercase mb-1">{subType.replace(/_/g, ' ')}</div>
                {accs.map(a => (
                  <div key={a.id} className="flex justify-between py-1 text-sm">
                    <span className="text-gray-700">{a.name}</span>
                    <span className="font-mono">{fmtCurrency(a.amount)}</span>
                  </div>
                ))}
              </div>
            ))}
            {data.expenses.length === 0 && <div className="text-gray-400 text-sm">No expense entries</div>}
          </div>
          <div className="px-4 py-3 bg-red-50 border-t flex justify-between font-bold">
            <span>Total Expenses</span>
            <span className="font-mono">{fmtCurrency(data.totalExpense)}</span>
          </div>
        </div>
      </div>

      {/* Net Result */}
      <div className={`rounded-lg border-2 p-4 flex justify-between items-center ${data.isProfit ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50'}`}>
        <span className="text-lg font-bold">{data.isProfit ? 'Net Profit' : 'Net Loss'}</span>
        <span className={`text-2xl font-bold font-mono ${data.isProfit ? 'text-green-800' : 'text-red-800'}`}>
          {fmtCurrency(data.netProfitLoss)}
        </span>
      </div>
    </div>
  );
}
