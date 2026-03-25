import { useState, useEffect, useCallback } from 'react';
import {
  Warehouse, Plus, X, Save, Loader2, ChevronDown, ChevronRight,
  Edit2, MapPin,
} from 'lucide-react';
import api from '../../services/api';

interface Bin {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

interface WarehouseItem {
  id: string;
  code: string;
  name: string;
  address?: string;
  active: boolean;
  bins: Bin[];
  _count?: { bins: number };
  stockSummary?: { totalItems: number; totalValue: number };
}

interface StockSummary {
  totalItems: number;
  totalValue: number;
}

export default function Warehouses() {
  const [warehouses, setWarehouses] = useState<WarehouseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', address: '', code: '' });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandLoading, setExpandLoading] = useState(false);
  const [warehouseBins, setWarehouseBins] = useState<Bin[]>([]);
  const [warehouseStock, setWarehouseStock] = useState<StockSummary | null>(null);
  const [newBin, setNewBin] = useState({ code: '', name: '' });
  const [addingBin, setAddingBin] = useState(false);

  const fetchWarehouses = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/inventory/warehouses');
      setWarehouses(Array.isArray(res.data) ? res.data : res.data.warehouses ?? []);
    } catch {
      setMsg({ type: 'err', text: 'Failed to load warehouses' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchWarehouses(); }, [fetchWarehouses]);

  useEffect(() => {
    if (msg) {
      const t = setTimeout(() => setMsg(null), 4000);
      return () => clearTimeout(t);
    }
  }, [msg]);

  const openCreate = () => {
    setEditId(null);
    setForm({ name: '', address: '', code: '' });
    setShowForm(true);
  };

  const openEdit = (wh: WarehouseItem) => {
    setEditId(wh.id);
    setForm({ name: wh.name, address: wh.address ?? '', code: wh.code });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setMsg({ type: 'err', text: 'Name is required' });
      return;
    }
    setSaving(true);
    try {
      if (editId) {
        await api.put(`/inventory/warehouses/${editId}`, { name: form.name, address: form.address });
        setMsg({ type: 'ok', text: 'Warehouse updated' });
      } else {
        await api.post('/inventory/warehouses', { name: form.name, address: form.address });
        setMsg({ type: 'ok', text: 'Warehouse created' });
      }
      setShowForm(false);
      fetchWarehouses();
    } catch {
      setMsg({ type: 'err', text: 'Failed to save warehouse' });
    } finally {
      setSaving(false);
    }
  };

