import React, { useEffect, useState } from 'react';
import { Wind, Save, Loader2, ChevronDown, ChevronUp, Trash2, Eye, X, Share2 } from 'lucide-react';
import api from '../../services/api';

interface EvapForm {
  date: string; analysisTime: string;
  ff1SpGravity: string; ff1Temp: string;
  ff2SpGravity: string; ff2Temp: string;
  ff3SpGravity: string; ff3Temp: string;
  ff4SpGravity: string; ff4Temp: string;
  ff5SpGravity: string; ff5Temp: string;
  fc1SpGravity: string; fc1Temp: string;
  fc2SpGravity: string; fc2Temp: string;
  syrupConcentration: string;
  vacuum: string; thinSlopFlowRate: string;
  lastSyrupGravity: string; remark: string;
  reboilerATemp: string; reboilerBTemp: string; reboilerCTemp: string;
  thinSlopGravity: string; thinSlopSolids: string;
  spentWashGravity: string; spentWashSolids: string;
}

const empty = (): EvapForm => ({
  date: new Date().toISOString().split('T')[0], analysisTime: '',
  ff1SpGravity: '', ff1Temp: '', ff2SpGravity: '', ff2Temp: '',
  ff3SpGravity: '', ff3Temp: '', ff4SpGravity: '', ff4Temp: '',
  ff5SpGravity: '', ff5Temp: '', fc1SpGravity: '', fc1Temp: '',
  fc2SpGravity: '', fc2Temp: '',
  syrupConcentration: '',
  vacuum: '', thinSlopFlowRate: '', lastSyrupGravity: '', remark: '',
  reboilerATemp: '', reboilerBTemp: '', reboilerCTemp: '',
  thinSlopGravity: '', thinSlopSolids: '',
  spentWashGravity: '', spentWashSolids: ''
});

const FFE_UNITS = [
  { key: 'ff1', label: 'FF1' }, { key: 'ff2', label: 'FF2' },
  { key: 'ff3', label: 'FF3' }, { key: 'ff4', label: 'FF4' },
  { key: 'ff5', label: 'FF5' },
];
const FC_UNITS = [
  { key: 'fc1', label: 'FC1' }, { key: 'fc2', label: 'FC2' },
];

