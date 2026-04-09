/**
 * Weighment Corrections — Admin UI
 *
 * Phase 1 scope: edit non-financial fields on GrainTruck weighment records
 * (material, supplier, PO, vehicle, driver, transporter, remarks) and cancel
 * entire weighments. All changes go through the cloud correction endpoint
 * which enforces downstream blocker checks, writes audit rows, and pushes
 * corrections back to the factory server.
 *
 * See .claude/skills/weighment-corrections.md for the full spec.
 */

import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface Blocker {
  code: string;
  message: string;
}

type WeighmentSource = 'GRAIN_TRUCK' | 'GOODS_RECEIPT' | 'ETHANOL_DISPATCH' | 'DDGS_DISPATCH';

interface CorrectableRow {
  id: string;
  mirrorId?: string;
  ticketNo: number | null;
  vehicleNo: string;
  supplier: string;
  materialType: string | null;
  materialId: string | null;
  weightGross: number;
  weightTare: number;
  weightNet: number;
  date: string;
  createdAt: string;
  cancelled: boolean;
  cancelledReason: string | null;
  grnId: string | null;
  factoryLocalId: string | null;
  source?: WeighmentSource;
  goodsReceipt: {
    grnNo: number;
    status: string;
    invoiceNo: string | null;
    fullyPaid: boolean;
  } | null;
  canEdit: boolean;
  blockers: Blocker[];
  requiresAdminPin: boolean;
}

const SOURCE_LABEL: Record<WeighmentSource, { text: string; cls: string }> = {
  GRAIN_TRUCK:      { text: 'GRAIN IN',  cls: 'border-blue-300 bg-blue-50 text-blue-700' },
  GOODS_RECEIPT:    { text: 'FUEL IN',   cls: 'border-orange-300 bg-orange-50 text-orange-700' },
  ETHANOL_DISPATCH: { text: 'ETH OUT',   cls: 'border-purple-300 bg-purple-50 text-purple-700' },
  DDGS_DISPATCH:    { text: 'DDGS OUT',  cls: 'border-teal-300 bg-teal-50 text-teal-700' },
};

interface CorrectionAudit {
  id: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  reason: string;
  correctedBy: string;
  correctedByRole: string;
  adminPinUsed: boolean;
  factorySynced: boolean;
  factoryError: string | null;
  createdAt: string;
}

interface InventoryItem {
  id: string;
  name: string;
  category: string;
}

interface VendorLite {
  id: string;
  name: string;
}

interface POLite {
  id: string;
  poNo: string;
  status: string;
  vendorId: string;
  vendorName: string;
}

interface CorrectableResponse {
  items?: CorrectableRow[];
  total?: number;
  limit?: number;
  offset?: number;
}

const PAGE_SIZE = 50;

const fmtDateTime = (s: string) => {
  const d = new Date(s);
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
};

const fmtKg = (kg: number) => {
  if (!kg) return '--';
  return Math.round(kg).toLocaleString('en-IN') + ' kg';
};

