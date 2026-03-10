import React, { useEffect, useState } from 'react';
import { Wind, Save, Loader2, ChevronDown, ChevronUp, Trash2, Eye, X, Share2, Clock } from 'lucide-react';
import api from '../../services/api';

interface DDGSForm {
  date: string; entryTime: string;
  bags: string; weightPerBag: string;
  dryerInletTemp: string; dryerOutletTemp: string;
  ddgsMoisture: string; ddgsProtein: string;
  remark: string;
}

const empty = (): DDGSForm => ({
  date: new Date().toISOString().split('T')[0], entryTime: '',
  bags: '', weightPerBag: '',
  dryerInletTemp: '', dryerOutletTemp: '',
  ddgsMoisture: '', ddgsProtein: '',
  remark: ''
});

export default function Dryer() {
  const [form, setForm] = useState<DDGSForm>(empty());
  const [entries, setEntries] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: string; text: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const load = () => api.get('/ddgs').then(r => setEntries(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const setNow = () => {
    const d = new Date();
    setForm(f => ({ ...f, entryTime: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) }));
  };

  const upd = (key: keyof DDGSForm, val: string) => setForm(f => ({ ...f, [key]: val }));

  const totalProduction = ((parseFloat(form.bags) || 0) * (parseFloat(form.weightPerBag) || 0) / 1000);

  const handleSave = async () => {
    setSaving(true); setMsg(null);
    try {
      await api.post('/ddgs', { ...form, totalProduction });
      setMsg({ type: 'ok', text: `Saved at ${new Date().toLocaleTimeString()}` });
      setForm(empty()); setShowPreview(false); load();
    } catch (err: any) {
      setMsg({ type: 'err', text: err.response?.data?.error || 'Save failed' });
    }
    setSaving(false);
  };

  const lastEntry = entries.length > 0 ? entries[0] : null;

  const buildPreviewText = () => {
    const lines = [
      `*DDGS PRODUCTION REPORT*`,
      `Date: ${form.date} | Time: ${form.entryTime || '—'}`,
      ``,
      `*Production:*`,
      `  Bags: ${form.bags || '—'}`,
      `  Weight/Bag: ${form.weightPerBag || '—'} kg`,
      `  Total: ${totalProduction.toFixed(2)} Ton`,
      ``,
      `*Dryer Parameters:*`,
      `  Inlet Temp: ${form.dryerInletTemp || '—'}°C`,
      `  Outlet Temp: ${form.dryerOutletTemp || '—'}°C`,
      `  Moisture: ${form.ddgsMoisture || '—'}%`,
      `  Protein: ${form.ddgsProtein || '—'}%`,
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
      <div className="rounded-lg p-4 md:p-5 mb-4 md:mb-6 text-white bg-gradient-to-r from-orange-600 to-orange-700">
        <div className="flex items-center gap-3 mb-1">
          <Wind size={24} />
          <h1 className="text-xl md:text-2xl font-bold">DDGS Production</h1>
        </div>
        <p className="text-xs md:text-sm opacity-90">Bags, weight, dryer parameters & quality</p>
      </div>

      {/* Last Log Card */}
      {lastEntry && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock size={16} className="text-orange-600" />
            <h3 className="text-sm font-semibold text-orange-700">Last Log</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-xs text-gray-500">Date</div>
              <div className="font-medium">{lastEntry.date?.split('T')[0]}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Time</div>
              <div className="font-medium">{lastEntry.entryTime || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Bags</div>
              <div className="font-semibold text-orange-700">{lastEntry.bags ?? '—'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Weight/Bag</div>
              <div className="font-semibold text-orange-700">{lastEntry.weightPerBag ?? '—'} kg</div>
            </div>
          </div>
          {lastEntry.totalProduction != null && (
            <div className="mt-2 text-sm text-orange-800 font-medium">
              Total Production: {lastEntry.totalProduction?.toFixed(2)} Ton
            </div>
          )}
        </div>
      )}

      {/* DDGS Production */}
      <div className="bg-white rounded-lg shadow-sm border p-4 mb-4">
        <h3 className="text-sm font-semibold text-orange-700 mb-3 uppercase tracking-wide">Production</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <div><label className="text-xs text-gray-500">Date</label><input type="date" value={form.date} onChange={e => upd('date', e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></div>
          <div><label className="text-xs text-gray-500">Time</label>
            <div className="flex gap-1">
              <input type="text" value={form.entryTime} onChange={e => upd('entryTime', e.target.value)} placeholder="HH:MM" className="flex-1 border rounded px-2 py-1.5 text-sm" />
              <button onClick={setNow} className="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs font-medium hover:bg-orange-200">Now</button>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div><label className="text-xs text-gray-500">Bags Produced</label><input type="number" value={form.bags} onChange={e => upd('bags', e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></div>
          <div><label className="text-xs text-gray-500">Weight per Bag (kg)</label><input type="number" step="0.1" value={form.weightPerBag} onChange={e => upd('weightPerBag', e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></div>
          <div><label className="text-xs text-gray-500">Total Production (Ton)</label><div className="w-full border rounded px-2 py-1.5 text-sm bg-gray-50 font-semibold text-orange-700">{totalProduction.toFixed(2)}</div></div>
        </div>
      </div>

      {/* Dryer Parameters */}
      <div className="bg-white rounded-lg shadow-sm border p-4 mb-4">
        <h3 className="text-sm font-semibold text-red-700 mb-3 uppercase tracking-wide">Dryer Parameters</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><label className="text-xs text-gray-500">Inlet Temp (°C)</label><input type="number" step="0.1" value={form.dryerInletTemp} onChange={e => upd('dryerInletTemp', e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></div>
          <div><label className="text-xs text-gray-500">Outlet Temp (°C)</label><input type="number" step="0.1" value={form.dryerOutletTemp} onChange={e => upd('dryerOutletTemp', e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></div>
          <div><label className="text-xs text-gray-500">DDGS Moisture (%)</label><input type="number" step="0.01" value={form.ddgsMoisture} onChange={e => upd('ddgsMoisture', e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></div>
          <div><label className="text-xs text-gray-500">DDGS Protein (%)</label><input type="number" step="0.01" value={form.ddgsProtein} onChange={e => upd('ddgsProtein', e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></div>
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
            <div className="sticky top-0 bg-orange-600 text-white p-4 rounded-t-xl flex items-center justify-between">
              <h3 className="font-bold text-lg">DDGS Report Preview</h3>
              <button onClick={() => setShowPreview(false)} className="p-1 hover:bg-orange-700 rounded"><X size={20} /></button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div className="flex justify-between text-gray-600 border-b pb-2">
                <span>Date: <strong>{form.date}</strong></span>
                <span>Time: <strong>{form.entryTime || '—'}</strong></span>
              </div>

              <div>
                <h4 className="font-semibold text-orange-700 mb-1">Production</h4>
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-orange-50 rounded p-2 text-center">
                    <div className="text-xs text-gray-500">Bags</div>
                    <div className="font-semibold">{form.bags || '—'}</div>
                  </div>
                  <div className="bg-orange-50 rounded p-2 text-center">
                    <div className="text-xs text-gray-500">Wt/Bag</div>
                    <div className="font-semibold">{form.weightPerBag || '—'} kg</div>
                  </div>
                  <div className="bg-orange-50 rounded p-2 text-center">
                    <div className="text-xs text-gray-500">Total</div>
                    <div className="font-bold text-orange-700">{totalProduction.toFixed(2)} T</div>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-red-700 mb-1">Dryer Parameters</h4>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Inlet Temp', val: form.dryerInletTemp, unit: '°C' },
                    { label: 'Outlet Temp', val: form.dryerOutletTemp, unit: '°C' },
                    { label: 'Moisture', val: form.ddgsMoisture, unit: '%' },
                    { label: 'Protein', val: form.ddgsProtein, unit: '%' },
                  ].map(p => (
                    <div key={p.label} className="bg-red-50 rounded p-2 text-center">
                      <div className="text-xs text-gray-500">{p.label}</div>
                      <div className="font-semibold">{p.val || '—'}{p.unit}</div>
                    </div>
                  ))}
                </div>
              </div>

              {form.remark && <div className="text-gray-600 italic">Remark: {form.remark}</div>}
            </div>

            <div className="sticky bottom-0 bg-gray-50 p-4 rounded-b-xl flex gap-3 border-t">
              <button onClick={handleSave} disabled={saving} className="flex-1 flex items-center justify-center gap-2 bg-orange-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50 transition">
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
              {['Date', 'Time', 'Bags', 'Wt/Bag', 'Total (T)', 'Moisture', ''].map(h =>
                <th key={h} className="px-2 py-1 text-left font-medium text-gray-600">{h}</th>)}
            </tr></thead><tbody>
              {entries.slice(0, 50).map(e => (
                <tr key={e.id} className="border-t hover:bg-gray-50">
                  <td className="px-2 py-1">{e.date?.split('T')[0]}</td>
                  <td className="px-2 py-1">{e.entryTime}</td>
                  <td className="px-2 py-1">{e.bags ?? '—'}</td>
                  <td className="px-2 py-1">{e.weightPerBag ?? '—'}</td>
                  <td className="px-2 py-1 font-medium">{e.totalProduction?.toFixed(2) ?? '—'}</td>
                  <td className="px-2 py-1">{e.ddgsMoisture ?? '—'}%</td>
                  <td className="px-2 py-1"><button onClick={() => api.delete(`/ddgs/${e.id}`).then(load)} className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button></td>
                </tr>
              ))}
            </tbody></table>
          </div>
        )}
      </div>
    </div>
  );
}
