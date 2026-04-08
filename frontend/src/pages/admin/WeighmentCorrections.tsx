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

interface CorrectableRow {
  id: string;
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
  vendorName: string;
}

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

const fmtKg = (tons: number) => {
  if (!tons) return '--';
  return (tons * 1000).toLocaleString('en-IN') + ' kg';
};

export default function WeighmentCorrections() {
  const [rows, setRows] = useState<CorrectableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Modal state
  const [editTarget, setEditTarget] = useState<CorrectableRow | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CorrectableRow | null>(null);
  const [historyTarget, setHistoryTarget] = useState<CorrectableRow | null>(null);

  const fetchRows = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      const res = await api.get<CorrectableRow[]>(`/weighbridge/admin/correctable?${params.toString()}`);
      setRows(res.data);
    } catch (err) {
      console.error('Failed to load weighments:', err);
    } finally {
      setLoading(false);
    }
  }, [search, fromDate, toDate]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const kpis = {
    total: rows.length,
    editable: rows.filter((r) => r.canEdit).length,
    blocked: rows.filter((r) => !r.canEdit && !r.cancelled).length,
    cancelled: rows.filter((r) => r.cancelled).length,
  };

  if (loading) {
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

        {/* Filter bar */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex gap-3 items-end">
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
              onChange={(e) => setFromDate(e.target.value)}
              className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">To</div>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
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
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Weighments</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{kpis.total}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Editable</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{kpis.editable}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-amber-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Blocked</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{kpis.blocked}</div>
          </div>
          <div className="bg-white px-4 py-3 border-l-4 border-l-red-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Cancelled</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{kpis.cancelled}</div>
          </div>
        </div>

        {/* Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Ticket</th>
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
                  <td colSpan={8} className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">
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
                    <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100 whitespace-nowrap">
                      {fmtDateTime(r.createdAt)}
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
  const [materialType, setMaterialType] = useState(row.materialType || '');
  const [supplier, setSupplier] = useState(row.supplier || '');
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
    // Load dropdown data
    api.get('/inventory/items?active=true').then((r) => setMaterials(r.data || [])).catch(() => {});
    api.get('/purchase-orders?status=APPROVED,PARTIALLY_RECEIVED').then((r) => setPos(r.data?.items || r.data || [])).catch(() => {});
    api.get('/vendors').then((r) => setVendors(r.data || [])).catch(() => {});
  }, []);

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
    if (materialId && materialId !== row.materialId) fields.materialId = materialId;
    if (materialType.trim() && materialType.trim() !== (row.materialType || '').trim()) fields.materialType = materialType.trim();
    if (supplier.trim() && supplier.trim() !== row.supplier) fields.supplier = supplier.trim();
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
                onChange={(e) => {
                  setMaterialId(e.target.value);
                  const m = materials.find((x) => x.id === e.target.value);
                  if (m) setMaterialType(m.name);
                }}
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

            <Field label="Material Name (free text)">
              <input
                type="text"
                value={materialType}
                onChange={(e) => setMaterialType(e.target.value)}
                className="border border-slate-300 px-2 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </Field>

            <Field label="Supplier / Party">
              <input
                type="text"
                list="vendorList"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                className="border border-slate-300 px-2 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
              <datalist id="vendorList">
                {vendors.map((v) => (
                  <option key={v.id} value={v.name} />
                ))}
              </datalist>
            </Field>

            <Field label="Purchase Order (optional)">
              <select
                value={poId}
                onChange={(e) => setPoId(e.target.value)}
                className="border border-slate-300 px-2 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
              >
                <option value="">-- keep current --</option>
                {pos.map((p) => (
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
      .get<CorrectionAudit[]>(`/weighbridge/admin/corrections/${row.id}`)
      .then((r) => setHistory(r.data))
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
