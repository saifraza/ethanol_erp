import React, { useState, useEffect, useCallback } from 'react';
import { Printer } from 'lucide-react';
import api from '../../services/api';

interface ValuationItem {
  id: string;
  code?: string;
  name: string;
  unit: string;
  category?: string;
  currentStock: number;
  avgCost: number;
  totalValue: number;
}

interface CategoryGroup {
  category: string;
  items: ValuationItem[];
  totalValue: number;
  totalItems: number;
}

export default function StockValuation() {
  const [items, setItems] = useState<ValuationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchValuation = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/inventory/stock/valuation');
      const data = res.data;
      // Backend returns { byCategory: { [cat]: { items } }, grandTotal, totalItems }
      if (data.byCategory) {
        const allItems: ValuationItem[] = [];
        for (const cat of Object.keys(data.byCategory)) {
          for (const item of data.byCategory[cat].items) {
            allItems.push({ ...item, category: cat });
          }
        }
        setItems(allItems);
      } else if (Array.isArray(data.items)) {
        setItems(data.items);
      } else if (Array.isArray(data)) {
        setItems(data);
      } else {
        setItems([]);
      }
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchValuation();
  }, [fetchValuation]);

  // Group by category
  const grouped: CategoryGroup[] = [];
  const categoryMap = new Map<string, ValuationItem[]>();

  items.forEach((item) => {
    const cat = item.category || 'Uncategorized';
    if (!categoryMap.has(cat)) categoryMap.set(cat, []);
    categoryMap.get(cat)!.push(item);
  });

  categoryMap.forEach((catItems, category) => {
    grouped.push({
      category,
      items: catItems.sort((a, b) => b.totalValue - a.totalValue),
      totalValue: catItems.reduce((s, i) => s + i.totalValue, 0),
      totalItems: catItems.length,
    });
  });

  grouped.sort((a, b) => b.totalValue - a.totalValue);

  const grandTotal = items.reduce((s, i) => s + i.totalValue, 0);
  const grandQtyItems = items.length;

  const formatCurrency = (n: number) =>
    n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });

  const formatNum = (n: number) =>
    n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-sm text-slate-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between print:hidden">
          <h1 className="text-sm font-bold tracking-wide uppercase">STOCK VALUATION</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700"
            >
              <Printer className="w-3.5 h-3.5" />
              Print
            </button>
          </div>
        </div>

        {/* Print Header */}
        <div className="hidden print:block text-center mb-4">
          <h1 className="text-lg font-bold">MSPIL - Stock Valuation Report</h1>
          <p className="text-[11px] text-slate-500">
            As on {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}
          </p>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6 print:grid-cols-3">
          <div className="bg-white border-b border-r border-slate-200 px-4 py-3 border-l-4 border-l-emerald-500">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Total Stock Value</div>
            <div className="text-xl font-bold text-slate-800 font-mono tabular-nums">{formatCurrency(grandTotal)}</div>
          </div>
          <div className="bg-white border-b border-r border-slate-200 px-4 py-3 border-l-4 border-l-blue-500">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Total Items</div>
            <div className="text-xl font-bold text-slate-800 font-mono tabular-nums">{grandQtyItems}</div>
          </div>
          <div className="bg-white border-b border-r border-slate-200 px-4 py-3 border-l-4 border-l-slate-500">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Categories</div>
            <div className="text-xl font-bold text-slate-800 font-mono tabular-nums">{grouped.length}</div>
          </div>
        </div>

        {/* Category Tables */}
        {items.length === 0 ? (
          <div className="text-center py-16 bg-white border-x border-b border-slate-300 -mx-3 md:-mx-6">
            <div className="text-slate-300 text-sm">No stock data available</div>
          </div>
        ) : (
          grouped.map((group) => (
            <div key={group.category} className="border-x border-b border-slate-300 -mx-3 md:-mx-6 overflow-hidden print:break-inside-avoid">
              {/* Category Header */}
              <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between">
                <h2 className="text-xs font-bold uppercase tracking-wide">{group.category}</h2>
                <span className="text-[11px] text-slate-300">
                  {group.totalItems} items | {formatCurrency(group.totalValue)}
                </span>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Item Code</th>
                    <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Name</th>
                    <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Unit</th>
                    <th className="text-right px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Qty</th>
                    <th className="text-right px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Avg Cost</th>
                    <th className="text-right px-3 py-2 font-medium text-[11px] uppercase tracking-wider">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((item) => (
                    <tr key={item.id} className="border-b border-slate-100 hover:bg-blue-50/40 even:bg-slate-50/50">
                      <td className="px-3 py-1.5 font-mono text-xs text-slate-500 border-r border-slate-100">{item.code || '--'}</td>
                      <td className="px-3 py-1.5 text-slate-700 font-medium border-r border-slate-100">{item.name}</td>
                      <td className="px-3 py-1.5 text-slate-500 border-r border-slate-100">{item.unit}</td>
                      <td className="px-3 py-1.5 text-right text-slate-700 font-mono tabular-nums border-r border-slate-100">{formatNum(item.currentStock)}</td>
                      <td className="px-3 py-1.5 text-right text-slate-500 font-mono tabular-nums border-r border-slate-100">{formatCurrency(item.avgCost)}</td>
                      <td className="px-3 py-1.5 text-right text-slate-800 font-semibold font-mono tabular-nums">{formatCurrency(item.totalValue)}</td>
                    </tr>
                  ))}
                </tbody>
                {/* Category Footer */}
                <tfoot>
                  <tr className="bg-slate-800 text-white font-semibold">
                    <td colSpan={5} className="px-3 py-2 text-xs border-r border-slate-700">Category Total</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{formatCurrency(group.totalValue)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ))
        )}

        {/* Grand Total */}
        {items.length > 0 && (
          <div className="bg-slate-800 text-white px-6 py-4 flex items-center justify-between -mx-3 md:-mx-6 border-x border-b border-slate-300">
            <span className="text-sm font-bold uppercase tracking-wider">Grand Total</span>
            <span className="text-xl font-bold font-mono tabular-nums">{formatCurrency(grandTotal)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
