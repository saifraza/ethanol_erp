/**
 * Activity Log — Admin viewer for high-value ERP edits.
 *
 * Source: cloud `ActivityLog` table, populated by Prisma middleware on every
 * CREATE/UPDATE/DELETE to whitelisted models (invoices, payments, POs, GRNs,
 * vendors, customers, items, weighbridge, contracts, master data, business rules).
 *
 * Read-only. Filterable by category, model, action, user, date range, search.
 * Click a row to see the full field-level diff.
 */

import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface ActivityRow {
  id: string;
  category: string;
  model: string;
  recordId: string | null;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  userId: string | null;
  userName: string | null;
  userRole: string | null;
  routePath: string | null;
  ipAddress: string | null;
  summary: string | null;
  createdAt: string;
}

interface ActivityDetail extends ActivityRow {
  changes: unknown;
}

const CATEGORY_LABEL: Record<string, { text: string; cls: string }> = {
  FINANCIAL:   { text: 'Financial',   cls: 'border-emerald-300 bg-emerald-50 text-emerald-800' },
  MASTER_DATA: { text: 'Master Data', cls: 'border-blue-300 bg-blue-50 text-blue-800' },
  INVENTORY:   { text: 'Inventory',   cls: 'border-amber-300 bg-amber-50 text-amber-800' },
  WEIGHBRIDGE: { text: 'Weighbridge', cls: 'border-purple-300 bg-purple-50 text-purple-800' },
  COMPLIANCE:  { text: 'Compliance',  cls: 'border-orange-300 bg-orange-50 text-orange-800' },
  AUTH:        { text: 'Auth',        cls: 'border-red-300 bg-red-50 text-red-800' },
  CONTRACT:    { text: 'Contract',    cls: 'border-teal-300 bg-teal-50 text-teal-800' },
  CONFIG:      { text: 'Config',      cls: 'border-slate-300 bg-slate-50 text-slate-800' },
};

const ACTION_CLS: Record<string, string> = {
  CREATE: 'text-emerald-700 font-bold',
  UPDATE: 'text-blue-700 font-bold',
  DELETE: 'text-red-700 font-bold',
};

const fmtTime = (s: string) => new Date(s).toLocaleString('en-IN', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
});

