import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, FileText, Sparkles, Filter } from 'lucide-react';
import api from '../../services/api';

// ────────────────────────────────────────────────────────────────────────────
// Types — match the /reconcile-by-vendor backend shape
// ────────────────────────────────────────────────────────────────────────────

interface Vendor {
  id: string;
  name: string;
  gstin: string | null;
  pan: string | null;
  phone: string | null;
  email: string | null;
  bankName: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
}
interface PO {
  id: string;
  poNo: number;
  poDate: string;
  poType: string | null;
  status: string;
  subtotal: number;
  totalGst: number;
  grandTotal: number;
  paymentTerms: string | null;
}
interface GrnRow {
  id: string;
  grnNo: number;
  grnDate: string;
  ticketNo: number | null;
  vehicleNo: string | null;
  status: string;
  qualityStatus: string;
  totalQty: number;
  totalAmount: number;
  poId: string;
  po: { id: string; poNo: number } | null;
  lines: Array<{ description: string; receivedQty: number; rate: number; unit: string }>;
  vendorInvoices: Array<{ id: string; invoiceNo: number; vendorInvNo: string | null }>;
  vendorInvoiceLines: Array<{ invoiceId: string; invoice: { id: string; invoiceNo: number; vendorInvNo: string | null } | null }>;
}
interface InvoiceRow {
  id: string;
  invoiceNo: number;
  vendorInvNo: string | null;
  vendorInvDate: string | null;
  invoiceDate: string;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  netPayable: number;
  status: string;
  matchStatus: string;
  filePath: string | null;
  grnId: string | null;
  poId: string | null;
  po: { id: string; poNo: number } | null;
  lines: Array<{
    id: string;
    productName: string;
    quantity: number;
    rate: number;
    totalAmount: number;
    grnId: string | null;
    grn: { id: string; grnNo: number; ticketNo: number | null; vehicleNo: string | null; totalQty: number; totalAmount: number } | null;
  }>;
}
interface PaymentRow {
  id: string;
  paymentDate: string;
  amount: number;
  mode: string;
  reference: string | null;
  paymentStatus: string;
  invoiceId: string | null;
}
interface ReconcileResponse {
  vendor: Vendor;
  pos: PO[];
  grns: GrnRow[];
  invoices: InvoiceRow[];
  payments: PaymentRow[];
  summary: {
    grnCount: number;
    invoiceCount: number;
    paymentCount: number;
    totalReceived: number;
    totalInvoiced: number;
    totalPaid: number;
    totalBalance: number;
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const fmt = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const fmtNum = (n: number, max = 2) => n.toLocaleString('en-IN', { maximumFractionDigits: max });
const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '--';

type ViewMode = 'grns' | 'invoices' | 'unmatched-grns' | 'unmatched-invoices';

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

export default function ReconcileVendor() {
  const { vendorId } = useParams<{ vendorId: string }>();
  const [data, setData] = useState<ReconcileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('grns');
  const [linkTarget, setLinkTarget] = useState<{ invoiceId: string; invoiceLabel: string; selected: Set<string>; saving: boolean; error?: string } | null>(null);

  useEffect(() => {
    if (!vendorId) return;
    setLoading(true);
    api
      .get<ReconcileResponse>(`/vendor-invoices/reconcile-by-vendor/${vendorId}`)
      .then(r => { setData(r.data); setError(null); })
      .catch(err => setError(err?.response?.data?.error || err?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [vendorId]);

  // Cross-references built from the response
  const grnToInvoice = useMemo(() => {
    const map = new Map<string, { invoiceId: string; invoiceNo: number; vendorInvNo: string | null }>();
    if (!data) return map;
    for (const inv of data.invoices) {
      if (inv.grnId) map.set(inv.grnId, { invoiceId: inv.id, invoiceNo: inv.invoiceNo, vendorInvNo: inv.vendorInvNo });
      for (const ln of inv.lines) {
        if (ln.grnId && !map.has(ln.grnId)) map.set(ln.grnId, { invoiceId: inv.id, invoiceNo: inv.invoiceNo, vendorInvNo: inv.vendorInvNo });
      }
    }
    return map;
  }, [data]);

  const invoiceToGrns = useMemo(() => {
    const map = new Map<string, GrnRow[]>();
    if (!data) return map;
    const grnById = new Map(data.grns.map(g => [g.id, g]));
    for (const inv of data.invoices) {
      const linked: GrnRow[] = [];
      const seen = new Set<string>();
      if (inv.grnId && grnById.has(inv.grnId) && !seen.has(inv.grnId)) {
        linked.push(grnById.get(inv.grnId)!);
        seen.add(inv.grnId);
      }
      for (const ln of inv.lines) {
        if (ln.grnId && grnById.has(ln.grnId) && !seen.has(ln.grnId)) {
          linked.push(grnById.get(ln.grnId)!);
          seen.add(ln.grnId);
        }
      }
      map.set(inv.id, linked);
    }
    return map;
  }, [data]);

  // Filtered rows per view
  const filteredGrns = useMemo(() => {
    if (!data) return [];
    if (view === 'unmatched-grns') return data.grns.filter(g => !grnToInvoice.has(g.id));
    return data.grns;
  }, [data, view, grnToInvoice]);

  const filteredInvoices = useMemo(() => {
    if (!data) return [];
    if (view === 'unmatched-invoices') return data.invoices.filter(inv => (invoiceToGrns.get(inv.id) || []).length === 0);
    return data.invoices;
  }, [data, view, invoiceToGrns]);

  const unmatchedGrnCount = data?.grns.filter(g => !grnToInvoice.has(g.id)).length || 0;
  const unmatchedInvoiceCount = data?.invoices.filter(inv => (invoiceToGrns.get(inv.id) || []).length === 0).length || 0;

  const openLinkModal = (inv: InvoiceRow) => {
    setLinkTarget({
      invoiceId: inv.id,
      invoiceLabel: inv.vendorInvNo || `INV-${inv.invoiceNo}`,
      selected: new Set(),
      saving: false,
    });
  };

  const submitLink = async () => {
    if (!linkTarget) return;
    if (linkTarget.selected.size === 0) {
      setLinkTarget(prev => prev ? { ...prev, error: 'Pick at least one GRN' } : prev);
      return;
    }
    setLinkTarget(prev => prev ? { ...prev, saving: true, error: undefined } : prev);
    try {
      await api.post(`/vendor-invoices/${linkTarget.invoiceId}/link-grns`, { grnIds: Array.from(linkTarget.selected) });
      setLinkTarget(null);
      // Reload data
      const r = await api.get<ReconcileResponse>(`/vendor-invoices/reconcile-by-vendor/${vendorId}`);
      setData(r.data);
    } catch (err: unknown) {
      const resp = (err as { response?: { data?: { error?: string; conflicts?: string[] } } })?.response?.data;
      const conflicts = resp?.conflicts && resp.conflicts.length > 0 ? `\n${resp.conflicts.join('\n')}` : '';
      const msg = (resp?.error || (err as { message?: string })?.message || 'Save failed') + conflicts;
      setLinkTarget(prev => prev ? { ...prev, saving: false, error: msg } : prev);
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────────────

  if (loading) {
    return <div className="p-8 text-center text-xs text-slate-400 uppercase tracking-widest">Loading reconciliation...</div>;
  }
  if (error || !data) {
    return (
      <div className="p-8 text-center">
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-2 inline-block">{error || 'No data'}</div>
      </div>
    );
  }

  const { vendor, summary } = data;

  return (
    <div className="px-3 md:px-6 py-4 bg-white">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 border-b border-slate-300 pb-3">
        <div className="flex items-center gap-3">
          <Link to="/accounts/payments-out" className="text-slate-500 hover:text-slate-800 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest">
            <ArrowLeft size={12} /> Back
          </Link>
          <div className="border-l border-slate-300 pl-3">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Vendor Reconciliation</div>
            <div className="text-base font-bold text-slate-800">{vendor.name}</div>
            <div className="text-[10px] text-slate-500 font-mono">
              {vendor.gstin && <span>GSTIN: {vendor.gstin}</span>}
              {vendor.pan && <span className="ml-3">PAN: {vendor.pan}</span>}
            </div>
          </div>
        </div>
        <div className="text-[10px] text-slate-500 font-mono text-right">
          {vendor.bankName && <div>{vendor.bankName} {vendor.bankAccount ? '· ' + vendor.bankAccount : ''}</div>}
          {vendor.bankIfsc && <div>IFSC: {vendor.bankIfsc}</div>}
        </div>
      </div>

      {/* Pipeline tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        {[
          { label: 'Received', value: fmt(summary.totalReceived), sub: `${summary.grnCount} GRN${summary.grnCount === 1 ? '' : 's'}`, tone: 'green' as const },
          { label: 'Invoiced', value: fmt(summary.totalInvoiced), sub: `${summary.invoiceCount} invoice${summary.invoiceCount === 1 ? '' : 's'}`, tone: summary.totalInvoiced + 1 < summary.totalReceived ? 'amber' as const : 'green' as const },
          { label: 'Paid', value: fmt(summary.totalPaid), sub: `${summary.paymentCount} payment${summary.paymentCount === 1 ? '' : 's'}`, tone: 'green' as const },
          { label: 'Balance', value: fmt(summary.totalBalance), sub: 'unpaid invoices', tone: summary.totalBalance > 0 ? 'red' as const : 'green' as const },
        ].map(t => (
          <div key={t.label} className={`border px-3 py-2 ${t.tone === 'amber' ? 'border-amber-300 bg-amber-50' : t.tone === 'red' ? 'border-red-300 bg-red-50' : 'border-emerald-300 bg-emerald-50'}`}>
            <div className={`text-[9px] font-bold uppercase tracking-widest ${t.tone === 'amber' ? 'text-amber-700' : t.tone === 'red' ? 'text-red-700' : 'text-emerald-700'}`}>{t.label}</div>
            <div className={`text-base font-bold font-mono mt-0.5 ${t.tone === 'amber' ? 'text-amber-900' : t.tone === 'red' ? 'text-red-900' : 'text-emerald-900'}`}>{t.value}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">{t.sub}</div>
          </div>
        ))}
      </div>

      {/* View toggle */}
      <div className="flex items-center gap-0 mb-3 border border-slate-300">
        {([
          { key: 'grns' as const, label: `All GRNs (${summary.grnCount})` },
          { key: 'unmatched-grns' as const, label: `Unmatched GRNs (${unmatchedGrnCount})`, dot: unmatchedGrnCount > 0 },
          { key: 'invoices' as const, label: `All Invoices (${summary.invoiceCount})` },
          { key: 'unmatched-invoices' as const, label: `Unmatched Invoices (${unmatchedInvoiceCount})`, dot: unmatchedInvoiceCount > 0 },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setView(t.key)}
            className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest border-r border-slate-300 last:border-r-0 transition ${view === t.key ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            <Filter size={10} className="inline mr-1.5 -mt-0.5" />
            {t.label}
            {t.dot && <span className={`ml-1.5 inline-block w-1.5 h-1.5 rounded-full ${view === t.key ? 'bg-amber-300' : 'bg-amber-500'}`} />}
          </button>
        ))}
      </div>

      {/* GRN-first view */}
      {(view === 'grns' || view === 'unmatched-grns') && (
        <div className="border border-slate-300 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">GRN</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Date</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Ticket / Truck</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Material</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Qty</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Amount</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">PO</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Linked Invoice</th>
              </tr>
            </thead>
            <tbody>
              {filteredGrns.map((g, i) => {
                const inv = grnToInvoice.get(g.id);
                const matched = !!inv;
                return (
                  <tr key={g.id} className={`border-b border-slate-100 ${matched ? '' : 'bg-amber-50/40'} ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                    <td className="px-3 py-1.5 border-r border-slate-100 font-mono">
                      <a
                        href={`/api/goods-receipts/${g.id}/pdf?token=${localStorage.getItem('token')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-700 hover:underline inline-flex items-center gap-1 font-bold"
                        title="Open GRN PDF"
                      >
                        <FileText size={10} /> GRN-{g.grnNo}
                      </a>
                    </td>
                    <td className="px-3 py-1.5 border-r border-slate-100 whitespace-nowrap text-slate-600">{fmtDate(g.grnDate)}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 font-mono text-[10px]">
                      {g.ticketNo ? `T-${String(g.ticketNo).padStart(4, '0')}` : ''}
                      {g.vehicleNo ? <span className="text-slate-500 ml-1">{g.vehicleNo}</span> : null}
                    </td>
                    <td className="px-3 py-1.5 border-r border-slate-100 truncate max-w-[180px]" title={g.lines?.[0]?.description}>
                      {g.lines?.[0]?.description || '--'}
                    </td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums">{fmtNum(g.totalQty)} {g.lines?.[0]?.unit || ''}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums font-bold">{fmt(g.totalAmount)}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 font-mono text-blue-700">{g.po ? `PO-${g.po.poNo}` : '--'}</td>
                    <td className="px-3 py-1.5">
                      {matched ? (
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 border border-emerald-300 bg-emerald-50 text-emerald-700 font-bold">
                          ✓ {inv.vendorInvNo || `INV-${inv.invoiceNo}`}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 border border-amber-400 bg-amber-50 text-amber-700 font-bold">
                          ⚠ awaiting bill
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredGrns.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-12 text-center text-xs text-slate-400">No GRNs in this view</td></tr>
              )}
            </tbody>
            {filteredGrns.length > 0 && (
              <tfoot>
                <tr className="bg-slate-800 text-white font-semibold">
                  <td className="px-3 py-2 text-[10px] uppercase tracking-widest" colSpan={5}>Total ({filteredGrns.length} GRNs)</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(filteredGrns.reduce((s, g) => s + (g.totalAmount || 0), 0))}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Invoice-first view */}
      {(view === 'invoices' || view === 'unmatched-invoices') && (
        <div className="border border-slate-300 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Invoice</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Date</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">PO</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Amount</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Balance</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Linked GRNs</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.map((inv, i) => {
                const grns = invoiceToGrns.get(inv.id) || [];
                const unmatched = grns.length === 0;
                return (
                  <tr key={inv.id} className={`border-b border-slate-100 ${unmatched ? 'bg-amber-50/40' : ''} ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                    <td className="px-3 py-1.5 border-r border-slate-100 font-mono">
                      <div className="font-bold text-slate-800">{inv.vendorInvNo || `INV-${inv.invoiceNo}`}</div>
                      <div className="text-[9px] text-slate-400">INV-{inv.invoiceNo}</div>
                    </td>
                    <td className="px-3 py-1.5 border-r border-slate-100 whitespace-nowrap text-slate-600">{fmtDate(inv.vendorInvDate || inv.invoiceDate)}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 font-mono text-blue-700">{inv.po ? `PO-${inv.po.poNo}` : '--'}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums">{fmt(inv.totalAmount)}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums font-bold text-red-600">{fmt(inv.balanceAmount)}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100">
                      {unmatched ? (
                        <span className="text-[10px] px-1.5 py-0.5 border border-amber-400 bg-amber-50 text-amber-700 font-bold">⚠ none linked</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {grns.map(g => (
                            <a
                              key={g.id}
                              href={`/api/goods-receipts/${g.id}/pdf?token=${localStorage.getItem('token')}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`${fmt(g.totalAmount)} · ${fmtDate(g.grnDate)}`}
                              className="text-[10px] font-mono px-1 py-0.5 border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 inline-flex items-center gap-0.5"
                            >
                              <FileText size={9} /> GRN-{g.grnNo}
                            </a>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-1.5 border-r border-slate-100">
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${inv.status === 'PAID' ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : inv.balanceAmount > 0 ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-slate-300'}`}>{inv.status}</span>
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {inv.filePath && (
                          <a
                            href={`/uploads/${inv.filePath}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2 py-0.5 bg-blue-600 text-white text-[9px] font-bold uppercase hover:bg-blue-700 inline-flex items-center gap-1"
                            title="Open invoice PDF"
                          >
                            <FileText size={10} /> PDF
                          </a>
                        )}
                        {unmatched && (
                          <button
                            onClick={() => openLinkModal(inv)}
                            className="px-2 py-0.5 bg-amber-600 text-white text-[9px] font-bold uppercase hover:bg-amber-700 inline-flex items-center gap-1"
                            title="Link GRN(s) to this invoice"
                          >
                            <Sparkles size={10} /> Link GRN
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredInvoices.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-12 text-center text-xs text-slate-400">No invoices in this view</td></tr>
              )}
            </tbody>
            {filteredInvoices.length > 0 && (
              <tfoot>
                <tr className="bg-slate-800 text-white font-semibold">
                  <td className="px-3 py-2 text-[10px] uppercase tracking-widest" colSpan={3}>Total ({filteredInvoices.length} invoices)</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(filteredInvoices.reduce((s, i) => s + (i.totalAmount || 0), 0))}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(filteredInvoices.reduce((s, i) => s + (i.balanceAmount || 0), 0))}</td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Link GRN modal */}
      {linkTarget && data && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => !linkTarget.saving && setLinkTarget(null)}>
          <div className="bg-white max-w-2xl w-full max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="bg-amber-600 text-white px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText size={14} />
                <h2 className="text-sm font-bold uppercase tracking-wide">Link GRN(s) to {linkTarget.invoiceLabel}</h2>
              </div>
              <button onClick={() => !linkTarget.saving && setLinkTarget(null)} disabled={linkTarget.saving} className="text-amber-200 hover:text-white">×</button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {linkTarget.error && <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 px-3 py-1.5 mb-2 whitespace-pre-line">{linkTarget.error}</div>}
              {(() => {
                const available = data.grns.filter(g => !grnToInvoice.has(g.id));
                if (available.length === 0) {
                  return <div className="text-[11px] text-amber-700">No unbilled GRNs left for this vendor.</div>;
                }
                return (
                  <div className="border border-slate-200">
                    {available.map(g => {
                      const isSel = linkTarget.selected.has(g.id);
                      return (
                        <label key={g.id} className={`flex items-start gap-2 px-2 py-2 border-b border-slate-100 last:border-b-0 cursor-pointer hover:bg-slate-50 ${isSel ? 'bg-emerald-50' : ''}`}>
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={isSel}
                            disabled={linkTarget.saving}
                            onChange={() => {
                              setLinkTarget(prev => {
                                if (!prev) return prev;
                                const next = new Set(prev.selected);
                                if (next.has(g.id)) next.delete(g.id); else next.add(g.id);
                                return { ...prev, selected: next };
                              });
                            }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-bold text-slate-700">
                              GRN-{g.grnNo}
                              {g.po && <span className="text-slate-400 font-normal ml-1.5">· PO-{g.po.poNo}</span>}
                              <span className="text-slate-400 font-normal ml-1.5">· {fmtDate(g.grnDate)}</span>
                            </div>
                            <div className="text-[11px] text-slate-500 truncate">
                              {g.ticketNo ? `T-${String(g.ticketNo).padStart(4, '0')} · ` : ''}
                              {g.vehicleNo || ''}
                              {g.lines?.[0]?.description ? ` · ${g.lines[0].description}` : ''}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-[11px] font-mono font-bold text-slate-700">{fmtNum(g.totalQty)} {g.lines?.[0]?.unit || ''}</div>
                            <div className="text-[11px] font-mono text-slate-600">{fmt(g.totalAmount)}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
            <div className="px-4 py-3 border-t border-slate-300 flex items-center gap-2">
              <div className="text-[10px] text-slate-500">
                {linkTarget.selected.size === 0 ? 'Pick at least one GRN.' : `${linkTarget.selected.size} GRN${linkTarget.selected.size === 1 ? '' : 's'} selected.`}
              </div>
              <div className="flex-1" />
              <button onClick={() => !linkTarget.saving && setLinkTarget(null)} disabled={linkTarget.saving} className="px-3 py-1.5 border border-slate-300 text-slate-600 text-[11px] font-bold uppercase tracking-widest hover:bg-slate-50 disabled:opacity-50">Cancel</button>
              <button
                onClick={submitLink}
                disabled={linkTarget.selected.size === 0 || linkTarget.saving}
                className="px-4 py-1.5 bg-emerald-600 text-white text-[11px] font-bold uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-50"
              >
                {linkTarget.saving ? 'Linking...' : `Link ${linkTarget.selected.size > 0 ? `(${linkTarget.selected.size})` : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
