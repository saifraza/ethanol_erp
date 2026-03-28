import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface InPayment {
  id: string;
  paymentNo: number;
  date: string;
  payer: string;
  amount: number;
  mode: string;
  reference: string | null;
  invoiceRef: string | null;
  remarks: string | null;
}

interface Summary {
  totalThisMonth: number;
  count: number;
  byMode: Record<string, { total: number; count: number }>;
}

interface Customer {
  id: string;
  name: string;
}

const MODES = ['CASH', 'UPI', 'NEFT', 'RTGS', 'BANK_TRANSFER', 'CHEQUE'];
const fmt = (n: number) => n === 0 ? '--' : '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });

export default function PaymentsIn() {
  const [data, setData] = useState<InPayment[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterCustomer, setFilterCustomer] = useState('');
  const [filterMode, setFilterMode] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {};
      if (filterCustomer) params.customerId = filterCustomer;
      if (filterMode) params.mode = filterMode;
      if (dateFrom) params.from = dateFrom;
      if (dateTo) params.to = dateTo;

      const [listRes, summaryRes] = await Promise.all([
        api.get<{ items: InPayment[]; total: number }>('/unified-payments/incoming', { params }),
        api.get<Summary>('/unified-payments/incoming/summary'),
      ]);
      setData(listRes.data.items || []);
      setTotal(listRes.data.total || 0);
      setSummary(summaryRes.data);
    } catch (err) {
      console.error('Failed to fetch incoming payments:', err);
    } finally {
      setLoading(false);
    }
  }, [filterCustomer, filterMode, dateFrom, dateTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    api.get<Customer[]>('/customers', { params: { limit: 200 } }).then(r => {
      const list = Array.isArray(r.data) ? r.data : (r.data as { items?: Customer[] }).items || [];
      setCustomers(list);
    }).catch(() => {});
  }, []);

  const topModes = summary?.byMode ? Object.entries(summary.byMode).sort((a, b) => b[1].total - a[1].total).slice(0, 3) : [];

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Payments In</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">All Incoming Payments</span>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-4 flex-wrap">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Customer</label>
            <select value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)}
              className="ml-2 border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
              <option value="">All Customers</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
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
          <div className={`grid grid-cols-2 md:grid-cols-${2 + topModes.length} gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6`}>
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Received This Month</div>
              <div className="text-xl font-bold text-green-700 mt-1 font-mono tabular-nums">{fmt(summary.totalThisMonth)}</div>
              <div className="text-[10px] text-slate-400">{summary.count} payments</div>
            </div>
            {topModes.map(([mode, stats]) => (
              <div key={mode} className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{mode}</div>
                <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmt(stats.total)}</div>
                <div className="text-[10px] text-slate-400">{stats.count} payments</div>
              </div>
            ))}
          </div>
        )}

        {/* Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400 uppercase tracking-widest bg-white">Loading...</div>
          ) : data.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 uppercase tracking-widest bg-white">No incoming payments found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">#</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Date</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Customer</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Amount</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Mode</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Reference</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Invoice</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((p, i) => (
                    <tr key={p.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                      <td className="px-3 py-1.5 text-slate-400 font-mono text-[11px] border-r border-slate-100">{p.paymentNo}</td>
                      <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100 whitespace-nowrap">{fmtDate(p.date)}</td>
                      <td className="px-3 py-1.5 text-slate-800 font-medium border-r border-slate-100">{p.payer}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-green-700 font-medium border-r border-slate-100">{fmt(p.amount)}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100">
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-300 bg-slate-50 text-slate-600">{p.mode}</span>
                      </td>
                      <td className="px-3 py-1.5 text-slate-500 font-mono text-[11px] border-r border-slate-100">{p.reference || '--'}</td>
                      <td className="px-3 py-1.5 text-slate-500 text-[11px] border-r border-slate-100">{p.invoiceRef || '--'}</td>
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
