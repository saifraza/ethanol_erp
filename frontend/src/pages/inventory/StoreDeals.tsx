import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../services/api';

interface StoreLine {
  id: string;
  description: string;
  category: string | null;
  unit: string;
  rate: number;
  quantity: number;
  gstPercent: number;
  baseValue: number;
  gstValue: number;
  totalValue: number;
  receivedQty: number;
  pendingQty: number;
}

interface StoreDeal {
  id: string;
  poNo: number;
  poDate: string;
  deliveryDate: string | null;
  status: string;
  dealType: string;
  vendor: { id: string; name: string; phone: string | null };
  remarks: string | null;
  grandTotal: number | null;
  lineCount: number;
  orderedQty: number;
  receivedQty: number;
  pendingQty: number;
  orderedValue: number;     // base (taxable)
  receivedValue: number;
  orderedGst: number;
  receivedGst: number;
  orderedTotal: number;     // base + GST (final)
  receivedTotal: number;
  grnCount: number;
  lines: StoreLine[];
}

interface Summary {
  openCount: number;
  partialCount: number;
  receivedCount: number;
  totalDeals: number;
  totalOrdered: number;
  totalReceived: number;
  totalOrderedGst: number;
  totalReceivedGst: number;
  totalOrderedWithGst: number;
  totalReceivedWithGst: number;
  totalOutstandingValue: number;
}

const STATUS_COLORS: Record<string, string> = {
  APPROVED: 'border-blue-300 bg-blue-50 text-blue-700',
  SENT: 'border-blue-300 bg-blue-50 text-blue-700',
  PARTIAL_RECEIVED: 'border-yellow-300 bg-yellow-50 text-yellow-700',
  RECEIVED: 'border-green-300 bg-green-50 text-green-700',
  CLOSED: 'border-slate-300 bg-slate-50 text-slate-600',
};

