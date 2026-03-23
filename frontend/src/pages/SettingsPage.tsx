import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { Save } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function SettingsPage() {
  const [settings, setSettings] = useState<any>({});
  const [msg, setMsg] = useState('');
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => { api.get('/settings').then(r => setSettings(r.data)); }, []);

  const update = (k: string, v: string) => setSettings((s: any) => ({ ...s, [k]: v === '' ? null : parseFloat(v) }));
  const updateStr = (k: string, v: string) => setSettings((s: any) => ({ ...s, [k]: v }));
  const updateBool = (k: string, v: boolean) => setSettings((s: any) => ({ ...s, [k]: v }));

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

        {/* WhatsApp Auto-Push */}
        <div className="mt-6 pt-6 border-t">
          <h2 className="text-lg font-semibold mb-3">WhatsApp Notifications</h2>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-600 w-52">Auto-push enabled</label>
              <button
                onClick={() => updateBool('whatsappEnabled', !settings.whatsappEnabled)}
                disabled={!isAdmin}
                className={`relative w-12 h-6 rounded-full transition-colors ${settings.whatsappEnabled ? 'bg-green-500' : 'bg-gray-300'}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${settings.whatsappEnabled ? 'translate-x-6' : ''}`} />
              </button>
              <span className="text-xs text-gray-400">{settings.whatsappEnabled ? 'ON' : 'OFF'}</span>
            </div>
            <div className="flex items-center gap-2">
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
            <p className="text-xs text-gray-400 ml-52 pl-2">
              Messages auto-sent on DDGS bag entry, dispatch, etc. Set WHATSAPP_PROVIDER env var (twilio/meta/wapi/gupshup).
            </p>
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
