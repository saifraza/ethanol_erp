import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface MonitoredTag {
  tag: string;
  area: string;
  folder: string;
  tagType: string;
  label: string;
}

interface LiveTag {
  tag: string;
  area: string;
  type: string;
  label: string;
  updatedAt: string | null;
  values: Record<string, number>;
}

interface HealthData {
  online: boolean;
  monitoredTags: number;
  lastScan: string | null;
  lastSync: string | null;
}

type Tab = 'live' | 'monitored' | 'stats';

export default function OPCTagManager() {
  const [tab, setTab] = useState<Tab>('live');
  const [health, setHealth] = useState<HealthData | null>(null);
  const [liveTags, setLiveTags] = useState<LiveTag[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [monitored, setMonitored] = useState<MonitoredTag[]>([]);
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState('');

  const checkHealth = useCallback(async () => {
    try {
      const res = await api.get('/opc/health');
      setHealth(res.data);
      setError('');
    } catch (err: any) {
      setHealth(null);
      setError(err?.response?.data?.error || 'OPC service unavailable');
    }
  }, []);

  useEffect(() => { checkHealth(); }, [checkHealth]);

  // Auto-refresh live data
  useEffect(() => {
    if (tab !== 'live') return;
    fetchLive();
    const interval = setInterval(fetchLive, 30000);
    return () => clearInterval(interval);
  }, [tab]);

  useEffect(() => {
    if (tab === 'monitored') fetchMonitored();
    if (tab === 'stats') fetchStats();
  }, [tab]);

  async function fetchLive() {
    try {
      setLiveLoading(true);
      const res = await api.get('/opc/live');
      setLiveTags(res.data.tags || []);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to fetch live data');
    } finally {
      setLiveLoading(false);
    }
  }

  async function fetchMonitored() {
    try {
      const res = await api.get('/opc/monitor');
      setMonitored(res.data.tags || []);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to fetch tags');
    }
  }

  async function fetchStats() {
    try {
      const res = await api.get('/opc/stats');
      setStats(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to fetch stats');
    }
  }

  const fmtVal = (v: number | undefined) => v != null ? v.toFixed(2) : '--';

  const fmtTime = (iso: string | null) => {
    if (!iso) return '--';
    const d = new Date(iso);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  };

  const fmtAgo = (iso: string | null) => {
    if (!iso) return 'never';
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return `${Math.floor(diff / 3600000)}h ago`;
  };

  const online = health?.online ?? false;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">OPC Live</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">ABB 800xA Plant Automation</span>
          </div>
          <div className="flex items-center gap-3">
            <span className={`inline-block w-2 h-2 ${online ? 'bg-green-400' : health ? 'bg-red-400' : 'bg-yellow-400'}`} />
            <span className="text-[10px] text-slate-300">
              {health === null ? 'LOADING...' : online ? `LIVE (${fmtAgo(health.lastScan)})` : `OFFLINE (last: ${fmtAgo(health.lastScan)})`}
            </span>
            <button onClick={() => { checkHealth(); if (tab === 'live') fetchLive(); }} className="px-2 py-0.5 bg-slate-700 text-[10px] text-slate-300 hover:bg-slate-600">REFRESH</button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 px-4 py-2 -mx-3 md:-mx-6 flex items-center justify-between">
            <span className="text-xs text-red-700">{error}</span>
            <button onClick={() => setError('')} className="text-xs text-red-400 hover:text-red-600">dismiss</button>
          </div>
        )}

        {/* KPIs */}
        {health && (
          <div className="grid grid-cols-4 border-x border-b border-slate-300 -mx-3 md:-mx-6">
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Monitored</div>
              <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{health.monitoredTags}</div>
            </div>
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status</div>
              <div className={`text-xl font-bold mt-1 ${online ? 'text-green-600' : 'text-red-500'}`}>{online ? 'ONLINE' : 'OFFLINE'}</div>
            </div>
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-amber-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Last Scan</div>
              <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtTime(health.lastScan)}</div>
            </div>
            <div className="bg-white px-4 py-3 border-l-4 border-l-purple-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Last Sync</div>
              <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtTime(health.lastSync)}</div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6 bg-white">
          {(['live', 'monitored', 'stats'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-[11px] font-bold uppercase tracking-widest border-b-2 ${tab === t ? 'border-blue-600 text-blue-700 bg-blue-50/50' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
              {t === 'live' ? 'Live Data' : t === 'monitored' ? 'Monitored Tags' : 'Statistics'}
            </button>
          ))}
        </div>

        {/* LIVE DATA */}
        {tab === 'live' && (
          <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
            {liveTags.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <div className="text-xs text-slate-400 uppercase tracking-widest">{liveLoading ? 'Loading...' : 'No monitored tags'}</div>
                <div className="text-xs text-slate-400 mt-2">Add tags via the factory Windows API (Tailscale)</div>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Tag</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Area</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Label</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">PV / Value</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">SP</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">OP</th>
                    <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {liveTags.map((t, i) => (
                    <tr key={t.tag} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                      <td className="px-3 py-1.5 font-mono text-slate-800 border-r border-slate-100">{t.tag}</td>
                      <td className="px-3 py-1.5 text-slate-500 border-r border-slate-100">{t.area}</td>
                      <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{t.label}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 border-r border-slate-100 font-bold">
                        {fmtVal(t.values.PV ?? t.values.IO_VALUE)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-500 border-r border-slate-100">{fmtVal(t.values.SP)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-500 border-r border-slate-100">{fmtVal(t.values.OP)}</td>
                      <td className="px-3 py-1.5 text-center text-slate-400">{fmtAgo(t.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {liveLoading && liveTags.length > 0 && <div className="px-4 py-1 text-[10px] text-slate-400 uppercase tracking-widest bg-slate-50 border-t border-slate-200">Refreshing...</div>}
          </div>
        )}

        {/* MONITORED TAGS */}
        {tab === 'monitored' && (
          <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
            {monitored.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <div className="text-xs text-slate-400 uppercase tracking-widest">No tags being monitored</div>
                <div className="text-xs text-slate-400 mt-2">Tags are added via the factory OPC API (http://100.74.209.72:8099/monitor)</div>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Tag</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Area</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Folder</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Type</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Label</th>
                  </tr>
                </thead>
                <tbody>
                  {monitored.map((t, i) => (
                    <tr key={t.tag} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                      <td className="px-3 py-1.5 font-mono text-slate-800 border-r border-slate-100">{t.tag}</td>
                      <td className="px-3 py-1.5 text-slate-500 border-r border-slate-100">{t.area}</td>
                      <td className="px-3 py-1.5 text-slate-500 border-r border-slate-100">{t.folder}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${t.tagType === 'pid' ? 'border-blue-300 bg-blue-50 text-blue-600' : 'border-slate-300 bg-slate-50 text-slate-600'}`}>{t.tagType}</span>
                      </td>
                      <td className="px-3 py-1.5 text-slate-600">{t.label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* STATS */}
        {tab === 'stats' && (
          <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300">
            {!stats ? (
              <div className="px-4 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4">
                {Object.entries(stats).map(([k, v]) => (
                  <div key={k} className="bg-white px-4 py-3 border-r border-b border-slate-200">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{k.replace(/([A-Z])/g, ' $1')}</div>
                    <div className="text-lg font-bold text-slate-800 mt-1 font-mono tabular-nums">{typeof v === 'number' ? v.toLocaleString() : v}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
