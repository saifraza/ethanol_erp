import React, { useEffect, useState, useCallback } from 'react';
import { Filter, Save, Loader2, ChevronDown, ChevronUp, Trash2, Eye, X, Share2, MessageCircle } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

interface DecForm {
  date: string; entryTime: string;
  [key: string]: string;
}

const DECANTERS = Array.from({ length: 8 }, (_, i) => ({ key: `d${i + 1}`, label: `D${i + 1}` }));

const DRYER_GROUPS = [
  { label: 'Dryer 1', color: 'blue', decanters: ['d1', 'd2', 'd3'] },
  { label: 'Dryer 2', color: 'amber', decanters: ['d4', 'd5'] },
  { label: 'Dryer 3', color: 'purple', decanters: ['d6', 'd7', 'd8'] },
];

const empty = (): DecForm => {
  const f: any = { date: new Date().toISOString().split('T')[0], entryTime: '', remark: '' };
  DECANTERS.forEach(d => { f[d.key + 'Feed'] = ''; f[d.key + 'WetCake'] = ''; f[d.key + 'ThinSlopGr'] = ''; });
  return f;
};

export default function Decanter() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  const [form, setForm] = useState<DecForm>(empty());
  const [entries, setEntries] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [msg, setMsg] = useState<{ type: string; text: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showExtras, setShowExtras] = useState(false);

  // Auto-collection state
  const [showAutoCollect, setShowAutoCollect] = useState(false);
  const [acPhones, setAcPhones] = useState('');
  const [acInterval, setAcInterval] = useState('120');
  const [acEnabled, setAcEnabled] = useState(false);
  const [acStatus, setAcStatus] = useState('');
  const [activeSessions, setActiveSessions] = useState<{ phone?: string; chatId?: string; module: string; step: number; totalSteps: number }[]>([]);
  const [acAutoShare, setAcAutoShare] = useState(true);
  const [acDirty, setAcDirty] = useState(false); // unsaved schedule changes

  const load = () => api.get('/decanter').then(r => setEntries(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  // Load auto-collect schedule for decanter
  const loadAutoCollect = useCallback(() => {
    api.get('/auto-collect/schedules').then(r => {
      const scheds = (r.data || []).filter((s: { module: string }) => s.module === 'decanter');
      if (scheds.length > 0) {
        const s = scheds[0];
        setAcInterval(String(s.intervalMinutes || 120));
        setAcEnabled(s.enabled || false);
        setAcAutoShare(s.autoShare !== false); // default true
        setAcPhones(s.phone || '');
        setAcDirty(false);
      }
    }).catch(() => {});
    api.get('/auto-collect/sessions').then(r => setActiveSessions((r.data || []).filter((s: { module: string }) => s.module === 'decanter'))).catch(() => {});
  }, []);
  useEffect(() => { loadAutoCollect(); }, [loadAutoCollect]);

  // Poll active sessions every 5s when auto-collect panel is open
  useEffect(() => {
    if (!showAutoCollect) return;
    const iv = setInterval(() => {
      api.get('/auto-collect/sessions').then(r => setActiveSessions((r.data || []).filter((s: { module: string }) => s.module === 'decanter'))).catch(() => {});
    }, 5000);
    return () => clearInterval(iv);
  }, [showAutoCollect]);

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

  const handleSave = async (share = false) => {
    setSaving(true); setMsg(null);
    try {
      await api.post('/decanter', form);
      if (share) {
        setSharing(true);
        try {
          const text = buildPreviewText();
          await api.post('/telegram/send-report', { message: text, module: 'decanter' });
          setMsg({ type: 'ok', text: 'Saved & shared on Telegram' });
        } catch (err: any) {
          setMsg({ type: 'err', text: err.response?.data?.error || 'Saved, but failed to share' });
        }
        setSharing(false);
      } else {
        setMsg({ type: 'ok', text: `Saved at ${new Date().toLocaleTimeString()}` });
      }
      setForm(empty()); setShowPreview(false); setShowExtras(false); load();
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
    ];
    DRYER_GROUPS.forEach(g => {
      const gFeed = g.decanters.reduce((s, k) => s + (parseFloat(form[k + 'Feed']) || 0), 0);
      lines.push(`*${g.label} Feed:* ${gFeed.toFixed(2)}`);
      g.decanters.forEach(k => {
        const d = DECANTERS.find(x => x.key === k)!;
        lines.push(`  ${d.label}: ${form[d.key + 'Feed'] || '—'}`);
      });
    });
    lines.push(`*Total Feed: ${totalFeed.toFixed(2)}*`);
    // Only include wet cake / thin slop if any values entered
    const hasWC = DECANTERS.some(d => form[d.key + 'WetCake']);
    const hasTS = DECANTERS.some(d => form[d.key + 'ThinSlopGr']);
    if (hasWC) {
      lines.push('', `*Wet Cake Solid:*`);
      DECANTERS.forEach(d => { if (form[d.key + 'WetCake']) lines.push(`  ${d.label}: ${form[d.key + 'WetCake']}`); });
      lines.push(`  Total: ${totalWetCake.toFixed(2)}`);
    }
    if (hasTS) {
      lines.push('', `*Thin Slop Gravity:*`);
      DECANTERS.forEach(d => { if (form[d.key + 'ThinSlopGr']) lines.push(`  ${d.label}: ${form[d.key + 'ThinSlopGr']}`); });
      lines.push(`  Avg: ${avgThinSlopGr.toFixed(3)}`);
    }
    if (form.remark) lines.push('', `Remark: ${form.remark}`);
    return lines.filter(Boolean).join('\n');
  };


  // History helpers
  const entryTotalFeed = (e: any) => DECANTERS.reduce((s, d) => s + (e[d.key + 'Feed'] || 0), 0);
  const entryTotalWC = (e: any) => DECANTERS.reduce((s, d) => s + (e[d.key + 'WetCake'] || 0), 0);
  const entryAvgTS = (e: any) => {
    const vals = DECANTERS.map(d => e[d.key + 'ThinSlopGr']).filter(v => v && v > 0);
    return vals.length > 0 ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length : 0;
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="p-4 md:p-5 mb-4 md:mb-6 text-white bg-gradient-to-r from-cyan-600 to-cyan-700">
        <div className="flex items-center gap-3 mb-1">
          <Filter size={24} />
          <h1 className="text-xl md:text-2xl font-bold">Decanter</h1>
        </div>
        <p className="text-xs md:text-sm opacity-90">D1–D8 Feed with optional Wet Cake & Thin Slop</p>
      </div>

      {/* Date/Time */}
      <div className="bg-white border p-4 mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><label className="text-xs text-gray-500">Date</label><input type="date" value={form.date} onChange={e => upd('date', e.target.value)} className="w-full border px-2 py-1.5 text-sm" /></div>
          <div><label className="text-xs text-gray-500">Time</label>
            <div className="flex gap-1">
              <input type="text" value={form.entryTime} onChange={e => upd('entryTime', e.target.value)} placeholder="HH:MM" className="flex-1 border px-2 py-1.5 text-sm" />
              <button onClick={setNow} className="px-2 py-1 bg-cyan-100 text-cyan-700 text-xs font-medium hover:bg-cyan-200">Now</button>
            </div>
          </div>
        </div>
      </div>

      {/* Feed — grouped by dryer */}
      <div className="bg-white border p-4 mb-4">
        <h3 className="text-sm font-semibold text-cyan-700 mb-3 uppercase tracking-wide">Total Feed (D1-D8)</h3>
        <div className="space-y-4">
          {DRYER_GROUPS.map(g => {
            const groupFeed = g.decanters.reduce((s, k) => s + (parseFloat(form[k + 'Feed']) || 0), 0);
            return (
              <div key={g.label}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-xs font-semibold px-2 py-0.5 bg-${g.color}-100 text-${g.color}-700`}>{g.label}</span>
                  <span className="text-xs text-gray-400">({g.decanters.map(k => k.toUpperCase()).join(', ')})</span>
                  <span className="text-xs font-bold ml-auto">{groupFeed.toFixed(2)}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {g.decanters.map(k => {
                    const d = DECANTERS.find(x => x.key === k)!;
                    return (
                      <div key={d.key}>
                        <label className="text-xs text-gray-500">{d.label}</label>
                        <input type="number" step="0.01" value={form[d.key + 'Feed']} onChange={e => upd(d.key + 'Feed', e.target.value)} placeholder="0" className="w-full border px-2 py-1.5 text-sm" />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 pt-2 border-t flex items-center gap-2">
          <span className="text-xs text-gray-500">Total Feed:</span>
          <span className="text-sm font-bold text-cyan-700">{totalFeed.toFixed(2)}</span>
        </div>
      </div>

      {/* Wet Cake + Thin Slop — collapsible */}
      <div className="bg-white border mb-4">
        <button
          onClick={() => setShowExtras(!showExtras)}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition"
        >
          <div>
            <span className="text-sm font-semibold text-gray-700">Wet Cake Solid & Thin Slop Gravity</span>
            <span className="text-xs text-gray-400 ml-2">(optional)</span>
          </div>
          {showExtras ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
        </button>

        {showExtras && (
          <div className="px-4 pb-4 space-y-4">
            {/* Wet Cake */}
            <div>
              <h4 className="text-xs font-semibold text-cyan-600 mb-2 uppercase tracking-wide">Wet Cake Solid</h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {DECANTERS.map(d => (
                  <div key={d.key + 'wc'}>
                    <label className="text-xs text-gray-500">{d.label}</label>
                    <input type="number" step="0.01" value={form[d.key + 'WetCake']} onChange={e => upd(d.key + 'WetCake', e.target.value)} placeholder="0" className="w-full border px-2 py-1.5 text-sm" />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-gray-500">Total:</span>
                <span className="text-sm font-bold text-cyan-700">{totalWetCake.toFixed(2)}</span>
              </div>
            </div>

            {/* Thin Slop Gravity */}
            <div>
              <h4 className="text-xs font-semibold text-cyan-600 mb-2 uppercase tracking-wide">Thin Slop Gravity</h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {DECANTERS.map(d => (
                  <div key={d.key + 'ts'}>
                    <label className="text-xs text-gray-500">{d.label}</label>
                    <input type="number" step="0.001" value={form[d.key + 'ThinSlopGr']} onChange={e => upd(d.key + 'ThinSlopGr', e.target.value)} placeholder="0.000" className="w-full border px-2 py-1.5 text-sm" />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-gray-500">Avg:</span>
                <span className="text-sm font-bold text-cyan-700">{avgThinSlopGr.toFixed(3)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Remark */}
      <div className="bg-white border p-4 mb-4">
        <label className="text-xs text-gray-500">Remark</label>
        <input type="text" value={form.remark || ''} onChange={e => upd('remark', e.target.value)} className="w-full border px-2 py-1.5 text-sm" />
      </div>

      {/* Action buttons */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-4">
        <button onClick={() => setShowPreview(true)} className="flex items-center justify-center gap-2 bg-gray-700 text-white px-5 py-2.5 text-sm font-medium hover:bg-gray-800 transition">
          <Eye size={16} /> Preview & Save
        </button>
        {msg && <span className={`text-sm font-medium ${msg.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</span>}
      </div>

      {/* Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowPreview(false)}>
          <div className="bg-white shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-cyan-600 text-white p-4 flex items-center justify-between">
              <h3 className="font-bold text-lg">Decanter Report Preview</h3>
              <button onClick={() => setShowPreview(false)} className="p-1 hover:bg-cyan-700"><X size={20} /></button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div className="flex justify-between text-gray-600 border-b pb-2">
                <span>Date: <strong>{form.date}</strong></span>
                <span>Time: <strong>{form.entryTime || '—'}</strong></span>
              </div>

              {/* Feed summary grouped by dryer */}
              <div>
                <h4 className="font-semibold text-cyan-700 mb-2">Feed (D1-D8)</h4>
                {DRYER_GROUPS.map(g => {
                  const gFeed = g.decanters.reduce((s, k) => s + (parseFloat(form[k + 'Feed']) || 0), 0);
                  return (
                    <div key={g.label} className="mb-2">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className={`text-xs font-semibold text-${g.color}-700`}>{g.label}</span>
                        <span className="text-xs font-bold">{gFeed.toFixed(2)}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-x-4 gap-y-0.5 text-xs pl-2">
                        {g.decanters.map(k => {
                          const d = DECANTERS.find(x => x.key === k)!;
                          return (
                            <div key={d.key} className="flex justify-between">
                              <span className="text-gray-500">{d.label}:</span>
                              <span className="font-medium">{form[d.key + 'Feed'] || '—'}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                <div className="mt-1 pt-1 border-t text-xs font-bold text-cyan-700">Total: {totalFeed.toFixed(2)}</div>
              </div>

              {/* Wet Cake if any */}
              {DECANTERS.some(d => form[d.key + 'WetCake']) && (
                <div>
                  <h4 className="font-semibold text-cyan-700 mb-1">Wet Cake Solid</h4>
                  <div className="grid grid-cols-4 gap-x-4 gap-y-0.5 text-xs">
                    {DECANTERS.filter(d => form[d.key + 'WetCake']).map(d => (
                      <div key={d.key} className="flex justify-between">
                        <span className="text-gray-500">{d.label}:</span>
                        <span className="font-medium">{form[d.key + 'WetCake']}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-1 text-xs font-bold text-cyan-700">Total: {totalWetCake.toFixed(2)}</div>
                </div>
              )}

              {/* Thin Slop if any */}
              {DECANTERS.some(d => form[d.key + 'ThinSlopGr']) && (
                <div>
                  <h4 className="font-semibold text-cyan-700 mb-1">Thin Slop Gravity</h4>
                  <div className="grid grid-cols-4 gap-x-4 gap-y-0.5 text-xs">
                    {DECANTERS.filter(d => form[d.key + 'ThinSlopGr']).map(d => (
                      <div key={d.key} className="flex justify-between">
                        <span className="text-gray-500">{d.label}:</span>
                        <span className="font-medium">{form[d.key + 'ThinSlopGr']}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-1 text-xs font-bold text-cyan-700">Avg: {avgThinSlopGr.toFixed(3)}</div>
                </div>
              )}

              {form.remark && <div className="text-gray-600 italic">Remark: {form.remark}</div>}
            </div>

            <div className="sticky bottom-0 bg-gray-50 p-4 flex gap-3 border-t">
              <button onClick={() => handleSave(false)} disabled={saving} className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 text-white px-4 py-2.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save
              </button>
              <button onClick={() => handleSave(true)} disabled={saving} className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-2.5 text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />} Save & Share
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History */}
      <div className="bg-white border p-4 mb-4">
        <button onClick={() => setShowHistory(!showHistory)} className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-800 mb-2">
          {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {entries.length} entries
        </button>
        {showHistory && (
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-xs"><thead className="bg-gray-50 sticky top-0"><tr>
              {['Date', 'Time', 'Total Feed', 'Total WC', 'Avg TS Gr', ...(isAdmin ? [''] : [])].map(h =>
                <th key={h} className="px-2 py-1.5 text-left font-medium text-gray-600">{h}</th>)}
            </tr></thead><tbody>
              {entries.slice(0, 50).map(e => (
                <tr key={e.id} className="border-t hover:bg-gray-50">
                  <td className="px-2 py-1">{e.date?.split('T')[0]}</td>
                  <td className="px-2 py-1">{e.entryTime}</td>
                  <td className="px-2 py-1 font-medium text-cyan-700">{entryTotalFeed(e).toFixed(1)}</td>
                  <td className="px-2 py-1">{entryTotalWC(e) > 0 ? entryTotalWC(e).toFixed(1) : '—'}</td>
                  <td className="px-2 py-1">{entryAvgTS(e) > 0 ? entryAvgTS(e).toFixed(3) : '—'}</td>
                  {isAdmin && <td className="px-2 py-1"><button onClick={() => api.delete(`/decanter/${e.id}`).then(load)} className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button></td>}
                </tr>
              ))}
            </tbody></table>
          </div>
        )}
      </div>

      {/* Telegram Auto-Collection */}
      {isAdmin && (
        <div className="bg-white border mb-4">
          <button
            onClick={() => setShowAutoCollect(!showAutoCollect)}
            className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition"
          >
            <div className="flex items-center gap-2">
              <MessageCircle size={18} className="text-blue-500" />
              <span className="text-sm font-semibold text-gray-700">Telegram Auto-Collection</span>
              {acEnabled && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 font-medium">ON</span>}
            </div>
            {showAutoCollect ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
          </button>

          {showAutoCollect && (
            <div className="px-4 pb-4 space-y-3">
              <p className="text-xs text-gray-500">
                Bot sends scheduled Telegram messages asking operators for decanter readings. Operator replies with numbers - data auto-saved.
              </p>

              {/* Telegram Chat IDs */}
              <div>
                <label className="text-[10px] text-gray-500 uppercase mb-1 block">Operator Telegram Chat IDs</label>
                <input type="text" value={acPhones} onChange={e => { setAcPhones(e.target.value); setAcDirty(true); }}
                  placeholder="e.g. 123456789, 987654321" className="border px-2 py-1.5 w-full text-sm" />
                {acPhones ? (
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <span className="text-[9px] text-gray-400">Saved:</span>
                    {acPhones.split(',').map(p => p.trim()).filter(Boolean).map((p, i) => (
                      <span key={i} className="text-[10px] bg-blue-100 text-blue-800 px-2 py-0.5 font-medium">{p}</span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[9px] text-orange-500 mt-1">No chat IDs saved. Add operator Telegram chat IDs above.</p>
                )}
                <p className="text-[9px] text-gray-400 mt-1">Comma-separated. Bot sends to all chat IDs at each interval.</p>
              </div>

              {/* Interval + Enable */}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-gray-500">Interval</label>
                  <input type="number" value={acInterval} onChange={e => { setAcInterval(e.target.value); setAcDirty(true); }}
                    className="border px-2 py-1 w-20 text-sm" />
                  <span className="text-[10px] text-gray-400">min</span>
                </div>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={acEnabled} onChange={e => { setAcEnabled(e.target.checked); setAcDirty(true); }} className="w-4 h-4" />
                  <span className={acEnabled ? 'text-green-700 font-semibold text-xs' : 'text-gray-500 text-xs'}>
                    {acEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={acAutoShare} onChange={e => { setAcAutoShare(e.target.checked); setAcDirty(true); }} className="w-4 h-4" />
                  <span className={acAutoShare ? 'text-blue-700 font-semibold text-xs' : 'text-gray-500 text-xs'}>
                    {acAutoShare ? 'Auto-Share' : 'No Share'}
                  </span>
                </label>
              </div>

              {/* Save + Test buttons */}
              <div className="flex gap-2 flex-wrap">
                <button onClick={async () => {
                  const phone = acPhones.trim();
                  if (!phone) { setAcStatus('Add at least one Telegram chat ID'); return; }
                  try {
                    await api.put('/auto-collect/schedules/decanter', {
                      phone, intervalMinutes: parseInt(acInterval) || 120, enabled: acEnabled, autoShare: acAutoShare,
                    });
                    setAcDirty(false);
                    setAcStatus(`Schedule saved (${acEnabled ? 'enabled' : 'disabled'}, ${acInterval}min${acAutoShare ? ', auto-share' : ''})`);
                  } catch { setAcStatus('Failed to save'); }
                  setTimeout(() => setAcStatus(''), 3000);
                }} className={`px-3 py-1.5 text-white text-xs font-medium ${acDirty ? 'bg-orange-500 hover:bg-orange-600 animate-pulse' : 'bg-cyan-600 hover:bg-cyan-700'}`}>
                  {acDirty ? 'Save Schedule' : 'Save Schedule'}
                </button>
                <button onClick={async () => {
                  const phoneList = acPhones.split(',').map(p => p.trim()).filter(Boolean);
                  if (!phoneList.length) { setAcStatus('No Telegram chat IDs configured'); return; }
                  try {
                    const r = await api.post('/auto-collect/trigger', { phone: phoneList[0], module: 'decanter', autoShare: acAutoShare });
                    setAcStatus(r.data.success ? `Sent to ${phoneList[0]}` : r.data.error);
                  } catch { setAcStatus('Failed to trigger'); }
                  setTimeout(() => setAcStatus(''), 5000);
                }} disabled={!acPhones.trim()} className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium hover:bg-green-700 disabled:opacity-50">
                  Test Now
                </button>
              </div>
              {acStatus && <p className="text-xs text-cyan-700 font-medium">{acStatus}</p>}

              {activeSessions.length > 0 && (
                <div className="border-t pt-2">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] text-gray-500 uppercase">Active Sessions</p>
                    <button onClick={async () => {
                      try {
                        await api.delete('/auto-collect/sessions');
                        setActiveSessions([]);
                        setAcStatus('Sessions cleared');
                      } catch { setAcStatus('Failed to clear'); }
                    }} className="px-2 py-0.5 text-[10px] text-red-500 hover:bg-red-50 font-semibold">
                      Reset All
                    </button>
                  </div>
                  {activeSessions.map((s, i) => (
                    <div key={i} className="text-xs text-cyan-700">
                      {s.chatId || s.phone} — step {s.step}/{s.totalSteps}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
