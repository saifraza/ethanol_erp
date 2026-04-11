import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../services/api';

// ── Types ────────────────────────────────────────────────────────────────────

type Source = 'GRAIN_TRUCK' | 'DISPATCH_TRUCK' | 'DDGS_TRUCK';
type Direction = 'INBOUND' | 'OUTBOUND';
type MaterialType = 'ETHANOL' | 'DDGS' | 'RAW_MATERIAL' | 'FUEL' | 'OTHER';
type WeighmentStatus = 'PENDING' | 'PARTIAL' | 'COMPLETE' | 'CANCELLED';

interface UnifiedWeighmentRow {
  id: string;
  source: Source;
  ticketNo: number | null;
  direction: Direction;
  materialType: MaterialType;
  materialName: string | null;
  vehicleNo: string;
  partyName: string;
  partyId: string | null;
  gateEntryAt: string | null;
  firstWeightAt: string | null;
  secondWeightAt: string | null;
  releaseAt: string | null;
  grossWeight: number | null;
  tareWeight: number | null;
  netWeight: number | null;
  status: WeighmentStatus;
  durationGateToFirstMin: number | null;
  durationFirstToSecondMin: number | null;
  turnaroundMin: number | null;
}

interface ApiResponse {
  data: UnifiedWeighmentRow[];
  total: number;
  limit: number;
  offset: number;
}

type MaterialFilter = 'ALL' | MaterialType;
type DirectionFilter = 'ALL' | Direction;
type StatusFilter = 'ALL' | WeighmentStatus;

