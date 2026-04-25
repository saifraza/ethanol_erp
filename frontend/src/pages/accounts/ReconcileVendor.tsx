import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, FileText, Sparkles, Filter, Upload, X } from 'lucide-react';
import api from '../../services/api';

// Subset-sum helper — find a combination of GRNs whose total ≈ bill taxable.
function findGrnSubsetMatchingTotal<T extends { id: string; totalAmount: number }>(
  grns: T[], target: number, tolerance = 0.05, maxDepth = 7,
): string[] | null {
  if (target <= 0 || grns.length === 0) return null;
  const tol = Math.max(target * tolerance, 1);
  const sorted = [...grns].sort((a, b) => b.totalAmount - a.totalAmount);
  let visited = 0;
  function search(start: number, remaining: number, picked: string[]): string[] | null {
    if (++visited > 200000) return null;
    if (Math.abs(remaining) <= tol && picked.length > 0) return picked;
    if (picked.length >= maxDepth || remaining < -tol) return null;
    for (let i = start; i < sorted.length; i++) {
      if (sorted[i].totalAmount > remaining + tol) continue;
      const got = search(i + 1, remaining - sorted[i].totalAmount, [...picked, sorted[i].id]);
      if (got) return got;
    }
    return null;
  }
  return search(0, target, []);
}