export default function Evaporation() {
  const [form, setForm] = useState<EvapForm>(empty());
  const [entries, setEntries] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: string; text: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const load = () => api.get('/evaporation').then(r => setEntries(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const setNow = () => {
    const d = new Date();
    setForm(f => ({ ...f, analysisTime: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) }));
  };

  const upd = (key: keyof EvapForm, val: string) => setForm(f => ({ ...f, [key]: val }));

  const handleSave = async () => {
    setSaving(true); setMsg(null);
    try {
      await api.post('/evaporation', form);
      setMsg({ type: 'ok', text: `Saved at ${new Date().toLocaleTimeString()}` });
      setForm(empty()); setShowPreview(false); load();
    } catch (err: any) {
      setMsg({ type: 'err', text: err.response?.data?.error || 'Save failed' });
    }
    setSaving(false);
  };

  const buildPreviewText = () => {
    const lines = [
      `*EVAPORATION REPORT*`,
      `Date: ${form.date} | Time: ${form.analysisTime || '—'}`,
      ``,
      `*FFE Sp.Gravity / Temp:*`,
      ...FFE_UNITS.map(u => `  ${u.label}: ${(form as any)[u.key + 'SpGravity'] || '—'} / ${(form as any)[u.key + 'Temp'] || '—'}°C`),
      ``,
      `*FC Sp.Gravity / Temp:*`,
      ...FC_UNITS.map(u => `  ${u.label}: ${(form as any)[u.key + 'SpGravity'] || '—'} / ${(form as any)[u.key + 'Temp'] || '—'}°C`),
      ``,
      `*Syrup:*`,
      `  Gravity: ${form.lastSyrupGravity || '—'}`,
      `  Concentration: ${form.syrupConcentration || '—'}%`,
      ``,
      `*Reboiler (Analyzer Column):*`,
      `  A: ${form.reboilerATemp || '—'}°C | B: ${form.reboilerBTemp || '—'}°C | C: ${form.reboilerCTemp || '—'}°C`,
      ``,
      `*Thin Slop:*`,
      `  Gravity: ${form.thinSlopGravity || '—'} | Solids: ${form.thinSlopSolids || '—'}%`,
      `*Spent Wash:*`,
      `  Gravity: ${form.spentWashGravity || '—'} | Solids: ${form.spentWashSolids || '—'}%`,
      ``,
      `Vacuum: ${form.vacuum || '—'}`,
      `Thin Slop Flow Rate: ${form.thinSlopFlowRate || '—'}`,
      form.remark ? `Remark: ${form.remark}` : '',
    ];
    return lines.filter(Boolean).join('\n');
  };

  const shareWhatsApp = () => {
    const text = encodeURIComponent(buildPreviewText());
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="rounded-lg p-4 md:p-5 mb-4 md:mb-6 text-white bg-gradient-to-r from-teal-600 to-teal-700">
        <div className="flex items-center gap-3 mb-1">
          <Wind size={24} />
          <h1 className="text-xl md:text-2xl font-bold">Evaporation</h1>
        </div>
        <p className="text-xs md:text-sm opacity-90">FFE & FC readings, concentration, vacuum & thin slop</p>
      </div>

      {/* FFE Section */}
      <div className="bg-white rounded-lg shadow-sm border p-4 mb-4">
        <h3 className="text-sm font-semibold text-teal-700 mb-3 uppercase tracking-wide">FFE Specific Gravity & Temperature</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <div><label className="text-xs text-gray-500">Date</label><input type="date" value={form.date} onChange={e => upd('date', e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></div>
          <div><label className="text-xs text-gray-500">Time</label>
            <div className="flex gap-1">
              <input type="text" value={form.analysisTime} onChange={e => upd('analysisTime', e.target.value)} placeholder="HH:MM" className="flex-1 border rounded px-2 py-1.5 text-sm" />
              <button onClick={setNow} className="px-2 py-1 bg-teal-100 text-teal-700 rounded text-xs font-medium hover:bg-teal-200">Now</button>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-teal-50">
              <th className="px-2 py-1.5 text-left text-xs font-medium text-teal-700">Unit</th>
              <th className="px-2 py-1.5 text-left text-xs font-medium text-teal-700">Sp. Gravity</th>
              <th className="px-2 py-1.5 text-left text-xs font-medium text-teal-700">Temp (°C)</th>
            </tr></thead>
            <tbody>
              {FFE_UNITS.map(u => (
                <tr key={u.key} className="border-t">
                  <td className="px-2 py-1.5 font-medium text-gray-700">{u.label}</td>
                  <td className="px-2 py-1"><input type="number" step="0.001" value={(form as any)[u.key + 'SpGravity']} onChange={e => upd((u.key + 'SpGravity') as any, e.target.value)} className="w-full border rounded px-2 py-1 text-sm" /></td>
                  <td className="px-2 py-1"><input type="number" step="0.1" value={(form as any)[u.key + 'Temp']} onChange={e => upd((u.key + 'Temp') as any, e.target.value)} className="w-full border rounded px-2 py-1 text-sm" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* FC Section */}
      <div className="bg-white rounded-lg shadow-sm border p-4 mb-4">
        <h3 className="text-sm font-semibold text-blue-700 mb-3 uppercase tracking-wide">FC Specific Gravity & Temperature</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-blue-50">
              <th className="px-2 py-1.5 text-left text-xs font-medium text-blue-700">Unit</th>
              <th className="px-2 py-1.5 text-left text-xs font-medium text-blue-700">Sp. Gravity</th>
              <th className="px-2 py-1.5 text-left text-xs font-medium text-blue-700">Temp (°C)</th>
            </tr></thead>
            <tbody>
              {FC_UNITS.map(u => (
                <tr key={u.key} className="border-t">
                  <td className="px-2 py-1.5 font-medium text-gray-700">{u.label}</td>
                  <td className="px-2 py-1"><input type="number" step="0.001" value={(form as any)[u.key + 'SpGravity']} onChange={e => upd((u.key + 'SpGravity') as any, e.target.value)} className="w-full border rounded px-2 py-1 text-sm" /></td>
                  <td className="px-2 py-1"><input type="number" step="0.1" value={(form as any)[u.key + 'Temp']} onChange={e => upd((u.key + 'Temp') as any, e.target.value)} className="w-full border rounded px-2 py-1 text-sm" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Syrup Gravity & Concentration */}
      <div className="bg-white rounded-lg shadow-sm border p-4 mb-4">
        <h3 className="text-sm font-semibold text-purple-700 mb-3 uppercase tracking-wide">Syrup Gravity & Concentration</h3>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs text-gray-500">Syrup Gravity</label><input type="number" step="0.001" value={form.lastSyrupGravity} onChange={e => upd('lastSyrupGravity', e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></div>
          <div><label className="text-xs text-gray-500">Concentration (%)</label><input type="number" step="0.01" value={form.syrupConcentration} onChange={e => upd('syrupConcentration', e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" placeholder="%" /></div>
        </div>
      </div>

      {/* Reboiler (Analyzer Column) */}
      <div className="bg-white rounded-lg shadow-sm border p-4 mb-4">
        <h3 className="text-sm font-semibold text-red-700 mb-3 uppercase tracking-wide">Reboiler — Analyzer Column</h3>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="text-xs text-gray-500">Reboiler A (°C)</label><input type="number" step="0.1" value={form.reboilerATemp} onChange={e => upd('reboilerATemp', e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></div>
          <div><label className="text-xs text-gray-500">Reboiler B (°C)</label><input type="number" step="0.1" value={form.reboilerBTemp} onChange={e => upd('reboilerBTemp', e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></div>
          <div><label className="text-xs text-gray-500">Reboiler C (°C)</label><input type="number" step="0.1" value={form.reboilerCTemp} onChange={e => upd('reboilerCTemp', e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></div>
        </div>
      </div>

      {/* Thin Slop & Spent Wash */}
      <div className="bg-white rounded-lg shadow-sm border p-4 mb-4">
        <h3 className="text-sm font-semibold text-amber-700 mb-3 uppercase tracking-wide">Thin Slop & Spent Wash</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><label className="text-xs text-gray-500">Thin Slop Gravity</label><input type="number" step="0.001" value={form.thinSlopGravity} onChange={e => upd('thinSlopGravity', e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></div>
          <div><label className="text-xs text-gray-500">Thin Slop Solids (%)</label><input type="number" step="0.01" value={form.thinSlopSolids} onChange={e => upd('thinSlopSolids', e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></div>
          <div><label className="text-xs text-gray-500">Spent Wash Gravity</label><input type="number" step="0.001" value={form.spentWashGravity} onChange={e => upd('spentWashGravity', e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></div>
          <div><label className="text-xs text-gray-500">Spent Wash Solids (%)</label><input type="number" step="0.01" value={form.spentWashSolids} onChange={e => upd('spentWashSolids', e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></div>
        </div>
      </div>

      {/* Vacuum, Thin Slop Flow, Remark */}
      <div className="bg-white rounded-lg shadow-sm border p-4 mb-4">
        <h3 className="text-sm font-semibold text-orange-700 mb-3 uppercase tracking-wide">Process Parameters</h3>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs text-gray-500">Vacuum</label><input type="number" step="0.01" value={form.vacuum} onChange={e => upd('vacuum', e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></div>
          <div><label className="text-xs text-gray-500">Thin Slop Flow Rate</label><input type="number" step="0.01" value={form.thinSlopFlowRate} onChange={e => upd('thinSlopFlowRate', e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></div>
        </div>
        <div className="mt-3">
          <label className="text-xs text-gray-500">Remark</label>
          <input type="text" value={form.remark} onChange={e => upd('remark', e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" />
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
            <div className="sticky top-0 bg-teal-600 text-white p-4 rounded-t-xl flex items-center justify-between">
              <h3 className="font-bold text-lg">Evaporation Report Preview</h3>
              <button onClick={() => setShowPreview(false)} className="p-1 hover:bg-teal-700 rounded"><X size={20} /></button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div className="flex justify-between text-gray-600 border-b pb-2">
                <span>Date: <strong>{form.date}</strong></span>
                <span>Time: <strong>{form.analysisTime || '—'}</strong></span>
              </div>

              <div>
                <h4 className="font-semibold text-teal-700 mb-1">FFE Sp.Gravity / Temp</h4>
                <div className="grid grid-cols-5 gap-2">
                  {FFE_UNITS.map(u => (
                    <div key={u.key} className="bg-teal-50 rounded p-2 text-center">
                      <div className="text-xs text-gray-500">{u.label}</div>
                      <div className="font-semibold">{(form as any)[u.key + 'SpGravity'] || '—'}</div>
                      <div className="text-xs text-gray-500">{(form as any)[u.key + 'Temp'] || '—'}°C</div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-blue-700 mb-1">FC Sp.Gravity / Temp</h4>
                <div className="grid grid-cols-2 gap-2">
                  {FC_UNITS.map(u => (
                    <div key={u.key} className="bg-blue-50 rounded p-2 text-center">
                      <div className="text-xs text-gray-500">{u.label}</div>
                      <div className="font-semibold">{(form as any)[u.key + 'SpGravity'] || '—'}</div>
                      <div className="text-xs text-gray-500">{(form as any)[u.key + 'Temp'] || '—'}°C</div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-purple-700 mb-1">Syrup</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-purple-50 rounded p-2 text-center">
                    <div className="text-xs text-gray-500">Gravity</div>
                    <div className="font-semibold">{form.lastSyrupGravity || '—'}</div>
                  </div>
                  <div className="bg-purple-50 rounded p-2 text-center">
                    <div className="text-xs text-gray-500">Concentration</div>
                    <div className="font-semibold">{form.syrupConcentration || '—'}%</div>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-red-700 mb-1">Reboiler — Analyzer Column</h4>
                <div className="grid grid-cols-3 gap-2">
                  {['A', 'B', 'C'].map(l => (
                    <div key={l} className="bg-red-50 rounded p-2 text-center">
                      <div className="text-xs text-gray-500">Reboiler {l}</div>
                      <div className="font-semibold">{(form as any)[`reboiler${l}Temp`] || '—'}°C</div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-amber-700 mb-1">Thin Slop & Spent Wash</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-amber-50 rounded p-2 text-center">
                    <div className="text-xs text-gray-500">Thin Slop Gr</div>
                    <div className="font-semibold">{form.thinSlopGravity || '—'}</div>
                    <div className="text-xs text-gray-400">Solids: {form.thinSlopSolids || '—'}%</div>
                  </div>
                  <div className="bg-amber-50 rounded p-2 text-center">
                    <div className="text-xs text-gray-500">Spent Wash Gr</div>
                    <div className="font-semibold">{form.spentWashGravity || '—'}</div>
                    <div className="text-xs text-gray-400">Solids: {form.spentWashSolids || '—'}%</div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="bg-orange-50 rounded p-2 text-center">
                  <div className="text-xs text-gray-500">Vacuum</div>
                  <div className="font-semibold">{form.vacuum || '—'}</div>
                </div>
                <div className="bg-orange-50 rounded p-2 text-center">
                  <div className="text-xs text-gray-500">Thin Slop Flow</div>
                  <div className="font-semibold">{form.thinSlopFlowRate || '—'}</div>
                </div>
              </div>

              {form.remark && <div className="text-gray-600 italic">Remark: {form.remark}</div>}
            </div>

            <div className="sticky bottom-0 bg-gray-50 p-4 rounded-b-xl flex gap-3 border-t">
              <button onClick={handleSave} disabled={saving} className="flex-1 flex items-center justify-center gap-2 bg-teal-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50 transition">
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
              {['Date', 'Time', 'FF1 SG', 'FF5 SG', 'Reb A', 'Reb B', 'Reb C', 'TS Gr', 'SW Gr', 'Vacuum', ''].map(h =>
                <th key={h} className="px-2 py-1 text-left font-medium text-gray-600">{h}</th>)}
            </tr></thead><tbody>
              {entries.slice(0, 50).map(e => (
                <tr key={e.id} className="border-t hover:bg-gray-50">
                  <td className="px-2 py-1">{e.date?.split('T')[0]}</td>
                  <td className="px-2 py-1">{e.analysisTime}</td>
                  <td className="px-2 py-1">{e.ff1SpGravity ?? '—'}</td>
                  <td className="px-2 py-1">{e.ff5SpGravity ?? '—'}</td>
                  <td className="px-2 py-1">{e.reboilerATemp ?? '—'}</td>
                  <td className="px-2 py-1">{e.reboilerBTemp ?? '—'}</td>
                  <td className="px-2 py-1">{e.reboilerCTemp ?? '—'}</td>
                  <td className="px-2 py-1">{e.thinSlopGravity ?? '—'}</td>
                  <td className="px-2 py-1">{e.spentWashGravity ?? '—'}</td>
                  <td className="px-2 py-1">{e.vacuum ?? '—'}</td>
                  <td className="px-2 py-1"><button onClick={() => api.delete(`/evaporation/${e.id}`).then(load)} className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button></td>
                </tr>
              ))}
            </tbody></table>
          </div>
        )}
      </div>
    </div>
  );
}
