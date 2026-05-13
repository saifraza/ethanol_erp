import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, RefreshCw, AlertCircle } from 'lucide-react';
import api from '../../services/api';

interface OrphanRow {
  ticketNo: number | null;
  localId: string;
  vehicleNo: string;
  supplierName: string | null;
  supplierId: string | null;
  materialName: string | null;
  firstWeightAt: string | null;
  secondWeightAt: string | null;
  netWeight: number | null;
  purchaseType: string | null;
  poId: string | null;
  labStatus: string | null;
  vendorIdByName: string | null;
  vendorName: string | null;
  poNo: number | null;
  poStatus: string | null;
  companyCode: string | null;
  plantIssueId: string | null;
  plantIssueStatus: string | null;
}
interface OrphanResponse {
  summary: { totalCount: number; totalMt: number; vendorCount: number };
  byVendor: Array<{ vendorName: string; count: number; qtyKg: number }>;
  rows: OrphanRow[];
}

const fmtMoney = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';

const OrphanTrucks: React.FC = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<OrphanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [search, setSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.get('/vendors/audit/orphan-trucks')
      .then(r => { setData(r.data); setErr(''); })
      .catch((e: unknown) => {
        const ex = e as { response?: { data?: { error?: string } }; message?: string };
        setErr(ex.response?.data?.error || ex.message || 'Failed to load');
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.rows.filter(r => {
      if (vendorFilter && (r.vendorName || r.supplierName || 'UNKNOWN').toUpperCase() !== vendorFilter) return false;
      if (!q) return true;
      return (
        (r.vendorName || r.supplierName || '').toLowerCase().includes(q) ||
        r.vehicleNo.toLowerCase().includes(q) ||
        String(r.ticketNo ?? '').includes(q) ||
        (r.materialName || '').toLowerCase().includes(q) ||
        String(r.poNo ?? '').includes(q)
      );
    });
  }, [data, search, vendorFilter]);

  if (loading) return <div className="p-8 text-sm text-slate-500">Loading orphan trucks…</div>;
  if (err) return <div className="p-8 text-sm text-red-600">{err}</div>;
  if (!data) return null;

  return (
    <div className="px-4 py-4 max-w-[1600px] mx-auto">
      <div className="bg-white border border-slate-200 mb-3">
        <div className="px-4 py-3 bg-red-700 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} />
            <h1 className="text-sm font-bold uppercase tracking-wider">Orphan Trucks Audit</h1>
            <span className="text-[10px] opacity-80">Inbound weighments that completed at the gate but never became a GoodsReceipt</span>
          </div>
          <button onClick={load} className="flex items-center gap-1 text-xs px-2 py-1 bg-white/10 hover:bg-white/20"><RefreshCw size={12} /> Refresh</button>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-3 border-b border-slate-200">
          <div className="px-3 py-2 border-r border-slate-200">
            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Orphan Trucks</div>
            <div className={`text-lg font-bold tabular-nums ${data.summary.totalCount > 0 ? 'text-red-600' : 'text-green-600'}`}>{data.summary.totalCount}</div>
          </div>
          <div className="px-3 py-2 border-r border-slate-200">
            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Total Qty Unaccounted</div>
            <div className="text-lg font-bold tabular-nums text-slate-700">{fmtMoney(data.summary.totalMt)} MT</div>
          </div>
          <div className="px-3 py-2">
            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Vendors Affected</div>
            <div className="text-lg font-bold tabular-nums text-slate-700">{data.summary.vendorCount}</div>
          </div>
        </div>

        {/* By-vendor chips */}
        {data.byVendor.length > 0 && (
          <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 flex flex-wrap gap-1.5">
            <button
              onClick={() => setVendorFilter(null)}
              className={`text-[10px] px-2 py-1 font-bold uppercase tracking-widest border ${!vendorFilter ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'}`}
            >
              All ({data.summary.totalCount})
            </button>
            {data.byVendor.map(v => {
              const key = v.vendorName.toUpperCase();
              const active = vendorFilter === key;
              return (
                <button
                  key={key}
                  onClick={() => setVendorFilter(active ? null : key)}
                  className={`text-[10px] px-2 py-1 font-bold uppercase tracking-widest border ${active ? 'bg-red-700 text-white border-red-700' : 'bg-white text-red-700 border-red-300 hover:bg-red-50'}`}
                  title={`${fmtMoney(v.qtyKg / 1000)} MT`}
                >
                  {v.vendorName.length > 28 ? v.vendorName.slice(0, 28) + '…' : v.vendorName} ({v.count})
                </button>
              );
            })}
          </div>
        )}

        {/* Search */}
        <div className="px-3 py-2 border-b border-slate-200 flex items-center gap-2">
          <input
            type="text"
            placeholder="Filter by vendor / vehicle / ticket / material / PO…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border border-slate-300 px-2.5 py-1 text-xs w-80 focus:outline-none focus:ring-1 focus:ring-slate-400"
          />
          <span className="text-[10px] text-slate-500">{filtered.length} of {data.summary.totalCount} shown</span>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 text-[10px] uppercase tracking-widest text-slate-600">
              <tr>
                <th className="px-3 py-1.5 text-left border-r border-slate-200">Tare Time</th>
                <th className="px-3 py-1.5 text-left border-r border-slate-200">Co.</th>
                <th className="px-3 py-1.5 text-left border-r border-slate-200">Ticket</th>
                <th className="px-3 py-1.5 text-left border-r border-slate-200">Vehicle</th>
                <th className="px-3 py-1.5 text-left border-r border-slate-200">Vendor</th>
                <th className="px-3 py-1.5 text-left border-r border-slate-200">Material</th>
                <th className="px-3 py-1.5 text-right border-r border-slate-200">Net (MT)</th>
                <th className="px-3 py-1.5 text-left border-r border-slate-200">PO</th>
                <th className="px-3 py-1.5 text-left border-r border-slate-200">PO Status</th>
                <th className="px-3 py-1.5 text-left">Alert</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={10} className="px-3 py-6 text-center text-green-600 font-semibold">✓ No orphan trucks{(search || vendorFilter) ? ' match the current filter' : ''}.</td></tr>
              ) : filtered.map(r => (
                <tr key={r.localId} className="border-b border-slate-100 hover:bg-red-50">
                  <td className="px-3 py-1.5 border-r border-slate-100 whitespace-nowrap">{fmtDate(r.secondWeightAt)}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100 text-[10px] font-bold uppercase tracking-widest text-slate-500">{r.companyCode || '—'}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100 font-mono">{r.ticketNo ?? '—'}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100 font-mono">{r.vehicleNo}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100">
                    {r.vendorIdByName ? (
                      <button onClick={() => navigate(`/procurement/vendors/${r.vendorIdByName}`)} className="text-blue-700 hover:underline text-left">
                        {r.vendorName || r.supplierName}
                      </button>
                    ) : (
                      <span className="text-slate-600">{r.supplierName || '—'}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 border-r border-slate-100">{r.materialName || '—'}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100 text-right tabular-nums">{fmtMoney((r.netWeight || 0) / 1000)}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100 font-mono">{r.poNo ?? '—'}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100">
                    {r.poStatus ? <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 text-[9px] font-bold uppercase tracking-widest">{r.poStatus}</span> : '—'}
                  </td>
                  <td className="px-3 py-1.5">
                    {r.plantIssueId ? (
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest ${r.plantIssueStatus === 'OPEN' ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600'}`}>
                        <AlertCircle size={9} /> Issue {r.plantIssueStatus}
                      </span>
                    ) : (
                      <span className="text-[9px] uppercase tracking-widest text-slate-400">— silent —</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-[10px] text-slate-500 px-1">
        Live query. A row appears here as soon as a COMPLETE inbound Weighment has no matching GRN (by ticketNo OR remarks marker). When you create the GRN, the row disappears on next refresh. The "Alert" column shows whether the system raised a PlantIssue for this skip — a "silent" row means the skip happened without any alerting (older incidents pre-safety-net).
      </div>
    </div>
  );
};

export default OrphanTrucks;
