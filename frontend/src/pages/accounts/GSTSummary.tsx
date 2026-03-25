import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface GSTLine {
  code: string;
  name: string;
  amount: number;
}

interface GSTData {
  outputGST: GSTLine[];
  inputGST: GSTLine[];
  totalOutput: number;
  totalInput: number;
  netPayable: number;
}

const fmtCurrency = (n: number): string => {
  if (n === 0) return '—';
  return '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function GSTSummary() {
  const [data, setData] = useState<GSTData | null>(null);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState({ from: '', to: '' });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {};
      if (dateRange.from) params.from = dateRange.from;
      if (dateRange.to) params.to = dateRange.to;
      const res = await api.get<GSTData>('/accounts-reports/gst-summary', { params });
      setData(res.data);
    } catch (err) {
      console.error('Failed to fetch GST summary:', err);
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">GST Summary (GSTR-3B Helper)</h1>
        <button
          onClick={() => window.print()}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 print:hidden"
        >
          Print
        </button>
      </div>

      {/* Date Range */}
      <div className="bg-white rounded-lg shadow p-4 flex flex-wrap gap-4 items-end print:hidden">
        <div>
          <label className="block text-xs text-gray-500 mb-1">From</label>
          <input
            type="date"
            value={dateRange.from}
            onChange={e => setDateRange(prev => ({ ...prev, from: e.target.value }))}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">To</label>
          <input
            type="date"
            value={dateRange.to}
            onChange={e => setDateRange(prev => ({ ...prev, to: e.target.value }))}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>

      {loading && <div className="p-6 text-gray-500">Loading GST Summary...</div>}

      {!loading && data && (
        <>
          {/* Net Payable Card */}
          <div className={`rounded-lg shadow p-6 text-center ${data.netPayable >= 0 ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
            <div className="text-sm text-gray-600 uppercase tracking-wide">
              {data.netPayable >= 0 ? 'Net GST Payable' : 'Net GST Refundable'}
            </div>
            <div className={`text-3xl font-bold mt-2 ${data.netPayable >= 0 ? 'text-red-700' : 'text-green-700'}`}>
              {fmtCurrency(data.netPayable)}
            </div>
            <div className="text-xs text-gray-500 mt-1">Output GST ({fmtCurrency(data.totalOutput)}) minus Input GST ({fmtCurrency(data.totalInput)})</div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Output GST */}
            <div className="bg-white rounded-lg shadow">
              <div className="px-4 py-3 border-b bg-red-50">
                <h2 className="text-sm font-semibold text-red-800 uppercase tracking-wide">Output GST (Liability)</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-4 py-2 font-medium text-gray-600">Code</th>
                    <th className="px-4 py-2 font-medium text-gray-600">Account</th>
                    <th className="px-4 py-2 font-medium text-gray-600 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.outputGST.map(line => (
                    <tr key={line.code}>
                      <td className="px-4 py-2 text-gray-500 font-mono">{line.code}</td>
                      <td className="px-4 py-2 text-gray-700">{line.name}</td>
                      <td className="px-4 py-2 text-right text-gray-800 font-medium">{fmtCurrency(line.amount)}</td>
                    </tr>
                  ))}
                  {data.outputGST.length === 0 && (
                    <tr><td colSpan={3} className="px-4 py-4 text-center text-gray-400">No output GST entries</td></tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-red-50 font-semibold">
                    <td colSpan={2} className="px-4 py-2 text-red-800">Total Output GST</td>
                    <td className="px-4 py-2 text-right text-red-800">{fmtCurrency(data.totalOutput)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Input GST */}
            <div className="bg-white rounded-lg shadow">
              <div className="px-4 py-3 border-b bg-green-50">
                <h2 className="text-sm font-semibold text-green-800 uppercase tracking-wide">Input GST (Credit)</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-4 py-2 font-medium text-gray-600">Code</th>
                    <th className="px-4 py-2 font-medium text-gray-600">Account</th>
                    <th className="px-4 py-2 font-medium text-gray-600 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.inputGST.map(line => (
                    <tr key={line.code}>
                      <td className="px-4 py-2 text-gray-500 font-mono">{line.code}</td>
                      <td className="px-4 py-2 text-gray-700">{line.name}</td>
                      <td className="px-4 py-2 text-right text-gray-800 font-medium">{fmtCurrency(line.amount)}</td>
                    </tr>
                  ))}
                  {data.inputGST.length === 0 && (
                    <tr><td colSpan={3} className="px-4 py-4 text-center text-gray-400">No input GST entries</td></tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-green-50 font-semibold">
                    <td colSpan={2} className="px-4 py-2 text-green-800">Total Input GST</td>
                    <td className="px-4 py-2 text-right text-green-800">{fmtCurrency(data.totalInput)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Print footer */}
          <div className="text-center text-xs text-gray-400 mt-4 print:block hidden">
            Generated from MSPIL Distillery ERP — {new Date().toLocaleDateString('en-IN')}
          </div>
        </>
      )}

      {!loading && !data && (
        <div className="p-6 text-gray-500 text-center">Select a date range to view GST summary</div>
      )}
    </div>
  );
}
