import { useState, useEffect } from 'react';
import api from '../../services/api';

interface RawMaterialEntry {
  id: string; date: string; vehicleCode: string; vehicleNo: string;
  moisture: number; starch: number; fungus: number; immature: number;
  damaged: number; waterDamaged: number; tfm: number; remark: string | null;
}

export default function RawMaterial() {
  const [entries, setEntries] = useState<RawMaterialEntry[]>([]);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), vehicleCode: '', vehicleNo: '', moisture: '', starch: '', fungus: '', immature: '', damaged: '', waterDamaged: '', tfm: '', remark: '' });
  const [saving, setSaving] = useState(false);

  const load = () => api.get('/raw-material').then(r => setEntries(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try { await api.post('/raw-material', form); setForm(f => ({ ...f, vehicleCode: '', vehicleNo: '', moisture: '', starch: '', fungus: '', immature: '', damaged: '', waterDamaged: '', tfm: '', remark: '' })); load(); } catch {}
    setSaving(false);
  };

  const del = async (id: string) => { await api.delete(`/raw-material/${id}`); load(); };
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Raw Material Analysis</h1>

      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="font-semibold mb-3">New Entry</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <div><label className="text-xs text-gray-500">Date</label><input type="date" value={form.date} onChange={e => set('date', e.target.value)} className="w-full border rounded px-2 py-1 text-sm" /></div>
          <div><label className="text-xs text-gray-500">Vehicle Code</label><input value={form.vehicleCode} onChange={e => set('vehicleCode', e.target.value)} className="w-full border rounded px-2 py-1 text-sm" /></div>
          <div><label className="text-xs text-gray-500">Vehicle No</label><input value={form.vehicleNo} onChange={e => set('vehicleNo', e.target.value)} className="w-full border rounded px-2 py-1 text-sm" /></div>
          <div><label className="text-xs text-gray-500">Moisture %</label><input type="number" step="0.01" value={form.moisture} onChange={e => set('moisture', e.target.value)} className="w-full border rounded px-2 py-1 text-sm" /></div>
          <div><label className="text-xs text-gray-500">Starch %</label><input type="number" step="0.01" value={form.starch} onChange={e => set('starch', e.target.value)} className="w-full border rounded px-2 py-1 text-sm" /></div>
          <div><label className="text-xs text-gray-500">Fungus %</label><input type="number" step="0.01" value={form.fungus} onChange={e => set('fungus', e.target.value)} className="w-full border rounded px-2 py-1 text-sm" /></div>
          <div><label className="text-xs text-gray-500">Immature %</label><input type="number" step="0.01" value={form.immature} onChange={e => set('immature', e.target.value)} className="w-full border rounded px-2 py-1 text-sm" /></div>
          <div><label className="text-xs text-gray-500">Damaged %</label><input type="number" step="0.01" value={form.damaged} onChange={e => set('damaged', e.target.value)} className="w-full border rounded px-2 py-1 text-sm" /></div>
          <div><label className="text-xs text-gray-500">Water Damaged %</label><input type="number" step="0.01" value={form.waterDamaged} onChange={e => set('waterDamaged', e.target.value)} className="w-full border rounded px-2 py-1 text-sm" /></div>
          <div><label className="text-xs text-gray-500">TFM %</label><input type="number" step="0.01" value={form.tfm} onChange={e => set('tfm', e.target.value)} className="w-full border rounded px-2 py-1 text-sm" /></div>
          <div className="col-span-2"><label className="text-xs text-gray-500">Remark</label><input value={form.remark} onChange={e => set('remark', e.target.value)} className="w-full border rounded px-2 py-1 text-sm" /></div>
        </div>
        <button onClick={save} disabled={saving} className="mt-3 bg-blue-600 text-white px-4 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50">{saving ? 'Saving...' : 'Save Entry'}</button>
      </div>

      {/* Stats */}
      {entries.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Avg Moisture', val: (entries.reduce((a, e) => a + e.moisture, 0) / entries.length).toFixed(1) + '%' },
            { label: 'Avg Starch', val: (entries.reduce((a, e) => a + e.starch, 0) / entries.length).toFixed(1) + '%' },
            { label: 'Avg TFM', val: (entries.reduce((a, e) => a + e.tfm, 0) / entries.length).toFixed(1) + '%' },
            { label: 'Total Vehicles', val: entries.length.toString() },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-lg shadow p-3 text-center">
              <div className="text-xs text-gray-500">{s.label}</div>
              <div className="text-xl font-bold">{s.val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50"><tr>
            {['Date','Vehicle','Moisture%','Starch%','Fungus%','Immature%','Damaged%','Water Dam%','TFM%','Remark',''].map(h => <th key={h} className="px-2 py-2 text-left text-xs font-medium text-gray-500">{h}</th>)}
          </tr></thead>
          <tbody>{entries.slice(0, 100).map(e => (
            <tr key={e.id} className="border-t hover:bg-gray-50">
              <td className="px-2 py-1">{new Date(e.date).toLocaleDateString('en-IN')}</td>
              <td className="px-2 py-1">{e.vehicleCode} {e.vehicleNo}</td>
              <td className="px-2 py-1">{e.moisture}</td>
              <td className="px-2 py-1">{e.starch}</td>
              <td className="px-2 py-1">{e.fungus}</td>
              <td className="px-2 py-1">{e.immature}</td>
              <td className="px-2 py-1">{e.damaged}</td>
              <td className="px-2 py-1">{e.waterDamaged}</td>
              <td className="px-2 py-1">{e.tfm}</td>
              <td className="px-2 py-1 text-gray-500">{e.remark || '-'}</td>
              <td className="px-2 py-1"><button onClick={() => del(e.id)} className="text-red-500 text-xs hover:underline">Del</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
