import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import { Plus, AlertTriangle, Search, X, Star, UserPlus } from 'lucide-react';

const CATEGORIES = ['RAW_MATERIAL', 'SPARE_PART', 'CONSUMABLE', 'CHEMICAL', 'FINISHED_GOOD', 'FUEL', 'PACKING', 'ELECTRICAL', 'MECHANICAL', 'CIVIL', 'OTHER'];
const UNITS = ['kg', 'ltr', 'nos', 'mtr', 'set', 'gm', 'pair', 'roll', 'pcs', 'box'];
const CAT_LABELS: Record<string, string> = {
  RAW_MATERIAL: 'Raw Material', SPARE_PART: 'Spare Part', CONSUMABLE: 'Consumable',
  CHEMICAL: 'Chemical', FINISHED_GOOD: 'Finished Good', FUEL: 'Fuel',
  PACKING: 'Packing', ELECTRICAL: 'Electrical', MECHANICAL: 'Mechanical',
  CIVIL: 'Civil', OTHER: 'Other',
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

interface VendorOption { id: string; name: string; gstin?: string | null; }
interface LinkedVendor { id: string; rate: number; isPreferred: boolean; vendor: VendorOption; }

/** Searchable vendor dropdown with "Add New" option */
function VendorSelect({ value, onChange, vendors, onAddNew }: {
  value: string;
  onChange: (name: string, vendorId?: string) => void;
  vendors: VendorOption[];
  onAddNew: () => void;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = vendors.filter(v =>
    v.name.toLowerCase().includes(query.toLowerCase()) ||
    (v.gstin && v.gstin.includes(query))
  ).slice(0, 10);

  return (
    <div ref={ref} className="relative">
      <input
        className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
        value={query}
        onChange={e => { setQuery(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Type to search vendors..."
      />
      {open && query.length > 0 && (
        <div className="absolute z-50 w-full bg-white border border-slate-300 shadow-lg max-h-48 overflow-y-auto mt-0.5">
          {filtered.map(v => (
            <button key={v.id} type="button"
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 border-b border-slate-100 flex justify-between"
              onClick={() => { onChange(v.name, v.id); setQuery(v.name); setOpen(false); }}>
              <span className="font-medium text-slate-800">{v.name}</span>
              {v.gstin && <span className="text-[9px] text-slate-400 font-mono">{v.gstin}</span>}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-xs text-slate-400">No vendors match "{query}"</div>
          )}
          <button type="button" onClick={() => { setOpen(false); onAddNew(); }}
            className="w-full text-left px-3 py-1.5 text-xs text-blue-600 font-medium hover:bg-blue-50 flex items-center gap-1 border-t border-slate-200">
            <UserPlus size={12} /> Add New Vendor
          </button>
        </div>
      )}
    </div>
  );
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

  // Vendors
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [linkedVendors, setLinkedVendors] = useState<LinkedVendor[]>([]);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickVendor, setQuickVendor] = useState({ name: '', gstin: '' });

  const loadVendors = useCallback(async () => {
    try {
      const res = await api.get('/vendors');
      setVendors(res.data.map((v: any) => ({ id: v.id, name: v.name, gstin: v.gstin })));
    } catch { /* vendors not available */ }
  }, []);

  useEffect(() => { loadVendors(); }, [loadVendors]);

  const loadLinkedVendors = async (itemId: string) => {
    try {
      const res = await api.get(`/inventory/items/${itemId}/vendors`);
      setLinkedVendors(res.data);
    } catch { setLinkedVendors([]); }
  };

  const linkVendor = async (itemId: string, vendorId: string, isPreferred: boolean) => {
    try {
      await api.post(`/inventory/items/${itemId}/vendors`, { vendorId, rate: 0, isPreferred });
      loadLinkedVendors(itemId);
      load();
    } catch (e: any) { alert(e.response?.data?.error || 'Error linking vendor'); }
  };

  const unlinkVendor = async (itemId: string, vendorId: string) => {
    try {
      await api.delete(`/inventory/items/${itemId}/vendors/${vendorId}`);
      loadLinkedVendors(itemId);
    } catch { /* ignore */ }
  };

  const togglePreferred = async (itemId: string, vendorId: string) => {
    try {
      await api.post(`/inventory/items/${itemId}/vendors`, { vendorId, rate: 0, isPreferred: true });
      loadLinkedVendors(itemId);
      load();
    } catch { /* ignore */ }
  };

  const handleQuickAddVendor = async () => {
    if (!quickVendor.name.trim()) return;
    try {
      const res = await api.post('/inventory/vendors/quick', quickVendor);
      setVendors(prev => [...prev, { id: res.data.id, name: res.data.name, gstin: res.data.gstin }]);
      setShowQuickAdd(false);
      setQuickVendor({ name: '', gstin: '' });
    } catch (e: any) { alert(e.response?.data?.error || 'Error adding vendor'); }
  };

  // Detail panel
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'info' | 'po' | 'txn'>('info');
  const [detailData, setDetailData] = useState<{ item: Item; poHistory: any[]; transactions: any[]; rateHistory: any[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const openDetail = async (itemId: string) => {
    if (detailId === itemId) { setDetailId(null); return; }
    setDetailId(itemId);
    setDetailTab('info');
    setDetailLoading(true);
    try {
      const res = await api.get(`/inventory/items/${itemId}/details`);
      setDetailData(res.data);
    } catch { setDetailData(null); }
    setDetailLoading(false);
  };
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
    loadLinkedVendors(item.id);
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
                    <VendorSelect
                      value={form.supplier}
                      onChange={(name) => setForm({ ...form, supplier: name })}
                      vendors={vendors}
                      onAddNew={() => setShowQuickAdd(true)}
                    />
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
                          <td className="px-3 py-1.5 font-medium border-r border-slate-100">
                            <button onClick={() => openDetail(item.id)} className="text-left text-blue-700 hover:text-blue-900 hover:underline">{item.name}</button>
                          </td>
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
                        {/* Detail Panel */}
                        {detailId === item.id && (
                          <tr>
                            <td colSpan={8} className="bg-white border-b-2 border-blue-300 px-0 py-0">
                              {detailLoading ? (
                                <div className="p-6 text-center text-xs text-slate-400">Loading details...</div>
                              ) : detailData ? (
                                <div>
                                  {/* Tabs */}
                                  <div className="flex border-b border-slate-200 bg-slate-50">
                                    {(['info', 'po', 'txn'] as const).map(t => (
                                      <button key={t} onClick={() => setDetailTab(t)}
                                        className={`px-4 py-2 text-[11px] font-bold uppercase tracking-widest border-b-2 ${detailTab === t ? 'border-blue-600 text-blue-700 bg-white' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
                                        {t === 'info' ? 'Item Info' : t === 'po' ? `PO History (${detailData.poHistory.length})` : `Transactions (${detailData.transactions.length})`}
                                      </button>
                                    ))}
                                    <div className="flex-1" />
                                    <button onClick={() => setDetailId(null)} className="px-3 text-slate-400 hover:text-slate-600"><X size={14} /></button>
                                  </div>

                                  {/* Info Tab */}
                                  {detailTab === 'info' && (
                                    <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                                      {[
                                        { label: 'Code', value: detailData.item.code },
                                        { label: 'Category', value: CAT_LABELS[detailData.item.category] || detailData.item.category },
                                        { label: 'Unit', value: detailData.item.unit },
                                        { label: 'Current Stock', value: `${detailData.item.currentStock} ${detailData.item.unit}` },
                                        { label: 'Min Stock', value: String(detailData.item.minStock) },
                                        { label: 'Max Stock', value: String(detailData.item.maxStock || '--') },
                                        { label: 'Cost/Unit', value: `\u20B9${detailData.item.costPerUnit}` },
                                        { label: 'Location', value: detailData.item.location || '--' },
                                        { label: 'Supplier', value: detailData.item.supplier || '--' },
                                        { label: 'Remarks', value: detailData.item.remarks || '--' },
                                      ].map(f => (
                                        <div key={f.label}>
                                          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{f.label}</div>
                                          <div className="text-xs text-slate-800 font-medium mt-0.5">{f.value}</div>
                                        </div>
                                      ))}
                                      {/* Rate History */}
                                      {detailData.rateHistory.length > 0 && (
                                        <div className="col-span-2 md:col-span-4 mt-2 border-t border-slate-100 pt-2">
                                          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Rate History (from POs)</div>
                                          <div className="flex gap-2 flex-wrap">
                                            {detailData.rateHistory.map((r: any, i: number) => (
                                              <span key={i} className="text-[10px] bg-slate-50 border border-slate-200 px-2 py-1 font-mono">
                                                {'\u20B9'}{r.rate} <span className="text-slate-400">({r.vendor}, PO-{r.poNo}, {new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })})</span>
                                              </span>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {/* PO History Tab */}
                                  {detailTab === 'po' && (
                                    <div className="overflow-x-auto">
                                      {detailData.poHistory.length === 0 ? (
                                        <div className="p-6 text-center text-xs text-slate-400">No purchase orders for this item</div>
                                      ) : (
                                        <table className="w-full text-xs">
                                          <thead>
                                            <tr className="bg-slate-100 border-b border-slate-200">
                                              <th className="text-left px-3 py-1.5 text-[9px] font-bold text-slate-500 uppercase tracking-widest">PO#</th>
                                              <th className="text-left px-3 py-1.5 text-[9px] font-bold text-slate-500 uppercase tracking-widest">Date</th>
                                              <th className="text-left px-3 py-1.5 text-[9px] font-bold text-slate-500 uppercase tracking-widest">Vendor</th>
                                              <th className="text-right px-3 py-1.5 text-[9px] font-bold text-slate-500 uppercase tracking-widest">Qty</th>
                                              <th className="text-right px-3 py-1.5 text-[9px] font-bold text-slate-500 uppercase tracking-widest">Rate</th>
                                              <th className="text-right px-3 py-1.5 text-[9px] font-bold text-slate-500 uppercase tracking-widest">Received</th>
                                              <th className="text-left px-3 py-1.5 text-[9px] font-bold text-slate-500 uppercase tracking-widest">Status</th>
                                              <th className="text-left px-3 py-1.5 text-[9px] font-bold text-slate-500 uppercase tracking-widest">PDF</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {detailData.poHistory.map((p: any) => (
                                              <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                                                <td className="px-3 py-1.5 font-mono text-blue-700">PO-{p.po.poNo}</td>
                                                <td className="px-3 py-1.5 text-slate-600">{new Date(p.po.poDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                                                <td className="px-3 py-1.5 text-slate-800 font-medium">{p.po.vendor.name}</td>
                                                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{p.quantity} {p.unit}</td>
                                                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{'\u20B9'}{p.rate}</td>
                                                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{p.receivedQty || 0}</td>
                                                <td className="px-3 py-1.5">
                                                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                                                    p.po.status === 'RECEIVED' || p.po.status === 'CLOSED' ? 'border-green-300 bg-green-50 text-green-700' :
                                                    p.po.status === 'APPROVED' || p.po.status === 'SENT' ? 'border-blue-300 bg-blue-50 text-blue-700' :
                                                    'border-slate-300 bg-slate-50 text-slate-600'
                                                  }`}>{p.po.status}</span>
                                                </td>
                                                <td className="px-3 py-1.5">
                                                  <a href={`/api/purchase-orders/${p.po.id}/pdf?token=${localStorage.getItem('token')}`} target="_blank" rel="noreferrer"
                                                    className="text-[10px] text-blue-600 hover:underline">View</a>
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      )}
                                    </div>
                                  )}

                                  {/* Transactions Tab */}
                                  {detailTab === 'txn' && (
                                    <div className="overflow-x-auto">
                                      {detailData.transactions.length === 0 ? (
                                        <div className="p-6 text-center text-xs text-slate-400">No transactions</div>
                                      ) : (
                                        <table className="w-full text-xs">
                                          <thead>
                                            <tr className="bg-slate-100 border-b border-slate-200">
                                              <th className="text-left px-3 py-1.5 text-[9px] font-bold text-slate-500 uppercase tracking-widest">Date</th>
                                              <th className="text-left px-3 py-1.5 text-[9px] font-bold text-slate-500 uppercase tracking-widest">Type</th>
                                              <th className="text-right px-3 py-1.5 text-[9px] font-bold text-slate-500 uppercase tracking-widest">Qty</th>
                                              <th className="text-left px-3 py-1.5 text-[9px] font-bold text-slate-500 uppercase tracking-widest">Reference</th>
                                              <th className="text-left px-3 py-1.5 text-[9px] font-bold text-slate-500 uppercase tracking-widest">Remarks</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {detailData.transactions.map((t: any) => (
                                              <tr key={t.id} className="border-b border-slate-100">
                                                <td className="px-3 py-1.5 text-slate-600">{new Date(t.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}</td>
                                                <td className="px-3 py-1.5">
                                                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                                                    t.type === 'IN' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : t.type === 'OUT' ? 'border-red-300 bg-red-50 text-red-700' : 'border-amber-300 bg-amber-50 text-amber-700'
                                                  }`}>{t.type}</span>
                                                </td>
                                                <td className="px-3 py-1.5 text-right font-mono tabular-nums font-bold">{t.quantity}</td>
                                                <td className="px-3 py-1.5 text-slate-500">{t.reference || '--'}</td>
                                                <td className="px-3 py-1.5 text-slate-400">{t.remarks || '--'}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      )}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="p-6 text-center text-xs text-red-400">Failed to load details</div>
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
                <div className="col-span-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Supplier</label>
                  <VendorSelect
                    value={editForm.supplier}
                    onChange={(name, vendorId) => {
                      setEditForm({ ...editForm, supplier: name });
                      if (vendorId && editItem) linkVendor(editItem.id, vendorId, linkedVendors.length === 0);
                    }}
                    vendors={vendors}
                    onAddNew={() => setShowQuickAdd(true)}
                  />
                  {/* Linked vendors chips */}
                  {linkedVendors.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {linkedVendors.map(lv => (
                        <span key={lv.id} className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 border ${lv.isPreferred ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-300 bg-slate-50 text-slate-600'}`}>
                          <button type="button" onClick={() => editItem && togglePreferred(editItem.id, lv.vendor.id)} title="Set as preferred">
                            <Star size={10} className={lv.isPreferred ? 'fill-amber-400 text-amber-400' : 'text-slate-300'} />
                          </button>
                          {lv.vendor.name}
                          <button type="button" onClick={() => editItem && unlinkVendor(editItem.id, lv.vendor.id)} className="text-slate-400 hover:text-red-500"><X size={10} /></button>
                        </span>
                      ))}
                    </div>
                  )}
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

      {/* Quick Add Vendor Modal */}
      {showQuickAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white shadow-2xl w-full max-w-sm mx-4">
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-widest">Add New Vendor</span>
              <button onClick={() => setShowQuickAdd(false)} className="text-slate-400 hover:text-white"><X size={16} /></button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Vendor Name *</label>
                <input className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                  value={quickVendor.name} onChange={e => setQuickVendor({ ...quickVendor, name: e.target.value })} placeholder="ABC Chemicals Ltd" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">GSTIN (optional)</label>
                <input className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400 font-mono"
                  value={quickVendor.gstin} onChange={e => setQuickVendor({ ...quickVendor, gstin: e.target.value.toUpperCase() })} placeholder="23AAECM3666P1Z1" maxLength={15} />
              </div>
            </div>
            <div className="border-t border-slate-200 px-4 py-3 flex justify-end gap-2">
              <button onClick={() => setShowQuickAdd(false)} className="px-3 py-1 bg-slate-200 text-slate-700 text-[11px] font-medium hover:bg-slate-300">Cancel</button>
              <button onClick={handleQuickAddVendor} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">Add Vendor</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