const fmtCurrency = (n: number | null | undefined): string => {
  if (n === null || n === undefined || n === 0) return '--';
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

const fmtDate = (s: string | null | undefined): string => {
  if (!s) return '--';
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
};

export default function StoreDeals() {
  const [deals, setDeals] = useState<StoreDeal[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [dealsRes, sumRes] = await Promise.all([
        api.get<StoreDeal[]>('/stores/deals' + (statusFilter ? `?status=${statusFilter}` : '')),
        api.get<Summary>('/stores/summary'),
      ]);
      setDeals(dealsRes.data);
      setSummary(sumRes.data);
    } catch (err) {
      console.error('Failed to fetch store deals:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return deals;
    return deals.filter(d =>
      String(d.poNo).includes(q) ||
      d.vendor.name.toLowerCase().includes(q) ||
      d.lines.some(l => l.description.toLowerCase().includes(q))
    );
  }, [deals, search]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-xs text-slate-400 uppercase tracking-widest">Loading store deals...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Store Deals</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Running orders for chemicals, packing, spares & consumables</span>
          </div>
          <button onClick={fetchData} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">
            Refresh
          </button>
        </div>

        {/* Filter toolbar */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-3">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Status</label>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
          >
            <option value="">All running</option>
            <option value="APPROVED">Approved (open)</option>
            <option value="PARTIAL_RECEIVED">Partial received</option>
            <option value="RECEIVED">Fully received</option>
            <option value="CLOSED">Closed</option>
          </select>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-3">Search</label>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="PO no, vendor, item..."
            className="border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 flex-1 max-w-xs"
          />
          <span className="text-[10px] text-slate-500 uppercase tracking-widest ml-auto">
            {filtered.length} of {deals.length}
          </span>
        </div>

        {/* KPI Strip */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-5 border-x border-b border-slate-300 -mx-3 md:-mx-6">
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Open</div>
              <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{summary.openCount}</div>
            </div>
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-yellow-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Partial</div>
              <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{summary.partialCount}</div>
            </div>
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Received</div>
              <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{summary.receivedCount}</div>
            </div>
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-slate-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Ordered (Incl. GST)</div>
              <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtCurrency(summary.totalOrderedWithGst)}</div>
              <div className="text-[9px] text-slate-400 font-mono tabular-nums">Base {fmtCurrency(summary.totalOrdered)} + GST {fmtCurrency(summary.totalOrderedGst)}</div>
            </div>
            <div className="bg-white px-4 py-3 border-l-4 border-l-orange-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Pending (Incl. GST)</div>
              <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtCurrency(summary.totalOutstandingValue)}</div>
            </div>
          </div>
        )}

        {/* Deals table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-8"></th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">PO #</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Date</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vendor</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Items</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Base</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">GST</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Total</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Received</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Pending</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">
                    No store deals found
                  </td>
                </tr>
              )}
              {filtered.map((d, i) => {
                const isOpen = expanded === d.id;
                const firstItem = d.lines[0]?.description || '--';
                const moreCount = d.lineCount > 1 ? ` +${d.lineCount - 1}` : '';
                return (
                  <React.Fragment key={d.id}>
                    <tr
                      className={`border-b border-slate-100 hover:bg-blue-50/60 cursor-pointer ${i % 2 ? 'bg-slate-50/70' : ''}`}
                      onClick={() => setExpanded(isOpen ? null : d.id)}
                    >
                      <td className="px-3 py-1.5 text-slate-400 text-center border-r border-slate-100">{isOpen ? '▾' : '▸'}</td>
                      <td className="px-3 py-1.5 text-slate-800 font-mono border-r border-slate-100">PO-{d.poNo}</td>
                      <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{fmtDate(d.poDate)}</td>
                      <td className="px-3 py-1.5 text-slate-800 border-r border-slate-100">{d.vendor.name}</td>
                      <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100 truncate max-w-xs" title={d.lines.map(l => l.description).join(', ')}>
                        {firstItem}{moreCount}
                      </td>
                      <td className="px-3 py-1.5 border-r border-slate-100">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${STATUS_COLORS[d.status] || 'border-slate-300 bg-slate-50 text-slate-600'}`}>
                          {d.status === 'PARTIAL_RECEIVED' ? 'PARTIAL' : d.status}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtCurrency(d.orderedValue)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-500 border-r border-slate-100">{fmtCurrency(d.orderedGst)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums font-bold text-slate-900 border-r border-slate-100">{fmtCurrency(d.orderedTotal)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-green-700 border-r border-slate-100">{fmtCurrency(d.receivedTotal)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-orange-700">{fmtCurrency(Math.max(d.orderedTotal - d.receivedTotal, 0))}</td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50">
                        <td colSpan={11} className="px-6 py-3 border-b border-slate-200">
                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Line items ({d.lineCount}) · GRNs: {d.grnCount}{d.remarks ? ` · ${d.remarks}` : ''}</div>
                          <table className="w-full text-xs border border-slate-300">
                            <thead>
                              <tr className="bg-slate-200">
                                <th className="text-left px-2 py-1 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-300">Item</th>
                                <th className="text-left px-2 py-1 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-300">Category</th>
                                <th className="text-right px-2 py-1 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-300">Rate</th>
                                <th className="text-right px-2 py-1 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-300">Qty</th>
                                <th className="text-right px-2 py-1 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-300">Base</th>
                                <th className="text-right px-2 py-1 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-300">GST%</th>
                                <th className="text-right px-2 py-1 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-300">GST Amt</th>
                                <th className="text-right px-2 py-1 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-300">Total</th>
                                <th className="text-right px-2 py-1 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-300">Received</th>
                                <th className="text-right px-2 py-1 font-semibold text-[10px] uppercase tracking-widest">Pending</th>
                              </tr>
                            </thead>
                            <tbody>
                              {d.lines.map(l => (
                                <tr key={l.id} className="border-t border-slate-200">
                                  <td className="px-2 py-1 text-slate-800 border-r border-slate-200">{l.description}</td>
                                  <td className="px-2 py-1 text-slate-500 text-[10px] border-r border-slate-200">{l.category || '--'}</td>
                                  <td className="px-2 py-1 text-right font-mono tabular-nums border-r border-slate-200">₹{l.rate}/{l.unit}</td>
                                  <td className="px-2 py-1 text-right font-mono tabular-nums border-r border-slate-200">{l.quantity} {l.unit}</td>
                                  <td className="px-2 py-1 text-right font-mono tabular-nums border-r border-slate-200">{fmtCurrency(l.baseValue)}</td>
                                  <td className="px-2 py-1 text-right font-mono tabular-nums text-slate-500 border-r border-slate-200">{l.gstPercent}%</td>
                                  <td className="px-2 py-1 text-right font-mono tabular-nums text-slate-500 border-r border-slate-200">{fmtCurrency(l.gstValue)}</td>
                                  <td className="px-2 py-1 text-right font-mono tabular-nums font-bold text-slate-900 border-r border-slate-200">{fmtCurrency(l.totalValue)}</td>
                                  <td className="px-2 py-1 text-right font-mono tabular-nums text-green-700 border-r border-slate-200">{l.receivedQty} {l.unit}</td>
                                  <td className="px-2 py-1 text-right font-mono tabular-nums text-orange-700">{l.pendingQty} {l.unit}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
