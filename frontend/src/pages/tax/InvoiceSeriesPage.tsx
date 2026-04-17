/**
 * Sell Invoices — read-only listing of every final sales invoice issued by
 * the plant (ethanol / DDGS / sugar / exports). Replaces the old invoice-
 * series numbering config page (numbering is atomic and invisible to users).
 *
 * Route: /admin/tax/invoice-series (kept for sidebar compat)
 */
import { useEffect, useMemo, useState } from 'react';
import { Download, Eye, FileText, Loader2, Search } from 'lucide-react';
import api from '../../services/api';
import { invoiceDisplayNo } from '../../utils/invoiceDisplay';

interface Invoice {
  id: string;
  invoiceNo: number;
  remarks?: string | null; // holds the printed series number INV/ETH/NNN
  invoiceDate: string;
  customer: { id: string; name: string; shortName?: string };
  productName: string;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;        // taxable (qty × rate)
  gstPercent: number;
  gstAmount: number;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
  tcsAmount?: number;
  tcsPercent?: number;
  tcsSection?: string | null;
  freightCharge?: number;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  status: 'UNPAID' | 'PARTIAL' | 'PAID' | 'CANCELLED';
  irn?: string | null;
  irnStatus?: string | null;
  ewbNo?: string | null;
}

type StatusTab = 'ALL' | 'UNPAID' | 'PARTIAL' | 'PAID' | 'CANCELLED';

const fmt = (n?: number | null) => (n == null ? '--' : n.toLocaleString('en-IN', { maximumFractionDigits: 2 }));
const fmtDate = (s: string) => {
  if (!s) return '--';
  const d = new Date(s);
  return `${String(d.getDate()).padStart(2, '0')}-${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]}-${d.getFullYear()}`;
};

// Sales-invoice display labels — money is RECEIVED from customer, not paid.
// DB values stay the same ("PAID", "UNPAID") so API filters don't break.
const STATUS_LABEL: Record<Invoice['status'], string> = {
  UNPAID: 'PENDING',
  PARTIAL: 'PARTIAL',
  PAID: 'RECEIVED',
  CANCELLED: 'CANCELLED',
};
const TAB_LABEL: Record<StatusTab, string> = {
  ALL: 'ALL',
  UNPAID: 'PENDING',
  PARTIAL: 'PARTIAL',
  PAID: 'RECEIVED',
  CANCELLED: 'CANCELLED',
};

