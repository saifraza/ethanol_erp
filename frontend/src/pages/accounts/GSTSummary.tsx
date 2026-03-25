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
  // Default to current financial year (April 1 - March 31)
  const [dateRange, setDateRange] = useState(() => {
    const now = new Date();
    const fyStart = now.getMonth() >= 3
      ? `${now.getFullYear()}-04-01`
      : `${now.getFullYear() - 1}-04-01`;
    const today = now.toISOString().slice(0, 10);
    return { from: fyStart, to: today };
  });

  const fetchData = useCallback(async () => {
    if (!dateRange.from || !dateRange.to) return;
    try {
      setLoading(true);
      const res = await api.get('/accounts-reports/gst-summary', {
        params: { from: dateRange.from, to: dateRange.to },
      });
      const d = res.data;
      // Backend returns { output: { cgst, sgst, igst, total }, input: {...}, netPayable }
      // Transform to match component's GSTData interface
      setData({
        outputGST: [
          { code: 'CGST', name: 'Central GST', amount: d.output?.cgst ?? 0 },
          { code: 'SGST', name: 'State GST', amount: d.output?.sgst ?? 0 },
          { code: 'IGST', name: 'Integrated GST', amount: d.output?.igst ?? 0 },
        ],
        inputGST: [
          { code: 'CGST', name: 'Central GST', amount: d.input?.cgst ?? 0 },
          { code: 'SGST', name: 'State GST', amount: d.input?.sgst ?? 0 },
          { code: 'IGST', name: 'Integrated GST', amount: d.input?.igst ?? 0 },
        ],
        totalOutput: d.output?.total ?? 0,
        totalInput: d.input?.total ?? 0,
        netPayable: d.netPayable ?? 0,
      });
    } catch (err) {
      console.error('Failed to fetch GST summary:', err);
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-xs text-slate-400">Loading GST Summary...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* ── Page toolbar ── */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">GST Summary</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">GSTR-3B Helper — Tax Liability and Input Credit</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="px-3 py-1 border border-slate-400 text-slate-300 text-[11px] hover:bg-slate-700 print:hidden"
            >
              Print
            </button>
          </div>
        </div>

        {/* ── Date Range Filter ── */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-4 flex-wrap print:hidden">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">From</label>
            <input
              type="date"
              value={dateRange.from}
              onChange={e => setDateRange(prev => ({ ...prev, from: e.target.value }))}
              className="border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">To</label>
            <input
              type="date"
              value={dateRange.to}
              onChange={e => setDateRange(prev => ({ ...prev, to: e.target.value }))}
              className="border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400"
            />
          </div>
        </div>

        {!loading && data && (
          <>
            {/* ── Net Payable / Refundable KPI ── */}
            <div className="grid grid-cols-1 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
              <div className="bg-white px-4 py-4">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">
                  {data.netPayable >= 0 ? 'Net GST Payable' : 'Net GST Refundable'}
                </div>
                <div className={`text-2xl font-bold font-mono tabular-nums ${data.netPayable >= 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                  {fmtCurrency(data.netPayable)}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  Output GST ({fmtCurrency(data.totalOutput)}) minus Input GST ({fmtCurrency(data.totalInput)})
                </div>
              </div>
            </div>

            {/* ── Output and Input GST Tables ── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-0 -mx-3 md:-mx-6">
              {/* Output GST */}
              <div className="border-x border-b border-slate-300 overflow-hidden">
                <div className="bg-slate-800 text-white px-4 py-2">
                  <h2 className="text-[11px] font-bold uppercase tracking-widest">Output GST (Liability)</h2>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-800 text-white">
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Code</th>
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Account</th>
                      <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.outputGST.map(line => (
                      <tr key={line.code} className="border-t border-slate-200 hover:bg-blue-50/30 even:bg-slate-50/50">
                        <td className="px-3 py-1.5 text-slate-500 font-mono border-r border-slate-100">{line.code}</td>
                        <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{line.name}</td>
                        <td className="px-3 py-1.5 text-right text-slate-800 font-medium font-mono tabular-nums">{fmtCurrency(line.amount)}</td>
                      </tr>
                    ))}
                    {data.outputGST.length === 0 && (
                      <tr><td colSpan={3} className="px-3 py-4 text-center text-slate-400 text-xs">No output GST entries</td></tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-800 text-white font-semibold text-xs">
                      <td colSpan={2} className="px-3 py-2">Total Output GST</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtCurrency(data.totalOutput)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Input GST */}
              <div className="border-r border-b border-slate-300 overflow-hidden md:border-l-0 border-l">
                <div className="bg-slate-800 text-white px-4 py-2">
                  <h2 className="text-[11px] font-bold uppercase tracking-widest">Input GST (Credit)</h2>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-800 text-white">
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Code</th>
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Account</th>
                      <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.inputGST.map(line => (
                      <tr key={line.code} className="border-t border-slate-200 hover:bg-blue-50/30 even:bg-slate-50/50">
                        <td className="px-3 py-1.5 text-slate-500 font-mono border-r border-slate-100">{line.code}</td>
                        <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{line.name}</td>
                        <td className="px-3 py-1.5 text-right text-slate-800 font-medium font-mono tabular-nums">{fmtCurrency(line.amount)}</td>
                      </tr>
                    ))}
                    {data.inputGST.length === 0 && (
                      <tr><td colSpan={3} className="px-3 py-4 text-center text-slate-400 text-xs">No input GST entries</td></tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-800 text-white font-semibold text-xs">
                      <td colSpan={2} className="px-3 py-2">Total Input GST</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtCurrency(data.totalInput)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Print footer */}
            <div className="text-center text-[10px] text-slate-400 mt-4 print:block hidden">
              Generated from MSPIL Distillery ERP — {new Date().toLocaleDateString('en-IN')}
            </div>
          </>
        )}

        {!loading && !data && (
          <div className="min-h-[200px] flex items-center justify-center border-x border-b border-slate-300 -mx-3 md:-mx-6 bg-white">
            <div className="text-xs text-slate-400">Select a date range to view GST summary</div>
          </div>
        )}
      </div>
    </div>
  );
}
