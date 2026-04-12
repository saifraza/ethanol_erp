import React, { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Area, ComposedChart, Brush, Legend } from 'recharts';
import api from '../../services/api';

// ─── Tag catalog (mirrors tags.py on Windows) ───────────────────────────────
const TAG_CATALOG: Record<string, Record<string, { folder: string; type: string; tags: Record<string, string> }>> = {
  Fermantation: {
    ANALOG: { folder: 'ANALOG', type: 'analog', tags: {
      LT130101: 'PF-1 Level', LT130102: 'PF-2 Level',
      LT130201: 'Fermenter 1 Level', LT130202: 'Fermenter 2 Level',
      LT130301: 'Fermenter 3 Level', LT130302: 'Fermenter 4 Level',
      LT130401: 'Beer Well Level',
      TE130101: 'PF-1 Temp', TE130102: 'PF-2 Temp',
      TE130201: 'Fermenter 1 Temp', TE130202: 'Fermenter 2 Temp',
      TE130301: 'Fermenter 3 Temp', TE130302: 'Fermenter 4 Temp',
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
    '24HR_TOT': { folder: '24HR_TOT', type: 'totalizer', tags: {
      MG_140101: 'Wash Feed Total (M³)', FE_140201: 'RS Flow Total', FE_140301: 'ENA Flow Total',
      FE_140302: 'Flow 140302', FE_140303: 'Flow 140303', FE_140401: 'Flow 140401',
      FE_140601: 'Flow 140601', FE_140801: 'Spent Wash Total',
      FI_140301: 'FI 140301', FI_140302: 'FI 140302',
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
      'LT_1501001': 'Level 1501001', LT_150102: 'Level 150102', LT_150703: 'Level 150703',
      LT_150902: 'Level 150902',
      PT_151101: 'Pressure 151101',
      TE_150101: 'Temp 150101', TE_150201: 'Temp 150201', TE_150301: 'Temp 150301',
      TE_150401: 'Temp 150401', TE_150501: 'Temp 150501', TE_150601: 'Temp 150601',
      TE_150701: 'Temp 150701', TE_150801: 'Temp 150801', TE_150901: 'Temp 150901',
      'TE_1501001': 'Temp 1501001', 'TE_1501002': 'Temp 1501002',
      TE_150102: 'Temp 150102', TE_150103: 'Temp 150103', TE_150104: 'Temp 150104',
      'TE_1501101': 'Temp 1501101', 'TE_1501102': 'Temp 1501102',
      TE_150202: 'Temp 150202', TE_150204: 'Temp 150204', TE_150205: 'Temp 150205',
      'TE_150701_1': 'Temp 150701-1', 'TE_150702': 'Temp 150702', 'TE_150702_2': 'Temp 150702-2',
      'TE_150703': 'Temp 150703', 'TE_150703_1': 'Temp 150703-1', TE_150704: 'Temp 150704',
      'TE_150704_1': 'Temp 150704-1', TE_150802: 'Temp 150802',
      TE_150902: 'Temp 150902', TE_150903: 'Temp 150903', TE_150904: 'Temp 150904',
      TE_150905: 'Temp 150905', TE_150906: 'Temp 150906',
      FE_150101: 'Flow 150101', FE_150201: 'Flow 150201', FE_150701: 'Flow 150701', FE_150901: 'Flow 150901',
      MG_150101: 'Totalizer 150101', MG_150201: 'Totalizer 150201',
      CM_150101: 'Concentration 150101', CM_150901: 'Concentration 150901',
      DM_150701: 'RC Density (kg/m3)',
    }},
  },
  Dryer: {
    PID: { folder: 'PID', type: 'pid', tags: {
      FCV_160101: 'FCV 160101',
    }},
    ANALOG: { folder: 'ANALOG', type: 'analog', tags: {
      TE_160101: 'Temp 160101', TE_160102: 'Temp 160102', TE_160103: 'Temp 160103',
    }},
  },
  Liquefication: {
    PID: { folder: 'PID', type: 'pid', tags: {
      FCV_120101: 'FCV 120101', FCV_120102: 'FCV 120102', FCV_120103: 'FCV 120103',
    }},
    ANALOG: { folder: 'ANALOG', type: 'analog', tags: {
      LT_120101: 'Level 120101', LT_120102: 'FLT Level', LT_120103: 'ILT Level',
      LT_120104: 'Level 120104', LT_120201: 'Level 120201',
      PT_120101: 'Pressure 120101', PT_120201: 'Pressure 120201',
      TE_120101: 'FLT Temp', TE_120201: 'ILT Temp',
      MG_120103: 'Flow 120103', MG_120104: 'Flow 120104', MG_120301: 'Flow 120301',
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

interface LiveTag {
  tag: string;
  area: string;
  type: string;
  label: string;
  description: string;
  hhAlarm: number | null;
  llAlarm: number | null;
  updatedAt: string | null;
  values: Record<string, number>;
}

interface HourlyReading {
  hour: string;
  avg: number;
  min: number;
  max: number;
  count: number;
}

interface TagStats {
  mean: number;
  min: number;
  max: number;
  range: number;
  stdDev: number;
  samples: number;
  trend: number; // % change over period
  lastValue: number;
}

interface HealthData {
  online: boolean;
  monitoredTags: number;
  lastScan: string | null;
  lastSync: string | null;
}

type Tab = 'live' | 'browse' | 'stats';

// ─── Component ──────────────────────────────────────────────────────────────

export default function OPCTagManager({ source }: { source?: 'ETHANOL' | 'SUGAR' }) {
  const [tab, setTab] = useState<Tab>('live');
  const [health, setHealth] = useState<HealthData | null>(null);
  const [liveTags, setLiveTags] = useState<LiveTag[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [bridgeHealth, setBridgeHealth] = useState<{ reachable: boolean; pendingSyncs?: number; uptimeSeconds?: number; monitoredTags?: number; lastScan?: string } | null>(null);
  const [alarmsEnabled, setAlarmsEnabled] = useState<boolean | null>(null);
  const [alarmToggling, setAlarmToggling] = useState(false);

  // Bridge status & gap detection
  const [bridgeStatus, setBridgeStatus] = useState<{
    online: boolean; ageSeconds: number;
    heartbeat: { uptimeSeconds: number; opcConnected: boolean; queueDepth: number; dbSizeMb: number;
      health: { scannerAlive: boolean; syncAlive: boolean; apiAlive: boolean; threadRestarts: Record<string, number> };
      system: { cpuPercent: number; memoryMb: number; diskFreeGb: number; sleepDisabled: boolean };
      version: string } | null;
  } | null>(null);
  const [gapData, setGapData] = useState<{
    gaps: { from: string; to: string; durationMinutes: number }[];
    totalGapMinutes: number; currentlyGapped: boolean; lastReading: string | null;
  } | null>(null);

  // Browse state
  const [browseArea, setBrowseArea] = useState('');
  const [browseFolder, setBrowseFolder] = useState('');
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState<Set<string>>(new Set());

  // Edit state
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ description: '', hhAlarm: '', llAlarm: '' });
  const [saving, setSaving] = useState(false);

  // Detail/history state
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [historyData, setHistoryData] = useState<HourlyReading[]>([]);
  const [historyHours, setHistoryHours] = useState(24);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [yZoom, setYZoom] = useState(0); // 0 = auto, positive = zoom in levels
  const [tagStats, setTagStats] = useState<TagStats | null>(null);

  const checkHealth = useCallback(async () => {
    try {
      const sq = source ? `?source=${source}` : '';
      const res = await api.get(`/opc/health${sq}`);
      setHealth(res.data);
      setError('');
    } catch (err: unknown) {
      setHealth(null);
      const e = err as { response?: { data?: { error?: string } } };
      setError(e?.response?.data?.error || 'OPC service unavailable');
    }
    // Bridge status via phone-home heartbeat (no Tailscale needed)
    const sq = source ? `?source=${source}` : '';
    api.get(`/opc/bridge-status${sq}`).then(r => setBridgeStatus(r.data)).catch(() => {});
    // Gap detection
    api.get(`/opc/gaps?hours=24${source ? `&source=${source}` : ''}`).then(r => setGapData(r.data)).catch(() => {});
    // Fetch alarm status (non-blocking)
    api.get('/opc/alarms/status').then(r => setAlarmsEnabled(r.data.enabled)).catch(() => {});
  }, []);

  const toggleAlarms = useCallback(async () => {
    setAlarmToggling(true);
    try {
      const res = await api.post('/opc/alarms/toggle');
      setAlarmsEnabled(res.data.enabled);
      setSuccess(`Alarms ${res.data.enabled ? 'enabled' : 'disabled'}`);
      setTimeout(() => setSuccess(''), 3000);
    } catch {
      setError('Failed to toggle alarms');
    } finally {
      setAlarmToggling(false);
    }
  }, []);

  useEffect(() => { checkHealth(); }, [checkHealth, source]);

  useEffect(() => {
    if (tab !== 'live') return;
    fetchLive();
    const interval = setInterval(fetchLive, 30000);
    return () => clearInterval(interval);
  }, [tab]);

  useEffect(() => {
    if (tab === 'stats') fetchStats();
  }, [tab]);

  async function fetchLive() {
    try {
      setLiveLoading(true);
      const res = await api.get(`/opc/live${source ? `?source=${source}` : ''}`);
      setLiveTags(res.data.tags || []);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e?.response?.data?.error || 'Failed to fetch live data');
    } finally {
      setLiveLoading(false);
    }
  }

  async function fetchHistory(tag: string, hours: number = 24) {
    setHistoryLoading(true);
    try {
      const t = liveTags.find(lt => lt.tag === tag);
      const prop = t?.type === 'pid' ? 'PV' : t?.type === 'totalizer' ? 'PRV_HR' : 'IO_VALUE';
      const res = await api.get(`/opc/history/${encodeURIComponent(tag)}?hours=${hours}&property=${prop}${source ? `&source=${source}` : ''}`);
      const data: HourlyReading[] = res.data.readings || [];
      setHistoryData(data);

      // Calculate statistics
      if (data.length > 0) {
        const avgs = data.map(d => d.avg);
        const allMin = Math.min(...data.map(d => d.min));
        const allMax = Math.max(...data.map(d => d.max));
        const mean = avgs.reduce((a, b) => a + b, 0) / avgs.length;
        const variance = avgs.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / avgs.length;
        const stdDev = Math.sqrt(variance);
        const totalSamples = data.reduce((s, d) => s + d.count, 0);
        const firstAvg = avgs[0];
        const lastAvg = avgs[avgs.length - 1];
        const trend = firstAvg !== 0 ? ((lastAvg - firstAvg) / firstAvg) * 100 : 0;

        setTagStats({
          mean: Math.round(mean * 100) / 100,
          min: Math.round(allMin * 100) / 100,
          max: Math.round(allMax * 100) / 100,
          range: Math.round((allMax - allMin) * 100) / 100,
          stdDev: Math.round(stdDev * 100) / 100,
          samples: totalSamples,
          trend: Math.round(trend * 10) / 10,
          lastValue: Math.round(lastAvg * 100) / 100,
        });
      } else {
        setTagStats(null);
      }
    } catch { setTagStats(null); setHistoryData([]); }
    finally { setHistoryLoading(false); }
  }

  function selectTag(tag: string) {
    if (selectedTag === tag) { setSelectedTag(null); return; }
    setSelectedTag(tag);
    setYZoom(0);
    fetchHistory(tag, historyHours);
  }

  async function fetchStats() {
    try {
      const res = await api.get(`/opc/stats${source ? `?source=${source}` : ''}`);
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
      await api.post('/opc/monitor', { tag, area, folder, tagType, label, source });
      setSuccess(`Added ${tag}`);
      setTimeout(() => setSuccess(''), 3000);
      fetchLive();
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
      setSuccess(`Removed ${tag}`);
      setTimeout(() => setSuccess(''), 3000);
      setLiveTags(prev => prev.filter(t => t.tag !== tag));
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e?.response?.data?.error || `Failed to remove ${tag}`);
    } finally {
      setRemoving(prev => { const s = new Set(prev); s.delete(tag); return s; });
    }
  }

  async function updateTag(tag: string) {
    setSaving(true);
    try {
      const data: Record<string, unknown> = {};
      if (editForm.description !== undefined) data.description = editForm.description;
      data.hhAlarm = editForm.hhAlarm ? parseFloat(editForm.hhAlarm) : null;
      data.llAlarm = editForm.llAlarm ? parseFloat(editForm.llAlarm) : null;
      await api.patch(`/opc/monitor/${tag}`, data);
      setSuccess(`Updated ${tag}`);
      setTimeout(() => setSuccess(''), 3000);
      setEditingTag(null);
      fetchLive();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e?.response?.data?.error || `Failed to update ${tag}`);
    } finally {
      setSaving(false);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  const monitoredSet = new Set(liveTags.map(t => t.tag));

  const fmtVal = (v: number | undefined) => v != null ? v.toFixed(2) : '--';

  const fmtTime = (iso: string | null) => {
    if (!iso) return '--';
    const d = new Date(iso);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  };

  const fmtAgo = (iso: string | null) => {
    if (!iso) return 'awaiting scan';
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return `${Math.floor(diff / 3600000)}h ago`;
  };

  const isStale = (iso: string | null) => {
    if (!iso) return true;
    return Date.now() - new Date(iso).getTime() > 10 * 60 * 1000; // >10 min
  };

  const online = health?.online ?? false;

  // Alarm status for a value
  const getAlarmStatus = (value: number | undefined, hh: number | null, ll: number | null) => {
    if (value == null) return null;
    if (hh != null && value >= hh) return 'HH';
    if (ll != null && value <= ll) return 'LL';
    return null;
  };

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
            <h1 className="text-sm font-bold tracking-wide uppercase">{source === 'SUGAR' ? 'OPC Live — Sugar Plant' : 'OPC Live — Ethanol Plant'}</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">{source === 'SUGAR' ? 'Fuji DCS Plant Automation' : 'ABB 800xA Plant Automation'}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className={`inline-block w-2 h-2 ${online ? 'bg-green-400' : health ? 'bg-red-400' : 'bg-yellow-400'}`} />
            <span className="text-[10px] text-slate-300">
              {health === null ? 'LOADING...' : online ? `ONLINE (${fmtAgo(health.lastScan)})` : `OFFLINE (last: ${fmtAgo(health.lastScan)})`}
            </span>
            {alarmsEnabled !== null && (
              <button onClick={toggleAlarms} disabled={alarmToggling}
                className={`px-2 py-0.5 text-[10px] font-bold ${alarmsEnabled ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-red-600 text-white hover:bg-red-700'}`}>
                {alarmToggling ? '...' : alarmsEnabled ? 'ALARMS ON' : 'ALARMS OFF'}
              </button>
            )}
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

        {/* Gap Warning Banner */}
        {gapData?.currentlyGapped && (
          <div className="bg-red-600 text-white px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wide">NO DATA</span>
            <span className="text-xs">No OPC readings received in last 15 minutes. Bridge may be offline.</span>
          </div>
        )}
        {gapData && !gapData.currentlyGapped && gapData.gaps.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 px-4 py-2 -mx-3 md:-mx-6">
            <span className="text-xs text-amber-800 font-semibold">DATA GAPS (24h): </span>
            <span className="text-xs text-amber-700">
              {gapData.gaps.map((g, i) => {
                const from = new Date(g.from).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
                const to = new Date(g.to).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
                return `${from}–${to}`;
              }).join(', ')}
              {' '}({Math.round(gapData.totalGapMinutes / 60 * 10) / 10}h total lost)
            </span>
          </div>
        )}

        {/* Bridge Status Card */}
        {bridgeStatus?.heartbeat && (
          <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 bg-white">
            <div className="px-4 py-2 flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className={`inline-block w-2 h-2 ${bridgeStatus.online ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Bridge</span>
              </div>
              <div className="text-[10px] text-slate-500">
                <span className="font-semibold text-slate-700">Uptime:</span> {Math.round(bridgeStatus.heartbeat.uptimeSeconds / 3600)}h
              </div>
              <div className="text-[10px] text-slate-500">
                <span className="font-semibold text-slate-700">CPU:</span> {bridgeStatus.heartbeat.system.cpuPercent.toFixed(1)}%
              </div>
              <div className="text-[10px] text-slate-500">
                <span className="font-semibold text-slate-700">RAM:</span> {bridgeStatus.heartbeat.system.memoryMb}MB
              </div>
              <div className="text-[10px] text-slate-500">
                <span className="font-semibold text-slate-700">Disk:</span> {bridgeStatus.heartbeat.system.diskFreeGb.toFixed(0)}GB free
              </div>
              <div className="text-[10px] text-slate-500">
                <span className="font-semibold text-slate-700">Queue:</span> {bridgeStatus.heartbeat.queueDepth}
              </div>
              <div className="text-[10px] text-slate-500">
                <span className="font-semibold text-slate-700">OPC:</span>{' '}
                <span className={bridgeStatus.heartbeat.opcConnected ? 'text-green-600' : 'text-red-500'}>
                  {bridgeStatus.heartbeat.opcConnected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
              {!bridgeStatus.heartbeat.system.sleepDisabled && (
                <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 border border-red-200">SLEEP ENABLED</span>
              )}
              <div className="text-[10px] text-slate-400 ml-auto">
                v{bridgeStatus.heartbeat.version} | {bridgeStatus.ageSeconds}s ago
              </div>
            </div>
          </div>
        )}

        {/* Bridge status is determined by lastSync in the health endpoint — no separate bridge check needed */}

        {/* Tabs — no more "Monitored Tags" */}
        <div className="flex gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6 bg-white">
          {(['live', 'browse', 'stats'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-[11px] font-bold uppercase tracking-widest border-b-2 ${tab === t ? 'border-blue-600 text-blue-700 bg-blue-50/50' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
              {t === 'live' ? 'Live Data' : t === 'browse' ? 'Add Tags' : 'Statistics'}
            </button>
          ))}
        </div>

        {/* ═══════════════════ LIVE DATA (merged with monitored) ═══════════════════ */}
        {tab === 'live' && (
          <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
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
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Description</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Value</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">LL</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">HH</th>
                    <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Updated</th>
                    <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest w-24">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {liveTags.map((t, i) => {
                    const val = t.values.PV ?? t.values.IO_VALUE ?? t.values.PRV_HR ?? t.values.INPUT;
                    const alarm = getAlarmStatus(val, t.hhAlarm, t.llAlarm);
                    const stale = isStale(t.updatedAt);

                    if (editingTag === t.tag) {
                      return (
                        <tr key={t.tag} className="border-b border-slate-100 bg-blue-50/30">
                          <td className="px-3 py-1.5 font-mono text-slate-800 border-r border-slate-100">{t.tag}</td>
                          <td className="px-1 py-1 border-r border-slate-100">
                            <input value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                              className="border border-slate-300 px-2 py-1 text-xs w-full focus:outline-none focus:ring-1 focus:ring-blue-400" placeholder="e.g. Fermenter 1A Level" />
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 border-r border-slate-100 font-bold">{fmtVal(val)}</td>
                          <td className="px-1 py-1 border-r border-slate-100">
                            <input type="number" step="0.1" value={editForm.llAlarm} onChange={e => setEditForm(f => ({ ...f, llAlarm: e.target.value }))}
                              className="border border-slate-300 px-2 py-1 text-xs w-16 text-right focus:outline-none focus:ring-1 focus:ring-blue-400" placeholder="--" />
                          </td>
                          <td className="px-1 py-1 border-r border-slate-100">
                            <input type="number" step="0.1" value={editForm.hhAlarm} onChange={e => setEditForm(f => ({ ...f, hhAlarm: e.target.value }))}
                              className="border border-slate-300 px-2 py-1 text-xs w-16 text-right focus:outline-none focus:ring-1 focus:ring-blue-400" placeholder="--" />
                          </td>
                          <td className={`px-3 py-1.5 text-center border-r border-slate-100 ${t.updatedAt ? 'text-slate-400' : 'text-amber-500 text-[10px] uppercase tracking-widest'}`}>{fmtAgo(t.updatedAt)}</td>
                          <td className="px-2 py-1.5 text-center whitespace-nowrap">
                            <button onClick={() => updateTag(t.tag)} disabled={saving}
                              className="px-2 py-0.5 bg-blue-600 border border-blue-700 text-white text-[10px] font-bold uppercase hover:bg-blue-700 disabled:opacity-50 mr-1">
                              {saving ? '...' : 'Save'}
                            </button>
                            <button onClick={() => setEditingTag(null)}
                              className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] font-bold uppercase hover:bg-slate-50">
                              X
                            </button>
                          </td>
                        </tr>
                      );
                    }

                    const isSelected = selectedTag === t.tag;
                    return (
                      <React.Fragment key={t.tag}>
                        <tr onClick={() => selectTag(t.tag)}
                          className={`border-b border-slate-100 cursor-pointer ${isSelected ? 'bg-blue-50 border-blue-200' : alarm ? 'bg-red-50/80' : i % 2 ? 'bg-slate-50/70' : ''} hover:bg-blue-50/60`}>
                          <td className="px-3 py-1.5 font-mono text-slate-800 border-r border-slate-100">
                            <div className="flex items-center gap-1">
                              <span className={`text-[8px] transition-transform ${isSelected ? 'rotate-90' : ''}`}>&#9654;</span>
                              <div>
                                <div>{t.tag}</div>
                                <div className="text-[9px] text-slate-400">{t.label}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{t.description || t.area}</td>
                          <td className={`px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100 font-bold ${alarm ? 'text-red-600' : stale ? 'text-slate-400' : 'text-slate-800'}`}>
                            {fmtVal(val)}
                            {alarm && <span className="ml-1 text-[9px] font-bold text-red-600 bg-red-100 border border-red-300 px-1 py-0.5">{alarm}</span>}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-400 border-r border-slate-100 text-[10px]">
                            {t.llAlarm != null ? t.llAlarm : '--'}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-400 border-r border-slate-100 text-[10px]">
                            {t.hhAlarm != null ? t.hhAlarm : '--'}
                          </td>
                          <td className={`px-3 py-1.5 text-center border-r border-slate-100 ${stale ? 'text-red-400' : 'text-slate-400'}`}>
                            {fmtAgo(t.updatedAt)}
                          </td>
                          <td className="px-2 py-1.5 text-center whitespace-nowrap" onClick={e => e.stopPropagation()}>
                            <button onClick={() => { setEditingTag(t.tag); setEditForm({ description: t.description || '', hhAlarm: t.hhAlarm != null ? String(t.hhAlarm) : '', llAlarm: t.llAlarm != null ? String(t.llAlarm) : '' }); }}
                              className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] font-bold uppercase hover:bg-slate-50 mr-1">
                              Edit
                            </button>
                            <button onClick={() => removeTag(t.tag)} disabled={removing.has(t.tag)}
                              className="px-2 py-0.5 bg-red-50 border border-red-200 text-red-600 text-[10px] font-bold uppercase hover:bg-red-100 disabled:opacity-50">
                              {removing.has(t.tag) ? '...' : 'X'}
                            </button>
                          </td>
                        </tr>

                        {/* ─── DETAIL PANEL ─── */}
                        {isSelected && (
                          <tr>
                            <td colSpan={7} className="p-0 bg-slate-50 border-b-2 border-blue-200">
                              <div className="p-4">
                                {/* Header with time range buttons */}
                                <div className="flex items-center justify-between mb-3">
                                  <div className="text-xs font-bold text-slate-700 uppercase tracking-widest">
                                    {t.description || t.label || t.tag} &mdash; History
                                  </div>
                                  <div className="flex gap-1">
                                    {[6, 12, 24, 48, 72, 168].map(h => (
                                      <button key={h} onClick={() => { setHistoryHours(h); fetchHistory(t.tag, h); }}
                                        className={`px-2 py-0.5 text-[10px] font-bold border ${historyHours === h ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-100'}`}>
                                        {h <= 24 ? `${h}h` : `${h / 24}d`}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                {historyLoading ? (
                                  <div className="text-center py-8 text-xs text-slate-400 uppercase tracking-widest">Loading history...</div>
                                ) : historyData.length === 0 ? (
                                  <div className="text-center py-8 text-xs text-slate-400 uppercase tracking-widest">No hourly data yet. Data accumulates after each hour.</div>
                                ) : (
                                  <>
                                    {/* Stats cards */}
                                    {tagStats && (
                                      <div className="grid grid-cols-4 md:grid-cols-8 gap-0 border border-slate-300 mb-3">
                                        {[
                                          { label: 'Mean', value: tagStats.mean, color: 'blue' },
                                          { label: 'Min', value: tagStats.min, color: 'cyan' },
                                          { label: 'Max', value: tagStats.max, color: 'orange' },
                                          { label: 'Range', value: tagStats.range, color: 'purple' },
                                          { label: 'Std Dev', value: tagStats.stdDev, color: 'slate' },
                                          { label: 'Samples', value: tagStats.samples, color: 'slate' },
                                          { label: 'Last', value: tagStats.lastValue, color: 'green' },
                                          { label: 'Trend', value: `${tagStats.trend > 0 ? '+' : ''}${tagStats.trend}%`, color: tagStats.trend > 0 ? 'red' : tagStats.trend < 0 ? 'green' : 'slate' },
                                        ].map(s => (
                                          <div key={s.label} className="bg-white px-2 py-2 border-r border-slate-200 last:border-r-0">
                                            <div className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{s.label}</div>
                                            <div className={`text-sm font-bold font-mono tabular-nums mt-0.5 text-${s.color}-600`}>
                                              {typeof s.value === 'number' ? s.value.toLocaleString() : s.value}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}

                                    {/* Chart */}
                                    <div className="bg-white border border-slate-300 p-3 mb-3">
                                      {/* Y-axis zoom controls */}
                                      <div className="flex items-center justify-end gap-1 mb-1">
                                        <span className="text-[9px] text-slate-400 uppercase tracking-widest mr-1">Y-Zoom</span>
                                        <button onClick={() => setYZoom(z => Math.min(z + 1, 5))} className="w-5 h-5 flex items-center justify-center bg-slate-100 border border-slate-300 text-slate-600 text-xs font-bold hover:bg-slate-200" title="Zoom in Y axis">+</button>
                                        <button onClick={() => setYZoom(z => Math.max(z - 1, 0))} className="w-5 h-5 flex items-center justify-center bg-slate-100 border border-slate-300 text-slate-600 text-xs font-bold hover:bg-slate-200" title="Zoom out Y axis">-</button>
                                        {yZoom > 0 && <button onClick={() => setYZoom(0)} className="px-1.5 h-5 flex items-center justify-center bg-slate-100 border border-slate-300 text-slate-500 text-[9px] hover:bg-slate-200" title="Reset Y axis">Reset</button>}
                                      </div>
                                      <ResponsiveContainer width="100%" height={250}>
                                        <ComposedChart data={historyData.map(d => ({
                                          ...d,
                                          time: new Date(d.hour).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
                                          date: new Date(d.hour).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
                                        }))}>
                                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                          <XAxis dataKey="time" tick={{ fontSize: 9 }} tickLine={false} />
                                          <YAxis tick={{ fontSize: 9 }} tickLine={false} domain={(() => {
                                            if (!historyData.length) return [0, 'auto'] as const;
                                            const allMax = Math.max(...historyData.map(d => d.max));
                                            if (yZoom === 0) return [0, Math.ceil(allMax * 1.1)] as const; // start from 0, 10% headroom
                                            const allMin = Math.min(...historyData.map(d => d.min));
                                            const mid = (allMin + allMax) / 2;
                                            const range = allMax - allMin || 1;
                                            const factor = Math.pow(0.6, yZoom);
                                            return [mid - range * factor, mid + range * factor];
                                          })()} />
                                          <Tooltip
                                            contentStyle={{ fontSize: 12, border: '1px solid #94a3b8', background: '#fff', padding: '8px 12px' }}
                                            formatter={(v: number, name: string) => {
                                              if (name === 'maxArea' || name === 'minArea') return [null, null];
                                              const color = name === 'Avg' ? '#1e40af' : name === 'Max' ? '#dc2626' : '#0891b2';
                                              return [<span style={{ color, fontWeight: name === 'Avg' ? 700 : 500, fontFamily: 'monospace' }}>{v.toFixed(2)}</span>, name];
                                            }}
                                            labelFormatter={(label: string, payload: any[]) => payload[0]?.payload?.date ? `${payload[0].payload.date} ${label}` : label}
                                            labelStyle={{ fontWeight: 700, marginBottom: 4, color: '#1e293b' }}
                                            itemStyle={{ padding: '1px 0' }}
                                          />
                                          <Area type="monotone" dataKey="max" stroke="none" fill="#fed7aa" fillOpacity={0.5} name="maxArea" legendType="none" />
                                          <Area type="monotone" dataKey="min" stroke="none" fill="#bfdbfe" fillOpacity={0.5} name="minArea" legendType="none" />
                                          <Line type="monotone" dataKey="avg" stroke="#1e40af" strokeWidth={2} dot={{ r: 3, fill: '#1e40af' }} name="Avg" />
                                          <Line type="monotone" dataKey="max" stroke="#dc2626" strokeWidth={1.5} dot={false} strokeDasharray="4 3" name="Max" />
                                          <Line type="monotone" dataKey="min" stroke="#0891b2" strokeWidth={1.5} dot={false} strokeDasharray="4 3" name="Min" />
                                          {t.hhAlarm != null && <ReferenceLine y={t.hhAlarm} stroke="#dc2626" strokeDasharray="6 3" label={{ value: `HH ${t.hhAlarm}`, fontSize: 9, fill: '#dc2626', position: 'right' }} />}
                                          {t.llAlarm != null && <ReferenceLine y={t.llAlarm} stroke="#dc2626" strokeDasharray="6 3" label={{ value: `LL ${t.llAlarm}`, fontSize: 9, fill: '#dc2626', position: 'right' }} />}
                                          {tagStats && <ReferenceLine y={tagStats.mean} stroke="#6366f1" strokeDasharray="2 2" label={{ value: `Mean ${tagStats.mean}`, fontSize: 9, fill: '#6366f1', position: 'left' }} />}
                                          <Brush dataKey="time" height={20} stroke="#94a3b8" fill="#f8fafc" travellerWidth={8} />
                                        </ComposedChart>
                                      </ResponsiveContainer>
                                    </div>

                                    {/* Hourly data table */}
                                    <div className="border border-slate-300 overflow-hidden max-h-[250px] overflow-y-auto">
                                      <table className="w-full text-xs">
                                        <thead className="sticky top-0">
                                          <tr className="bg-slate-700 text-white">
                                            <th className="text-left px-2 py-1.5 font-semibold text-[9px] uppercase tracking-widest border-r border-slate-600">Hour (IST)</th>
                                            <th className="text-right px-2 py-1.5 font-semibold text-[9px] uppercase tracking-widest border-r border-slate-600">Avg</th>
                                            <th className="text-right px-2 py-1.5 font-semibold text-[9px] uppercase tracking-widest border-r border-slate-600">Min</th>
                                            <th className="text-right px-2 py-1.5 font-semibold text-[9px] uppercase tracking-widest border-r border-slate-600">Max</th>
                                            <th className="text-right px-2 py-1.5 font-semibold text-[9px] uppercase tracking-widest border-r border-slate-600">Range</th>
                                            <th className="text-right px-2 py-1.5 font-semibold text-[9px] uppercase tracking-widest">Samples</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {[...historyData].reverse().map((d, idx) => {
                                            const hr = new Date(d.hour);
                                            const dateStr = hr.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
                                            const timeStr = hr.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
                                            return (
                                              <tr key={idx} className={`border-b border-slate-100 ${idx % 2 ? 'bg-slate-50/70' : ''}`}>
                                                <td className="px-2 py-1 text-slate-600 border-r border-slate-100 font-mono">{dateStr} {timeStr}</td>
                                                <td className="px-2 py-1 text-right font-mono tabular-nums text-slate-800 border-r border-slate-100 font-bold">{d.avg.toFixed(2)}</td>
                                                <td className="px-2 py-1 text-right font-mono tabular-nums text-cyan-600 border-r border-slate-100">{d.min.toFixed(2)}</td>
                                                <td className="px-2 py-1 text-right font-mono tabular-nums text-orange-600 border-r border-slate-100">{d.max.toFixed(2)}</td>
                                                <td className="px-2 py-1 text-right font-mono tabular-nums text-slate-400 border-r border-slate-100">{(d.max - d.min).toFixed(2)}</td>
                                                <td className="px-2 py-1 text-right font-mono tabular-nums text-slate-400">{d.count}</td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
            {liveLoading && liveTags.length > 0 && <div className="px-4 py-1 text-[10px] text-slate-400 uppercase tracking-widest bg-slate-50 border-t border-slate-200">Refreshing...</div>}
          </div>
        )}

        {/* ═══════════════════ BROWSE / ADD TAGS ═══════════════════ */}
        {tab === 'browse' && (
          <>
            <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-3 -mx-3 md:-mx-6 flex flex-wrap items-end gap-4">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Area</label>
                <select value={browseArea} onChange={e => { setBrowseArea(e.target.value); setBrowseFolder(''); }}
                  className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white min-w-[160px]">
                  <option value="">Select area...</option>
                  {Object.keys(TAG_CATALOG).map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              {browseArea && (
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Folder</label>
                  <select value={browseFolder} onChange={e => setBrowseFolder(e.target.value)}
                    className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white min-w-[160px]">
                    <option value="">Select folder...</option>
                    {Object.keys(TAG_CATALOG[browseArea] || {}).map(f => (
                      <option key={f} value={f}>{f} ({Object.keys(TAG_CATALOG[browseArea][f].tags).length} tags)</option>
                    ))}
                  </select>
                </div>
              )}
              {browseTags && (
                <div className="text-xs text-slate-500 pb-1">
                  {Object.keys(browseTags.tags).length} tags | {Object.keys(browseTags.tags).filter(t => monitoredSet.has(t)).length} monitored
                </div>
              )}
            </div>

            <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
              {!browseArea || !browseFolder ? (
                <div className="px-4 py-8 text-center">
                  <div className="text-xs text-slate-400 uppercase tracking-widest">Select an area and folder to browse tags</div>
                  <div className="text-xs text-slate-400 mt-2">Tags sync to factory PC within ~3 minutes</div>
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
                            {isMonitored
                              ? <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-green-300 bg-green-50 text-green-600">Active</span>
                              : <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-200 bg-slate-50 text-slate-400">--</span>}
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            {isMonitored ? (
                              <button onClick={() => removeTag(tagName)} disabled={removing.has(tagName)}
                                className="px-2 py-0.5 bg-red-50 border border-red-200 text-red-600 text-[10px] font-bold uppercase hover:bg-red-100 disabled:opacity-50">
                                {removing.has(tagName) ? '...' : 'Remove'}
                              </button>
                            ) : (
                              <button onClick={() => addTag(tagName, browseArea, browseTags.folder, browseTags.type, label)}
                                disabled={adding.has(tagName)}
                                className="px-2 py-0.5 bg-blue-600 border border-blue-700 text-white text-[10px] font-bold uppercase hover:bg-blue-700 disabled:opacity-50">
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
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">How it works</div>
              <div className="text-[10px] text-slate-500 space-y-0.5">
                <div>Factory PC scans OPC tags every 2 min, stores raw readings locally (7 day retention)</div>
                <div>Every 2.5 min: pushes readings to cloud + pulls tag list from ERP</div>
                <div>Every hour: computes avg/min/max aggregates (stored permanently in cloud)</div>
                <div>HH/LL alarms: checked on each push, alerts sent to Telegram group (max once per 15 min per tag)</div>
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 px-1 text-[10px] text-slate-400">
          Tags sync to factory PC automatically (~3 min). Factory scans every 2 min, pushes to cloud every 2.5 min. Hourly averages stored permanently.
        </div>
      </div>
    </div>
  );
}
