import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface LedgerEntry {
  date: string;
  entryNo: number;
  narration: string;
  debit: number;
  credit: number;
  balance: number;
  journalId: string;
  refType: string | null;
}

interface CashBookData {
  account: { id: string; code: string; name: string };
  openingBalance: number;
  entries: LedgerEntry[];
  closingBalance: number;
}

const fmt = (n: number) => n === 0 ? '--' : '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });

export default function CashBook() {
  const [data, setData] = useState<CashBookData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {};
      if (dateFrom) params.from = dateFrom;
      if (dateTo) params.to = dateTo;
      const res = await api.get<CashBookData>('/accounts-reports/cash-book', { params });
      setData(res.data);
    } catch (err) {
      console.error('Failed to fetch cash book:', err);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalIn = data?.entries.reduce((s, e) => s + e.debit, 0) || 0;
  const totalOut = data?.entries.reduce((s, e) => s + e.credit, 0) || 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Cash Book</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">All Cash In &amp; Out</span>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-[10px] text-red-500 hover:text-red-700">Clear</button>
            )}
          </div>
        </div>

        {/* KPI Strip */}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Opening Balance</div>
              <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmt(data.openingBalance)}</div>
            </div>
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Cash In</div>
              <div className="text-xl font-bold text-green-700 mt-1 font-mono tabular-nums">{fmt(totalIn)}</div>
            </div>
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-red-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Cash Out</div>
              <div className="text-xl font-bold text-red-600 mt-1 font-mono tabular-nums">{fmt(totalOut)}</div>
            </div>
            <div className="bg-white px-4 py-3 border-l-4 border-l-amber-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Closing Balance</div>
              <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmt(data.closingBalance)}</div>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400 uppercase tracking-widest bg-white">Loading...</div>
          ) : !data || data.entries.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 uppercase tracking-widest bg-white">No cash transactions found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Date</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">#</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Narration</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Type</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Cash In (Dr)</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Cash Out (Cr)</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((e, i) => (
                    <tr key={`${e.journalId}-${i}`} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                      <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100 whitespace-nowrap">{fmtDate(e.date)}</td>
                      <td className="px-3 py-1.5 text-slate-400 font-mono text-[11px] border-r border-slate-100">{e.entryNo}</td>
                      <td className="px-3 py-1.5 text-slate-800 border-r border-slate-100">{e.narration}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100">
                        {e.refType && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-300 bg-slate-50 text-slate-600">{e.refType}</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">
                        {e.debit > 0 ? <span className="text-green-700">{fmt(e.debit)}</span> : '--'}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">
                        {e.credit > 0 ? <span className="text-red-600">{fmt(e.credit)}</span> : '--'}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 font-medium">{fmt(e.balance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-800 text-white font-semibold">
                    <td className="px-3 py-2 text-[10px] uppercase tracking-widest" colSpan={4}>Total ({data.entries.length} entries)</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(totalIn)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(totalOut)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(data.closingBalance)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
