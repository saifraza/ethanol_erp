import { useState, useEffect, useMemo } from 'react';
import { FlaskConical, Plus, X, Share2, Save, Loader2, Search, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import ProcessPage from './ProcessPage';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

interface Entry {
  id: string; date: string; vehicleCode: string; vehicleNo: string;
  moisture: number; starch: number; fungus: number; immature: number;
  damaged: number; waterDamaged: number; tfm: number; material?: string; remark: string | null;
}

const MATERIALS = ['Corn', 'Rice', 'Broken Rice', 'Sorghum', 'Other'];

function avg(arr: number[]) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function fmt(n: number) { return n ? n.toFixed(1) : '—'; }
function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function isToday(d: string) { return isoDate(new Date(d)) === isoDate(new Date()); }
function isYesterday(d: string) { const y = new Date(); y.setDate(y.getDate() - 1); return isoDate(new Date(d)) === isoDate(y); }

export default function RawMaterial() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [entries, setEntries] = useState<Entry[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [form, setForm] = useState({
    date: isoDate(new Date()), vehicleCode: '', material: 'Corn',
    moisture: '', starch: '', fungus: '', immature: '', damaged: '', waterDamaged: '', tfm: '', remark: ''
  });

  const load = () => api.get('/raw-material').then(r => setEntries(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setForm(f => ({ ...f, vehicleCode: '', moisture: '', starch: '', fungus: '', immature: '', damaged: '', waterDamaged: '', tfm: '', remark: '', material: 'Corn' }));
    setShowForm(false); setShowPreview(false);
  };

  const save = async () => {
    if (!form.vehicleCode.trim()) { setMsg({ type: 'err', text: 'RST number required' }); return; }
    setSaving(true); setMsg(null);
    try {
      await api.post('/raw-material', { ...form, vehicleNo: '' });
      setMsg({ type: 'ok', text: 'Saved!' }); resetForm(); load();
    } catch { setMsg({ type: 'err', text: 'Save failed' }); }
    setSaving(false);
  };

  const del = async (id: string) => { if (!confirm('Delete?')) return; await api.delete(`/raw-material/${id}`); load(); };
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  // === Stats ===
  const stats = useMemo(() => {
    const todayEntries = entries.filter(e => isToday(e.date));
    const yesterdayEntries = entries.filter(e => isYesterday(e.date));
    return {
      todayCount: todayEntries.length,
      totalCount: entries.length,
      starchToday: fmt(avg(todayEntries.map(e => e.starch))),
      starchYesterday: fmt(avg(yesterdayEntries.map(e => e.starch))),
      starchTotal: fmt(avg(entries.map(e => e.starch))),
      moistureToday: fmt(avg(todayEntries.map(e => e.moisture))),
      moistureTotal: fmt(avg(entries.map(e => e.moisture))),
      tfmTotal: fmt(avg(entries.map(e => e.tfm))),
    };
  }, [entries]);

  // Filter & group
  const filtered = search.trim()
    ? entries.filter(e => e.vehicleCode.toLowerCase().includes(search.toLowerCase()))
    : entries;

  const grouped: Record<string, Entry[]> = {};
  filtered.forEach(e => {
    const d = new Date(e.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    if (!grouped[d]) grouped[d] = [];
    grouped[d].push(e);
  });

  const doShare = (text: string) => {
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
  };

  const shareText = (e: Entry) =>
    `*Lab Analysis - ${e.material || 'Corn'}*\nRST: ${e.vehicleCode}\n📅 ${new Date(e.date).toLocaleDateString('en-IN')}\n\nMoisture: ${e.moisture}%\nStarch: ${e.starch}%\nDamaged: ${e.damaged}%\nTFM: ${e.tfm}%\nFungus: ${e.fungus}%\nImmature: ${e.immature}%\nWater Dam: ${e.waterDamaged}%${e.remark ? '\n\nRemark: ' + e.remark : ''}`;

  return (
    <ProcessPage title="Raw Material Analysis" icon={<FlaskConical size={28} />}
      description="Lab quality testing — enter RST number & analysis results"
      flow={{ from: 'Raw Material', to: 'Lab Report' }} color="bg-indigo-600">

      {/* Stat Cards — same style as Grain Stock */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 md:gap-3 mb-4 md:mb-5">
        {[
          { label: 'Today', value: stats.todayCount, unit: 'samples', color: 'bg-blue-50 border-blue-200' },
          { label: 'Total Samples', value: stats.totalCount, unit: '', color: 'bg-indigo-50 border-indigo-200' },
          { label: 'Starch Today', value: stats.starchToday, unit: '%', color: 'bg-green-50 border-green-200' },
          { label: 'Starch Yest.', value: stats.starchYesterday, unit: '%', color: 'bg-emerald-50 border-emerald-200' },
          { label: 'Starch Avg', value: stats.starchTotal, unit: '%', color: 'bg-amber-50 border-amber-200' },
          { label: 'TFM Avg', value: stats.tfmTotal, unit: '%', color: 'bg-orange-50 border-orange-200' },
        ].map(k => (
          <div key={k.label} className={`rounded-lg border p-2 md:p-3 ${k.color}`}>
            <div className="text-[10px] md:text-xs text-gray-500">{k.label}</div>
            <div className="text-lg md:text-xl font-bold">{k.value} <span className="text-[10px] md:text-xs font-normal text-gray-400">{k.unit}</span></div>
          </div>
        ))}
      </div>

      {/* Add Sample Button */}
      {!showForm && (
        <button onClick={() => setShowForm(true)}
          className="w-full border-2 border-dashed border-indigo-300 rounded-lg py-3 text-indigo-600 hover:bg-indigo-50 flex items-center justify-center gap-2 mb-4 font-medium text-sm">
          <Plus size={18} /> New Sample
        </button>
      )}

      {/* === New Sample Form === */}
      {showForm && (
        <div className="card mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="section-title flex items-center gap-2 !mb-0">
              <FlaskConical size={16} className="text-indigo-600" /> New Lab Sample
            </h3>
            <button onClick={resetForm} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="text-xs text-gray-500">Date</label>
              <input type="date" value={form.date} onChange={e => set('date', e.target.value)}
                className="input-field w-full" />
            </div>
            <div>
              <label className="text-xs text-indigo-600 font-medium">RST Number *</label>
              <input value={form.vehicleCode} onChange={e => set('vehicleCode', e.target.value)}
                className="input-field w-full border-indigo-300 bg-indigo-50 font-medium"
                placeholder="RST / UID" autoFocus />
            </div>
            <div>
              <label className="text-xs text-gray-500">Material</label>
              <select value={form.material} onChange={e => set('material', e.target.value)}
                className="input-field w-full bg-amber-50">
                {MATERIALS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          <div className="text-xs text-gray-400 font-medium mb-2">Quality Parameters</div>
          <div className="grid grid-cols-4 gap-2 mb-3">
            {[
              { k: 'moisture', l: 'Moisture %' }, { k: 'starch', l: 'Starch %' },
              { k: 'damaged', l: 'Damaged %' }, { k: 'tfm', l: 'TFM %' },
              { k: 'fungus', l: 'Fungus %' }, { k: 'immature', l: 'Immature %' },
              { k: 'waterDamaged', l: 'Water Dam %' }, { k: 'remark', l: 'Remark' },
            ].map(({ k, l }) => (
              <div key={k}>
                <label className="text-[10px] text-gray-400">{l}</label>
                <input type={k === 'remark' ? 'text' : 'number'} step="0.01"
                  value={(form as any)[k]} onChange={e => set(k, e.target.value)}
                  className="input-field w-full" placeholder={k === 'remark' ? 'Optional' : '0'} />
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <button onClick={() => setShowPreview(true)}
              className="px-5 py-2 bg-indigo-600 text-white rounded-lg font-medium text-sm hover:bg-indigo-700 flex items-center gap-2">
              <Save size={14} /> Preview & Save
            </button>
            {msg && <span className={`text-xs ${msg.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</span>}
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowPreview(false)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <div className="bg-indigo-600 text-white p-3 rounded-t-xl flex items-center justify-between">
              <h3 className="font-bold text-sm">Lab Analysis Report</h3>
              <button onClick={() => setShowPreview(false)}><X size={18} /></button>
            </div>
            <div className="p-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Date</span><span className="font-medium">{form.date}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">RST</span><span className="font-bold text-indigo-600">{form.vehicleCode}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Material</span><span className="font-medium text-amber-700">{form.material}</span></div>
              <div className="border-t pt-2 grid grid-cols-2 gap-1.5 text-xs">
                {form.moisture && <div>Moisture: <b>{form.moisture}%</b></div>}
                {form.starch && <div>Starch: <b>{form.starch}%</b></div>}
                {form.damaged && <div>Damaged: <b>{form.damaged}%</b></div>}
                {form.tfm && <div>TFM: <b className="text-orange-600">{form.tfm}%</b></div>}
                {form.fungus && <div>Fungus: <b>{form.fungus}%</b></div>}
                {form.immature && <div>Immature: <b>{form.immature}%</b></div>}
                {form.waterDamaged && <div>Water Dam: <b>{form.waterDamaged}%</b></div>}
              </div>
              {form.remark && <div className="border-t pt-1.5 text-xs text-gray-500">{form.remark}</div>}
            </div>
            <div className="p-3 border-t flex gap-2">
              <button onClick={() => {
                const text = `*Lab Analysis - ${form.material}*\nRST: ${form.vehicleCode}\n📅 ${form.date}\n\nMoisture: ${form.moisture || '-'}%\nStarch: ${form.starch || '-'}%\nDamaged: ${form.damaged || '-'}%\nTFM: ${form.tfm || '-'}%\nFungus: ${form.fungus || '-'}%\nImmature: ${form.immature || '-'}%\nWater Dam: ${form.waterDamaged || '-'}%${form.remark ? '\n\nRemark: ' + form.remark : ''}`;
                doShare(text);
              }} className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-green-700">
                <Share2 size={14} /> Share
              </button>
              <button onClick={() => { save(); setShowPreview(false); }} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-3">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search RST number..."
          className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm" />
      </div>

      {/* === History === */}
      <div className="space-y-2">
        {Object.keys(grouped).length === 0 && (
          <p className="text-center text-sm text-gray-400 py-8">
            {search ? 'No samples match' : 'No samples yet'}
          </p>
        )}
        {Object.entries(grouped).map(([dateStr, items]) => {
          const isExpanded = expandedDate === dateStr;
          const dayAvgM = (items.reduce((a, e) => a + e.moisture, 0) / items.length).toFixed(1);
          const dayAvgS = (items.reduce((a, e) => a + e.starch, 0) / items.length).toFixed(1);
          return (
            <div key={dateStr} className="card !p-0 overflow-hidden">
              {/* Date Header */}
              <button onClick={() => setExpandedDate(isExpanded ? null : dateStr)}
                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-gray-800">{dateStr}</span>
                  <span className="text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full font-medium">{items.length}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span>M: <b>{dayAvgM}%</b></span>
                  <span>S: <b>{dayAvgS}%</b></span>
                  {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </div>
              </button>

              {/* Collapsed: compact table */}
              {!isExpanded && items.length <= 8 && (
                <div className="border-t">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 text-gray-400">
                        <th className="text-left px-4 py-1 font-medium">RST</th>
                        <th className="text-left px-2 py-1 font-medium">Material</th>
                        <th className="text-center px-2 py-1 font-medium">M%</th>
                        <th className="text-center px-2 py-1 font-medium">S%</th>
                        <th className="text-center px-2 py-1 font-medium">D%</th>
                        <th className="text-center px-2 py-1 font-medium">TFM%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(e => (
                        <tr key={e.id} className="border-t hover:bg-gray-50">
                          <td className="px-4 py-1.5 font-semibold text-indigo-600">{e.vehicleCode || '—'}</td>
                          <td className="px-2 py-1.5 text-amber-700">{(e as any).material || 'Corn'}</td>
                          <td className="text-center px-2 py-1.5">{e.moisture}</td>
                          <td className="text-center px-2 py-1.5 font-medium">{e.starch}</td>
                          <td className="text-center px-2 py-1.5">{e.damaged}</td>
                          <td className="text-center px-2 py-1.5 font-medium text-orange-600">{e.tfm}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {!isExpanded && items.length > 8 && (
                <div className="border-t px-4 py-2 text-xs text-gray-400 text-center">
                  {items.length} samples — click to expand
                </div>
              )}

              {/* Expanded: full detail */}
              {isExpanded && (
                <div className="border-t">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 text-gray-400">
                        <th className="text-left px-4 py-1.5 font-medium">RST</th>
                        <th className="text-left px-2 py-1.5 font-medium">Material</th>
                        <th className="text-center px-2 py-1.5 font-medium">M%</th>
                        <th className="text-center px-2 py-1.5 font-medium">S%</th>
                        <th className="text-center px-2 py-1.5 font-medium">D%</th>
                        <th className="text-center px-2 py-1.5 font-medium">TFM%</th>
                        <th className="text-center px-2 py-1.5 font-medium">Fungus</th>
                        <th className="text-center px-2 py-1.5 font-medium">Imm</th>
                        <th className="text-center px-2 py-1.5 font-medium">WD</th>
                        <th className="text-right px-4 py-1.5 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(e => (
                        <tr key={e.id} className="border-t hover:bg-gray-50">
                          <td className="px-4 py-2 font-semibold text-indigo-600">{e.vehicleCode || '—'}</td>
                          <td className="px-2 py-2 text-amber-700">{(e as any).material || 'Corn'}</td>
                          <td className="text-center px-2 py-2">{e.moisture}</td>
                          <td className="text-center px-2 py-2 font-medium">{e.starch}</td>
                          <td className="text-center px-2 py-2">{e.damaged}</td>
                          <td className="text-center px-2 py-2 font-bold text-orange-600">{e.tfm}</td>
                          <td className="text-center px-2 py-2 text-gray-500">{e.fungus}</td>
                          <td className="text-center px-2 py-2 text-gray-500">{e.immature}</td>
                          <td className="text-center px-2 py-2 text-gray-500">{e.waterDamaged}</td>
                          <td className="text-right px-4 py-2">
                            <div className="flex items-center justify-end gap-2">
                              <button onClick={() => doShare(shareText(e))} className="text-green-500 hover:text-green-700"><Share2 size={12} /></button>
                              {isAdmin && <button onClick={() => del(e.id)} className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ProcessPage>
  );
}
