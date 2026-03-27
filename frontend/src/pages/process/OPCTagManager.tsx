import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

// ─── Tag catalog (mirrors tags.py on Windows) ───────────────────────────────
// This lets users browse and add tags from the ERP UI without needing
// access to the factory OPC server directly.
const TAG_CATALOG: Record<string, Record<string, { folder: string; type: string; tags: Record<string, string> }>> = {
  Fermantation: {
    ANALOG: { folder: 'ANALOG', type: 'analog', tags: {
      LT130101: 'Fermenter 1A Level', LT130102: 'Fermenter 1B Level',
      LT130201: 'Fermenter 2A Level', LT130202: 'Fermenter 2B Level',
      LT130301: 'Fermenter 3A Level', LT130302: 'Fermenter 3B Level',
      LT130401: 'Beer Well Level',
      TE130101: 'Fermenter 1A Temp', TE130201: 'Fermenter 2A Temp', TE130301: 'Fermenter 3A Temp',
      FE130701: 'Beer Well Flow',
    }},
    PID: { folder: 'PID', type: 'pid', tags: {
      DOS1_FLOW: 'Dosing Pump 1 Flow', DOS2_FLOW: 'Dosing Pump 2 Flow', DOS3_FLOW: 'Dosing Pump 3 Flow',
    }},
  },
  Distillation: {
    PID: { folder: 'PID', type: 'pid', tags: {
      FCV_140101: 'FCV 140101', FCV_140302: 'FCV 140302', FCV_140303: 'FCV 140303',
      FCV_140402: 'FCV 140402', FCV_140801: 'FCV 140801', FCV_140802: 'FCV 140802',
      LCV_140101: 'LCV 140101', LCV_140102: 'LCV 140102', LCV_140103: 'LCV 140103', LCV_140104: 'LCV 140104',
      LCV_140201: 'LCV 140201', LCV_140202: 'LCV 140202', LCV_140301: 'LCV 140301',
      LCV_140401: 'LCV 140401', LCV_140402: 'LCV 140402', LCV_140601: 'LCV 140601',
      PCV_140201: 'PCV 140201', PCV_140601: 'PCV 140601', TCV_140301: 'TCV 140301',
    }},
    ANALOG: { folder: 'ANALOG', type: 'analog', tags: {
      PT_140101: 'Pressure 140101', PT_140102: 'Pressure 140102', PT_140301: 'Pressure 140301',
      PT_140501: 'Pressure 140501', PT_140801: 'Pressure 140801',
      LT_140101: 'Level 140101', LT_140102: 'Level 140102', LT_140103: 'Level 140103',
      LT_140104: 'Level 140104', LT_140105: 'Level 140105',
      LT_140201: 'Level 140201', LT_140202: 'Level 140202', LT_140301: 'Level 140301',
      LT_140401: 'Level 140401', LT_140402: 'Level 140402', LT_140501: 'Level 140501',
      LT_140601: 'Level 140601', LT_140801: 'Level 140801', LT_140802: 'Level 140802',
      TE_140101: 'Temp 140101', TE_140102: 'Temp 140102', TE_140103: 'Temp 140103',
      TE_140104: 'Temp 140104', TE_140105: 'Temp 140105', TE_140106: 'Temp 140106',
      TE_140201: 'Temp 140201', TE_140202: 'Temp 140202', TE_140301: 'Temp 140301', TE_140801: 'Temp 140801',
    }},
  },
  Evaporation: {
    Evap_PID: { folder: 'Evap_PID', type: 'pid', tags: {
      FCV_150201: 'FCV 150201', FCV_150701: 'FCV 150701', FCV_150902: 'FCV 150902',
      'LCV_1501001': 'LCV 1501001', LCV_150101: 'LCV 150101', LCV_150201: 'LCV 150201',
      LCV_150301: 'LCV 150301', LCV_150401: 'LCV 150401', LCV_150501: 'LCV 150501',
      LCV_150601: 'LCV 150601', LCV_150701: 'LCV 150701', LCV_150703: 'LCV 150703',
      LCV_150801: 'LCV 150801', LCV_150901: 'LCV 150901', LCV_150902: 'LCV 150902',
      PCV_151101: 'PCV 151101', TCV_150701: 'TCV 150701',
    }},
    ANALOG: { folder: 'ANALOG', type: 'analog', tags: {
      LT_150101: 'Level 150101', LT_150201: 'Level 150201', LT_150301: 'Level 150301',
      LT_150401: 'Level 150401', LT_150501: 'Level 150501', LT_150601: 'Level 150601',
      LT_150701: 'Level 150701', LT_150801: 'Level 150801', LT_150901: 'Level 150901',
      PT_151101: 'Pressure 151101',
    }},
  },
  DRYER: {
    PID: { folder: 'PID', type: 'pid', tags: {
      LCV170101: 'LCV 170101', LCV170103: 'LCV 170103', LCV170104: 'LCV 170104',
      LCV180201: 'LCV 180201', LCV190102: 'LCV 190102',
      TCV180101: 'TCV 180101', PCV180101: 'PCV 180101', SV190102: 'SV 190102', VF_1811_PID: 'VF 1811',
    }},
    ANALOG: { folder: 'ANALOG', type: 'analog', tags: {
      LT170101: 'Level 170101', LT180201: 'Level 180201', LT190101: 'Level 190101', LT190102: 'Level 190102',
      PT180101: 'Pressure 180101', PT180102: 'Pressure 180102', PT180103: 'Pressure 180103',
      TE170101: 'Temp 170101', TE180101: 'Temp 180101', TE180102: 'Temp 180102',
      TE180103: 'Temp 180103', TE180104: 'Temp 180104', TE180105: 'Temp 180105',
      TE180106: 'Temp 180106', TE180107: 'Temp 180107',
      FIT180101: 'Flow 180101', FIT200101: 'Flow 200101',
    }},
  },
  Liquefication: {
    PID: { folder: 'PID', type: 'pid', tags: {
      FCV_120101: 'FCV 120101', FCV_120102: 'FCV 120102', FCV_120103: 'FCV 120103',
      FCV_120201: 'FCV 120201', LCV_120101: 'LCV 120101', PCV_120102: 'PCV 120102', PCV_120201: 'PCV 120201',
    }},
    Analog: { folder: 'Analog', type: 'analog', tags: {
      LT_120101: 'Level 120101', LT_120102: 'Level 120102', LT_120103: 'Level 120103',
      LT_120104: 'Level 120104', LT_120201: 'Level 120201',
      PT_120101: 'Pressure 120101', PT_120201: 'Pressure 120201',
      TE_120101: 'Temp 120101', TE_120201: 'Temp 120201',
    }},
  },
  MSDH: {
    PID: { folder: 'PID', type: 'pid', tags: {
      FCV_160101: 'FCV 160101', FCV_160301: 'FCV 160301', LCV_160201: 'LCV 160201',
      'LCV_160201-1': 'LCV 160201-1', PCV_160103: 'PCV 160103', PCV_160201: 'PCV 160201',
      PIC_160101: 'PIC 160101', PIC_160102: 'PIC 160102', PIC_160103: 'PIC 160103',
      PIC_160201: 'PIC 160201', TCV_160101: 'TCV 160101',
    }},
    ANALOG: { folder: 'ANALOG', type: 'analog', tags: {
      LT_160201: 'Level 160201', LT_160202: 'Level 160202', LT_160301: 'Level 160301',
      PT_160101: 'Pressure 160101', PT_160102: 'Pressure 160102', PT_160103: 'Pressure 160103',
      TE_160101: 'Temp 160101', TE_160201: 'Temp 160201',
    }},
  },
  DECANTOR: {
    PID: { folder: 'PID', type: 'pid', tags: {} },
    ANALOG: { folder: 'ANALOG', type: 'analog', tags: {} },
  },
};

