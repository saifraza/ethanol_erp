import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { Save, Send, Users, Lock, ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

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
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  // Telegram state
  const [tgStatus, setTgStatus] = useState<{ connected: boolean; username?: string }>({ connected: false });
  const [tgLoading, setTgLoading] = useState(false);
  const [allModules, setAllModules] = useState<string[]>([]);
  const [moduleRouting, setModuleRouting] = useState<Record<string, RouteTarget>>({});

  // Load settings + Telegram status
  useEffect(() => {
    api.get('/settings').then(r => {
      setSettings(r.data);
      try {
        const routing = r.data.telegramModuleRouting;
        if (routing) setModuleRouting(JSON.parse(routing));
      } catch { /* ignore */ }
    });
    api.get('/telegram/status').then(r => setTgStatus(r.data)).catch(() => {});
    api.get('/telegram/modules').then(r => {
      if (r.data.modules) {
        setAllModules(r.data.modules.map((m: any) => m.module));
        const routing: Record<string, RouteTarget> = {};
        r.data.modules.forEach((m: any) => { routing[m.module] = m.target; });
        setModuleRouting(prev => Object.keys(prev).length > 0 ? prev : routing);
      }
    }).catch(() => {
      // Fallback: load module list from static
      setAllModules(Object.keys(MODULE_LABELS));
    });
  }, []);

  const cycleModuleRoute = (mod: string) => {
    if (!isAdmin) return;
    setModuleRouting(prev => {
      const current = prev[mod] || 'group1';
      const idx = ROUTE_CYCLE.indexOf(current);
      const next = ROUTE_CYCLE[(idx + 1) % ROUTE_CYCLE.length];
      const updated = { ...prev, [mod]: next };
      setSettings((s: any) => ({ ...s, telegramModuleRouting: JSON.stringify(updated) }));
      return updated;
    });
  };

  const update = (k: string, v: string) => setSettings((s: any) => ({ ...s, [k]: v === '' ? null : parseFloat(v) }));
  const updateStr = (k: string, v: string) => setSettings((s: any) => ({ ...s, [k]: v }));

  const save = async () => {
    const payload = { ...settings };
    if (typeof payload.telegramModuleRouting === 'object') {
      payload.telegramModuleRouting = JSON.stringify(payload.telegramModuleRouting);
    }
    await api.patch('/settings', payload);
    setMsg('Saved!'); setTimeout(() => setMsg(''), 2000);
  };

  const handleReconnect = async () => {
    setTgLoading(true);
    try {
      const r = await api.post('/telegram/reconnect');
      if (r.data.success) {
        setTgStatus({ connected: true });
        setMsg('Telegram bot reconnected!');
      } else {
        setMsg('Failed to connect bot');
      }
    } catch { setMsg('Failed to connect'); }
    finally { setTgLoading(false); }
    setTimeout(() => setMsg(''), 3000);
  };

  const handleTestGroup = async () => {
    try {
      const r = await api.post('/telegram/test-group');
      setMsg(r.data.success ? 'Test sent to Telegram group!' : (r.data.error || 'Failed'));
    } catch (e: any) {
      setMsg(e.response?.data?.error || 'Failed to send test');
    }
    setTimeout(() => setMsg(''), 3000);
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
    if (target === 'group1') return settings.telegramGroupName || 'Group 1';
    if (target === 'group2') return settings.telegramGroup2Name || 'Group 2';
    return 'Private';
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

        {/* Telegram Bot */}
        <div className="mt-6 pt-6 border-t">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Send size={20} className="text-blue-500" />
            Telegram Bot
          </h2>

          {/* Status */}
          <div className="flex items-center gap-2 mb-4">
            <span className={`w-3 h-3 rounded-full ${tgStatus.connected ? 'bg-green-500' : 'bg-gray-400'}`} />
            <span className="text-sm font-medium">{tgStatus.connected ? 'Connected' : 'Disconnected'}</span>
            {tgStatus.username && <span className="text-sm text-gray-500">- @{tgStatus.username}</span>}
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Bot Token (from @BotFather)</label>
              <input type="password" value={settings.telegramBotToken ?? ''} onChange={e => updateStr('telegramBotToken', e.target.value)} className="input-field w-full" placeholder="8716447884:AAG..." disabled={!isAdmin} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Group 1 Chat ID</label>
                <input type="text" value={settings.telegramGroupChatId ?? ''} onChange={e => updateStr('telegramGroupChatId', e.target.value)} className="input-field w-full" placeholder="-5226774012" disabled={!isAdmin} />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Group 1 Name</label>
                <input type="text" value={settings.telegramGroupName ?? ''} onChange={e => updateStr('telegramGroupName', e.target.value)} className="input-field w-full" placeholder="Ethanol reports" disabled={!isAdmin} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Group 2 Chat ID (optional)</label>
                <input type="text" value={settings.telegramGroup2ChatId ?? ''} onChange={e => updateStr('telegramGroup2ChatId', e.target.value)} className="input-field w-full" placeholder="-100987654321" disabled={!isAdmin} />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Group 2 Name</label>
                <input type="text" value={settings.telegramGroup2Name ?? ''} onChange={e => updateStr('telegramGroup2Name', e.target.value)} className="input-field w-full" placeholder="MSPIL Ops" disabled={!isAdmin} />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Private Chat IDs (comma-separated)</label>
              <input type="text" value={settings.telegramPrivateChatIds ?? ''} onChange={e => updateStr('telegramPrivateChatIds', e.target.value)} className="input-field w-full" placeholder="123456789, 987654321" disabled={!isAdmin} />
            </div>
            {isAdmin && (
              <div className="flex gap-2">
                <button onClick={handleTestGroup} className="btn-secondary text-sm">
                  <Send size={14} className="inline mr-1" /> Test Group
                </button>
                <button onClick={handleReconnect} disabled={tgLoading} className="btn-secondary text-sm">
                  {tgLoading ? 'Connecting...' : 'Reconnect Bot'}
                </button>
              </div>
            )}
            <p className="text-xs text-gray-400">
              Create a bot via @BotFather on Telegram. Add the bot to your groups. Send a message, then check getUpdates to find the chat ID.
            </p>
          </div>
        </div>

        {/* Module Routing */}
        <div className="mt-6 pt-6 border-t">
          <h2 className="text-lg font-semibold mb-1">Report Routing</h2>
          <p className="text-sm text-gray-500 mb-3">Tap a module to cycle: <span className="font-medium text-blue-600">{settings.telegramGroupName || 'Group 1'}</span> <ArrowRight size={12} className="inline" /> <span className="font-medium text-emerald-600">{settings.telegramGroup2Name || 'Group 2'}</span> <ArrowRight size={12} className="inline" /> <span className="font-medium text-orange-600">Private</span></p>

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
