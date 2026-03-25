import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

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

export default function BalanceSheet() {
  const [data, setData] = useState<BSData | null>(null);
  const [loading, setLoading] = useState(true);
  const [asOn, setAsOn] = useState(new Date().toISOString().split('T')[0]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get<BSData>('/journal-entries/balance-sheet', { params: { asOn } });
      setData(res.data);
    } catch (err) {
      console.error('Failed to fetch balance sheet:', err);
    } finally {
      setLoading(false);
    }
  }, [asOn]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fmtCurrency = (n: number): string =>
    '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const groupBySubType = (accs: BSAccount[]): Record<string, BSAccount[]> => {
    const groups: Record<string, BSAccount[]> = {};
    accs.forEach(a => {
      const key = a.subType || 'Other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(a);
    });
    return groups;
  };

  if (loading) return <div className="p-6 text-gray-500">Loading Balance Sheet...</div>;
  if (!data) return <div className="p-6 text-gray-500">Failed to load data</div>;

  const renderSection = (title: string, section: BSSection, color: string) => {
    const groups = groupBySubType(section.accounts);
    return (
      <div className="bg-white rounded-lg border">
        <div className={`px-4 py-3 ${color} border-b`}>
          <h2 className="font-bold">{title}</h2>
        </div>
        <div className="p-4 space-y-3">
          {Object.entries(groups).map(([subType, accs]) => (
            <div key={subType}>
              <div className="text-xs font-medium text-gray-500 uppercase mb-1">
                {subType.replace(/_/g, ' ')}
              </div>
              {accs.map(a => (
                <div key={a.id} className="flex justify-between py-1 text-sm">
                  <span className="text-gray-700">
                    {a.code !== '—' && <span className="font-mono text-xs text-gray-400 mr-1">{a.code}</span>}
                    {a.name}
                  </span>
                  <span className={`font-mono ${a.balance < 0 ? 'text-red-600' : ''}`}>
                    {a.balance < 0 ? '-' : ''}{fmtCurrency(a.balance)}
                  </span>
                </div>
              ))}
            </div>
          ))}
          {section.accounts.length === 0 && <div className="text-gray-400 text-sm">No entries</div>}
        </div>
        <div className={`px-4 py-3 ${color} border-t flex justify-between font-bold`}>
          <span>Total {title}</span>
          <span className="font-mono">{fmtCurrency(section.total)}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Balance Sheet</h1>
        <div className={`px-3 py-1 rounded text-sm font-medium ${data.isBalanced ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {data.isBalanced ? '✓ Balanced' : `✗ Unbalanced (Diff: ₹${Math.abs(data.assets.total - data.liabilitiesAndEquity).toFixed(2)})`}
        </div>
      </div>

      {/* Date Selector */}
      <div className="flex gap-3 items-center">
        <label className="text-sm text-gray-600">As on:</label>
        <input
          type="date"
          value={asOn}
          onChange={e => setAsOn(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm"
        />
        <button
          onClick={() => setAsOn(new Date().toISOString().split('T')[0])}
          className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded text-sm hover:bg-blue-200"
        >
          Today
        </button>
        <button
          onClick={() => {
            const now = new Date();
            const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
            setAsOn(`${year + 1}-03-31`);
          }}
          className="px-3 py-1.5 bg-gray-100 rounded text-sm hover:bg-gray-200"
        >
          FY End (31 Mar)
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Left: Assets */}
        <div>
          {renderSection('Assets', data.assets, 'bg-blue-50')}
        </div>

        {/* Right: Liabilities + Equity */}
        <div className="space-y-4">
          {renderSection('Liabilities', data.liabilities, 'bg-red-50')}
          {renderSection('Equity', data.equity, 'bg-purple-50')}

          {/* Combined Total */}
          <div className="bg-gray-800 text-white rounded-lg p-4 flex justify-between font-bold">
            <span>Total Liabilities + Equity</span>
            <span className="font-mono">{fmtCurrency(data.liabilitiesAndEquity)}</span>
          </div>
        </div>
      </div>

      {/* Bottom comparison */}
      <div className="bg-white rounded-lg border p-4 grid grid-cols-2 gap-4">
        <div className="text-center">
          <div className="text-sm text-gray-500">Total Assets</div>
          <div className="text-2xl font-bold text-blue-800 font-mono">{fmtCurrency(data.assets.total)}</div>
        </div>
        <div className="text-center">
          <div className="text-sm text-gray-500">Liabilities + Equity</div>
          <div className="text-2xl font-bold text-purple-800 font-mono">{fmtCurrency(data.liabilitiesAndEquity)}</div>
        </div>
      </div>
    </div>
  );
}
