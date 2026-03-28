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
const REF_TYPE_LABELS: Record<string, string> = {
  PO: 'Purchase Order',
  GRN: 'Goods Receipt (GRN)',
  SALES_ORDER: 'Sales / Dispatch',
  PRODUCTION: 'Production / Factory Use',
  MANUAL: 'Manual Entry',
  OTHER: 'Other',
};

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
      const res = await api.get('/inventory/movements', { params });
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
        api.get('/inventory/warehouses'),
        api.get('/inventory/items', { params: { limit: 500, select: 'id,code,name,unit' } }),
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
          endpoint = '/inventory/movements/receipt';
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
          endpoint = '/inventory/movements/issue';
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
          endpoint = '/inventory/movements/transfer';
          if (!form.toWarehouseId) { setMsg({ type: 'err', text: 'Select destination warehouse' }); setSaving(false); return; }
          payload = {
            itemId: form.itemId,
            fromWarehouseId: form.warehouseId,
            toWarehouseId: form.toWarehouseId,
            quantity: parseFloat(form.quantity),
          };
          break;
        case 'ADJUSTMENT':
          endpoint = '/inventory/movements/adjust';
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

  const typeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'GRN_RECEIPT': 'GRN Receipt',
      'PRODUCTION_RECEIPT': 'From Production',
      'PRODUCTION_ISSUE': 'To Production',
      'SALES_ISSUE': 'Sales Dispatch',
      'TRANSFER': 'Warehouse Transfer',
      'ADJUSTMENT': 'Stock Adjustment',
      'RETURN': 'Return',
      'SCRAP': 'Scrap / Write-off',
      'RECEIPT': 'Receipt',
      'ISSUE': 'Issue',
    };
    return labels[type] || type.replace(/_/g, ' ');
  };

  const typeIcon = (type: string) => {
    switch (type) {
      case 'RECEIPT': case 'GRN_RECEIPT': case 'PRODUCTION_RECEIPT': return <ArrowDownRight className="w-3.5 h-3.5" />;
      case 'ISSUE': case 'PRODUCTION_ISSUE': case 'SALES_ISSUE': return <ArrowUpRight className="w-3.5 h-3.5" />;
      case 'TRANSFER': return <ArrowLeftRight className="w-3.5 h-3.5" />;
      case 'ADJUSTMENT': case 'RETURN': case 'SCRAP': return <Sliders className="w-3.5 h-3.5" />;
      default: return null;
    }
  };

  const typeBadge = (type: string) => {
    if (!type) return 'border-slate-300 bg-slate-50 text-slate-700';
    if (type.includes('RECEIPT') || type === 'RETURN') return 'border-emerald-300 bg-emerald-50 text-emerald-700';
    if (type.includes('ISSUE') || type === 'SCRAP') return 'border-red-300 bg-red-50 text-red-700';
    switch (type) {
      case 'TRANSFER': return 'border-blue-300 bg-blue-50 text-blue-700';
      case 'ADJUSTMENT': return 'border-amber-300 bg-amber-50 text-amber-700';
      default: return 'border-slate-300 bg-slate-50 text-slate-700';
    }
  };

  const selectedItem = items.find(i => i.id === form.itemId);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <h1 className="text-sm font-bold tracking-wide uppercase">STOCK MOVEMENTS</h1>
          <div className="flex items-center gap-2">
            <button onClick={openForm} className="flex items-center gap-1.5 px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
              <Plus className="w-3.5 h-3.5" /> New Movement
            </button>
          </div>
        </div>

        {/* Flash Message */}
        {msg && (
          <div className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border -mx-3 md:-mx-6 ${
            msg.type === 'ok'
              ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
              : 'border-red-300 bg-red-50 text-red-700'
          }`}>
            {msg.text}
          </div>
        )}

        {/* Tabs */}
        <div className="bg-slate-100 border-x border-b border-slate-300 -mx-3 md:-mx-6 flex">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-5 py-2 text-[11px] font-bold uppercase tracking-widest border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-blue-600 text-slate-800 bg-white'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Search + Filters Toolbar */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search item..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
            />
          </div>
          <button onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-1.5 px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">
            <Filter className="w-3.5 h-3.5" /> Filters
          </button>
        </div>

        {/* Filter Panel */}
        {showFilters && (
          <div className="bg-slate-50 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-end gap-4 flex-wrap">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">From Date</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                className="border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">To Date</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                className="border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Warehouse</label>
              <select value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)}
                className="border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400">
                <option value="">All Warehouses</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <button onClick={() => { setDateFrom(''); setDateTo(''); setWarehouseFilter(''); }}
              className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">
              Clear
            </button>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="min-h-[200px] bg-white flex items-center justify-center border-x border-b border-slate-300 -mx-3 md:-mx-6">
            <div className="text-sm text-slate-400">Loading...</div>
          </div>
        ) : movements.length === 0 ? (
          <div className="text-center py-16 bg-white border-x border-b border-slate-300 -mx-3 md:-mx-6">
            <div className="text-slate-300 text-sm">No movements found</div>
          </div>
        ) : (
          <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">#</th>
                    <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Date</th>
                    <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Item</th>
                    <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Type</th>
                    <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Direction</th>
                    <th className="text-right px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Qty</th>
                    <th className="text-right px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Rate</th>
                    <th className="text-right px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Value</th>
                    <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Warehouse</th>
                    <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Ref</th>
                    <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider">User</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m) => (
                    <tr key={m.id} className="border-b border-slate-100 hover:bg-blue-50/40 even:bg-slate-50/50">
                      <td className="px-3 py-1.5 text-slate-400 font-mono text-xs border-r border-slate-100">{m.movementNo}</td>
                      <td className="px-3 py-1.5 text-slate-700 whitespace-nowrap border-r border-slate-100">{formatDate(m.date)}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100">
                        <span className="font-medium text-slate-800">{m.item?.name ?? '-'}</span>
                        <span className="text-[11px] text-slate-400 ml-1">{m.item?.code}</span>
                      </td>
                      <td className="px-3 py-1.5 border-r border-slate-100">
                        <span className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase px-1.5 py-0.5 border ${typeBadge(m.type)}`}>
                          {typeIcon(m.type)} {typeLabel(m.type)}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 border-r border-slate-100">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                          m.direction === 'IN'
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                            : 'border-red-300 bg-red-50 text-red-700'
                        }`}>
                          {m.direction}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right font-medium font-mono tabular-nums text-slate-800 border-r border-slate-100">{m.quantity}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-600 border-r border-slate-100">{m.rate ? formatCurrency(m.rate) : '-'}</td>
                      <td className="px-3 py-1.5 text-right font-medium font-mono tabular-nums text-slate-800 border-r border-slate-100">{m.totalValue ? formatCurrency(m.totalValue) : '-'}</td>
                      <td className="px-3 py-1.5 text-slate-600 text-xs border-r border-slate-100">
                        {m.warehouse?.name ?? '-'}
                        {m.toWarehouse && <span className="text-slate-400"> &rarr; {m.toWarehouse.name}</span>}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-slate-500 border-r border-slate-100">
                        {m.refType && m.refNo ? `${m.refType}: ${m.refNo}` : m.refType ?? '-'}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-slate-500">{m.createdBy?.name ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* New Movement Drawer */}
        {showForm && (
          <div className="fixed inset-0 z-50 flex justify-end">
            <div className="absolute inset-0 bg-black/20" onClick={() => setShowForm(false)} />
            <div className="relative w-full max-w-lg bg-white shadow-xl h-full overflow-y-auto">
              {/* Drawer Header */}
              <div className="sticky top-0 bg-slate-800 text-white px-5 py-3 flex items-center justify-between z-10">
                <h2 className="text-xs font-bold uppercase tracking-wide">New Movement</h2>
                <button onClick={() => setShowForm(false)} className="p-1 text-white/70 hover:text-white">
                  <X size={16} />
                </button>
              </div>

              {/* Drawer Body */}
              <div className="p-5 space-y-4">
                {/* Movement Type Selector */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Movement Type</label>
                  <div className="grid grid-cols-4 gap-2">
                    {MOVEMENT_TYPES.map((t) => (
                      <button
                        key={t}
                        onClick={() => setForm({ ...emptyForm, type: t })}
                        className={`px-3 py-1.5 text-xs font-medium border transition-colors ${
                          form.type === t
                            ? 'bg-slate-800 text-white border-slate-800'
                            : 'border-slate-200 text-slate-500 hover:border-slate-300'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Item Select */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Item *</label>
                  <select value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400">
                    <option value="">Select item...</option>
                    {items.map(i => <option key={i.id} value={i.id}>{i.code} - {i.name} ({i.unit})</option>)}
                  </select>
                </div>

                {/* Warehouse */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">
                    {form.type === 'TRANSFER' ? 'From Warehouse *' : 'Warehouse *'}
                  </label>
                  <select value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value, binId: '' })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400">
                    <option value="">Select warehouse...</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
                  </select>
                </div>

                {/* Bin (receipt only) */}
                {form.type === 'RECEIPT' && selectedWarehouseBins.length > 0 && (
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Bin</label>
                    <select value={form.binId} onChange={(e) => setForm({ ...form, binId: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400">
                      <option value="">No specific bin</option>
                      {selectedWarehouseBins.map(b => <option key={b.id} value={b.id}>{b.code} - {b.name}</option>)}
                    </select>
                  </div>
                )}

                {/* To Warehouse (transfer) */}
                {form.type === 'TRANSFER' && (
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">To Warehouse *</label>
                    <select value={form.toWarehouseId} onChange={(e) => setForm({ ...form, toWarehouseId: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400">
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
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">New Quantity *</label>
                    <input type="number" value={form.newQty} onChange={(e) => setForm({ ...form, newQty: e.target.value })}
                      placeholder="Actual counted quantity"
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400" />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">
                        Quantity * {selectedItem && <span className="text-slate-400 normal-case tracking-normal">({selectedItem.unit})</span>}
                      </label>
                      <input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                        className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400" />
                    </div>
                    {(form.type === 'RECEIPT') && (
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Rate</label>
                        <input type="number" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })}
                          className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400" />
                      </div>
                    )}
                  </div>
                )}

                {/* Batch No (receipt) */}
                {form.type === 'RECEIPT' && (
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Batch No</label>
                    <input type="text" value={form.batchNo} onChange={(e) => setForm({ ...form, batchNo: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400" />
                  </div>
                )}

                {/* Reference (receipt, issue) */}
                {(form.type === 'RECEIPT' || form.type === 'ISSUE') && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Ref Type</label>
                      <select value={form.refType} onChange={(e) => setForm({ ...form, refType: e.target.value })}
                        className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400">
                        {REF_TYPES.map(r => <option key={r} value={r}>{REF_TYPE_LABELS[r] || r}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Ref No</label>
                      <input type="text" value={form.refNo} onChange={(e) => setForm({ ...form, refNo: e.target.value })}
                        className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400" />
                    </div>
                  </div>
                )}

                {/* Narration (issue) */}
                {form.type === 'ISSUE' && (
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Narration</label>
                    <textarea value={form.narration} onChange={(e) => setForm({ ...form, narration: e.target.value })}
                      rows={2} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400" />
                  </div>
                )}

                {/* Reason (adjustment) */}
                {form.type === 'ADJUSTMENT' && (
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Reason</label>
                    <textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
                      rows={2} placeholder="Reason for adjustment"
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400" />
                  </div>
                )}
              </div>

              {/* Drawer Footer */}
              <div className="sticky bottom-0 bg-slate-50 border-t border-slate-200 px-5 py-3 flex justify-end gap-2">
                <button onClick={() => setShowForm(false)}
                  className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">
                  Cancel
                </button>
                <button onClick={handleSubmit} disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Record {form.type}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