export default function WeighmentCorrections() {
  const [rows, setRows] = useState<CorrectableRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(0);

  // Debounce search input — avoid refetch on every keystroke
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Modal state
  const [editTarget, setEditTarget] = useState<CorrectableRow | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CorrectableRow | null>(null);
  const [historyTarget, setHistoryTarget] = useState<CorrectableRow | null>(null);

  const fetchRows = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(page * PAGE_SIZE));
      const res = await api.get(`/weighbridge/admin/correctable?${params.toString()}`);
      // Defensive: API may return array OR { items: [] } OR error object
      const data = res.data;
      const list = Array.isArray(data)
        ? data
        : Array.isArray((data as CorrectableResponse)?.items)
        ? (data as CorrectableResponse).items || []
        : [];
      setRows(list);
      setTotal(Array.isArray(data) ? list.length : typeof (data as CorrectableResponse)?.total === 'number' ? (data as CorrectableResponse).total || 0 : list.length);
    } catch (err) {
      console.error('Failed to load weighments:', err);
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, fromDate, toDate]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const kpis = {
    total,
    editable: rows.filter((r) => r.canEdit).length,
    blocked: rows.filter((r) => !r.canEdit && !r.cancelled).length,
    cancelled: rows.filter((r) => r.cancelled).length,
  };
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const pageEnd = total === 0 ? 0 : page * PAGE_SIZE + rows.length;
  const initialLoading = loading && rows.length === 0 && !debouncedSearch && !fromDate && !toDate;

  if (initialLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-xs text-slate-400 uppercase tracking-widest">Loading weighments...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Weighment Corrections</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Admin edit & cancel with full audit trail</span>
          </div>
        </div>

        <div className="bg-blue-50 border-x border-b border-blue-200 px-4 py-2 -mx-3 md:-mx-6 text-[10px] font-medium uppercase tracking-widest text-blue-700">
          Shows every weighment from the cloud mirror (grain in, fuel in, ethanol out, DDGS out). Only grain inbound rows are editable today — non-grain correction flows land in a later phase.
        </div>

        {/* Filter bar */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex gap-3 items-end flex-wrap">
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Search (ticket / vehicle / supplier)</div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="e.g. 137 or HR55T2963"
              className="border border-slate-300 px-2.5 py-1.5 text-xs w-64 focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
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
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Editable On Page</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{kpis.editable}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-amber-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Blocked On Page</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{kpis.blocked}</div>
          </div>
          <div className="bg-white px-4 py-3 border-l-4 border-l-red-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Cancelled On Page</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{kpis.cancelled}</div>
          </div>
        </div>

        {/* Table */}
        <div className="-mx-3 md:-mx-6 border-x border-slate-300 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Ticket</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Type</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Date / Time</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vehicle</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Supplier</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Material</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Net</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">
                    No weighments match the filter
                  </td>
                </tr>
              )}
              {rows.map((r, i) => {
                const statusLabel = r.cancelled
                  ? 'CANCELLED'
                  : r.grnId
                  ? `GRN-${r.goodsReceipt?.grnNo}`
                  : 'OPEN';
                const statusColors = r.cancelled
                  ? 'border-red-300 bg-red-50 text-red-700'
                  : r.grnId
                  ? 'border-amber-300 bg-amber-50 text-amber-700'
                  : 'border-green-300 bg-green-50 text-green-700';
                return (
                  <tr
                    key={r.id}
                    className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}
                  >
                    <td className="px-3 py-1.5 text-slate-800 border-r border-slate-100 font-mono tabular-nums">
                      {r.ticketNo ? `T-${r.ticketNo}` : '--'}
                    </td>
                    <td className="px-3 py-1.5 text-center border-r border-slate-100">
                      {r.source && SOURCE_LABEL[r.source] ? (
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${SOURCE_LABEL[r.source].cls}`}>
                          {SOURCE_LABEL[r.source].text}
                        </span>
                      ) : (
                        <span className="text-[9px] text-slate-400">--</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100 whitespace-nowrap">
                      {fmtDateTime(r.date || r.createdAt)}
                    </td>
                    <td className="px-3 py-1.5 text-slate-800 border-r border-slate-100 font-mono">
                      {r.vehicleNo}
                    </td>
                    <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{r.supplier || '--'}</td>
                    <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">
                      {r.materialType || '--'}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">
                      {fmtKg(r.weightNet)}
                    </td>
                    <td className="px-3 py-1.5 text-center border-r border-slate-100">
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${statusColors}`}>
                        {statusLabel}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          disabled={!r.canEdit}
                          title={r.canEdit ? 'Edit' : r.blockers[0]?.message || 'Blocked'}
                          onClick={() => setEditTarget(r)}
                          className="px-2 py-0.5 bg-blue-600 text-white text-[10px] font-medium hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
                        >
                          Edit
                        </button>
                        <button
                          disabled={!r.canEdit}
                          title={r.canEdit ? 'Cancel weighment' : r.blockers[0]?.message || 'Blocked'}
                          onClick={() => setCancelTarget(r)}
                          className="px-2 py-0.5 bg-white border border-red-300 text-red-600 text-[10px] font-medium hover:bg-red-50 disabled:border-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => setHistoryTarget(r)}
                          className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] font-medium hover:bg-slate-50"
                        >
                          History
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
      </div>

      {editTarget && (
        <EditModal
          row={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            fetchRows();
          }}
        />
      )}

      {cancelTarget && (
        <CancelModal
          row={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onSaved={() => {
            setCancelTarget(null);
            fetchRows();
          }}
        />
      )}

      {historyTarget && (
        <HistoryModal row={historyTarget} onClose={() => setHistoryTarget(null)} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// EDIT MODAL
// ═══════════════════════════════════════════════════════════════════════════

interface EditModalProps {
  row: CorrectableRow;
  onClose: () => void;
  onSaved: () => void;
}

function EditModal({ row, onClose, onSaved }: EditModalProps) {
  const [materialId, setMaterialId] = useState(row.materialId || '');
  const [vendorId, setVendorId] = useState('');
  const [vendorSearch, setVendorSearch] = useState('');
  const [vendorDropdownOpen, setVendorDropdownOpen] = useState(false);
  const [poId, setPoId] = useState('');
  const [vehicleNo, setVehicleNo] = useState(row.vehicleNo || '');
  const [remarks, setRemarks] = useState('');
  const [reason, setReason] = useState('');
  const [adminPin, setAdminPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [materials, setMaterials] = useState<InventoryItem[]>([]);
  const [pos, setPos] = useState<POLite[]>([]);
  const [vendors, setVendors] = useState<VendorLite[]>([]);

  useEffect(() => {
    // Load dropdown data. Every route here has a different response shape:
    //   /inventory/items     → { items: [...] }
    //   /vendors             → { vendors: [...] }
    //   /purchase-orders     → { pos: [...], total, page, limit }
    // We extract the first array-valued property from each.
    const firstArray = (d: unknown): unknown[] => {
      if (Array.isArray(d)) return d;
      if (d && typeof d === 'object') {
        for (const v of Object.values(d as Record<string, unknown>)) {
          if (Array.isArray(v)) return v;
        }
      }
      return [];
    };

    api.get('/inventory/items')
      .then((r) => setMaterials(firstArray(r.data) as InventoryItem[]))
      .catch(() => setMaterials([]));

    // PO backend does exact-match on status, so we can't pass comma-separated.
    // Fetch all open POs and filter client-side.
    api.get('/purchase-orders?limit=500')
      .then((r) => {
        type PoRaw = {
          id: string;
          poNo?: string | number;
          status?: string;
          vendorId?: string;
          vendor?: { id?: string; name?: string };
          vendorName?: string;
        };
        const list = firstArray(r.data) as PoRaw[];
        const open = list.filter((p) =>
          ['APPROVED', 'PARTIALLY_RECEIVED'].includes((p.status || '').toUpperCase()),
        );
        setPos(open.map((p) => ({
          id: p.id,
          poNo: String(p.poNo ?? '--'),
          status: p.status || '',
          vendorId: p.vendor?.id || p.vendorId || '',
          vendorName: p.vendor?.name || p.vendorName || '',
        })));
      })
      .catch(() => setPos([]));

    api.get('/vendors')
      .then((r) => {
        const list = firstArray(r.data) as VendorLite[];
        setVendors(list);
        // Pre-select current vendor by name match (supplier is stored as plain string)
        if (row.supplier) {
          const match = list.find((v) => v.name.trim().toLowerCase() === row.supplier.trim().toLowerCase());
          if (match) setVendorId(match.id);
          setVendorSearch(row.supplier);
        }
      })
      .catch(() => setVendors([]));
  }, [row.supplier]);

  // When vendor changes, clear PO (it may no longer be valid for the new vendor)
  const currentVendor = vendors.find((v) => v.id === vendorId);
  const filteredPOs = vendorId ? pos.filter((p) => p.vendorId === vendorId) : pos;
  const filteredVendors = vendorSearch
    ? vendors.filter((v) => v.name.toLowerCase().includes(vendorSearch.toLowerCase()))
    : vendors;

  const submit = async () => {
    setError('');
    if (reason.trim().length < 10) {
      setError('Reason must be at least 10 characters.');
      return;
    }
    if (row.requiresAdminPin && !adminPin) {
      setError('Admin PIN is required for records older than 30 days.');
      return;
    }

    const fields: Record<string, unknown> = {};
    if (materialId && materialId !== row.materialId) {
      fields.materialId = materialId;
      // materialType (human-readable name) is propagated server-side from the
      // selected InventoryItem.name, so we don't need to send it.
    }
    // Vendor dropdown drives supplier — store vendor.name into supplier field.
    if (currentVendor && currentVendor.name.trim() !== row.supplier.trim()) {
      fields.supplier = currentVendor.name.trim();
    }
    if (poId) fields.poId = poId;
    if (vehicleNo.trim() && vehicleNo.trim() !== row.vehicleNo) fields.vehicleNo = vehicleNo.trim();
    if (remarks) fields.remarks = remarks;

    if (Object.keys(fields).length === 0) {
      setError('No changes to save.');
      return;
    }

    try {
      setSaving(true);
      await api.put(`/weighbridge/admin/correct/${row.id}`, {
        fields,
        reason: reason.trim(),
        adminPin: adminPin || undefined,
      });
      onSaved();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string; message?: string; blockers?: Blocker[] } } };
      const msg = e.response?.data?.message || e.response?.data?.error || 'Save failed';
      const blockers = e.response?.data?.blockers;
      setError(blockers?.length ? `${msg}: ${blockers.map((b) => b.message).join('; ')}` : msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest">
            Edit Weighment T-{row.ticketNo} — {row.vehicleNo}
          </span>
          <button onClick={onClose} className="text-slate-300 hover:text-white text-lg leading-none">×</button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-3">
          {error && (
            <div className="bg-red-50 border border-red-300 text-red-700 px-3 py-2 text-xs">{error}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Material">
              <select
                value={materialId}
                onChange={(e) => setMaterialId(e.target.value)}
                className="border border-slate-300 px-2 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
              >
                <option value="">-- select --</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} [{m.category}]
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Supplier / Vendor">
              <div className="relative">
                <input
                  type="text"
                  value={vendorSearch}
                  onChange={(e) => {
                    setVendorSearch(e.target.value);
                    setVendorDropdownOpen(true);
                    // Clear selection if user edits text
                    if (currentVendor && currentVendor.name !== e.target.value) {
                      setVendorId('');
                      setPoId('');
                    }
                  }}
                  onFocus={() => setVendorDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setVendorDropdownOpen(false), 150)}
                  placeholder="Type to search vendor..."
                  className="border border-slate-300 px-2 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
                {vendorDropdownOpen && filteredVendors.length > 0 && (
                  <div className="absolute z-10 left-0 right-0 top-full mt-0.5 bg-white border border-slate-300 shadow-lg max-h-48 overflow-y-auto">
                    {filteredVendors.slice(0, 50).map((v) => (
                      <div
                        key={v.id}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setVendorId(v.id);
                          setVendorSearch(v.name);
                          setVendorDropdownOpen(false);
                          // Reset PO if it no longer matches the new vendor
                          const currentPo = pos.find((p) => p.id === poId);
                          if (currentPo && currentPo.vendorId !== v.id) setPoId('');
                        }}
                        className={`px-2 py-1 text-xs cursor-pointer hover:bg-blue-50 ${v.id === vendorId ? 'bg-blue-100' : ''}`}
                      >
                        {v.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Field>

            <Field label={`Purchase Order (${filteredPOs.length} open${vendorId ? ' for vendor' : ''})`}>
              <select
                value={poId}
                onChange={(e) => setPoId(e.target.value)}
                className="border border-slate-300 px-2 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
              >
                <option value="">-- keep current --</option>
                {filteredPOs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.poNo} — {p.vendorName} [{p.status}]
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Vehicle No">
              <input
                type="text"
                value={vehicleNo}
                onChange={(e) => setVehicleNo(e.target.value.toUpperCase())}
                className="border border-slate-300 px-2 py-1.5 text-xs w-full font-mono focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </Field>

            <Field label="Remarks">
              <input
                type="text"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="border border-slate-300 px-2 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </Field>
          </div>

          <Field label={`Reason (mandatory, min 10 chars — ${reason.trim().length}/10)`}>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Why is this correction needed? Be specific — audit log will show this."
              className="border border-slate-300 px-2 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </Field>

          {row.requiresAdminPin && (
            <Field label="Admin Override PIN (required — record > 30 days old)">
              <input
                type="password"
                value={adminPin}
                onChange={(e) => setAdminPin(e.target.value)}
                className="border border-slate-300 px-2 py-1.5 text-xs w-48 focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </Field>
          )}
        </div>

        <div className="bg-slate-50 border-t border-slate-300 px-4 py-2.5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50 uppercase tracking-widest"
          >
            Cancel
          </button>
          <button
            disabled={saving || reason.trim().length < 10}
            onClick={submit}
            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50 uppercase tracking-widest"
          >
            {saving ? 'Saving...' : 'Save Correction'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CANCEL MODAL
// ═══════════════════════════════════════════════════════════════════════════

function CancelModal({ row, onClose, onSaved }: EditModalProps) {
  const [reason, setReason] = useState('');
  const [adminPin, setAdminPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (reason.trim().length < 10) {
      setError('Reason must be at least 10 characters.');
      return;
    }
    try {
      setSaving(true);
      await api.post(`/weighbridge/admin/cancel/${row.id}`, {
        reason: reason.trim(),
        adminPin: adminPin || undefined,
      });
      onSaved();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string; message?: string; blockers?: Blocker[] } } };
      const msg = e.response?.data?.message || e.response?.data?.error || 'Cancel failed';
      const blockers = e.response?.data?.blockers;
      setError(blockers?.length ? `${msg}: ${blockers.map((b) => b.message).join('; ')}` : msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white shadow-2xl max-w-md w-full">
        <div className="bg-red-700 text-white px-4 py-2.5 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest">
            Cancel Weighment T-{row.ticketNo}
          </span>
          <button onClick={onClose} className="text-red-200 hover:text-white text-lg leading-none">×</button>
        </div>
        <div className="p-4 space-y-3">
          {error && (
            <div className="bg-red-50 border border-red-300 text-red-700 px-3 py-2 text-xs">{error}</div>
          )}
          <div className="text-xs text-slate-600">
            You are about to cancel the weighment for vehicle <b className="font-mono">{row.vehicleNo}</b>{' '}
            ({row.supplier} — {row.materialType}). This cannot be undone.
          </div>

          <Field label={`Reason (mandatory, min 10 chars — ${reason.trim().length}/10)`}>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Why is this being cancelled?"
              className="border border-slate-300 px-2 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </Field>

          {row.requiresAdminPin && (
            <Field label="Admin Override PIN (record > 30 days old)">
              <input
                type="password"
                value={adminPin}
                onChange={(e) => setAdminPin(e.target.value)}
                className="border border-slate-300 px-2 py-1.5 text-xs w-48 focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </Field>
          )}
        </div>
        <div className="bg-slate-50 border-t border-slate-300 px-4 py-2.5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50 uppercase tracking-widest"
          >
            Back
          </button>
          <button
            disabled={saving || reason.trim().length < 10}
            onClick={submit}
            className="px-3 py-1 bg-red-600 text-white text-[11px] font-medium hover:bg-red-700 disabled:opacity-50 uppercase tracking-widest"
          >
            {saving ? 'Cancelling...' : 'Confirm Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// HISTORY MODAL
// ═══════════════════════════════════════════════════════════════════════════

function HistoryModal({ row, onClose }: { row: CorrectableRow; onClose: () => void }) {
  const [history, setHistory] = useState<CorrectionAudit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get(`/weighbridge/admin/corrections/${row.id}`)
      .then((r) => {
        const d = r.data;
        setHistory(Array.isArray(d) ? (d as CorrectionAudit[]) : []);
      })
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, [row.id]);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest">
            Correction History — T-{row.ticketNo} — {row.vehicleNo}
          </span>
          <button onClick={onClose} className="text-slate-300 hover:text-white text-lg leading-none">×</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="p-8 text-center text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
          )}
          {!loading && history.length === 0 && (
            <div className="p-8 text-center text-xs text-slate-400 uppercase tracking-widest">
              No corrections on record
            </div>
          )}
          {!loading && history.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300">
                  <th className="text-left px-3 py-2 text-[10px] uppercase tracking-widest text-slate-600">When</th>
                  <th className="text-left px-3 py-2 text-[10px] uppercase tracking-widest text-slate-600">Field</th>
                  <th className="text-left px-3 py-2 text-[10px] uppercase tracking-widest text-slate-600">Old → New</th>
                  <th className="text-left px-3 py-2 text-[10px] uppercase tracking-widest text-slate-600">By</th>
                  <th className="text-left px-3 py-2 text-[10px] uppercase tracking-widest text-slate-600">Reason</th>
                  <th className="text-center px-3 py-2 text-[10px] uppercase tracking-widest text-slate-600">Factory</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b border-slate-100">
                    <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{fmtDateTime(h.createdAt)}</td>
                    <td className="px-3 py-1.5 font-mono text-slate-800">{h.fieldName}</td>
                    <td className="px-3 py-1.5 text-slate-700">
                      <span className="text-slate-400">{h.oldValue || '--'}</span>
                      <span className="mx-1">→</span>
                      <span className="text-slate-800 font-medium">{h.newValue || '--'}</span>
                    </td>
                    <td className="px-3 py-1.5 text-slate-700">
                      {h.correctedBy}
                      <div className="text-[9px] text-slate-400">{h.correctedByRole}{h.adminPinUsed ? ' · PIN' : ''}</div>
                    </td>
                    <td className="px-3 py-1.5 text-slate-600 max-w-xs">{h.reason}</td>
                    <td className="px-3 py-1.5 text-center">
                      {h.factorySynced ? (
                        <span className="text-[9px] font-bold text-green-600 uppercase">synced</span>
                      ) : (
                        <span
                          className="text-[9px] font-bold text-amber-600 uppercase"
                          title={h.factoryError || ''}
                        >
                          pending
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="bg-slate-50 border-t border-slate-300 px-4 py-2.5 flex justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50 uppercase tracking-widest"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">{label}</div>
      {children}
    </div>
  );
}
