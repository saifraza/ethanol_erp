import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface AuditEntry {
  id: string;
  entityType: string;
  entityId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  changedBy: string;
  changedAt: string;
  reason: string | null;
}

interface AuditResponse {
  items: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
}

const ENTITY_TYPES = [
  'ALL',
  'ComplianceConfig',
  'FiscalYear',
  'InvoiceSeries',
  'HsnCode',
  'GstRate',
  'TdsSection',
  'TcsSection',
  'TaxRuleExplanation',
  'Vendor',
  'Customer',
];

function fmtDateTime(d: string): string {
  return new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
}

function truncate(s: string | null, n: number): string {
  if (!s) return '--';
  return s.length > n ? s.slice(0, n) + '...' : s;
}

export default function ComplianceAuditLogPage() {
  const [data, setData] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entityType, setEntityType] = useState('ALL');
  const [entityId, setEntityId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const pageSize = 100;

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (entityType !== 'ALL') params.set('entityType', entityType);
      if (entityId.trim()) params.set('entityId', entityId.trim());
      if (from) params.set('from', new Date(from).toISOString());
      if (to) params.set('to', new Date(to).toISOString());
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      const res = await api.get<AuditResponse | AuditEntry[]>(`/tax/audit?${params.toString()}`);
      if (Array.isArray(res.data)) {
        setData(res.data);
        setTotal(res.data.length);
      } else {
        setData(res.data.items || []);
        setTotal(res.data.total || 0);
      }
    } catch (err: unknown) {
      console.error('Failed to fetch audit log:', err);
      setError('Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId, from, to, page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const applyFilters = () => {
    setPage(1);
    fetchData();
  };

  const clearFilters = () => {
    setEntityType('ALL');
    setEntityId('');
    setFrom('');
    setTo('');
    setPage(1);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Compliance Audit Log</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Every change to tax master data</span>
          </div>
          <div className="text-[10px] text-slate-400 uppercase tracking-widest font-mono tabular-nums">{total} entries</div>
        </div>

        {/* Filter toolbar */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-3 flex-wrap">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Entity Type</label>
            <select className="border border-slate-300 px-2.5 py-1 text-xs bg-white" value={entityType} onChange={e => setEntityType(e.target.value)}>
              {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Entity ID</label>
            <input className="border border-slate-300 px-2.5 py-1 text-xs bg-white w-48 font-mono" placeholder="cuid..." value={entityId} onChange={e => setEntityId(e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">From</label>
            <input type="date" className="border border-slate-300 px-2.5 py-1 text-xs bg-white" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">To</label>
            <input type="date" className="border border-slate-300 px-2.5 py-1 text-xs bg-white" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div className="flex items-end gap-2 ml-auto">
            <button onClick={applyFilters}
              className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
              Apply
            </button>
            <button onClick={clearFilters}
              className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">
              Clear
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border-x border-b border-red-300 px-4 py-2 -mx-3 md:-mx-6">
            <span className="text-[11px] font-bold text-red-700 uppercase tracking-widest">{error}</span>
          </div>
        )}

        {/* Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Changed At (IST)</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Entity Type</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Entity ID</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Field</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Old → New</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Changed By</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Reason</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">Loading...</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">No audit entries</td></tr>
              ) : data.map((e, i) => (
                <tr key={e.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                  <td className="px-3 py-1.5 font-mono tabular-nums text-slate-700 border-r border-slate-100 whitespace-nowrap">{fmtDateTime(e.changedAt)}</td>
                  <td className="px-3 py-1.5 text-slate-800 border-r border-slate-100">{e.entityType}</td>
                  <td className="px-3 py-1.5 font-mono text-[10px] text-slate-500 border-r border-slate-100">{truncate(e.entityId, 12)}</td>
                  <td className="px-3 py-1.5 font-mono text-slate-700 border-r border-slate-100">{e.field}</td>
                  <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">
                    <span className="text-red-600 line-through">{truncate(e.oldValue, 30)}</span>
                    <span className="mx-1 text-slate-400">→</span>
                    <span className="text-green-700 font-medium">{truncate(e.newValue, 30)}</span>
                  </td>
                  <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{e.changedBy}</td>
                  <td className="px-3 py-1.5 text-slate-500">{truncate(e.reason, 40)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center justify-between">
            <span className="text-[10px] text-slate-500 uppercase tracking-widest">
              Page <span className="font-mono tabular-nums">{page}</span> of <span className="font-mono tabular-nums">{totalPages}</span>
            </span>
            <div className="flex items-center gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}
                className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50 disabled:opacity-50">
                Previous
              </button>
              <button disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50 disabled:opacity-50">
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
