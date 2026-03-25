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
    case '0-30': return 'text-green-700 bg-green-50';
    case '31-60': return 'text-yellow-700 bg-yellow-50';
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
      const res = await api.get<AgingData>('/accounts-reports/receivables-aging');
      setData(res.data);
    } catch (err) {
      console.error('Failed to fetch receivables aging:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <div className="p-6 text-gray-500">Loading Receivables Aging...</div>;
  if (!data) return <div className="p-6 text-gray-500">Failed to load data</div>;

  const totalReceivable = data.totals.total;
  const overdue = data.totals.bucket31to60 + data.totals.bucket61to90 + data.totals.bucket90plus;
  const critical = data.totals.bucket90plus;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Receivables Aging</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Total Receivable</div>
          <div className="text-2xl font-bold text-gray-800 mt-1">{fmtCurrency(totalReceivable)}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Overdue (&gt;30 days)</div>
          <div className="text-2xl font-bold text-orange-600 mt-1">{fmtCurrency(overdue)}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Critical (&gt;90 days)</div>
          <div className="text-2xl font-bold text-red-600 mt-1">{fmtCurrency(critical)}</div>
        </div>
      </div>

      {/* Aging Table */}
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="px-4 py-3 font-medium text-gray-600">Customer</th>
              <th className="px-4 py-3 font-medium text-gray-600 text-right">0-30 days</th>
              <th className="px-4 py-3 font-medium text-gray-600 text-right">31-60 days</th>
              <th className="px-4 py-3 font-medium text-gray-600 text-right">61-90 days</th>
              <th className="px-4 py-3 font-medium text-gray-600 text-right">90+ days</th>
              <th className="px-4 py-3 font-medium text-gray-600 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.rows.map(row => (
              <tr key={row.customerId} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-800">{row.customerName}</td>
                <td className={`px-4 py-3 text-right rounded ${row.bucket0to30 > 0 ? bucketColor('0-30') : ''}`}>
                  {row.bucket0to30 > 0 ? fmtCurrency(row.bucket0to30) : '—'}
                </td>
                <td className={`px-4 py-3 text-right rounded ${row.bucket31to60 > 0 ? bucketColor('31-60') : ''}`}>
                  {row.bucket31to60 > 0 ? fmtCurrency(row.bucket31to60) : '—'}
                </td>
                <td className={`px-4 py-3 text-right rounded ${row.bucket61to90 > 0 ? bucketColor('61-90') : ''}`}>
                  {row.bucket61to90 > 0 ? fmtCurrency(row.bucket61to90) : '—'}
                </td>
                <td className={`px-4 py-3 text-right rounded ${row.bucket90plus > 0 ? bucketColor('90+') : ''}`}>
                  {row.bucket90plus > 0 ? fmtCurrency(row.bucket90plus) : '—'}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-gray-800">{fmtCurrency(row.total)}</td>
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">No receivables data</td>
              </tr>
            )}
          </tbody>
          {data.rows.length > 0 && (
            <tfoot>
              <tr className="bg-gray-50 font-semibold">
                <td className="px-4 py-3 text-gray-800">Total</td>
                <td className={`px-4 py-3 text-right ${bucketColor('0-30')}`}>{fmtCurrency(data.totals.bucket0to30)}</td>
                <td className={`px-4 py-3 text-right ${bucketColor('31-60')}`}>{fmtCurrency(data.totals.bucket31to60)}</td>
                <td className={`px-4 py-3 text-right ${bucketColor('61-90')}`}>{fmtCurrency(data.totals.bucket61to90)}</td>
                <td className={`px-4 py-3 text-right ${bucketColor('90+')}`}>{fmtCurrency(data.totals.bucket90plus)}</td>
                <td className="px-4 py-3 text-right text-gray-800">{fmtCurrency(data.totals.total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
