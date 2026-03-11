import { useState, useEffect } from 'react';
import { FlaskConical, Plus, X, Share2, Save, Loader2, Search, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

interface RawMaterialEntry {
  id: string; date: string; vehicleCode: string; vehicleNo: string;
  moisture: number; starch: number; fungus: number; immature: number;
  damaged: number; waterDamaged: number; tfm: number; remark: string | null;
}

export default function RawMaterial() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [entries, setEntries] = useState<RawMaterialEntry[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    vehicleCode: '', moisture: '', starch: '', fungus: '',
    immature: '', damaged: '', waterDamaged: '', tfm: '', remark: ''
  });

  const load = () => api.get('/raw-material').then(r => setEntries(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setForm(f => ({ ...f, vehicleCode: '', moisture: '', starch: '', fungus: '', immature: '', damaged: '', waterDamaged: '', tfm: '', remark: '' }));
    setShowForm(false);
    setShowPreview(false);
  };

  const save = async () => {
    if (!form.vehicleCode.trim()) { setMsg({ type: 'err', text: 'RST number is required' }); return; }
    setSaving(true); setMsg(null);
    try {
      await api.post('/raw-material', { ...form, vehicleNo: '' });
      setMsg({ type: 'ok', text: 'Sample saved successfully' });
      resetForm();
      load();
    } catch { setMsg({ type: 'err', text: 'Save failed' }); }
    setSaving(false);
  };

  const del = async (id: string) => {
    if (!confirm('Delete this sample?')) return;
    await api.delete(`/raw-material/${id}`);
    load();
  };

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  // Filter entries
  const filtered = search.trim()
    ? entries.filter(e => e.vehicleCode.toLowerCase().includes(search.toLowerCase()) || e.vehicleNo.toLowerCase().includes(search.toLowerCase()))
    : entries;

  // Group by date
  const grouped: Record<string, RawMaterialEntry[]> = {};
  filtered.forEach(e => {
    const d = new Date(e.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    if (!grouped[d]) grouped[d] = [];
    grouped[d].push(e);
  });

  // Stats
  const totalSamples = entries.length;
  const avgMoisture = totalSamples > 0 ? (entries.reduce((a, e) => a + e.moisture, 0) / totalSamples).toFixed(1) : '—';
  const avgStarch = totalSamples > 0 ? (entries.reduce((a, e) => a + e.starch, 0) / totalSamples).toFixed(1) : '—';
  const avgTfm = totalSamples > 0 ? (entries.reduce((a, e) => a + e.tfm, 0) / totalSamples).toFixed(1) : '—';

  return (
    <div className="max-w-5xl mx-auto px-3 py-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="p-2 bg-indigo-100 rounded-lg"><FlaskConical size={24} className="text-indigo-600" /></div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Raw Material Analysis</h1>
          <p className="text-xs text-gray-500">Lab quality testing — enter RST number & analysis results</p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Avg Moisture', value: avgMoisture + '%', color: 'bg-blue-50 text-blue-700 border-blue-200' },
          { label: 'Avg Starch', value: avgStarch + '%', color: 'bg-green-50 text-green-700 border-green-200' },
          { label: 'Avg TFM', value: avgTfm + '%', color: 'bg-orange-50 text-orange-700 border-orange-200' },
          { label: 'Total Samples', value: String(totalSamples), color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
        ].map(s => (
          <div key={s.label} className={`border rounded-lg px-3 py-2 text-center ${s.color}`}>
            <div className="text-[10px] uppercase opacity-60">{s.label}</div>
            <div className="text-lg font-bold">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Add Sample Button */}
      {!showForm && (
        <button onClick={() => setShowForm(true)}
          className="w-full border-2 border-dashed border-indigo-300 rounded-lg py-4 text-indigo-600 hover:bg-indigo-50 flex items-center justify-center gap-2 mb-5 font-medium">
          <Plus size={20} /> New Sample
        </button>
      )}

      {/* New Sample Form */}
      {showForm && (
        <div className="border-2 border-indigo-300 rounded-lg p-4 bg-white mb-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-indigo-700 flex items-center gap-2">
              <FlaskConical size={18} /> New Lab Sample
            </h3>
            <button onClick={resetForm} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>

          {/* Row 1: Date + RST */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            <div>
              <label className="text-[10px] text-gray-400 font-medium">DATE</label>
              <input type="date" value={form.date} onChange={e => set('date', e.target.value)}
                className="border rounded-lg px-3 py-2.5 w-full text-sm" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] text-indigo-500 font-medium">RST NUMBER *</label>
              <input value={form.vehicleCode} onChange={e => set('vehicleCode', e.target.value)}
                className="border-2 border-indigo-200 rounded-lg px-3 py-2.5 w-full text-sm bg-indigo-50 font-medium"
                placeholder="Enter RST / UID number" autoFocus />
            </div>
          </div>

          {/* Quality Parameters */}
          <div className="text-[10px] text-gray-400 font-medium mb-2">QUALITY PARAMETERS</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <div>
              <label className="text-[10px] text-gray-400">Moisture %</label>
              <input type="number" step="0.01" value={form.moisture} onChange={e => set('moisture', e.target.value)}
                className="border rounded-lg px-3 py-2.5 w-full text-sm" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">Starch %</label>
              <input type="number" step="0.01" value={form.starch} onChange={e => set('starch', e.target.value)}
                className="border rounded-lg px-3 py-2.5 w-full text-sm" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">Fungus %</label>
              <input type="number" step="0.01" value={form.fungus} onChange={e => set('fungus', e.target.value)}
                className="border rounded-lg px-3 py-2.5 w-full text-sm" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">Immature %</label>
              <input type="number" step="0.01" value={form.immature} onChange={e => set('immature', e.target.value)}
                className="border rounded-lg px-3 py-2.5 w-full text-sm" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">Damaged %</label>
              <input type="number" step="0.01" value={form.damaged} onChange={e => set('damaged', e.target.value)}
                className="border rounded-lg px-3 py-2.5 w-full text-sm" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">Water Damaged %</label>
              <input type="number" step="0.01" value={form.waterDamaged} onChange={e => set('waterDamaged', e.target.value)}
                className="border rounded-lg px-3 py-2.5 w-full text-sm" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">TFM %</label>
              <input type="number" step="0.01" value={form.tfm} onChange={e => set('tfm', e.target.value)}
                className="border rounded-lg px-3 py-2.5 w-full text-sm" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">Remark</label>
              <input value={form.remark} onChange={e => set('remark', e.target.value)}
                className="border rounded-lg px-3 py-2.5 w-full text-sm" placeholder="Optional" />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button onClick={() => setShowPreview(true)}
              className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg font-medium text-sm hover:bg-indigo-700 flex items-center gap-2">
              <Save size={16} /> Preview & Save
            </button>
            {msg && <span className={`text-sm ${msg.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</span>}
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowPreview(false)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="bg-indigo-600 text-white p-4 rounded-t-xl flex items-center justify-between">
              <h3 className="font-bold">Lab Analysis Report</h3>
              <button onClick={() => setShowPreview(false)}><X size={20} /></button>
            </div>
            <div className="p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Date</span><span className="font-medium">{form.date}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">RST Number</span><span className="font-bold text-indigo-600">{form.vehicleCode}</span></div>
              <div className="border-t pt-2 grid grid-cols-2 gap-2 text-sm">
                {form.moisture && <div>Moisture: <b>{form.moisture}%</b></div>}
                {form.starch && <div>Starch: <b>{form.starch}%</b></div>}
                {form.fungus && <div>Fungus: <b>{form.fungus}%</b></div>}
                {form.immature && <div>Immature: <b>{form.immature}%</b></div>}
                {form.damaged && <div>Damaged: <b>{form.damaged}%</b></div>}
                {form.waterDamaged && <div>Water Dam: <b>{form.waterDamaged}%</b></div>}
                {form.tfm && <div>TFM: <b>{form.tfm}%</b></div>}
              </div>
              {form.remark && <div className="border-t pt-2 text-gray-600">{form.remark}</div>}
            </div>
            <div className="p-4 border-t flex gap-2">
              <button onClick={() => {
                const text = `*Lab Analysis*\nRST: ${form.vehicleCode}\n📅 ${form.date}\n\nMoisture: ${form.moisture || '-'}%\nStarch: ${form.starch || '-'}%\nFungus: ${form.fungus || '-'}%\nImmature: ${form.immature || '-'}%\nDamaged: ${form.damaged || '-'}%\nWater Dam: ${form.waterDamaged || '-'}%\nTFM: ${form.tfm || '-'}%${form.remark ? '\n\nRemark: ' + form.remark : ''}`;
                if (navigator.share) { navigator.share({ text }).catch(() => { window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank'); }); }
                else { window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank'); }
              }} className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-green-700">
                <Share2 size={16} /> Share
              </button>
              <button onClick={() => { save(); setShowPreview(false); }} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by RST number..."
          className="w-full border rounded-lg pl-9 pr-3 py-2.5 text-sm" />
      </div>

      {/* History - Grouped by Date */}
      <div className="space-y-3">
        {Object.keys(grouped).length === 0 && (
          <p className="text-center text-sm text-gray-400 py-8">
            {search ? 'No samples match your search' : 'No samples recorded yet'}
          </p>
        )}
        {Object.entries(grouped).map(([dateStr, items]) => {
          const isExpanded = expandedDate === dateStr;
          const dayAvgM = (items.reduce((a, e) => a + e.moisture, 0) / items.length).toFixed(1);
          return (
            <div key={dateStr} className="border rounded-lg bg-white overflow-hidden">
              <button onClick={() => setExpandedDate(isExpanded ? null : dateStr)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-gray-700">{dateStr}</span>
                  <span className="text-xs text-gray-400">{items.length} sample{items.length > 1 ? 's' : ''}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-500">Avg M: {dayAvgM}%</span>
                  {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                </div>
              </button>

              {/* Collapsed: show sample cards inline */}
              {!isExpanded && (
                <div className="px-4 pb-3 flex flex-wrap gap-2">
                  {items.map(e => (
                    <div key={e.id} className="text-xs bg-gray-50 border rounded px-2 py-1 flex items-center gap-2">
                      <span className="font-medium text-indigo-600">{e.vehicleCode || '—'}</span>
                      <span className="text-gray-400">M:{e.moisture}%</span>
                      <span className="text-gray-400">S:{e.starch}%</span>
                      <span className="text-gray-400">TFM:{e.tfm}%</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Expanded: full detail cards */}
              {isExpanded && (
                <div className="border-t divide-y">
                  {items.map(e => (
                    <div key={e.id} className="px-4 py-3 hover:bg-gray-50">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">{e.vehicleCode || '—'}</span>
                          {e.vehicleNo && <span className="text-xs text-gray-400">{e.vehicleNo}</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => {
                            const text = `*Lab Analysis*\nRST: ${e.vehicleCode}\n📅 ${new Date(e.date).toLocaleDateString('en-IN')}\n\nMoisture: ${e.moisture}%\nStarch: ${e.starch}%\nFungus: ${e.fungus}%\nImmature: ${e.immature}%\nDamaged: ${e.damaged}%\nWater Dam: ${e.waterDamaged}%\nTFM: ${e.tfm}%${e.remark ? '\nRemark: ' + e.remark : ''}`;
                            if (navigator.share) { navigator.share({ text }).catch(() => {}); }
                            else { window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank'); }
                          }} className="text-green-500 hover:text-green-700"><Share2 size={14} /></button>
                          {isAdmin && <button onClick={() => del(e.id)} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>}
                        </div>
                      </div>
                      <div className="grid grid-cols-4 sm:grid-cols-7 gap-x-4 gap-y-1 text-xs">
                        <div><span className="text-gray-400">Moisture</span><div className="font-medium">{e.moisture}%</div></div>
                        <div><span className="text-gray-400">Starch</span><div className="font-medium">{e.starch}%</div></div>
                        <div><span className="text-gray-400">Fungus</span><div className="font-medium">{e.fungus}%</div></div>
                        <div><span className="text-gray-400">Immature</span><div className="font-medium">{e.immature}%</div></div>
                        <div><span className="text-gray-400">Damaged</span><div className="font-medium">{e.damaged}%</div></div>
                        <div><span className="text-gray-400">Water Dam</span><div className="font-medium">{e.waterDamaged}%</div></div>
                        <div><span className="text-gray-400">TFM</span><div className="font-bold text-orange-600">{e.tfm}%</div></div>
                      </div>
                      {e.remark && <div className="text-xs text-gray-500 mt-1">{e.remark}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
