import { useState, useEffect, useCallback } from 'react';
import {
  ArrowDownRight, ArrowUpRight, ArrowLeftRight, Sliders,
  Plus, X, Save, Loader2, Search, Filter,
} from 'lucide-react';
import api from '../../services/api';

interface Movement {
  id: string;
  movementNo: number;
  date: string;
  type: string;
  direction: string;
  quantity: number;
  rate: number;
  totalValue: number;
  batchNo?: string;
  refType?: string;
  refNo?: string;
  narration?: string;
  item: { id: string; name: string; code: string };
  warehouse: { id: string; name: string };
  toWarehouse?: { id: string; name: string };
  createdBy?: { name: string };
}

interface WarehouseOption {
  id: string;
  code: string;
  name: string;
  bins?: { id: string; code: string; name: string }[];
}

interface ItemOption {
  id: string;
  code: string;
  name: string;
  unit: string;
}

const TABS = [
  { key: '', label: 'All' },
  { key: 'RECEIPT', label: 'Receipt' },
  { key: 'ISSUE', label: 'Issue' },
  { key: 'TRANSFER', label: 'Transfer' },
  { key: 'ADJUSTMENT', label: 'Adjustment' },
];

const MOVEMENT_TYPES = ['RECEIPT', 'ISSUE', 'TRANSFER', 'ADJUSTMENT'] as const;
type MovementType = typeof MOVEMENT_TYPES[number];

const REF_TYPES = ['PO', 'GRN', 'SALES_ORDER', 'PRODUCTION', 'MANUAL', 'OTHER'];

const emptyForm = {
  type: 'RECEIPT' as MovementType,
  itemId: '',
  warehouseId: '',
  binId: '',
  toWarehouseId: '',
  quantity: '',
  rate: '',
  batchNo: '',
  refType: 'MANUAL',
  refNo: '',
  narration: '',
  newQty: '',
  reason: '',
};