  const toggleExpand = async (wh: WarehouseItem) => {
    if (expandedId === wh.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(wh.id);
    setExpandLoading(true);
    setNewBin({ code: '', name: '' });
    try {
      const [detailRes, stockRes] = await Promise.all([
        api.get(`/inventory/warehouses/${wh.id}`),
        api.get('/inventory/stock/valuation', { params: { warehouseId: wh.id } }).catch(() => ({ data: { totalItems: 0, totalValue: 0 } })),
      ]);
      const detail = detailRes.data;
      setWarehouseBins(detail.bins ?? []);
      setWarehouseStock(stockRes.data);
    } catch {
      setWarehouseBins(wh.bins ?? []);
      setWarehouseStock(null);
    } finally {
      setExpandLoading(false);
    }
  };

  const handleAddBin = async () => {
    if (!expandedId || !newBin.code.trim() || !newBin.name.trim()) {
      setMsg({ type: 'err', text: 'Bin code and name are required' });
      return;
    }
    setAddingBin(true);
    try {
      await api.post(`/inventory/warehouses/${expandedId}/bins`, newBin);
      setMsg({ type: 'ok', text: 'Bin added' });
      setNewBin({ code: '', name: '' });
      // Refresh bins
      const res = await api.get(`/inventory/warehouses/${expandedId}`);
      setWarehouseBins(res.data.bins ?? []);
      fetchWarehouses();
    } catch {
      setMsg({ type: 'err', text: 'Failed to add bin' });
    } finally {
      setAddingBin(false);
    }
  };

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Warehouses & Bins</h1>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
          <Plus className="w-4 h-4" /> Add Warehouse
        </button>
      </div>

      {msg && (
        <div className={`p-3 rounded-lg text-sm ${msg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {msg.text}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>
      ) : warehouses.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Warehouse className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No warehouses configured</p>
          <button onClick={openCreate} className="mt-3 text-blue-600 text-sm hover:underline">Add your first warehouse</button>
        </div>
      ) : (
        <div className="space-y-3">
          {warehouses.map((wh) => (
            <div key={wh.id} className="bg-white rounded-xl shadow-sm border overflow-hidden">
              {/* Warehouse Header */}
              <div
                className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-gray-50"
                onClick={() => toggleExpand(wh)}
              >
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-blue-50 rounded-lg">
                    {expandedId === wh.id ? <ChevronDown className="w-5 h-5 text-blue-600" /> : <ChevronRight className="w-5 h-5 text-blue-600" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-800">{wh.name}</span>
                      <span className="text-xs font-mono text-gray-400">{wh.code}</span>
                    </div>
                    {wh.address && (
                      <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
                        <MapPin className="w-3 h-3" /> {wh.address}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right text-sm">
                    <span className="text-gray-500">{wh._count?.bins ?? wh.bins?.length ?? 0} bins</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${wh.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {wh.active ? 'Active' : 'Inactive'}
                  </span>
                  <button onClick={(e) => { e.stopPropagation(); openEdit(wh); }} className="p-1 hover:bg-blue-50 rounded" title="Edit">
                    <Edit2 className="w-4 h-4 text-blue-600" />
                  </button>
                </div>
              </div>

              {/* Expanded Content */}
              {expandedId === wh.id && (
                <div className="border-t px-5 py-4 bg-gray-50">
                  {expandLoading ? (
                    <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-blue-600" /></div>
                  ) : (
                    <div className="space-y-4">
                      {/* Stock Summary */}
                      {warehouseStock && (
                        <div className="flex gap-6 text-sm">
                          <div>
                            <span className="text-gray-500">Items in stock:</span>{' '}
                            <span className="font-semibold">{warehouseStock.totalItems}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Total value:</span>{' '}
                            <span className="font-semibold">{formatCurrency(warehouseStock.totalValue)}</span>
                          </div>
                        </div>
                      )}

                      {/* Bins List */}
                      <div>
                        <h4 className="text-sm font-semibold text-gray-700 mb-2">Bins</h4>
                        {warehouseBins.length === 0 ? (
                          <p className="text-gray-400 text-xs">No bins defined</p>
                        ) : (
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                            {warehouseBins.map((bin) => (
                              <div key={bin.id} className="bg-white rounded-lg border px-3 py-2 text-sm">
                                <span className="font-mono text-xs text-gray-400">{bin.code}</span>
                                <p className="font-medium">{bin.name}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Add Bin Form */}
                      <div className="flex items-end gap-3 pt-2 border-t">
                        <div>
                          <label className="text-xs text-gray-500">Bin Code</label>
                          <input type="text" value={newBin.code} onChange={(e) => setNewBin({ ...newBin, code: e.target.value })}
                            placeholder="e.g. A-01" className="block w-32 px-2 py-1.5 border rounded text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500">Bin Name</label>
                          <input type="text" value={newBin.name} onChange={(e) => setNewBin({ ...newBin, name: e.target.value })}
                            placeholder="e.g. Rack A Row 1" className="block w-48 px-2 py-1.5 border rounded text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                        </div>
                        <button onClick={handleAddBin} disabled={addingBin}
                          className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50">
                          {addingBin ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                          Add Bin
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowForm(false)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{editId ? 'Edit Warehouse' : 'New Warehouse'}</h2>
              <button onClick={() => setShowForm(false)}><X className="w-5 h-5 text-gray-400 hover:text-gray-600" /></button>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Code</label>
              {editId ? (
                <div className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-500 font-mono">{form.code}</div>
              ) : (
                <div className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-400">Auto-generated (WH-001, WH-002, ...)</div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Main Warehouse" className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
              <input type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Optional address" className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {editId ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
