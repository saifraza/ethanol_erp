import React, { useEffect, useState } from 'react';
import { Flame, Save, Loader2, ChevronDown, ChevronUp, Trash2, Eye, X, Share2 } from 'lucide-react';
import api from '../../services/api';

interface DryerForm {
  date: string; entryTime: string;
  [key: string]: string;
}

const DRYERS = [1, 2, 3];
const FIELDS = [
  { key: 'Moisture', label: 'Moisture %', step: '0.01' },
  { key: 'SteamFlow', label: 'Steam Flow', step: '0.1' },
  { key: 'SteamTempIn', label: 'Steam Temp In (°C)', step: '0.1' },
  { key: 'SteamTempOut', label: 'Steam Temp Out (°C)', step: '0.1' },
  { key: 'SyrupConsumption', label: 'Syrup Consumption', step: '0.01' },
  { key: 'LoadAmps', label: 'Load Amps', step: '0.1' },
];

const empty = (): DryerForm => {
  const f: any = { date: new Date().toISOString().split('T')[0], entryTime: '', finalMoisture: '', remark: '' };
  DRYERS.forEach(n => FIELDS.forEach(fd => { f[`dr${n}${fd.key}`] = ''; }));
  return f;
};

export default function DryerMonitor() {
  const [form, setForm] = useState<DryerForm>(empty());
  const [entries, setEntries] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: string; text: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const load = () => api.get('/dryer').then(r => setEntries(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const setNow = () => {
    const d = new Date();
    setForm(f => ({ ...f, entryTime: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) }));
  };

  const upd = (key: string, val: string) => setForm(f => ({ ...f, [key]: val }));

  const handleSave = async () => {
    setSaving(true); setMsg(null);
    try {
      await api.post('/dryer', form);
      setMsg({ type: 'ok', text: `Saved at ${new Date().toLocaleTimeString()}` });
      setForm(empty()); setShowPreview(false); load();
    } catch (err: any) {
      setMsg({ type: 'err', text: err.response?.data?.error || 'Save failed' });
    }
    setSaving(false);
  };

  const buildPreviewText = () => {
    const lines = [
      `*DRYER REPORT*`,
      `Date: ${form.date} | Time: ${form.entryTime || '—'}`,
    ];
    DRYERS.forEach(n => {
      lines.push('', `*Dryer ${n}:*`);
      FIELDS.forEach(fd => {
        const v = form[`dr${n}${fd.key}`];
        if (v) lines.push(`  ${fd.label}: ${v}`);
      });
    });
    if (form.finalMoisture) lines.push('', `*Final Moisture: ${form.finalMoisture}%*`);
    if (form.remark) lines.push('', `Remark: ${form.remark}`);
    return lines.filter(Boolean).join('\n');
  };

  const shareWhatsApp = () => {
    const text = encodeURIComponent(buildPreviewText());
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="rounded-lg p-4 md:p-5 mb-4 md:mb-6 text-white bg-gradient-to-r from-red-600 to-red-700">
        <div className="flex items-center gap-3 mb-1">
          <Flame size={24} />
          <h1 className="text-xl md:text-2xl font-bold">Dryer</h1>
        </div>
        <p className="text-xs md:text-sm opacity-90">3 Dryers — Moisture, Steam, Syrup, Load Amps</p>
      </div>

      {/* Date/Time */}
      <div className="bg-white rounded-lg shadow-sm border p-4 mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><label className="text-xs text-gray-500">Date</label><input type="date" value={form.date} onChange={e => upd('date', e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></div>
          <div><label className="text-xs text-gray-500">Time</label>
            <div className="flex gap-1">
              <input type="text" value={form.entryTime} onChange={e => upd('entryTime', e.target.value)} placeholder="HH:MM" className="flex-1 border rounded px-2 py-1.5 text-sm" />
              <button onClick={setNow} className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-medium hover:bg-red-200">Now</button>
            </div>
          </div>
        </div>
      </div>

      {/* 3 Dryer Cards */}
      {DRYERS.map(n => (
        <div key={n} className="bg-white rounded-lg shadow-sm border p-4 mb-4">
          <h3 className="text-sm font-semibold text-red-700 mb-3 uppercase tracking-wide">Dryer {n}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {FIELDS.map(fd => (
              <div key={fd.key}>
                <label className="text-xs text-gray-500">{fd.label}</label>
                <input
                  type="number" step={fd.step}
                  value={form[`dr${n}${fd.key}`]}
                  onChange={e => upd(`dr${n}${fd.key}`, e.target.value)}
                  placeholder="0"
                  className="w-full border rounded px-2 py-1.5 text-sm"
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Final Moisture + Remark */}
      <div className="bg-white rounded-lg shadow-sm border p-4 mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-gray-500">Final Moisture (%)</label>
            <input type="number" step="0.01" value={form.finalMoisture} onChange={e => upd('finalMoisture', e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm font-semibold" />
          </div>
          <div className="col-span-1 sm:col-span-3">
            <label className="text-xs text-gray-500">Remark</label>
            <input type="text" value={form.remark || ''} onChange={e => upd('remark', e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" />
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-4">
        <button onClick={() => setShowPreview(true)} className="flex items-center justify-center gap-2 bg-gray-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800 transition">
          <Eye size={16} /> Preview & Save
        </button>
        {msg && <span className={`text-sm font-medium ${msg.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</span>}
      </div>

      {/* Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowPreview(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-red-600 text-white p-4 rounded-t-xl flex items-center justify-between">
              <h3 className="font-bold text-lg">Dryer Report Preview</h3>
              <button onClick={() => setShowPreview(false)} className="p-1 hover:bg-red-700 rounded"><X size={20} /></button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div className="flex justify-between text-gray-600 border-b pb-2">
                <span>Date: <strong>{form.date}</strong></span>
                <span>Time: <strong>{form.entryTime || '—'}</strong></span>
              </div>

              {DRYERS.map(n => {
                const hasData = FIELDS.some(fd => form[`dr${n}${fd.key}`]);
                if (!hasData) return null;
                return (
                  <div key={n}>
                    <h4 className="font-semibold text-red-700 mb-1">Dryer {n}</h4>
                    <div className="grid grid-cols-3 gap-1.5 text-xs">
                      {FIELDS.map(fd => {
                        const v = form[`dr${n}${fd.key}`];
                        if (!v) return null;
                        return (
                          <div key={fd.key} className="bg-red-50 rounded p-1.5 text-center">
                            <div className="text-gray-500 truncate">{fd.label.replace(' (°C)', '')}</div>
                            <div className="font-semibold">{v}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {form.finalMoisture && (
                <div className="bg-red-100 rounded p-3 text-center">
                  <div className="text-xs text-gray-600">Final Moisture</div>
                  <div className="text-lg font-bold text-red-700">{form.finalMoisture}%</div>
                </div>
              )}

              {form.remark && <div className="text-gray-600 italic">Remark: {form.remark}</div>}
            </div>

            <div className="sticky bottom-0 bg-gray-50 p-4 rounded-b-xl flex gap-3 border-t">
              <button onClick={handleSave} disabled={saving} className="flex-1 flex items-center justify-center gap-2 bg-red-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save Entry
              </button>
              <button onClick={shareWhatsApp} className="flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-green-700 transition">
                <Share2 size={16} /> WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History */}
      <div className="bg-white rounded-lg shadow-sm border p-4 mb-4">
        <button onClick={() => setShowHistory(!showHistory)} className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-800 mb-2">
          {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {entries.length} entries
        </button>
        {showHistory && (
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-xs"><thead className="bg-gray-50 sticky top-0"><tr>
              {['Date', 'Time', 'D1 Mst%', 'D2 Mst%', 'D3 Mst%', 'Final%', ''].map(h =>
                <th key={h} className="px-2 py-1.5 text-left font-medium text-gray-600">{h}</th>)}
            </tr></thead><tbody>
              {entries.slice(0, 50).map(e => (
                <tr key={e.id} className="border-t hover:bg-gray-50">
                  <td className="px-2 py-1">{e.date?.split('T')[0]}</td>
                  <td className="px-2 py-1">{e.entryTime}</td>
                  <td className="px-2 py-1">{e.dr1Moisture ?? '—'}</td>
                  <td className="px-2 py-1">{e.dr2Moisture ?? '—'}</td>
                  <td className="px-2 py-1">{e.dr3Moisture ?? '—'}</td>
                  <td className="px-2 py-1 font-medium text-red-700">{e.finalMoisture ?? '—'}</td>
                  <td className="px-2 py-1"><button onClick={() => api.delete(`/dryer/${e.id}`).then(load)} className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button></td>
                </tr>
              ))}
            </tbody></table>
          </div>
        )}
      </div>
    </div>
  );
}