export default function StockMovements() {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Lookup data
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [selectedWarehouseBins, setSelectedWarehouseBins] = useState<{ id: string; code: string; name: string }[]>([]);

  const fetchMovements = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = { limit: '100' };
      if (tab) params.type = tab;
      if (warehouseFilter) params.warehouseId = warehouseFilter;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      if (searchQuery) params.search = searchQuery;
      const res = await api.get('/api/inventory/movements', { params });
      setMovements(Array.isArray(res.data) ? res.data : res.data.movements ?? []);
    } catch {
      setMsg({ type: 'err', text: 'Failed to load movements' });
    } finally {
      setLoading(false);
    }
  }, [tab, warehouseFilter, dateFrom, dateTo, searchQuery]);

  const fetchLookups = useCallback(async () => {
    try {
      const [whRes, itemRes] = await Promise.all([
        api.get('/api/inventory/warehouses'),
        api.get('/api/inventory/items', { params: { limit: 500, select: 'id,code,name,unit' } }),
      ]);
      setWarehouses(Array.isArray(whRes.data) ? whRes.data : whRes.data.warehouses ?? []);
      setItems(Array.isArray(itemRes.data) ? itemRes.data : itemRes.data.items ?? []);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => { fetchMovements(); }, [fetchMovements]);
  useEffect(() => { fetchLookups(); }, [fetchLookups]);

  useEffect(() => {
    if (msg) {
      const t = setTimeout(() => setMsg(null), 4000);
      return () => clearTimeout(t);
    }
  }, [msg]);

  // When warehouse selection changes, load bins
  useEffect(() => {
    if (form.warehouseId) {
      const wh = warehouses.find(w => w.id === form.warehouseId);
      setSelectedWarehouseBins(wh?.bins ?? []);
    } else {
      setSelectedWarehouseBins([]);
    }
  }, [form.warehouseId, warehouses]);

  const openForm = () => {
    setForm(emptyForm);
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!form.itemId) { setMsg({ type: 'err', text: 'Select an item' }); return; }
    if (!form.quantity && form.type !== 'ADJUSTMENT') { setMsg({ type: 'err', text: 'Enter quantity' }); return; }
    if (!form.warehouseId) { setMsg({ type: 'err', text: 'Select a warehouse' }); return; }

    setSaving(true);
    try {
      let endpoint = '';
      let payload: Record<string, unknown> = {};

      switch (form.type) {
        case 'RECEIPT':
          endpoint = '/api/inventory/movements/receipt';
          payload = {
            itemId: form.itemId,
            warehouseId: form.warehouseId,
            binId: form.binId || undefined,
            quantity: parseFloat(form.quantity),
            rate: form.rate ? parseFloat(form.rate) : undefined,
            batchNo: form.batchNo || undefined,
            refType: form.refType,
            refNo: form.refNo || undefined,
          };
          break;
        case 'ISSUE':
          endpoint = '/api/inventory/movements/issue';
          payload = {
            itemId: form.itemId,
            warehouseId: form.warehouseId,
            quantity: parseFloat(form.quantity),
            refType: form.refType,
            refNo: form.refNo || undefined,
            narration: form.narration || undefined,
          };
          break;
        case 'TRANSFER':
          endpoint = '/api/inventory/movements/transfer';
          if (!form.toWarehouseId) { setMsg({ type: 'err', text: 'Select destination warehouse' }); setSaving(false); return; }
          payload = {
            itemId: form.itemId,
            fromWarehouseId: form.warehouseId,
            toWarehouseId: form.toWarehouseId,
            quantity: parseFloat(form.quantity),
          };
          break;
        case 'ADJUSTMENT':
          endpoint = '/api/inventory/movements/adjust';
          if (!form.newQty) { setMsg({ type: 'err', text: 'Enter new quantity' }); setSaving(false); return; }
          payload = {
            itemId: form.itemId,
            warehouseId: form.warehouseId,
            newQty: parseFloat(form.newQty),
            reason: form.reason || undefined,
          };
          break;
      }

      await api.post(endpoint, payload);
      setMsg({ type: 'ok', text: `${form.type} recorded successfully` });
      setShowForm(false);
      fetchMovements();
    } catch {
      setMsg({ type: 'err', text: 'Failed to record movement' });
    } finally {
      setSaving(false);
    }
  };

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(v);

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const typeIcon = (type: string) => {
    switch (type) {
      case 'RECEIPT': return <ArrowDownRight className="w-3.5 h-3.5" />;
      case 'ISSUE': return <ArrowUpRight className="w-3.5 h-3.5" />;
      case 'TRANSFER': return <ArrowLeftRight className="w-3.5 h-3.5" />;
      case 'ADJUSTMENT': return <Sliders className="w-3.5 h-3.5" />;
      default: return null;
    }
  };

  const typeColor = (type: string) => {
    switch (type) {
      case 'RECEIPT': return 'bg-green-100 text-green-700';
      case 'ISSUE': return 'bg-red-100 text-red-700';
      case 'TRANSFER': return 'bg-blue-100 text-blue-700';
      case 'ADJUSTMENT': return 'bg-yellow-100 text-yellow-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const selectedItem = items.find(i => i.id === form.itemId);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Stock Movements</h1>
        <button onClick={openForm} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
          <Plus className="w-4 h-4" /> New Movement
        </button>
      </div>

      {msg && (
        <div className={`p-3 rounded-lg text-sm ${msg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {msg.text}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search item..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
        </div>
        <button onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-2 px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">
          <Filter className="w-4 h-4" /> Filters
        </button>
      </div>

      {showFilters && (
        <div className="flex flex-wrap gap-3 p-4 bg-gray-50 rounded-lg">
          <div>
            <label className="text-xs text-gray-500">From Date</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="block px-3 py-1.5 border rounded text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500">To Date</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="block px-3 py-1.5 border rounded text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500">Warehouse</label>
            <select value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)}
              className="block px-3 py-1.5 border rounded text-sm">
              <option value="">All Warehouses</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <button onClick={() => { setDateFrom(''); setDateTo(''); setWarehouseFilter(''); }}
              className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700">Clear</button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>
      ) : movements.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <ArrowLeftRight className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No movements found</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-gray-500">
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Direction</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Rate</th>
                  <th className="px-4 py-3 text-right">Value</th>
                  <th className="px-4 py-3">Warehouse</th>
                  <th className="px-4 py-3">Ref</th>
                  <th className="px-4 py-3">User</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-400">{m.movementNo}</td>
                    <td className="px-4 py-3">{formatDate(m.date)}</td>
                    <td className="px-4 py-3">
                      <span className="font-medium">{m.item?.name ?? '-'}</span>
                      <span className="text-xs text-gray-400 ml-1">{m.item?.code}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${typeColor(m.type)}`}>
                        {typeIcon(m.type)} {m.type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${m.direction === 'IN' ? 'text-green-600' : 'text-red-600'}`}>
                        {m.direction}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium">{m.quantity}</td>
                    <td className="px-4 py-3 text-right">{m.rate ? formatCurrency(m.rate) : '-'}</td>
                    <td className="px-4 py-3 text-right font-medium">{m.totalValue ? formatCurrency(m.totalValue) : '-'}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {m.warehouse?.name ?? '-'}
                      {m.toWarehouse && <span className="text-xs"> &rarr; {m.toWarehouse.name}</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {m.refType && m.refNo ? `${m.refType}: ${m.refNo}` : m.refType ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{m.createdBy?.name ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* New Movement Form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowForm(false)} />
          <div className="ml-auto relative w-full max-w-lg bg-white shadow-xl h-full overflow-y-auto">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-semibold">New Movement</h2>
              <button onClick={() => setShowForm(false)}><X className="w-5 h-5 text-gray-400 hover:text-gray-600" /></button>
            </div>
            <div className="p-6 space-y-4">
              {/* Movement Type Selector */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Movement Type</label>
                <div className="grid grid-cols-4 gap-2">
                  {MOVEMENT_TYPES.map((t) => (
                    <button
                      key={t}
                      onClick={() => setForm({ ...emptyForm, type: t })}
                      className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                        form.type === t ? `${typeColor(t)} border-current` : 'border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Item Select */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Item *</label>
                <select value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                  <option value="">Select item...</option>
                  {items.map(i => <option key={i.id} value={i.id}>{i.code} - {i.name} ({i.unit})</option>)}
                </select>
              </div>

              {/* Warehouse */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {form.type === 'TRANSFER' ? 'From Warehouse *' : 'Warehouse *'}
                </label>
                <select value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value, binId: '' })}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                  <option value="">Select warehouse...</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
                </select>
              </div>

              {/* Bin (receipt only) */}
              {form.type === 'RECEIPT' && selectedWarehouseBins.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Bin</label>
                  <select value={form.binId} onChange={(e) => setForm({ ...form, binId: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                    <option value="">No specific bin</option>
                    {selectedWarehouseBins.map(b => <option key={b.id} value={b.id}>{b.code} - {b.name}</option>)}
                  </select>
                </div>
              )}

              {/* To Warehouse (transfer) */}
              {form.type === 'TRANSFER' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">To Warehouse *</label>
                  <select value={form.toWarehouseId} onChange={(e) => setForm({ ...form, toWarehouseId: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                    <option value="">Select destination...</option>
                    {warehouses.filter(w => w.id !== form.warehouseId).map(w => (
                      <option key={w.id} value={w.id}>{w.code} - {w.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Quantity / New Qty */}
              {form.type === 'ADJUSTMENT' ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">New Quantity *</label>
                  <input type="number" value={form.newQty} onChange={(e) => setForm({ ...form, newQty: e.target.value })}
                    placeholder="Actual counted quantity"
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Quantity * {selectedItem && <span className="text-gray-400">({selectedItem.unit})</span>}
                    </label>
                    <input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                  </div>
                  {(form.type === 'RECEIPT') && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Rate</label>
                      <input type="number" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>
                  )}
                </div>
              )}

              {/* Batch No (receipt) */}
              {form.type === 'RECEIPT' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Batch No</label>
                  <input type="text" value={form.batchNo} onChange={(e) => setForm({ ...form, batchNo: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                </div>
              )}

              {/* Reference (receipt, issue) */}
              {(form.type === 'RECEIPT' || form.type === 'ISSUE') && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Ref Type</label>
                    <select value={form.refType} onChange={(e) => setForm({ ...form, refType: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                      {REF_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Ref No</label>
                    <input type="text" value={form.refNo} onChange={(e) => setForm({ ...form, refNo: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                  </div>
                </div>
              )}

              {/* Narration (issue) */}
              {form.type === 'ISSUE' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Narration</label>
                  <textarea value={form.narration} onChange={(e) => setForm({ ...form, narration: e.target.value })}
                    rows={2} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                </div>
              )}

              {/* Reason (adjustment) */}
              {form.type === 'ADJUSTMENT' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                  <textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
                    rows={2} placeholder="Reason for adjustment"
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                </div>
              )}
            </div>

            <div className="sticky bottom-0 bg-white border-t px-6 py-4 flex justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={handleSubmit} disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Record {form.type}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
