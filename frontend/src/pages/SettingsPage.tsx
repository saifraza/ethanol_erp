import React, { useEffect, useState, useCallback } from 'react';
import api from '../services/api';
import { Save, Smartphone, RefreshCw, LogOut, Send, Users, Lock, ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface WAGroup {
  id: string;
  subject: string;
  size: number;
}

type RouteTarget = 'group1' | 'group2' | 'private';

const MODULE_LABELS: Record<string, string> = {
  'liquefaction': 'Liquefaction', 'fermentation': 'Fermentation', 'distillation': 'Distillation',
  'milling': 'Milling', 'evaporation': 'Evaporation', 'decanter': 'Decanter',
  'dryer': 'Dryer', 'ethanol-product': 'Ethanol Product', 'grain': 'Grain',
  'ddgs': 'DDGS', 'ddgs-stock': 'DDGS Stock', 'ddgs-dispatch': 'DDGS Dispatch',
  'sales': 'Sales', 'dispatch': 'Dispatch', 'procurement': 'Procurement',
  'accounts': 'Accounts', 'inventory': 'Inventory',
};

const ROUTE_CYCLE: RouteTarget[] = ['group1', 'group2', 'private'];

export default function SettingsPage() {
  const [settings, setSettings] = useState<any>({});
  const [msg, setMsg] = useState('');
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  // WhatsApp state
  const [waStatus, setWaStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [waQR, setWaQR] = useState<string | null>(null);
  const [waNumber, setWaNumber] = useState<string | null>(null);
  const [waLoading, setWaLoading] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testMsg, setTestMsg] = useState('Hello from MSPIL ERP!');
  const [testResult, setTestResult] = useState('');
  const [groups, setGroups] = useState<WAGroup[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [allModules, setAllModules] = useState<string[]>([]);
  const [moduleRouting, setModuleRouting] = useState<Record<string, RouteTarget>>({});

  const fetchWAStatus = useCallback(async () => {
    try {
      const res = await api.get('/whatsapp/status');
      setWaStatus(res.data.status);
      setWaQR(res.data.qr);
      setWaNumber(res.data.connectedNumber);
    } catch {}
  }, []);

  useEffect(() => {
    fetchWAStatus();
    const interval = setInterval(fetchWAStatus, waStatus === 'connecting' ? 3000 : 15000);
    return () => clearInterval(interval);
  }, [fetchWAStatus, waStatus]);

  const handleConnect = async () => {
    setWaLoading(true);
    try {
      const res = await api.post('/whatsapp/connect');
      setWaStatus(res.data.status);
      setWaQR(res.data.qr);
    } catch (err: any) {
      setTestResult('Failed to connect: ' + (err.response?.data?.error || err.message));
    } finally {
      setWaLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setWaLoading(true);
    try {
      await api.post('/whatsapp/disconnect');
      setWaStatus('disconnected');
      setWaQR(null);
      setWaNumber(null);
    } catch (err: any) {
      setTestResult('Failed to disconnect: ' + (err.response?.data?.error || err.message));
    } finally {
      setWaLoading(false);
    }
  };

  const handleTestSend = async () => {
    if (!testPhone) return;
    setTestResult('Sending...');
    try {
      const res = await api.post('/whatsapp/test', { phone: testPhone, message: testMsg });
      setTestResult(res.data.success ? 'Sent successfully!' : 'Failed: ' + res.data.error);
    } catch (err: any) {
      setTestResult('Error: ' + (err.response?.data?.error || err.message));
    }
  };

  const fetchGroups = async () => {
    setLoadingGroups(true);
    try {
      const res = await api.get('/whatsapp/groups');
      setGroups(res.data);
    } catch {}
    setLoadingGroups(false);
  };

  // Load settings + module routing
  useEffect(() => {
    api.get('/settings').then(r => {
      setSettings(r.data);
      // Parse module routing
      try {
        if (r.data.whatsappModuleRouting) {
          setModuleRouting(JSON.parse(r.data.whatsappModuleRouting));
        }
      } catch { /* ignore */ }
    });
    api.get('/whatsapp/modules').then(r => {
      setAllModules(r.data.all);
      // Use backend routing if we haven't loaded from settings yet
      if (r.data.routing) {
        setModuleRouting(prev => Object.keys(prev).length > 0 ? prev : r.data.routing);
      }
    }).catch(() => {});
  }, []);

  // Fetch groups when connected
  useEffect(() => {
    if (waStatus === 'connected') fetchGroups();
  }, [waStatus]);

  const cycleModuleRoute = (mod: string) => {
    if (!isAdmin) return;
    setModuleRouting(prev => {
      const current = prev[mod] || 'group1';
      const idx = ROUTE_CYCLE.indexOf(current);
      const next = ROUTE_CYCLE[(idx + 1) % ROUTE_CYCLE.length];
      const updated = { ...prev, [mod]: next };
      // Sync to settings for save
      setSettings((s: any) => ({ ...s, whatsappModuleRouting: JSON.stringify(updated) }));
      return updated;
    });
  };

  const update = (k: string, v: string) => setSettings((s: any) => ({ ...s, [k]: v === '' ? null : parseFloat(v) }));
  const updateStr = (k: string, v: string) => setSettings((s: any) => ({ ...s, [k]: v }));

  const save = async () => {
    // Ensure module routing is serialized
    const payload = { ...settings };
    if (typeof payload.whatsappModuleRouting === 'object') {
      payload.whatsappModuleRouting = JSON.stringify(payload.whatsappModuleRouting);
    }
    await api.patch('/settings', payload);
    setMsg('Saved!'); setTimeout(() => setMsg(''), 2000);
  };

  const fields = [
    { key: 'grainPercent', label: 'Grain % of Slurry', unit: '%' },
    { key: 'fermenter1Cap', label: 'Fermenter 1 Capacity', unit: 'M3' },
    { key: 'fermenter2Cap', label: 'Fermenter 2 Capacity', unit: 'M3' },
    { key: 'fermenter3Cap', label: 'Fermenter 3 Capacity', unit: 'M3' },
    { key: 'fermenter4Cap', label: 'Fermenter 4 Capacity', unit: 'M3' },
    { key: 'beerWellCap', label: 'Beer Well Capacity', unit: 'M3' },
    { key: 'pfCap', label: 'PF Capacity', unit: 'M3' },
    { key: 'pfGrainPercent', label: 'PF Grain %', unit: '%' },
    { key: 'iltCap', label: 'ILT Capacity', unit: 'M3' },
    { key: 'fltCap', label: 'FLT Capacity', unit: 'M3' },
    { key: 'millingLossPercent', label: 'Milling Loss', unit: '%' },
    { key: 'rsTankCap', label: 'RS Tank Capacity', unit: 'M3' },
    { key: 'hfoTankCap', label: 'HFO Tank Capacity', unit: 'M3' },
    { key: 'lfoTankCap', label: 'LFO Tank Capacity', unit: 'M3' },
  ];

  const routeColor: Record<RouteTarget, { bg: string; text: string; border: string; icon: string }> = {
    group1: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', icon: 'text-blue-500' },
    group2: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: 'text-emerald-500' },
    private: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', icon: 'text-orange-500' },
  };

  const getRouteLabel = (target: RouteTarget): string => {
    if (target === 'group1') return settings.whatsappGroupName || 'Group 1';
    if (target === 'group2') return settings.whatsappGroup2Name || 'Group 2';
    return 'Private';
  };

  // Filter out already-selected groups from the picker
  const availableGroups = (otherJidKey: string) =>
    groups.filter(g => g.id !== settings[otherJidKey]);

  // Group selector component
  const GroupSelector = ({ num, jidKey, nameKey, otherJidKey, label, color }: {
    num: number; jidKey: string; nameKey: string; otherJidKey: string; label: string; color: string;
  }) => {
    const filtered = availableGroups(otherJidKey);
    return (
      <div className="mt-4 pt-4 border-t first:mt-0 first:pt-0 first:border-0">
        <div className="flex items-center gap-2 mb-2">
          <Users size={16} className={color} />
          <span className="text-sm font-semibold">{label}</span>
          {settings[nameKey] && (
            <span className="text-xs text-gray-400">({settings[nameKey]})</span>
          )}
        </div>

        {settings[jidKey] && settings[nameKey] ? (
          <div className="flex items-center gap-2 mb-2">
            <span className={`inline-flex items-center gap-1 px-3 py-1.5 ${num === 1 ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'} rounded-full text-sm font-medium`}>
              <Users size={14} /> {settings[nameKey]}
            </span>
            {isAdmin && (
              <button onClick={() => { updateStr(jidKey, ''); updateStr(nameKey, ''); }}
                className="text-xs text-red-500 hover:underline">Remove</button>
            )}
          </div>
        ) : (
          <>
            {waStatus === 'connected' && isAdmin ? (
              <div className="space-y-2">
                <button onClick={fetchGroups} disabled={loadingGroups}
                  className="text-sm text-blue-600 hover:underline flex items-center gap-1 mb-2">
                  <RefreshCw size={12} className={loadingGroups ? 'animate-spin' : ''} />
                  {loadingGroups ? 'Loading...' : 'Load groups'}
                </button>
                {filtered.length > 0 && (
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {filtered.map(g => (
                      <button key={g.id} onClick={() => { updateStr(jidKey, g.id); updateStr(nameKey, g.subject); }}
                        className="w-full text-left px-3 py-2 bg-gray-50 hover:bg-blue-50 rounded-lg text-sm flex justify-between items-center">
                        <span>{g.subject}</span>
                        <span className="text-xs text-gray-400">{g.size} members</span>
                      </button>
                    ))}
                  </div>
                )}
                {filtered.length === 0 && !loadingGroups && groups.length > 0 && (
                  <p className="text-xs text-gray-400">No other groups available. Make sure the number is added to another group.</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-orange-500">
                {waStatus !== 'connected' ? 'Connect WhatsApp first to select a group.' : 'Only admins can change this.'}
              </p>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Plant Settings</h1>
      <div className="card">
        <div className="space-y-3">
          {fields.map(f => (
            <div key={f.key} className="flex items-center gap-2">
              <label className="text-sm text-gray-600 w-52">{f.label} <span className="text-xs text-gray-400">({f.unit})</span></label>
              <input type="number" value={settings[f.key] ?? ''} onChange={e => update(f.key, e.target.value)} className="input-field flex-1" disabled={!isAdmin} step="any" />
            </div>
          ))}
        </div>

        {/* WhatsApp Connection */}
        <div className="mt-6 pt-6 border-t">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Smartphone size={20} className="text-green-600" />
            WhatsApp Connection
          </h2>

          <div className="flex items-center gap-2 mb-4">
            <span className={`w-3 h-3 rounded-full ${
              waStatus === 'connected' ? 'bg-green-500' :
              waStatus === 'connecting' ? 'bg-yellow-500 animate-pulse' : 'bg-gray-400'
            }`} />
            <span className="text-sm font-medium capitalize">{waStatus}</span>
            {waNumber && <span className="text-sm text-gray-500">— +{waNumber}</span>}
          </div>

          {waStatus === 'connecting' && waQR && (
            <div className="mb-4 p-4 bg-white border rounded-lg inline-block">
              <p className="text-sm text-gray-600 mb-2">Scan with WhatsApp on your phone:</p>
              <img src={waQR} alt="WhatsApp QR Code" className="w-64 h-64" />
              <p className="text-xs text-gray-400 mt-2">QR refreshes automatically.</p>
            </div>
          )}

          {waStatus === 'connecting' && !waQR && (
            <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-sm text-yellow-700">Generating QR code...</p>
            </div>
          )}

          {isAdmin && (
            <div className="flex items-center gap-3 mb-4">
              {waStatus === 'disconnected' && (
                <button onClick={handleConnect} disabled={waLoading} className="btn-primary flex items-center gap-2">
                  <RefreshCw size={16} className={waLoading ? 'animate-spin' : ''} /> Connect WhatsApp
                </button>
              )}
              {waStatus === 'connected' && (
                <button onClick={handleDisconnect} disabled={waLoading}
                  className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 flex items-center gap-2">
                  <LogOut size={16} /> Disconnect
                </button>
              )}
              {waStatus === 'connecting' && (
                <button onClick={handleDisconnect} disabled={waLoading}
                  className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 flex items-center gap-2">Cancel</button>
              )}
            </div>
          )}

          {waStatus === 'connected' && isAdmin && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg space-y-2">
              <p className="text-sm font-medium text-green-800">Send a test message</p>
              <div className="flex gap-2">
                <input type="text" value={testPhone} onChange={e => setTestPhone(e.target.value)}
                  placeholder="Phone number" className="input-field w-40" />
                <input type="text" value={testMsg} onChange={e => setTestMsg(e.target.value)} className="input-field flex-1" />
                <button onClick={handleTestSend} className="btn-primary flex items-center gap-1"><Send size={14} /> Send</button>
              </div>
              {testResult && <p className={`text-xs ${testResult.includes('success') ? 'text-green-600' : 'text-red-500'}`}>{testResult}</p>}
            </div>
          )}
        </div>

        {/* WhatsApp Groups — Two groups */}
        <div className="mt-6 pt-6 border-t">
          <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
            <Users size={18} className="text-blue-600" />
            WhatsApp Groups
          </h2>
          <p className="text-sm text-gray-500 mb-3">Select two groups. Then assign each module to a group or private below.</p>

          <GroupSelector num={1} jidKey="whatsappGroupJid" nameKey="whatsappGroupName" otherJidKey="whatsappGroup2Jid" label="Group 1" color="text-blue-600" />
          <GroupSelector num={2} jidKey="whatsappGroup2Jid" nameKey="whatsappGroup2Name" otherJidKey="whatsappGroupJid" label="Group 2" color="text-emerald-600" />
        </div>

        {/* Private Numbers */}
        <div className="mt-6 pt-6 border-t">
          <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
            <Lock size={18} className="text-orange-600" />
            Private Numbers
          </h2>
          <p className="text-sm text-gray-500 mb-3">Modules routed to "Private" send reports to these numbers only.</p>

          {settings.whatsappNumbers && settings.whatsappNumbers.trim() && (
            <div className="flex flex-wrap gap-2 mb-3">
              {settings.whatsappNumbers.split(',').map((p: string) => p.trim()).filter(Boolean).map((p: string, i: number) => (
                <span key={i} className="inline-flex items-center gap-1 px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-sm font-medium">
                  <Smartphone size={14} /> +91 {p}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 mb-4">
            <label className="text-sm text-gray-600 w-52">Phone numbers <span className="text-xs text-gray-400">(comma separated)</span></label>
            <input
              type="text"
              value={settings.whatsappNumbers ?? ''}
              onChange={e => updateStr('whatsappNumbers', e.target.value)}
              className="input-field flex-1"
              disabled={!isAdmin}
              placeholder="9876543210, 9123456789"
            />
          </div>
        </div>

        {/* Module Routing — tap to cycle between group1, group2, private */}
        <div className="mt-6 pt-6 border-t">
          <h2 className="text-lg font-semibold mb-1">Report Routing</h2>
          <p className="text-sm text-gray-500 mb-3">Tap a module to cycle its destination: <span className="font-medium text-blue-600">{settings.whatsappGroupName || 'Group 1'}</span> <ArrowRight size={12} className="inline" /> <span className="font-medium text-emerald-600">{settings.whatsappGroup2Name || 'Group 2'}</span> <ArrowRight size={12} className="inline" /> <span className="font-medium text-orange-600">Private</span></p>

          <div className="space-y-1.5">
            {allModules.map(mod => {
              const target = (moduleRouting[mod] || 'group1') as RouteTarget;
              const colors = routeColor[target];
              return (
                <button
                  key={mod}
                  onClick={() => cycleModuleRoute(mod)}
                  disabled={!isAdmin}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium ${colors.bg} ${colors.text} border ${colors.border} hover:opacity-80 transition-all`}
                >
                  <span className="flex items-center gap-2">
                    {target === 'private' ? <Lock size={14} /> : <Users size={14} />}
                    {MODULE_LABELS[mod] || mod}
                  </span>
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${colors.icon}`}>
                    {getRouteLabel(target)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-3 mt-6">
            <button onClick={save} className="btn-primary flex items-center gap-2"><Save size={16} />Save Settings</button>
            {msg && <span className="text-sm text-green-600">{msg}</span>}
          </div>
        )}
        {!isAdmin && <p className="text-sm text-gray-400 mt-4">Only admins can change settings.</p>}
      </div>
    </div>
  );
}
