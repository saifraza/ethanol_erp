import React, { useEffect, useState, useCallback } from 'react';
import api from '../services/api';
import { Save, Smartphone, RefreshCw, LogOut, Send } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

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

  const fetchWAStatus = useCallback(async () => {
    try {
      const res = await api.get('/whatsapp/status');
      setWaStatus(res.data.status);
      setWaQR(res.data.qr);
      setWaNumber(res.data.connectedNumber);
    } catch {
      // WhatsApp routes may not exist yet
    }
  }, []);

  // Poll WhatsApp status when connecting (QR needs refresh)
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

        {/* WhatsApp Connection (Baileys QR) */}
        <div className="mt-6 pt-6 border-t">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Smartphone size={20} className="text-green-600" />
            WhatsApp Connection
          </h2>

          {/* Status indicator */}
          <div className="flex items-center gap-2 mb-4">
            <span className={`w-3 h-3 rounded-full ${
              waStatus === 'connected' ? 'bg-green-500' :
              waStatus === 'connecting' ? 'bg-yellow-500 animate-pulse' :
              'bg-gray-400'
            }`} />
            <span className="text-sm font-medium capitalize">{waStatus}</span>
            {waNumber && <span className="text-sm text-gray-500">— +{waNumber}</span>}
          </div>

          {/* QR Code display */}
          {waStatus === 'connecting' && waQR && (
            <div className="mb-4 p-4 bg-white border rounded-lg inline-block">
              <p className="text-sm text-gray-600 mb-2">Scan with WhatsApp on your phone:</p>
              <img src={waQR} alt="WhatsApp QR Code" className="w-64 h-64" />
              <p className="text-xs text-gray-400 mt-2">QR refreshes automatically. Keep this page open.</p>
            </div>
          )}

          {waStatus === 'connecting' && !waQR && (
            <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-sm text-yellow-700">Generating QR code... please wait.</p>
            </div>
          )}

          {/* Connect / Disconnect buttons */}
          {isAdmin && (
            <div className="flex items-center gap-3 mb-4">
              {waStatus === 'disconnected' && (
                <button onClick={handleConnect} disabled={waLoading}
                  className="btn-primary flex items-center gap-2">
                  <RefreshCw size={16} className={waLoading ? 'animate-spin' : ''} />
                  Connect WhatsApp
                </button>
              )}
              {waStatus === 'connected' && (
                <button onClick={handleDisconnect} disabled={waLoading}
                  className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 flex items-center gap-2">
                  <LogOut size={16} />
                  Disconnect
                </button>
              )}
              {waStatus === 'connecting' && (
                <button onClick={handleDisconnect} disabled={waLoading}
                  className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 flex items-center gap-2">
                  Cancel
                </button>
              )}
            </div>
          )}

          {/* Test message (when connected) */}
          {waStatus === 'connected' && isAdmin && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg space-y-2">
              <p className="text-sm font-medium text-green-800">Send a test message</p>
              <div className="flex gap-2">
                <input type="text" value={testPhone} onChange={e => setTestPhone(e.target.value)}
                  placeholder="Phone number" className="input-field w-40" />
                <input type="text" value={testMsg} onChange={e => setTestMsg(e.target.value)}
                  className="input-field flex-1" />
                <button onClick={handleTestSend} className="btn-primary flex items-center gap-1">
                  <Send size={14} /> Send
                </button>
              </div>
              {testResult && <p className={`text-xs ${testResult.includes('success') ? 'text-green-600' : 'text-red-500'}`}>{testResult}</p>}
            </div>
          )}
        </div>

        {/* WhatsApp Share Recipients */}
        <div className="mt-6 pt-6 border-t">
          <h2 className="text-lg font-semibold mb-3">WhatsApp Share Numbers</h2>
          <p className="text-sm text-gray-500 mb-3">"Save & Share" in any module sends reports to these numbers.</p>

          {/* Show saved numbers as badges */}
          {settings.whatsappNumbers && settings.whatsappNumbers.trim() && (
            <div className="flex flex-wrap gap-2 mb-3">
              {settings.whatsappNumbers.split(',').map((p: string, i: number) => p.trim()).filter(Boolean).map((p: string, i: number) => (
                <span key={i} className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
                  <Smartphone size={14} /> +91 {p}
                </span>
              ))}
            </div>
          )}
          {(!settings.whatsappNumbers || !settings.whatsappNumbers.trim()) && (
            <p className="text-sm text-orange-500 mb-3">No numbers saved yet. Add numbers below and click Save.</p>
          )}

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
