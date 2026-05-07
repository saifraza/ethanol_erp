import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import VendorLedgerModal from '../VendorLedgerModal';
import WeighbridgeTrucksModal from '../WeighbridgeTrucksModal';
import PayDialog from './PayDialog';
import InvoiceList from './InvoiceList';
import type { PaymentRow } from './types';

// PaymentsTable is the shared content of the three payments pages
// (FuelManagement → Payments tab, StorePayments, RawMaterialPayments). It
// renders the toolbar (optional), the optional category-chip row, the
// status/search filter strip, the KPI strip, the table itself, and the four
// row-level modals. Strict zero-behavior-change: all three pages render the
// same DOM/handlers as before, just hoisted into one component.

export interface PaymentsTableCategoryChip {
  key: string;
  label: string;
}

export interface PaymentsTableProps {
  /** Heading on the toolbar. */
  title: string;
  /** Optional subtitle e.g. "Boiler fuel deals & payments". */
  subtitle?: string;
  /**
   * API base for row listing — '/fuel/payments' (default) or
   * '/raw-material-purchase/payments'. The same base is forwarded to
   * InvoiceList + PayDialog so their endpoints stay aligned.
   */
  apiBase?: string;
  /**
   * Default category sent as ?category= when fetching rows. Only used if
   * apiBase accepts the param (i.e. '/fuel/payments'). For the RM endpoint
   * the param is ignored by the server.
   */
  defaultCategory: string;
  /**
   * Show the category chip row above the search/refresh strip.
   * Single-select chips. When provided, an "All" chip is prepended.
   */
  categoryChips?: PaymentsTableCategoryChip[];
  /** "All" chip label — appears first when categoryChips is provided. */
  allChipLabel?: string;
  /**
   * Categories prop forwarded to InvoiceList for the upload-guard. When
   * omitted, defaults to the active chip selection (or the defaultCategory
   * comma-list when no chips).
   */
  invoiceUploadCategories?: string;
  /**
   * PayDialog surface — 'fuel' (uses /fuel/deals/:id/payment) or 'generic'
   * (uses /purchase-orders/:id/pay). Defaults to 'generic' since most pages
   * should use the canonical PO endpoint.
   */
  paySurface?: 'fuel' | 'generic';
  /**
   * Render the dark toolbar block + optional category chip row at the top.
   * Pages with their own page chrome (FuelManagement Payments tab) pass false.
   * Default true.
   */
  renderToolbar?: boolean;
  /**
   * If provided, the row "+ Upload" link and the InvoiceList modal forward
   * to this callback instead of using the basic in-component multi-file POST.
   * FuelManagement passes this so its existing rich staging modal handles
   * per-file metadata + payment-at-upload-time.
   */
  onTriggerUpload?: (po: PaymentRow) => void;
  /**
   * Some pages know that a particular PO is mid-upload (e.g. the Fuel
   * staging modal sets uploadingPoId). When the id matches the row, the
   * "+ Upload" button shows a spinner and is disabled.
   */
  uploadingPoId?: string | null;
  /**
   * Counter bumped by the parent after an upload completes. Forwarded to
   * the InvoiceList key so it remounts + refetches.
   */
  invoiceListNonce?: number;
  /**
   * Imperative refresh hook — bumped by the parent after the staging modal
   * commits to force this component to re-fetch the row list.
   */
  refreshKey?: number;
  /**
   * Variant tweaks the few visual differences between the three pages
   * without expanding the prop surface:
   *  - 'fuel': fixed (no sortable headers), shows the extra "PO Total"
   *    column, material subtitle always renders qty + GRN, search
   *    placeholder uses "fuel".
   *  - 'generic': sortable headers, no PO Total column, qty hidden when 0,
   *    search placeholder uses "material". Default.
   */
  variant?: 'fuel' | 'generic';
  /** KPI label for the count tile. Defaults to "POs". */
  posLabel?: string;
  /** "All …" status filter button label, e.g. "All Fuel POs". */
  allStatusLabel?: string;
  /** Empty-state copy. Sensible defaults are provided. */
  emptyCopy?: {
    outstanding: string;
    paid: string;
    all: string;
  };
  /** Search-box placeholder. Defaults to "Search vendor, PO#, material, phone…". */
  searchPlaceholder?: string;
}

