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
    '\u20B9' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const groupBySubType = (accs: BSAccount[]): Record<string, BSAccount[]> => {
    const groups: Record<string, BSAccount[]> = {};
    accs.forEach(a => {
      const key = a.subType || 'Other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(a);
    });
    return groups;
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

  const renderSection = (title: string, section: BSSection) => {
    const groups = groupBySubType(section.accounts);
    return (
      <div className="border border-slate-300 overflow-hidden">
        <div className="bg-slate-800 text-white px-4 py-2">
          <h2 className="text-xs font-bold uppercase tracking-wide">{title}</h2>
        </div>
        <div>
          {Object.entries(groups).map(([subType, accs]) => (
            <React.Fragment key={subType}>
              {/* Sub-type group header */}
              <div className="bg-slate-200 px-3 py-1 border-b border-slate-300">
                <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">
                  {subType.replace(/_/g, ' ')}
                </span>
              </div>
              {/* Account rows */}
              {accs.map(a => (
                <div key={a.id} className="flex justify-between px-3 py-1.5 text-xs hover:bg-blue-50 border-b border-slate-100">
                  <span className="text-slate-700">
                    {a.code !== '--' && <span className="font-mono text-[10px] text-slate-400 mr-1">{a.code}</span>}
                    {a.name}
                  </span>
                  <span className={`font-mono tabular-nums ${a.balance < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                    {a.balance < 0 ? '-' : ''}{fmtCurrency(a.balance)}
                  </span>
                </div>
              ))}
            </React.Fragment>
          ))}
          {section.accounts.length === 0 && (
            <div className="px-3 py-6 text-xs text-slate-400 text-center uppercase tracking-widest">No entries</div>
          )}
        </div>
        <div className="bg-slate-800 text-white px-3 py-2 flex justify-between font-semibold text-xs">
          <span>Total {title}</span>
          <span className="font-mono tabular-nums">{fmtCurrency(section.total)}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Balance Sheet</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Statement of financial position as on date</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${data.isBalanced ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200' : 'border-red-400/50 bg-red-500/20 text-red-200'}`}>
              {data.isBalanced ? 'Balanced' : `Unbalanced (Diff: \u20B9${Math.abs(data.assets.total - data.liabilitiesAndEquity).toFixed(2)})`}
            </span>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-4 flex-wrap">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">As On Date</label>
            <input
              type="date"
              value={asOn}
              onChange={e => setAsOn(e.target.value)}
              className="border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              onClick={() => setAsOn(new Date().toISOString().split('T')[0])}
              className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700"
            >
              Today
            </button>
            <button
              onClick={() => {
                const now = new Date();
                const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
                setAsOn(`${year + 1}-03-31`);
              }}
              className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50"
            >
              FY End (31 Mar)
            </button>
          </div>
        </div>

        {/* Two Column Layout */}
        <div className="grid grid-cols-2 gap-0 -mx-3 md:-mx-6 border-x border-slate-300">
          {/* Left: Assets */}
          <div className="border-r border-slate-300">
            {renderSection('Assets', data.assets)}
          </div>

          {/* Right: Liabilities + Equity */}
          <div>
            {renderSection('Liabilities', data.liabilities)}
            {renderSection('Equity', data.equity)}

            {/* Combined Total */}
            <div className="bg-slate-800 overflow-hidden border-t border-slate-700">
              <div className="px-4 py-3 flex justify-between items-center">
                <span className="text-xs font-bold text-white uppercase tracking-widest">Total Liabilities + Equity</span>
                <span className="text-lg font-bold font-mono tabular-nums text-white">{fmtCurrency(data.liabilitiesAndEquity)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Comparison Bar */}
        <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 overflow-hidden">
          <div className="grid grid-cols-2 divide-x divide-slate-300">
            <div className="px-6 py-4 text-center bg-white">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Assets</div>
              <div className="text-2xl font-bold text-slate-800 font-mono tabular-nums mt-1">{fmtCurrency(data.assets.total)}</div>
            </div>
            <div className="px-6 py-4 text-center bg-white">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Liabilities + Equity</div>
              <div className="text-2xl font-bold text-slate-800 font-mono tabular-nums mt-1">{fmtCurrency(data.liabilitiesAndEquity)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
