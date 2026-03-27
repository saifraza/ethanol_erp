import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface OpcArea {
  name: string;
  folders: string[];
}

interface OpcTag {
  tag: string;
  area: string;
  folder: string;
  tagType: string;
  monitored: boolean;
}

interface MonitoredTag {
  tag: string;
  area: string;
  folder: string;
  tagType: string;
  label: string;
  addedAt: string;
}

interface LiveTag {
  tag: string;
  area: string;
  type: string;
  label: string;
  updatedAt: string;
  values: Record<string, number | string | boolean>;
}

interface TagReadResult {
  tag: string;
  area: string;
  folder: string;
  values: Record<string, number | string | boolean>;
  readAt: string;
}

type Tab = 'live' | 'browse' | 'monitored';

export default function OPCTagManager() {
  const [tab, setTab] = useState<Tab>('live');
  const [online, setOnline] = useState<boolean | null>(null);
  const [health, setHealth] = useState<{ monitoredTags: number; cachedValues: number; lastScan: string | null } | null>(null);

  // Browse state
  const [areas, setAreas] = useState<OpcArea[]>([]);
  const [selectedArea, setSelectedArea] = useState('');
  const [selectedFolder, setSelectedFolder] = useState('');
  const [tags, setTags] = useState<OpcTag[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);

  // Monitor state
  const [monitored, setMonitored] = useState<MonitoredTag[]>([]);

  // Live state
  const [liveTags, setLiveTags] = useState<LiveTag[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);

  // Preview read state
  const [previewTag, setPreviewTag] = useState<TagReadResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [error, setError] = useState('');

  // Check health on mount
  const checkHealth = useCallback(async () => {
    try {
      const res = await api.get('/opc/health');
      setHealth(res.data);
      setOnline(true);
      setError('');
    } catch {
      setOnline(false);
      setHealth(null);
    }
  }, []);

  useEffect(() => { checkHealth(); }, [checkHealth]);

  // Auto-refresh live data every 30s
  useEffect(() => {
    if (tab !== 'live' || !online) return;
    fetchLive();
    const interval = setInterval(fetchLive, 30000);
    return () => clearInterval(interval);
  }, [tab, online]);

  // Fetch monitored tags when switching to that tab
  useEffect(() => {
    if (tab === 'monitored' && online) fetchMonitored();
  }, [tab, online]);

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
      setError(err?.response?.data?.error || 'Failed to fetch monitored tags');
    }
  }

  async function fetchAreas() {
    try {
      setBrowseLoading(true);
      const res = await api.get('/opc/browse');
      setAreas(res.data.areas || []);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to browse OPC tree');
    } finally {
      setBrowseLoading(false);
    }
  }

  async function fetchTags(area: string, folder: string) {
    try {
      setBrowseLoading(true);
      setTags([]);
      const res = await api.get(`/opc/browse/${encodeURIComponent(area)}/${encodeURIComponent(folder)}`);
      setTags(res.data.tags || []);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to fetch tags');
    } finally {
      setBrowseLoading(false);
    }
  }

  async function readTagLive(tag: string, area: string, folder: string) {
    try {
      setPreviewLoading(true);
      setPreviewTag(null);
      const res = await api.get(`/opc/read/${encodeURIComponent(tag)}?area=${encodeURIComponent(area)}&folder=${encodeURIComponent(folder)}`);
      setPreviewTag(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to read tag');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function addMonitor(tag: OpcTag, label?: string) {
    try {
      await api.post('/opc/monitor', {
        tag: tag.tag,
        area: tag.area,
        folder: tag.folder,
        tagType: tag.tagType,
        label: label || tag.tag,
      });
      // Update local state
      setTags(prev => prev.map(t => t.tag === tag.tag ? { ...t, monitored: true } : t));
      fetchMonitored();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to add monitor');
    }
  }

  async function removeMonitor(tagName: string) {
    try {
      await api.delete(`/opc/monitor/${encodeURIComponent(tagName)}`);
      setMonitored(prev => prev.filter(t => t.tag !== tagName));
      setTags(prev => prev.map(t => t.tag === tagName ? { ...t, monitored: false } : t));
      setLiveTags(prev => prev.filter(t => t.tag !== tagName));
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to remove monitor');
    }
  }

  const fmtVal = (v: number | string | boolean) => {
    if (typeof v === 'number') return v.toFixed(2);
    if (typeof v === 'boolean') return v ? 'ON' : 'OFF';
    return String(v);
  };

  const fmtTime = (iso: string | null) => {
    if (!iso) return '--';
    const d = new Date(iso);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">OPC Tag Manager</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">ABB 800xA Plant Automation</span>
          </div>
          <div className="flex items-center gap-3">
            <span className={`inline-block w-2 h-2 ${online === true ? 'bg-green-400' : online === false ? 'bg-red-400' : 'bg-yellow-400'}`} />
            <span className="text-[10px] text-slate-300">{online === true ? 'BRIDGE ONLINE' : online === false ? 'BRIDGE OFFLINE' : 'CHECKING...'}</span>
            <button onClick={checkHealth} className="px-2 py-0.5 bg-slate-700 text-[10px] text-slate-300 hover:bg-slate-600">REFRESH</button>
          </div>
        </div>

        {/* Error bar */}
        {error && (
          <div className="bg-red-50 border border-red-200 px-4 py-2 -mx-3 md:-mx-6 flex items-center justify-between">
            <span className="text-xs text-red-700">{error}</span>
            <button onClick={() => setError('')} className="text-xs text-red-400 hover:text-red-600">dismiss</button>
          </div>
        )}

        {/* KPI strip */}
        {health && (
          <div className="grid grid-cols-3 border-x border-b border-slate-300 -mx-3 md:-mx-6">
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Monitored Tags</div>
              <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{health.monitoredTags}</div>
            </div>
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Cached Values</div>
              <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{health.cachedValues}</div>
            </div>
            <div className="bg-white px-4 py-3 border-l-4 border-l-amber-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Last Scan</div>
              <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtTime(health.lastScan)}</div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6 bg-white">
          {(['live', 'browse', 'monitored'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); if (t === 'browse' && areas.length === 0 && online) fetchAreas(); }}
              className={`px-4 py-2 text-[11px] font-bold uppercase tracking-widest border-b-2 ${tab === t ? 'border-blue-600 text-blue-700 bg-blue-50/50' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
            >
              {t === 'live' ? 'Live Data' : t === 'browse' ? 'Browse OPC' : 'Monitored Tags'}
            </button>
          ))}
        </div>

        {/* TAB: Live Data */}
        {tab === 'live' && (
          <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
            {liveTags.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <div className="text-xs text-slate-400 uppercase tracking-widest">No monitored tags yet</div>
                <div className="text-xs text-slate-400 mt-2">Go to Browse OPC tab to discover and add tags</div>
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
                    <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Updated</th>
                    <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest w-16">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {liveTags.map((t, i) => (
                    <tr key={t.tag} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                      <td className="px-3 py-1.5 font-mono text-slate-800 border-r border-slate-100">{t.tag}</td>
                      <td className="px-3 py-1.5 text-slate-500 border-r border-slate-100">{t.area}</td>
                      <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{t.label}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 border-r border-slate-100 font-bold">
                        {fmtVal(t.values.PV ?? t.values.IO_VALUE ?? '--')}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-500 border-r border-slate-100">
                        {t.values.SP != null ? fmtVal(t.values.SP) : '--'}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-500 border-r border-slate-100">
                        {t.values.OP != null ? fmtVal(t.values.OP) : '--'}
                      </td>
                      <td className="px-3 py-1.5 text-center text-slate-400 border-r border-slate-100">{fmtTime(t.updatedAt)}</td>
                      <td className="px-3 py-1.5 text-center">
                        <button
                          onClick={() => removeMonitor(t.tag)}
                          className="px-1.5 py-0.5 bg-red-50 border border-red-200 text-red-600 text-[9px] font-bold uppercase hover:bg-red-100"
                        >Stop</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {liveLoading && <div className="px-4 py-2 text-[10px] text-slate-400 uppercase tracking-widest bg-slate-50 border-t border-slate-200">Refreshing...</div>}
          </div>
        )}

        {/* TAB: Browse OPC Tree */}
        {tab === 'browse' && (
          <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300">
            {/* Area/Folder selector */}
            <div className="bg-slate-100 px-4 py-2 flex items-center gap-3 border-b border-slate-300">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Area</label>
                <select
                  value={selectedArea}
                  onChange={e => { setSelectedArea(e.target.value); setSelectedFolder(''); setTags([]); setPreviewTag(null); }}
                  className="ml-2 border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white"
                >
                  <option value="">-- Select Area --</option>
                  {areas.map(a => <option key={a.name} value={a.name}>{a.name}</option>)}
                </select>
              </div>
              {selectedArea && (
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Folder</label>
                  <select
                    value={selectedFolder}
                    onChange={e => { setSelectedFolder(e.target.value); if (e.target.value) fetchTags(selectedArea, e.target.value); }}
                    className="ml-2 border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white"
                  >
                    <option value="">-- Select Folder --</option>
                    {areas.find(a => a.name === selectedArea)?.folders.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              )}
              {browseLoading && <span className="text-[10px] text-slate-400 uppercase tracking-widest ml-3">Loading...</span>}
            </div>

            {/* Tags grid */}
            <div className="flex">
              {/* Left: tag list */}
              <div className={`${previewTag ? 'w-1/2' : 'w-full'} overflow-auto`}>
                {tags.length > 0 ? (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-700 text-white">
                        <th className="text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Tag Name</th>
                        <th className="text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Type</th>
                        <th className="text-center px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest w-32">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tags.map((t, i) => (
                        <tr key={`${t.tag}-${i}`} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                          <td className="px-3 py-1.5 font-mono text-slate-800 border-r border-slate-100">{t.tag}</td>
                          <td className="px-3 py-1.5 border-r border-slate-100">
                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${t.tagType === 'pid' ? 'border-blue-300 bg-blue-50 text-blue-600' : 'border-slate-300 bg-slate-50 text-slate-600'}`}>
                              {t.tagType}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => readTagLive(t.tag, t.area, t.folder)}
                                className="px-2 py-0.5 bg-slate-100 border border-slate-300 text-slate-600 text-[9px] font-bold uppercase hover:bg-slate-200"
                              >Read</button>
                              {t.monitored ? (
                                <button
                                  onClick={() => removeMonitor(t.tag)}
                                  className="px-2 py-0.5 bg-red-50 border border-red-200 text-red-600 text-[9px] font-bold uppercase hover:bg-red-100"
                                >Unwatch</button>
                              ) : (
                                <button
                                  onClick={() => addMonitor(t)}
                                  className="px-2 py-0.5 bg-green-50 border border-green-200 text-green-700 text-[9px] font-bold uppercase hover:bg-green-100"
                                >Monitor</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : selectedFolder ? (
                  <div className="px-4 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">No tags found</div>
                ) : (
                  <div className="px-4 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">Select an Area and Folder to browse tags</div>
                )}
              </div>

              {/* Right: preview panel */}
              {previewTag && (
                <div className="w-1/2 border-l border-slate-300 bg-white">
                  <div className="bg-slate-700 text-white px-3 py-1.5 flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest">Live Read: {previewTag.tag}</span>
                    <button onClick={() => setPreviewTag(null)} className="text-[10px] text-slate-400 hover:text-white">Close</button>
                  </div>
                  {previewLoading ? (
                    <div className="px-4 py-4 text-xs text-slate-400 uppercase tracking-widest">Reading from OPC...</div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {Object.entries(previewTag.values).map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between px-3 py-1">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{k}</span>
                          <span className="font-mono tabular-nums text-xs text-slate-800">{fmtVal(v)}</span>
                        </div>
                      ))}
                      <div className="px-3 py-1">
                        <span className="text-[9px] text-slate-400">Read at: {previewTag.readAt}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB: Monitored Tags */}
        {tab === 'monitored' && (
          <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
            {monitored.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <div className="text-xs text-slate-400 uppercase tracking-widest">No tags being monitored</div>
                <div className="text-xs text-slate-400 mt-2">Use the Browse tab to discover and add tags</div>
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
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Since</th>
                    <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest w-20">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {monitored.map((t, i) => (
                    <tr key={t.tag} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                      <td className="px-3 py-1.5 font-mono text-slate-800 border-r border-slate-100">{t.tag}</td>
                      <td className="px-3 py-1.5 text-slate-500 border-r border-slate-100">{t.area}</td>
                      <td className="px-3 py-1.5 text-slate-500 border-r border-slate-100">{t.folder}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${t.tagType === 'pid' ? 'border-blue-300 bg-blue-50 text-blue-600' : 'border-slate-300 bg-slate-50 text-slate-600'}`}>
                          {t.tagType}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{t.label}</td>
                      <td className="px-3 py-1.5 text-slate-400 border-r border-slate-100">{new Date(t.addedAt).toLocaleDateString('en-IN')}</td>
                      <td className="px-3 py-1.5 text-center">
                        <button
                          onClick={() => removeMonitor(t.tag)}
                          className="px-2 py-0.5 bg-red-50 border border-red-200 text-red-600 text-[9px] font-bold uppercase hover:bg-red-100"
                        >Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
