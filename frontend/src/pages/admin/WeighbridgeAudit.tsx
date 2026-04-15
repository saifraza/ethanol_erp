/**
 * Weighbridge Audit — Admin UI
 *
 * Cross-system audit log for safety-rule overrides + soft-confirms at the
 * weighbridge. Pulls from cloud WeighmentAuditEvent (factory-server pushes
 * via syncWorker). Read-only.
 *
 * Event types:
 *   SCALE_NOT_ZERO_OVERRIDE  — admin overrode the scale-must-be-zero check
 *   DELTA_CONFIRMED          — operator confirmed a near-duplicate weight
 *   INTERVAL_OVERRIDE        — admin overrode the 10-min interval check
 *   DUPLICATE_OVERRIDE       — admin overrode the frozen-digitizer duplicate check
 *
 * See .claude/skills/weighbridge.md (Part D coming) for context.
 */

import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface AuditRow {
  id: string;
  factoryEventId: string;
  eventType: string;
  ruleKey: string | null;
  weighmentLocalId: string;
  ticketNo: number | null;
  vehicleNo: string | null;
  pcId: string | null;
  action: string | null;
  newWeight: number | null;
  prevWeight: number | null;
  liveScaleWeight: number | null;
  thresholdKg: number | null;
  message: string | null;
  confirmedBy: string;
  confirmReason: string | null;
  occurredAt: string;
  receivedAt: string;
}

const EVENT_LABEL: Record<string, { text: string; cls: string }> = {
  SCALE_NOT_ZERO_OVERRIDE: { text: 'Scale Not Zero', cls: 'border-red-300 bg-red-50 text-red-700' },
  DELTA_CONFIRMED:         { text: 'Delta Confirmed', cls: 'border-blue-300 bg-blue-50 text-blue-700' },
  INTERVAL_OVERRIDE:       { text: 'Interval Override', cls: 'border-amber-300 bg-amber-50 text-amber-800' },
  DUPLICATE_OVERRIDE:      { text: 'Duplicate Override', cls: 'border-orange-300 bg-orange-50 text-orange-700' },
};

const fmtKg = (n: number | null) => n == null ? '--' : n.toLocaleString('en-IN') + ' kg';
const fmtTime = (s: string) => new Date(s).toLocaleString('en-IN', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
});

