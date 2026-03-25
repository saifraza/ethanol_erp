import React, { useState, useEffect, useCallback } from 'react';
import { DollarSign, Printer } from 'lucide-react';
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
      <div className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <DollarSign className="w-7 h-7 text-emerald-600" />
          <h1 className="text-2xl font-bold text-gray-800">Stock Valuation</h1>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center text-gray-500">
          Loading valuation report...
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-3">
          <DollarSign className="w-7 h-7 text-emerald-600" />
          <h1 className="text-2xl font-bold text-gray-800">Stock Valuation</h1>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 border rounded-lg hover:bg-gray-50 text-sm"
        >
          <Printer className="w-4 h-4" />
          Print
        </button>
      </div>

      {/* Print Header */}
      <div className="hidden print:block text-center mb-4">
        <h1 className="text-xl font-bold">MSPIL — Stock Valuation Report</h1>
        <p className="text-sm text-gray-500">
          As on {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* Summary Card */}
      <div className="bg-gradient-to-r from-emerald-500 to-teal-600 rounded-xl p-6 text-white print:bg-white print:text-black print:border">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <p className="text-emerald-100 print:text-gray-500 text-sm">Total Stock Value</p>
            <p className="text-3xl font-bold mt-1">{formatCurrency(grandTotal)}</p>
          </div>
          <div>
            <p className="text-emerald-100 print:text-gray-500 text-sm">Total Items</p>
            <p className="text-3xl font-bold mt-1">{grandQtyItems}</p>
          </div>
          <div>
            <p className="text-emerald-100 print:text-gray-500 text-sm">Categories</p>
            <p className="text-3xl font-bold mt-1">{grouped.length}</p>
          </div>
        </div>
      </div>

      {/* Category Tables */}
      {items.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center text-gray-400">
          No stock data available
        </div>
      ) : (
        grouped.map((group) => (
          <div key={group.category} className="bg-white rounded-xl shadow-sm border overflow-hidden print:break-inside-avoid">
            <div className="px-6 py-3 bg-gray-50 border-b flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">{group.category}</h2>
              <div className="text-sm text-gray-500">
                {group.totalItems} items | {formatCurrency(group.totalValue)}
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-left text-xs uppercase tracking-wide">
                  <th className="px-4 py-2.5 font-medium">Item Code</th>
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Unit</th>
                  <th className="px-4 py-2.5 font-medium text-right">Qty</th>
                  <th className="px-4 py-2.5 font-medium text-right">Avg Cost</th>
                  <th className="px-4 py-2.5 font-medium text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {group.items.map((item) => (
                  <tr key={item.id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-xs text-gray-600">{item.code || '—'}</td>
                    <td className="px-4 py-2 font-medium">{item.name}</td>
                    <td className="px-4 py-2 text-gray-600">{item.unit}</td>
                    <td className="px-4 py-2 text-right">{formatNum(item.currentStock)}</td>
                    <td className="px-4 py-2 text-right text-gray-600">{formatCurrency(item.avgCost)}</td>
                    <td className="px-4 py-2 text-right font-semibold">{formatCurrency(item.totalValue)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-gray-50 font-semibold">
                  <td colSpan={5} className="px-4 py-2.5 text-right text-gray-600">
                    Category Total
                  </td>
                  <td className="px-4 py-2.5 text-right">{formatCurrency(group.totalValue)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ))
      )}

      {/* Grand Total */}
      {items.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="px-6 py-4 flex items-center justify-between bg-emerald-50">
            <span className="text-lg font-bold text-gray-800">Grand Total</span>
            <span className="text-lg font-bold text-emerald-700">{formatCurrency(grandTotal)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
