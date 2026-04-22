import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, X, Save, Loader2, Search, ChevronDown, ChevronRight,
  Edit2, XCircle, Package, Sparkles, Zap,
} from 'lucide-react';
import api from '../../services/api';

interface LookupResult {
  name: string;
  hsnCode: string;
  gstPercent: number;
  category: string;
  unit: string;
  score: number;
}

interface InventoryItem {
  id: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  currentStock: number;
  avgCost: number;
  totalValue: number;
  status: string;
  minStock: number;
  maxStock: number;
  costPerUnit: number;
  hsnCode: string;
  gstPercent: number;
  valuationMethod: string;
  batchTracked: boolean;
  division?: string;
  aliases?: string[];
  handlerKey?: string | null;
  isContractBased?: boolean;
  needsLabTest?: boolean;
}

interface StockLevel {
  warehouseId: string;
  warehouseName: string;
  quantity: number;
  value: number;
}

interface ReorderRule {
  id?: string;
  itemId: string;
  reorderPoint: number;
  reorderQty: number;
  maxStock: number;
}

interface RecentMovement {
  id: string;
  date: string;
  type: string;
  direction: string;
  quantity: number;
  warehouse: { name: string };
}

const CATEGORIES = [
  { value: '', label: 'All Categories' },
  { value: 'RAW_MATERIAL', label: 'Raw Material' },
  { value: 'SPARE_PART', label: 'Spare Part' },
  { value: 'CONSUMABLE', label: 'Consumable' },
  { value: 'CHEMICAL', label: 'Chemical' },
  { value: 'FUEL', label: 'Fuel' },
  { value: 'FINISHED_GOOD', label: 'Finished Good' },
  { value: 'BYPRODUCT', label: 'By-product' },
  { value: 'SCRAP', label: 'Scrap' },
  { value: 'PACKAGING', label: 'Packaging' },
];

const DIVISIONS = [
  { value: 'ETHANOL', label: 'Ethanol' },
  { value: 'SUGAR', label: 'Sugar' },
  { value: 'POWER', label: 'Power' },
  { value: 'COMMON', label: 'Common (all divisions)' },
];

const HANDLER_KEYS = [
  { value: '', label: 'Auto (route by category + division)' },
  { value: 'ETHANOL_OUTBOUND', label: 'Ethanol Outbound (OMC gate-pass flow)' },
  { value: 'DDGS_OUTBOUND', label: 'DDGS Outbound (contract auto-link)' },
  { value: 'SUGAR_OUTBOUND', label: 'Sugar Outbound (contract auto-link)' },
  { value: 'PO_INBOUND', label: 'PO Inbound (procurement GRN)' },
  { value: 'SPOT_INBOUND', label: 'Spot Inbound (direct purchase)' },
];

const UNITS = ['KG', 'LTR', 'MT', 'NOS', 'PCS', 'SET', 'BOX', 'BAG', 'DRUM', 'PKT'];
const VALUATION_METHODS = ['WEIGHTED_AVG', 'FIFO', 'LIFO'];

const emptyForm = {
  code: '', name: '', category: 'RAW_MATERIAL', unit: 'KG',
  minStock: '', maxStock: '', costPerUnit: '', hsnCode: '',
  gstPercent: '', valuationMethod: 'WEIGHTED_AVG', batchTracked: false,
  division: 'ETHANOL', aliases: '', handlerKey: '',
  isContractBased: false, needsLabTest: false,
};

