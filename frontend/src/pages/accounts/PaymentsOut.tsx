import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface OutPayment {
  id: string;
  date: string;
  payee: string;
  payeeType: 'VENDOR' | 'TRANSPORTER' | 'CASH';
  amount: number;
  mode: string;
  reference: string | null;
  remarks: string | null;
  source: string;
  sourceRef: string | null;
}

interface Summary {
  totalThisMonth: number;
  vendors: { total: number; count: number };
  transporters: { total: number; count: number };
  cash: { total: number; count: number };
}

const MODES = ['CASH', 'UPI', 'NEFT', 'RTGS', 'BANK_TRANSFER', 'CHEQUE'];
const TYPES = [
  { key: '', label: 'ALL' },
  { key: 'VENDOR', label: 'VENDOR' },
  { key: 'TRANSPORTER', label: 'TRANSPORTER' },
  { key: 'CASH', label: 'CASH / CONTRACTOR' },
];

const fmt = (n: number) => n === 0 ? '--' : '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });

export default function PaymentsOut() {
  const [data, setData] = useState<OutPayment[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterType, setFilterType] = useState('');
  const [filterMode, setFilterMode] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {};
      if (filterType) params.type = filterType;
      if (filterMode) params.mode = filterMode;
      if (dateFrom) params.from = dateFrom;
      if (dateTo) params.to = dateTo;

      const [listRes, summaryRes] = await Promise.all([
        api.get<{ items: OutPayment[]; total: number }>('/unified-payments/outgoing', { params }),
        api.get<Summary>('/unified-payments/outgoing/summary'),
      ]);
      setData(listRes.data.items || []);
      setTotal(listRes.data.total || 0);
      setSummary(summaryRes.data);
    } catch (err) {
      console.error('Failed to fetch outgoing payments:', err);
    } finally {
      setLoading(false);
    }
  }, [filterType, filterMode, dateFrom, dateTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const typeColor = (t: string) => {
    switch (t) {
      case 'VENDOR': return 'border-blue-400 bg-blue-50 text-blue-700';
      case 'TRANSPORTER': return 'border-amber-400 bg-amber-50 text-amber-700';
      case 'CASH': return 'border-green-400 bg-green-50 text-green-700';
      default: return 'border-slate-300 bg-slate-50 text-slate-600';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Payments Out</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">All Outgoing Payments</span>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-4 flex-wrap">
          <div className="flex gap-1">
            {TYPES.map(t => (
              <button key={t.key} onClick={() => setFilterType(t.key)}
                className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest border ${filterType === t.key ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Mode</label>
            <select value={filterMode} onChange={e => setFilterMode(e.target.value)}
              className="border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
              <option value="">All</option>
              {MODES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
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
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-red-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total This Month</div>
              <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmt(summary.totalThisMonth)}</div>
            </div>
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Vendors</div>
              <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmt(summary.vendors.total)}</div>
              <div className="text-[10px] text-slate-400">{summary.vendors.count} payments</div>
            </div>
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-amber-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Transporters</div>
              <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmt(summary.transporters.total)}</div>
              <div className="text-[10px] text-slate-400">{summary.transporters.count} payments</div>
            </div>
            <div className="bg-white px-4 py-3 border-l-4 border-l-green-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Cash / Contractors</div>
              <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmt(summary.cash.total)}</div>
              <div className="text-[10px] text-slate-400">{summary.cash.count} vouchers</div>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400 uppercase tracking-widest bg-white">Loading...</div>
          ) : data.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 uppercase tracking-widest bg-white">No outgoing payments found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Date</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Payee</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Type</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Amount</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Mode</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Reference</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Ref Doc</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((p, i) => (
                    <tr key={p.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                      <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100 whitespace-nowrap">{fmtDate(p.date)}</td>
                      <td className="px-3 py-1.5 text-slate-800 font-medium border-r border-slate-100">{p.payee}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${typeColor(p.payeeType)}`}>{p.payeeType}</span>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 border-r border-slate-100">{fmt(p.amount)}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100">
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-300 bg-slate-50 text-slate-600">{p.mode}</span>
                      </td>
                      <td className="px-3 py-1.5 text-slate-500 font-mono text-[11px] border-r border-slate-100">{p.reference || '--'}</td>
                      <td className="px-3 py-1.5 text-slate-500 text-[11px] border-r border-slate-100">{p.sourceRef || '--'}</td>
                      <td className="px-3 py-1.5 text-slate-400 text-[11px] max-w-[200px] truncate">{p.remarks || '--'}</td>
                    </tr>
                  ))}
                </tbody>
                {data.length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-800 text-white font-semibold">
                      <td className="px-3 py-2 text-[10px] uppercase tracking-widest" colSpan={3}>Total ({total} payments)</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(data.reduce((s, p) => s + p.amount, 0))}</td>
                      <td colSpan={4}></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
