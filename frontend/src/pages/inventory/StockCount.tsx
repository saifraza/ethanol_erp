import React, { useState, useEffect, useCallback } from 'react';
import { Plus, X, Save, Loader2, CheckCircle, ArrowLeft } from 'lucide-react';
import api from '../../services/api';

interface Warehouse {
  id: string;
  code: string;
  name: string;
}

interface StockCountSummary {
  id: string;
  countNo: number;
  warehouseId: string;
  warehouse?: { code: string; name: string };
  countDate: string;
  status: string;
  countType: string;
  remarks?: string;
  _count?: { lines: number };
  createdAt: string;
}

interface CountLine {
  id: string;
  itemId: string;
  item?: { id: string; name: string; code?: string; unit: string };
  batchId?: string;
  batch?: { batchNo: string };
  binId?: string;
  bin?: { code: string };
  systemQty: number;
  physicalQty: number | null;
  variance: number | null;
  variancePct: number | null;
  remarks?: string;
}

interface StockCountDetail extends StockCountSummary {
  lines: CountLine[];
  approvedBy?: string;
  userId: string;
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'border-slate-300 bg-slate-50 text-slate-600',
  IN_PROGRESS: 'border-amber-300 bg-amber-50 text-amber-700',
  COMPLETED: 'border-blue-300 bg-blue-50 text-blue-700',
  APPROVED: 'border-emerald-300 bg-emerald-50 text-emerald-700',
};

const COUNT_TYPE_LABELS: Record<string, string> = {
  FULL: 'Full Count',
  CYCLE: 'Cycle Count',
  SPOT: 'Spot Check',
};

