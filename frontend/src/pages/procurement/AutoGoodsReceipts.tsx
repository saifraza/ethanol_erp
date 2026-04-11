/**
 * Auto GRN (Weighbridge) — read-only list page.
 *
 * Lists GRNs that were generated automatically by weighbridge handlers when
 * a truck completed weighing. No Create / Edit / Delete. To correct an auto
 * GRN, operators must use the Weighment Corrections screen.
 *
 * See .claude/skills/grn-split-auto-vs-store.md for the contract.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import GRNDetailDrawer, { parseWbMarkers } from '../store/GRNDetailDrawer';

interface AutoGRNRow {
  id: string;
  grnNo: number | string;
  date: string;
  createdAt?: string;
  status: string;
  poId?: string | null;
  poNo?: string | null;
  vendorId?: string | null;
  vendorName?: string | null;
  totalAmount?: number | null;
  remarks?: string | null;
  vehicleNo?: string | null;
  ticketNo?: number | string | null;
  materialName?: string | null;
  quantity?: number | null;
  unit?: string | null;
}

interface ListResponse {
  items?: AutoGRNRow[];
  total?: number;
  limit?: number;
  offset?: number;
}

interface VendorLite {
  id: string;
  name: string;
}
interface POLite {
  id: string;
  poNo: string;
}

const PAGE_SIZE = 50;

const fmtDate = (s?: string | null) => {
  if (!s) return '--';
  const d = new Date(s);
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
};

const fmtCurrency = (n?: number | null) => {
  if (n == null || n === 0) return '--';
  return '\u20B9' + n.toLocaleString('en-IN', { minimumFractionDigits: 2 });
};

const fmtQty = (n?: number | null, unit?: string | null) => {
  if (n == null) return '--';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2 }) + (unit ? ` ${unit}` : '');
};

export default function AutoGoodsReceipts() {
  const [rows, setRows] = useState<AutoGRNRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [poId, setPoId] = useState('');
  const [page, setPage] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);

  const [vendors, setVendors] = useState<VendorLite[]>([]);
  const [pos, setPos] = useState<POLite[]>([]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Load dropdowns once
  useEffect(() => {
    const firstArray = (d: unknown): unknown[] => {
      if (Array.isArray(d)) return d;
      if (d && typeof d === 'object') {
        for (const v of Object.values(d as Record<string, unknown>)) {
          if (Array.isArray(v)) return v;
        }
      }
      return [];
    };
    api
      .get('/vendors')
      .then((r) => setVendors(firstArray(r.data) as VendorLite[]))
      .catch(() => setVendors([]));
    api
      .get('/purchase-orders?limit=500')
      .then((r) => {
        type P = { id: string; poNo?: string | number };
        const list = firstArray(r.data) as P[];
        setPos(list.map((p) => ({ id: p.id, poNo: String(p.poNo ?? '--') })));
      })
      .catch(() => setPos([]));
  }, []);

  const fetchRows = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('q', debouncedSearch);
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      if (vendorId) params.set('vendorId', vendorId);
      if (poId) params.set('poId', poId);
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(page * PAGE_SIZE));
      const res = await api.get(`/goods-receipts/auto?${params.toString()}`);
      const data = res.data;
      const raw = Array.isArray(data)
        ? (data as any[])
        : ((data as ListResponse)?.items ?? []) as any[];
      // Backend returns nested vendor/po/lines — flatten for display
      const list: AutoGRNRow[] = raw.map((r: any) => ({
        id: r.id,
        grnNo: r.grnNo,
        date: r.grnDate || r.date,
        createdAt: r.createdAt,
        status: r.status,
        poId: r.po?.id || r.poId,
        poNo: r.po?.poNo || r.poNo,
        vendorId: r.vendor?.id || r.vendorId,
        vendorName: r.vendor?.name || r.vendorName,
        totalAmount: r.totalAmount,
        remarks: r.remarks,
        vehicleNo: r.vehicleNo,
        ticketNo: r.ticketNo || r.remarks?.match(/Ticket #(\d+)/)?.[1] || null,
        materialName: (r.lines?.[0]?.description || r.materialName || '').split('|')[0].trim() || null,
        quantity: r.lines?.[0]?.receivedQty ?? r.totalQty ?? r.quantity,
        unit: r.lines?.[0]?.unit || r.unit,
      }));
      setRows(list);
      setTotal(
        Array.isArray(data)
          ? list.length
          : typeof (data as ListResponse)?.total === 'number'
          ? (data as ListResponse).total || 0
          : list.length,
      );
    } catch (err) {
      console.error('Failed to load auto GRNs:', err);
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, fromDate, toDate, vendorId, poId, page]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const pageEnd = total === 0 ? 0 : page * PAGE_SIZE + rows.length;
  const initialLoading =
    loading && rows.length === 0 && !debouncedSearch && !fromDate && !toDate && !vendorId && !poId;

  if (initialLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-xs text-slate-400 uppercase tracking-widest">Loading auto GRNs...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Auto GRN (Weighbridge)</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Generated automatically when trucks complete weighing</span>
          </div>
        </div>

        {/* Info banner */}
        <div className="bg-blue-50 border-x border-b border-blue-200 px-4 py-2 -mx-3 md:-mx-6 text-[10px] font-medium uppercase tracking-widest text-blue-700">
          Auto GRNs are created by the weighbridge when trucks complete weighing. To correct, use{' '}
          <Link
            to="/admin/weighment-corrections"
            className="underline decoration-blue-400 hover:text-blue-900"
          >
            Weighment Corrections
          </Link>
          .
        </div>

        {/* Filter bar */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex gap-3 items-end flex-wrap">
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">
              Search (GRN / ticket / vehicle)
            </div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="e.g. 137 or HR55T2963"
              className="border border-slate-300 px-2.5 py-1.5 text-xs w-64 focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">From</div>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setPage(0);
              }}
              className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">To</div>
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setPage(0);
              }}
              className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Vendor</div>
            <select
              value={vendorId}
              onChange={(e) => {
                setVendorId(e.target.value);
                setPage(0);
              }}
              className="border border-slate-300 px-2 py-1.5 text-xs w-44 focus:outline-none focus:ring-1 focus:ring-slate-400"
            >
              <option value="">All vendors</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">PO</div>
            <select
              value={poId}
              onChange={(e) => {
                setPoId(e.target.value);
                setPage(0);
              }}
              className="border border-slate-300 px-2 py-1.5 text-xs w-32 focus:outline-none focus:ring-1 focus:ring-slate-400"
            >
              <option value="">All POs</option>
              {pos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.poNo}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={fetchRows}
            className="px-3 py-1.5 bg-slate-700 text-white text-[11px] font-medium hover:bg-slate-800 uppercase tracking-widest"
          >
            Refresh
          </button>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-3 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Auto GRNs</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{total}</div>
            <div className="text-[9px] text-slate-400 uppercase tracking-widest mt-1">
              Showing {rows.length} on page
            </div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Confirmed</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">
              {rows.filter((r) => r.status === 'CONFIRMED').length}
            </div>
          </div>
          <div className="bg-white px-4 py-3 border-l-4 border-l-amber-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Draft</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">
              {rows.filter((r) => r.status === 'DRAFT').length}
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="-mx-3 md:-mx-6 border-x border-slate-300 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">GRN No</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Date</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vehicle</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Ticket</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vendor</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">PO</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Material</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Qty</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Amount</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">
                    No auto GRNs match the filter
                  </td>
                </tr>
              )}
              {rows.map((r, i) => {
                const wb = parseWbMarkers(r.remarks);
                const vehicle = r.vehicleNo || wb.vehicle || '--';
                const ticket = r.ticketNo != null ? String(r.ticketNo) : wb.ticket;
                const statusColors =
                  r.status === 'CONFIRMED'
                    ? 'border-green-300 bg-green-50 text-green-700'
                    : r.status === 'DRAFT'
                    ? 'border-amber-300 bg-amber-50 text-amber-700'
                    : 'border-slate-300 bg-slate-50 text-slate-600';
                return (
                  <tr
                    key={r.id}
                    onClick={() => setDetailId(r.id)}
                    className={`border-b border-slate-100 hover:bg-blue-50/60 cursor-pointer ${i % 2 ? 'bg-slate-50/70' : ''}`}
                  >
                    <td className="px-3 py-1.5 text-slate-800 border-r border-slate-100 font-mono tabular-nums">
                      GRN-{r.grnNo}
                    </td>
                    <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100 whitespace-nowrap">
                      {fmtDate(r.date || r.createdAt)}
                    </td>
                    <td className="px-3 py-1.5 text-slate-800 border-r border-slate-100 font-mono">{vehicle}</td>
                    <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100 font-mono tabular-nums">
                      {ticket ? `T-${ticket}` : '--'}
                    </td>
                    <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{r.vendorName || '--'}</td>
                    <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100 font-mono">{r.poNo ? `PO-${r.poNo}` : '--'}</td>
                    <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{r.materialName || '--'}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">
                      {fmtQty(r.quantity, r.unit)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">
                      {fmtCurrency(r.totalAmount)}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${statusColors}`}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center justify-between">
          <span className="text-[10px] text-slate-500 uppercase tracking-widest">
            {total === 0 ? 'No rows' : `Showing ${pageStart}-${pageEnd} of ${total}`}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] font-medium hover:bg-slate-50 disabled:opacity-30"
            >
              Prev
            </button>
            <span className="px-2 text-[10px] text-slate-500 font-mono tabular-nums">
              Page {page + 1} of {pageCount}
            </span>
            <button
              onClick={() => setPage((p) => (pageEnd < total ? p + 1 : p))}
              disabled={pageEnd >= total}
              className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] font-medium hover:bg-slate-50 disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {detailId && (
        <GRNDetailDrawer
          grnId={detailId}
          endpoint="auto"
          readOnly
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}
