import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

// ─── Types ───────────────────────────────────────────────────────────────────

type MaterialType = 'ETHANOL' | 'DDGS' | 'RAW_MATERIAL' | 'FUEL' | 'OTHER';
type Direction = 'INBOUND' | 'OUTBOUND';
type WeighmentStatus = 'PENDING' | 'PARTIAL' | 'COMPLETE' | 'CANCELLED';

interface UnifiedWeighmentRow {
  id: string;
  source: 'FACTORY_WEIGHMENT';
  ticketNo: number | null;
  direction: Direction;
  materialType: MaterialType;
  materialName: string | null;
  vehicleNo: string;
  partyName: string;
  partyId: null;
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
  cloudSynced: boolean;
  cloudError: string | null;
  syncAttempts: number;
}

interface ApiResponse {
  rows: UnifiedWeighmentRow[];
  total: number;
  limit: number;
  offset: number;
}

type MaterialFilter = MaterialType | 'ALL';
type DirectionFilter = Direction | 'ALL';
type StatusFilter = WeighmentStatus | 'ALL';
type PageSize = 50 | 100 | 250 | 500;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

function defaultTo(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtIST(iso: string | null): string {
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
  return new Date(iso).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function fmtKg(n: number | null): string {
  if (n == null) return '--';
  return n.toLocaleString('en-IN');
}

function fmtMT(kg: number): string {
  return (kg / 1000).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDuration(min: number | null): string {
  if (min == null) return '--';
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

function fmtTurnaround(min: number | null): string {
  if (min == null) return '--';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}:${m.toString().padStart(2, '0')}`;
}

// ─── Badge components ─────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: WeighmentStatus }) {
  const cls: Record<WeighmentStatus, string> = {
    PENDING: 'border-slate-300 bg-slate-50 text-slate-500',
    PARTIAL: 'border-amber-300 bg-amber-50 text-amber-700',
    COMPLETE: 'border-green-300 bg-green-50 text-green-700',
    CANCELLED: 'border-red-300 bg-red-50 text-red-700',
  };
  return (
    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${cls[status]}`}>
      {status}
    </span>
  );
}

function CloudBadge({ synced, error, attempts }: { synced: boolean; error: string | null; attempts: number }) {
  if (synced && !error) {
    return <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-green-300 bg-green-50 text-green-700">OK</span>;
  }
  if (error) {
    return (
      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-red-300 bg-red-50 text-red-700 cursor-help" title={error}>
        ERR
      </span>
    );
  }
  if (attempts > 0) {
    return <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-amber-300 bg-amber-50 text-amber-700">Retry</span>;
  }
  return <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-300 bg-slate-50 text-slate-400">--</span>;
}

function DirBadge({ direction }: { direction: Direction }) {
  const cls = direction === 'INBOUND'
    ? 'border-blue-300 bg-blue-50 text-blue-700'
    : 'border-purple-300 bg-purple-50 text-purple-700';
  return (
    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${cls}`}>
      {direction === 'INBOUND' ? 'IN' : 'OUT'}
    </span>
  );
}

function MatBadge({ type }: { type: MaterialType }) {
  const cls: Record<MaterialType, string> = {
    ETHANOL: 'border-indigo-300 bg-indigo-50 text-indigo-700',
    DDGS: 'border-orange-300 bg-orange-50 text-orange-700',
    RAW_MATERIAL: 'border-green-300 bg-green-50 text-green-700',
    FUEL: 'border-yellow-300 bg-yellow-50 text-yellow-700',
    OTHER: 'border-slate-300 bg-slate-50 text-slate-500',
  };
  const label: Record<MaterialType, string> = {
    ETHANOL: 'Ethanol',
    DDGS: 'DDGS',
    RAW_MATERIAL: 'Raw Mat',
    FUEL: 'Fuel',
    OTHER: 'Other',
  };
  return (
    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${cls[type]}`}>
      {label[type]}
    </span>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function WeighmentHistory() {
  const { token } = useAuth();

  // Filters
  const [fromDate, setFromDate] = useState<string>(defaultFrom());
  const [toDate, setToDate] = useState<string>(defaultTo());
  const [materialType, setMaterialType] = useState<MaterialFilter>('ALL');
  const [direction, setDirection] = useState<DirectionFilter>('ALL');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [search, setSearch] = useState<string>('');
  const [onlyCompleted, setOnlyCompleted] = useState<boolean>(false);

  // Pagination
  const [offset, setOffset] = useState<number>(0);
  const [pageSize, setPageSize] = useState<PageSize>(100);

  // Data
  const [rows, setRows] = useState<UnifiedWeighmentRow[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState<boolean>(false);

  // Debounce ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const axiosApi = axios.create({
    baseURL: '/api',
    headers: { Authorization: `Bearer ${token}` },
  });

  const buildParams = useCallback(
    (fmt: 'json' | 'xlsx' = 'json', exportOffset = 0, exportLimit = pageSize): URLSearchParams => {
      const p = new URLSearchParams();
      if (fromDate) p.set('from', fromDate);
      if (toDate) p.set('to', toDate);
      if (materialType !== 'ALL') p.set('materialType', materialType);
      if (direction !== 'ALL') p.set('direction', direction);
      if (status !== 'ALL') p.set('status', status);
      if (search.trim()) p.set('search', search.trim());
      if (onlyCompleted) p.set('onlyCompleted', 'true');
      p.set('limit', String(exportLimit));
      p.set('offset', String(exportOffset));
      p.set('format', fmt);
      return p;
    },
    [fromDate, toDate, materialType, direction, status, search, onlyCompleted, pageSize]
  );

  const fetchData = useCallback(
    async (currentOffset: number = 0) => {
      setLoading(true);
      setError(null);
      try {
        const params = buildParams('json', currentOffset, pageSize);
        const res = await axiosApi.get<ApiResponse>(`/reports/weighment-history?${params}`);
        setRows(res.data.rows);
        setTotal(res.data.total);
        setHasFetched(true);
      } catch (e) {
        const err = e as { response?: { data?: { error?: string } }; message?: string };
        setError(err?.response?.data?.error ?? err?.message ?? 'Failed to load data');
        setRows([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [buildParams, pageSize, token]
  );

  // Auto-fetch on mount
  useEffect(() => {
    fetchData(0);
    setOffset(0);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // Debounce search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (hasFetched) {
        setOffset(0);
        fetchData(0);
      }
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);  // eslint-disable-line react-hooks/exhaustive-deps

  const handleApply = () => {
    setOffset(0);
    fetchData(0);
  };

  const handlePageChange = (newOffset: number) => {
    setOffset(newOffset);
    fetchData(newOffset);
  };

  const handleExport = async () => {
    try {
      const params = buildParams('xlsx', 0, 10000);
      const res = await axiosApi.get(`/reports/weighment-history?${params}`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `weighment-history-${fromDate}-${toDate}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Export failed. Try again.');
    }
  };

  // ─── KPI calculations ───────────────────────────────────────────────────────

  const totalNetKg = rows.reduce((sum, r) => sum + (r.netWeight ?? 0), 0);
  const completedRows = rows.filter(r => r.status === 'COMPLETE');
  const completedPct = rows.length > 0 ? Math.round((completedRows.length / rows.length) * 100) : 0;
  const inboundCount = rows.filter(r => r.direction === 'INBOUND').length;
  const outboundCount = rows.filter(r => r.direction === 'OUTBOUND').length;

  const turnaroundVals = rows
    .map(r => r.turnaroundMin)
    .filter((v): v is number => v !== null);
  const avgTurnaround =
    turnaroundVals.length > 0
      ? turnaroundVals.reduce((a, b) => a + b, 0) / turnaroundVals.length
      : null;

  // ─── Pagination ─────────────────────────────────────────────────────────────

  const currentPage = Math.floor(offset / pageSize) + 1;
  const totalPages = Math.ceil(total / pageSize);
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + pageSize, total);

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">

        {/* ── Toolbar ── */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Weighment History</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">All trucks — gate entry to release</span>
          </div>
          <button
            onClick={handleExport}
            className="px-3 py-1 bg-white border border-slate-300 text-slate-700 text-[11px] font-medium hover:bg-slate-50"
          >
            Export Excel
          </button>
        </div>

        {/* ── Filter Bar ── */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6">
          <div className="flex flex-wrap items-end gap-3">

            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">
                From
              </label>
              <input
                type="date"
                value={fromDate}
                onChange={e => setFromDate(e.target.value)}
                className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-36"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">
                To
              </label>
              <input
                type="date"
                value={toDate}
                onChange={e => setToDate(e.target.value)}
                className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-36"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">
                Material
              </label>
              <select
                value={materialType}
                onChange={e => setMaterialType(e.target.value as MaterialFilter)}
                className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-36"
              >
                <option value="ALL">All Materials</option>
                <option value="ETHANOL">Ethanol</option>
                <option value="DDGS">DDGS</option>
                <option value="RAW_MATERIAL">Raw Material</option>
                <option value="FUEL">Fuel</option>
                <option value="OTHER">Other</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">
                Direction
              </label>
              <select
                value={direction}
                onChange={e => setDirection(e.target.value as DirectionFilter)}
                className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-32"
              >
                <option value="ALL">All</option>
                <option value="INBOUND">Inbound</option>
                <option value="OUTBOUND">Outbound</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">
                Status
              </label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as StatusFilter)}
                className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-32"
              >
                <option value="ALL">All</option>
                <option value="PENDING">Pending</option>
                <option value="PARTIAL">Partial</option>
                <option value="COMPLETE">Complete</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">
                Search
              </label>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Vehicle no. / party name"
                className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-48"
              />
            </div>

            <div className="flex items-end gap-2 pb-0.5">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyCompleted}
                  onChange={e => setOnlyCompleted(e.target.checked)}
                  className="w-3.5 h-3.5 border border-slate-300"
                />
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  Only Completed
                </span>
              </label>
            </div>

            <button
              onClick={handleApply}
              disabled={loading}
              className="px-3 py-1.5 bg-blue-600 text-white text-[11px] font-bold uppercase hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Apply'}
            </button>

          </div>
        </div>

        {/* ── KPI Strip ── */}
        <div className="grid grid-cols-2 md:grid-cols-5 border-x border-b border-slate-300 -mx-3 md:-mx-6">

          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Trucks</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">
              {total.toLocaleString('en-IN')}
            </div>
            <div className="text-[9px] text-slate-400 mt-0.5 uppercase tracking-widest">
              (page: {rows.length})
            </div>
          </div>

          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Net (MT)</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">
              {totalNetKg === 0 ? '--' : fmtMT(totalNetKg)}
            </div>
            <div className="text-[9px] text-slate-400 mt-0.5 uppercase tracking-widest">
              {fmtKg(totalNetKg)} kg
            </div>
          </div>

          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-amber-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Avg Turnaround</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">
              {fmtTurnaround(avgTurnaround)}
            </div>
            <div className="text-[9px] text-slate-400 mt-0.5 uppercase tracking-widest">
              {turnaroundVals.length} with data
            </div>
          </div>

          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-slate-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">% Completed</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">
              {completedPct}%
            </div>
            <div className="text-[9px] text-slate-400 mt-0.5 uppercase tracking-widest">
              {completedRows.length} of {rows.length}
            </div>
          </div>

          <div className="bg-white px-4 py-3 border-l-4 border-l-indigo-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">In / Out</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">
              {inboundCount} / {outboundCount}
            </div>
            <div className="text-[9px] text-slate-400 mt-0.5 uppercase tracking-widest">
              inbound / outbound
            </div>
          </div>

        </div>

        {/* ── Error State ── */}
        {error && (
          <div className="-mx-3 md:-mx-6 border-x border-b border-red-300 bg-red-50 px-4 py-3">
            <span className="text-xs text-red-700 uppercase tracking-widest font-bold">{error}</span>
          </div>
        )}

        {/* ── Table ── */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 whitespace-nowrap">
                  Date
                </th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 whitespace-nowrap">
                  Ticket
                </th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 whitespace-nowrap">
                  Vehicle
                </th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 whitespace-nowrap">
                  Party
                </th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 whitespace-nowrap">
                  Dir
                </th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 whitespace-nowrap">
                  Material
                </th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 whitespace-nowrap">
                  Gate In
                </th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 whitespace-nowrap">
                  1st Wt
                </th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 whitespace-nowrap">
                  2nd Wt
                </th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 whitespace-nowrap">
                  Gross (kg)
                </th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 whitespace-nowrap">
                  Tare (kg)
                </th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 whitespace-nowrap">
                  Net (kg)
                </th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 whitespace-nowrap">
                  G→1 (min)
                </th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 whitespace-nowrap">
                  1→2 (min)
                </th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 whitespace-nowrap">
                  Turnaround
                </th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 whitespace-nowrap">
                  Status
                </th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 whitespace-nowrap">
                  Cloud
                </th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest whitespace-nowrap">
                  Reprint
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={18} className="text-center py-10 text-xs text-slate-400 uppercase tracking-widest">
                    Loading...
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && hasFetched && !error && (
                <tr>
                  <td colSpan={18} className="text-center py-10 text-xs text-slate-400 uppercase tracking-widest">
                    No weighments found for the selected filters
                  </td>
                </tr>
              )}
              {!loading && !hasFetched && (
                <tr>
                  <td colSpan={18} className="text-center py-10 text-xs text-slate-400 uppercase tracking-widest">
                    Apply filters to load data
                  </td>
                </tr>
              )}
              {!loading && rows.map((row, i) => (
                <tr
                  key={row.id}
                  className={`border-b border-slate-100 hover:bg-blue-50/60 ${row.cloudError ? 'bg-red-50/40' : i % 2 === 1 ? 'bg-slate-50/70' : ''}`}
                >
                  {/* Date */}
                  <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100 whitespace-nowrap">
                    <div>{fmtDate(row.gateEntryAt)}</div>
                  </td>
                  {/* Ticket */}
                  <td className="px-3 py-1.5 font-mono text-slate-500 border-r border-slate-100 whitespace-nowrap">
                    {row.ticketNo != null ? `#${row.ticketNo}` : '--'}
                  </td>
                  {/* Vehicle */}
                  <td className="px-3 py-1.5 font-mono font-bold text-slate-800 border-r border-slate-100 whitespace-nowrap">
                    {row.vehicleNo}
                  </td>
                  {/* Party */}
                  <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100 max-w-[160px] truncate">
                    {row.partyName || '--'}
                  </td>
                  {/* Direction */}
                  <td className="px-3 py-1.5 text-center border-r border-slate-100">
                    <DirBadge direction={row.direction} />
                  </td>
                  {/* Material */}
                  <td className="px-3 py-1.5 text-center border-r border-slate-100">
                    <MatBadge type={row.materialType} />
                  </td>
                  {/* Gate In */}
                  <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100 whitespace-nowrap">
                    {fmtIST(row.gateEntryAt)}
                  </td>
                  {/* 1st Wt */}
                  <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100 whitespace-nowrap">
                    {fmtIST(row.firstWeightAt)}
                  </td>
                  {/* 2nd Wt */}
                  <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100 whitespace-nowrap">
                    {fmtIST(row.secondWeightAt)}
                  </td>
                  {/* Gross */}
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100 whitespace-nowrap">
                    {fmtKg(row.grossWeight)}
                  </td>
                  {/* Tare */}
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100 whitespace-nowrap">
                    {fmtKg(row.tareWeight)}
                  </td>
                  {/* Net — bold */}
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums font-bold text-green-700 border-r border-slate-100 whitespace-nowrap">
                    {fmtKg(row.netWeight)}
                  </td>
                  {/* G→1 */}
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-500 border-r border-slate-100 whitespace-nowrap">
                    {row.durationGateToFirstMin != null
                      ? Math.round(row.durationGateToFirstMin)
                      : '--'}
                  </td>
                  {/* 1→2 */}
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-500 border-r border-slate-100 whitespace-nowrap">
                    {row.durationFirstToSecondMin != null
                      ? Math.round(row.durationFirstToSecondMin)
                      : '--'}
                  </td>
                  {/* Turnaround */}
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-600 border-r border-slate-100 whitespace-nowrap">
                    {fmtTurnaround(row.turnaroundMin)}
                  </td>
                  {/* Status */}
                  <td className="px-3 py-1.5 text-center border-r border-slate-100">
                    <StatusBadge status={row.status} />
                  </td>
                  {/* Cloud sync */}
                  <td className="px-3 py-1.5 text-center border-r border-slate-100">
                    <CloudBadge synced={row.cloudSynced} error={row.cloudError} attempts={row.syncAttempts} />
                  </td>
                  {/* Reprint */}
                  <td className="px-3 py-1.5 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => window.open(`/api/weighbridge/print/gate-pass/${row.id}`, '_blank')}
                        title="Reprint Gate Pass"
                        className="px-1.5 py-0.5 text-[9px] font-bold uppercase border border-slate-300 text-slate-500 hover:bg-slate-100"
                      >
                        Gate
                      </button>
                      {(row.grossWeight || row.tareWeight) && (
                        <button
                          onClick={() => window.open(`/api/weighbridge/print/gross-slip/${row.id}`, '_blank')}
                          title="Reprint 1st Weight Slip"
                          className="px-1.5 py-0.5 text-[9px] font-bold uppercase border border-blue-300 text-blue-600 hover:bg-blue-50"
                        >
                          1st
                        </button>
                      )}
                      {row.status === 'COMPLETE' && (
                        <button
                          onClick={() => window.open(`/api/weighbridge/print/final-slip/${row.id}`, '_blank')}
                          title="Reprint Final Slip"
                          className="px-1.5 py-0.5 text-[9px] font-bold uppercase border border-green-300 text-green-600 hover:bg-green-50"
                        >
                          Final
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ── */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-white px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">
              {total === 0
                ? 'No results'
                : `${rangeStart.toLocaleString('en-IN')} – ${rangeEnd.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')}`}
            </span>
            {totalPages > 1 && (
              <span className="text-[10px] text-slate-400 uppercase tracking-widest">
                Page {currentPage} of {totalPages}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              Rows
            </label>
            <select
              value={pageSize}
              onChange={e => {
                const ps = parseInt(e.target.value) as PageSize;
                setPageSize(ps);
                setOffset(0);
                // fetchData will be called on next render via effect or manually
              }}
              className="border border-slate-300 px-2 py-1 text-xs focus:outline-none"
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={250}>250</option>
              <option value={500}>500</option>
            </select>

            <button
              onClick={() => handlePageChange(Math.max(0, offset - pageSize))}
              disabled={offset === 0 || loading}
              className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              onClick={() => handlePageChange(offset + pageSize)}
              disabled={offset + pageSize >= total || loading}
              className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