export default function ActivityLog() {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState('');
  const [model, setModel] = useState('');
  const [action, setAction] = useState('');
  const [user, setUser] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [summary, setSummary] = useState<{ totals: Record<string, number>; total: number }>({ totals: {}, total: 0 });
  const [selected, setSelected] = useState<ActivityDetail | null>(null);
  const limit = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { limit: String(limit), offset: String(offset) };
      if (category) params.category = category;
      if (model) params.model = model;
      if (action) params.action = action;
      if (user) params.user = user;
      if (search) params.search = search;
      if (from) params.from = from;
      if (to) params.to = to;
      const res = await api.get('/activity-log/events', { params });
      setRows(res.data.rows || []);
      setTotal(res.data.total || 0);
    } finally { setLoading(false); }
  }, [category, model, action, user, search, from, to, offset]);

  const loadSummary = useCallback(async () => {
    try {
      const res = await api.get('/activity-log/summary');
      setSummary({ totals: res.data.totals || {}, total: res.data.total || 0 });
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadSummary(); const iv = setInterval(loadSummary, 60000); return () => clearInterval(iv); }, [loadSummary]);

  async function openDetail(id: string) {
    try {
      const res = await api.get(`/activity-log/${id}`);
      setSelected(res.data);
    } catch { /* ignore */ }
  }

  return (
    <div className="p-3 md:p-6 space-y-0">
      {/* Toolbar */}
      <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-bold tracking-wide uppercase">Activity Log</h1>
          <span className="text-xs text-slate-500">|</span>
          <span className="text-xs text-slate-500">Every high-value edit across the ERP</span>
        </div>
        <button onClick={() => { load(); loadSummary(); }} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Refresh</button>
      </div>

      {/* KPI strip — last 24h */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-white grid grid-cols-2 md:grid-cols-5 divide-x divide-slate-300">
        <div className="px-4 py-3">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Total (24h)</div>
          <div className="text-2xl font-bold text-slate-800 tabular-nums mt-0.5">{summary.total}</div>
        </div>
        {(['FINANCIAL', 'MASTER_DATA', 'INVENTORY', 'WEIGHBRIDGE'] as const).map(k => (
          <div key={k} className="px-4 py-3">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{CATEGORY_LABEL[k].text}</div>
            <div className="text-2xl font-bold text-slate-800 tabular-nums mt-0.5">{summary.totals[k] ?? 0}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-slate-50 px-4 py-3 flex flex-wrap gap-2 items-end">
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Category</label>
          <select value={category} onChange={e => { setOffset(0); setCategory(e.target.value); }} className="border border-slate-300 px-3 py-1.5 text-sm bg-white">
            <option value="">All</option>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v.text}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Model</label>
          <input value={model} onChange={e => setModel(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { setOffset(0); load(); } }} className="border border-slate-300 px-3 py-1.5 text-sm bg-white w-44" placeholder="Invoice / PurchaseOrder" />
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Action</label>
          <select value={action} onChange={e => { setOffset(0); setAction(e.target.value); }} className="border border-slate-300 px-3 py-1.5 text-sm bg-white">
            <option value="">All</option>
            <option value="CREATE">CREATE</option>
            <option value="UPDATE">UPDATE</option>
            <option value="DELETE">DELETE</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">User</label>
          <input value={user} onChange={e => setUser(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { setOffset(0); load(); } }} className="border border-slate-300 px-3 py-1.5 text-sm bg-white w-44" placeholder="saif / admin / system" />
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Search (summary / id / route)</label>
          <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { setOffset(0); load(); } }} className="border border-slate-300 px-3 py-1.5 text-sm bg-white w-56" placeholder="INV-2026-0042 / /api/invoices" />
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">From</label>
          <input type="date" value={from} onChange={e => { setOffset(0); setFrom(e.target.value); }} className="border border-slate-300 px-3 py-1.5 text-sm bg-white" />
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">To</label>
          <input type="date" value={to} onChange={e => { setOffset(0); setTo(e.target.value); }} className="border border-slate-300 px-3 py-1.5 text-sm bg-white" />
        </div>
        <button onClick={() => { setOffset(0); setCategory(''); setModel(''); setAction(''); setUser(''); setSearch(''); setFrom(''); setTo(''); }} className="px-3 py-1.5 bg-white border border-slate-300 text-slate-600 text-xs font-medium hover:bg-slate-50">Clear</button>
      </div>

      {/* Table */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-white overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-100 border-b border-slate-300">
            <tr className="text-left text-[10px] font-bold text-slate-600 uppercase tracking-widest">
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Model</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Summary</th>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Route</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {loading && rows.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">Loading...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">No activity matches the current filters.</td></tr>
            ) : rows.map(r => {
              const lbl = CATEGORY_LABEL[r.category] || { text: r.category, cls: 'border-slate-300 bg-slate-50 text-slate-700' };
              return (
                <tr key={r.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => openDetail(r.id)}>
                  <td className="px-3 py-2 font-mono text-slate-700 whitespace-nowrap">{fmtTime(r.createdAt)}</td>
                  <td className="px-3 py-2"><span className={`inline-block px-2 py-0.5 border text-[10px] font-bold uppercase tracking-wider ${lbl.cls}`}>{lbl.text}</span></td>
                  <td className="px-3 py-2 font-mono text-slate-700">{r.model}</td>
                  <td className={`px-3 py-2 ${ACTION_CLS[r.action] || ''}`}>{r.action}</td>
                  <td className="px-3 py-2 text-slate-800">{r.summary}</td>
                  <td className="px-3 py-2 text-slate-700">{r.userName || '--'}{r.userRole ? ` (${r.userRole})` : ''}</td>
                  <td className="px-3 py-2 font-mono text-[10px] text-slate-500">{r.routePath || '--'}</td>
                  <td className="px-3 py-2 text-blue-600 text-xs">View →</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-slate-50 px-4 py-2 flex items-center justify-between">
        <div className="text-xs text-slate-600">
          Showing {rows.length === 0 ? 0 : offset + 1}–{offset + rows.length} of {total}
        </div>
        <div className="flex gap-2">
          <button disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - limit))} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-xs disabled:opacity-50">Prev</button>
          <button disabled={offset + limit >= total || loading} onClick={() => setOffset(offset + limit)} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-xs disabled:opacity-50">Next</button>
        </div>
      </div>

      {/* Detail Modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelected(null)}>
          <div className="bg-white w-full max-w-3xl shadow-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest">Activity Detail</h3>
              <button onClick={() => setSelected(null)} className="text-slate-300 hover:text-white text-xs">Close</button>
            </div>
            <div className="overflow-y-auto p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div><div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">When</div><div className="font-mono text-slate-800">{fmtTime(selected.createdAt)}</div></div>
                <div><div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">User</div><div className="text-slate-800">{selected.userName || '--'} {selected.userRole ? `(${selected.userRole})` : ''}</div></div>
                <div><div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Category</div><div className="text-slate-800">{selected.category}</div></div>
                <div><div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Action</div><div className={ACTION_CLS[selected.action] || ''}>{selected.action}</div></div>
                <div><div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Model</div><div className="font-mono text-slate-800">{selected.model}</div></div>
                <div><div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Record ID</div><div className="font-mono text-slate-800">{selected.recordId || '--'}</div></div>
                <div><div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Route</div><div className="font-mono text-slate-800">{selected.routePath || '--'}</div></div>
                <div><div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">IP Address</div><div className="font-mono text-slate-800">{selected.ipAddress || '--'}</div></div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Summary</div>
                <div className="text-sm text-slate-800">{selected.summary}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Changes</div>
                <pre className="bg-slate-50 border border-slate-200 px-3 py-2 text-[11px] font-mono text-slate-800 overflow-x-auto whitespace-pre-wrap break-all max-h-96">{JSON.stringify(selected.changes, null, 2)}</pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