export default function StockCount() {
  const [counts, setCounts] = useState<StockCountSummary[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createWarehouseId, setCreateWarehouseId] = useState('');
  const [createType, setCreateType] = useState('FULL');
  const [createRemarks, setCreateRemarks] = useState('');
  const [creating, setCreating] = useState(false);

  // Detail view
  const [detail, setDetail] = useState<StockCountDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [lineEdits, setLineEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);

  const loadCounts = useCallback(async () => {
    try {
      setLoading(true);
      const [countsRes, whRes] = await Promise.all([
        api.get('/inventory/counts'),
        api.get('/inventory/warehouses'),
      ]);
      setCounts(countsRes.data.counts || countsRes.data || []);
      setWarehouses(whRes.data.warehouses || whRes.data || []);
    } catch {
      setMsg({ type: 'err', text: 'Failed to load stock counts' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  const handleCreate = async () => {
    if (!createWarehouseId) {
      setMsg({ type: 'err', text: 'Select a warehouse' });
      return;
    }
    try {
      setCreating(true);
      const res = await api.post('/inventory/counts', {
        warehouseId: createWarehouseId,
        countType: createType,
        remarks: createRemarks || undefined,
      });
      setMsg({ type: 'ok', text: `Stock count #${res.data.countNo} created` });
      setShowCreate(false);
      setCreateWarehouseId('');
      setCreateType('FULL');
      setCreateRemarks('');
      loadCounts();
    } catch {
      setMsg({ type: 'err', text: 'Failed to create stock count' });
    } finally {
      setCreating(false);
    }
  };

  const openDetail = async (id: string) => {
    try {
      setDetailLoading(true);
      const res = await api.get(`/inventory/counts/${id}`);
      const data: StockCountDetail = res.data;
      setDetail(data);
      // Pre-fill line edits with existing physicalQty
      const edits: Record<string, string> = {};
      (data.lines || []).forEach((line) => {
        if (line.physicalQty !== null && line.physicalQty !== undefined) {
          edits[line.id] = String(line.physicalQty);
        }
      });
      setLineEdits(edits);
    } catch {
      setMsg({ type: 'err', text: 'Failed to load count details' });
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSaveLines = async () => {
    if (!detail) return;
    try {
      setSaving(true);
      const lines = detail.lines.map((line) => ({
        id: line.id,
        physicalQty:
          lineEdits[line.id] !== undefined && lineEdits[line.id] !== ''
            ? parseFloat(lineEdits[line.id])
            : null,
      }));
      await api.put(`/inventory/counts/${detail.id}/lines`, { lines });
      setMsg({ type: 'ok', text: 'Physical quantities saved' });
      // Reload detail
      openDetail(detail.id);
      loadCounts();
    } catch {
      setMsg({ type: 'err', text: 'Failed to save lines' });
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!detail) return;
    if (!confirm('Approve this count? This will post stock adjustments for all variances.')) return;
    try {
      setApproving(true);
      await api.post(`/inventory/counts/${detail.id}/approve`);
      setMsg({ type: 'ok', text: 'Stock count approved and adjustments posted' });
      openDetail(detail.id);
      loadCounts();
    } catch {
      setMsg({ type: 'err', text: 'Failed to approve count' });
    } finally {
      setApproving(false);
    }
  };

  const allLinesCounted =
    detail?.lines.every(
      (l) => lineEdits[l.id] !== undefined && lineEdits[l.id] !== ''
    ) ?? false;

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  // Detail View
  if (detail) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="p-3 md:p-6 space-y-0">
          {/* Detail Toolbar */}
          <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setDetail(null)}
                className="p-1 hover:bg-slate-700 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <h1 className="text-sm font-bold tracking-wide uppercase">
                  Stock Count #{detail.countNo}
                </h1>
                <p className="text-[11px] text-slate-300 mt-0.5">
                  {detail.warehouse?.name || 'Warehouse'} | {COUNT_TYPE_LABELS[detail.countType]} | {formatDate(detail.countDate)}
                </p>
              </div>
            </div>
            <span
              className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${STATUS_STYLES[detail.status]}`}
            >
              {detail.status.replace('_', ' ')}
            </span>
          </div>

          {/* Flash Message */}
          {msg && (
            <div
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border -mx-3 md:-mx-6 ${
                msg.type === 'ok'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                  : 'bg-red-50 text-red-700 border-red-300'
              }`}
            >
              {msg.text}
            </div>
          )}

          {/* Lines Table */}
          <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">#</th>
                    <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Item</th>
                    <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Bin</th>
                    <th className="text-right px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">System Qty</th>
                    <th className="text-right px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Physical Qty</th>
                    <th className="text-right px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Variance</th>
                    <th className="text-right px-3 py-2 font-medium text-[11px] uppercase tracking-wider">Variance %</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.lines || []).map((line, idx) => {
                    const physQty =
                      lineEdits[line.id] !== undefined && lineEdits[line.id] !== ''
                        ? parseFloat(lineEdits[line.id])
                        : null;
                    const variance = physQty !== null ? physQty - line.systemQty : null;
                    const variancePct =
                      variance !== null && line.systemQty !== 0
                        ? (variance / line.systemQty) * 100
                        : variance !== null && line.systemQty === 0 && physQty !== 0
                        ? 100
                        : null;
                    const isHighVariance =
                      variancePct !== null && Math.abs(variancePct) > 5;
                    const isEditable =
                      detail.status === 'DRAFT' ||
                      detail.status === 'IN_PROGRESS';

                    return (
                      <tr
                        key={line.id}
                        className={`border-b border-slate-100 ${isHighVariance ? 'bg-red-50' : 'hover:bg-blue-50/40 even:bg-slate-50/50'}`}
                      >
                        <td className="px-3 py-1.5 text-slate-400 text-xs border-r border-slate-100">{idx + 1}</td>
                        <td className="px-3 py-1.5 border-r border-slate-100">
                          <div className="text-slate-700 font-medium">
                            {line.item?.code && (
                              <span className="text-slate-400 font-mono text-xs mr-1.5">{line.item.code}</span>
                            )}
                            {line.item?.name || line.itemId}
                          </div>
                          {line.batch && (
                            <div className="text-[11px] text-slate-400 mt-0.5">Batch: {line.batch.batchNo}</div>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-slate-500 border-r border-slate-100">{line.bin?.code || '--'}</td>
                        <td className="px-3 py-1.5 text-right text-slate-700 font-mono tabular-nums font-medium border-r border-slate-100">
                          {line.systemQty.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-3 py-1.5 text-right border-r border-slate-100">
                          {isEditable ? (
                            <input
                              type="number"
                              step="0.01"
                              className={`w-28 text-right border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400 ${
                                isHighVariance ? 'border-red-300 bg-red-50' : ''
                              }`}
                              value={lineEdits[line.id] ?? ''}
                              onChange={(e) =>
                                setLineEdits((prev) => ({ ...prev, [line.id]: e.target.value }))
                              }
                              placeholder="--"
                            />
                          ) : (
                            <span className="font-mono tabular-nums font-medium text-slate-700">
                              {line.physicalQty !== null
                                ? line.physicalQty.toLocaleString('en-IN', { maximumFractionDigits: 2 })
                                : '--'}
                            </span>
                          )}
                        </td>
                        <td
                          className={`px-3 py-1.5 text-right font-mono tabular-nums font-medium border-r border-slate-100 ${
                            isHighVariance
                              ? 'text-red-600'
                              : variance !== null && variance !== 0
                              ? 'text-orange-600'
                              : 'text-slate-400'
                          }`}
                        >
                          {variance !== null
                            ? variance.toLocaleString('en-IN', { maximumFractionDigits: 2 })
                            : '--'}
                        </td>
                        <td
                          className={`px-3 py-1.5 text-right font-mono tabular-nums font-medium ${
                            isHighVariance ? 'text-red-600 font-bold' : 'text-slate-400'
                          }`}
                        >
                          {variancePct !== null ? `${variancePct.toFixed(1)}%` : '--'}
                        </td>
                      </tr>
                    );
                  })}
                  {(detail.lines || []).length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-slate-300 text-sm">
                        No count lines found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Action Footer - Save */}
            {(detail.status === 'DRAFT' || detail.status === 'IN_PROGRESS') && (
              <div className="bg-slate-50 border-t border-slate-200 px-5 py-3 flex items-center justify-between">
                <p className="text-[11px] text-slate-500">
                  {Object.values(lineEdits).filter((v) => v !== '').length} of{' '}
                  {detail.lines.length} items counted
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveLines}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Save Counts
                  </button>
                </div>
              </div>
            )}

            {/* Action Footer - Approve */}
            {detail.status === 'COMPLETED' && (
              <div className="bg-slate-50 border-t border-slate-200 px-5 py-3 flex justify-end">
                <button
                  onClick={handleApprove}
                  disabled={approving}
                  className="flex items-center gap-1.5 px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {approving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CheckCircle className="w-3.5 h-3.5" />
                  )}
                  Approve & Post Adjustments
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // List View
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <h1 className="text-sm font-bold tracking-wide uppercase">STOCK COUNTS</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700"
            >
              <Plus className="w-3.5 h-3.5" />
              New Count
            </button>
          </div>
        </div>

        {/* Flash Message */}
        {msg && (
          <div
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border -mx-3 md:-mx-6 ${
              msg.type === 'ok'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                : 'bg-red-50 text-red-700 border-red-300'
            }`}
          >
            {msg.text}
          </div>
        )}

        {/* Create Modal */}
        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white shadow-xl w-full max-w-md">
              <div className="bg-slate-800 text-white px-5 py-3 flex items-center justify-between">
                <h2 className="text-xs font-bold uppercase tracking-wide">New Stock Count</h2>
                <button onClick={() => setShowCreate(false)} className="p-1 text-white/70 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Warehouse *</label>
                  <select
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
                    value={createWarehouseId}
                    onChange={(e) => setCreateWarehouseId(e.target.value)}
                  >
                    <option value="">Select warehouse...</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.code} -- {w.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Count Type</label>
                  <select
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
                    value={createType}
                    onChange={(e) => setCreateType(e.target.value)}
                  >
                    <option value="FULL">Full Count</option>
                    <option value="CYCLE">Cycle Count</option>
                    <option value="SPOT">Spot Check</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Remarks</label>
                  <textarea
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
                    rows={2}
                    value={createRemarks}
                    onChange={(e) => setCreateRemarks(e.target.value)}
                    placeholder="Optional notes..."
                  />
                </div>
              </div>
              <div className="bg-slate-50 border-t border-slate-200 px-5 py-3 flex justify-end gap-2">
                <button
                  onClick={() => setShowCreate(false)}
                  className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={creating || !createWarehouseId}
                  className="flex items-center gap-1.5 px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {creating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Create Count
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Counts List */}
        {loading ? (
          <div className="min-h-[200px] bg-white flex items-center justify-center border-x border-b border-slate-300 -mx-3 md:-mx-6">
            <div className="text-sm text-slate-400">Loading...</div>
          </div>
        ) : counts.length === 0 ? (
          <div className="text-center py-16 bg-white border-x border-b border-slate-300 -mx-3 md:-mx-6">
            <div className="text-slate-300 text-sm">No stock counts yet</div>
            <div className="text-slate-300 text-xs mt-1">Create a new count to start physical inventory verification</div>
          </div>
        ) : (
          <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Count #</th>
                  <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Date</th>
                  <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Warehouse</th>
                  <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Type</th>
                  <th className="text-center px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Lines</th>
                  <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody>
                {counts.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-slate-100 hover:bg-blue-50/40 even:bg-slate-50/50 cursor-pointer"
                    onClick={() => openDetail(c.id)}
                  >
                    <td className="px-3 py-1.5 font-medium text-slate-700 font-mono border-r border-slate-100">#{c.countNo}</td>
                    <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{formatDate(c.countDate)}</td>
                    <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{c.warehouse?.name || c.warehouseId}</td>
                    <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{COUNT_TYPE_LABELS[c.countType] || c.countType}</td>
                    <td className="px-3 py-1.5 text-center text-slate-600 font-mono tabular-nums border-r border-slate-100">{c._count?.lines ?? '--'}</td>
                    <td className="px-3 py-1.5">
                      <span
                        className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${STATUS_STYLES[c.status]}`}
                      >
                        {c.status.replace('_', ' ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
