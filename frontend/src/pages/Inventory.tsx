import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { Plus, AlertTriangle, Search, X } from 'lucide-react';

const CATEGORIES = ['RAW_MATERIAL', 'SPARE_PART', 'CONSUMABLE', 'CHEMICAL', 'FINISHED_GOOD', 'OTHER'];
const UNITS = ['kg', 'ltr', 'nos', 'mtr', 'set', 'gm', 'pair', 'roll'];
const CAT_LABELS: Record<string, string> = {
  RAW_MATERIAL: 'Raw Material', SPARE_PART: 'Spare Part', CONSUMABLE: 'Consumable',
  CHEMICAL: 'Chemical', FINISHED_GOOD: 'Finished Good', OTHER: 'Other',
};

const CAT_COLORS: Record<string, string> = {
  RAW_MATERIAL: 'border-l-blue-500',
  SPARE_PART: 'border-l-amber-500',
  CONSUMABLE: 'border-l-emerald-500',
  CHEMICAL: 'border-l-purple-500',
  FINISHED_GOOD: 'border-l-cyan-500',
  OTHER: 'border-l-slate-400',
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
  const [txnForm, setTxnForm] = useState({ type: 'IN', quantity: '', reference: '', remarks: '', department: '' });
  const DEPARTMENTS = ['Production', 'Maintenance', 'Lab', 'Boiler', 'ETP', 'Admin', 'Civil', 'Electrical', 'Other'];
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [editForm, setEditForm] = useState({ name: '', category: '', unit: '', costPerUnit: '', minStock: '', maxStock: '', location: '', supplier: '', remarks: '' });
  const [form, setForm] = useState({
    name: '', category: 'RAW_MATERIAL', unit: 'kg',
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
      setForm({ name: '', category: 'RAW_MATERIAL', unit: 'kg', currentStock: '', minStock: '', maxStock: '', costPerUnit: '', location: '', supplier: '', leadTimeDays: '', remarks: '' });
      setTab('items');
      load();
    } catch (e: any) { alert(e.response?.data?.error || 'Error'); }
    setSaving(false);
  };

  const handleTxn = async (itemId: string) => {
    try {
      await api.post('/inventory/transaction', { itemId, ...txnForm });
      setShowTxn(null);
      setTxnForm({ type: 'IN', quantity: '', reference: '', remarks: '', department: '' });
      load();
    } catch (e: any) { alert(e.response?.data?.error || 'Error'); }
  };

  const openEdit = (item: Item) => {
    setEditItem(item);
    setEditForm({
      name: item.name, category: item.category, unit: item.unit,
      costPerUnit: String(item.costPerUnit || ''), minStock: String(item.minStock || ''),
      maxStock: String(item.maxStock || ''), location: item.location || '',
      supplier: item.supplier || '', remarks: item.remarks || '',
    });
  };

  const handleEdit = async () => {
    if (!editItem) return;
    try {
      setSaving(true);
      await api.put(`/inventory/items/${editItem.id}`, {
        name: editForm.name,
        category: editForm.category,
        unit: editForm.unit,
        costPerUnit: parseFloat(editForm.costPerUnit) || 0,
        minStock: parseFloat(editForm.minStock) || 0,
        maxStock: editForm.maxStock ? parseFloat(editForm.maxStock) : null,
        location: editForm.location || null,
        supplier: editForm.supplier || null,
        remarks: editForm.remarks || null,
      });
      setEditItem(null);
      load();
    } catch (e: any) { alert(e.response?.data?.error || 'Error saving'); }
    setSaving(false);
  };

  const filtered = items.filter(i =>
    (!search || i.name.toLowerCase().includes(search.toLowerCase()) || i.code.toLowerCase().includes(search.toLowerCase()))
  );

  if (loading) return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><div className="text-sm text-slate-400">Loading...</div></div>;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <h1 className="text-sm font-bold tracking-wide uppercase">INVENTORY & STORE</h1>
          <div className="flex items-center gap-2">
            <button onClick={() => setTab('add')} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center gap-1">
              <Plus size={14} /> Add Item
            </button>
          </div>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-7 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          {Object.entries(summary.summary || {}).map(([cat, data]: any) => (
            <div key={cat} className={`bg-white border-b border-r border-slate-200 px-4 py-3 border-l-4 ${CAT_COLORS[cat] || 'border-l-slate-400'}`}>
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">{CAT_LABELS[cat] || cat}</div>
              <div className="text-xl font-bold text-slate-800 font-mono tabular-nums">{data.count}</div>
              <div className="text-[11px] text-slate-400 font-mono tabular-nums">{'\u20B9'}{(data.totalValue / 1000).toFixed(1)}K value</div>
              {data.lowStock > 0 && (
                <div className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-red-300 bg-red-50 text-red-700 mt-1.5 inline-flex items-center gap-1">
                  <AlertTriangle size={10} /> {data.lowStock} low
                </div>
              )}
            </div>
          ))}
          <div className="bg-white border-b border-r border-slate-200 px-4 py-3 border-l-4 border-l-slate-500">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Total Items</div>
            <div className="text-xl font-bold text-slate-800 font-mono tabular-nums">{summary.totalItems || 0}</div>
            <div className="text-[11px] text-slate-400">{alerts.length} alerts</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-slate-100 border-x border-b border-slate-300 -mx-3 md:-mx-6 flex">
          {(['items', 'alerts', 'add'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-2 text-[11px] font-bold uppercase tracking-widest border-b-2 transition-colors ${
                tab === t ? 'border-blue-600 text-slate-800 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}>
              {t === 'items' ? `All Items (${items.length})` : t === 'alerts' ? `Low Stock (${alerts.length})` : 'New Item'}
            </button>
          ))}
        </div>

        {/* Add Item Form */}
        {tab === 'add' && (
          <form onSubmit={handleAddItem}>
            <div className="bg-white border-x border-b border-slate-300 -mx-3 md:-mx-6 overflow-hidden">
              <div className="bg-slate-800 text-white px-4 py-2">
                <h2 className="text-xs font-bold uppercase tracking-wide">Add New Item</h2>
              </div>
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Item Name *</label>
                    <input className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Item Code</label>
                    <div className="w-full border border-slate-200 px-2.5 py-1.5 text-xs text-slate-400 bg-slate-50">Auto-generated (ITM-00001, ITM-00002, ...)</div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Category</label>
                    <select className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                      {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Unit</label>
                    <select className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}>
                      {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Opening Stock</label>
                    <input className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400" type="number" step="any" value={form.currentStock} onChange={e => setForm({ ...form, currentStock: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Min Stock (Reorder Point)</label>
                    <input className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400" type="number" step="any" value={form.minStock} onChange={e => setForm({ ...form, minStock: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Cost per Unit (INR)</label>
                    <input className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400" type="number" step="any" value={form.costPerUnit} onChange={e => setForm({ ...form, costPerUnit: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Location / Bin</label>
                    <input className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Supplier</label>
                    <input className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400" value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Lead Time (Days)</label>
                    <input className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400" type="number" value={form.leadTimeDays} onChange={e => setForm({ ...form, leadTimeDays: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Remarks</label>
                  <textarea className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400" rows={2} value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} />
                </div>
              </div>
              <div className="bg-slate-50 border-t border-slate-200 px-5 py-3 flex justify-end">
                <button type="submit" disabled={saving} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">{saving ? 'Saving...' : 'Save Item'}</button>
              </div>
            </div>
          </form>
        )}

        {/* Items List */}
        {tab === 'items' && (
          <div className="space-y-0">
            {/* Filter Toolbar */}
            <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-4 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400 pl-9" placeholder="Search items..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <select className="border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400" value={filterCat} onChange={e => setFilterCat(e.target.value)}>
                <option value="">All Categories</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
              </select>
            </div>

            {/* Table */}
            <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-800 text-white">
                      <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Code</th>
                      <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Name</th>
                      <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Category</th>
                      <th className="text-right px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Stock</th>
                      <th className="text-right px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Min</th>
                      <th className="text-right px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">INR/Unit</th>
                      <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Location</th>
                      <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(item => (
                      <React.Fragment key={item.id}>
                        <tr className={`border-b border-slate-100 hover:bg-blue-50/40 ${item.currentStock <= item.minStock && item.minStock > 0 ? 'bg-red-50/50' : 'even:bg-slate-50/50'}`}>
                          <td className="px-3 py-1.5 font-mono text-xs text-slate-600 border-r border-slate-100">{item.code}</td>
                          <td className="px-3 py-1.5 font-medium text-slate-800 border-r border-slate-100">{item.name}</td>
                          <td className="px-3 py-1.5 border-r border-slate-100">
                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-blue-200 bg-blue-50 text-blue-700">{CAT_LABELS[item.category]}</span>
                          </td>
                          <td className="px-3 py-1.5 text-right font-bold text-slate-800 font-mono tabular-nums border-r border-slate-100">{item.currentStock} <span className="text-slate-400 font-normal text-xs">{item.unit}</span></td>
                          <td className="px-3 py-1.5 text-right text-slate-500 font-mono tabular-nums border-r border-slate-100">{item.minStock}</td>
                          <td className="px-3 py-1.5 text-right text-slate-700 font-mono tabular-nums border-r border-slate-100">{'\u20B9'}{item.costPerUnit}</td>
                          <td className="px-3 py-1.5 text-slate-500 border-r border-slate-100">{item.location || '\u2014'}</td>
                          <td className="px-3 py-1.5">
                            <div className="flex gap-1">
                              <button onClick={() => setShowTxn(showTxn === item.id ? null : item.id)}
                                className="px-2 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">
                                {showTxn === item.id ? 'Close' : 'Stock In/Out'}
                              </button>
                              <button onClick={() => openEdit(item)}
                                className="px-2 py-1 bg-white border border-blue-300 text-blue-600 text-[11px] font-medium hover:bg-blue-50">
                                Edit
                              </button>
                            </div>
                          </td>
                        </tr>
                        {showTxn === item.id && (
                          <tr>
                            <td colSpan={8} className="bg-slate-50 border-b border-slate-200 px-4 py-3">
                              <div className="flex flex-wrap gap-3 items-end">
                                <div>
                                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Type</label>
                                  <select className="border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400" value={txnForm.type} onChange={e => setTxnForm({ ...txnForm, type: e.target.value })}>
                                    <option value="IN">Stock IN</option>
                                    <option value="OUT">Stock OUT</option>
                                    <option value="ADJUST">Adjust (Set)</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Quantity</label>
                                  <input className="border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400 w-24" type="number" step="any" placeholder="Qty" value={txnForm.quantity}
                                    onChange={e => setTxnForm({ ...txnForm, quantity: e.target.value })} />
                                </div>
                                <div>
                                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Reference</label>
                                  <input className="border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400 w-40" placeholder="PO, Issue#" value={txnForm.reference}
                                    onChange={e => setTxnForm({ ...txnForm, reference: e.target.value })} />
                                </div>
                                {txnForm.type === 'OUT' && (
                                  <div>
                                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Department</label>
                                    <select className="border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400" value={txnForm.department} onChange={e => setTxnForm({ ...txnForm, department: e.target.value })}>
                                      <option value="">Select</option>
                                      {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                                    </select>
                                  </div>
                                )}
                                <div>
                                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Remarks</label>
                                  <input className="border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400 w-40" placeholder="Remarks" value={txnForm.remarks}
                                    onChange={e => setTxnForm({ ...txnForm, remarks: e.target.value })} />
                                </div>
                                <button onClick={() => handleTxn(item.id)} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">Save</button>
                              </div>
                              {item.transactions && item.transactions.length > 0 && (
                                <div className="mt-3 text-xs text-slate-500">
                                  <span className="font-semibold text-slate-600">Recent:</span>
                                  {item.transactions.slice(0, 5).map((t: any) => (
                                    <span key={t.id} className="ml-2">
                                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                                        t.type === 'IN' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : t.type === 'OUT' ? 'border-red-300 bg-red-50 text-red-700' : 'border-amber-300 bg-amber-50 text-amber-700'
                                      }`}>{t.type === 'IN' ? 'IN' : t.type === 'OUT' ? 'OUT' : 'ADJ'}</span>
                                      {' '}{t.quantity} {item.unit} {t.reference ? `\u2014 ${t.reference}` : ''} ({new Date(t.createdAt).toLocaleDateString('en-IN')})
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                    {filtered.length === 0 && (
                      <tr><td colSpan={8} className="text-center py-16"><div className="text-slate-300 text-sm">No items found</div></td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Alerts */}
        {tab === 'alerts' && (
          <div className="space-y-0 -mx-3 md:-mx-6 border-x border-slate-300">
            {alerts.length === 0 && (
              <div className="bg-white border-b border-slate-200 px-4 py-3 border-l-4 border-l-emerald-500">
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-700">All stock levels OK</div>
              </div>
            )}
            {alerts.map(item => (
              <div key={item.id} className="bg-white border-b border-slate-200 px-4 py-3 border-l-4 border-l-red-500 flex items-center justify-between">
                <div>
                  <div className="font-medium text-slate-800 text-sm">{item.name} <span className="text-xs text-slate-400 font-mono">({item.code})</span></div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{CAT_LABELS[item.category]} {item.supplier ? `\u00B7 ${item.supplier}` : ''}</div>
                </div>
                <div className="text-right">
                  <div className="text-red-700 font-bold font-mono tabular-nums text-sm">{item.currentStock} {item.unit}</div>
                  <div className="text-[11px] text-slate-400">Min: {item.minStock}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit Item Modal */}
      {editItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white shadow-2xl w-full max-w-lg mx-4">
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-widest">Edit Item — {editItem.code}</span>
              <button onClick={() => setEditItem(null)} className="text-slate-400 hover:text-white"><X size={16} /></button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Name</label>
                  <input className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Category</label>
                  <select className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" value={editForm.category} onChange={e => setEditForm({ ...editForm, category: e.target.value })}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c] || c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Unit</label>
                  <select className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" value={editForm.unit} onChange={e => setEditForm({ ...editForm, unit: e.target.value })}>
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Cost/Unit (INR)</label>
                  <input type="number" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" value={editForm.costPerUnit} onChange={e => setEditForm({ ...editForm, costPerUnit: e.target.value })} />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Min Stock</label>
                  <input type="number" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" value={editForm.minStock} onChange={e => setEditForm({ ...editForm, minStock: e.target.value })} />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Max Stock</label>
                  <input type="number" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" value={editForm.maxStock} onChange={e => setEditForm({ ...editForm, maxStock: e.target.value })} />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Location</label>
                  <input className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" value={editForm.location} onChange={e => setEditForm({ ...editForm, location: e.target.value })} />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Supplier</label>
                  <input className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" value={editForm.supplier} onChange={e => setEditForm({ ...editForm, supplier: e.target.value })} />
                </div>
                <div className="col-span-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Remarks</label>
                  <input className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" value={editForm.remarks} onChange={e => setEditForm({ ...editForm, remarks: e.target.value })} />
                </div>
              </div>
            </div>
            <div className="border-t border-slate-200 px-4 py-3 flex items-center justify-between">
              <span className="text-[10px] text-slate-400">Current Stock: {editItem.currentStock} {editItem.unit}</span>
              <div className="flex gap-2">
                <button onClick={() => setEditItem(null)} className="px-3 py-1 bg-slate-200 text-slate-700 text-[11px] font-medium hover:bg-slate-300">Cancel</button>
                <button onClick={handleEdit} disabled={saving} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
