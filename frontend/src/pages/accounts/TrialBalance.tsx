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
    if (n === 0) return '—';
    return '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  if (loading) return <div className="p-6 text-gray-500">Loading Trial Balance...</div>;
  if (!data) return <div className="p-6 text-gray-500">Failed to load data</div>;

  // Group rows by type
  const groupedRows = TYPE_ORDER.map(type => ({
    type,
    rows: data.rows.filter(r => r.type === type),
    totalDebit: data.rows.filter(r => r.type === type).reduce((s, r) => s + r.debit, 0),
    totalCredit: data.rows.filter(r => r.type === type).reduce((s, r) => s + r.credit, 0),
  })).filter(g => g.rows.length > 0);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Trial Balance</h1>
        <div className={`px-3 py-1 rounded text-sm font-medium ${data.isBalanced ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {data.isBalanced ? '✓ Balanced' : `✗ Unbalanced (Diff: ₹${Math.abs(data.totalDebit - data.totalCredit).toFixed(2)})`}
        </div>
      </div>

      {/* Date Range */}
      <div className="flex gap-3 items-center">
        <input
          type="date"
          value={dateRange.from}
          onChange={e => setDateRange(f => ({ ...f, from: e.target.value }))}
          className="border rounded px-3 py-1.5 text-sm"
        />
        <span className="text-gray-400">to</span>
        <input
          type="date"
          value={dateRange.to}
          onChange={e => setDateRange(f => ({ ...f, to: e.target.value }))}
          className="border rounded px-3 py-1.5 text-sm"
        />
      </div>

      {/* Trial Balance Table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-800 text-white">
            <tr>
              <th className="text-left px-4 py-2.5">Code</th>
              <th className="text-left px-4 py-2.5">Account Name</th>
              <th className="text-right px-4 py-2.5">Debit (₹)</th>
              <th className="text-right px-4 py-2.5">Credit (₹)</th>
            </tr>
          </thead>
          <tbody>
            {groupedRows.map(group => (
              <React.Fragment key={group.type}>
                {/* Group Header */}
                <tr className="bg-gray-100">
                  <td colSpan={4} className="px-4 py-2 font-bold text-gray-700 text-xs uppercase tracking-wider">
                    {group.type}
                  </td>
                </tr>
                {group.rows.map(row => (
                  <tr key={row.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-xs text-gray-500">{row.code}</td>
                    <td className="px-4 py-2">{row.name}</td>
                    <td className="px-4 py-2 text-right font-mono">{row.debit > 0 ? fmtCurrency(row.debit) : ''}</td>
                    <td className="px-4 py-2 text-right font-mono">{row.credit > 0 ? fmtCurrency(row.credit) : ''}</td>
                  </tr>
                ))}
                {/* Group Subtotal */}
                <tr className="bg-gray-50 border-b">
                  <td colSpan={2} className="px-4 py-1.5 text-right text-xs font-medium text-gray-500">
                    {group.type} Subtotal
                  </td>
                  <td className="px-4 py-1.5 text-right font-mono font-medium text-xs">
                    {group.totalDebit > 0 ? fmtCurrency(group.totalDebit) : ''}
                  </td>
                  <td className="px-4 py-1.5 text-right font-mono font-medium text-xs">
                    {group.totalCredit > 0 ? fmtCurrency(group.totalCredit) : ''}
                  </td>
                </tr>
              </React.Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-800 text-white font-bold">
              <td colSpan={2} className="px-4 py-3 text-right">Grand Total</td>
              <td className="px-4 py-3 text-right font-mono">{fmtCurrency(data.totalDebit)}</td>
              <td className="px-4 py-3 text-right font-mono">{fmtCurrency(data.totalCredit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {data.rows.length === 0 && (
        <div className="text-center py-8 text-gray-400">No transactions found. Create journal entries first.</div>
      )}
    </div>
  );
}