const todayStr = () => new Date().toISOString().slice(0, 10);

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

  // Cross-references — declared early so the upload callbacks below can use them.
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
      if (inv.grnId && grnById.has(inv.grnId) && !seen.has(inv.grnId)) { linked.push(grnById.get(inv.grnId)!); seen.add(inv.grnId); }
      for (const ln of inv.lines) {
        if (ln.grnId && grnById.has(ln.grnId) && !seen.has(ln.grnId)) { linked.push(grnById.get(ln.grnId)!); seen.add(ln.grnId); }
      }
      map.set(inv.id, linked);
    }
    return map;
  }, [data]);

  // ── Bulk upload (scoped to THIS vendor's unmatched GRNs) ──
  type SmartExtracted = {
    invoice_number?: string | null;
    invoice_date?: string | null;
    items?: Array<{ description?: string; hsn?: string; qty?: number; unit?: string; rate?: number; amount?: number; vehicle_no?: string | null; ticket_no?: string | null }>;
    taxable_amount?: number | null;
    total_gst?: number | null;
    total_amount?: number | null;
    supply_type?: 'INTRA_STATE' | 'INTER_STATE' | null;
  };
  type UploadDup = { invoiceId: string; invoiceNo: number; vendorInvNo: string | null; isMatched: boolean };
  type UploadEntry = {
    id: string;
    file: File;
    status: 'pending' | 'extracting' | 'extracted' | 'saving' | 'saved' | 'error';
    filePath?: string;
    fileHash?: string;
    extracted?: SmartExtracted | null;
    selectedGrnIds: string[];
    suggestedGrnIds?: string[];
    suggestedReason?: string;
    duplicateOf?: UploadDup;
    error?: string;
    savedInvoiceNo?: number;
  };
  const [uploadOpen, setUploadOpen] = useState(false);
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [savingAll, setSavingAll] = useState(false);

  // Files appended go through extract — auto-tick uses ONLY this vendor's
  // unmatched GRNs (the page already has them in `data.grns` minus
  // `grnToInvoice`), so the search space is small and matches are accurate.
  const onFilesPicked = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const next: UploadEntry[] = Array.from(files).map(f => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file: f,
      status: 'pending',
      selectedGrnIds: [],
    }));
    setEntries(prev => [...prev, ...next]);
  };

  const runAnalyze = useCallback(async () => {
    if (!data) return;
    const pending = entries.filter(e => e.status === 'pending');
    if (pending.length === 0) return;
    setBusy(true);
    setEntries(prev => prev.map(e => e.status === 'pending' ? { ...e, status: 'extracting' } : e));

    // Unmatched GRNs from THIS page only — narrow search space.
    const unmatchedGrns = data.grns.filter(g => !grnToInvoice.has(g.id));

    try {
      const CHUNK = 15;
      type BulkResp = { count: number; results: Array<{ filePath: string; originalName: string; fileHash: string; extracted: SmartExtracted | null; duplicateOf?: UploadDup; error?: string }> };
      const all: BulkResp['results'] = [];
      for (let i = 0; i < pending.length; i += CHUNK) {
        const slice = pending.slice(i, i + CHUNK);
        const fd = new FormData();
        for (const e of slice) fd.append('files', e.file);
        const res = await api.post<BulkResp>('/vendor-invoices/upload-extract-bulk', fd, {
          headers: { 'Content-Type': 'multipart/form-data' }, timeout: 240000,
        });
        all.push(...(res.data.results || []));
      }

      pending.forEach((entry, i) => {
        const r = all[i];
        if (!r) {
          setEntries(prev => prev.map(p => p.id === entry.id ? { ...p, status: 'error', error: 'No response' } : p));
          return;
        }
        // Auto-tick on UNMATCHED GRNs only.
        const taxable = Number(r.extracted?.taxable_amount) || 0;
        const norm = (s: string | null | undefined) => (s || '').toString().toUpperCase().replace(/[\s\-]+/g, '');
        const items = r.extracted?.items || [];
        const matchedByLine = new Set<string>();
        for (const it of items) {
          const v = norm(it.vehicle_no);
          const t = norm(it.ticket_no);
          if (v.length >= 5) {
            const hit = unmatchedGrns.find(gr => norm(gr.vehicleNo) === v && !matchedByLine.has(gr.id));
            if (hit) { matchedByLine.add(hit.id); continue; }
          }
          if (t.length >= 2) {
            const td = t.replace(/\D+/g, '');
            const hit = unmatchedGrns.find(gr => gr.ticketNo != null && String(gr.ticketNo) === td && !matchedByLine.has(gr.id));
            if (hit) { matchedByLine.add(hit.id); continue; }
          }
        }
        let selected: string[] = [];
        let suggested: string[] = [];
        let suggestedReason: string | undefined;
        if (matchedByLine.size > 0) {
          selected = Array.from(matchedByLine);
        } else if (taxable > 0 && unmatchedGrns.length > 0) {
          const tight = findGrnSubsetMatchingTotal(unmatchedGrns, taxable, 0.005, 7);
          if (tight && tight.length > 0) {
            selected = tight;
          } else {
            const loose = findGrnSubsetMatchingTotal(unmatchedGrns, taxable, 0.05, 7);
            if (loose && loose.length > 0) {
              const sum = loose.reduce((s, id) => s + (unmatchedGrns.find(gr => gr.id === id)?.totalAmount || 0), 0);
              const diff = sum - taxable;
              suggested = loose;
              suggestedReason = `${loose.length} GRN${loose.length > 1 ? 's' : ''} sum ₹${Math.round(sum).toLocaleString('en-IN')} vs bill ₹${Math.round(taxable).toLocaleString('en-IN')} (diff ${diff >= 0 ? '+' : ''}₹${Math.round(diff).toLocaleString('en-IN')})`;
            }
          }
        }

        setEntries(prev => prev.map(p => p.id === entry.id ? {
          ...p,
          status: r.error ? 'error' : 'extracted',
          filePath: r.filePath,
          fileHash: r.fileHash,
          extracted: r.extracted,
          duplicateOf: r.duplicateOf,
          error: r.error,
          selectedGrnIds: selected,
          suggestedGrnIds: suggested.length > 0 ? suggested : undefined,
          suggestedReason,
        } : p));
      });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        || (err as { message?: string })?.message
        || 'Upload failed';
      setEntries(prev => prev.map(e => e.status === 'extracting' ? { ...e, status: 'error', error: msg } : e));
    } finally {
      setBusy(false);
    }
  }, [data, entries, grnToInvoice]);

  const saveOne = useCallback(async (entry: UploadEntry): Promise<{ ok: boolean; invoiceNo?: number; error?: string }> => {
    if (!data) return { ok: false, error: 'No data' };
    const ext = entry.extracted || {};
    const pickedGrns = data.grns.filter(g => entry.selectedGrnIds.includes(g.id));

    // Duplicate of unmatched existing invoice → link-grns instead of new row.
    if (entry.duplicateOf && !entry.duplicateOf.isMatched) {
      if (entry.selectedGrnIds.length === 0) return { ok: false, error: 'Pick at least one GRN' };
      try {
        await api.post(`/vendor-invoices/${entry.duplicateOf.invoiceId}/link-grns`, { grnIds: entry.selectedGrnIds });
        return { ok: true, invoiceNo: entry.duplicateOf.invoiceNo };
      } catch (err: unknown) {
        const resp = (err as { response?: { data?: { error?: string; conflicts?: string[] } } })?.response?.data;
        const conflicts = resp?.conflicts && resp.conflicts.length > 0 ? `\n${resp.conflicts.join('\n')}` : '';
        return { ok: false, error: (resp?.error || 'Link failed') + conflicts };
      }
    }

    const taxable = Number(ext.taxable_amount) || pickedGrns.reduce((s, g) => s + g.totalAmount, 0);
    const totalGst = Number(ext.total_gst) || 0;
    const gstPercent = taxable > 0 ? Math.round((totalGst / taxable) * 100) : 18;
    const supplyType: 'INTRA_STATE' | 'INTER_STATE' = ext.supply_type === 'INTER_STATE' ? 'INTER_STATE' : 'INTRA_STATE';

    let lines: Array<{ grnId: string | null; productName: string; hsnCode: string | null; quantity: number; unit: string; rate: number; gstPercent: number }>;
    let poId: string | null;
    if (pickedGrns.length > 0) {
      lines = pickedGrns.map(g => ({
        grnId: g.id,
        productName: g.lines?.[0]?.description || `GRN-${g.grnNo}`,
        hsnCode: ext.items?.[0]?.hsn || null,
        quantity: g.totalQty,
        unit: g.lines?.[0]?.unit || 'KG',
        rate: g.totalQty > 0 ? g.totalAmount / g.totalQty : 0,
        gstPercent,
      }));
      poId = pickedGrns[0].po?.id || pickedGrns[0].poId || null;
    } else {
      poId = data.grns.find(g => !grnToInvoice.has(g.id))?.po?.id || null;
      const item0 = ext.items?.[0];
      const qty = Number(item0?.qty) || 1;
      lines = [{
        grnId: null,
        productName: item0?.description || `Bill ${ext.invoice_number || ''} (GRN to link)`,
        hsnCode: item0?.hsn || null,
        quantity: qty,
        unit: item0?.unit || 'KG',
        rate: Number(item0?.rate) || (qty > 0 ? taxable / qty : taxable) || 0,
        gstPercent,
      }];
    }

    try {
      const res = await api.post<{ invoiceNo: number }>('/vendor-invoices', {
        vendorId: data.vendor.id,
        poId,
        vendorInvNo: ext.invoice_number || '',
        vendorInvDate: ext.invoice_date || todayStr(),
        invoiceDate: ext.invoice_date || todayStr(),
        supplyType,
        gstPercent,
        filePath: entry.filePath || null,
        fileHash: entry.fileHash || null,
        originalFileName: entry.file.name,
        status: 'APPROVED',
        lines,
      });
      return { ok: true, invoiceNo: res.data.invoiceNo };
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data?.message
        || (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        || (err as { message?: string })?.message
        || 'Save failed';
      return { ok: false, error: msg };
    }
  }, [data, grnToInvoice]);

  const saveAll = useCallback(async () => {
    const ready = entries.filter(e => e.status === 'extracted' && (!e.duplicateOf || !e.duplicateOf.isMatched));
    if (ready.length === 0) return;
    setSavingAll(true);
    for (const entry of ready) {
      setEntries(prev => prev.map(p => p.id === entry.id ? { ...p, status: 'saving' } : p));
      const r = await saveOne(entry);
      setEntries(prev => prev.map(p => p.id === entry.id
        ? (r.ok ? { ...p, status: 'saved', savedInvoiceNo: r.invoiceNo } : { ...p, status: 'error', error: r.error })
        : p));
    }
    setSavingAll(false);
    // Reload page data so newly-linked GRNs flip to matched.
    if (vendorId) {
      try {
        const r = await api.get<ReconcileResponse>(`/vendor-invoices/reconcile-by-vendor/${vendorId}`);
        setData(r.data);
      } catch { /* ignore */ }
    }
  }, [entries, saveOne, vendorId]);

  const removeEntry = (id: string) => setEntries(prev => prev.filter(e => e.id !== id));
  const updateEntry = (id: string, patch: Partial<UploadEntry>) => setEntries(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));

  useEffect(() => {
    if (!vendorId) return;
    setLoading(true);
    api
      .get<ReconcileResponse>(`/vendor-invoices/reconcile-by-vendor/${vendorId}`)
      .then(r => { setData(r.data); setError(null); })
      .catch(err => setError(err?.response?.data?.error || err?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [vendorId]);

  // (grnToInvoice + invoiceToGrns are declared above so the upload callbacks can reference them.)

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

      {/* ────────────── Upload bills (scoped to this vendor) ────────────── */}
      <div className="mb-3 border border-slate-300">
        <button
          onClick={() => setUploadOpen(o => !o)}
          className="w-full bg-purple-700 text-white px-4 py-2 flex items-center justify-between text-[11px] font-bold uppercase tracking-widest"
        >
          <span className="flex items-center gap-2">
            <Sparkles size={12} />
            Upload Bills for {vendor.name}
            {entries.length > 0 && <span className="ml-2 px-1.5 py-0.5 bg-white text-purple-700 text-[10px]">{entries.length}</span>}
          </span>
          <span className="text-[10px] text-purple-200">{uploadOpen ? 'Hide ▲' : 'Show ▼'}</span>
        </button>

        {uploadOpen && (() => {
          const pendingCount = entries.filter(e => e.status === 'pending').length;
          const readyCount = entries.filter(e => e.status === 'extracted' && (!e.duplicateOf || !e.duplicateOf.isMatched)).length;
          const reviewCount = entries.filter(e => e.status === 'extracted' && !e.duplicateOf && e.selectedGrnIds.length === 0).length;
          const dupMatched = entries.filter(e => e.duplicateOf?.isMatched).length;
          const unmatchedGrns = data.grns.filter(g => !grnToInvoice.has(g.id));
          return (
          <div>
            <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 cursor-pointer text-[11px] font-bold uppercase tracking-widest text-slate-700">
                <Upload size={12} /> Add Bills
                <input
                  type="file"
                  multiple
                  accept="application/pdf,image/*"
                  onChange={e => { onFilesPicked(e.target.files); e.currentTarget.value = ''; }}
                  className="hidden"
                  disabled={busy || savingAll}
                />
              </label>
              <div className="text-[10px] text-slate-500">PDF / JPG / PNG · matching scoped to <strong>{unmatchedGrns.length} unmatched GRNs</strong> on this page (faster, more accurate)</div>
              <div className="flex-1" />
              {entries.length > 0 && (
                <div className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">
                  {entries.length} file{entries.length === 1 ? '' : 's'} · {readyCount} ready
                  {reviewCount > 0 && <span className="text-amber-700 ml-1">· {reviewCount} need review</span>}
                  {dupMatched > 0 && <span className="text-violet-700 ml-1">· {dupMatched} already matched</span>}
                </div>
              )}
            </div>

            <div className="bg-slate-100 p-3 space-y-2 max-h-[420px] overflow-auto">
              {entries.length === 0 && (
                <div className="border-2 border-dashed border-slate-300 bg-white px-4 py-8 text-center text-xs text-slate-500">
                  Click <strong>Add Bills</strong> to drop PDFs / images of {vendor.name} bills.
                </div>
              )}
              {entries.map(entry => {
                const ext = entry.extracted || {};
                const grnsAvailable = data.grns.filter(g => !grnToInvoice.has(g.id));
                const selected = new Set(entry.selectedGrnIds);
                const selectedTotal = grnsAvailable.filter(g => selected.has(g.id)).reduce((s, g) => s + g.totalAmount, 0);
                const taxable = Number(ext.taxable_amount) || 0;
                return (
                  <div key={entry.id} className={`bg-white border overflow-hidden ${
                    entry.duplicateOf?.isMatched ? 'border-violet-400 ring-1 ring-violet-200' :
                    entry.duplicateOf ? 'border-fuchsia-400 ring-1 ring-fuchsia-200' :
                    entry.status === 'extracted' && entry.selectedGrnIds.length === 0 ? 'border-amber-400 ring-1 ring-amber-200' :
                    'border-slate-300'
                  }`}>
                    <div className="px-3 py-1.5 border-b border-slate-200 flex items-center gap-2 bg-slate-50">
                      <FileText size={12} className="text-slate-500" />
                      <div className="text-xs font-bold text-slate-700 truncate flex-1" title={entry.file.name}>{entry.file.name}</div>
                      <span className={
                        'text-[9px] font-bold uppercase px-1.5 py-0.5 border ' +
                        (entry.duplicateOf?.isMatched ? 'border-violet-400 bg-violet-50 text-violet-700' :
                         entry.duplicateOf ? 'border-fuchsia-400 bg-fuchsia-50 text-fuchsia-700' :
                         entry.status === 'pending' ? 'border-slate-300 bg-slate-100 text-slate-600' :
                         entry.status === 'extracting' ? 'border-blue-300 bg-blue-50 text-blue-700 animate-pulse' :
                         entry.status === 'extracted' ? 'border-emerald-400 bg-emerald-50 text-emerald-700' :
                         entry.status === 'saving' ? 'border-amber-400 bg-amber-50 text-amber-700 animate-pulse' :
                         entry.status === 'saved' ? 'border-emerald-500 bg-emerald-100 text-emerald-800' :
                         'border-red-400 bg-red-50 text-red-700')
                      }>
                        {entry.duplicateOf?.isMatched ? `Already matched · INV-${entry.duplicateOf.invoiceNo}`
                          : entry.duplicateOf ? `In system, no GRN · INV-${entry.duplicateOf.invoiceNo}`
                          : entry.status === 'saved' && entry.savedInvoiceNo ? `Saved · INV-${entry.savedInvoiceNo}`
                          : entry.status}
                      </span>
                      {!busy && !savingAll && entry.status !== 'saved' && (
                        <button onClick={() => removeEntry(entry.id)} className="text-slate-400 hover:text-red-600" title="Remove">
                          <X size={12} />
                        </button>
                      )}
                    </div>

                    {entry.status === 'error' && (
                      <div className="px-3 py-2 text-[11px] text-red-700 bg-red-50 whitespace-pre-line">{entry.error || 'Something went wrong'}</div>
                    )}
                    {entry.status === 'extracting' && (
                      <div className="px-3 py-3 text-[11px] text-blue-700">
                        <Sparkles size={11} className="inline mr-1" /> AI is reading the bill...
                      </div>
                    )}
                    {(entry.status === 'extracted' || entry.status === 'saving' || entry.status === 'saved') && (
                      <div className="grid grid-cols-1 md:grid-cols-2 divide-x divide-slate-200 text-xs">
                        <div className="p-3 space-y-1">
                          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Extracted from bill</div>
                          <div className="text-[10px] text-slate-600">
                            <span className="text-slate-400">Inv: </span><span className="font-mono font-bold">{ext.invoice_number || '--'}</span>
                            <span className="text-slate-400 ml-2">Date: </span><span className="font-mono">{ext.invoice_date || '--'}</span>
                          </div>
                          <div className="text-[10px] text-slate-700 pt-1">
                            <span className="text-slate-400">Taxable: </span><span className="font-mono font-bold">{taxable ? fmt(taxable) : '--'}</span>
                            <span className="text-slate-400 ml-2">GST: </span><span className="font-mono">{ext.total_gst ? fmt(Number(ext.total_gst)) : '--'}</span>
                          </div>
                          <div className="text-[11px] text-slate-800 font-bold pt-0.5">
                            Total: <span className="font-mono">{ext.total_amount ? fmt(Number(ext.total_amount)) : '--'}</span>
                            {ext.supply_type && <span className="ml-2 text-[9px] text-slate-500">({ext.supply_type})</span>}
                          </div>
                        </div>
                        <div className="p-3">
                          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1 flex items-center justify-between">
                            <span>Unmatched GRNs ({grnsAvailable.length})</span>
                            {grnsAvailable.length > 0 && <span className="text-slate-500 font-mono normal-case">{selected.size}/{grnsAvailable.length} · {fmt(selectedTotal)}</span>}
                          </div>
                          {grnsAvailable.length === 0 ? (
                            <div className="text-[10px] text-amber-700">No unmatched GRNs left for this vendor.</div>
                          ) : (
                            <div className="max-h-32 overflow-auto border border-slate-200">
                              {grnsAvailable.map(g => {
                                const isSel = selected.has(g.id);
                                const disabled = entry.status !== 'extracted';
                                return (
                                  <label key={g.id} className={`flex items-start gap-2 px-2 py-1 border-b border-slate-100 last:border-b-0 cursor-pointer hover:bg-slate-50 ${isSel ? 'bg-emerald-50' : ''}`}>
                                    <input
                                      type="checkbox"
                                      className="mt-0.5"
                                      checked={isSel}
                                      disabled={disabled}
                                      onChange={() => {
                                        const next = new Set(selected);
                                        if (next.has(g.id)) next.delete(g.id); else next.add(g.id);
                                        updateEntry(entry.id, { selectedGrnIds: Array.from(next) });
                                      }}
                                    />
                                    <div className="flex-1 min-w-0">
                                      <div className="text-[11px] font-bold text-slate-700">
                                        GRN-{g.grnNo}
                                        {g.po && <span className="text-slate-400 font-normal ml-1.5">· PO-{g.po.poNo}</span>}
                                        <span className="text-slate-400 font-normal ml-1.5">· {fmtDate(g.grnDate)}</span>
                                      </div>
                                      <div className="text-[10px] text-slate-500 truncate">
                                        {g.ticketNo ? `T-${String(g.ticketNo).padStart(4, '0')} · ` : ''}{g.vehicleNo || ''}
                                        {g.lines?.[0]?.description ? ` · ${g.lines[0].description}` : ''}
                                      </div>
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                      <div className="text-[10px] font-mono font-bold text-slate-700">{fmtNum(g.totalQty)} {g.lines?.[0]?.unit || ''}</div>
                                      <div className="text-[10px] font-mono text-slate-600">{fmt(g.totalAmount)}</div>
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                          {grnsAvailable.length > 0 && taxable > 0 && selected.size > 0 && (
                            <div className={`text-[10px] mt-1 ${Math.abs(selectedTotal - taxable) / Math.max(taxable, 1) < 0.05 ? 'text-emerald-700' : 'text-amber-700'}`}>
                              Selected {fmt(selectedTotal)} vs taxable {fmt(taxable)}
                              {Math.abs(selectedTotal - taxable) / Math.max(taxable, 1) < 0.05 ? ' ✓ matches' : ' — review'}
                            </div>
                          )}
                          {selected.size === 0 && entry.suggestedGrnIds && entry.suggestedGrnIds.length > 0 && (
                            <div className="mt-2 border border-amber-300 bg-amber-50 px-2 py-1.5 flex items-start gap-2">
                              <Sparkles size={11} className="text-amber-600 mt-0.5" />
                              <div className="flex-1 min-w-0">
                                <div className="text-[10px] font-bold text-amber-800 uppercase tracking-widest">AI suggestion (not exact)</div>
                                <div className="text-[10px] text-amber-900 mt-0.5">{entry.suggestedReason}</div>
                              </div>
                              <button
                                onClick={() => updateEntry(entry.id, { selectedGrnIds: entry.suggestedGrnIds!, suggestedGrnIds: undefined, suggestedReason: undefined })}
                                disabled={entry.status !== 'extracted'}
                                className="px-2 py-0.5 bg-amber-600 text-white text-[10px] font-bold uppercase hover:bg-amber-700 disabled:opacity-50"
                              >
                                Apply
                              </button>
                              <button
                                onClick={() => updateEntry(entry.id, { suggestedGrnIds: undefined, suggestedReason: undefined })}
                                disabled={entry.status !== 'extracted'}
                                className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] font-bold uppercase hover:bg-slate-50 disabled:opacity-50"
                              >
                                Dismiss
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="px-4 py-2 border-t border-slate-300 bg-white flex items-center gap-2">
              <button
                onClick={runAnalyze}
                disabled={pendingCount === 0 || busy || savingAll}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white text-[11px] font-bold uppercase tracking-widest hover:bg-purple-700 disabled:opacity-50"
              >
                {busy ? 'Analysing...' : <><Sparkles size={11} /> Analyze All ({pendingCount})</>}
              </button>
              <button
                onClick={saveAll}
                disabled={readyCount === 0 || savingAll || busy}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 text-white text-[11px] font-bold uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-50"
              >
                {savingAll ? 'Saving...' : `Save All (${readyCount})`}
              </button>
            </div>
          </div>
          );
        })()}
      </div>

      {/* ────────────── Documents — every PDF on file for this vendor ────────────── */}
      {(() => {
        const invDocs = data.invoices.filter(i => i.filePath);
        const poDocs = data.pos;
        const grnsWithLinkedInv = new Set(Array.from(grnToInvoice.keys()));
        if (invDocs.length === 0 && poDocs.length === 0 && data.grns.length === 0) return null;
        return (
          <div className="mb-3 border border-slate-300">
            <div className="bg-slate-700 text-white px-4 py-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest">
              <FileText size={12} />
              Documents
              <span className="text-slate-300 normal-case font-normal text-[10px]">
                · {invDocs.length} bill{invDocs.length === 1 ? '' : 's'} · {poDocs.length} PO{poDocs.length === 1 ? '' : 's'} · {data.grns.length} GRN{data.grns.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 divide-x divide-slate-200 bg-white">
              {/* Invoice PDFs */}
              <div className="p-3">
                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Vendor Invoices ({invDocs.length})</div>
                {invDocs.length === 0 ? (
                  <div className="text-[10px] text-slate-400">No invoice PDFs uploaded yet.</div>
                ) : (
                  <div className="flex flex-wrap gap-1 max-h-32 overflow-auto">
                    {invDocs.map(inv => {
                      const linked = (invoiceToGrns.get(inv.id) || []).length > 0;
                      return (
                        <a
                          key={inv.id}
                          href={`/uploads/${inv.filePath}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`${fmt(inv.totalAmount)} · ${fmtDate(inv.vendorInvDate || inv.invoiceDate)}${linked ? ' · linked' : ' · awaiting GRN'}`}
                          className={`inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 border ${linked ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100'}`}
                        >
                          <FileText size={9} /> {inv.vendorInvNo || `INV-${inv.invoiceNo}`}
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
              {/* PO PDFs */}
              <div className="p-3">
                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">POs ({poDocs.length})</div>
                {poDocs.length === 0 ? (
                  <div className="text-[10px] text-slate-400">No POs.</div>
                ) : (
                  <div className="flex flex-wrap gap-1 max-h-32 overflow-auto">
                    {poDocs.map(p => {
                      const isClosed = p.status === 'CLOSED' || p.status === 'CANCELLED';
                      return (
                        <a
                          key={p.id}
                          href={`/api/purchase-orders/${p.id}/pdf?token=${localStorage.getItem('token')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`${p.status} · ${fmtDate(p.poDate)} · ${fmt(p.grandTotal || 0)}`}
                          className={`inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 border ${isClosed ? 'border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100' : 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
                        >
                          <FileText size={9} /> PO-{p.poNo}
                          {isClosed && <span className="text-slate-400">·closed</span>}
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
              {/* GRN PDFs */}
              <div className="p-3">
                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">GRNs ({data.grns.length})</div>
                <div className="flex flex-wrap gap-1 max-h-32 overflow-auto">
                  {data.grns.map(g => {
                    const linked = grnsWithLinkedInv.has(g.id);
                    return (
                      <a
                        key={g.id}
                        href={`/api/goods-receipts/${g.id}/pdf?token=${localStorage.getItem('token')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`${fmt(g.totalAmount)} · ${fmtDate(g.grnDate)}${linked ? ' · invoiced' : ' · awaiting bill'}`}
                        className={`inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 border ${linked ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100'}`}
                      >
                        <FileText size={9} /> GRN-{g.grnNo}
                      </a>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

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
                      {matched ? (() => {
                        const invFull = data.invoices.find(x => x.id === inv.invoiceId);
                        const filePath = invFull?.filePath || null;
                        const label = `✓ ${inv.vendorInvNo || `INV-${inv.invoiceNo}`}`;
                        return filePath ? (
                          <a
                            href={`/uploads/${filePath}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open invoice PDF"
                            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold"
                          >
                            <FileText size={9} /> {label}
                          </a>
                        ) : (
                          <span title="Invoice has no PDF on file" className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 border border-emerald-300 bg-emerald-50 text-emerald-700 font-bold">{label}</span>
                        );
                      })() : (
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
                        {/* Pay — deep link back to PaymentsOut Pay modal pre-loaded with this invoice */}
                        {inv.balanceAmount > 0 && !unmatched && (
                          <a
                            href={`/accounts/payments-out?openPay=${inv.id}`}
                            className="px-2 py-0.5 bg-green-600 text-white text-[9px] font-bold uppercase hover:bg-green-700 inline-flex items-center gap-1"
                            title={`Record payment · balance ${fmt(inv.balanceAmount)}`}
                          >
                            Pay {fmt(inv.balanceAmount)}
                          </a>
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
