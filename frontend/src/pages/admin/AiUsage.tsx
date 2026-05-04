/**
 * AI Usage — Settings page showing every AI provider call (Gemini today,
 * future OpenAI/Anthropic) with token cost, success/failure, and per-feature
 * breakdown. Backed by AiCallLog table.
 *
 * Read-only admin view. Filterable by feature, model, success, time window.
 */

import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface Row {
  id: string;
  feature: string;
  provider: string;
  model: string;
  userId: string | null;
  contextRef: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  estimatedCostInr: number;
  durationMs: number;
  success: boolean;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface Summary {
  totalCalls: number;
  failures: number;
  successRate: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  estimatedCostInr: number;
  avgDurationMs: number;
}

interface Bucket {
  feature?: string;
  model?: string;
  calls: number;
  tokens: number;
  costInr: number;
}

interface ApiResp {
  rows: Row[];
  total: number;
  page: number;
  limit: number;
  summary: Summary;
  byFeature: Bucket[];
  byModel: Bucket[];
  windowDays: number;
}

const fmtInr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const fmtNum = (n: number) => n.toLocaleString('en-IN');
const fmtDate = (s: string) => new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

const AiUsage: React.FC = () => {
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [feature, setFeature] = useState('');
  const [model, setModel] = useState('');
  const [successFilter, setSuccessFilter] = useState<'' | 'true' | 'false'>('');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ days: String(days), page: String(page), limit: '100' });
      if (feature) params.set('feature', feature);
      if (model) params.set('model', model);
      if (successFilter) params.set('success', successFilter);
      const res = await api.get<ApiResp>(`/ai-usage?${params}`);
      setData(res.data);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, [days, feature, model, successFilter, page]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold tracking-wide uppercase">AI Usage</h1>
          <span className="text-[10px] text-slate-400">|</span>
          <span className="text-[10px] text-slate-400">Every Gemini / OpenAI / Anthropic call — tokens, cost, success rate</span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <label className="text-slate-300">Window</label>
          <select value={days} onChange={e => { setDays(parseInt(e.target.value, 10)); setPage(1); }}
            className="bg-slate-700 border border-slate-600 px-2 py-1 text-white">
            <option value={1}>Today</option>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={365}>1 year</option>
          </select>
          <button onClick={() => load()} className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white">Refresh</button>
        </div>
      </div>

      {/* Summary cards */}
      {data?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-0 border border-slate-300 -mx-3 md:-mx-6">
          <div className="bg-white px-3 py-2 border-r border-slate-200">
            <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Total calls</div>
            <div className="text-lg font-bold text-slate-800 font-mono tabular-nums">{fmtNum(data.summary.totalCalls)}</div>
          </div>
          <div className="bg-white px-3 py-2 border-r border-slate-200">
            <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Tokens</div>
            <div className="text-lg font-bold text-slate-800 font-mono tabular-nums">{fmtNum(data.summary.totalTokens)}</div>
            <div className="text-[9px] text-slate-500 font-mono">in {fmtNum(data.summary.inputTokens)} · out {fmtNum(data.summary.outputTokens)}</div>
          </div>
          <div className="bg-white px-3 py-2 border-r border-slate-200">
            <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Est. cost</div>
            <div className="text-lg font-bold text-emerald-700 font-mono tabular-nums">{fmtInr(data.summary.estimatedCostInr)}</div>
            <div className="text-[9px] text-slate-500 font-mono">${data.summary.estimatedCostUsd.toFixed(4)} USD</div>
          </div>
          <div className="bg-white px-3 py-2 border-r border-slate-200">
            <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Success rate</div>
            <div className={`text-lg font-bold font-mono tabular-nums ${data.summary.successRate >= 0.95 ? 'text-emerald-700' : 'text-red-700'}`}>
              {(data.summary.successRate * 100).toFixed(1)}%
            </div>
            <div className="text-[9px] text-slate-500">{fmtNum(data.summary.failures)} failures</div>
          </div>
          <div className="bg-white px-3 py-2">
            <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Avg duration</div>
            <div className="text-lg font-bold text-slate-800 font-mono tabular-nums">{(data.summary.avgDurationMs / 1000).toFixed(1)}s</div>
          </div>
        </div>
      )}

      {/* Per-feature + per-model breakdowns side by side */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 -mx-3 md:-mx-6 px-3 md:px-6">
          <div className="border border-slate-300 bg-white">
            <div className="bg-slate-100 border-b border-slate-300 px-3 py-1.5 text-[10px] font-bold text-slate-700 uppercase tracking-widest">By feature</div>
            <table className="w-full text-[11px]">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-[9px] uppercase">
                <tr>
                  <th className="text-left px-3 py-1.5">Feature</th>
                  <th className="text-right px-3 py-1.5">Calls</th>
                  <th className="text-right px-3 py-1.5">Tokens</th>
                  <th className="text-right px-3 py-1.5">Cost ₹</th>
                </tr>
              </thead>
              <tbody>
                {data.byFeature.length === 0 && <tr><td colSpan={4} className="px-3 py-3 text-center text-slate-400">No data</td></tr>}
                {data.byFeature.map(b => (
                  <tr key={b.feature} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer"
                      onClick={() => { setFeature(b.feature || ''); setPage(1); }}>
                    <td className="px-3 py-1 font-mono">{b.feature}</td>
                    <td className="px-3 py-1 text-right font-mono tabular-nums">{fmtNum(b.calls)}</td>
                    <td className="px-3 py-1 text-right font-mono tabular-nums">{fmtNum(b.tokens)}</td>
                    <td className="px-3 py-1 text-right font-mono tabular-nums font-bold">{fmtInr(b.costInr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border border-slate-300 bg-white">
            <div className="bg-slate-100 border-b border-slate-300 px-3 py-1.5 text-[10px] font-bold text-slate-700 uppercase tracking-widest">By model</div>
            <table className="w-full text-[11px]">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-[9px] uppercase">
                <tr>
                  <th className="text-left px-3 py-1.5">Model</th>
                  <th className="text-right px-3 py-1.5">Calls</th>
                  <th className="text-right px-3 py-1.5">Tokens</th>
                  <th className="text-right px-3 py-1.5">Cost ₹</th>
                </tr>
              </thead>
              <tbody>
                {data.byModel.length === 0 && <tr><td colSpan={4} className="px-3 py-3 text-center text-slate-400">No data</td></tr>}
                {data.byModel.map(b => (
                  <tr key={b.model} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer"
                      onClick={() => { setModel(b.model || ''); setPage(1); }}>
                    <td className="px-3 py-1 font-mono">{b.model}</td>
                    <td className="px-3 py-1 text-right font-mono tabular-nums">{fmtNum(b.calls)}</td>
                    <td className="px-3 py-1 text-right font-mono tabular-nums">{fmtNum(b.tokens)}</td>
                    <td className="px-3 py-1 text-right font-mono tabular-nums font-bold">{fmtInr(b.costInr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Filters strip */}
      <div className="bg-slate-100 border border-slate-300 -mx-3 md:-mx-6 px-3 py-2 flex items-center gap-2 flex-wrap text-[11px]">
        <span className="font-bold text-slate-700 uppercase tracking-widest text-[9px]">Filters</span>
        <input type="text" placeholder="feature" value={feature} onChange={e => { setFeature(e.target.value); setPage(1); }}
          className="border border-slate-300 px-2 py-1 w-40" />
        <input type="text" placeholder="model" value={model} onChange={e => { setModel(e.target.value); setPage(1); }}
          className="border border-slate-300 px-2 py-1 w-48" />
        <select value={successFilter} onChange={e => { setSuccessFilter(e.target.value as ''|'true'|'false'); setPage(1); }}
          className="border border-slate-300 px-2 py-1">
          <option value="">All</option>
          <option value="true">Success only</option>
          <option value="false">Failures only</option>
        </select>
        {(feature || model || successFilter) && (
          <button onClick={() => { setFeature(''); setModel(''); setSuccessFilter(''); setPage(1); }}
            className="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 text-[10px]">Clear</button>
        )}
        <span className="ml-auto text-slate-500">{data ? `${data.total} rows` : ''}</span>
      </div>

      {/* Log table */}
      <div className="border border-slate-300 bg-white -mx-3 md:-mx-6 overflow-x-auto">
        {loading ? (
          <div className="p-6 text-center text-xs text-slate-400">Loading…</div>
        ) : (
          <table className="w-full text-[11px]">
            <thead className="bg-slate-100 border-b border-slate-300 text-slate-600 text-[9px] uppercase">
              <tr>
                <th className="text-left px-3 py-1.5">When</th>
                <th className="text-left px-3 py-1.5">Feature</th>
                <th className="text-left px-3 py-1.5">Model</th>
                <th className="text-right px-3 py-1.5">Tokens</th>
                <th className="text-right px-3 py-1.5">Cost ₹</th>
                <th className="text-right px-3 py-1.5">Time</th>
                <th className="text-center px-3 py-1.5">Status</th>
                <th className="text-left px-3 py-1.5">Context</th>
              </tr>
            </thead>
            <tbody>
              {data?.rows.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-slate-400">No AI calls yet</td></tr>}
              {data?.rows.map(r => (
                <React.Fragment key={r.id}>
                  <tr className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}>
                    <td className="px-3 py-1 font-mono text-slate-600">{fmtDate(r.createdAt)}</td>
                    <td className="px-3 py-1 font-mono">{r.feature}</td>
                    <td className="px-3 py-1 font-mono text-slate-500">{r.model}</td>
                    <td className="px-3 py-1 text-right font-mono tabular-nums">{fmtNum(r.totalTokens)}</td>
                    <td className="px-3 py-1 text-right font-mono tabular-nums">{fmtInr(r.estimatedCostInr)}</td>
                    <td className="px-3 py-1 text-right font-mono tabular-nums text-slate-500">{(r.durationMs / 1000).toFixed(1)}s</td>
                    <td className="px-3 py-1 text-center">
                      {r.success
                        ? <span className="inline-block text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 border border-emerald-500 bg-emerald-50 text-emerald-700">OK</span>
                        : <span className="inline-block text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 border border-red-500 bg-red-50 text-red-700">FAIL</span>}
                    </td>
                    <td className="px-3 py-1 font-mono text-slate-500">{r.contextRef ?? '—'}</td>
                  </tr>
                  {expandedId === r.id && (
                    <tr className="bg-slate-50">
                      <td colSpan={8} className="px-3 py-2">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[10px]">
                          <div>
                            <div className="text-slate-500 font-bold uppercase tracking-widest mb-1">Tokens breakdown</div>
                            <div>Input: <b>{fmtNum(r.inputTokens)}</b></div>
                            <div>Output: <b>{fmtNum(r.outputTokens)}</b></div>
                            <div>Cost USD: <b>${r.estimatedCostUsd.toFixed(6)}</b></div>
                          </div>
                          <div>
                            <div className="text-slate-500 font-bold uppercase tracking-widest mb-1">Context</div>
                            <div>User: <b>{r.userId ?? '—'}</b></div>
                            <div>Ref: <b>{r.contextRef ?? '—'}</b></div>
                            <div>Provider: <b>{r.provider}</b></div>
                          </div>
                          <div>
                            <div className="text-slate-500 font-bold uppercase tracking-widest mb-1">{r.success ? 'Metadata' : 'Error'}</div>
                            {r.errorMessage && <div className="text-red-700">{r.errorMessage}</div>}
                            <pre className="text-[9px] whitespace-pre-wrap font-mono text-slate-600 max-h-32 overflow-y-auto">{JSON.stringify(r.metadata, null, 2)}</pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {data && data.total > data.limit && (
        <div className="flex items-center justify-between text-[11px] text-slate-600 px-3 py-1">
          <span>Page {data.page} · Showing {data.rows.length} of {data.total}</span>
          <div className="flex gap-1">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
              className="px-2 py-1 border border-slate-300 disabled:opacity-50 hover:bg-slate-100">Prev</button>
            <button disabled={data.page * data.limit >= data.total} onClick={() => setPage(p => p + 1)}
              className="px-2 py-1 border border-slate-300 disabled:opacity-50 hover:bg-slate-100">Next</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AiUsage;
