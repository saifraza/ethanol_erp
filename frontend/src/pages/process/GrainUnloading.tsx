import React, { useEffect, useState } from 'react';
import { Wheat, Save, Loader2, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import ProcessPage, { InputCard, Field } from './ProcessPage';
import api from '../../services/api';

interface GrainForm {
  date: string;
  grainUnloaded: number | null;
  washConsumed: number | null;
  fermentationVolume: number | null;
  moisture: number | null;
  starchPercent: number | null;
  damagedPercent: number | null;
  foreignMatter: number | null;
  trucks: number | null;
  avgTruckWeight: number | null;
  supplier: string;
  remarks: string;
}

const emptyForm: GrainForm = {
  date: new Date().toISOString().split('T')[0],
  grainUnloaded: null, washConsumed: null, fermentationVolume: null,
  moisture: null, starchPercent: null, damagedPercent: null, foreignMatter: null,
  trucks: null, avgTruckWeight: null, supplier: '', remarks: '',
};

export default function GrainUnloading() {
  const [form, setForm] = useState<GrainForm>({ ...emptyForm });
  const [defaults, setDefaults] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [entries, setEntries] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const update = (n: string, v: any) => setForm(f => ({ ...f, [n]: v }));

  const grainConsumed = ((form.washConsumed || 0) * 0.31);
  const grainInProcess = ((form.fermentationVolume || 0) * 0.31);
  const opening = defaults.siloOpeningStock || 1500;
  const siloClosing = opening + (form.grainUnloaded || 0) - grainConsumed;
  const totalAtPlant = siloClosing + grainInProcess;

  useEffect(() => { loadLatest(); loadEntries(); }, []);

  async function loadLatest() {
    try {
      const res = await api.get('/grain/latest');
      setDefaults(res.data.defaults);
    } catch (e) { console.error(e); }
  }

  async function loadEntries() {
    try {
      const res = await api.get('/grain?limit=20');
      setEntries(res.data.entries);
    } catch (e) { console.error(e); }
  }

  async function handleSave() {
    if (!form.date) { setMsg({ type: 'err', text: 'Date is required' }); return; }
    setSaving(true); setMsg(null);
    try {
      if (editId) {
        await api.put(`/grain/${editId}`, form);
      } else {
        await api.post('/grain', form);
      }
      const now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setMsg({ type: 'ok', text: `Saved at ${now} — Grain silo stock updated.` });
      setForm({ ...emptyForm, date: form.date });
      setEditId(null);
      await loadLatest();
      await loadEntries();
    } catch (err: any) {
      setMsg({ type: 'err', text: err.response?.data?.error || 'Save failed' });
    }
    setSaving(false);
  }

  function editEntry(e: any) {
    setEditId(e.id);
    setForm({
      date: e.date.split('T')[0],
      grainUnloaded: e.grainUnloaded, washConsumed: e.washConsumed,
      fermentationVolume: e.fermentationVolume,
      moisture: e.moisture, starchPercent: e.starchPercent,
      damagedPercent: e.damagedPercent, foreignMatter: e.foreignMatter,
      trucks: e.trucks, avgTruckWeight: e.avgTruckWeight,
      supplier: e.supplier || '', remarks: e.remarks || '',
    });
    setDefaults((d: any) => ({ ...d, siloOpeningStock: e.siloOpeningStock }));
    window.scrollTo(0, 0);
  }

  async function deleteEntry(id: string) {
    if (!confirm('Delete this entry? Silo stock will be recalculated.')) return;
    try {
      await api.delete(`/grain/${id}`);
      await loadLatest(); await loadEntries();
      setMsg({ type: 'ok', text: 'Entry deleted. Stock recalculated.' });
    } catch (err: any) {
      setMsg({ type: 'err', text: err.response?.data?.error || 'Delete failed' });
    }
  }

  function fmtTime(iso: string) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  return (
    <ProcessPage title="Grain Unloading & Silo" icon={<Wheat size={28} />} description="Track grain inventory — every save updates your running silo balance" flow={{ from: 'Truck / Process', to: 'Grain Silo' }} color="bg-amber-600">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Silo Stock', value: defaults.siloOpeningStock ?? 1500, unit: 'Ton', color: 'bg-amber-50 border-amber-200' },
          { label: 'Last Unloaded', value: defaults.lastUnloaded ?? 0, unit: 'Ton', color: 'bg-green-50 border-green-200' },
          { label: 'Year Consumed', value: defaults.cumulativeConsumed ?? 10500, unit: 'Ton', color: 'bg-red-50 border-red-200' },
          { label: 'Year', value: defaults.yearStart ?? new Date().getFullYear(), unit: '', color: 'bg-blue-50 border-blue-200' },
        ].map(k => (
          <div key={k.label} className={`rounded-lg border p-3 ${k.color}`}>
            <div className="text-xs text-gray-500">{k.label}</div>
            <div className="text-xl font-bold">{typeof k.value === 'number' ? k.value.toFixed(1) : k.value} <span className="text-xs font-normal text-gray-400">{k.unit}</span></div>
          </div>
        ))}
      </div>

      {msg && (
        <div className={`rounded-lg p-3 mb-4 text-sm ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {msg.text}
        </div>
      )}

      <InputCard title={editId ? '✏️ Edit Entry' : '📝 New Entry'}>
        <Field label="Date" name="date" value={form.date} onChange={(_n: string, v: any) => update('date', v)} unit="" />
        <div className="border-t pt-3 mt-2">
          <div className="text-xs text-gray-400 mb-2 font-medium">INPUTS (you enter these)</div>
          <Field label="Grain Unloaded" name="grainUnloaded" value={form.grainUnloaded} onChange={update} unit="Ton" placeholder="Tons received from trucks" />
          <Field label="Wash Consumed (Distillation)" name="washConsumed" value={form.washConsumed} onChange={update} unit="KL" placeholder="From distillation section" />
          <Field label="Current Fermentation Volume" name="fermentationVolume" value={form.fermentationVolume} onChange={update} unit="KL" placeholder="Total in all fermenters now" />
        </div>
        <div className="border-t pt-3 mt-2">
          <div className="text-xs text-gray-400 mb-2 font-medium">AUTO-CALCULATED</div>
          <Field label="Grain Consumed (Wash×31%)" value={grainConsumed} auto unit="Ton" />
          <Field label="Grain in Process (Ferm×31%)" value={grainInProcess} auto unit="Ton" />
          <Field label="Silo Opening Stock" value={opening} auto unit="Ton" />
          <Field label="Silo Closing Stock" value={siloClosing} auto unit="Ton" />
          <Field label="Total Grain at Plant" value={totalAtPlant} auto unit="Ton" />
        </div>
      </InputCard>

      <InputCard title="Grain Quality (Optional)">
        <Field label="Moisture %" name="moisture" value={form.moisture} onChange={update} unit="%" />
        <Field label="Starch Content" name="starchPercent" value={form.starchPercent} onChange={update} unit="%" />
        <Field label="Broken / Damaged" name="damagedPercent" value={form.damagedPercent} onChange={update} unit="%" />
        <Field label="Foreign Matter" name="foreignMatter" value={form.foreignMatter} onChange={update} unit="%" />
      </InputCard>

      <InputCard title="Unloading Details (Optional)">
        <Field label="No. of Trucks" name="trucks" value={form.trucks} onChange={update} />
        <Field label="Avg Weight/Truck" name="avgTruckWeight" value={form.avgTruckWeight} onChange={update} unit="Ton" />
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 w-52 shrink-0">Supplier</label>
          <input type="text" value={form.supplier} onChange={e => update('supplier', e.target.value)} className="input-field flex-1" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 w-52 shrink-0">Remarks</label>
          <input type="text" value={form.remarks} onChange={e => update('remarks', e.target.value)} className="input-field flex-1" />
        </div>
      </InputCard>

      <div className="flex justify-end gap-3 mt-4 mb-6">
        {editId && <button onClick={() => { setEditId(null); setForm({ ...emptyForm }); loadLatest(); }} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancel Edit</button>}
        <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {editId ? 'Update Entry' : 'Save Entry'}
        </button>
      </div>

      {/* Entry History */}
      <div className="card mb-8">
        <button onClick={() => setShowHistory(!showHistory)} className="flex items-center justify-between w-full text-left">
          <h3 className="section-title mb-0">Entry History ({entries.length})</h3>
          {showHistory ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
        {showHistory && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Unloaded</th>
                  <th className="py-2 pr-3">Wash</th>
                  <th className="py-2 pr-3">Consumed</th>
                  <th className="py-2 pr-3">Silo Close</th>
                  <th className="py-2 pr-3">Total@Plant</th>
                  <th className="py-2 pr-3">Saved</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.id} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => editEntry(e)}>
                    <td className="py-2 pr-3 font-medium">{e.date.split('T')[0]}</td>
                    <td className="py-2 pr-3">{e.grainUnloaded?.toFixed(1)}</td>
                    <td className="py-2 pr-3">{e.washConsumed?.toFixed(1)}</td>
                    <td className="py-2 pr-3">{e.grainConsumed?.toFixed(1)}</td>
                    <td className="py-2 pr-3 font-semibold">{e.siloClosingStock?.toFixed(1)}</td>
                    <td className="py-2 pr-3 font-semibold">{e.totalGrainAtPlant?.toFixed(1)}</td>
                    <td className="py-2 pr-3 text-gray-400 text-xs">{fmtTime(e.updatedAt)}</td>
                    <td className="py-2">
                      <button onClick={(ev) => { ev.stopPropagation(); deleteEntry(e.id); }} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
                {entries.length === 0 && <tr><td colSpan={8} className="py-4 text-center text-gray-400">No entries yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ProcessPage>
  );
}
