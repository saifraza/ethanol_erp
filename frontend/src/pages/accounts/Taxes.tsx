import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

const fmtCurrency = (n: number): string => {
  if (n === 0) return '--';
  return (n < 0 ? '-' : '') + '\u20B9' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

type Tab = 'gst' | 'tds' | 'itc';

export default function Taxes() {
  const [tab, setTab] = useState<Tab>('gst');
  const [dateRange, setDateRange] = useState(() => {
    const now = new Date();
    const fyStart = now.getMonth() >= 3 ? `${now.getFullYear()}-04-01` : `${now.getFullYear() - 1}-04-01`;
    return { from: fyStart, to: now.toISOString().slice(0, 10) };
  });

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Taxes</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">GST, TDS & Input Tax Credit Management</span>
          </div>
          <button onClick={() => window.print()} className="px-3 py-1 border border-slate-400 text-slate-300 text-[11px] hover:bg-slate-700 print:hidden">Print</button>
        </div>

        {/* Tab Bar + Date Filter */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-6 flex-wrap print:hidden">
          <div className="flex gap-0">
            {(['gst', 'tds', 'itc'] as Tab[]).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest border border-slate-300 ${tab === t ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 hover:bg-slate-50'} ${t === 'gst' ? '' : '-ml-px'}`}>
                {t === 'gst' ? 'GST Summary' : t === 'tds' ? 'TDS Summary' : 'ITC Register'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">From</label>
              <input type="date" value={dateRange.from} onChange={e => setDateRange(p => ({ ...p, from: e.target.value }))} className="border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-slate-400" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">To</label>
              <input type="date" value={dateRange.to} onChange={e => setDateRange(p => ({ ...p, to: e.target.value }))} className="border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-slate-400" />
            </div>
          </div>
        </div>

        {tab === 'gst' && <GSTTab from={dateRange.from} to={dateRange.to} />}
        {tab === 'tds' && <TDSTab from={dateRange.from} to={dateRange.to} />}
        {tab === 'itc' && <ITCTab from={dateRange.from} to={dateRange.to} />}
      </div>
    </div>
  );
}

/* ═══════ GST SUMMARY TAB ═══════ */
function GSTTab({ from, to }: { from: string; to: string }) {
  const [summary, setSummary] = useState<any>(null);
  const [docs, setDocs] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!from || !to) return;
    setLoading(true);
    try {
      const [sumRes, docRes] = await Promise.all([
        api.get('/accounts-reports/gst-summary', { params: { from, to } }),
        api.get('/accounts-reports/gst-documents', { params: { from, to } }),
      ]);
      setSummary(sumRes.data);
      setDocs(docRes.data);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <div className="py-12 text-center text-xs text-slate-400 uppercase tracking-widest">Loading GST data...</div>;
  if (!summary) return null;

  const { output, input, netPayable } = summary;

  return (
    <>
      {/* Net Payable KPI */}
      <div className="grid grid-cols-3 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
        <div className={`bg-white px-4 py-3 border-r border-slate-300 border-l-4 ${netPayable >= 0 ? 'border-l-red-500' : 'border-l-emerald-500'}`}>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{netPayable >= 0 ? 'Net GST Payable' : 'Net GST Refundable'}</div>
          <div className={`text-xl font-bold font-mono tabular-nums mt-1 ${netPayable >= 0 ? 'text-red-700' : 'text-emerald-700'}`}>{fmtCurrency(netPayable)}</div>
        </div>
        <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-orange-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Output GST</div>
          <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtCurrency(output.total)}</div>
        </div>
        <div className="bg-white px-4 py-3 border-l-4 border-l-blue-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Input GST</div>
          <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtCurrency(input.total)}</div>
        </div>
      </div>

      {/* Output vs Input Summary Tables */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-0 -mx-3 md:-mx-6">
        {[{ title: 'Output GST (Liability)', items: [{ code: 'CGST', amt: output.cgst }, { code: 'SGST', amt: output.sgst }, { code: 'IGST', amt: output.igst }], total: output.total },
          { title: 'Input GST (Credit)', items: [{ code: 'CGST', amt: input.cgst }, { code: 'SGST', amt: input.sgst }, { code: 'IGST', amt: input.igst }], total: input.total }].map((sec, i) => (
          <div key={i} className={`border-b border-slate-300 overflow-hidden ${i === 0 ? 'border-x' : 'border-r md:border-l-0 border-l'}`}>
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th colSpan={2} className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">{sec.title}</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Amount</th>
                </tr>
              </thead>
              <tbody>
                {sec.items.map(it => (
                  <tr key={it.code} className="border-b border-slate-100 even:bg-slate-50/70 hover:bg-blue-50/60">
                    <td className="px-3 py-1.5 text-slate-500 font-mono border-r border-slate-100 w-16">{it.code}</td>
                    <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{it.code === 'CGST' ? 'Central GST' : it.code === 'SGST' ? 'State GST' : 'Integrated GST'}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800">{fmtCurrency(it.amt)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="bg-slate-800 text-white font-semibold text-xs"><td colSpan={2} className="px-3 py-2">Total</td><td className="px-3 py-2 text-right font-mono tabular-nums">{fmtCurrency(sec.total)}</td></tr></tfoot>
            </table>
          </div>
        ))}
      </div>

      {/* Document drill-downs — full tables live in their dedicated pages.
          Tax Dashboard stays a KPI summary only (one place per data-set). */}
      {docs && (
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-slate-50 px-4 py-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <a href="/admin/tax/invoice-series"
             className="block border border-slate-300 bg-white hover:border-slate-500 hover:bg-slate-100 transition px-3 py-2">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Output GST — Sell Invoices</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-widest">View all →</div>
            </div>
            <div className="text-xl font-bold text-slate-800 font-mono mt-0.5">{docs.salesInvoices.length}</div>
            <div className="text-[10px] text-slate-500">invoices in the period</div>
          </a>
          <a href="/procurement/vendor-invoices"
             className="block border border-slate-300 bg-white hover:border-slate-500 hover:bg-slate-100 transition px-3 py-2">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Input GST — Vendor & Contractor</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-widest">View all →</div>
            </div>
            <div className="text-xl font-bold text-slate-800 font-mono mt-0.5">
              {docs.vendorInvoices.length + docs.contractorBills.length}
            </div>
            <div className="text-[10px] text-slate-500">
              {docs.vendorInvoices.length} vendor inv · {docs.contractorBills.length} contractor bills
            </div>
          </a>
        </div>
      )}
    </>
  );
}

/* ═══════ TDS SUMMARY TAB ═══════ */
function TDSTab({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!from || !to) return;
    setLoading(true);
    try {
      const res = await api.get('/accounts-reports/tds-summary', { params: { from, to } });
      setData(res.data);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <div className="py-12 text-center text-xs text-slate-400 uppercase tracking-widest">Loading TDS data...</div>;
  if (!data) return null;

  return (
    <>
      {/* KPI Strip */}
      <div className="grid grid-cols-3 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
        <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-purple-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total TDS Deducted</div>
          <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtCurrency(data.totalDeducted)}</div>
        </div>
        <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-red-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">TDS Payable (Ledger)</div>
          <div className="text-xl font-bold text-red-700 mt-1 font-mono tabular-nums">{fmtCurrency(data.tdsPayableBalance)}</div>
        </div>
        <div className="bg-white px-4 py-3 border-l-4 border-l-emerald-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Deductions Count</div>
          <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{data.deductees.length}</div>
        </div>
      </div>

      {/* By Section + By Quarter side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-0 -mx-3 md:-mx-6">
        {/* By Section */}
        <div className="border-x border-b border-slate-300 overflow-hidden">
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-800 text-white">
              <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Section</th>
              <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Count</th>
              <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Payment</th>
              <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-widest">TDS</th>
            </tr></thead>
            <tbody>
              {data.bySections.map((s: any, i: number) => (
                <tr key={s.section} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                  <td className="px-3 py-1.5 font-semibold border-r border-slate-100">{s.section}</td>
                  <td className="px-3 py-1.5 text-right font-mono border-r border-slate-100">{s.count}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">{fmtCurrency(s.totalPayment)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums font-semibold">{fmtCurrency(s.totalTds)}</td>
                </tr>
              ))}
              {data.bySections.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-400">No TDS deductions in period</td></tr>}
            </tbody>
          </table>
        </div>
        {/* By Quarter */}
        <div className="border-r border-b border-slate-300 overflow-hidden md:border-l-0 border-l">
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-800 text-white">
              <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Quarter</th>
              <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Deductions</th>
              <th className="px-3 py-2 text-right font-semibold text-[10px] uppercase tracking-widest">TDS Amount</th>
            </tr></thead>
            <tbody>
              {data.byQuarter.map((q: any, i: number) => (
                <tr key={q.quarter} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                  <td className="px-3 py-1.5 font-semibold border-r border-slate-100">{q.quarter}</td>
                  <td className="px-3 py-1.5 text-right font-mono border-r border-slate-100">{q.count}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums font-semibold">{fmtCurrency(q.totalTds)}</td>
                </tr>
              ))}
              {data.byQuarter.length === 0 && <tr><td colSpan={3} className="px-3 py-4 text-center text-slate-400">No quarterly data</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Deductee Detail */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
        <div className="bg-slate-200 border-b border-slate-300 px-3 py-1.5 flex items-center justify-between">
          <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Deductee-wise Detail (Form 26Q)</span>
          <span className="text-[10px] text-slate-500">Click Invoice / PO / Bill to open the source document</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-800 text-white">
              {['Date', 'Deductee', 'PAN', 'Section', 'Source', 'PO / Bill', 'Invoice', 'UTR / Ref', 'Payment', 'TDS Deducted'].map(h => (
                <th key={h} className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 text-left last:border-r-0 last:text-right">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {data.deductees.map((d: any, i: number) => (
                <tr key={i} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                  <td className="px-3 py-1.5 border-r border-slate-100">{fmtDate(d.date)}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100 font-medium">{d.name}</td>
                  <td className="px-3 py-1.5 font-mono text-[10px] border-r border-slate-100">{d.pan || '--'}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100">{d.section}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100"><span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${d.source === 'VENDOR' ? 'border-blue-300 bg-blue-50 text-blue-600' : 'border-amber-300 bg-amber-50 text-amber-600'}`}>{d.source}</span></td>
                  <td className="px-3 py-1.5 border-r border-slate-100 font-mono text-[10px]">
                    {d.source === 'VENDOR' && d.poNo ? (
                      <a href={`/procurement/purchase-orders?search=${d.poNo}`} className="text-blue-600 hover:underline" title="Open PO">PO-{d.poNo}</a>
                    ) : d.source === 'CONTRACTOR' && d.billNo ? (
                      <a href={`/procurement/contractor-bills?search=${d.billNo}`} className="text-blue-600 hover:underline" title="Open Bill">BILL-{d.billNo}</a>
                    ) : (
                      <span className="text-slate-400">--</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 border-r border-slate-100 font-mono text-[10px]">
                    {d.source === 'VENDOR' && d.invoiceNo ? (
                      <a href={`/procurement/vendor-invoices?search=${d.invoiceNo}`} className="text-blue-600 hover:underline" title="Open vendor invoice">
                        INV-{d.invoiceNo}{d.vendorInvNo ? ` (${d.vendorInvNo})` : ''}
                      </a>
                    ) : d.source === 'CONTRACTOR' && d.vendorBillNo ? (
                      <span className="text-slate-600">{d.vendorBillNo}</span>
                    ) : (
                      <span className="text-slate-400">--</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 border-r border-slate-100 font-mono text-[10px] text-slate-600">{d.paymentRef || '--'}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">{fmtCurrency(d.paymentAmount)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums font-semibold">{fmtCurrency(d.tdsAmount)}</td>
                </tr>
              ))}
              {data.deductees.length === 0 && <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400">No TDS deductions found in the selected period</td></tr>}
            </tbody>
            {data.deductees.length > 0 && (
              <tfoot><tr className="bg-slate-800 text-white font-semibold text-xs">
                <td colSpan={8} className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtCurrency(data.deductees.reduce((s: number, d: any) => s + d.paymentAmount, 0))}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtCurrency(data.totalDeducted)}</td>
              </tr></tfoot>
            )}
          </table>
        </div>
      </div>
    </>
  );
}

/* ═══════ ITC REGISTER TAB ═══════ */
function ITCTab({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<{ vi: string[]; cb: string[] }>({ vi: [], cb: [] });
  const [claiming, setClaiming] = useState(false);

  const fetchData = useCallback(async () => {
    if (!from || !to) return;
    setLoading(true);
    try {
      const res = await api.get('/accounts-reports/itc-register', { params: { from, to, status: filter } });
      setData(res.data);
      setSelected({ vi: [], cb: [] });
    } catch (err) { console.error(err); } finally { setLoading(false); }
  }, [from, to, filter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleClaim = async () => {
    if (selected.vi.length === 0 && selected.cb.length === 0) return;
    setClaiming(true);
    try {
      await api.post('/accounts-reports/itc-claim', { vendorInvoiceIds: selected.vi, contractorBillIds: selected.cb });
      fetchData();
    } catch (err) { console.error(err); } finally { setClaiming(false); }
  };

  const toggleVI = (id: string) => setSelected(p => ({ ...p, vi: p.vi.includes(id) ? p.vi.filter(x => x !== id) : [...p.vi, id] }));
  const toggleCB = (id: string) => setSelected(p => ({ ...p, cb: p.cb.includes(id) ? p.cb.filter(x => x !== id) : [...p.cb, id] }));

  if (loading) return <div className="py-12 text-center text-xs text-slate-400 uppercase tracking-widest">Loading ITC data...</div>;
  if (!data) return null;

  return (
    <>
      {/* KPI Strip */}
      <div className="grid grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
        <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Eligible ITC</div>
          <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtCurrency(data.totals.eligibleTotal)}</div>
        </div>
        <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-emerald-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Claimed</div>
          <div className="text-xl font-bold text-emerald-700 mt-1 font-mono tabular-nums">{data.totals.claimedCount}</div>
        </div>
        <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-amber-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Unclaimed</div>
          <div className="text-xl font-bold text-amber-700 mt-1 font-mono tabular-nums">{data.totals.unclaimedCount}</div>
        </div>
        <div className="bg-white px-4 py-3 border-l-4 border-l-slate-400">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">CGST / SGST / IGST</div>
          <div className="text-sm font-bold text-slate-600 mt-1 font-mono tabular-nums">{fmtCurrency(data.totals.eligibleCgst)} / {fmtCurrency(data.totals.eligibleSgst)} / {fmtCurrency(data.totals.eligibleIgst)}</div>
        </div>
      </div>

      {/* Filter + Bulk Claim */}
      <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-4 print:hidden">
        <div className="flex gap-0">
          {[{ key: 'all', label: 'All' }, { key: 'eligible', label: 'Eligible' }, { key: 'claimed', label: 'Claimed' }, { key: 'reversed', label: 'Reversed' }].map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)} className={`px-3 py-1 text-[10px] font-bold uppercase tracking-widest border border-slate-300 ${filter === f.key ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 hover:bg-slate-50'} ${f.key === 'all' ? '' : '-ml-px'}`}>{f.label}</button>
          ))}
        </div>
        {(selected.vi.length > 0 || selected.cb.length > 0) && (
          <button onClick={handleClaim} disabled={claiming} className="px-3 py-1 bg-emerald-600 text-white text-[11px] font-medium hover:bg-emerald-700 disabled:opacity-50">
            {claiming ? 'Claiming...' : `Claim ITC (${selected.vi.length + selected.cb.length} selected)`}
          </button>
        )}
      </div>

      {/* Combined Table */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-800 text-white">
              <th className="px-2 py-2 w-8 border-r border-slate-700"></th>
              {['Doc #', 'Date', 'Vendor/Contractor', 'GSTIN', 'Taxable', 'CGST', 'SGST', 'IGST', 'Status'].map(h => (
                <th key={h} className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 text-left last:border-r-0">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {data.vendorInvoices.map((v: any, i: number) => (
                <tr key={'v-' + v.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                  <td className="px-2 py-1.5 text-center border-r border-slate-100">
                    {v.itcEligible && !v.itcClaimed && <input type="checkbox" checked={selected.vi.includes(v.id)} onChange={() => toggleVI(v.id)} className="w-3 h-3" />}
                  </td>
                  <td className="px-3 py-1.5 font-mono border-r border-slate-100">{v.invoiceNo || '--'}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100">{fmtDate(v.invoiceDate)}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100">{v.vendor?.name || '--'}</td>
                  <td className="px-3 py-1.5 font-mono text-[10px] border-r border-slate-100">{v.vendor?.gstin || '--'}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">{fmtCurrency(v.subtotal)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">{fmtCurrency(v.cgstAmount || 0)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">{fmtCurrency(v.sgstAmount || 0)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">{fmtCurrency(v.igstAmount || 0)}</td>
                  <td className="px-3 py-1.5">
                    {v.itcReversed ? <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-red-300 bg-red-50 text-red-600">Reversed</span>
                    : v.itcClaimed ? <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-emerald-400 bg-emerald-50 text-emerald-700">Claimed</span>
                    : v.itcEligible ? <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-blue-300 bg-blue-50 text-blue-600">Eligible</span>
                    : <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-200 bg-slate-50 text-slate-400">Ineligible</span>}
                  </td>
                </tr>
              ))}
              {data.contractorBills.map((c: any, i: number) => (
                <tr key={'c-' + c.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${(data.vendorInvoices.length + i) % 2 ? 'bg-slate-50/70' : ''}`}>
                  <td className="px-2 py-1.5 text-center border-r border-slate-100">
                    {c.itcEligible && !c.itcClaimed && <input type="checkbox" checked={selected.cb.includes(c.id)} onChange={() => toggleCB(c.id)} className="w-3 h-3" />}
                  </td>
                  <td className="px-3 py-1.5 font-mono border-r border-slate-100">CB-{c.billNo}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100">{fmtDate(c.billDate)}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100">{c.contractor?.name || '--'}</td>
                  <td className="px-3 py-1.5 font-mono text-[10px] border-r border-slate-100">{c.contractor?.gstin || '--'}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">{fmtCurrency(c.subtotal)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">{fmtCurrency(c.cgstAmount || 0)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">{fmtCurrency(c.sgstAmount || 0)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">{fmtCurrency(c.igstAmount || 0)}</td>
                  <td className="px-3 py-1.5">
                    {c.itcReversed ? <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-red-300 bg-red-50 text-red-600">Reversed</span>
                    : c.itcClaimed ? <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-emerald-400 bg-emerald-50 text-emerald-700">Claimed</span>
                    : c.itcEligible ? <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-blue-300 bg-blue-50 text-blue-600">Eligible</span>
                    : <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-200 bg-slate-50 text-slate-400">Ineligible</span>}
                  </td>
                </tr>
              ))}
              {data.vendorInvoices.length === 0 && data.contractorBills.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400">No ITC records found for the selected period and filter</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