export default function WeighbridgeAudit() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [eventType, setEventType] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const limit = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { limit: String(limit), offset: String(offset) };
      if (eventType) params.eventType = eventType;
      if (search) params.search = search;
      if (from) params.from = from;
      if (to) params.to = to;
      const res = await api.get('/weighbridge/audit/events', { params });
      setRows(res.data.rows || []);
      setTotal(res.data.total || 0);
    } finally { setLoading(false); }
  }, [eventType, search, from, to, offset]);

  const loadSummary = useCallback(async () => {
    try {
      const res = await api.get('/weighbridge/audit/summary');
      setSummary(res.data.totals || {});
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadSummary(); const iv = setInterval(loadSummary, 60000); return () => clearInterval(iv); }, [loadSummary]);

  return (
    <div className="p-3 md:p-6 space-y-0">
      {/* Toolbar */}
      <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-bold tracking-wide uppercase">Weighbridge Audit</h1>
          <span className="text-xs text-slate-500">|</span>
          <span className="text-xs text-slate-500">Safety overrides & soft confirmations</span>
        </div>
        <button onClick={() => { load(); loadSummary(); }} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">
          Refresh
        </button>
      </div>

      {/* KPI strip — last 24h */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-white grid grid-cols-2 md:grid-cols-4 divide-x divide-slate-300">
        {(['SCALE_NOT_ZERO_OVERRIDE', 'DELTA_CONFIRMED', 'INTERVAL_OVERRIDE', 'DUPLICATE_OVERRIDE'] as const).map(k => (
          <div key={k} className="px-4 py-3">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{EVENT_LABEL[k].text} (24h)</div>
            <div className="text-2xl font-bold text-slate-800 tabular-nums mt-0.5">{summary[k] ?? 0}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-slate-50 px-4 py-3 flex flex-wrap gap-2 items-end">
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Event Type</label>
          <select value={eventType} onChange={e => { setOffset(0); setEventType(e.target.value); }} className="border border-slate-300 px-3 py-1.5 text-sm bg-white">
            <option value="">All</option>
            <option value="SCALE_NOT_ZERO_OVERRIDE">Scale Not Zero</option>
            <option value="DELTA_CONFIRMED">Delta Confirmed</option>
            <option value="INTERVAL_OVERRIDE">Interval Override</option>
            <option value="DUPLICATE_OVERRIDE">Duplicate Override</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Search (vehicle / ticket / user)</label>
          <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { setOffset(0); load(); } }} className="border border-slate-300 px-3 py-1.5 text-sm bg-white w-56" placeholder="MP20KA1234 / 447 / admin" />
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">From</label>
          <input type="date" value={from} onChange={e => { setOffset(0); setFrom(e.target.value); }} className="border border-slate-300 px-3 py-1.5 text-sm bg-white" />
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">To</label>
          <input type="date" value={to} onChange={e => { setOffset(0); setTo(e.target.value); }} className="border border-slate-300 px-3 py-1.5 text-sm bg-white" />
        </div>
        <button onClick={() => { setOffset(0); setEventType(''); setSearch(''); setFrom(''); setTo(''); }} className="px-3 py-1.5 bg-white border border-slate-300 text-slate-600 text-xs font-medium hover:bg-slate-50">Clear</button>
      </div>

      {/* Table */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-white overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-100 border-b border-slate-300">
            <tr className="text-left text-[10px] font-bold text-slate-600 uppercase tracking-widest">
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Event</th>
              <th className="px-3 py-2">Ticket</th>
              <th className="px-3 py-2">Vehicle</th>
              <th className="px-3 py-2">PC</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2 text-right">New Wt</th>
              <th className="px-3 py-2 text-right">Prev Wt</th>
              <th className="px-3 py-2 text-right">Live Scale</th>
              <th className="px-3 py-2">By</th>
              <th className="px-3 py-2">Reason / Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {loading && rows.length === 0 ? (
              <tr><td colSpan={11} className="px-3 py-8 text-center text-slate-500">Loading...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={11} className="px-3 py-8 text-center text-slate-500">No audit events match the current filters.</td></tr>
            ) : rows.map(r => {
              const lbl = EVENT_LABEL[r.eventType] || { text: r.eventType, cls: 'border-slate-300 bg-slate-50 text-slate-700' };
              return (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-slate-700 whitespace-nowrap">{fmtTime(r.occurredAt)}</td>
                  <td className="px-3 py-2"><span className={`inline-block px-2 py-0.5 border text-[10px] font-bold uppercase tracking-wider ${lbl.cls}`}>{lbl.text}</span></td>
                  <td className="px-3 py-2 font-mono">{r.ticketNo != null ? `T-${r.ticketNo}` : '--'}</td>
                  <td className="px-3 py-2 font-mono">{r.vehicleNo || '--'}</td>
                  <td className="px-3 py-2 font-mono text-slate-500">{r.pcId || '--'}</td>
                  <td className="px-3 py-2">{r.action || '--'}</td>
                  <td className="px-3 py-2 font-mono tabular-nums text-right">{fmtKg(r.newWeight)}</td>
                  <td className="px-3 py-2 font-mono tabular-nums text-right text-slate-500">{fmtKg(r.prevWeight)}</td>
                  <td className="px-3 py-2 font-mono tabular-nums text-right text-slate-500">{fmtKg(r.liveScaleWeight)}</td>
                  <td className="px-3 py-2 text-slate-700">{r.confirmedBy}</td>
                  <td className="px-3 py-2 text-slate-600 max-w-md">
                    {r.confirmReason && <div className="font-medium text-slate-800">{r.confirmReason}</div>}
                    {r.message && <div className="text-[11px] text-slate-500">{r.message}</div>}
                  </td>
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
    </div>
  );
}