export default function MaterialMaster() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [stockLevels, setStockLevels] = useState<StockLevel[]>([]);
  const [itemMovements, setItemMovements] = useState<RecentMovement[]>([]);
  const [itemVendors, setItemVendors] = useState<Array<{
    id: string; rate: number; isPreferred: boolean; updatedAt: string;
    vendor: { id: string; name: string; email: string | null; phone: string | null; contactPerson: string | null };
  }>>([]);
  const [reorderRule, setReorderRule] = useState<ReorderRule | null>(null);
  const [expandLoading, setExpandLoading] = useState(false);

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = { limit: '500' };
      if (categoryFilter) params.category = categoryFilter;
      const res = await api.get('/inventory/items', { params });
      setItems(Array.isArray(res.data) ? res.data : res.data.items ?? []);
    } catch {
      setMsg({ type: 'err', text: 'Failed to load items' });
    } finally {
      setLoading(false);
    }
  }, [categoryFilter]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  useEffect(() => {
    if (msg) {
      const t = setTimeout(() => setMsg(null), 4000);
      return () => clearTimeout(t);
    }
  }, [msg]);

  const filtered = items.filter((it) => {
    const q = searchQuery.toLowerCase();
    return (
      it.name.toLowerCase().includes(q) ||
      it.code.toLowerCase().includes(q) ||
      (it.hsnCode && it.hsnCode.toLowerCase().includes(q))
    );
  });

  const openCreate = () => {
    setEditId(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (item: InventoryItem) => {
    setEditId(item.id);
    setForm({
      code: item.code,
      name: item.name,
      category: item.category,
      unit: item.unit,
      minStock: String(item.minStock ?? ''),
      maxStock: String(item.maxStock ?? ''),
      costPerUnit: String(item.costPerUnit ?? ''),
      hsnCode: item.hsnCode ?? '',
      gstPercent: String(item.gstPercent ?? ''),
      valuationMethod: item.valuationMethod ?? 'WEIGHTED_AVG',
      batchTracked: item.batchTracked ?? false,
      division: item.division ?? 'ETHANOL',
      aliases: Array.isArray(item.aliases) ? item.aliases.join(', ') : '',
      handlerKey: item.handlerKey ?? '',
      isContractBased: item.isContractBased ?? false,
      needsLabTest: item.needsLabTest ?? false,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setMsg({ type: 'err', text: 'Name is required' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        minStock: form.minStock ? parseFloat(form.minStock) : undefined,
        maxStock: form.maxStock ? parseFloat(form.maxStock) : undefined,
        costPerUnit: form.costPerUnit ? parseFloat(form.costPerUnit) : undefined,
        gstPercent: form.gstPercent ? parseFloat(form.gstPercent) : undefined,
        aliases: form.aliases.split(',').map(s => s.trim()).filter(Boolean),
        handlerKey: form.handlerKey || null,
      };
      if (editId) {
        await api.put(`/inventory/items/${editId}`, payload);
        setMsg({ type: 'ok', text: 'Item updated' });
      } else {
        await api.post('/inventory/items', payload);
        setMsg({ type: 'ok', text: 'Item created' });
      }
      setShowForm(false);
      setForm(emptyForm);
      setEditId(null);
      fetchItems();
    } catch {
      setMsg({ type: 'err', text: 'Failed to save item' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (id: string) => {
    if (!confirm('Deactivate this item?')) return;
    try {
      await api.put(`/inventory/items/${id}`, { isActive: false });
      setMsg({ type: 'ok', text: 'Item deactivated' });
      fetchItems();
    } catch {
      setMsg({ type: 'err', text: 'Failed to deactivate' });
    }
  };

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    setExpandLoading(true);
    try {
      const [levelsRes, movRes, ruleRes, vendorsRes] = await Promise.all([
        api.get(`/inventory/stock/levels/${id}`),
        api.get('/inventory/movements', { params: { itemId: id, limit: 5 } }),
        api.get('/inventory/reorder/rules', { params: { itemId: id } }).catch(() => ({ data: null })),
        api.get(`/inventory/items/${id}/vendors`).catch(() => ({ data: { vendors: [] } })),
      ]);
      setStockLevels(Array.isArray(levelsRes.data) ? levelsRes.data : levelsRes.data.levels ?? []);
      const movData = movRes.data;
      setItemMovements(Array.isArray(movData) ? movData : movData.movements ?? []);
      const ruleData = ruleRes.data;
      setReorderRule(ruleData && !Array.isArray(ruleData) ? ruleData : Array.isArray(ruleData) && ruleData.length > 0 ? ruleData[0] : null);
      setItemVendors((vendorsRes.data as { vendors?: typeof itemVendors })?.vendors || []);
    } catch {
      // non-critical
    } finally {
      setExpandLoading(false);
    }
  };

  const saveReorderRule = async () => {
    if (!reorderRule || !expandedId) return;
    try {
      await api.post('/inventory/reorder/rules', { ...reorderRule, itemId: expandedId });
      setMsg({ type: 'ok', text: 'Reorder rule saved' });
    } catch {
      setMsg({ type: 'err', text: 'Failed to save reorder rule' });
    }
  };

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(v);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Material Master</h1>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 text-sm">
          <Plus className="w-4 h-4" /> Add Item
        </button>
      </div>

      {msg && (
        <div className={`p-3 text-sm ${msg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {msg.text}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by code, name, HSN..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-4 py-2 border text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No items found</p>
        </div>
      ) : (
        <div className="bg-white border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-gray-500">
                  <th className="px-4 py-3 w-8"></th>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Unit</th>
                  <th className="px-4 py-3 text-right">Stock</th>
                  <th className="px-4 py-3 text-right">Avg Cost</th>
                  <th className="px-4 py-3 text-right">Value</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    expanded={expandedId === item.id}
                    expandLoading={expandLoading && expandedId === item.id}
                    stockLevels={expandedId === item.id ? stockLevels : []}
                    itemMovements={expandedId === item.id ? itemMovements : []}
                    itemVendors={expandedId === item.id ? itemVendors : []}
                    reorderRule={expandedId === item.id ? reorderRule : null}
                    onToggle={() => toggleExpand(item.id)}
                    onEdit={() => openEdit(item)}
                    onDeactivate={() => handleDeactivate(item.id)}
                    onReorderChange={setReorderRule}
                    onReorderSave={saveReorderRule}
                    formatCurrency={formatCurrency}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Slide-out Form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowForm(false)} />
          <div className="ml-auto relative w-full max-w-lg bg-white shadow-xl h-full overflow-y-auto">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-semibold">{editId ? 'Edit Item' : 'New Item'}</h2>
              <button onClick={() => setShowForm(false)}><X className="w-5 h-5 text-gray-400 hover:text-gray-600" /></button>
            </div>
            <div className="p-6 space-y-4">
              {/* Smart Lookup — search to auto-fill */}
              {!editId && <ItemLookupSearch onSelect={(result) => {
                setForm(prev => ({
                  ...prev,
                  name: result.name,
                  hsnCode: result.hsnCode,
                  gstPercent: String(result.gstPercent),
                  category: result.category,
                  unit: result.unit,
                }));
              }} />}

              <FormField label="Code" value={form.code} onChange={(v) => setForm({ ...form, code: v })} placeholder="Auto-generated (e.g. RM-00001)" />
              <FormField label="Name *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Item name" />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full px-3 py-2 border text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                  {CATEGORIES.filter(c => c.value).map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  className="w-full px-3 py-2 border text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Min Stock" value={form.minStock} onChange={(v) => setForm({ ...form, minStock: v })} type="number" />
                <FormField label="Max Stock" value={form.maxStock} onChange={(v) => setForm({ ...form, maxStock: v })} type="number" />
              </div>
              <FormField label="Cost Per Unit" value={form.costPerUnit} onChange={(v) => setForm({ ...form, costPerUnit: v })} type="number" />
              <div className="grid grid-cols-2 gap-4">
                <FormField label="HSN Code" value={form.hsnCode} onChange={(v) => setForm({ ...form, hsnCode: v })} />
                <div>
                  <FormField label="GST %" value={form.gstPercent} onChange={(v) => setForm({ ...form, gstPercent: v })} type="number" />
                  <p className="mt-1 text-[11px] text-amber-700">
                    Auto-set from HSN master on save. To change a rate permanently, edit it in Compliance → HSN Master.
                  </p>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Valuation Method</label>
                <select value={form.valuationMethod} onChange={(e) => setForm({ ...form, valuationMethod: e.target.value })}
                  className="w-full px-3 py-2 border text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                  {VALUATION_METHODS.map(m => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.batchTracked} onChange={(e) => setForm({ ...form, batchTracked: e.target.checked })}
                  className="rounded border-gray-300" />
                Batch Tracked
              </label>

              {/* Multi-Division Routing (Stage 2) */}
              <div className="border-t pt-4 mt-2">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Routing & Division</div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Division</label>
                  <select value={form.division} onChange={(e) => setForm({ ...form, division: e.target.value })}
                    className="w-full px-3 py-2 border text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                    {DIVISIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">Which plant division owns this item</p>
                </div>
                <div className="mt-3">
                  <FormField label="Aliases (comma-separated)" value={form.aliases} onChange={(v) => setForm({ ...form, aliases: v })} placeholder="e.g. DI, ductile iron, MS scrap" />
                  <p className="text-xs text-gray-500 mt-1">Alternate names operators may type at gate entry</p>
                </div>
                <div className="mt-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Handler Override</label>
                  <select value={form.handlerKey} onChange={(e) => setForm({ ...form, handlerKey: e.target.value })}
                    className="w-full px-3 py-2 border text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                    {HANDLER_KEYS.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">Leave on Auto unless this product needs special weighbridge handling</p>
                </div>
                <label className="flex items-center gap-2 text-sm mt-3">
                  <input type="checkbox" checked={form.isContractBased} onChange={(e) => setForm({ ...form, isContractBased: e.target.checked })}
                    className="rounded border-gray-300" />
                  Contract-based (gate entry must pick a contract)
                </label>
                <label className="flex items-center gap-2 text-sm mt-2">
                  <input type="checkbox" checked={form.needsLabTest} onChange={(e) => setForm({ ...form, needsLabTest: e.target.checked })}
                    className="rounded border-gray-300" />
                  Needs lab test before gross weighment
                </label>
              </div>
            </div>
            <div className="sticky bottom-0 bg-white border-t px-6 py-4 flex justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 border text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50">
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

/* Sub-components */

function FormField({ label, value, onChange, type = 'text', placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2 border text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
    </div>
  );
}

interface ItemVendor {
  id: string; rate: number; isPreferred: boolean; updatedAt: string;
  vendor: { id: string; name: string; email: string | null; phone: string | null; contactPerson: string | null };
}

function ItemRow({ item, expanded, expandLoading, stockLevels, itemMovements, itemVendors, reorderRule,
  onToggle, onEdit, onDeactivate, onReorderChange, onReorderSave, formatCurrency }: {
  item: InventoryItem; expanded: boolean; expandLoading: boolean;
  stockLevels: StockLevel[]; itemMovements: RecentMovement[];
  itemVendors: ItemVendor[];
  reorderRule: ReorderRule | null;
  onToggle: () => void; onEdit: () => void; onDeactivate: () => void;
  onReorderChange: (r: ReorderRule | null) => void; onReorderSave: () => void;
  formatCurrency: (v: number) => string;
}) {
  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

  return (
    <>
      <tr className="border-b hover:bg-gray-50 cursor-pointer" onClick={onToggle}>
        <td className="px-4 py-3">
          {expanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
        </td>
        <td className="px-4 py-3 font-mono text-xs">{item.code}</td>
        <td className="px-4 py-3 font-medium">{item.name}</td>
        <td className="px-4 py-3 text-gray-500">{item.category.replace(/_/g, ' ')}</td>
        <td className="px-4 py-3">{item.unit}</td>
        <td className="px-4 py-3 text-right">{item.currentStock ?? 0}</td>
        <td className="px-4 py-3 text-right">{formatCurrency(item.avgCost ?? item.costPerUnit ?? 0)}</td>
        <td className="px-4 py-3 text-right font-medium">{formatCurrency(item.totalValue ?? 0)}</td>
        <td className="px-4 py-3">
          <span className={`px-2 py-0.5 text-xs font-medium ${item.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            {item.status}
          </span>
        </td>
        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
          <button onClick={onEdit} className="p-1 hover:bg-blue-50" title="Edit">
            <Edit2 className="w-4 h-4 text-blue-600" />
          </button>
          {item.status === 'ACTIVE' && (
            <button onClick={onDeactivate} className="p-1 hover:bg-red-50ml-1" title="Deactivate">
              <XCircle className="w-4 h-4 text-red-500" />
            </button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={10} className="bg-gray-50 px-8 py-4">
            {expandLoading ? (
              <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-blue-600" /></div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Stock by Warehouse */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Stock by Warehouse</h4>
                  {stockLevels.length === 0 ? (
                    <p className="text-gray-400 text-xs">No stock records</p>
                  ) : (
                    <div className="space-y-1">
                      {stockLevels.map((sl) => (
                        <div key={sl.warehouseId} className="flex justify-between text-xs bg-white p-2">
                          <span>{sl.warehouseName}</span>
                          <span className="font-medium">{sl.quantity} ({formatCurrency(sl.value)})</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* Recent Movements */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Recent Movements</h4>
                  {itemMovements.length === 0 ? (
                    <p className="text-gray-400 text-xs">No movements</p>
                  ) : (
                    <div className="space-y-1">
                      {itemMovements.map((m) => (
                        <div key={m.id} className="flex justify-between text-xs bg-white p-2">
                          <span>{formatDate(m.date)} - {m.type}</span>
                          <span className={m.direction === 'IN' ? 'text-green-600' : 'text-red-600'}>
                            {m.direction === 'IN' ? '+' : '-'}{m.quantity}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Vendors — who quoted / supplied this item */}
                <div className="md:col-span-3">
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">
                    Vendors ({itemVendors.length})
                    {itemVendors.length > 0 && <span className="text-xs text-gray-500 font-normal ml-2">⭐ = preferred (awarded)</span>}
                  </h4>
                  {itemVendors.length === 0 ? (
                    <p className="text-gray-400 text-xs italic">No vendors linked yet. When someone enters a quote rate or awards a vendor via an indent, the vendor is auto-linked here.</p>
                  ) : (
                    <div className="bg-white border border-gray-200 overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-gray-50 text-gray-600 border-b border-gray-200">
                            <th className="text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest">Vendor</th>
                            <th className="text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest">Contact</th>
                            <th className="text-right px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest w-24">Last Rate</th>
                            <th className="text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest w-24">Updated</th>
                          </tr>
                        </thead>
                        <tbody>
                          {itemVendors.map(v => (
                            <tr key={v.id} className={`border-b border-gray-100 last:border-b-0 ${v.isPreferred ? 'bg-green-50' : ''}`}>
                              <td className="px-3 py-1.5 font-medium text-gray-800">
                                {v.isPreferred && <span className="mr-1">⭐</span>}
                                {v.vendor.name}
                              </td>
                              <td className="px-3 py-1.5 text-[10px] text-gray-500">
                                {v.vendor.email || '—'}
                                {v.vendor.phone && <div>{v.vendor.phone}</div>}
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono tabular-nums font-bold text-green-700">
                                {v.rate > 0 ? `Rs.${v.rate.toLocaleString('en-IN')}` : '—'}
                              </td>
                              <td className="px-3 py-1.5 text-[10px] text-gray-500">{formatDate(v.updatedAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                {/* Reorder Rule */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Reorder Rule</h4>
                  <div className="space-y-2">
                    <div>
                      <label className="text-xs text-gray-500">Reorder Point</label>
                      <input type="number" value={reorderRule?.reorderPoint ?? ''}
                        onChange={(e) => onReorderChange({ ...(reorderRule ?? { itemId: item.id, reorderPoint: 0, reorderQty: 0, maxStock: 0 }), reorderPoint: parseFloat(e.target.value) || 0 })}
                        className="w-full px-2 py-1 border text-sm" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Reorder Qty</label>
                      <input type="number" value={reorderRule?.reorderQty ?? ''}
                        onChange={(e) => onReorderChange({ ...(reorderRule ?? { itemId: item.id, reorderPoint: 0, reorderQty: 0, maxStock: 0 }), reorderQty: parseFloat(e.target.value) || 0 })}
                        className="w-full px-2 py-1 border text-sm" />
                    </div>
                    <button onClick={onReorderSave} className="px-3 py-1 bg-blue-600 text-white text-xs hover:bg-blue-700">
                      Save Rule
                    </button>
                  </div>
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/** Smart item lookup with debounced search against HSN database */
function ItemLookupSearch({ onSelect }: { onSelect: (result: LookupResult) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LookupResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [selected, setSelected] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected || query.length < 2) {
      setResults([]);
      setShowResults(false);
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get('/inventory/item-lookup', { params: { q: query } });
        setResults(res.data ?? []);
        setShowResults(true);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query, selected]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSelect = (result: LookupResult) => {
    setSelected(true);
    setQuery(result.name);
    setShowResults(false);
    onSelect(result);
  };

  const handleClear = () => {
    setQuery('');
    setSelected(false);
    setResults([]);
  };

  const categoryLabel = (cat: string) => cat.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  const categoryColor = (cat: string) => {
    switch (cat) {
      case 'RAW_MATERIAL': return 'bg-amber-100 text-amber-700';
      case 'CHEMICAL': return 'bg-purple-100 text-purple-700';
      case 'SPARE_PART': return 'bg-blue-100 text-blue-700';
      case 'CONSUMABLE': return 'bg-green-100 text-green-700';
      case 'FINISHED_GOOD': return 'bg-emerald-100 text-emerald-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 p-3">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="w-4 h-4 text-blue-600" />
          <span className="text-xs font-semibold text-blue-700">Smart Lookup</span>
          <span className="text-xs text-blue-500">— Search to auto-fill HSN, GST, Category & Unit</span>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(false); }}
            onFocus={() => { if (results.length > 0 && !selected) setShowResults(true); }}
            placeholder="Type item name... e.g. 'alpha amylase', 'ball bearing', 'caustic soda'"
            className="w-full pl-10 pr-10 py-2.5 border border-blue-200 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
          />
          {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-blue-500" />}
          {selected && !searching && (
            <button onClick={handleClear} className="absolute right-3 top-1/2 -translate-y-1/2">
              <X className="w-4 h-4 text-gray-400 hover:text-gray-600" />
            </button>
          )}
        </div>
      </div>

      {/* Results dropdown */}
      {showResults && results.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 shadow-lg max-h-72 overflow-y-auto">
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => handleSelect(r)}
              className="w-full text-left px-4 py-3 hover:bg-blue-50 border-b last:border-0 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-gray-800 text-sm">{r.name}</span>
                <span className={`px-2 py-0.5 text-[10px] font-medium ${categoryColor(r.category)}`}>
                  {categoryLabel(r.category)}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                <span>HSN: <strong className="text-gray-700">{r.hsnCode}</strong></span>
                <span>GST: <strong className="text-gray-700">{r.gstPercent}%</strong></span>
                <span>Unit: <strong className="text-gray-700">{r.unit}</strong></span>
              </div>
            </button>
          ))}
        </div>
      )}

      {showResults && results.length === 0 && query.length >= 2 && !searching && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 shadow-lg p-4 text-center">
          <p className="text-sm text-gray-500">No matches found for "{query}"</p>
          <p className="text-xs text-gray-400 mt-1">Fill the details manually below</p>
        </div>
      )}
    </div>
  );
}
