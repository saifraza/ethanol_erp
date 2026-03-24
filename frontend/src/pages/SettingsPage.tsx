import React, { useEffect, useState, useCallback } from 'react';
import api from '../services/api';
import { Save, Smartphone, RefreshCw, LogOut, Send, Users, Lock, CheckSquare, Square } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface WAGroup {
  id: string;
  subject: string;
  size: number;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<any>({});
  const [msg, setMsg] = useState('');
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  // WhatsApp Baileys state
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
  const [privateModules, setPrivateModules] = useState<string[]>([]);


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

  useEffect(() => {
    let savedPrivate: string[] | null = null;
    api.get('/settings').then(r => {
      setSettings(r.data);
      // Parse saved private modules
      try {
        if (r.data.whatsappPrivateModules) {
          savedPrivate = JSON.parse(r.data.whatsappPrivateModules);
          setPrivateModules(savedPrivate!);
        }
      } catch { /* ignore */ }
    });
    api.get('/whatsapp/modules').then(r => {
      setAllModules(r.data.all);
      // Only use defaults if nothing was saved in DB
      setPrivateModules(prev => prev.length > 0 ? prev : (savedPrivate || r.data.privateModules));
    }).catch(() => {});
  }, []);

  const togglePrivateModule = (mod: string) => {
    setPrivateModules(prev => {
      const next = prev.includes(mod) ? prev.filter(m => m !== mod) : [...prev, mod];
      setSettings((s: any) => ({ ...s, whatsappPrivateModules: JSON.stringify(next) }));
      return next;
    });
  };

  const MODULE_LABELS: Record<string, string> = {
    'liquefaction': 'Liquefaction', 'fermentation': 'Fermentation', 'distillation': 'Distillation',
    'milling': 'Milling', 'evaporation': 'Evaporation', 'decanter': 'Decanter',
    'dryer': 'Dryer', 'ethanol-product': 'Ethanol Product', 'grain': 'Grain',
    'ddgs': 'DDGS', 'ddgs-stock': 'DDGS Stock', 'ddgs-dispatch': 'DDGS Dispatch',
    'sales': 'Sales', 'dispatch': 'Dispatch', 'procurement': 'Procurement',
    'accounts': 'Accounts', 'inventory': 'Inventory',
  };

  // Fetch groups when connected
  useEffect(() => {
    if (waStatus === 'connected') fetchGroups();
  }, [waStatus]);

  const update = (k: string, v: string) => setSettings((s: any) => ({ ...s, [k]: v === '' ? null : parseFloat(v) }));
  const updateStr = (k: string, v: string) => setSettings((s: any) => ({ ...s, [k]: v }));

  const save = async () => {
    await api.patch('/settings', settings);
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

        {/* Group Share — production data goes here */}
        <div className="mt-6 pt-6 border-t">
          <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
            <Users size={18} className="text-blue-600" />
            Group Share <span className="text-xs font-normal text-gray-400">(production data)</span>
          </h2>
          <p className="text-sm text-gray-500 mb-3">Liquefaction, Fermentation, Distillation, Milling etc. reports go to this group.</p>

          {settings.whatsappGroupJid && settings.whatsappGroupName && (
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-100 text-blue-800 rounded-full text-sm font-medium">
                <Users size={14} /> {settings.whatsappGroupName}
              </span>
              {isAdmin && (
                <button onClick={() => { updateStr('whatsappGroupJid', ''); updateStr('whatsappGroupName', ''); }}
                  className="text-xs text-red-500 hover:underline">Remove</button>
              )}
            </div>
          )}

          {!settings.whatsappGroupJid && waStatus === 'connected' && isAdmin && (
            <div className="space-y-2">
              <button onClick={fetchGroups} disabled={loadingGroups}
                className="text-sm text-blue-600 hover:underline flex items-center gap-1">
                <RefreshCw size={12} className={loadingGroups ? 'animate-spin' : ''} /> {loadingGroups ? 'Loading...' : 'Load my groups'}
              </button>
              {groups.length > 0 && (
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {groups.map(g => (
                    <button key={g.id} onClick={() => { updateStr('whatsappGroupJid', g.id); updateStr('whatsappGroupName', g.subject); }}
                      className="w-full text-left px-3 py-2 bg-gray-50 hover:bg-blue-50 rounded-lg text-sm flex justify-between items-center">
                      <span>{g.subject}</span>
                      <span className="text-xs text-gray-400">{g.size} members</span>
                    </button>
                  ))}
                </div>
              )}
              {groups.length === 0 && !loadingGroups && (
                <p className="text-xs text-gray-400">No groups found. Make sure the connected number is in a group.</p>
              )}
            </div>
          )}

          {!settings.whatsappGroupJid && waStatus !== 'connected' && (
            <p className="text-sm text-orange-500">Connect WhatsApp first to select a group.</p>
          )}
        </div>

        {/* Private Numbers — sensitive data goes here */}
        <div className="mt-6 pt-6 border-t">
          <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
            <Lock size={18} className="text-orange-600" />
            Private Numbers <span className="text-xs font-normal text-gray-400">(sensitive data)</span>
          </h2>
          <p className="text-sm text-gray-500 mb-3">Private-only modules send here. Group modules go to the group (no duplicates).</p>

          {settings.whatsappNumbers && settings.whatsappNumbers.trim() && (
            <div className="flex flex-wrap gap-2 mb-3">
              {settings.whatsappNumbers.split(',').map((p: string) => p.trim()).filter(Boolean).map((p: string, i: number) => (
                <span key={i} className="inline-flex items-center gap-1 px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-sm font-medium">
                  <Smartphone size={14} /> +91 {p}
                </span>
              ))}
            </div>
          )}
          {(!settings.whatsappNumbers || !settings.whatsappNumbers.trim()) && (
            <p className="text-sm text-orange-500 mb-3">No private numbers saved yet.</p>
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

          {/* Module routing — tap a module to toggle between group and private */}
          <div className="mt-4">
            <p className="text-sm font-medium text-gray-700 mb-2">Module Routing <span className="text-xs text-gray-400">(tap to toggle)</span></p>
            <div className="grid grid-cols-2 gap-3">
              {/* Group column */}
              <div>
                <div className="text-[10px] font-bold text-blue-600 uppercase mb-1.5 flex items-center gap-1"><Users size={11} /> Group</div>
                <div className="space-y-1">
                  {allModules.filter(m => !privateModules.includes(m)).map(mod => (
                    <button key={mod} onClick={() => isAdmin && togglePrivateModule(mod)} disabled={!isAdmin}
                      className="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors text-left">
                      <Users size={11} /> {MODULE_LABELS[mod] || mod}
                    </button>
                  ))}
                  {allModules.filter(m => !privateModules.includes(m)).length === 0 && (
                    <p className="text-[10px] text-gray-400 italic px-2">No modules in group</p>
                  )}
                </div>
              </div>
              {/* Private column */}
              <div>
                <div className="text-[10px] font-bold text-orange-600 uppercase mb-1.5 flex items-center gap-1"><Lock size={11} /> Private Only</div>
                <div className="space-y-1">
                  {allModules.filter(m => privateModules.includes(m)).map(mod => (
                    <button key={mod} onClick={() => isAdmin && togglePrivateModule(mod)} disabled={!isAdmin}
                      className="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 transition-colors text-left">
                      <Lock size={11} /> {MODULE_LABELS[mod] || mod}
                    </button>
                  ))}
                  {allModules.filter(m => privateModules.includes(m)).length === 0 && (
                    <p className="text-[10px] text-gray-400 italic px-2">No private modules</p>
                  )}
                </div>
              </div>
            </div>
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
