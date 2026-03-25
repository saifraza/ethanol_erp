import { useState, useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import api from '../../services/api';

interface KPIs {
  totalItems: number;
  totalValue: number;
  lowStockAlerts: number;
  pendingCounts: number;
}

interface CategoryValue {
  category: string;
  itemCount: number;
  totalValue: number;
}

interface Movement {
  id: string;
  movementNo: number;
  date: string;
  movementType: string;
  direction: string;
  quantity: number;
  costRate: number;
  totalValue: number;
  item: { name: string; code: string };
  warehouse: { name: string; code: string };
}

interface LowStockAlert {
  id: string;
  itemId: string;
  reorderPoint: number;
  shortfall: number;
  isCritical: boolean;
  item: { name: string; code: string; currentStock: number; unit: string; avgCost: number };
}

export default function StockDashboard() {
  const [kpis, setKpis] = useState<KPIs>({ totalItems: 0, totalValue: 0, lowStockAlerts: 0, pendingCounts: 0 });
  const [categoryValues, setCategoryValues] = useState<CategoryValue[]>([]);
  const [recentMovements, setRecentMovements] = useState<Movement[]>([]);
  const [lowStockAlerts, setLowStockAlerts] = useState<LowStockAlert[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true);
      const [itemsRes, valuationRes, alertsRes, countsRes, movementsRes] = await Promise.all([
        api.get('/inventory/items', { params: { limit: 1 } }),
        api.get('/inventory/stock/valuation'),
        api.get('/inventory/reorder/alerts'),
        api.get('/inventory/counts', { params: { status: 'DRAFT', limit: 1 } }),
        api.get('/inventory/movements', { params: { limit: 10 } }),
      ]);

      const items = itemsRes.data;
      const valuation = valuationRes.data;
      const alerts = alertsRes.data;
      const counts = countsRes.data;
      const movements = movementsRes.data;

      const itemList = items.items ?? [];
      const byCat = valuation.byCategory ?? {};
      const catArr = Object.entries(byCat).map(([category, data]: [string, any]) => ({
        category,
        totalValue: data.totalValue ?? 0,
        itemCount: data.itemCount ?? 0,
      }));
      const alertList = alerts.alerts ?? (Array.isArray(alerts) ? alerts : []);
      const countTotal = counts.total ?? (Array.isArray(counts.counts) ? counts.counts.length : 0);
      const movList = movements.movements ?? (Array.isArray(movements) ? movements : []);

      setKpis({
        totalItems: valuation.totalItems ?? itemList.length ?? 0,
        totalValue: valuation.grandTotal ?? 0,
        lowStockAlerts: alerts.summary?.total ?? alertList.length ?? 0,
        pendingCounts: countTotal,
      });

      setCategoryValues(catArr);
      setRecentMovements(movList);
      setLowStockAlerts(alertList.slice(0, 10));
    } catch (err) {
      // Dashboard is best-effort; individual sections may fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v);

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const typeBadge = (type: string) => {
    if (type.includes('RECEIPT')) return 'border-emerald-300 bg-emerald-50 text-emerald-700';
    if (type.includes('ISSUE')) return 'border-red-300 bg-red-50 text-red-700';
    if (type.includes('TRANSFER')) return 'border-blue-300 bg-blue-50 text-blue-700';
    if (type.includes('ADJUST')) return 'border-amber-300 bg-amber-50 text-amber-700';
    return 'border-slate-300 bg-slate-50 text-slate-700';
  };

  if (loading) {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><div className="text-sm text-slate-400">Loading...</div></div>;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <h1 className="text-sm font-bold tracking-wide uppercase">INVENTORY DASHBOARD</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchDashboard}
              className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="bg-white border-b border-r border-slate-200 px-4 py-3 border-l-4 border-l-blue-500">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Total Items</div>
            <div className="text-xl font-bold text-slate-800 font-mono tabular-nums">{kpis.totalItems}</div>
          </div>
          <div className="bg-white border-b border-r border-slate-200 px-4 py-3 border-l-4 border-l-emerald-500">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Total Value</div>
            <div className="text-xl font-bold text-slate-800 font-mono tabular-nums">{formatCurrency(kpis.totalValue)}</div>
          </div>
          <div className="bg-white border-b border-r border-slate-200 px-4 py-3 border-l-4 border-l-amber-500">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Low Stock Alerts</div>
            <div className="text-xl font-bold text-slate-800 font-mono tabular-nums">{kpis.lowStockAlerts}</div>
          </div>
          <div className="bg-white border-b border-r border-slate-200 px-4 py-3 border-l-4 border-l-slate-500">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Pending Counts</div>
            <div className="text-xl font-bold text-slate-800 font-mono tabular-nums">{kpis.pendingCounts}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 -mx-3 md:-mx-6">
          {/* Category-wise Value */}
          <div className="border-x border-b border-slate-300 overflow-hidden">
            <div className="bg-slate-800 text-white px-4 py-2">
              <h2 className="text-xs font-bold uppercase tracking-wide">Category-wise Value</h2>
            </div>
            <div className="bg-white">
              {categoryValues.length === 0 ? (
                <div className="text-center py-16"><div className="text-slate-300 text-sm">No valuation data available</div></div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-800 text-white">
                      <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Category</th>
                      <th className="text-right px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Items</th>
                      <th className="text-right px-3 py-2 font-medium text-[11px] uppercase tracking-wider">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categoryValues.map((cv) => (
                      <tr key={cv.category} className="border-b border-slate-100 hover:bg-blue-50/40">
                        <td className="px-3 py-1.5 font-medium text-slate-700 border-r border-slate-100">{cv.category.replace(/_/g, ' ')}</td>
                        <td className="px-3 py-1.5 text-right text-slate-600 font-mono tabular-nums border-r border-slate-100">{cv.itemCount}</td>
                        <td className="px-3 py-1.5 text-right font-medium text-slate-800 font-mono tabular-nums">{formatCurrency(cv.totalValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-800 text-white font-semibold">
                      <td className="px-3 py-2 border-r border-slate-700">Total</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-700">{categoryValues.reduce((s, c) => s + c.itemCount, 0)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{formatCurrency(categoryValues.reduce((s, c) => s + c.totalValue, 0))}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>

          {/* Low Stock Alerts */}
          <div className="border-x border-b border-slate-300 overflow-hidden lg:border-l-0">
            <div className="bg-slate-800 text-white px-4 py-2">
              <h2 className="text-xs font-bold uppercase tracking-wide">Low Stock Alerts</h2>
            </div>
            <div className="bg-white">
              {lowStockAlerts.length === 0 ? (
                <div className="text-center py-16"><div className="text-slate-300 text-sm">All items above reorder level</div></div>
              ) : (
                <div className="max-h-72 overflow-y-auto">
                  {lowStockAlerts.map((a) => (
                    <div key={a.id} className={`border-b border-slate-200 px-4 py-3 border-l-4 flex items-center justify-between ${a.isCritical ? 'border-l-red-500 bg-red-50/30' : 'border-l-amber-500'}`}>
                      <div>
                        <p className="font-medium text-slate-800 text-sm">{a.item?.name ?? 'Unknown'}</p>
                        <p className="text-[11px] text-slate-400 font-mono">{a.item?.code ?? ''}</p>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-bold font-mono tabular-nums ${a.isCritical ? 'text-red-700' : 'text-amber-700'}`}>
                          {a.item?.currentStock ?? 0} / {a.reorderPoint} <span className="text-xs font-normal text-slate-400">{a.item?.unit ?? ''}</span>
                        </p>
                        <p className="text-[11px] text-slate-400">Current / Reorder</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Recent Movements */}
        <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 overflow-hidden">
          <div className="bg-slate-800 text-white px-4 py-2">
            <h2 className="text-xs font-bold uppercase tracking-wide">Recent Movements</h2>
          </div>
          {recentMovements.length === 0 ? (
            <div className="text-center py-16 bg-white"><div className="text-slate-300 text-sm">No recent movements</div></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">#</th>
                    <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Date</th>
                    <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Item</th>
                    <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Type</th>
                    <th className="text-right px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Qty</th>
                    <th className="text-right px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Value</th>
                    <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider">Warehouse</th>
                  </tr>
                </thead>
                <tbody>
                  {recentMovements.map((m) => (
                    <tr key={m.id} className="border-b border-slate-100 hover:bg-blue-50/40 even:bg-slate-50/50">
                      <td className="px-3 py-1.5 text-slate-400 font-mono border-r border-slate-100">{m.movementNo}</td>
                      <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{formatDate(m.date)}</td>
                      <td className="px-3 py-1.5 font-medium text-slate-800 border-r border-slate-100">{m.item?.name ?? '-'}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${typeBadge(m.movementType)}`}>
                          {m.movementType.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{m.quantity}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{formatCurrency(m.totalValue ?? m.quantity * (m.costRate ?? 0))}</td>
                      <td className="px-3 py-1.5 text-slate-500">{m.warehouse?.name ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
