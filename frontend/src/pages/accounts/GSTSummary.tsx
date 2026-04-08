import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { useHotkeys } from '../../hooks/useHotkeys';
import {
  PageToolbar, TipBanner, FilterBar, PresetButtons, DateRangeInputs,
  KpiStrip, KpiTile, HelpModal, TableContainer, Th, computePreset, fmtINR,
} from '../../components/accounts/BooksShell';

interface GSTBreakdown { cgst: number; sgst: number; igst: number; total: number }
interface GSTData {
  period: { from: string; to: string };
  output: GSTBreakdown;
  input: GSTBreakdown;
  netPayable: number;
}

export default function GSTSummary() {
  const [data, setData] = useState<GSTData | null>(null);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => { setDateRange(computePreset('month')); }, []);

  const fetchData = useCallback(async () => {
    if (!dateRange.from || !dateRange.to) return;
    try {
      setLoading(true);
      const res = await api.get<GSTData>('/accounts-reports/gst-summary', {
        params: { from: dateRange.from, to: dateRange.to },
      });
      setData(res.data);
    } catch (err) { console.error('Failed to fetch GST summary:', err); }
    finally { setLoading(false); }
  }, [dateRange]);
  useEffect(() => { fetchData(); }, [fetchData]);

  useHotkeys([
    { key: 't', handler: e => { e.preventDefault(); setDateRange(computePreset('today')); } },
    { key: 'm', handler: e => { e.preventDefault(); setDateRange(computePreset('month')); } },
    { key: '?', shift: true, handler: e => { e.preventDefault(); setShowHelp(h => !h); } },
    { key: 'Escape', allowInInputs: true, handler: () => { if (showHelp) setShowHelp(false); } },
  ]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        <PageToolbar
          title="GST Summary"
          subtitle="GSTR-3B preview · Output \u2212 Input = Net Payable"
          statusBadge={data && (
            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${data.netPayable >= 0 ? 'border-rose-400/50 bg-rose-500/20 text-rose-200' : 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200'}`}>
              {data.netPayable >= 0 ? 'Net Payable' : 'Net Refund'}
            </span>
          )}
        >
          <button onClick={() => setShowHelp(true)} className="w-6 h-6 border border-slate-600 text-slate-300 text-xs font-bold hover:bg-slate-700" title="Shortcuts (?)">?</button>
        </PageToolbar>

        <TipBanner storageKey="gst_tip_dismissed">
          Tip: use month presets to quickly filter the period. Output GST − Input ITC = amount payable to Govt.
        </TipBanner>

        <FilterBar>
          <PresetButtons onPreset={p => setDateRange(computePreset(p))} />
          <DateRangeInputs from={dateRange.from} to={dateRange.to} onChange={setDateRange} />
        </FilterBar>

        {loading && <div className="text-xs text-slate-400 uppercase tracking-widest py-4 px-4">Loading GST summary...</div>}

        {data && !loading && (
          <>
            <KpiStrip cols={4}>
              <KpiTile label="Output GST" value={fmtINR(data.output.total) || '\u20B90.00'} sub="Tax collected on sales" color="emerald" valueClass="text-emerald-700" />
              <KpiTile label="Input GST (ITC)" value={fmtINR(data.input.total) || '\u20B90.00'} sub="ITC available" color="blue" valueClass="text-blue-700" />
              <KpiTile label={data.netPayable >= 0 ? 'Net Payable' : 'Net Refund'} value={fmtINR(Math.abs(data.netPayable)) || '\u20B90.00'} color={data.netPayable >= 0 ? 'rose' : 'emerald'} valueClass={data.netPayable >= 0 ? 'text-rose-700' : 'text-emerald-700'} />
              <KpiTile label="Period" value={dateRange.from || '—'} sub={`to ${dateRange.to || '—'}`} color="slate" valueClass="text-xs" last />
            </KpiStrip>

            <TableContainer>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <Th>Component</Th>
                    <Th align="right">Output (Credit)</Th>
                    <Th align="right">Input / ITC (Debit)</Th>
                    <Th align="right" last>Net</Th>
                  </tr>
                </thead>
                <tbody>
                  {([
                    ['CGST', data.output.cgst, data.input.cgst],
                    ['SGST', data.output.sgst, data.input.sgst],
                    ['IGST', data.output.igst, data.input.igst],
                  ] as const).map(([label, out, inp], i) => (
                    <tr key={label} className={`border-b border-slate-100 hover:bg-blue-50 ${i % 2 ? 'bg-slate-50/50' : ''}`}>
                      <td className="px-3 py-1.5 text-slate-700 font-medium border-r border-slate-100">{label}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-emerald-700 border-r border-slate-100">{fmtINR(out)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-blue-700 border-r border-slate-100">{fmtINR(inp)}</td>
                      <td className={`px-3 py-1.5 text-right font-mono tabular-nums font-medium ${out - inp >= 0 ? 'text-slate-800' : 'text-emerald-700'}`}>
                        {fmtINR(Math.abs(out - inp))}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-800 text-white font-semibold">
                    <td className="px-3 py-2 text-[10px] uppercase tracking-widest border-r border-slate-700">Total</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-700">{fmtINR(data.output.total)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-700">{fmtINR(data.input.total)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-sm">{fmtINR(Math.abs(data.netPayable))}</td>
                  </tr>
                </tfoot>
              </table>
            </TableContainer>

            <div className="bg-amber-50 border-x border-b border-amber-200 -mx-3 md:-mx-6 px-4 py-2 text-[11px] text-amber-800">
              <strong className="uppercase tracking-widest text-[10px]">Note:</strong> This is a preview based on journal postings. File GSTR-3B on gst.gov.in after reconciliation.
            </div>
          </>
        )}
      </div>

      <HelpModal
        open={showHelp}
        onClose={() => setShowHelp(false)}
        entries={[
          ['T / M', 'Today / This month'],
          ['Esc', 'Close modal'],
          ['?', 'Show this help'],
        ]}
      />
    </div>
  );
}
