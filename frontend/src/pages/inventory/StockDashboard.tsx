import { useState, useEffect, useCallback } from 'react';
import {
  Package, IndianRupee, AlertTriangle, ClipboardList,
  ArrowUpRight, ArrowDownRight, RefreshCw, Loader2,
} from 'lucide-react';
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

      // items → { items: [...] }
      const itemList = items.items ?? [];
      // valuation → { byCategory: { CAT: { totalValue, itemCount, items } }, grandTotal, totalItems }
      const byCat = valuation.byCategory ?? {};
      const catArr = Object.entries(byCat).map(([category, data]: [string, any]) => ({
        category,
        totalValue: data.totalValue ?? 0,
        itemCount: data.itemCount ?? 0,
      }));
      // alerts → { alerts: [...], summary: { total, critical } }
      const alertList = alerts.alerts ?? (Array.isArray(alerts) ? alerts : []);
      // counts → { counts: [...], total }
      const countTotal = counts.total ?? (Array.isArray(counts.counts) ? counts.counts.length : 0);
      // movements → { movements: [...], total }
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

  const typeColor = (type: string) => {
    if (type.includes('RECEIPT')) return 'bg-green-100 text-green-700';
    if (type.includes('ISSUE')) return 'bg-red-100 text-red-700';
    if (type.includes('TRANSFER')) return 'bg-blue-100 text-blue-700';
    if (type.includes('ADJUST')) return 'bg-yellow-100 text-yellow-700';
    return 'bg-gray-100 text-gray-700';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Inventory Dashboard</h1>
        <button
          onClick={fetchDashboard}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-white border rounded-lg hover:bg-gray-50"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard icon={<Package className="w-6 h-6 text-blue-600" />} label="Total Items" value={String(kpis.totalItems)} bg="bg-blue-50" />
        <KPICard icon={<IndianRupee className="w-6 h-6 text-green-600" />} label="Total Value" value={formatCurrency(kpis.totalValue)} bg="bg-green-50" />
        <KPICard icon={<AlertTriangle className="w-6 h-6 text-orange-600" />} label="Low Stock Alerts" value={String(kpis.lowStockAlerts)} bg="bg-orange-50" />
        <KPICard icon={<ClipboardList className="w-6 h-6 text-purple-600" />} label="Pending Counts" value={String(kpis.pendingCounts)} bg="bg-purple-50" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category-wise Value */}
        <div className="bg-white rounded-xl shadow-sm border p-5">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Category-wise Value</h2>
          {categoryValues.length === 0 ? (
            <p className="text-gray-400 text-sm">No valuation data available</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2">Category</th>
                  <th className="pb-2 text-right">Items</th>
                  <th className="pb-2 text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {categoryValues.map((cv) => (
                  <tr key={cv.category} className="border-b last:border-0">
                    <td className="py-2 font-medium">{cv.category.replace(/_/g, ' ')}</td>
                    <td className="py-2 text-right">{cv.itemCount}</td>
                    <td className="py-2 text-right font-medium">{formatCurrency(cv.totalValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Low Stock Alerts */}
        <div className="bg-white rounded-xl shadow-sm border p-5">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Low Stock Alerts</h2>
          {lowStockAlerts.length === 0 ? (
            <p className="text-gray-400 text-sm">All items are above reorder level</p>
          ) : (
            <div className="space-y-3 max-h-72 overflow-y-auto">
              {lowStockAlerts.map((a) => (
                <div key={a.id} className={`flex items-center justify-between p-3 rounded-lg ${a.isCritical ? 'bg-red-50' : 'bg-orange-50'}`}>
                  <div>
                    <p className="font-medium text-gray-800">{a.item?.name ?? 'Unknown'}</p>
                    <p className="text-xs text-gray-500">{a.item?.code ?? ''}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-semibold ${a.isCritical ? 'text-red-700' : 'text-orange-700'}`}>
                      {a.item?.currentStock ?? 0} / {a.reorderPoint} {a.item?.unit ?? ''}
                    </p>
                    <p className="text-xs text-gray-500">Current / Reorder</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Movements */}
      <div className="bg-white rounded-xl shadow-sm border p-5">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Recent Movements</h2>
        {recentMovements.length === 0 ? (
          <p className="text-gray-400 text-sm">No recent movements</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2">#</th>
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Item</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2 text-right">Qty</th>
                  <th className="pb-2 text-right">Value</th>
                  <th className="pb-2">Warehouse</th>
                </tr>
              </thead>
              <tbody>
                {recentMovements.map((m) => (
                  <tr key={m.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-2 text-gray-500">{m.movementNo}</td>
                    <td className="py-2">{formatDate(m.date)}</td>
                    <td className="py-2 font-medium">{m.item?.name ?? '-'}</td>
                    <td className="py-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${typeColor(m.movementType)}`}>
                        {m.direction === 'IN' ? <ArrowDownRight className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                        {m.movementType.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="py-2 text-right">{m.quantity}</td>
                    <td className="py-2 text-right">{formatCurrency(m.totalValue ?? m.quantity * (m.costRate ?? 0))}</td>
                    <td className="py-2 text-gray-500">{m.warehouse?.name ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function KPICard({ icon, label, value, bg }: { icon: React.ReactNode; label: string; value: string; bg: string }) {
  return (
    <div className={`${bg} rounded-xl p-5 flex items-center gap-4`}>
      <div className="p-3 bg-white rounded-lg shadow-sm">{icon}</div>
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <p className="text-xl font-bold text-gray-800">{value}</p>
      </div>
    </div>
  );
}
