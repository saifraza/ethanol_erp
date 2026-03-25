import React, { useState, useEffect, useCallback } from 'react';
import { ClipboardCheck, Plus, X, Save, Loader2, CheckCircle, ArrowLeft } from 'lucide-react';
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
  DRAFT: 'bg-gray-100 text-gray-700',
  IN_PROGRESS: 'bg-yellow-100 text-yellow-700',
  COMPLETED: 'bg-blue-100 text-blue-700',
  APPROVED: 'bg-green-100 text-green-700',
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
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => setDetail(null)}
            className="p-2 rounded-lg hover:bg-gray-100"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-800">
              Stock Count #{detail.countNo}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {detail.warehouse?.name || 'Warehouse'} | {COUNT_TYPE_LABELS[detail.countType]} |{' '}
              {formatDate(detail.countDate)}
            </p>
          </div>
          <span
            className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_STYLES[detail.status]}`}
          >
            {detail.status.replace('_', ' ')}
          </span>
        </div>

        {msg && (
          <div
            className={`px-4 py-3 rounded-lg text-sm ${
              msg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}
          >
            {msg.text}
          </div>
        )}

        {/* Lines Table */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-600 text-left">
                  <th className="px-4 py-3 font-medium">#</th>
                  <th className="px-4 py-3 font-medium">Item</th>
                  <th className="px-4 py-3 font-medium">Bin</th>
                  <th className="px-4 py-3 font-medium text-right">System Qty</th>
                  <th className="px-4 py-3 font-medium text-right">Physical Qty</th>
                  <th className="px-4 py-3 font-medium text-right">Variance</th>
                  <th className="px-4 py-3 font-medium text-right">Variance %</th>
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
                      className={`border-t ${isHighVariance ? 'bg-red-50' : 'hover:bg-gray-50'}`}
                    >
                      <td className="px-4 py-2.5 text-gray-400">{idx + 1}</td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium">
                          {line.item?.code && (
                            <span className="text-gray-500 mr-1">{line.item.code}</span>
                          )}
                          {line.item?.name || line.itemId}
                        </div>
                        {line.batch && (
                          <div className="text-xs text-gray-400">Batch: {line.batch.batchNo}</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">{line.bin?.code || '—'}</td>
                      <td className="px-4 py-2.5 text-right font-medium">
                        {line.systemQty.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {isEditable ? (
                          <input
                            type="number"
                            step="0.01"
                            className={`w-28 text-right py-1 px-2 border rounded text-sm focus:ring-2 focus:ring-blue-500 ${
                              isHighVariance ? 'border-red-300 bg-red-50' : ''
                            }`}
                            value={lineEdits[line.id] ?? ''}
                            onChange={(e) =>
                              setLineEdits((prev) => ({ ...prev, [line.id]: e.target.value }))
                            }
                            placeholder="—"
                          />
                        ) : (
                          <span className="font-medium">
                            {line.physicalQty !== null
                              ? line.physicalQty.toLocaleString('en-IN', { maximumFractionDigits: 2 })
                              : '—'}
                          </span>
                        )}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-medium ${
                          isHighVariance
                            ? 'text-red-600'
                            : variance !== null && variance !== 0
                            ? 'text-orange-600'
                            : 'text-gray-500'
                        }`}
                      >
                        {variance !== null
                          ? variance.toLocaleString('en-IN', { maximumFractionDigits: 2 })
                          : '—'}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-medium ${
                          isHighVariance ? 'text-red-600 font-bold' : 'text-gray-500'
                        }`}
                      >
                        {variancePct !== null ? `${variancePct.toFixed(1)}%` : '—'}
                      </td>
                    </tr>
                  );
                })}
                {(detail.lines || []).length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                      No count lines found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Action Buttons */}
          {(detail.status === 'DRAFT' || detail.status === 'IN_PROGRESS') && (
            <div className="px-6 py-4 bg-gray-50 border-t flex items-center justify-between">
              <p className="text-xs text-gray-500">
                {Object.values(lineEdits).filter((v) => v !== '').length} of{' '}
                {detail.lines.length} items counted
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleSaveLines}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save Counts
                </button>
              </div>
            </div>
          )}

          {detail.status === 'COMPLETED' && (
            <div className="px-6 py-4 bg-gray-50 border-t flex justify-end">
              <button
                onClick={handleApprove}
                disabled={approving}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm"
              >
                {approving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle className="w-4 h-4" />
                )}
                Approve & Post Adjustments
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // List View
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardCheck className="w-7 h-7 text-purple-600" />
          <h1 className="text-2xl font-bold text-gray-800">Stock Counts</h1>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm"
        >
          <Plus className="w-4 h-4" />
          New Count
        </button>
      </div>

      {msg && (
        <div
          className={`px-4 py-3 rounded-lg text-sm ${
            msg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">New Stock Count</h2>
              <button onClick={() => setShowCreate(false)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Warehouse *</label>
              <select
                className="w-full py-2 px-3 border rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                value={createWarehouseId}
                onChange={(e) => setCreateWarehouseId(e.target.value)}
              >
                <option value="">Select warehouse...</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Count Type</label>
              <select
                className="w-full py-2 px-3 border rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                value={createType}
                onChange={(e) => setCreateType(e.target.value)}
              >
                <option value="FULL">Full Count</option>
                <option value="CYCLE">Cycle Count</option>
                <option value="SPOT">Spot Check</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Remarks</label>
              <textarea
                className="w-full py-2 px-3 border rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                rows={2}
                value={createRemarks}
                onChange={(e) => setCreateRemarks(e.target.value)}
                placeholder="Optional notes..."
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !createWarehouseId}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 text-sm"
              >
                {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                Create Count
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Counts List */}
      {loading ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center text-gray-500">
          Loading...
        </div>
      ) : counts.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center text-gray-400">
          <ClipboardCheck className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-lg">No stock counts yet</p>
          <p className="text-sm mt-1">Create a new count to start physical inventory verification</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-600 text-left">
                <th className="px-4 py-3 font-medium">Count #</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Warehouse</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium text-center">Lines</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {counts.map((c) => (
                <tr
                  key={c.id}
                  className="border-t hover:bg-gray-50 cursor-pointer"
                  onClick={() => openDetail(c.id)}
                >
                  <td className="px-4 py-3 font-medium text-purple-600">#{c.countNo}</td>
                  <td className="px-4 py-3">{formatDate(c.countDate)}</td>
                  <td className="px-4 py-3">{c.warehouse?.name || c.warehouseId}</td>
                  <td className="px-4 py-3">{COUNT_TYPE_LABELS[c.countType] || c.countType}</td>
                  <td className="px-4 py-3 text-center">{c._count?.lines ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[c.status]}`}
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
  );
}