// ─── Interfaces ─────────────────────────────────────────────────────────────

interface MonitoredTag {
  id?: string;
  tag: string;
  area: string;
  folder: string;
  tagType: string;
  label: string;
  active?: boolean;
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

type Tab = 'live' | 'monitored' | 'browse' | 'stats';

// ─── Component ──────────────────────────────────────────────────────────────

export default function OPCTagManager() {
  const [tab, setTab] = useState<Tab>('live');
  const [health, setHealth] = useState<HealthData | null>(null);
  const [liveTags, setLiveTags] = useState<LiveTag[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [monitored, setMonitored] = useState<MonitoredTag[]>([]);
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Browse state
  const [browseArea, setBrowseArea] = useState('');
  const [browseFolder, setBrowseFolder] = useState('');
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState<Set<string>>(new Set());

  const checkHealth = useCallback(async () => {
    try {
      const res = await api.get('/opc/health');
      setHealth(res.data);
      setError('');
    } catch (err: unknown) {
      setHealth(null);
      const e = err as { response?: { data?: { error?: string } } };
      setError(e?.response?.data?.error || 'OPC service unavailable');
    }
  }, []);

  useEffect(() => { checkHealth(); }, [checkHealth]);

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
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e?.response?.data?.error || 'Failed to fetch live data');
    } finally {
      setLiveLoading(false);
    }
  }

  async function fetchMonitored() {
    try {
      const res = await api.get('/opc/monitor');
      setMonitored(res.data.tags || []);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e?.response?.data?.error || 'Failed to fetch tags');
    }
  }

  async function fetchStats() {
    try {
      const res = await api.get('/opc/stats');
      setStats(res.data);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e?.response?.data?.error || 'Failed to fetch stats');
    }
  }

  // ─── Tag management ───────────────────────────────────────────────────

  async function addTag(tag: string, area: string, folder: string, tagType: string, label: string) {
    setAdding(prev => new Set(prev).add(tag));
    try {
      await api.post('/opc/monitor', { tag, area, folder, tagType, label });
      setSuccess(`Added ${tag} to monitoring`);
      setTimeout(() => setSuccess(''), 3000);
      fetchMonitored();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e?.response?.data?.error || `Failed to add ${tag}`);
    } finally {
      setAdding(prev => { const s = new Set(prev); s.delete(tag); return s; });
    }
  }

  async function removeTag(tag: string) {
    setRemoving(prev => new Set(prev).add(tag));
    try {
      await api.delete(`/opc/monitor/${tag}`);
      setSuccess(`Removed ${tag} from monitoring`);
      setTimeout(() => setSuccess(''), 3000);
      setMonitored(prev => prev.filter(t => t.tag !== tag));
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e?.response?.data?.error || `Failed to remove ${tag}`);
    } finally {
      setRemoving(prev => { const s = new Set(prev); s.delete(tag); return s; });
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  const monitoredSet = new Set(monitored.map(t => t.tag));

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

  // Get browse tags for selected area/folder
  const browseTags = browseArea && browseFolder && TAG_CATALOG[browseArea]?.[browseFolder]
    ? TAG_CATALOG[browseArea][browseFolder]
    : null;

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

        {/* Messages */}
        {error && (
          <div className="bg-red-50 border border-red-200 px-4 py-2 -mx-3 md:-mx-6 flex items-center justify-between">
            <span className="text-xs text-red-700">{error}</span>
            <button onClick={() => setError('')} className="text-xs text-red-400 hover:text-red-600">dismiss</button>
          </div>
        )}
        {success && (
          <div className="bg-green-50 border border-green-200 px-4 py-2 -mx-3 md:-mx-6">
            <span className="text-xs text-green-700">{success}</span>
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
          {(['live', 'monitored', 'browse', 'stats'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-[11px] font-bold uppercase tracking-widest border-b-2 ${tab === t ? 'border-blue-600 text-blue-700 bg-blue-50/50' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
              {t === 'live' ? 'Live Data' : t === 'monitored' ? 'Monitored Tags' : t === 'browse' ? 'Add Tags' : 'Statistics'}
            </button>
          ))}
        </div>

        {/* ═══════════════════ LIVE DATA ═══════════════════ */}
        {tab === 'live' && (
          <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
            {liveTags.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <div className="text-xs text-slate-400 uppercase tracking-widest">{liveLoading ? 'Loading...' : 'No monitored tags'}</div>
                <div className="text-xs text-slate-400 mt-2">Go to "Add Tags" tab to start monitoring OPC tags</div>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Tag</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Area</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Label</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Value</th>
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
                      <td className="px-3 py-1.5 text-center text-slate-400">{fmtAgo(t.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {liveLoading && liveTags.length > 0 && <div className="px-4 py-1 text-[10px] text-slate-400 uppercase tracking-widest bg-slate-50 border-t border-slate-200">Refreshing...</div>}
          </div>
        )}

        {/* ═══════════════════ MONITORED TAGS ═══════════════════ */}
        {tab === 'monitored' && (
          <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
            {monitored.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <div className="text-xs text-slate-400 uppercase tracking-widest">No tags being monitored</div>
                <div className="text-xs text-slate-400 mt-2">Go to "Add Tags" tab to start monitoring OPC tags</div>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Tag</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Area</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Folder</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Type</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Label</th>
                    <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Action</th>
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
                      <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{t.label}</td>
                      <td className="px-3 py-1.5 text-center">
                        <button
                          onClick={() => removeTag(t.tag)}
                          disabled={removing.has(t.tag)}
                          className="px-2 py-0.5 bg-red-50 border border-red-200 text-red-600 text-[10px] font-bold uppercase hover:bg-red-100 disabled:opacity-50"
                        >
                          {removing.has(t.tag) ? 'Removing...' : 'Remove'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ═══════════════════ BROWSE / ADD TAGS ═══════════════════ */}
        {tab === 'browse' && (
          <>
            {/* Filter bar */}
            <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-3 -mx-3 md:-mx-6 flex flex-wrap items-end gap-4">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Area</label>
                <select
                  value={browseArea}
                  onChange={e => { setBrowseArea(e.target.value); setBrowseFolder(''); }}
                  className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white min-w-[160px]"
                >
                  <option value="">Select area...</option>
                  {Object.keys(TAG_CATALOG).map(a => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>
              {browseArea && (
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Folder</label>
                  <select
                    value={browseFolder}
                    onChange={e => setBrowseFolder(e.target.value)}
                    className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white min-w-[160px]"
                  >
                    <option value="">Select folder...</option>
                    {Object.keys(TAG_CATALOG[browseArea] || {}).map(f => (
                      <option key={f} value={f}>{f} ({Object.keys(TAG_CATALOG[browseArea][f].tags).length} tags)</option>
                    ))}
                  </select>
                </div>
              )}
              {browseTags && (
                <div className="text-xs text-slate-500 pb-1">
                  {Object.keys(browseTags.tags).length} tags available |{' '}
                  {Object.keys(browseTags.tags).filter(t => monitoredSet.has(t)).length} already monitored
                </div>
              )}
            </div>

            {/* Tag list */}
            <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
              {!browseArea || !browseFolder ? (
                <div className="px-4 py-8 text-center">
                  <div className="text-xs text-slate-400 uppercase tracking-widest">Select an area and folder to browse tags</div>
                  <div className="text-xs text-slate-400 mt-2">Tags added here will be synced to the factory PC within ~3 minutes</div>
                </div>
              ) : !browseTags || Object.keys(browseTags.tags).length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <div className="text-xs text-slate-400 uppercase tracking-widest">No tags in this folder</div>
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-800 text-white">
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Tag</th>
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Label</th>
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Type</th>
                      <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
                      <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(browseTags.tags).map(([tagName, label], i) => {
                      const isMonitored = monitoredSet.has(tagName);
                      return (
                        <tr key={tagName} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                          <td className="px-3 py-1.5 font-mono text-slate-800 border-r border-slate-100">{tagName}</td>
                          <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{label}</td>
                          <td className="px-3 py-1.5 border-r border-slate-100">
                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${browseTags.type === 'pid' ? 'border-blue-300 bg-blue-50 text-blue-600' : 'border-slate-300 bg-slate-50 text-slate-600'}`}>
                              {browseTags.type}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-center border-r border-slate-100">
                            {isMonitored ? (
                              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-green-300 bg-green-50 text-green-600">Monitored</span>
                            ) : (
                              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-200 bg-slate-50 text-slate-400">Not Monitored</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            {isMonitored ? (
                              <button
                                onClick={() => removeTag(tagName)}
                                disabled={removing.has(tagName)}
                                className="px-2 py-0.5 bg-red-50 border border-red-200 text-red-600 text-[10px] font-bold uppercase hover:bg-red-100 disabled:opacity-50"
                              >
                                {removing.has(tagName) ? '...' : 'Remove'}
                              </button>
                            ) : (
                              <button
                                onClick={() => addTag(tagName, browseArea, browseTags.folder, browseTags.type, label)}
                                disabled={adding.has(tagName)}
                                className="px-2 py-0.5 bg-blue-600 border border-blue-700 text-white text-[10px] font-bold uppercase hover:bg-blue-700 disabled:opacity-50"
                              >
                                {adding.has(tagName) ? '...' : '+ Add'}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {/* ═══════════════════ STATS ═══════════════════ */}
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

        {/* Info footer */}
        <div className="mt-4 px-1 text-[10px] text-slate-400">
          Tags added/removed here sync to the factory PC automatically (~3 min). Factory scans every 2 min, pushes to cloud every 2.5 min.
        </div>
      </div>
    </div>
  );
}
