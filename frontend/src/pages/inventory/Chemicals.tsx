import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Beaker, RefreshCw, Loader2, Search, AlertTriangle, ArrowDownToLine, ArrowUpFromLine, ChevronRight } from 'lucide-react';
import api from '../../services/api';

interface Txn {
  id: string;
  type: 'IN' | 'OUT' | 'ADJUST';
  quantity: number;
  reference: string | null;
  remarks: string | null;
  warehouse: string | null;
  department: string | null;
  issuedTo: string | null;
  createdAt: string;
}

// StockMovement shape from /inventory/items?category=CHEMICAL
interface RawStockMovement {
  id: string;
  movementType: string;
  direction: 'IN' | 'OUT';
  quantity: number;
  unit?: string;
  refType: string | null;
  refNo: string | null;
  narration: string | null;
  date: string;
  warehouse?: { name?: string } | null;
}

interface ApiItem {
  id: string;
  code: string;
  name: string;
  category: string;
  subCategory: string | null;
  unit: string;
  currentStock: number;
  minStock: number;
  maxStock: number | null;
  costPerUnit: number;
  defaultRate: number;
  location: string | null;
  remarks: string | null;
  isActive: boolean;
  transactions?: Txn[];
  stockMovements?: RawStockMovement[];
}

interface Item extends Omit<ApiItem, 'transactions' | 'stockMovements'> {
  transactions: Txn[]; // unified movement feed (legacy + new) sorted newest-first
}