interface Filters {
  from: string;
  to: string;
  materialType: MaterialFilter;
  direction: DirectionFilter;
  status: StatusFilter;
  search: string;
  onlyCompleted: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function nDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function fmtTime(iso: string | null): string {
  if (!iso) return '--';
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function fmtDate(iso: string | null): string {
  if (!iso) return '--';
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}

function fmtNum(n: number | null): string {
  if (n === null || n === undefined) return '--';
  return n.toLocaleString('en-IN');
}

function fmtTurnaround(min: number | null): string {
  if (min === null || min === undefined) return '--';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

function fmtAvgTurnaround(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: WeighmentStatus }) {
  const styles: Record<WeighmentStatus, string> = {
    PENDING: 'border-slate-300 bg-slate-50 text-slate-600',
    PARTIAL: 'border-amber-400 bg-amber-50 text-amber-700',
    COMPLETE: 'border-green-500 bg-green-50 text-green-700',
    CANCELLED: 'border-red-400 bg-red-50 text-red-700',
  };
  return (
    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${styles[status]}`}>
      {status}
    </span>
  );
}

function DirectionBadge({ direction }: { direction: Direction }) {
  const styles: Record<Direction, string> = {
    INBOUND: 'border-blue-400 bg-blue-50 text-blue-700',
    OUTBOUND: 'border-purple-400 bg-purple-50 text-purple-700',
  };
  const labels: Record<Direction, string> = { INBOUND: 'IN', OUTBOUND: 'OUT' };
  return (
    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${styles[direction]}`}>
      {labels[direction]}
    </span>
  );
}

function MaterialBadge({ mat }: { mat: MaterialType }) {
  const labels: Record<MaterialType, string> = {
    ETHANOL: 'ETH',
    DDGS: 'DDGS',
    RAW_MATERIAL: 'RM',
    FUEL: 'FUEL',
    OTHER: 'OTH',
  };
  return (
    <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-300 bg-slate-50 text-slate-600">
      {labels[mat]}
    </span>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function WeighmentHistory() {
  // Filter state (applied on click)
  const defaultFilters: Filters = {
    from: nDaysAgo(7),
    to: todayStr(),
    materialType: 'ALL',
    direction: 'ALL',
    status: 'ALL',
    search: '',
    onlyCompleted: false,
  };

  const [pendingFilters, setPendingFilters] = useState<Filters>(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(defaultFilters);

  const [data, setData] = useState<UnifiedWeighmentRow[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<boolean>(false);

  // Pagination
  const [pageSize, setPageSize] = useState<number>(100);
  const [offset, setOffset] = useState<number>(0);

  // Search debounce
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async (filters: Filters, lim: number, off: number) => {
    try {
      setLoading(true);
      setError(null);
      const params: Record<string, string | number | boolean> = {
        from: filters.from,
        to: filters.to,
        limit: lim,
        offset: off,
      };
      if (filters.materialType !== 'ALL') params.materialType = filters.materialType;
      if (filters.direction !== 'ALL') params.direction = filters.direction;
      if (filters.status !== 'ALL') params.status = filters.status;
      if (filters.search.trim()) params.search = filters.search.trim();
      if (filters.onlyCompleted) params.onlyCompleted = true;

      const res = await api.get<ApiResponse>('/reports/weighment-history', { params });
      setData(res.data.data ?? (res.data as unknown as UnifiedWeighmentRow[]));
      // Handle both {data, total} and raw array response shapes
      const rows = Array.isArray(res.data) ? (res.data as unknown as UnifiedWeighmentRow[]) : res.data.data;
      const tot = Array.isArray(res.data) ? rows.length : (res.data.total ?? rows.length);
      setData(rows);
      setTotal(tot);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load data';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(appliedFilters, pageSize, offset);
  }, [fetchData, appliedFilters, pageSize, offset]);

  // Debounced search — updates pending then auto-applies
  const handleSearchChange = (val: string) => {
    const updated = { ...pendingFilters, search: val };
    setPendingFilters(updated);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setOffset(0);
      setAppliedFilters(updated);
    }, 400);
  };

  const handleApply = () => {
    setOffset(0);
    setAppliedFilters({ ...pendingFilters });
  };

  const handleExport = async () => {
    try {
      setExporting(true);
      const params: Record<string, string | number | boolean> = {
        from: appliedFilters.from,
        to: appliedFilters.to,
        format: 'xlsx',
        limit: 10000,
        offset: 0,
      };
      if (appliedFilters.materialType !== 'ALL') params.materialType = appliedFilters.materialType;
      if (appliedFilters.direction !== 'ALL') params.direction = appliedFilters.direction;
      if (appliedFilters.status !== 'ALL') params.status = appliedFilters.status;
      if (appliedFilters.search.trim()) params.search = appliedFilters.search.trim();
      if (appliedFilters.onlyCompleted) params.onlyCompleted = true;

      const res = await api.get('/reports/weighment-history', { params, responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `weighment-history-${appliedFilters.from}-${appliedFilters.to}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  // ── KPI calculations ──────────────────────────────────────────────────────

  const totalTrucks = total;
  const totalNetMT = data.reduce((s, r) => s + (r.netWeight ?? 0), 0) / 1000;
  const completedRows = data.filter(r => r.status === 'COMPLETE');
  const pctCompleted = data.length > 0 ? Math.round((completedRows.length / data.length) * 100) : 0;
  const avgTurnaround = completedRows.length > 0
    ? completedRows.reduce((s, r) => s + (r.turnaroundMin ?? 0), 0) / completedRows.length
    : 0;
  const inboundCount = data.filter(r => r.direction === 'INBOUND').length;
  const outboundCount = data.filter(r => r.direction === 'OUTBOUND').length;

  // ── Pagination ────────────────────────────────────────────────────────────

  const currentPage = Math.floor(offset / pageSize);
  const totalPages = Math.ceil(total / pageSize);
  const showFrom = total === 0 ? 0 : offset + 1;
  const showTo = Math.min(offset + pageSize, total);

  const goNext = () => { if (offset + pageSize < total) setOffset(o => o + pageSize); };
  const goPrev = () => { if (offset > 0) setOffset(o => Math.max(0, o - pageSize)); };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">

        {/* ── Page Toolbar ── */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Weighment History</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Unified report across all inbound/outbound trucks</span>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50 disabled:opacity-50"
          >
            {exporting ? 'Exporting...' : 'Export Excel'}
          </button>
        </div>

        {/* ── Filter Bar ── */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex flex-wrap items-end gap-3">
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">From</div>
            <input
              type="date"
              value={pendingFilters.from}
              onChange={e => setPendingFilters(f => ({ ...f, from: e.target.value }))}
              className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white"
            />
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">To</div>
            <input
              type="date"
              value={pendingFilters.to}
              onChange={e => setPendingFilters(f => ({ ...f, to: e.target.value }))}
              className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white"
            />
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Material</div>
            <select
              value={pendingFilters.materialType}
              onChange={e => setPendingFilters(f => ({ ...f, materialType: e.target.value as MaterialFilter }))}
              className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white"
            >
              <option value="ALL">All</option>
              <option value="ETHANOL">Ethanol</option>
              <option value="DDGS">DDGS</option>
              <option value="RAW_MATERIAL">Raw Material</option>
              <option value="FUEL">Fuel</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Direction</div>
            <select
              value={pendingFilters.direction}
              onChange={e => setPendingFilters(f => ({ ...f, direction: e.target.value as DirectionFilter }))}
              className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white"
            >
              <option value="ALL">All</option>
              <option value="INBOUND">Inbound</option>
              <option value="OUTBOUND">Outbound</option>
            </select>
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Status</div>
            <select
              value={pendingFilters.status}
              onChange={e => setPendingFilters(f => ({ ...f, status: e.target.value as StatusFilter }))}
              className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white"
            >
              <option value="ALL">All</option>
              <option value="PENDING">Pending</option>
              <option value="PARTIAL">Partial</option>
              <option value="COMPLETE">Complete</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
          <div className="flex-1 min-w-[180px]">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Search</div>
            <input
              type="text"
              value={pendingFilters.search}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder="Vehicle no. or party name..."
              className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white"
            />
          </div>
          <div className="flex items-end gap-2 pb-0.5">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={pendingFilters.onlyCompleted}
                onChange={e => setPendingFilters(f => ({ ...f, onlyCompleted: e.target.checked }))}
                className="w-3.5 h-3.5"
              />
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Only Completed</span>
            </label>
          </div>
          <div className="pb-0.5">
            <button
              onClick={handleApply}
              className="px-3 py-1.5 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700"
            >
              Apply
            </button>
          </div>
        </div>

        {/* ── KPI Strip ── */}
        <div className="grid grid-cols-5 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Trucks</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{totalTrucks.toLocaleString('en-IN')}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Net (MT)</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">
              {totalNetMT.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-amber-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Avg Turnaround</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">
              {avgTurnaround > 0 ? fmtAvgTurnaround(avgTurnaround) : '--'}
            </div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-slate-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">% Completed</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{pctCompleted}%</div>
          </div>
          <div className="bg-white px-4 py-3 border-l-4 border-l-indigo-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">In / Out</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">
              {inboundCount} / {outboundCount}
            </div>
          </div>
        </div>

        {/* ── Error Banner ── */}
        {error && (
          <div className="-mx-3 md:-mx-6 bg-red-50 border-x border-b border-red-300 px-4 py-2">
            <span className="text-xs font-bold text-red-700 uppercase tracking-widest">Error: </span>
            <span className="text-xs text-red-700">{error}</span>
          </div>
        )}

        {/* ── Data Table ── */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
          <table className="w-full text-xs min-w-[1540px]">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Date</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Ticket</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vehicle</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Party</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Dir</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Material</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Item Name</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Gate In</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">1st Wt</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">2nd Wt</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Gross (kg)</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Tare (kg)</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Net (kg)</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">G→1 (m)</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">1→2 (m)</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Turnaround</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={17} className="px-3 py-8 text-center">
                    <span className="text-xs text-slate-400 uppercase tracking-widest">Loading...</span>
                  </td>
                </tr>
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={17} className="px-3 py-8 text-center">
                    <span className="text-xs text-slate-400 uppercase tracking-widest">No Records Found</span>
                  </td>
                </tr>
              ) : (
                data.map((row, i) => (
                  <tr
                    key={row.id}
                    className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 === 1 ? 'bg-slate-50/70' : ''}`}
                  >
                    <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100 whitespace-nowrap">
                      {fmtDate(row.gateEntryAt)}
                    </td>
                    <td className="px-3 py-1.5 font-mono tabular-nums text-slate-700 border-r border-slate-100">
                      {row.ticketNo ?? '--'}
                    </td>
                    <td className="px-3 py-1.5 text-slate-800 font-medium border-r border-slate-100 whitespace-nowrap">
                      {row.vehicleNo || '--'}
                    </td>
                    <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100 max-w-[160px] truncate">
                      {row.partyName || '--'}
                    </td>
                    <td className="px-3 py-1.5 text-center border-r border-slate-100">
                      <DirectionBadge direction={row.direction} />
                    </td>
                    <td className="px-3 py-1.5 text-center border-r border-slate-100">
                      <MaterialBadge mat={row.materialType} />
                    </td>
                    <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100 max-w-[140px] truncate">
                      {row.materialName || '--'}
                    </td>
                    <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100 whitespace-nowrap font-mono tabular-nums text-[10px]">
                      {fmtTime(row.gateEntryAt)}
                    </td>
                    <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100 whitespace-nowrap font-mono tabular-nums text-[10px]">
                      {fmtTime(row.firstWeightAt)}
                    </td>
                    <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100 whitespace-nowrap font-mono tabular-nums text-[10px]">
                      {fmtTime(row.secondWeightAt)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">
                      {fmtNum(row.grossWeight)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">
                      {fmtNum(row.tareWeight)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums font-bold text-slate-800 border-r border-slate-100">
                      {fmtNum(row.netWeight)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-600 border-r border-slate-100">
                      {row.durationGateToFirstMin !== null ? Math.round(row.durationGateToFirstMin) : '--'}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-600 border-r border-slate-100">
                      {row.durationFirstToSecondMin !== null ? Math.round(row.durationFirstToSecondMin) : '--'}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-600 border-r border-slate-100">
                      {fmtTurnaround(row.turnaroundMin)}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <StatusBadge status={row.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination Footer ── */}
        <div className="-mx-3 md:-mx-6 bg-slate-100 border-x border-b border-slate-300 px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={goPrev}
              disabled={offset === 0 || loading}
              className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              onClick={goNext}
              disabled={offset + pageSize >= total || loading}
              className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50 disabled:opacity-40"
            >
              Next
            </button>
            <span className="text-[10px] text-slate-500 uppercase tracking-widest">
              {total === 0
                ? 'No records'
                : `Showing ${showFrom.toLocaleString('en-IN')}–${showTo.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')}`}
            </span>
            {totalPages > 1 && (
              <span className="text-[10px] text-slate-400">
                Page {currentPage + 1} of {totalPages}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Rows</span>
            <select
              value={pageSize}
              onChange={e => { setPageSize(Number(e.target.value)); setOffset(0); }}
              className="border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white"
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={250}>250</option>
              <option value={500}>500</option>
            </select>
          </div>
        </div>

      </div>
    </div>
  );
}
