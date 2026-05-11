import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Phone, CheckCircle2, AlertCircle, Search, Fingerprint } from 'lucide-react';
import api from '../../services/api';

type Kind = 'EMPLOYEE' | 'LABOR';
interface Row {
  kind: Kind;
  id: string;
  code: string;
  no: number;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  deviceUserId: string;
  department: string | null;
  designation: string | null;
  enrolledDevices: string[];
  enrolled: boolean;
}
interface ByDevice { code: string; ok: boolean; error: string | null; enrolled: number; }
interface Resp {
  refreshedAt: string;
  totals: { employees: number; labor: number; all: number };
  enrolledCount: number;
  pendingCount: number;
  byDevice: ByDevice[];
  rows: Row[];
}

export default function BiometricEnrollment() {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'done'>('pending');
  const [kindFilter, setKindFilter] = useState<'ALL' | Kind>('ALL');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await api.get<Resp>('/biometric/enrollment-status');
      setData(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [] as Row[];
    let rows = data.rows;
    if (filter === 'pending') rows = rows.filter(r => !r.enrolled);
    else if (filter === 'done') rows = rows.filter(r => r.enrolled);
    if (kindFilter !== 'ALL') rows = rows.filter(r => r.kind === kindFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(r =>
        r.firstName.toLowerCase().includes(q) ||
        (r.lastName ?? '').toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        r.deviceUserId.toLowerCase().includes(q) ||
        (r.phone ?? '').includes(q) ||
        (r.department ?? '').toLowerCase().includes(q)
      );
    }
    return rows;
  }, [data, filter, kindFilter, search]);

  const pct = data && data.totals.all > 0
    ? Math.round((data.enrolledCount / data.totals.all) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Fingerprint className="w-4 h-4" />
            <h1 className="text-sm font-bold tracking-wide uppercase">Biometric Enrollment</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Live device query — who has a fingerprint, who's still pending</span>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Refresh
          </button>
        </div>

        {/* Summary strip */}
        {data && (
          <div className="bg-white border-x border-b border-slate-300 -mx-3 md:-mx-6 grid grid-cols-2 md:grid-cols-5 gap-0">
            <div className="px-4 py-3 border-r border-slate-200 border-l-4 border-l-slate-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total</div>
              <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{data.totals.all}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">{data.totals.employees} emp · {data.totals.labor} labor</div>
            </div>
            <div className="px-4 py-3 border-r border-slate-200 border-l-4 border-l-emerald-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Enrolled</div>
              <div className="text-xl font-bold text-emerald-700 mt-1 font-mono tabular-nums">{data.enrolledCount}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">{pct}% complete</div>
            </div>
            <div className="px-4 py-3 border-r border-slate-200 border-l-4 border-l-amber-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Pending</div>
              <div className="text-xl font-bold text-amber-700 mt-1 font-mono tabular-nums">{data.pendingCount}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">to be called</div>
            </div>
            {data.byDevice.slice(0, 2).map(d => (
              <div key={d.code} className={`px-4 py-3 border-r border-slate-200 border-l-4 ${d.ok ? 'border-l-blue-500' : 'border-l-rose-500'}`}>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{d.code}</div>
                <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{d.enrolled}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{d.ok ? 'enrolled on this device' : 'device unreachable'}</div>
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-3 flex-wrap">
          <div className="flex items-stretch">
            {(['pending', 'done', 'all'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-[11px] font-bold uppercase tracking-widest px-3 py-1 border ${
                  filter === f ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {f === 'pending' ? 'Pending' : f === 'done' ? 'Enrolled' : 'All'}
              </button>
            ))}
          </div>
          <select
            value={kindFilter}
            onChange={e => setKindFilter(e.target.value as any)}
            className="border border-slate-300 px-2 py-1 text-xs bg-white"
          >
            <option value="ALL">All people</option>
            <option value="EMPLOYEE">Employees only</option>
            <option value="LABOR">Labor only</option>
          </select>
          <div className="relative">
            <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, code, phone, dept…"
              className="pl-7 pr-3 py-1 border border-slate-300 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-64"
            />
          </div>
          <span className="ml-auto text-[11px] text-slate-500">
            {filtered.length} shown
            {data && <> · refreshed {new Date(data.refreshedAt).toLocaleTimeString()}</>}
          </span>
        </div>

        {error && (
          <div className="bg-rose-50 border-x border-b border-rose-200 text-rose-700 px-4 py-2 -mx-3 md:-mx-6 text-xs">
            {error}
          </div>
        )}

        {/* Table */}
        <div className="bg-white border-x border-b border-slate-300 -mx-3 md:-mx-6 overflow-x-auto">
          <table className="w-full text-xs min-w-[1000px]">
            <thead className="bg-slate-800 text-white">
              <tr>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Code</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Device ID</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Name</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Phone</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Department</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Enrolled on</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-400">{loading ? 'Loading…' : 'No rows.'}</td></tr>
              ) : (
                filtered.map(r => (
                  <tr key={`${r.kind}-${r.id}`} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-1.5 border-r border-slate-100">
                      {r.enrolled
                        ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" /> Enrolled</span>
                        : <span className="inline-flex items-center gap-1 text-amber-700"><AlertCircle className="w-3.5 h-3.5" /> Pending</span>}
                    </td>
                    <td className="px-3 py-1.5 border-r border-slate-100 font-mono">{r.code}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 font-mono">{r.deviceUserId}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100">{r.firstName} {r.lastName ?? ''}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100">
                      {r.phone ? (
                        <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 text-blue-600 hover:underline font-mono">
                          <Phone className="w-3 h-3" /> {r.phone}
                        </a>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-slate-600">{r.department ?? <span className="text-slate-400">—</span>}</td>
                    <td className="px-3 py-1.5 text-slate-600">
                      {r.enrolledDevices.length > 0
                        ? <span className="font-mono text-[11px]">{r.enrolledDevices.join(' · ')}</span>
                        : <span className="text-slate-400">—</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
