import React, { useEffect, useState } from 'react';
import { Filter, Save, Loader2, ChevronDown, ChevronUp, Trash2, Eye, X, Share2 } from 'lucide-react';
import api from '../../services/api';

interface DecForm {
  date: string; entryTime: string;
  [key: string]: string;
}

const DECANTERS = Array.from({ length: 8 }, (_, i) => ({ key: `d${i + 1}`, label: `D${i + 1}` }));

const empty = (): DecForm => {
  const f: any = { date: new Date().toISOString().split('T')[0], entryTime: '', remark: '' };
  DECANTERS.forEach(d => { f[d.key + 'Feed'] = ''; f[d.key + 'WetCake'] = ''; f[d.key + 'ThinSlopGr'] = ''; });
  return f;
};

export default function Decanter() {
  const [form, setForm] = useState<DecForm>(empty());
  const [entries, setEntries] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: string; text: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const load = () => api.get('/decanter').then(r => setEntries(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const setNow = () => {
    const d = new Date();
    setForm(f => ({ ...f, entryTime: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) }));
  };

  const upd = (key: string, val: string) => setForm(f => ({ ...f, [key]: val }));

  // Totals
  const totalFeed = DECANTERS.reduce((s, d) => s + (parseFloat(form[d.key + 'Feed']) || 0), 0);
  const totalWetCake = DECANTERS.reduce((s, d) => s + (parseFloat(form[d.key + 'WetCake']) || 0), 0);
  const avgThinSlopGr = (() => {
    const vals = DECANTERS.map(d => parseFloat(form[d.key + 'ThinSlopGr'])).filter(v => !isNaN(v) && v > 0);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  })();

  const handleSave = async () => {
    setSaving(true); setMsg(null);
    try {
      await api.post('/decanter', form);
      setMsg({ type: 'ok', text: `Saved at ${new Date().toLocaleTimeString()}` });
      setForm(empty()); setShowPreview(false); load();
    } catch (err: any) {
      setMsg({ type: 'err', text: err.response?.data?.error || 'Save failed' });
    }
    setSaving(false);
  };

  const buildPreviewText = () => {
    const lines = [
      `*DECANTER REPORT*`,
      `Date: ${form.date} | Time: ${form.entryTime || '—'}`,
      ``,
      `*Decanter Readings:*`,
      ...DECANTERS.map(d => {
        const feed = form[d.key + 'Feed'] || '—';
        const wc = form[d.key + 'WetCake'] || '—';
        const ts = form[d.key + 'ThinSlopGr'] || '—';
        return `  ${d.label}: Feed ${feed} | WC ${wc} | TS Gr ${ts}`;
      }),
      ``,
      `*Totals:*`,
      `  Total Feed: ${totalFeed.toFixed(2)}`,
      `  Total Wet Cake: ${totalWetCake.toFixed(2)}`,
      `  Avg Thin Slop Gravity: ${avgThinSlopGr.toFixed(3)}`,
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
      <div className="rounded-lg p-4 md:p-5 mb-4 md:mb-6 text-white bg-gradient-to-r from-cyan-600 to-cyan-700">
        <div className="flex items-center gap-3 mb-1">
          <Filter size={24} />
          <h1 className="text-xl md:text-2xl font-bold">Decanter</h1>
        </div>
        <p className="text-xs md:text-sm opacity-90">8 Decanters — Feed, Wet Cake Solid, Thin Slop Gravity</p>
      </div>

      {/* Date/Time */}
      <div className="bg-white rounded-lg shadow-sm border p-4 mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><label className="text-xs text-gray-500">Date</label><input type="date" value={form.date} onChange={e => upd('date', e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></div>
          <div><label className="text-xs text-gray-500">Time</label>
            <div className="flex gap-1">
              <input type="text" value={form.entryTime} onChange={e => upd('entryTime', e.target.value)} placeholder="HH:MM" className="flex-1 border rounded px-2 py-1.5 text-sm" />
              <button onClick={setNow} className="px-2 py-1 bg-cyan-100 text-cyan-700 rounded text-xs font-medium hover:bg-cyan-200">Now</button>
            </div>
          </div>
        </div>
      </div>

      {/* Decanter Table */}
      <div className="bg-white rounded-lg shadow-sm border p-4 mb-4">
        <h3 className="text-sm font-semibold text-cyan-700 mb-3 uppercase tracking-wide">Decanter Readings (D1–D8)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-cyan-50">
              <th className="px-2 py-1.5 text-left text-xs font-medium text-cyan-700">Unit</th>
              <th className="px-2 py-1.5 text-left text-xs font-medium text-cyan-700">Total Feed</th>
              <th className="px-2 py-1.5 text-left text-xs font-medium text-cyan-700">Wet Cake Solid</th>
              <th className="px-2 py-1.5 text-left text-xs font-medium text-cyan-700">Thin Slop Gravity</th>
            </tr></thead>
            <tbody>
              {DECANTERS.map(d => (
                <tr key={d.key} className="border-t">
                  <td className="px-2 py-1.5 font-medium text-gray-700">{d.label}</td>
                  <td className="px-2 py-1"><input type="number" step="0.01" value={form[d.key + 'Feed']} onChange={e => upd(d.key + 'Feed', e.target.value)} className="w-full border rounded px-2 py-1 text-sm" /></td>
                  <td className="px-2 py-1"><input type="number" step="0.01" value={form[d.key + 'WetCake']} onChange={e => upd(d.key + 'WetCake', e.target.value)} className="w-full border rounded px-2 py-1 text-sm" /></td>
                  <td className="px-2 py-1"><input type="number" step="0.001" value={form[d.key + 'ThinSlopGr']} onChange={e => upd(d.key + 'ThinSlopGr', e.target.value)} className="w-full border rounded px-2 py-1 text-sm" /></td>
                </tr>
              ))}
              {/* Totals row */}
              <tr className="border-t-2 border-cyan-300 bg-cyan-50 font-semibold">
                <td className="px-2 py-1.5 text-cyan-800">Total</td>
                <td className="px-2 py-1.5 text-cyan-800">{totalFeed.toFixed(2)}</td>
                <td className="px-2 py-1.5 text-cyan-800">{totalWetCake.toFixed(2)}</td>
                <td className="px-2 py-1.5 text-cyan-800">{avgThinSlopGr.toFixed(3)} (avg)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Remark */}
      <div className="bg-white rounded-lg shadow-sm border p-4 mb-4">
        <label className="text-xs text-gray-500">Remark</label>
        <input type="text" value={form.remark || ''} onChange={e => upd('remark', e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" />
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
            <div className="sticky top-0 bg-cyan-600 text-white p-4 rounded-t-xl flex items-center justify-between">
              <h3 className="font-bold text-lg">Decanter Report Preview</h3>
              <button onClick={() => setShowPreview(false)} className="p-1 hover:bg-cyan-700 rounded"><X size={20} /></button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div className="flex justify-between text-gray-600 border-b pb-2">
                <span>Date: <strong>{form.date}</strong></span>
                <span>Time: <strong>{form.entryTime || '—'}</strong></span>
              </div>

              <div>
                <h4 className="font-semibold text-cyan-700 mb-1">Decanter Readings</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="bg-cyan-50">
                      <th className="px-1.5 py-1 text-left">Unit</th>
                      <th className="px-1.5 py-1 text-right">Feed</th>
                      <th className="px-1.5 py-1 text-right">Wet Cake</th>
                      <th className="px-1.5 py-1 text-right">TS Gravity</th>
                    </tr></thead>
                    <tbody>
                      {DECANTERS.map(d => (
                        <tr key={d.key} className="border-t">
                          <td className="px-1.5 py-1 font-medium">{d.label}</td>
                          <td className="px-1.5 py-1 text-right">{form[d.key + 'Feed'] || '—'}</td>
                          <td className="px-1.5 py-1 text-right">{form[d.key + 'WetCake'] || '—'}</td>
                          <td className="px-1.5 py-1 text-right">{form[d.key + 'ThinSlopGr'] || '—'}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-cyan-300 bg-cyan-50 font-bold">
                        <td className="px-1.5 py-1">Total</td>
                        <td className="px-1.5 py-1 text-right">{totalFeed.toFixed(2)}</td>
                        <td className="px-1.5 py-1 text-right">{totalWetCake.toFixed(2)}</td>
                        <td className="px-1.5 py-1 text-right">{avgThinSlopGr.toFixed(3)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {form.remark && <div className="text-gray-600 italic">Remark: {form.remark}</div>}
            </div>

            <div className="sticky bottom-0 bg-gray-50 p-4 rounded-b-xl flex gap-3 border-t">
              <button onClick={handleSave} disabled={saving} className="flex-1 flex items-center justify-center gap-2 bg-cyan-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-cyan-700 disabled:opacity-50 transition">
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
              {['Date', 'Time', 'D1 Feed', 'D2 Feed', 'D3 Feed', 'D4 Feed', ''].map(h =>
                <th key={h} className="px-2 py-1 text-left font-medium text-gray-600">{h}</th>)}
            </tr></thead><tbody>
              {entries.slice(0, 50).map(e => (
                <tr key={e.id} className="border-t hover:bg-gray-50">
                  <td className="px-2 py-1">{e.date?.split('T')[0]}</td>
                  <td className="px-2 py-1">{e.entryTime}</td>
                  <td className="px-2 py-1">{e.d1Feed ?? '—'}</td>
                  <td className="px-2 py-1">{e.d2Feed ?? '—'}</td>
                  <td className="px-2 py-1">{e.d3Feed ?? '—'}</td>
                  <td className="px-2 py-1">{e.d4Feed ?? '—'}</td>
                  <td className="px-2 py-1"><button onClick={() => api.delete(`/decanter/${e.id}`).then(load)} className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button></td>
                </tr>
              ))}
            </tbody></table>
          </div>
        )}
      </div>
    </div>
  );
}
