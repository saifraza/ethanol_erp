import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface AgingRow {
  customerId: string;
  customerName: string;
  bucket0to30: number;
  bucket31to60: number;
  bucket61to90: number;
  bucket90plus: number;
  total: number;
}

interface AgingData {
  rows: AgingRow[];
  totals: {
    bucket0to30: number;
    bucket31to60: number;
    bucket61to90: number;
    bucket90plus: number;
    total: number;
  };
}

const fmtCurrency = (n: number): string => {
  if (n === 0) return '—';
  return '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const bucketColor = (bucket: string): string => {
  switch (bucket) {
    case '0-30': return 'text-emerald-700 bg-emerald-50';
    case '31-60': return 'text-amber-700 bg-amber-50';
    case '61-90': return 'text-orange-700 bg-orange-50';
    case '90+': return 'text-red-700 bg-red-50';
    default: return '';
  }
};

export default function ReceivablesAging() {
  const [data, setData] = useState<AgingData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/accounts-reports/receivables-aging');
      const d = res.data;
      // Backend returns { customers: [{ customerId, customerName, buckets: {'0-30': N, ...}, total }], totals, grandTotal }
      const rows: AgingRow[] = (d.customers ?? []).map((c: { customerId: string; customerName: string; buckets: Record<string, number>; total: number }) => ({
        customerId: c.customerId,
        customerName: c.customerName,
        bucket0to30: c.buckets?.['0-30'] ?? 0,
        bucket31to60: c.buckets?.['31-60'] ?? 0,
        bucket61to90: c.buckets?.['61-90'] ?? 0,
        bucket90plus: c.buckets?.['90+'] ?? 0,
        total: c.total ?? 0,
      }));
      const t = d.totals ?? {};
      setData({
        rows,
        totals: {
          bucket0to30: t['0-30'] ?? 0,
          bucket31to60: t['31-60'] ?? 0,
          bucket61to90: t['61-90'] ?? 0,
          bucket90plus: t['90+'] ?? 0,
          total: d.grandTotal ?? 0,
        },
      });
    } catch (err) {
      console.error('Failed to fetch receivables aging:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-xs text-slate-400">Loading Receivables Aging...</div>
      </div>
    );
  }

  if (!data || !data.rows) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-xs text-slate-400">No receivables aging data available</div>
      </div>
    );
  }

  const totalReceivable = data.totals?.total ?? 0;
  const overdue = (data.totals?.bucket31to60 ?? 0) + (data.totals?.bucket61to90 ?? 0) + (data.totals?.bucket90plus ?? 0);
  const critical = data.totals?.bucket90plus ?? 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* ── Page toolbar ── */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Receivables Aging</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Accounts Receivable Analysis</span>
          </div>
        </div>

        {/* ── KPI strip ── */}
        <div className="grid grid-cols-3 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="bg-white px-4 py-3 border-r border-slate-300">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Total Receivable</div>
            <div className="text-xl font-bold text-slate-800 font-mono tabular-nums">{fmtCurrency(totalReceivable)}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Overdue (&gt;30 days)</div>
            <div className="text-xl font-bold text-amber-700 font-mono tabular-nums">{fmtCurrency(overdue)}</div>
          </div>
          <div className="bg-white px-4 py-3">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Critical (&gt;90 days)</div>
            <div className="text-xl font-bold text-red-700 font-mono tabular-nums">{fmtCurrency(critical)}</div>
          </div>
        </div>

        {/* ── Aging Table ── */}
        <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Customer</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">0-30 Days</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">31-60 Days</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">61-90 Days</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">90+ Days</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(row => (
                  <tr key={row.customerId} className="border-t border-slate-200 hover:bg-blue-50/30 even:bg-slate-50/50">
                    <td className="px-3 py-1.5 font-medium text-slate-800 border-r border-slate-100">{row.customerName}</td>
                    <td className={`px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100 ${row.bucket0to30 > 0 ? bucketColor('0-30') : 'text-slate-400'}`}>
                      {row.bucket0to30 > 0 ? fmtCurrency(row.bucket0to30) : '—'}
                    </td>
                    <td className={`px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100 ${row.bucket31to60 > 0 ? bucketColor('31-60') : 'text-slate-400'}`}>
                      {row.bucket31to60 > 0 ? fmtCurrency(row.bucket31to60) : '—'}
                    </td>
                    <td className={`px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100 ${row.bucket61to90 > 0 ? bucketColor('61-90') : 'text-slate-400'}`}>
                      {row.bucket61to90 > 0 ? fmtCurrency(row.bucket61to90) : '—'}
                    </td>
                    <td className={`px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100 ${row.bucket90plus > 0 ? bucketColor('90+') : 'text-slate-400'}`}>
                      {row.bucket90plus > 0 ? fmtCurrency(row.bucket90plus) : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right font-semibold text-slate-800 font-mono tabular-nums">{fmtCurrency(row.total)}</td>
                  </tr>
                ))}
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-slate-400 text-xs">No receivables data</td>
                  </tr>
                )}
              </tbody>
              {data.rows.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-800 text-white font-semibold text-xs">
                    <td className="px-3 py-2 border-r border-slate-700">Total</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-700">{fmtCurrency(data.totals.bucket0to30)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-700">{fmtCurrency(data.totals.bucket31to60)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-700">{fmtCurrency(data.totals.bucket61to90)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-700">{fmtCurrency(data.totals.bucket90plus)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtCurrency(data.totals.total)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
