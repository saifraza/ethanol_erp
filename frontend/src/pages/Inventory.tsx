import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { Package, Plus, ArrowDownCircle, ArrowUpCircle, AlertTriangle, Search, X } from 'lucide-react';

const CATEGORIES = ['RAW_MATERIAL', 'SPARE_PART', 'CONSUMABLE', 'CHEMICAL', 'FINISHED_GOOD', 'OTHER'];
const UNITS = ['kg', 'ltr', 'nos', 'mtr', 'set', 'gm', 'pair', 'roll'];
const CAT_LABELS: Record<string, string> = {
  RAW_MATERIAL: 'Raw Material', SPARE_PART: 'Spare Part', CONSUMABLE: 'Consumable',
  CHEMICAL: 'Chemical', FINISHED_GOOD: 'Finished Good', OTHER: 'Other',
};

interface Item {
  id: string; name: string; code: string; category: string; unit: string;
  currentStock: number; minStock: number; maxStock: number | null;
  costPerUnit: number; location: string | null; supplier: string | null;
  leadTimeDays: number | null; isActive: boolean; remarks: string | null;
  transactions?: any[];
}

export default function Inventory() {
  const [items, setItems] = useState<Item[]>([]);
  const [alerts, setAlerts] = useState<Item[]>([]);
  const [summary, setSummary] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'items' | 'alerts' | 'add'>('items');
  const [filterCat, setFilterCat] = useState('');
  const [search, setSearch] = useState('');
  const [showTxn, setShowTxn] = useState<string | null>(null);
  const [txnForm, setTxnForm] = useState({ type: 'IN', quantity: '', reference: '', remarks: '' });
  const [form, setForm] = useState({
    name: '', code: '', category: 'RAW_MATERIAL', unit: 'kg',
    currentStock: '', minStock: '', maxStock: '', costPerUnit: '',
    location: '', supplier: '', leadTimeDays: '', remarks: '',
  });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const [itemsRes, alertsRes, summaryRes] = await Promise.all([
        api.get('/inventory/items' + (filterCat ? `?category=${filterCat}` : '')),
        api.get('/inventory/alerts'),
        api.get('/inventory/summary'),
      ]);
      setItems(itemsRes.data.items);
      setAlerts(alertsRes.data.alerts);
      setSummary(summaryRes.data);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [filterCat]);

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/inventory/items', form);
      setForm({ name: '', code: '', category: 'RAW_MATERIAL', unit: 'kg', currentStock: '', minStock: '', maxStock: '', costPerUnit: '', location: '', supplier: '', leadTimeDays: '', remarks: '' });
      setTab('items');
      load();
    } catch (e: any) { alert(e.response?.data?.error || 'Error'); }
    setSaving(false);
  };

  const handleTxn = async (itemId: string) => {
    try {
      await api.post('/inventory/transaction', { itemId, ...txnForm });
      setShowTxn(null);
      setTxnForm({ type: 'IN', quantity: '', reference: '', remarks: '' });
      load();
    } catch (e: any) { alert(e.response?.data?.error || 'Error'); }
  };

  const filtered = items.filter(i =>
    (!search || i.name.toLowerCase().includes(search.toLowerCase()) || i.code.toLowerCase().includes(search.toLowerCase()))
  );

  if (loading) return <div className="p-6 text-center text-gray-400">Loading inventory...</div>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold flex items-center gap-2"><Package size={22} /> Inventory & Store</h1>
        <button onClick={() => setTab('add')} className="btn-primary text-sm flex items-center gap-1">
          <Plus size={16} /> Add Item
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {Object.entries(summary.summary || {}).map(([cat, data]: any) => (
          <div key={cat} className="card p-3 text-center">
            <div className="text-xs text-gray-500">{CAT_LABELS[cat] || cat}</div>
            <div className="text-lg font-bold">{data.count}</div>
            <div className="text-xs text-gray-400">₹{(data.totalValue / 1000).toFixed(1)}K value</div>
            {data.lowStock > 0 && (
              <div className="text-xs text-red-500 flex items-center justify-center gap-1 mt-1">
                <AlertTriangle size={12} /> {data.lowStock} low
              </div>
            )}
          </div>
        ))}
        <div className="card p-3 text-center">
          <div className="text-xs text-gray-500">Total Items</div>
          <div className="text-lg font-bold">{summary.totalItems || 0}</div>
          <div className="text-xs text-gray-400">{alerts.length} alerts</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        {(['items', 'alerts', 'add'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 ${tab === t ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500'}`}>
            {t === 'items' ? `All Items (${items.length})` : t === 'alerts' ? `Low Stock (${alerts.length})` : '+ New Item'}
          </button>
        ))}
      </div>

      {/* Add Item Form */}
      {tab === 'add' && (
        <form onSubmit={handleAddItem} className="card p-4 space-y-3">
          <h3 className="font-semibold">Add New Item</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input className="input-field" placeholder="Item Name *" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <input className="input-field" placeholder="SKU / Code *" required value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} />
            <select className="input-field" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
            </select>
            <select className="input-field" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}>
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
            <input className="input-field" type="number" step="any" placeholder="Opening Stock" value={form.currentStock} onChange={e => setForm({ ...form, currentStock: e.target.value })} />
            <input className="input-field" type="number" step="any" placeholder="Min Stock (Reorder Point)" value={form.minStock} onChange={e => setForm({ ...form, minStock: e.target.value })} />
            <input className="input-field" type="number" step="any" placeholder="Cost per Unit (₹)" value={form.costPerUnit} onChange={e => setForm({ ...form, costPerUnit: e.target.value })} />
            <input className="input-field" placeholder="Location / Bin" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} />
            <input className="input-field" placeholder="Supplier" value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} />
            <input className="input-field" type="number" placeholder="Lead Time (days)" value={form.leadTimeDays} onChange={e => setForm({ ...form, leadTimeDays: e.target.value })} />
          </div>
          <textarea className="input-field w-full" rows={2} placeholder="Remarks" value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} />
          <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save Item'}</button>
        </form>
      )}

      {/* Items List */}
      {tab === 'items' && (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="input-field pl-9 w-full" placeholder="Search items..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className="input-field" value={filterCat} onChange={e => setFilterCat(e.target.value)}>
              <option value="">All Categories</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs md:text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="p-2">Code</th><th className="p-2">Name</th><th className="p-2">Category</th>
                  <th className="p-2 text-right">Stock</th><th className="p-2 text-right">Min</th>
                  <th className="p-2 text-right">₹/Unit</th><th className="p-2">Location</th><th className="p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => (
                  <React.Fragment key={item.id}>
                    <tr className={`border-b hover:bg-gray-50 ${item.currentStock <= item.minStock && item.minStock > 0 ? 'bg-red-50' : ''}`}>
                      <td className="p-2 font-mono text-xs">{item.code}</td>
                      <td className="p-2 font-medium">{item.name}</td>
                      <td className="p-2"><span className="px-2 py-0.5 rounded-full bg-gray-100 text-xs">{CAT_LABELS[item.category]}</span></td>
                      <td className="p-2 text-right font-bold">{item.currentStock} {item.unit}</td>
                      <td className="p-2 text-right text-gray-500">{item.minStock}</td>
                      <td className="p-2 text-right">₹{item.costPerUnit}</td>
                      <td className="p-2 text-gray-500">{item.location || '—'}</td>
                      <td className="p-2">
                        <button onClick={() => setShowTxn(showTxn === item.id ? null : item.id)}
                          className="text-blue-600 hover:underline text-xs">
                          {showTxn === item.id ? 'Close' : 'Stock In/Out'}
                        </button>
                      </td>
                    </tr>
                    {showTxn === item.id && (
                      <tr><td colSpan={8} className="p-3 bg-blue-50">
                        <div className="flex flex-wrap gap-2 items-end">
                          <select className="input-field text-sm" value={txnForm.type} onChange={e => setTxnForm({ ...txnForm, type: e.target.value })}>
                            <option value="IN">Stock IN</option>
                            <option value="OUT">Stock OUT</option>
                            <option value="ADJUST">Adjust (Set)</option>
                          </select>
                          <input className="input-field text-sm w-24" type="number" step="any" placeholder="Qty" value={txnForm.quantity}
                            onChange={e => setTxnForm({ ...txnForm, quantity: e.target.value })} />
                          <input className="input-field text-sm w-40" placeholder="Reference (PO, Issue#)" value={txnForm.reference}
                            onChange={e => setTxnForm({ ...txnForm, reference: e.target.value })} />
                          <input className="input-field text-sm w-40" placeholder="Remarks" value={txnForm.remarks}
                            onChange={e => setTxnForm({ ...txnForm, remarks: e.target.value })} />
                          <button onClick={() => handleTxn(item.id)} className="btn-primary text-sm">Save</button>
                        </div>
                        {item.transactions && item.transactions.length > 0 && (
                          <div className="mt-2 text-xs text-gray-600">
                            <strong>Recent:</strong>
                            {item.transactions.slice(0, 5).map((t: any) => (
                              <span key={t.id} className="ml-2">
                                {t.type === 'IN' ? '↑' : t.type === 'OUT' ? '↓' : '⟳'} {t.quantity} {item.unit} — {t.reference || ''} ({new Date(t.createdAt).toLocaleDateString()})
                              </span>
                            ))}
                          </div>
                        )}
                      </td></tr>
                    )}
                  </React.Fragment>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="p-6 text-center text-gray-400">No items found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Alerts */}
      {tab === 'alerts' && (
        <div className="space-y-2">
          {alerts.length === 0 && <div className="card p-6 text-center text-green-600">All stock levels OK!</div>}
          {alerts.map(item => (
            <div key={item.id} className="card p-3 flex items-center justify-between border-l-4 border-red-500">
              <div>
                <div className="font-medium">{item.name} <span className="text-xs text-gray-400">({item.code})</span></div>
                <div className="text-xs text-gray-500">{CAT_LABELS[item.category]} · {item.supplier || 'No supplier'}</div>
              </div>
              <div className="text-right">
                <div className="text-red-600 font-bold">{item.currentStock} {item.unit}</div>
                <div className="text-xs text-gray-500">Min: {item.minStock}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
