import React, { useState, useEffect, useCallback } from 'react';
import { BookOpen, Search, Filter, Download, ChevronDown } from 'lucide-react';
import api from '../../services/api';

interface InventoryItem {
  id: string;
  name: string;
  code?: string;
  unit: string;
  category?: string;
}

interface Warehouse {
  id: string;
  code: string;
  name: string;
}

interface LedgerEntry {
  id: string;
  movementNo: number;
  date: string;
  movementType: string;
  direction: string;
  quantity: number;
  unit: string;
  costRate: number;
  totalValue: number;
  narration?: string;
  refType?: string;
  refNo?: string;
  warehouseId: string;
  warehouse?: { code: string; name: string };
}

interface LedgerRow extends LedgerEntry {
  inQty: number;
  outQty: number;
  balance: number;
  balanceValue: number;
}

const MOVEMENT_LABELS: Record<string, string> = {
  GRN_RECEIPT: 'GRN Receipt',
  PRODUCTION_ISSUE: 'Production Issue',
  PRODUCTION_RECEIPT: 'Production Receipt',
  SALES_ISSUE: 'Sales Issue',
  TRANSFER: 'Transfer',
  ADJUSTMENT: 'Adjustment',
  RETURN: 'Return',
  SCRAP: 'Scrap',
};

