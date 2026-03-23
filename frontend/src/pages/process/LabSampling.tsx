import { useState, useEffect } from 'react';
import { FlaskConical, Plus, Trash2, Check, X, Search, Edit2 } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import ProcessPage from './ProcessPage';

const RESULT_OPTIONS = ['PENDING', 'ACCEPTED', 'REJECTED'];
const RESULT_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  ACCEPTED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
};

export default function LabSampling() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [samples, setSamples] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [search, setSearch] = useState('');

  // Form
  const [rstNumber, setRstNumber] = useState('');
  const [moisture, setMoisture] = useState('');
  const [starchPercent, setStarchPercent] = useState('');
  const [damagedPercent, setDamagedPercent] = useState('');
  const [foreignMatter, setForeignMatter] = useState('');
  const [fungus, setFungus] = useState('');
  const [immature, setImmature] = useState('');
  const [waterDamaged, setWaterDamaged] = useState('');
  const [tfm, setTfm] = useState('');
  const [remarks, setRemarks] = useState('');
  const [result, setResult] = useState('PENDING');

  useEffect(() => { loadSamples(); }, []);

  async function loadSamples() {
    try {
      const res = await api.get(`/lab-sample?search=${search}`);
      setSamples(res.data.samples || []);
    } catch (e) { console.error(e); }
  }

  function resetForm() {
    setRstNumber(''); setMoisture(''); setStarchPercent(''); setDamagedPercent('');
    setForeignMatter(''); setFungus(''); setImmature(''); setWaterDamaged('');
    setTfm(''); setRemarks(''); setResult('PENDING'); setEditId(null);
  }

  function editSample(s: any) {
    setEditId(s.id);
    setRstNumber(s.rstNumber || '');
    setMoisture(s.moisture != null ? String(s.moisture) : '');
    setStarchPercent(s.starchPercent != null ? String(s.starchPercent) : '');
    setDamagedPercent(s.damagedPercent != null ? String(s.damagedPercent) : '');
    setForeignMatter(s.foreignMatter != null ? String(s.foreignMatter) : '');
    setFungus(s.fungus != null ? String(s.fungus) : '');
    setImmature(s.immature != null ? String(s.immature) : '');
    setWaterDamaged(s.waterDamaged != null ? String(s.waterDamaged) : '');
    setTfm(s.tfm != null ? String(s.tfm) : '');
    setRemarks(s.remarks || '');
    setResult(s.result || 'PENDING');
    setShowForm(true);
  }

  async function handleSave() {
    if (!rstNumber.trim()) { setMsg({ type: 'err', text: 'RST number is required' }); return; }
    setSaving(true); setMsg(null);
    try {
      const payload = {
        rstNumber, moisture, starchPercent, damagedPercent, foreignMatter,
        fungus, immature, waterDamaged, tfm, remarks, result,
      };
      if (editId) {
        await api.put(`/lab-sample/${editId}`, payload);
        setMsg({ type: 'ok', text: 'Sample updated' });
      } else {
        await api.post('/lab-sample', payload);
        setMsg({ type: 'ok', text: 'Sample saved' });
      }
      resetForm(); setShowForm(false); loadSamples();
    } catch (err: any) {
      setMsg({ type: 'err', text: err.response?.data?.error || 'Save failed' });
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this sample?')) return;
    try {
      await api.delete(`/lab-sample/${id}`);
      loadSamples();
    } catch (e) { console.error(e); }
  }

  const fmtTime = (d: string) => {
    const dt = new Date(d);
    return dt.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
  };

  return (
    <ProcessPage title="Lab Sampling" icon={<FlaskConical size={28} />} description="Enter lab quality data per RST number — auto-links to truck entries" flow={{ from: 'Truck Sample', to: 'Quality Report' }} color="bg-indigo-600">
      {msg && (
        <div className={`rounded-lg p-3 mb-4 text-sm ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{msg.text}</div>
      )}

      {/* Search + Add */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex-1 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && loadSamples()}
            placeholder="Search by RST number..."
            className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm"
          />
        </div>
        <button onClick={() => { resetForm(); setShowForm(!showForm); }} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-1">
          <Plus size={16} /> New Sample
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white border rounded-xl p-4 mb-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">{editId ? 'Edit Sample' : 'New Lab Sample'}</h3>
            <button onClick={() => { setShowForm(false); resetForm(); }}><X size={18} className="text-gray-400" /></button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="text-[10px] text-gray-400 block">RST Number *</label>
              <input type="text" value={rstNumber} onChange={e => setRstNumber(e.target.value)}
                disabled={!!editId} className="input-field w-full text-sm font-bold" placeholder="e.g. 179" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400 block">Result</label>
              <select value={result} onChange={e => setResult(e.target.value)} className="input-field w-full text-sm">
                {RESULT_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>

          <div className="text-xs text-gray-400 font-medium mt-4 mb-2">QUALITY PARAMETERS</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Moisture %', val: moisture, set: setMoisture },
              { label: 'Starch %', val: starchPercent, set: setStarchPercent },
              { label: 'Damaged %', val: damagedPercent, set: setDamagedPercent },
              { label: 'Foreign Matter %', val: foreignMatter, set: setForeignMatter },
              { label: 'Fungus %', val: fungus, set: setFungus },
              { label: 'Immature %', val: immature, set: setImmature },
              { label: 'Water Damaged %', val: waterDamaged, set: setWaterDamaged },
              { label: 'TFM %', val: tfm, set: setTfm },
            ].map(f => (
              <div key={f.label}>
                <label className="text-[10px] text-gray-400 block">{f.label}</label>
                <input type="number" step="any" value={f.val} onChange={e => f.set(e.target.value)}
                  className="input-field w-full text-sm" />
              </div>
            ))}
          </div>

          <div className="mt-3">
            <label className="text-[10px] text-gray-400 block">Remarks</label>
            <input type="text" value={remarks} onChange={e => setRemarks(e.target.value)}
              className="input-field w-full text-sm" placeholder="Any notes..." />
          </div>

          <button onClick={handleSave} disabled={saving}
            className="mt-4 bg-indigo-600 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {saving ? 'Saving...' : editId ? 'Update Sample' : 'Save Sample'}
          </button>
        </div>
      )}

      {/* Samples List */}
      <div className="space-y-2">
        {samples.length === 0 && <div className="text-center text-gray-400 py-8 text-sm">No lab samples yet</div>}
        {samples.map(s => (
          <div key={s.id} className="bg-white border rounded-lg p-3 flex items-start justify-between hover:shadow-sm transition">
            <div className="flex-1" onClick={() => editSample(s)} style={{ cursor: 'pointer' }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-bold text-sm">RST #{s.rstNumber}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${RESULT_COLORS[s.result] || 'bg-gray-100'}`}>
                  {s.result}
                </span>
                <span className="text-[10px] text-gray-400">{fmtTime(s.createdAt)}</span>
              </div>
              <div className="text-[11px] text-gray-500 flex flex-wrap gap-x-3">
                {s.moisture != null && <span>M: {s.moisture}%</span>}
                {s.starchPercent != null && <span>S: {s.starchPercent}%</span>}
                {s.damagedPercent != null && <span>D: {s.damagedPercent}%</span>}
                {s.foreignMatter != null && <span>FM: {s.foreignMatter}%</span>}
                {s.fungus != null && <span>Fungus: {s.fungus}%</span>}
                {s.immature != null && <span>Immature: {s.immature}%</span>}
                {s.waterDamaged != null && <span>WD: {s.waterDamaged}%</span>}
                {s.tfm != null && <span>TFM: {s.tfm}%</span>}
              </div>
              {s.remarks && <div className="text-[10px] text-gray-400 mt-0.5">{s.remarks}</div>}
            </div>
            <div className="flex items-center gap-1 ml-2">
              {isAdmin && (
                <button onClick={() => handleDelete(s.id)} className="p-1.5 text-gray-400 hover:text-red-500">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </ProcessPage>
  );
}