export default function InvoiceSeriesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusTab>('ALL');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [taxSeries, setTaxSeries] = useState<{ prefix: string; width: number } | null>(null);
  const limit = 50;

  // Fetch the TAX_INVOICE series once so we can format invoice numbers like
  // ETH/26-27/00001 instead of raw autoincrement 1
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/tax/invoice-series');
        const all: Array<{ docType: string; prefix: string; width: number; isActive: boolean }> =
          Array.isArray(res.data) ? res.data : (res.data.items ?? []);
        const tax = all.find((s) => s.docType === 'TAX_INVOICE' && s.isActive);
        if (tax) setTaxSeries({ prefix: tax.prefix, width: tax.width });
      } catch { /* non-blocking */ }
    })();
  }, []);

  // Display uses the actual printed number stored in Invoice.remarks (INV/ETH/NNN).
  // The old taxSeries-based padding is kept only as a fallback for legacy rows
  // that were never assigned a remarks doc number.
  const legacyFmt = (n: number): string =>
    taxSeries ? `${taxSeries.prefix}${String(n).padStart(taxSeries.width, '0')}` : `INV-${n}`;

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const res = await api.get(`/invoices?${params.toString()}`);
      setInvoices(res.data.invoices || []);
      setTotal(res.data.total || 0);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to load invoices';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [statusFilter, from, to, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    if (!search.trim()) return invoices;
    const q = search.trim().toLowerCase();
    return invoices.filter((i) =>
      String(i.invoiceNo).includes(q) ||
      (i.remarks || '').toLowerCase().includes(q) ||
      i.customer?.name?.toLowerCase().includes(q) ||
      i.productName?.toLowerCase().includes(q) ||
      i.irn?.toLowerCase().includes(q),
    );
  }, [invoices, search]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const summary = useMemo(() => {
    const s = { taxable: 0, gst: 0, tcs: 0, total: 0, paid: 0, balance: 0 };
    for (const i of filtered) {
      s.taxable += i.amount || 0;
      s.gst += i.gstAmount || 0;
      s.tcs += i.tcsAmount || 0;
      s.total += i.totalAmount || 0;
      s.paid += i.paidAmount || 0;
      s.balance += i.balanceAmount || 0;
    }
    return s;
  }, [filtered]);

  const fetchPdfBlob = async (id: string) => {
    const res = await api.get(`/invoices/${id}/pdf`, { responseType: 'blob' });
    return new Blob([res.data], { type: 'application/pdf' });
  };

  const viewPdf = async (id: string) => {
    try {
      const blob = await fetchPdfBlob(id);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError('Failed to open PDF');
    }
  };

  const downloadPdf = async (inv: Invoice) => {
    try {
      const blob = await fetchPdfBlob(inv.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // File-name safe version of the printed invoice number (replace slashes)
      const displayNo = invoiceDisplayNo(inv) || legacyFmt(inv.invoiceNo);
      const safeName = displayNo.replace(/[^\w-]/g, '_');
      a.download = `Invoice-${safeName}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5_000);
    } catch {
      setError('Failed to download PDF');
    }
  };

  return (
    <div className="p-4 md:p-6">
      <div className="bg-slate-800 text-white px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
            <FileText className="w-4 h-4" /> Sell Invoices
          </h1>
          <p className="text-[10px] text-slate-300 mt-0.5">Every final sales invoice issued by the plant</p>
        </div>
        <div className="text-[11px] text-slate-300">
          {loading ? 'Loading…' : `${total.toLocaleString('en-IN')} invoices`}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-slate-100 border border-slate-300 border-t-0 px-3 py-2 space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={13} className="absolute left-2.5 top-2 text-slate-400" />
            <input
              type="text" placeholder="Search inv #, customer, product, IRN..."
              value={search} onChange={(e) => setSearch(e.target.value)}
              className="border border-slate-300 px-2 py-1.5 pl-8 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </div>
          <div className="flex items-center gap-1 text-[11px]">
            <label className="text-slate-600">From</label>
            <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }}
              className="border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
            <label className="text-slate-600">To</label>
            <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }}
              className="border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
            {(from || to) && (
              <button onClick={() => { setFrom(''); setTo(''); setPage(1); }} className="text-[10px] text-slate-500 hover:text-slate-800 px-1">clear</button>
            )}
          </div>
        </div>
        <div className="flex gap-0 overflow-x-auto">
          {(['ALL', 'UNPAID', 'PARTIAL', 'PAID', 'CANCELLED'] as StatusTab[]).map((tab) => (
            <button
              key={tab} onClick={() => { setStatusFilter(tab); setPage(1); }}
              className={`px-3 py-1 text-[10px] font-bold uppercase tracking-widest whitespace-nowrap border border-slate-300 mr-1 transition ${
                statusFilter === tab ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 hover:bg-slate-50'
              }`}
            >{TAB_LABEL[tab]}</button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="border border-slate-300 border-t-0 overflow-x-auto bg-white">
        <table className="w-full text-[11px]">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-widest">Inv #</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-widest">Date</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-widest">Customer</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-widest">Product</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-widest">Qty</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-widest">Taxable</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-widest">GST</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-widest">TCS</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-widest">Total</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-widest">Received</th>
              <th className="px-2 py-1.5 text-center font-bold uppercase tracking-widest">Status</th>
              <th className="px-2 py-1.5 text-center font-bold uppercase tracking-widest">IRN</th>
              <th className="px-2 py-1.5 text-center font-bold uppercase tracking-widest sticky right-0 bg-slate-100 border-l-2 border-slate-300 shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.1)]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {loading && (
              <tr><td colSpan={13} className="px-2 py-6 text-center text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading…
              </td></tr>
            )}
            {!loading && error && (
              <tr><td colSpan={13} className="px-2 py-6 text-center text-red-600">{error}</td></tr>
            )}
            {!loading && !error && filtered.length === 0 && (
              <tr><td colSpan={13} className="px-2 py-6 text-center text-slate-400">No invoices match.</td></tr>
            )}
            {!loading && filtered.map((inv) => (
              <tr key={inv.id} className="hover:bg-slate-50">
                <td className="px-2 py-1 font-mono font-bold whitespace-nowrap">{invoiceDisplayNo(inv) || legacyFmt(inv.invoiceNo)}</td>
                <td className="px-2 py-1 whitespace-nowrap">{fmtDate(inv.invoiceDate)}</td>
                <td className="px-2 py-1 truncate max-w-[180px]" title={inv.customer?.name}>{inv.customer?.shortName || inv.customer?.name || '--'}</td>
                <td className="px-2 py-1 truncate max-w-[140px]" title={inv.productName}>{inv.productName}</td>
                <td className="px-2 py-1 text-right font-mono tabular-nums">{fmt(inv.quantity)} {inv.unit}</td>
                <td className="px-2 py-1 text-right font-mono tabular-nums">{fmt(inv.amount)}</td>
                <td className="px-2 py-1 text-right font-mono tabular-nums">
                  {fmt(inv.gstAmount)}
                  {inv.gstPercent ? <span className="text-slate-400 ml-1 text-[9px]">({inv.gstPercent}%)</span> : null}
                </td>
                <td className="px-2 py-1 text-right font-mono tabular-nums">
                  {fmt(inv.tcsAmount)}
                  {inv.tcsSection ? <span className="text-slate-400 ml-1 text-[9px]">({inv.tcsSection})</span> : null}
                </td>
                <td className="px-2 py-1 text-right font-mono tabular-nums font-bold">{fmt(inv.totalAmount)}</td>
                <td className="px-2 py-1 text-right font-mono tabular-nums">{fmt(inv.paidAmount)}</td>
                <td className="px-2 py-1 text-center">
                  <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest border ${
                    inv.status === 'PAID' ? 'bg-green-50 border-green-400 text-green-700'
                    : inv.status === 'PARTIAL' ? 'bg-amber-50 border-amber-400 text-amber-700'
                    : inv.status === 'CANCELLED' ? 'bg-slate-100 border-slate-400 text-slate-500'
                    : 'bg-red-50 border-red-400 text-red-700'
                  }`}>{STATUS_LABEL[inv.status]}</span>
                </td>
                <td className="px-2 py-1 text-center">
                  {inv.irn ? (
                    <span className="text-[9px] font-mono text-green-700 cursor-help" title={`IRN: ${inv.irn}${inv.ewbNo ? '\nEWB: ' + inv.ewbNo : ''}`}>✓ {inv.irnStatus || 'OK'}</span>
                  ) : (
                    <span className="text-[9px] text-slate-400">—</span>
                  )}
                </td>
                <td className="px-2 py-1 text-center sticky right-0 bg-white border-l-2 border-slate-200 shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.1)]">
                  <div className="inline-flex gap-1">
                    <button
                      onClick={() => viewPdf(inv.id)}
                      className="text-slate-600 hover:text-blue-600" title="View PDF"
                    ><Eye className="w-3.5 h-3.5" /></button>
                    <button
                      onClick={() => downloadPdf(inv)}
                      className="text-slate-600 hover:text-green-700" title="Download PDF"
                    ><Download className="w-3.5 h-3.5" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          {!loading && filtered.length > 0 && (
            <tfoot className="bg-slate-100 border-t-2 border-slate-300 font-bold">
              <tr>
                <td className="px-2 py-1.5 text-[10px] uppercase tracking-widest text-slate-600" colSpan={5}>Page total ({filtered.length})</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmt(summary.taxable)}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmt(summary.gst)}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmt(summary.tcs)}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmt(summary.total)}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmt(summary.paid)}</td>
                <td colSpan={3} className="px-2 py-1.5 text-right text-[10px] text-slate-500">Outstanding: <span className="font-mono">{fmt(summary.balance)}</span></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-between bg-slate-50 border border-slate-300 border-t-0 px-3 py-1.5 text-[11px] text-slate-600">
          <div>Page {page} of {totalPages} — {total.toLocaleString('en-IN')} total</div>
          <div className="flex gap-1">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
              className="px-2 py-0.5 border border-slate-300 bg-white disabled:opacity-40 hover:bg-slate-100">Prev</button>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}
              className="px-2 py-0.5 border border-slate-300 bg-white disabled:opacity-40 hover:bg-slate-100">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