export default function StockLedger() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [ledgerData, setLedgerData] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [showItemDropdown, setShowItemDropdown] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);

  useEffect(() => {
    const loadMasters = async () => {
      try {
        const [itemsRes, whRes] = await Promise.all([
          api.get('/inventory/items', { params: { limit: 500 } }),
          api.get('/inventory/warehouses'),
        ]);
        setItems(itemsRes.data.items || itemsRes.data || []);
        setWarehouses(whRes.data.warehouses || whRes.data || []);
      } catch {
        // silent — dropdowns will be empty
      }
    };
    loadMasters();
  }, []);

  const fetchLedger = useCallback(async () => {
    if (!selectedItemId) return;
    try {
      setLoading(true);
      const params: Record<string, string> = {};
      if (dateFrom) params.from = dateFrom;
      if (dateTo) params.to = dateTo;
      if (selectedWarehouseId) params.warehouseId = selectedWarehouseId;

      const res = await api.get(`/inventory/movements/ledger/${selectedItemId}`, { params });
      const entries: LedgerEntry[] = res.data.ledger || res.data || [];

      // Calculate running balance on frontend
      let balance = 0;
      let balanceValue = 0;
      const rows: LedgerRow[] = entries.map((e) => {
        const inQty = e.direction === 'IN' ? e.quantity : 0;
        const outQty = e.direction === 'OUT' ? e.quantity : 0;
        balance += inQty - outQty;
        balanceValue = balance * e.costRate;
        return { ...e, inQty, outQty, balance, balanceValue };
      });
      setLedgerData(rows);
    } catch {
      setLedgerData([]);
    } finally {
      setLoading(false);
    }
  }, [selectedItemId, dateFrom, dateTo, selectedWarehouseId]);

  useEffect(() => {
    if (selectedItemId) fetchLedger();
  }, [selectedItemId, fetchLedger]);

  const filteredItems = items.filter(
    (i) =>
      i.name.toLowerCase().includes(itemSearch.toLowerCase()) ||
      (i.code && i.code.toLowerCase().includes(itemSearch.toLowerCase()))
  );

  const selectItem = (item: InventoryItem) => {
    setSelectedItemId(item.id);
    setSelectedItem(item);
    setItemSearch(item.code ? `${item.code} — ${item.name}` : item.name);
    setShowItemDropdown(false);
  };

  const formatDate = (d: string) => {
    const dt = new Date(d);
    return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const formatNum = (n: number, decimals = 2) =>
    n.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BookOpen className="w-7 h-7 text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-800">Stock Ledger</h1>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Item Search Dropdown */}
          <div className="relative md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Item *</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                className="w-full pl-9 pr-8 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Search item by code or name..."
                value={itemSearch}
                onChange={(e) => {
                  setItemSearch(e.target.value);
                  setShowItemDropdown(true);
                  if (!e.target.value) {
                    setSelectedItemId('');
                    setSelectedItem(null);
                  }
                }}
                onFocus={() => setShowItemDropdown(true)}
              />
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            </div>
            {showItemDropdown && filteredItems.length > 0 && (
              <div className="absolute z-20 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {filteredItems.slice(0, 50).map((item) => (
                  <button
                    key={item.id}
                    className="w-full text-left px-4 py-2 hover:bg-blue-50 text-sm border-b last:border-0"
                    onClick={() => selectItem(item)}
                  >
                    <span className="font-medium">{item.code || '—'}</span>
                    <span className="text-gray-500 ml-2">{item.name}</span>
                    <span className="text-gray-400 ml-2">({item.unit})</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Warehouse Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Warehouse</label>
            <select
              className="w-full py-2 px-3 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              value={selectedWarehouseId}
              onChange={(e) => setSelectedWarehouseId(e.target.value)}
            >
              <option value="">All Warehouses</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </select>
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From</label>
              <input
                type="date"
                className="w-full py-2 px-3 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
              <input
                type="date"
                className="w-full py-2 px-3 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Ledger Table */}
      {!selectedItemId ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center text-gray-400">
          <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-lg">Select an item to view its stock ledger</p>
        </div>
      ) : loading ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center text-gray-500">
          Loading ledger...
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          {selectedItem && (
            <div className="px-6 py-3 bg-gray-50 border-b flex items-center justify-between">
              <div>
                <span className="font-semibold text-gray-800">
                  {selectedItem.code ? `${selectedItem.code} — ` : ''}
                  {selectedItem.name}
                </span>
                <span className="text-gray-500 ml-2">({selectedItem.unit})</span>
                {selectedItem.category && (
                  <span className="ml-3 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                    {selectedItem.category}
                  </span>
                )}
              </div>
              <span className="text-sm text-gray-500">{ledgerData.length} entries</span>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-600 text-left">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Movement #</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium text-right">In Qty</th>
                  <th className="px-4 py-3 font-medium text-right">Out Qty</th>
                  <th className="px-4 py-3 font-medium text-right">Balance</th>
                  <th className="px-4 py-3 font-medium text-right">Rate</th>
                  <th className="px-4 py-3 font-medium text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {ledgerData.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                      No movements found for the selected filters
                    </td>
                  </tr>
                ) : (
                  ledgerData.map((row) => (
                    <tr key={row.id} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(row.date)}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">
                        {row.movementNo}
                        {row.refNo && (
                          <span className="text-gray-400 ml-1">({row.refNo})</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                            row.direction === 'IN'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {MOVEMENT_LABELS[row.movementType] || row.movementType}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-green-600 font-medium">
                        {row.inQty > 0 ? formatNum(row.inQty) : ''}
                      </td>
                      <td className="px-4 py-2.5 text-right text-red-600 font-medium">
                        {row.outQty > 0 ? formatNum(row.outQty) : ''}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold">{formatNum(row.balance)}</td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{formatNum(row.costRate)}</td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{formatNum(row.balanceValue)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {ledgerData.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 bg-gray-50 font-semibold">
                    <td colSpan={3} className="px-4 py-3">Closing Balance</td>
                    <td className="px-4 py-3 text-right text-green-600">
                      {formatNum(ledgerData.reduce((s, r) => s + r.inQty, 0))}
                    </td>
                    <td className="px-4 py-3 text-right text-red-600">
                      {formatNum(ledgerData.reduce((s, r) => s + r.outQty, 0))}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {formatNum(ledgerData[ledgerData.length - 1]?.balance ?? 0)}
                    </td>
                    <td className="px-4 py-3"></td>
                    <td className="px-4 py-3 text-right">
                      {formatNum(ledgerData[ledgerData.length - 1]?.balanceValue ?? 0)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