type StatusFilter = 'all' | 'outstanding' | 'paid';
type SortKey = 'poNo' | 'vendor' | 'material' | 'payable' | 'paid' | 'inflight' | 'outstanding' | 'lastPmt';
type SortDir = 'asc' | 'desc';

const fmtCurrency = (n: number) => n === 0 ? '--' : '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtNum = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

export default function PaymentsTable({
  title,
  subtitle,
  apiBase = '/fuel/payments',
  defaultCategory,
  categoryChips,
  allChipLabel = 'All',
  invoiceUploadCategories,
  paySurface = 'generic',
  renderToolbar = true,
  onTriggerUpload,
  uploadingPoId,
  invoiceListNonce: invoiceListNonceProp,
  refreshKey,
  variant = 'generic',
  posLabel = 'POs',
  allStatusLabel,
  emptyCopy,
  searchPlaceholder,
}: PaymentsTableProps) {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('outstanding');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('outstanding');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // 'ALL' selects the full default category list; any other key is a single
  // category name. Only relevant when categoryChips are provided.
  const ALL_KEY = '__ALL__';
  const [categoryChip, setCategoryChip] = useState<string>(ALL_KEY);

  const [payDialog, setPayDialog] = useState<{ poId: string; poNo: number; vendorId: string; vendorName: string; material: string; outstanding: number } | null>(null);
  const [invoicesModal, setInvoicesModal] = useState<{ poId: string; poNo: number; vendorName: string } | null>(null);
  const [trucksModal, setTrucksModal] = useState<{ poId: string; title: string; subtitle?: string } | null>(null);
  const [ledgerModal, setLedgerModal] = useState<{ vendorId: string; vendorName: string } | null>(null);

  // Bumped after a successful basic upload via InvoiceList so the open modal
  // remounts and re-fetches its rows. Parents can also pass invoiceListNonce
  // to force the same effect from outside (e.g. fuel staging modal flow).
  const [internalInvoiceListNonce, setInternalInvoiceListNonce] = useState(0);
  const effectiveInvoiceListNonce = (invoiceListNonceProp ?? 0) + internalInvoiceListNonce;

  // The category list we send to the server. With chips, ALL = the
  // defaultCategory comma-list; any other chip narrows to that one key.
  // Without chips, always the defaultCategory string.
  const activeCategoryParam = categoryChips
    ? (categoryChip === ALL_KEY ? defaultCategory : categoryChip)
    : defaultCategory;

  // FuelManagement historically does NOT send ?category=… — it pulls every
  // fuel-categorised PO via the dedicated handler. RM has its own route.
  // Only the store flow sends the param. Detect that by apiBase + chips.
  const usesCategoryParam = apiBase === '/fuel/payments' && !!categoryChips;

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<PaymentRow[]>(apiBase, usesCategoryParam ? { params: { category: activeCategoryParam } } : undefined);
      setPayments(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [apiBase, usesCategoryParam, activeCategoryParam]);

  useEffect(() => { fetchPayments(); }, [fetchPayments]);
  // External refresh hook — parents that mutate the dataset can bump
  // refreshKey to force a re-fetch without unmounting this component.
  useEffect(() => {
    if (refreshKey === undefined) return;
    void fetchPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const toggleSort = (key: SortKey) => {
    if (variant === 'fuel') return; // fuel table is fixed-order historically
    if (sortKey === key) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'poNo' || key === 'vendor' || key === 'material' || key === 'lastPmt' ? 'asc' : 'desc');
    }
  };

  const sortIndicator = (key: SortKey) => variant === 'fuel' || sortKey !== key ? '' : sortDir === 'asc' ? ' ↑' : ' ↓';
  const sortable = variant === 'generic';

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matchesSearch = (p: PaymentRow) => {
      if (!q) return true;
      return (
        p.vendor.name.toLowerCase().includes(q) ||
        `po-${p.poNo}`.includes(q) ||
        String(p.poNo).includes(q) ||
        (p.fuelName || '').toLowerCase().includes(q) ||
        (p.vendor.phone || '').toLowerCase().includes(q)
      );
    };
    const passesStatus = (p: PaymentRow) => {
      if (statusFilter === 'outstanding') return p.outstanding > 0.01 || p.pendingBank > 0 || p.pendingCash > 0;
      if (statusFilter === 'paid') return p.outstanding <= 0.01 && p.pendingBank <= 0 && p.pendingCash <= 0 && p.totalPaid > 0;
      return true;
    };
    const rows = payments.filter(p => matchesSearch(p) && passesStatus(p));

    if (!sortable) return rows;

    const dirMul = sortDir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      switch (sortKey) {
        case 'poNo': return (a.poNo - b.poNo) * dirMul;
        case 'vendor': return a.vendor.name.localeCompare(b.vendor.name) * dirMul;
        case 'material': return (a.fuelName || '').localeCompare(b.fuelName || '') * dirMul;
        case 'payable': return (a.payableBasis - b.payableBasis) * dirMul;
        case 'paid': return (a.totalPaid - b.totalPaid) * dirMul;
        case 'inflight': return ((a.pendingBank + a.pendingCash) - (b.pendingBank + b.pendingCash)) * dirMul;
        case 'outstanding': return (a.outstanding - b.outstanding) * dirMul;
        case 'lastPmt': {
          const av = a.lastPaymentDate ? new Date(a.lastPaymentDate).getTime() : 0;
          const bv = b.lastPaymentDate ? new Date(b.lastPaymentDate).getTime() : 0;
          return (av - bv) * dirMul;
        }
        default: return 0;
      }
    });
    return rows;
  }, [payments, search, statusFilter, sortKey, sortDir, sortable]);

  // KPI strip totals — keyed off the filtered set so the strip reflects
  // whatever the operator is looking at.
  const sumPoTotal = filtered.reduce((s, p) => s + p.poTotal, 0);
  const sumReceived = filtered.reduce((s, p) => s + p.receivedValue, 0);
  const sumPaid = filtered.reduce((s, p) => s + p.totalPaid, 0);
  const sumPendingBank = filtered.reduce((s, p) => s + p.pendingBank, 0);
  const sumPendingCash = filtered.reduce((s, p) => s + p.pendingCash, 0);
  const sumInFlight = sumPendingBank + sumPendingCash;
  const sumOutstanding = filtered.reduce((s, p) => s + p.outstanding, 0);
  const vendorsWithDues = new Set(filtered.filter(p => p.outstanding > 0.01).map(p => p.vendor.id)).size;

  const outstandingCount = payments.filter(p => p.outstanding > 0.01 || p.pendingBank > 0 || p.pendingCash > 0).length;

  const showPoTotalColumn = variant === 'fuel';
  const materialHeaderLabel = variant === 'fuel' ? 'Fuel' : 'Material';
  const placeholder = searchPlaceholder ?? (variant === 'fuel'
    ? 'Search vendor, PO#, fuel, phone…'
    : 'Search vendor, PO#, material, phone…');
  const allStatusButtonLabel = allStatusLabel ?? `All ${posLabel}`;
  const empty = emptyCopy ?? {
    outstanding: variant === 'fuel'
      ? 'No outstanding fuel payments — all caught up.'
      : 'No outstanding payments — all caught up.',
    paid: variant === 'fuel'
      ? 'No fully-paid fuel POs yet.'
      : 'No fully-paid POs yet.',
    all: variant === 'fuel'
      ? 'No fuel POs found.'
      : 'No POs found.',
  };

  // Effective categories list forwarded to InvoiceList — fall back to the
  // active chip selection (or the default category list when no chips).
  const effectiveInvoiceCategories = invoiceUploadCategories
    ?? (categoryChips ? activeCategoryParam : defaultCategory);

  // Wrapping the toolbar block + content. Two rendering modes:
  //   - renderToolbar=true (StorePayments / RawMaterialPayments): we own the
  //     full page chrome — toolbar, optional chip row, KPI, filter, table.
  //   - renderToolbar=false (FuelManagement Payments tab): the parent already
  //     renders a tab-bar toolbar. We render only the inner content.
  const content = (
    <>
      {/* Optional category chip row — only when chips are configured. */}
      {categoryChips && (
        <div className={`bg-white border-b border-slate-300 ${renderToolbar ? '-mx-3 md:-mx-6 border-x px-4' : 'px-4'} py-2 flex items-center gap-2 flex-wrap`}>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mr-1">Category:</span>
          <button
            onClick={() => setCategoryChip(ALL_KEY)}
            className={`px-3 py-1 text-[10px] font-bold uppercase tracking-widest border ${
              categoryChip === ALL_KEY
                ? 'bg-slate-800 text-white border-slate-800'
                : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
            }`}>
            {allChipLabel}
          </button>
          {categoryChips.map(c => (
            <button
              key={c.key}
              onClick={() => setCategoryChip(c.key)}
              className={`px-3 py-1 text-[10px] font-bold uppercase tracking-widest border ${
                categoryChip === c.key
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
              }`}>
              {c.label}
            </button>
          ))}
        </div>
      )}

      {/* Status + search strip */}
      <div className={`bg-slate-50 border-b border-slate-300 ${renderToolbar ? '-mx-3 md:-mx-6 border-x px-4' : 'px-4'} py-2 flex items-center justify-between gap-3 flex-wrap`}>
        <div className="flex gap-2 text-[10px] font-bold uppercase tracking-widest">
          <button
            onClick={() => setStatusFilter('outstanding')}
            className={`px-3 py-1 border ${statusFilter === 'outstanding' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'}`}>
            Outstanding {outstandingCount > 0 && <span className="ml-1.5 opacity-80">({outstandingCount})</span>}
          </button>
          <button
            onClick={() => setStatusFilter('paid')}
            className={`px-3 py-1 border ${statusFilter === 'paid' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'}`}>
            Fully Paid
          </button>
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1 border ${statusFilter === 'all' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'}`}>
            {allStatusButtonLabel}
          </button>
        </div>
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={placeholder}
              className="w-full border border-slate-300 bg-white pl-7 pr-2 py-1 text-xs focus:outline-none focus:border-slate-500"
            />
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">⌕</span>
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 text-xs px-1"
                aria-label="Clear search">
                ×
              </button>
            )}
          </div>
          {/* When the parent owns the toolbar (renderToolbar=true) the
              refresh button lives there. When the parent doesn't render a
              toolbar (FuelManagement tab) the refresh sits in this strip. */}
          {!renderToolbar && (
            <button onClick={fetchPayments} disabled={loading} className="px-3 py-1 border border-slate-300 bg-white text-slate-600 text-[10px] font-bold uppercase tracking-widest hover:border-slate-400 disabled:opacity-50 whitespace-nowrap">
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          )}
        </div>
      </div>

      {/* KPI strip — 5 KPIs */}
      <div className={`grid grid-cols-5 gap-0 border-b border-slate-300 ${renderToolbar ? '-mx-3 md:-mx-6 border-x' : ''}`}>
        <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{posLabel}</div>
          <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{filtered.length}</div>
        </div>
        <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-slate-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Received Value</div>
          <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtCurrency(sumReceived)}</div>
        </div>
        <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Paid (Confirmed)</div>
          <div className="text-xl font-bold text-emerald-700 mt-1 font-mono tabular-nums">{fmtCurrency(sumPaid)}</div>
        </div>
        <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-amber-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">In-Flight (Bank+Cash)</div>
          <div className="text-xl font-bold text-amber-700 mt-1 font-mono tabular-nums">{fmtCurrency(sumInFlight)}</div>
        </div>
        <div className="bg-white px-4 py-3 border-l-4 border-l-red-600">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Outstanding · {vendorsWithDues} Vendor{vendorsWithDues !== 1 ? 's' : ''}</div>
          <div className="text-xl font-bold text-red-700 mt-1 font-mono tabular-nums">{fmtCurrency(sumOutstanding)}</div>
        </div>
      </div>

      {/* Table */}
      <div className={`overflow-hidden bg-white ${renderToolbar ? '-mx-3 md:-mx-6 border-x border-b border-slate-300' : ''}`}>
        {loading && payments.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">Loading payments…</div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">
            {statusFilter === 'outstanding' ? empty.outstanding : statusFilter === 'paid' ? empty.paid : empty.all}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th onClick={() => toggleSort('poNo')} className={`text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 ${sortable ? 'cursor-pointer select-none hover:bg-slate-700' : ''}`}>PO#{sortIndicator('poNo')}</th>
                <th onClick={() => toggleSort('vendor')} className={`text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 ${sortable ? 'cursor-pointer select-none hover:bg-slate-700' : ''}`}>Vendor{sortIndicator('vendor')}</th>
                <th onClick={() => toggleSort('material')} className={`text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 ${sortable ? 'cursor-pointer select-none hover:bg-slate-700' : ''}`}>{materialHeaderLabel}{sortIndicator('material')}</th>
                {showPoTotalColumn && (
                  <th className="text-right px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">PO Total</th>
                )}
                <th onClick={() => toggleSort('payable')} className={`text-right px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 ${sortable ? 'cursor-pointer select-none hover:bg-slate-700' : ''}`} title="Received value · Billed (when no GRN) · Planned (when no GRN + no invoices)">Payable{sortIndicator('payable')}</th>
                <th onClick={() => toggleSort('paid')} className={`text-right px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 ${sortable ? 'cursor-pointer select-none hover:bg-slate-700' : ''}`}>Paid{sortIndicator('paid')}</th>
                <th onClick={() => toggleSort('inflight')} className={`text-right px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 ${sortable ? 'cursor-pointer select-none hover:bg-slate-700' : ''}`}>In-Flight{sortIndicator('inflight')}</th>
                <th onClick={() => toggleSort('outstanding')} className={`text-right px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 ${sortable ? 'cursor-pointer select-none hover:bg-slate-700' : ''}`}>Outstanding{sortIndicator('outstanding')}</th>
                <th onClick={() => toggleSort('lastPmt')} className={`text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 ${sortable ? 'cursor-pointer select-none hover:bg-slate-700' : ''}`}>Last Pmt{sortIndicator('lastPmt')}</th>
                <th className="text-center px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Invoices</th>
                <th className="text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => {
                const inFlight = p.pendingBank + p.pendingCash;
                return (
                  <tr key={p.id} className={`border-b border-slate-100 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                    <td className="px-3 py-1.5 font-mono text-slate-500 border-r border-slate-100">PO-{p.poNo}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100">
                      <button
                        onClick={() => setLedgerModal({ vendorId: p.vendor.id, vendorName: p.vendor.name })}
                        title="Open full vendor ledger across all POs + payments"
                        className="font-semibold text-slate-800 hover:text-indigo-700 hover:underline text-left">
                        {p.vendor.name}
                      </button>
                      {p.vendor.phone && <div className="text-[9px] text-slate-400">{p.vendor.phone}</div>}
                    </td>
                    <td className="px-3 py-1.5 border-r border-slate-100">
                      <div className="text-slate-700">{p.fuelName}</div>
                      {variant === 'fuel' ? (
                        <div className="text-[9px] text-slate-400 font-mono tabular-nums">{fmtNum(p.totalReceived)} {p.fuelUnit} · {p.grnCount} GRN{p.grnCount !== 1 ? 's' : ''}</div>
                      ) : (
                        <div className="text-[9px] text-slate-400 font-mono tabular-nums">
                          {p.totalReceived > 0
                            ? `${fmtNum(p.totalReceived)} ${p.fuelUnit} · ${p.grnCount} GRN${p.grnCount !== 1 ? 's' : ''}`
                            : `${p.grnCount} GRN${p.grnCount !== 1 ? 's' : ''}`}
                        </div>
                      )}
                    </td>
                    {showPoTotalColumn && (
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">{fmtCurrency(p.poTotal)}</td>
                    )}
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums font-bold border-r border-slate-100">
                      {p.basisSource === 'RECEIVED' ? (
                        fmtCurrency(p.receivedValue)
                      ) : p.basisSource === 'INVOICED' ? (
                        <>
                          <div title="No GRNs — basis is the invoiced total">{fmtCurrency(p.invoicedTotal)}</div>
                          <div className="text-[9px] text-indigo-500 font-bold uppercase tracking-widest">Billed</div>
                        </>
                      ) : (
                        <>
                          <div className="text-slate-400" title="No GRNs and no invoices — using planned PO total">{fmtCurrency(p.poTotal)}</div>
                          <div className="text-[9px] text-amber-600 font-bold uppercase tracking-widest">Planned</div>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-green-700 border-r border-slate-100">{fmtCurrency(p.totalPaid)}</td>
                    <td className={`px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100 ${inFlight > 0 ? 'text-amber-700' : 'text-slate-400'}`}>{fmtCurrency(inFlight)}</td>
                    <td className={`px-3 py-1.5 text-right font-mono tabular-nums font-bold border-r border-slate-100 ${p.outstanding > 0.01 ? 'text-red-600' : p.totalPaid > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>
                      {p.outstanding > 0.01 ? fmtCurrency(p.outstanding) : p.totalPaid > 0 ? '✓ Paid' : '—'}
                    </td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-[10px] text-slate-500 font-mono">
                      {p.lastPaymentDate ? new Date(p.lastPaymentDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}
                    </td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => setInvoicesModal({ poId: p.id, poNo: p.poNo, vendorName: p.vendor.name })}
                          disabled={p.invoiceCount === 0}
                          className={`text-[10px] font-bold font-mono tabular-nums px-1.5 py-0.5 ${p.invoiceCount > 0 ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200 cursor-pointer' : 'text-slate-300 cursor-not-allowed'}`}
                          title={p.invoiceCount > 0 ? `${p.invoiceCount} invoice${p.invoiceCount === 1 ? '' : 's'} attached · ${fmtCurrency(p.invoicedTotal)} billed` : 'No invoices yet'}>
                          {p.invoiceCount}
                        </button>
                        {onTriggerUpload ? (
                          <button
                            onClick={() => onTriggerUpload(p)}
                            disabled={uploadingPoId === p.id}
                            title="Upload invoices (PDF or image, max 10 MB each — pick multiple)"
                            className="text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-blue-600 disabled:opacity-50">
                            {uploadingPoId === p.id ? '…' : '+ Upload'}
                          </button>
                        ) : (
                          <button
                            onClick={() => setInvoicesModal({ poId: p.id, poNo: p.poNo, vendorName: p.vendor.name })}
                            title="Open invoice list — use the + Upload Files button inside to attach bills"
                            className="text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-blue-600">
                            + Upload
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex gap-1 flex-wrap">
                        {p.outstanding > 0.01 && (
                          <button
                            onClick={() => setPayDialog({
                              poId: p.id, poNo: p.poNo, vendorId: p.vendor.id,
                              vendorName: p.vendor.name, material: p.fuelName,
                              outstanding: p.outstanding,
                            })}
                            className="text-[10px] bg-blue-600 text-white px-2 py-1 font-bold uppercase tracking-widest hover:bg-blue-700">
                            Pay
                          </button>
                        )}
                        {p.grnCount > 0 && (
                          <button
                            onClick={() => setTrucksModal({ poId: p.id, title: `PO-${p.poNo}`, subtitle: `${p.vendor.name} · ${p.fuelName}` })}
                            className="text-[10px] text-purple-600 font-semibold uppercase hover:underline">
                            Trucks
                          </button>
                        )}
                        <button
                          onClick={() => setLedgerModal({ vendorId: p.vendor.id, vendorName: p.vendor.name })}
                          className="text-[10px] text-indigo-600 font-semibold uppercase hover:underline">
                          Ledger
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-800 text-white">
                <td colSpan={3} className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest">
                  Totals · {filtered.length} PO{filtered.length !== 1 ? 's' : ''}
                </td>
                {showPoTotalColumn ? (
                  <>
                    <td className="px-3 py-2 text-right font-mono tabular-nums font-bold">{fmtCurrency(sumPoTotal)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums font-bold">{fmtCurrency(sumReceived)}</td>
                  </>
                ) : (
                  <td className="px-3 py-2 text-right font-mono tabular-nums font-bold">{fmtCurrency(sumPoTotal)}</td>
                )}
                <td className="px-3 py-2 text-right font-mono tabular-nums text-green-300">{fmtCurrency(sumPaid)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-amber-300">{fmtCurrency(sumInFlight)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums font-bold text-red-300">{fmtCurrency(sumOutstanding)}</td>
                <td colSpan={3}></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </>
  );

  return (
    <>
      {renderToolbar ? (
        <div className="min-h-screen bg-slate-50">
          <div className="p-3 md:p-6 space-y-0">
            {/* Toolbar */}
            <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h1 className="text-sm font-bold tracking-wide uppercase">{title}</h1>
                {subtitle && (
                  <>
                    <span className="text-[10px] text-slate-400">|</span>
                    <span className="text-[10px] text-slate-400">{subtitle}</span>
                  </>
                )}
              </div>
              <button
                onClick={fetchPayments}
                disabled={loading}
                className="px-3 py-1 bg-slate-700 text-white text-[11px] font-medium hover:bg-slate-600 disabled:opacity-50">
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
            {content}
          </div>
        </div>
      ) : (
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden bg-white">
          {content}
        </div>
      )}

      {/* Vendor ledger modal */}
      {ledgerModal && (
        <VendorLedgerModal
          vendorId={ledgerModal.vendorId}
          vendorName={ledgerModal.vendorName}
          onClose={() => setLedgerModal(null)}
        />
      )}

      {/* Trucks (weighbridge) modal */}
      {trucksModal && (
        <WeighbridgeTrucksModal
          poId={trucksModal.poId}
          title={trucksModal.title}
          subtitle={trucksModal.subtitle}
          onClose={() => setTrucksModal(null)}
        />
      )}

      {/* Invoice list modal */}
      {invoicesModal && (
        <InvoiceList
          key={`invoices-${invoicesModal.poId}-${effectiveInvoiceListNonce}`}
          poId={invoicesModal.poId}
          poNo={invoicesModal.poNo}
          vendorName={invoicesModal.vendorName}
          fmtCurrency={fmtCurrency}
          categories={effectiveInvoiceCategories}
          apiBase={apiBase}
          onClose={() => setInvoicesModal(null)}
          onChanged={() => {
            setInternalInvoiceListNonce((n) => n + 1);
            void fetchPayments();
          }}
          onTriggerUpload={onTriggerUpload && invoicesModal
            ? () => {
                const po = payments.find(x => x.id === invoicesModal.poId);
                if (po) onTriggerUpload(po);
              }
            : undefined}
        />
      )}

      {/* Pay dialog */}
      {payDialog && (
        <PayDialog
          poId={payDialog.poId}
          poNo={payDialog.poNo}
          vendorName={payDialog.vendorName}
          subtitle={payDialog.material}
          outstanding={payDialog.outstanding}
          surface={paySurface}
          apiBase={apiBase}
          fmtCurrency={fmtCurrency}
          onClose={() => setPayDialog(null)}
          onPaid={() => {
            setPayDialog(null);
            void fetchPayments();
          }}
          onOpenVendorLedger={() => setLedgerModal({ vendorId: payDialog.vendorId, vendorName: payDialog.vendorName })}
        />
      )}
    </>
  );
}