const fmtQty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const fmtCurrency = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 0, style: 'currency', currency: 'INR' });
const ago = (iso: string) => {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.floor(ms / 60_000)}m`;
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

export default function Chemicals() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [subFilter, setSubFilter] = useState<string>('ALL');
  const [stockFilter, setStockFilter] = useState<'ALL' | 'LOW' | 'IN_STOCK' | 'OUT'>('ALL');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/inventory/items', { params: { category: 'CHEMICAL' } });
      const raw: ApiItem[] = Array.isArray(r.data) ? r.data : (r.data?.items ?? []);
      const merged: Item[] = raw.map(i => {
        const fromMovements: Txn[] = (i.stockMovements ?? []).map(m => ({
          id: m.id,
          type: m.direction === 'IN' ? 'IN' : 'OUT',
          quantity: m.quantity,
          reference: m.refNo || m.refType || null,
          remarks: m.narration,
          warehouse: m.warehouse?.name ?? null,
          // dosing flows write refType=PF_DOSING / FERM_DOSING; surface that as the destination
          department: m.refType === 'PF_DOSING' ? 'Pre-Fermentation'
            : m.refType === 'FERM_DOSING' ? 'Fermentation'
            : null,
          issuedTo: null,
          createdAt: m.date,
        }));
        const fromLegacy: Txn[] = i.transactions ?? [];
        // Dedupe shouldn't be needed (different sources), just merge + sort newest-first
        const all = [...fromMovements, ...fromLegacy]
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 10);
        return { ...i, transactions: all };
      });
      setItems(merged);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const subcategories = useMemo(() => {
    const set = new Set<string>();
    for (const i of items) if (i.subCategory) set.add(i.subCategory);
    return ['ALL', ...Array.from(set).sort(), 'UNCATEGORIZED'];
  }, [items]);

  const filtered = useMemo(() => {
    let rows = items;
    if (subFilter !== 'ALL') {
      rows = subFilter === 'UNCATEGORIZED'
        ? rows.filter(i => !i.subCategory)
        : rows.filter(i => i.subCategory === subFilter);
    }
    if (stockFilter === 'LOW') rows = rows.filter(i => i.minStock > 0 && i.currentStock <= i.minStock);
    else if (stockFilter === 'IN_STOCK') rows = rows.filter(i => i.currentStock > 0);
    else if (stockFilter === 'OUT') rows = rows.filter(i => i.currentStock === 0);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(i => i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q));
    }
    return rows;
  }, [items, subFilter, stockFilter, search]);

  const stats = useMemo(() => {
    const total = items.length;
    const low = items.filter(i => i.minStock > 0 && i.currentStock <= i.minStock).length;
    const value = items.reduce((s, i) => s + i.currentStock * (i.costPerUnit || i.defaultRate || 0), 0);
    // Recent IN/OUT from last 5 transactions per item — last 30 days
    const cutoff = Date.now() - 30 * 24 * 3_600_000;
    let recentIn = 0, recentOut = 0;
    for (const i of items) {
      for (const t of i.transactions) {
        if (new Date(t.createdAt).getTime() < cutoff) continue;
        if (t.type === 'IN') recentIn += t.quantity;
        else if (t.type === 'OUT') recentOut += t.quantity;
      }
    }
    return { total, low, value, recentIn, recentOut };
  }, [items]);

  // Flat recent-movements feed
  const recentMovements = useMemo(() => {
    const out: Array<Txn & { itemCode: string; itemName: string; unit: string }> = [];
    for (const i of items) {
      for (const t of i.transactions) {
        out.push({ ...t, itemCode: i.code, itemName: i.name, unit: i.unit });
      }
    }
    out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return out.slice(0, 25);
  }, [items]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Beaker className="w-4 h-4" />
            <h1 className="text-sm font-bold tracking-wide uppercase">Chemicals — Store</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Plant consumption, IN/OUT, reorder alerts</span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/inventory/movements?type=IN&category=CHEMICAL"
              className="px-3 py-1 bg-emerald-600 text-white text-[11px] font-medium hover:bg-emerald-700 inline-flex items-center gap-1"
              title="Receive stock from PO / vendor"
            >
              <ArrowDownToLine className="w-3 h-3" /> Stock IN
            </Link>
            <Link
              to="/inventory/movements?type=OUT&category=CHEMICAL"
              className="px-3 py-1 bg-orange-600 text-white text-[11px] font-medium hover:bg-orange-700 inline-flex items-center gap-1"
              title="Issue to a plant department"
            >
              <ArrowUpFromLine className="w-3 h-3" /> Issue OUT
            </Link>
            <button onClick={load} disabled={loading} className="px-2 py-1 bg-slate-700 text-white text-[11px] font-medium hover:bg-slate-600 disabled:opacity-50 inline-flex items-center gap-1">
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            </button>
          </div>
        </div>

        {/* KPI strip */}
        <div className="bg-white border-x border-b border-slate-300 -mx-3 md:-mx-6 grid grid-cols-2 md:grid-cols-5 gap-0">
          <div className="px-4 py-3 border-r border-slate-200 border-l-4 border-l-slate-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active items</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{stats.total}</div>
          </div>
          <div className="px-4 py-3 border-r border-slate-200 border-l-4 border-l-emerald-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Stock value</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtCurrency(stats.value)}</div>
          </div>
          <div className="px-4 py-3 border-r border-slate-200 border-l-4 border-l-rose-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Below reorder</div>
            <div className="text-xl font-bold text-rose-700 mt-1 font-mono tabular-nums">{stats.low}</div>
          </div>
          <div className="px-4 py-3 border-r border-slate-200 border-l-4 border-l-blue-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Recent IN (30d)</div>
            <div className="text-xl font-bold text-emerald-700 mt-1 font-mono tabular-nums">{fmtQty(stats.recentIn)}</div>
          </div>
          <div className="px-4 py-3 border-l-4 border-l-orange-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Recent OUT (30d)</div>
            <div className="text-xl font-bold text-orange-700 mt-1 font-mono tabular-nums">{fmtQty(stats.recentOut)}</div>
          </div>
        </div>

        {/* Subcategory tabs */}
        <div className="bg-white border-x border-b border-slate-300 -mx-3 md:-mx-6 flex items-stretch overflow-x-auto">
          {subcategories.map(s => {
            const count = s === 'ALL'
              ? items.length
              : s === 'UNCATEGORIZED'
                ? items.filter(i => !i.subCategory).length
                : items.filter(i => i.subCategory === s).length;
            if (s !== 'ALL' && count === 0) return null;
            return (
              <button
                key={s}
                onClick={() => setSubFilter(s)}
                className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest border-r border-slate-200 whitespace-nowrap ${
                  subFilter === s ? 'bg-slate-800 text-white border-b-2 border-b-blue-500' : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {s.replace('_', ' ')} <span className="text-slate-400 ml-1 font-mono">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Filter row */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-2 flex-wrap">
          {(['ALL', 'LOW', 'IN_STOCK', 'OUT'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStockFilter(s)}
              className={`text-[11px] font-bold uppercase tracking-widest px-2 py-0.5 border ${
                stockFilter === s ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {s === 'ALL' ? 'All' : s === 'LOW' ? `Low (${stats.low})` : s === 'IN_STOCK' ? 'In stock' : 'Out of stock'}
            </button>
          ))}
          <div className="relative ml-auto">
            <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search code or name…" className="pl-7 pr-3 py-1 border border-slate-300 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-64" />
          </div>
        </div>

        {/* Items table */}
        <div className="bg-white border-x border-b border-slate-300 -mx-3 md:-mx-6 overflow-x-auto">
          <table className="w-full text-xs min-w-[1100px]">
            <thead className="bg-slate-800 text-white">
              <tr>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Code</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Chemical</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Sub</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Current</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Min</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Unit</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Value</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Last move</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Ledger</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-10 text-slate-400">{loading ? 'Loading…' : 'No chemicals match the filter.'}</td></tr>
              ) : filtered.map(i => {
                const isLow = i.minStock > 0 && i.currentStock <= i.minStock;
                const isOut = i.currentStock === 0;
                const lastTxn = i.transactions[0];
                return (
                  <tr key={i.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-1.5 border-r border-slate-100 font-mono">{i.code}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100">
                      <div className="font-medium">{i.name}</div>
                      {i.location && <div className="text-[10px] text-slate-400">📍 {i.location}</div>}
                    </td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-slate-600">{i.subCategory || <span className="text-slate-400">—</span>}</td>
                    <td className={`px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums ${isOut ? 'text-rose-700 font-bold' : isLow ? 'text-amber-700 font-bold' : ''}`}>
                      {fmtQty(i.currentStock)}
                      {(isLow || isOut) && <AlertTriangle className="w-3 h-3 inline ml-1" />}
                    </td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums text-slate-500">{i.minStock > 0 ? fmtQty(i.minStock) : '—'}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-slate-600">{i.unit}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums text-slate-600">{fmtCurrency(i.currentStock * (i.costPerUnit || i.defaultRate || 0))}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-slate-600">
                      {lastTxn ? (
                        <span>
                          <span className={`font-bold ${lastTxn.type === 'IN' ? 'text-emerald-700' : lastTxn.type === 'OUT' ? 'text-orange-700' : 'text-slate-500'}`}>{lastTxn.type}</span>
                          {' '}{fmtQty(lastTxn.quantity)} · {ago(lastTxn.createdAt)} ago
                          {lastTxn.department && <span className="text-[10px] text-slate-500 ml-1">→ {lastTxn.department}</span>}
                        </span>
                      ) : <span className="text-slate-400">never</span>}
                    </td>
                    <td className="px-3 py-1.5">
                      <Link to={`/inventory/stock-ledger?itemId=${i.id}`} className="text-blue-600 hover:underline inline-flex items-center gap-1">
                        Ledger <ChevronRight className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Recent movements feed */}
        <div className="bg-white border-x border-b border-slate-300 -mx-3 md:-mx-6 mt-3 md:mt-4">
          <div className="bg-slate-100 border-b border-slate-300 px-4 py-2 flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-700">Recent movements</span>
            <span className="text-[10px] text-slate-400">latest 25 across all chemicals</span>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-3 py-1.5 font-medium text-[10px] uppercase tracking-widest text-slate-500">When</th>
                <th className="text-left px-3 py-1.5 font-medium text-[10px] uppercase tracking-widest text-slate-500">Type</th>
                <th className="text-left px-3 py-1.5 font-medium text-[10px] uppercase tracking-widest text-slate-500">Chemical</th>
                <th className="text-right px-3 py-1.5 font-medium text-[10px] uppercase tracking-widest text-slate-500">Qty</th>
                <th className="text-left px-3 py-1.5 font-medium text-[10px] uppercase tracking-widest text-slate-500">Reference</th>
                <th className="text-left px-3 py-1.5 font-medium text-[10px] uppercase tracking-widest text-slate-500">Where</th>
              </tr>
            </thead>
            <tbody>
              {recentMovements.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-6 text-slate-400">No recent movements.</td></tr>
              ) : recentMovements.map(t => (
                <tr key={t.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-1 text-slate-500">{ago(t.createdAt)} ago</td>
                  <td className="px-3 py-1">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 ${
                      t.type === 'IN' ? 'bg-emerald-100 text-emerald-700' :
                      t.type === 'OUT' ? 'bg-orange-100 text-orange-700' :
                      'bg-slate-100 text-slate-600'
                    }`}>{t.type}</span>
                  </td>
                  <td className="px-3 py-1">
                    <span className="font-mono text-slate-500">{t.itemCode}</span> · {t.itemName}
                  </td>
                  <td className="px-3 py-1 text-right font-mono tabular-nums">{fmtQty(t.quantity)} {t.unit}</td>
                  <td className="px-3 py-1 text-slate-600">{t.reference || <span className="text-slate-400">—</span>}</td>
                  <td className="px-3 py-1 text-slate-600">
                    {t.type === 'IN' && t.warehouse ? `→ ${t.warehouse}` :
                     t.type === 'OUT' && t.department ? `→ ${t.department}${t.issuedTo ? ` (${t.issuedTo})` : ''}` :
                     <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
