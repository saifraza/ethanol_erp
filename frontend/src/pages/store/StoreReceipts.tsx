/**
 * Store Receipts — manual GRN CRUD
 *
 * Used by the store in-charge for chemicals, spares, PPE, lab reagents, etc.
 * Data physically counted on delivery. Requires STORE_INCHARGE / PROCUREMENT_MANAGER / ADMIN role for writes.
 *
 * The headline safety feature is the DRAFT duplicate guard — if a DRAFT GRN
 * already exists for the selected PO, the backend returns 409 and this page
 * refuses to create a new one (preventing the PO-70 phantom-GRN incident from
 * recurring). Admin can force-create with an explicit override.
 *
 * See .claude/skills/grn-split-auto-vs-store.md for the full contract.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import GRNDetailDrawer from './GRNDetailDrawer';

interface StoreGRNLine {
  id: string;
  description: string;
  receivedQty: number;
  acceptedQty: number;
  unit: string;
  rate: number;
  amount: number;
}

interface StoreGRN {
  id: string;
  grnNo: number;
  grnDate: string;
  status: string;
  vehicleNo?: string | null;
  invoiceNo?: string | null;
  invoiceDate?: string | null;
  totalQty: number;
  totalAmount: number;
  fullyPaid: boolean;
  createdAt: string;
  userId?: string | null;
  po?: { id: string; poNo: number } | null;
  vendor?: { id: string; name: string } | null;
  lines?: StoreGRNLine[];
}

interface ListResponse {
  items?: StoreGRN[];
  total?: number;
  limit?: number;
  offset?: number;
}

interface POLineLite {
  id: string;
  description: string;
  materialId?: string | null;
  inventoryItemId?: string | null;
  quantity: number;
  receivedQty: number;
  pendingQty: number;
  unit: string;
  rate: number;
  gstPercent?: number;
}

interface POLite {
  id: string;
  poNo: number;
  status: string;
  vendor: { id: string; name: string };
  dealType?: string | null;
  lines: POLineLite[];
}

interface DraftConflict {
  id: string;
  grnNo: number;
  createdAt: string;
  createdBy?: string | null;
}

const PAGE_SIZE = 50;

const fmtDate = (s?: string | null) => {
  if (!s) return '--';
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
};
const fmtDateTime = (s?: string | null) => {
  if (!s) return '--';
  return new Date(s).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
};
const fmtINR = (n: number | null | undefined) => {
  if (!n) return '--';
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Store page hides raw-material / fuel POs — those are the weighbridge flow.
// Simple rule: PO dealType includes these strings, skip.
const isWeighbridgeDealType = (dealType?: string | null) => {
  if (!dealType) return false;
  const d = dealType.toUpperCase();
  return d.includes('RAW_MATERIAL') || d.includes('FUEL') || d.includes('GRAIN') || d.includes('HUSK');
};

export default function StoreReceipts() {
  const { user } = useAuth();
  const canWrite = !!user && ['STORE_INCHARGE', 'PROCUREMENT_MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(user.role || '');
  const isAdmin = !!user && ['ADMIN', 'SUPER_ADMIN'].includes(user.role || '');

  const [rows, setRows] = useState<StoreGRN[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [status, setStatus] = useState<string>('');
  const [page, setPage] = useState(0);

  // Detail drawer
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchRows = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('q', debouncedSearch);
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      if (status) params.set('status', status);
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(page * PAGE_SIZE));
      const res = await api.get(`/goods-receipts/store?${params.toString()}`);
      const data = res.data as ListResponse | StoreGRN[];
      const list = Array.isArray(data) ? data : data.items || [];
      setRows(list);
      setTotal(Array.isArray(data) ? list.length : data.total || list.length);
    } catch (err) {
      console.error('Failed to load store GRNs:', err);
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, fromDate, toDate, status, page]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const kpis = useMemo(() => {
    const draft = rows.filter((r) => r.status === 'DRAFT').length;
    const confirmed = rows.filter((r) => r.status === 'CONFIRMED').length;
    const sumAmount = rows.reduce((s, r) => s + (r.totalAmount || 0), 0);
    return { total, draft, confirmed, sumAmount };
  }, [rows, total]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const pageEnd = total === 0 ? 0 : page * PAGE_SIZE + rows.length;
  const initialLoading = loading && rows.length === 0 && !debouncedSearch && !fromDate && !toDate && !status;

  if (initialLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-xs text-slate-400 uppercase tracking-widest">Loading store receipts...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Store Receipts</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Manual GRN — chemicals, spares, lab, PPE, consumables</span>
          </div>
          {canWrite && (
            <button
              onClick={() => setCreateOpen(true)}
              className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 uppercase tracking-widest"
            >
              + New Receipt
            </button>
          )}
        </div>

        {/* Info banner */}
        <div className="bg-amber-50 border-x border-b border-amber-200 px-4 py-2 -mx-3 md:-mx-6 text-[10px] font-medium uppercase tracking-widest text-amber-800">
          Only use this page for items physically counted at the store.
          Weighbridge-delivered materials (rice husk, grain, fuel) are auto-created — see Auto GRN.
        </div>

        {/* Filter bar */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex gap-3 items-end flex-wrap">
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">
              Search (GRN / invoice / vendor / vehicle)
            </div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="e.g. 128 or MATRIX or 26-27/0011"
              className="border border-slate-300 px-2.5 py-1.5 text-xs w-72 focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Status</div>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
              className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
            >
              <option value="">All</option>
              <option value="DRAFT">Draft</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">From</div>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setPage(0);
              }}
              className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">To</div>
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setPage(0);
              }}
              className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </div>
          <button
            onClick={fetchRows}
            className="px-3 py-1.5 bg-slate-700 text-white text-[11px] font-medium hover:bg-slate-800 uppercase tracking-widest"
          >
            Refresh
          </button>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Matches</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{kpis.total}</div>
            <div className="text-[9px] text-slate-400 uppercase tracking-widest mt-1">Showing {rows.length} on page</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-amber-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Draft</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{kpis.draft}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Confirmed</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{kpis.confirmed}</div>
          </div>
          <div className="bg-white px-4 py-3 border-l-4 border-l-slate-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Page Value</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtINR(kpis.sumAmount)}</div>
          </div>
        </div>

        {/* Table */}
        <div className="-mx-3 md:-mx-6 border-x border-slate-300 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">GRN</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Date</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vendor</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">PO</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Invoice</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Items</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Amount</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">
                    No store receipts match the filter
                  </td>
                </tr>
              )}
              {rows.map((r, i) => {
                const statusColors =
                  r.status === 'DRAFT'
                    ? 'border-amber-300 bg-amber-50 text-amber-700'
                    : r.status === 'CONFIRMED'
                    ? 'border-green-300 bg-green-50 text-green-700'
                    : r.status === 'CANCELLED'
                    ? 'border-red-300 bg-red-50 text-red-700'
                    : 'border-slate-300 bg-slate-50 text-slate-600';
                return (
                  <tr
                    key={r.id}
                    onClick={() => setSelectedId(r.id)}
                    className={`border-b border-slate-100 hover:bg-blue-50/60 cursor-pointer ${
                      i % 2 ? 'bg-slate-50/70' : ''
                    }`}
                  >
                    <td className="px-3 py-1.5 text-slate-800 border-r border-slate-100 font-mono tabular-nums font-semibold">
                      GRN-{r.grnNo}
                    </td>
                    <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100 whitespace-nowrap">
                      {fmtDate(r.grnDate)}
                    </td>
                    <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{r.vendor?.name || '--'}</td>
                    <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100 font-mono tabular-nums">
                      {r.po?.poNo ? `PO-${r.po.poNo}` : '--'}
                    </td>
                    <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100 font-mono">
                      {r.invoiceNo || '--'}
                    </td>
                    <td className="px-3 py-1.5 text-center text-slate-700 border-r border-slate-100 font-mono tabular-nums">
                      {r.lines?.length ?? 0}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 font-semibold border-r border-slate-100">
                      {fmtINR(r.totalAmount)}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${statusColors}`}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center justify-between">
          <span className="text-[10px] text-slate-500 uppercase tracking-widest">
            {total === 0 ? 'No rows' : `Showing ${pageStart}-${pageEnd} of ${total}`}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] font-medium hover:bg-slate-50 disabled:opacity-30"
            >
              Prev
            </button>
            <span className="px-2 text-[10px] text-slate-500 font-mono tabular-nums">
              Page {page + 1} of {pageCount}
            </span>
            <button
              onClick={() => setPage((p) => (pageEnd < total ? p + 1 : p))}
              disabled={pageEnd >= total}
              className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] font-medium hover:bg-slate-50 disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>

        {/* Detail drawer */}
        {selectedId && (
          <GRNDetailDrawer
            grnId={selectedId}
            endpoint="store"
            readOnly={!canWrite}
            onClose={() => setSelectedId(null)}
            onChanged={fetchRows}
          />
        )}

        {/* Create modal */}
        {createOpen && canWrite && (
          <CreateReceiptModal
            isAdmin={isAdmin}
            onClose={() => setCreateOpen(false)}
            onCreated={(grnId) => {
              setCreateOpen(false);
              fetchRows();
              setSelectedId(grnId);
            }}
            onEditExisting={(grnId) => {
              setCreateOpen(false);
              setSelectedId(grnId);
            }}
          />
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Create Receipt Modal — PO picker → duplicate guard → line entry
// ═══════════════════════════════════════════════════════════════════════════
function CreateReceiptModal({
  isAdmin,
  onClose,
  onCreated,
  onEditExisting,
}: {
  isAdmin: boolean;
  onClose: () => void;
  onCreated: (grnId: string) => void;
  onEditExisting: (grnId: string) => void;
}) {
  const [step, setStep] = useState<'pick-po' | 'entry'>('pick-po');
  const [pos, setPos] = useState<POLite[]>([]);
  const [loadingPos, setLoadingPos] = useState(true);
  const [poSearch, setPoSearch] = useState('');
  const [selectedPO, setSelectedPO] = useState<POLite | null>(null);

  // Duplicate guard state
  const [draftConflicts, setDraftConflicts] = useState<DraftConflict[]>([]);
  const [forceCreate, setForceCreate] = useState(false);

  // Entry form
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [vehicleNo, setVehicleNo] = useState('');
  const [ewayBill, setEwayBill] = useState('');
  const [remarks, setRemarks] = useState('');
  const [grnDate, setGrnDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<
    Array<{
      poLineId: string;
      description: string;
      pendingQty: number;
      receivedQty: number;
      acceptedQty: number;
      unit: string;
      rate: number;
      batchNo: string;
      storageLocation: string;
      remarks: string;
    }>
  >([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load open POs once
  useEffect(() => {
    (async () => {
      try {
        setLoadingPos(true);
        const res = await api.get('/purchase-orders', {
          params: { limit: 500, status: 'APPROVED,SENT,PARTIAL_RECEIVED' },
        });
        const data = res.data as POLite[] | { items?: POLite[] };
        const list = Array.isArray(data) ? data : data.items || [];
        // Hide weighbridge-bound POs
        const filtered = list.filter((p) => !isWeighbridgeDealType(p.dealType));
        setPos(filtered);
      } catch (err) {
        console.error('Failed to load POs:', err);
        setPos([]);
      } finally {
        setLoadingPos(false);
      }
    })();
  }, []);

  const filteredPOs = useMemo(() => {
    const q = poSearch.trim().toLowerCase();
    if (!q) return pos;
    return pos.filter(
      (p) =>
        String(p.poNo).includes(q) ||
        p.vendor?.name?.toLowerCase().includes(q),
    );
  }, [pos, poSearch]);

  const pickPO = async (po: POLite) => {
    setError(null);
    setDraftConflicts([]);
    setForceCreate(false);
    setSelectedPO(po);

    // Check for existing drafts before moving to entry step
    try {
      const res = await api.get('/goods-receipts/store', {
        params: { poId: po.id, status: 'DRAFT', limit: 10 },
      });
      const data = res.data as { items?: StoreGRN[] } | StoreGRN[];
      const items = Array.isArray(data) ? data : data.items || [];
      if (items.length > 0) {
        setDraftConflicts(
          items.map((it) => ({
            id: it.id,
            grnNo: it.grnNo,
            createdAt: it.createdAt,
            createdBy: it.userId || null,
          })),
        );
        // Stay on pick step so user sees the banner
        return;
      }
    } catch (err) {
      // Non-fatal, let them proceed
      console.warn('Draft check failed:', err);
    }

    // No conflicts — pre-fill lines from PO
    seedLinesFromPO(po);
    setStep('entry');
  };

  const seedLinesFromPO = (po: POLite) => {
    const seeded = po.lines
      .filter((l) => l.pendingQty > 0 || l.quantity > 0)
      .map((l) => ({
        poLineId: l.id,
        description: l.description,
        pendingQty: l.pendingQty,
        receivedQty: l.pendingQty, // pre-fill full pending
        acceptedQty: l.pendingQty,
        unit: l.unit,
        rate: l.rate,
        batchNo: '',
        storageLocation: '',
        remarks: '',
      }));
    setLines(seeded);
  };

  const proceedAnyway = () => {
    if (!selectedPO) return;
    setForceCreate(true);
    seedLinesFromPO(selectedPO);
    setStep('entry');
  };

  const updateLine = (i: number, patch: Partial<(typeof lines)[number]>) => {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };

  const totalAmount = useMemo(
    () => lines.reduce((s, l) => s + l.acceptedQty * l.rate, 0),
    [lines],
  );

  const save = async () => {
    if (!selectedPO) return;
    setError(null);
    setSaving(true);
    try {
      const body: any = {
        poId: selectedPO.id,
        grnDate,
        invoiceNo,
        invoiceDate,
        vehicleNo,
        ewayBill,
        remarks,
        forceCreate,
        lines: lines
          .filter((l) => l.acceptedQty > 0)
          .map((l) => ({
            poLineId: l.poLineId,
            description: l.description,
            receivedQty: l.receivedQty,
            acceptedQty: l.acceptedQty,
            unit: l.unit,
            rate: l.rate,
            batchNo: l.batchNo,
            storageLocation: l.storageLocation,
            remarks: l.remarks,
          })),
      };
      if (body.lines.length === 0) {
        setError('Add at least one line with accepted qty > 0');
        setSaving(false);
        return;
      }
      const res = await api.post('/goods-receipts/store', body);
      const grn = res.data as StoreGRN;
      onCreated(grn.id);
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.error === 'DRAFT_GRN_EXISTS') {
        setDraftConflicts(data.existing || []);
        setStep('pick-po');
        setForceCreate(false);
      } else {
        setError(data?.message || err?.message || 'Save failed');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-5xl max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between sticky top-0">
          <div className="flex items-center gap-3">
            <h2 className="text-xs font-bold uppercase tracking-widest">New Store Receipt</h2>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400 normal-case tracking-normal">
              {step === 'pick-po' ? 'Step 1 of 2 · Pick PO' : `Step 2 of 2 · ${selectedPO ? `PO-${selectedPO.poNo} · ${selectedPO.vendor.name}` : ''}`}
            </span>
          </div>
          <button onClick={onClose} className="text-white hover:text-slate-300 text-lg leading-none">
            ×
          </button>
        </div>

        <div className="p-4 space-y-3">
          {step === 'pick-po' && (
            <>
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">
                    Search PO (number or vendor)
                  </div>
                  <input
                    type="text"
                    value={poSearch}
                    onChange={(e) => setPoSearch(e.target.value)}
                    autoFocus
                    placeholder="e.g. 70 or MATRIX"
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
              </div>

              {/* Duplicate guard banner */}
              {draftConflicts.length > 0 && (
                <div className="border border-red-300 bg-red-50 px-4 py-3">
                  <div className="text-[11px] font-bold text-red-800 uppercase tracking-widest mb-1">
                    Draft GRN Already Exists For This PO
                  </div>
                  <div className="text-[11px] text-red-700 mb-2">
                    The following DRAFT receipts are still open against{' '}
                    {selectedPO ? `PO-${selectedPO.poNo}` : 'this PO'}. Creating a new one
                    will cause the PO-70 phantom-GRN bug again. Edit the existing draft instead.
                  </div>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {draftConflicts.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => onEditExisting(d.id)}
                        className="px-2 py-1 bg-white border border-red-400 text-red-700 text-[11px] font-medium hover:bg-red-100 font-mono"
                      >
                        Edit GRN-{d.grnNo} · {fmtDateTime(d.createdAt)}
                      </button>
                    ))}
                  </div>
                  {isAdmin && (
                    <button
                      onClick={proceedAnyway}
                      className="text-[10px] text-red-800 underline uppercase tracking-widest hover:text-red-900"
                    >
                      Admin override — create new anyway
                    </button>
                  )}
                </div>
              )}

              <div className="border border-slate-300 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-800 text-white">
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">PO</th>
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vendor</th>
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
                      <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Lines</th>
                      <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingPos && (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-[10px] text-slate-400 uppercase tracking-widest">
                          Loading POs...
                        </td>
                      </tr>
                    )}
                    {!loadingPos && filteredPOs.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-[10px] text-slate-400 uppercase tracking-widest">
                          No open POs match
                        </td>
                      </tr>
                    )}
                    {filteredPOs.slice(0, 50).map((p, i) => (
                      <tr
                        key={p.id}
                        className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}
                      >
                        <td className="px-3 py-1.5 font-mono tabular-nums font-semibold border-r border-slate-100">
                          PO-{p.poNo}
                        </td>
                        <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{p.vendor.name}</td>
                        <td className="px-3 py-1.5 border-r border-slate-100">
                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-green-300 bg-green-50 text-green-700">
                            {p.status}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-center text-slate-600 border-r border-slate-100 font-mono tabular-nums">
                          {p.lines?.length ?? 0}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <button
                            onClick={() => pickPO(p)}
                            className="px-2 py-0.5 bg-blue-600 text-white text-[10px] font-medium hover:bg-blue-700 uppercase tracking-widest"
                          >
                            Pick
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {step === 'entry' && selectedPO && (
            <>
              {forceCreate && (
                <div className="border border-red-300 bg-red-50 px-3 py-2 text-[11px] text-red-700 uppercase tracking-widest font-bold">
                  Admin Override — creating new draft despite existing drafts
                </div>
              )}

              {/* Header form */}
              <div className="grid grid-cols-4 gap-3">
                <HeaderField label="GRN Date">
                  <input
                    type="date"
                    value={grnDate}
                    onChange={(e) => setGrnDate(e.target.value)}
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </HeaderField>
                <HeaderField label="Invoice No">
                  <input
                    type="text"
                    value={invoiceNo}
                    onChange={(e) => setInvoiceNo(e.target.value)}
                    placeholder="26-27/0011"
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </HeaderField>
                <HeaderField label="Invoice Date">
                  <input
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </HeaderField>
                <HeaderField label="Vehicle No">
                  <input
                    type="text"
                    value={vehicleNo}
                    onChange={(e) => setVehicleNo(e.target.value)}
                    placeholder="MP09GG6276"
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full font-mono focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </HeaderField>
                <HeaderField label="E-Way Bill">
                  <input
                    type="text"
                    value={ewayBill}
                    onChange={(e) => setEwayBill(e.target.value)}
                    placeholder="672090929237"
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full font-mono focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </HeaderField>
                <div className="col-span-3">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Remarks</div>
                  <input
                    type="text"
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
              </div>

              {/* Line entry */}
              <div className="border border-slate-300 overflow-hidden mt-3">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-800 text-white">
                      <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Item</th>
                      <th className="text-right px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Pending</th>
                      <th className="text-right px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Received</th>
                      <th className="text-right px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Accepted</th>
                      <th className="text-right px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Rate</th>
                      <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Batch</th>
                      <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Bin</th>
                      <th className="text-right px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => {
                      const over = l.acceptedQty > l.pendingQty * 1.1;
                      return (
                        <tr key={i} className={`border-b border-slate-100 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                          <td className="px-2 py-1 text-slate-800 border-r border-slate-100">{l.description}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums text-slate-500 border-r border-slate-100">
                            {l.pendingQty} {l.unit}
                          </td>
                          <td className="px-2 py-1 text-right border-r border-slate-100">
                            <input
                              type="number"
                              value={l.receivedQty}
                              onChange={(e) =>
                                updateLine(i, { receivedQty: parseFloat(e.target.value) || 0 })
                              }
                              className="border border-slate-300 px-1.5 py-0.5 text-xs w-20 text-right font-mono focus:outline-none focus:ring-1 focus:ring-slate-400"
                            />
                          </td>
                          <td className="px-2 py-1 text-right border-r border-slate-100">
                            <input
                              type="number"
                              value={l.acceptedQty}
                              onChange={(e) =>
                                updateLine(i, { acceptedQty: parseFloat(e.target.value) || 0 })
                              }
                              className={`border px-1.5 py-0.5 text-xs w-20 text-right font-mono focus:outline-none focus:ring-1 ${
                                over
                                  ? 'border-red-400 bg-red-50 text-red-700 focus:ring-red-400'
                                  : 'border-slate-300 focus:ring-slate-400'
                              }`}
                            />
                          </td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">
                            {fmtINR(l.rate)}
                          </td>
                          <td className="px-2 py-1 border-r border-slate-100">
                            <input
                              type="text"
                              value={l.batchNo}
                              onChange={(e) => updateLine(i, { batchNo: e.target.value })}
                              placeholder="batch"
                              className="border border-slate-300 px-1.5 py-0.5 text-xs w-24 focus:outline-none focus:ring-1 focus:ring-slate-400"
                            />
                          </td>
                          <td className="px-2 py-1 border-r border-slate-100">
                            <input
                              type="text"
                              value={l.storageLocation}
                              onChange={(e) => updateLine(i, { storageLocation: e.target.value })}
                              placeholder="bin"
                              className="border border-slate-300 px-1.5 py-0.5 text-xs w-20 focus:outline-none focus:ring-1 focus:ring-slate-400"
                            />
                          </td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums text-slate-800 font-semibold">
                            {fmtINR(l.acceptedQty * l.rate)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-800 text-white">
                      <td colSpan={7} className="px-2 py-1.5 text-right font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">
                        Total
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums font-bold">
                        {fmtINR(totalAmount)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {error && (
                <div className="border border-red-300 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                  {error}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  onClick={() => {
                    setStep('pick-po');
                    setSelectedPO(null);
                    setDraftConflicts([]);
                    setForceCreate(false);
                  }}
                  className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50 uppercase tracking-widest"
                >
                  Back
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50 uppercase tracking-widest"
                >
                  {saving ? 'Saving...' : 'Save Draft'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function HeaderField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">{label}</div>
      {children}
    </div>
  );
}
