import React, { useState, useEffect, useCallback } from 'react';
import { Search, ChevronDown } from 'lucide-react';
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
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <h1 className="text-sm font-bold tracking-wide uppercase">STOCK LEDGER</h1>
        </div>

        {/* Filters */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Item Search Dropdown */}
            <div className="relative md:col-span-2">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Item *</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  className="w-full pl-9 pr-8 border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
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
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              </div>
              {showItemDropdown && filteredItems.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-slate-300 shadow-lg max-h-60 overflow-y-auto">
                  {filteredItems.slice(0, 50).map((item) => (
                    <button
                      key={item.id}
                      className="w-full text-left px-4 py-2 hover:bg-blue-50 text-xs border-b border-slate-100 last:border-0"
                      onClick={() => selectItem(item)}
                    >
                      <span className="font-medium text-slate-800">{item.code || '\u2014'}</span>
                      <span className="text-slate-500 ml-2">{item.name}</span>
                      <span className="text-slate-400 ml-2">({item.unit})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Warehouse Filter */}
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Warehouse</label>
              <select
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
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
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">From</label>
                <input
                  type="date"
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">To</label>
                <input
                  type="date"
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Ledger Table */}
        {!selectedItemId ? (
          <div className="text-center py-16 border-x border-b border-slate-300 -mx-3 md:-mx-6 bg-white">
            <div className="text-slate-300 text-sm">Select an item to view its stock ledger</div>
          </div>
        ) : loading ? (
          <div className="min-h-[200px] bg-white flex items-center justify-center border-x border-b border-slate-300 -mx-3 md:-mx-6">
            <div className="text-sm text-slate-400">Loading...</div>
          </div>
        ) : (
          <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 overflow-hidden">
            {selectedItem && (
              <div className="bg-slate-100 border-b border-slate-200 px-4 py-2 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-sm text-slate-800">
                    {selectedItem.code ? `${selectedItem.code} — ` : ''}
                    {selectedItem.name}
                  </span>
                  <span className="text-slate-500 text-xs">({selectedItem.unit})</span>
                  {selectedItem.category && (
                    <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-blue-200 bg-blue-50 text-blue-700">
                      {selectedItem.category}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{ledgerData.length} entries</span>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Date</th>
                    <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Movement #</th>
                    <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Type</th>
                    <th className="text-right px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">In Qty</th>
                    <th className="text-right px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Out Qty</th>
                    <th className="text-right px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Balance</th>
                    <th className="text-right px-3 py-2 font-medium text-[11px] uppercase tracking-wider border-r border-slate-700">Rate</th>
                    <th className="text-right px-3 py-2 font-medium text-[11px] uppercase tracking-wider">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerData.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-16">
                        <div className="text-slate-300 text-sm">No movements found for the selected filters</div>
                      </td>
                    </tr>
                  ) : (
                    ledgerData.map((row) => (
                      <tr key={row.id} className="border-b border-slate-100 hover:bg-blue-50/40 even:bg-slate-50/50">
                        <td className="px-3 py-1.5 text-slate-700 whitespace-nowrap border-r border-slate-100">{formatDate(row.date)}</td>
                        <td className="px-3 py-1.5 font-mono text-xs text-slate-600 border-r border-slate-100">
                          {row.movementNo}
                          {row.refNo && (
                            <span className="text-slate-400 ml-1">({row.refNo})</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 border-r border-slate-100">
                          <span
                            className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                              row.direction === 'IN'
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                : 'border-red-300 bg-red-50 text-red-700'
                            }`}
                          >
                            {MOVEMENT_LABELS[row.movementType] || row.movementType}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-right text-emerald-700 font-medium font-mono tabular-nums border-r border-slate-100">
                          {row.inQty > 0 ? formatNum(row.inQty) : ''}
                        </td>
                        <td className="px-3 py-1.5 text-right text-red-600 font-medium font-mono tabular-nums border-r border-slate-100">
                          {row.outQty > 0 ? formatNum(row.outQty) : ''}
                        </td>
                        <td className="px-3 py-1.5 text-right font-semibold text-slate-800 font-mono tabular-nums border-r border-slate-100">{formatNum(row.balance)}</td>
                        <td className="px-3 py-1.5 text-right text-slate-500 font-mono tabular-nums border-r border-slate-100">{formatNum(row.costRate)}</td>
                        <td className="px-3 py-1.5 text-right text-slate-500 font-mono tabular-nums">{formatNum(row.balanceValue)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {ledgerData.length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-800 text-white font-semibold">
                      <td colSpan={3} className="px-3 py-2 text-[11px] uppercase tracking-wider border-r border-slate-700">Closing Balance</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-700">
                        {formatNum(ledgerData.reduce((s, r) => s + r.inQty, 0))}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-700">
                        {formatNum(ledgerData.reduce((s, r) => s + r.outQty, 0))}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-700">
                        {formatNum(ledgerData[ledgerData.length - 1]?.balance ?? 0)}
                      </td>
                      <td className="px-3 py-2 border-r border-slate-700"></td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
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
    </div>
  );
}
