import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Flame, Save, Loader2, ChevronDown, ChevronUp, Trash2, Eye, X, Share2, Camera, ZoomIn, ZoomOut } from 'lucide-react';
import api from '../../services/api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface DistForm {
  date: string; analysisTime: string;
  spentWashLoss: string; rcLessLoss: string; ethanolStrength: string;
  rcReflexStrength: string; regenerationStrength: string; evaporationSpgr: string;
  rcStrength: string; actStrength: string; spentLossLevel: string;
  remark: string;
}

const emptyForm = (): DistForm => ({
  date: new Date().toISOString().split('T')[0], analysisTime: '',
  spentWashLoss: '', rcLessLoss: '', ethanolStrength: '', rcReflexStrength: '',
  regenerationStrength: '', evaporationSpgr: '',
  rcStrength: '', actStrength: '', spentLossLevel: '',
  remark: ''
});

const LOSS_LEVELS = ['NIL', 'SLIGHT', 'HIGH'];

export default function Distillation() {
  const [form, setForm] = useState<DistForm>(emptyForm());
  const [entries, setEntries] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: string; text: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Photo state
  const [swPhoto, setSwPhoto] = useState<File | null>(null);
  const [swPreview, setSwPreview] = useState<string | null>(null);
  const [rcPhoto, setRcPhoto] = useState<File | null>(null);
  const [rcPreview, setRcPreview] = useState<string | null>(null);
  const swInputRef = useRef<HTMLInputElement>(null);
  const rcInputRef = useRef<HTMLInputElement>(null);

  const load = () => api.get('/distillation').then(r => setEntries(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const setNow = () => {
    const d = new Date();
    setForm(f => ({ ...f, analysisTime: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) }));
  };

  const handleSave = async (share = false) => {
    setSaving(true); setMsg(null);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => { if (v !== '' && v != null) fd.append(k, v); });
      if (swPhoto) fd.append('spentWashPhoto', swPhoto);
      if (rcPhoto) fd.append('rcLessPhoto', rcPhoto);
      await api.post('/distillation', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (share) {
        try {
          await api.post('/telegram/send-report', { message: buildPreviewText(), module: 'distillation' });
          setMsg({ type: 'ok', text: 'Saved & shared on Telegram' });
        } catch { setMsg({ type: 'ok', text: 'Saved! Telegram send failed' }); }
      } else {
        setMsg({ type: 'ok', text: `Saved at ${new Date().toLocaleTimeString()}` });
      }
      setForm(emptyForm()); setShowPreview(false);
      setSwPhoto(null); setSwPreview(null); setRcPhoto(null); setRcPreview(null);
      load();
    } catch (err: unknown) {
      setMsg({ type: 'err', text: err.response?.data?.error || 'Save failed' });
    }
    setSaving(false);
  };

  const upd = (key: keyof DistForm, val: string) => setForm(f => ({ ...f, [key]: val }));

  const handlePhoto = (file: File | undefined, setPhoto: (f: File | null) => void, setPreview: (s: string | null) => void) => {
    if (!file) return;
    setPhoto(file);
    const reader = new FileReader();
    reader.onloadend = () => setPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const buildPreviewText = () => {
    const lines = [
      `*DISTILLATION REPORT*`,
      `Date: ${form.date} | Time: ${form.analysisTime || '—'}`,
      ``,
      `RC Strength: ${form.rcStrength || '—'}`,
      `ACT Strength: ${form.actStrength || '—'}`,
      `Ethanol Strength: ${form.ethanolStrength || '—'}%`,
      `RC Reflex Strength: ${form.rcReflexStrength || '—'}`,
      `Regeneration Strength: ${form.regenerationStrength || '—'}`,
      ``,
      `Spent Wash Loss: ${form.spentWashLoss || '—'}${swPhoto ? ' 📷' : ''}`,
      `RC Less Loss: ${form.rcLessLoss || '—'}${rcPhoto ? ' 📷' : ''}`,
      `Spent Loss: ${form.spentLossLevel || '—'}`,
      `Evaporation SPGR: ${form.evaporationSpgr || '—'}`,
      form.remark ? `Remark: ${form.remark}` : '',
    ];
    return lines.filter(Boolean).join('\n');
  };

  const shareReport = async () => {
    try {
      const text = buildPreviewText();
      await api.post('/telegram/send-report', { message: text, module: 'distillation' });
      setMsg({ type: 'ok', text: 'Report shared via Telegram' });
    } catch (err: unknown) {
      setMsg({ type: 'err', text: err.response?.data?.error || 'Failed to share report' });
    }
  };

  const chartData = [...entries].reverse().map(e => ({
    time: `${e.date?.split('T')[0]?.slice(5)} ${e.analysisTime?.slice(0, 5) || ''}`,
    ethanol: e.ethanolStrength, rcReflex: e.rcReflexStrength
  }));

  /* ---- chart stats ---- */
  const chartStats = useMemo(() => {
    const vals = entries.map(e => e.ethanolStrength).filter((v): v is number => v !== null && v !== undefined && !isNaN(Number(v)));
    if (vals.length === 0) return { mean: 0, min: 0, max: 0, range: 0, count: 0 };
    const sum = vals.reduce((a, b) => a + Number(b), 0);
    const mean = sum / vals.length;
    const min = Math.min(...vals.map(Number));
    const max = Math.max(...vals.map(Number));
    return { mean, min, max, range: max - min, count: vals.length };
  }, [entries]);

  const [yZoom, setYZoom] = useState(0);

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="p-4 md:p-5 mb-4 md:mb-6 text-white bg-gradient-to-r from-red-600 to-red-700">
        <div className="flex items-center gap-3 mb-1">
          <Flame size={24} />
          <h1 className="text-xl md:text-2xl font-bold">Distillation</h1>
        </div>
        <p className="text-xs md:text-sm opacity-90">RC, ACT strength, spent loss analysis & ethanol readings</p>
      </div>

      {/* Main Entry Form */}
      <div className="bg-white border p-4 mb-4">
        <h3 className="text-sm font-semibold text-red-700 mb-3 uppercase tracking-wide">New Reading</h3>

        {/* Date/Time */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div><label className="text-xs text-gray-500">Date</label><input type="date" value={form.date} onChange={e => upd('date', e.target.value)} className="w-full border px-2 py-1.5 text-sm" /></div>
          <div><label className="text-xs text-gray-500">Time</label>
            <div className="flex gap-1">
              <input type="text" value={form.analysisTime} onChange={e => upd('analysisTime', e.target.value)} placeholder="HH:MM AM" className="flex-1 border px-2 py-1.5 text-sm" />
              <button onClick={setNow} className="px-2 py-1 bg-red-100 text-red-700 text-xs font-medium hover:bg-red-200">Now</button>
            </div>
          </div>
        </div>

        {/* RC & ACT Strength */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div><label className="text-xs text-gray-500">RC Strength</label><input type="number" step="0.01" value={form.rcStrength} onChange={e => upd('rcStrength', e.target.value)} className="w-full border px-2 py-1.5 text-sm" /></div>
          <div><label className="text-xs text-gray-500">ACT Strength</label><input type="number" step="0.01" value={form.actStrength} onChange={e => upd('actStrength', e.target.value)} className="w-full border px-2 py-1.5 text-sm" /></div>
          <div><label className="text-xs text-gray-500">Ethanol Strength %</label><input type="number" step="0.01" value={form.ethanolStrength} onChange={e => upd('ethanolStrength', e.target.value)} placeholder="99.9" className="w-full border px-2 py-1.5 text-sm" /></div>
          <div><label className="text-xs text-gray-500">RC Reflex Strength</label><input type="number" step="0.01" value={form.rcReflexStrength} onChange={e => upd('rcReflexStrength', e.target.value)} className="w-full border px-2 py-1.5 text-sm" /></div>
        </div>

        {/* Spent Loss Level — clickable buttons */}
        <div className="mb-4">
          <label className="text-xs text-gray-500 block mb-1.5">Spent Loss</label>
          <div className="flex gap-2">
            {LOSS_LEVELS.map(level => (
              <button
                key={level}
                onClick={() => upd('spentLossLevel', form.spentLossLevel === level ? '' : level)}
                className={`px-4 py-2 text-sm font-medium transition border-2 ${
                  form.spentLossLevel === level
                    ? level === 'NIL' ? 'bg-green-100 border-green-500 text-green-700'
                      : level === 'SLIGHT' ? 'bg-yellow-100 border-yellow-500 text-yellow-700'
                      : 'bg-red-100 border-red-500 text-red-700'
                    : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'
                }`}
              >
                {level}
              </button>
            ))}
          </div>
        </div>

        {/* Spent Wash Loss + Photo */}
        <div className="mb-4 p-3 border border-orange-200 bg-orange-50/30">
          <label className="block text-xs font-semibold text-orange-700 mb-2">Spent Wash Loss</label>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="w-32">
              <input type="number" step="0.01" value={form.spentWashLoss} onChange={e => upd('spentWashLoss', e.target.value)} placeholder="Value" className="w-full border px-2 py-1.5 text-sm" />
            </div>
            <input ref={swInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => handlePhoto(e.target.files?.[0], setSwPhoto, setSwPreview)} />
            <button type="button" onClick={() => swInputRef.current?.click()} className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-100 text-orange-700 text-xs font-medium hover:bg-orange-200 transition">
              <Camera size={14} /> {swPhoto ? 'Change Photo' : 'Take Photo'}
            </button>
            {swPreview && <img src={swPreview} alt="Spent wash" className="w-16 h-16 object-cover border" />}
          </div>
        </div>

        {/* RC Less Loss + Photo */}
        <div className="mb-4 p-3 border border-blue-200 bg-blue-50/30">
          <label className="block text-xs font-semibold text-blue-700 mb-2">RC Less Loss</label>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="w-32">
              <input type="number" step="0.01" value={form.rcLessLoss} onChange={e => upd('rcLessLoss', e.target.value)} placeholder="Value" className="w-full border px-2 py-1.5 text-sm" />
            </div>
            <input ref={rcInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => handlePhoto(e.target.files?.[0], setRcPhoto, setRcPreview)} />
            <button type="button" onClick={() => rcInputRef.current?.click()} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-100 text-blue-700 text-xs font-medium hover:bg-blue-200 transition">
              <Camera size={14} /> {rcPhoto ? 'Change Photo' : 'Take Photo'}
            </button>
            {rcPreview && <img src={rcPreview} alt="RC less" className="w-16 h-16 object-cover border" />}
          </div>
        </div>

        {/* Other fields */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div><label className="text-xs text-gray-500">Regeneration Strength</label><input type="number" step="0.01" value={form.regenerationStrength} onChange={e => upd('regenerationStrength', e.target.value)} className="w-full border px-2 py-1.5 text-sm" /></div>
          <div><label className="text-xs text-gray-500">Evaporation SPGR</label><input type="number" step="0.01" value={form.evaporationSpgr} onChange={e => upd('evaporationSpgr', e.target.value)} className="w-full border px-2 py-1.5 text-sm" /></div>
        </div>

        <div className="mb-4">
          <label className="text-xs text-gray-500">Remark</label>
          <input type="text" value={form.remark} onChange={e => upd('remark', e.target.value)} className="w-full border px-2 py-1.5 text-sm" />
        </div>

        {/* Action buttons */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <button onClick={() => setShowPreview(true)} className="flex items-center justify-center gap-2 bg-gray-700 text-white px-5 py-2.5 text-sm font-medium hover:bg-gray-800 transition">
            <Eye size={16} /> Preview & Save
          </button>
          {msg && <span className={`text-sm font-medium ${msg.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</span>}
        </div>
      </div>

      {/* Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowPreview(false)}>
          <div className="bg-white shadow-2xl w-full max-w-md max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-red-600 text-white p-4 flex items-center justify-between">
              <h3 className="font-bold text-lg">Distillation Report Preview</h3>
              <button onClick={() => setShowPreview(false)} className="p-1 hover:bg-red-700"><X size={20} /></button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div className="flex justify-between text-gray-600 border-b pb-2">
                <span>Date: <strong>{form.date}</strong></span>
                <span>Time: <strong>{form.analysisTime || '—'}</strong></span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-red-50 p-2 text-center">
                  <div className="text-xs text-gray-500">RC Strength</div>
                  <div className="font-bold text-lg">{form.rcStrength || '—'}</div>
                </div>
                <div className="bg-blue-50 p-2 text-center">
                  <div className="text-xs text-gray-500">ACT Strength</div>
                  <div className="font-bold text-lg">{form.actStrength || '—'}</div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="bg-gray-50 p-2 text-center">
                  <div className="text-xs text-gray-500">Ethanol %</div>
                  <div className="font-semibold">{form.ethanolStrength || '—'}</div>
                </div>
                <div className="bg-gray-50 p-2 text-center">
                  <div className="text-xs text-gray-500">RC Reflex</div>
                  <div className="font-semibold">{form.rcReflexStrength || '—'}</div>
                </div>
                <div className="bg-gray-50 p-2 text-center">
                  <div className="text-xs text-gray-500">Regen</div>
                  <div className="font-semibold">{form.regenerationStrength || '—'}</div>
                </div>
              </div>

              {/* Spent Loss Level badge */}
              <div className="flex items-center gap-2">
                <span className="text-gray-600 text-sm">Spent Loss:</span>
                {form.spentLossLevel ? (
                  <span className={`px-3 py-1 text-sm font-bold ${
                    form.spentLossLevel === 'NIL' ? 'bg-green-100 text-green-700'
                    : form.spentLossLevel === 'SLIGHT' ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-red-100 text-red-700'
                  }`}>{form.spentLossLevel}</span>
                ) : <span className="text-gray-400">—</span>}
              </div>

              {/* Spent Wash + RC Less with photos */}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-orange-50 p-2 text-center">
                  <div className="text-xs text-gray-500">Spent Wash Loss</div>
                  <div className="font-semibold">{form.spentWashLoss || '—'}</div>
                  {swPreview && <img src={swPreview} alt="SW" className="mt-1 w-16 h-16 object-cover border mx-auto" />}
                </div>
                <div className="bg-blue-50 p-2 text-center">
                  <div className="text-xs text-gray-500">RC Less Loss</div>
                  <div className="font-semibold">{form.rcLessLoss || '—'}</div>
                  {rcPreview && <img src={rcPreview} alt="RC" className="mt-1 w-16 h-16 object-cover border mx-auto" />}
                </div>
              </div>

              <div className="bg-orange-50 p-2 text-center">
                <div className="text-xs text-gray-500">Evap SPGR</div>
                <div className="font-semibold">{form.evaporationSpgr || '—'}</div>
              </div>

              {form.remark && <div className="text-gray-600 italic">Remark: {form.remark}</div>}
            </div>

            <div className="sticky bottom-0 bg-gray-50 p-4 flex gap-3 border-t">
              <button onClick={() => handleSave(false)} disabled={saving} className="flex-1 flex items-center justify-center gap-2 bg-red-600 text-white px-4 py-2.5 text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save
              </button>
              <button onClick={() => handleSave(true)} disabled={saving} className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-2.5 text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />} Save & Share
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Trends */}
      <div className="bg-white border border-slate-300 p-3 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Trends</h3>
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-slate-400 uppercase tracking-widest mr-1">Y-Zoom</span>
            <button onClick={() => setYZoom(z => z + 1)} className="px-1.5 py-0.5 border border-slate-300 text-slate-600 text-xs hover:bg-slate-100"><ZoomIn size={12} /></button>
            <button onClick={() => setYZoom(z => Math.max(0, z - 1))} className="px-1.5 py-0.5 border border-slate-300 text-slate-600 text-xs hover:bg-slate-100"><ZoomOut size={12} /></button>
            {yZoom > 0 && <button onClick={() => setYZoom(0)} className="px-1.5 py-0.5 text-[9px] text-blue-600 hover:underline">Reset</button>}
          </div>
        </div>
        {chartStats.count > 0 && (
          <div className="grid grid-cols-3 md:grid-cols-5 gap-0 border border-slate-300 mb-2">
            {[
              { label: 'Mean', value: chartStats.mean.toFixed(2), color: 'indigo' },
              { label: 'Min', value: chartStats.min.toFixed(2), color: 'cyan' },
              { label: 'Max', value: chartStats.max.toFixed(2), color: 'red' },
              { label: 'Range', value: chartStats.range.toFixed(2), color: 'amber' },
              { label: 'Samples', value: String(chartStats.count), color: 'slate' },
            ].map(s => (
              <div key={s.label} className="px-2 py-2 border-r border-slate-200 last:border-r-0">
                <div className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{s.label}</div>
                <div className={`text-sm font-bold font-mono tabular-nums mt-0.5 text-${s.color}-600`}>{s.value}</div>
              </div>
            ))}
          </div>
        )}
        {chartData.length > 0 && (() => {
          const yDomain: [string | number, string | number] = yZoom > 0 && chartStats.count > 0
            ? [chartStats.mean - chartStats.range / (yZoom + 1), chartStats.mean + chartStats.range / (yZoom + 1)]
            : ['auto', 'auto'];
          return (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} domain={yDomain} />
                <Tooltip contentStyle={{ fontSize: 12, border: '1px solid #94a3b8', background: '#fff', padding: '8px 12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }} labelStyle={{ fontWeight: 700, marginBottom: 4, color: '#1e293b' }} itemStyle={{ padding: '1px 0' }} />
                <Legend verticalAlign="top" height={30} iconType="plainline" wrapperStyle={{ fontSize: 10, color: '#64748b' }} />
                <Line type="monotone" dataKey="ethanol" name="Ethanol %" stroke="#dc2626" strokeWidth={2} dot={{ r: 3, fill: '#dc2626' }} connectNulls />
                <Line type="monotone" dataKey="rcReflex" name="RC Reflex" stroke="#1e40af" strokeWidth={2} dot={{ r: 3, fill: '#1e40af' }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          );
        })()}
      </div>

      {/* History */}
      <div className="bg-white border p-4 mb-4">
        <button onClick={() => setShowHistory(!showHistory)} className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-800 mb-2">
          {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {entries.length} entries
        </button>
        {showHistory && (
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-xs"><thead className="bg-gray-50 sticky top-0"><tr>
              {['Date', 'Time', 'RC Str', 'ACT Str', 'Ethanol%', 'SW Loss', 'RC Loss', 'Spent Loss', ''].map(h =>
                <th key={h} className="px-2 py-1 text-left font-medium text-gray-600">{h}</th>)}
            </tr></thead><tbody>
              {entries.slice(0, 50).map(e => (
                <tr key={e.id} className="border-t hover:bg-gray-50">
                  <td className="px-2 py-1">{e.date?.split('T')[0]}</td>
                  <td className="px-2 py-1">{e.analysisTime}</td>
                  <td className="px-2 py-1">{e.rcStrength ?? '—'}</td>
                  <td className="px-2 py-1">{e.actStrength ?? '—'}</td>
                  <td className="px-2 py-1">{e.ethanolStrength ?? '—'}</td>
                  <td className="px-2 py-1">{e.spentWashLoss ?? '—'}{e.spentWashPhotoUrl ? ' [photo]' : ''}</td>
                  <td className="px-2 py-1">{e.rcLessLoss ?? '—'}{e.rcLessPhotoUrl ? ' [photo]' : ''}</td>
                  <td className="px-2 py-1">
                    {e.spentLossLevel ? (
                      <span className={`px-1.5 py-0.5 text-xs font-medium ${
                        e.spentLossLevel === 'NIL' ? 'bg-green-100 text-green-700'
                        : e.spentLossLevel === 'SLIGHT' ? 'bg-yellow-100 text-yellow-700'
                        : 'bg-red-100 text-red-700'
                      }`}>{e.spentLossLevel}</span>
                    ) : '—'}
                  </td>
                  <td className="px-2 py-1"><button onClick={() => api.delete(`/distillation/${e.id}`).then(load)} className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button></td>
                </tr>
              ))}
            </tbody></table>
          </div>
        )}
      </div>
    </div>
  );
}
