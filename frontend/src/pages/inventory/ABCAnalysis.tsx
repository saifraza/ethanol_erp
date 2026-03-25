import React, { useState, useEffect, useCallback } from 'react';
import { BarChart3 } from 'lucide-react';
import api from '../../services/api';

interface ABCItem {
  id: string;
  code?: string;
  name: string;
  category?: string;
  unit: string;
  stockValue: number;
  cumulativePct: number;
  abcClass: 'A' | 'B' | 'C';
}

interface ABCData {
  items: ABCItem[];
  summary?: {
    A: { count: number; value: number };
    B: { count: number; value: number };
    C: { count: number; value: number };
  };
}

const CLASS_CONFIG: Record<string, { label: string; bg: string; headerBg: string; text: string; badge: string; border: string; description: string }> = {
  A: {
    label: 'A Items',
    bg: 'bg-green-50',
    headerBg: 'bg-green-600',
    text: 'text-green-700',
    badge: 'bg-green-100 text-green-800',
    border: 'border-green-200',
    description: 'Top 80% of stock value — tightest control, frequent cycle counts',
  },
  B: {
    label: 'B Items',
    bg: 'bg-yellow-50',
    headerBg: 'bg-yellow-500',
    text: 'text-yellow-700',
    badge: 'bg-yellow-100 text-yellow-800',
    border: 'border-yellow-200',
    description: 'Next 15% of stock value — moderate control, periodic review',
  },
  C: {
    label: 'C Items',
    bg: 'bg-red-50',
    headerBg: 'bg-red-500',
    text: 'text-red-700',
    badge: 'bg-red-100 text-red-800',
    border: 'border-red-200',
    description: 'Bottom 5% of stock value — simple controls, bulk ordering',
  },
};

export default function ABCAnalysis() {
  const [data, setData] = useState<ABCData>({ items: [] });
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/inventory/stock/abc-analysis');
      setData(res.data);
    } catch {
      setData({ items: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const aItems = data.items.filter((i) => i.abcClass === 'A');
  const bItems = data.items.filter((i) => i.abcClass === 'B');
  const cItems = data.items.filter((i) => i.abcClass === 'C');

  const summaryA = data.summary?.A || {
    count: aItems.length,
    value: aItems.reduce((s, i) => s + i.stockValue, 0),
  };
  const summaryB = data.summary?.B || {
    count: bItems.length,
    value: bItems.reduce((s, i) => s + i.stockValue, 0),
  };
  const summaryC = data.summary?.C || {
    count: cItems.length,
    value: cItems.reduce((s, i) => s + i.stockValue, 0),
  };

  const totalValue = summaryA.value + summaryB.value + summaryC.value;

  const formatCurrency = (n: number) =>
    n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

  const formatNum = (n: number) =>
    n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <BarChart3 className="w-7 h-7 text-indigo-600" />
          <h1 className="text-2xl font-bold text-gray-800">ABC Analysis</h1>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center text-gray-500">
          Loading ABC analysis...
        </div>
      </div>
    );
  }

  if (data.items.length === 0) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <BarChart3 className="w-7 h-7 text-indigo-600" />
          <h1 className="text-2xl font-bold text-gray-800">ABC Analysis</h1>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center text-gray-400">
          <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-lg">No stock data for ABC classification</p>
        </div>
      </div>
    );
  }

  const renderClassSection = (
    cls: 'A' | 'B' | 'C',
    classItems: ABCItem[],
    summary: { count: number; value: number }
  ) => {
    const config = CLASS_CONFIG[cls];
    return (
      <div key={cls} className={`bg-white rounded-xl shadow-sm border ${config.border} overflow-hidden`}>
        <div className={`${config.headerBg} px-6 py-4 text-white`}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold">{config.label}</h2>
              <p className="text-sm opacity-90 mt-0.5">{config.description}</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold">{summary.count}</p>
              <p className="text-sm opacity-90">items</p>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={`${config.bg} text-gray-600 text-left text-xs uppercase tracking-wide`}>
                <th className="px-4 py-2.5 font-medium">Code</th>
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Category</th>
                <th className="px-4 py-2.5 font-medium text-right">Stock Value</th>
                <th className="px-4 py-2.5 font-medium text-right">Cumulative %</th>
                <th className="px-4 py-2.5 font-medium text-center">Class</th>
              </tr>
            </thead>
            <tbody>
              {classItems.map((item) => (
                <tr key={item.id} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs text-gray-600">{item.code || '—'}</td>
                  <td className="px-4 py-2 font-medium">{item.name}</td>
                  <td className="px-4 py-2 text-gray-600">{item.category || '—'}</td>
                  <td className="px-4 py-2 text-right font-semibold">{formatCurrency(item.stockValue)}</td>
                  <td className="px-4 py-2 text-right text-gray-600">{formatNum(item.cumulativePct)}%</td>
                  <td className="px-4 py-2 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${config.badge}`}>
                      {cls}
                    </span>
                  </td>
                </tr>
              ))}
              {classItems.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                    No items in this class
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <BarChart3 className="w-7 h-7 text-indigo-600" />
        <h1 className="text-2xl font-bold text-gray-800">ABC Analysis</h1>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <p className="text-sm text-gray-500">Total Value</p>
          <p className="text-xl font-bold text-gray-800 mt-1">{formatCurrency(totalValue)}</p>
          <p className="text-xs text-gray-400 mt-1">{data.items.length} items</p>
        </div>
        {(['A', 'B', 'C'] as const).map((cls) => {
          const config = CLASS_CONFIG[cls];
          const summary = cls === 'A' ? summaryA : cls === 'B' ? summaryB : summaryC;
          const pct = totalValue > 0 ? ((summary.value / totalValue) * 100).toFixed(1) : '0';
          return (
            <div key={cls} className={`rounded-xl shadow-sm border p-4 ${config.bg} ${config.border}`}>
              <div className="flex items-center justify-between">
                <p className={`text-sm font-medium ${config.text}`}>{config.label}</p>
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${config.badge}`}>
                  {cls}
                </span>
              </div>
              <p className="text-xl font-bold text-gray-800 mt-1">{formatCurrency(summary.value)}</p>
              <p className="text-xs text-gray-500 mt-1">
                {summary.count} items ({pct}% of value)
              </p>
            </div>
          );
        })}
      </div>

      {/* Class Sections */}
      {renderClassSection('A', aItems, summaryA)}
      {renderClassSection('B', bItems, summaryB)}
      {renderClassSection('C', cItems, summaryC)}
    </div>
  );
}
