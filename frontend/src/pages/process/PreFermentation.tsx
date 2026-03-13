import { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Plus, FlaskConical, Beaker, ArrowRight, RotateCcw, Trash2, ChevronDown, ChevronUp, Clock, Pencil, Share2 } from 'lucide-react';
import api from '../../services/api';

/* ═══════════════════════ TYPES ═══════════════════════ */
interface Chemical { id: string; name: string; rate: number | null; unit: string; }
interface Dosing { id: string; chemicalName: string; quantity: number; unit: string; rate: number | null; addedAt: string; }
interface LabReading { id: string; analysisTime: string; spGravity: number | null; ph: number | null; rs: number | null; rst: number | null; alcohol: number | null; ds: number | null; vfaPpa: number | null; temp: number | null; remarks: string | null; createdAt: string; }
interface Batch { id: string; batchNo: number; fermenterNo: number; phase: string; setupTime: string | null; dosingEndTime: string | null; slurryVolume: number | null; slurryGravity: number | null; slurryTemp: number | null; transferTime: string | null; transferVolume: number | null; cipStartTime: string | null; cipEndTime: string | null; remarks: string | null; createdAt: string; dosings: Dosing[]; labReadings: LabReading[]; }

/* helper: ISO string → datetime-local value */
const toLocal = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};
const nowLocal = () => toLocal(new Date().toISOString());

const PHASES = ['SETUP', 'DOSING', 'LAB', 'TRANSFER', 'CIP', 'DONE'] as const;
const phaseColors: Record<string, string> = { SETUP: '#6366f1', DOSING: '#f59e0b', LAB: '#10b981', TRANSFER: '#3b82f6', CIP: '#8b5cf6', DONE: '#6b7280' };
const phaseLabels: Record<string, string> = { SETUP: 'Setup', DOSING: 'Dosing', LAB: 'Lab Analysis', TRANSFER: 'Transfer', CIP: 'CIP', DONE: 'Done' };
const PF_VOLUME_M3 = 450;

export default function PreFermentation() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [chemicals, setChemicals] = useState<Chemical[]>([]);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [showNewBatch, setShowNewBatch] = useState(false);
  const [showNewChem, setShowNewChem] = useState(false);
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);
  const [phaseMsg, setPhaseMsg] = useState<string | null>(null);

  const [nbForm, setNbForm] = useState({ batchNo: '', fermenterNo: '1', pfLevel: '', slurryGravity: '', slurryTemp: '', remarks: '' });
  const [doseForm, setDoseForm] = useState({ chemicalName: '', quantity: '', unit: 'kg', rate: '' });
  const [labForm, setLabForm] = useState({ analysisTime: '', spGravity: '', ph: '', rs: '', rst: '', alcohol: '', ds: '', vfaPpa: '', temp: '', remarks: '' });
  const [chemForm, setChemForm] = useState({ name: '', rate: '', unit: 'kg' });

  const load = useCallback(() => {
    api.get('/pre-fermentation/batches').then(r => setBatches(r.data)).catch(() => {});
    api.get('/pre-fermentation/chemicals').then(r => setChemicals(r.data)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const activeBatch = batches.find(b => b.id === activeBatchId) || batches.find(b => b.phase !== 'DONE') || null;

  const createBatch = async () => {
    try {
      const slurryVolume = nbForm.pfLevel ? (parseFloat(nbForm.pfLevel) / 100 * PF_VOLUME_M3 * 1000).toFixed(0) : '';
      await api.post('/pre-fermentation/batches', { ...nbForm, slurryVolume, setupTime: new Date().toISOString() }); // auto-set, editable later via TimeField
      setShowNewBatch(false);
      setNbForm({ batchNo: '', fermenterNo: '1', pfLevel: '', slurryGravity: '', slurryTemp: '', remarks: '' });
      load();
    } catch {}
  };

  const addDosing = async () => {
    if (!activeBatch) return;
    try {
      await api.post(`/pre-fermentation/batches/${activeBatch.id}/dosing`, doseForm);
      setDoseForm(f => ({ ...f, quantity: '' }));
      load();
    } catch {}
  };

  const addLabReading = async () => {
    if (!activeBatch) return;
    try {
      const analysisTimeISO = labForm.analysisTime ? new Date(labForm.analysisTime).toISOString() : new Date().toISOString();
      await api.post(`/pre-fermentation/batches/${activeBatch.id}/lab`, { ...labForm, analysisTime: analysisTimeISO });
      setLabForm({ analysisTime: '', spGravity: '', ph: '', rs: '', rst: '', alcohol: '', ds: '', vfaPpa: '', temp: '', remarks: '' });
      load();
    } catch {}
  };

  const advancePhase = async (batch: Batch, toPhase: string, extra?: any) => {
    try {
      setPhaseMsg(`✓ Saved — moving to ${phaseLabels[toPhase]}...`);
      await api.patch(`/pre-fermentation/batches/${batch.id}`, { phase: toPhase, ...extra });
      load();
      setTimeout(() => setPhaseMsg(null), 2000);
    } catch { setPhaseMsg(null); }
  };

  const deleteBatch = async (id: string) => {
    if (!confirm('Delete this batch and all its data?')) return;
    await api.delete(`/pre-fermentation/batches/${id}`);
    if (activeBatchId === id) setActiveBatchId(null);
    load();
  };

  const addChemical = async () => {
    if (!chemForm.name.trim()) return alert('Enter chemical name');
    try {
      await api.post('/pre-fermentation/chemicals', { name: chemForm.name.trim(), unit: chemForm.unit });
      setChemForm({ name: '', rate: '', unit: 'kg' });
      setShowNewChem(false);
      load();
    } catch (e: any) { alert(e?.response?.data?.error || 'Failed to add chemical'); }
  };

  const setNow = () => setLabForm(f => ({ ...f, analysisTime: nowLocal() }));

  /* update a single time field on a batch */
  const updateBatchTime = async (batchId: string, field: string, value: string) => {
    try {
      await api.patch(`/pre-fermentation/batches/${batchId}`, { [field]: value ? new Date(value).toISOString() : null });
      load();
    } catch {}
  };

  /* inline editable datetime component */
  const TimeField = ({ label, value, field, batchId, color = 'gray' }: { label: string; value: string | null; field: string; batchId: string; color?: string }) => {
    const [editing, setEditing] = useState(false);
    const [val, setVal] = useState(toLocal(value));
    useEffect(() => { setVal(toLocal(value)); }, [value]);
    return (
      <div className="flex items-center gap-1.5 text-sm">
        <Clock size={13} className={`text-${color}-500`} />
        <span className="text-gray-500">{label}:</span>
        {editing ? (
          <span className="flex items-center gap-1">
            <input type="datetime-local" value={val} onChange={e => setVal(e.target.value)}
              className="border rounded px-1.5 py-0.5 text-sm" />
            <button onClick={() => { updateBatchTime(batchId, field, val); setEditing(false); }}
              className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">✓</button>
            <button onClick={() => { setVal(toLocal(value)); setEditing(false); }}
              className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">✕</button>
          </span>
        ) : (
          <span className="flex items-center gap-1 cursor-pointer" onClick={() => setEditing(true)}>
            {value ? new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : <span className="text-gray-300 italic">not set</span>}
            <Pencil size={12} className="text-gray-400 hover:text-gray-600" />
          </span>
        )}
        {!value && !editing && (
          <button onClick={() => { const n = nowLocal(); setVal(n); updateBatchTime(batchId, field, n); }}
            className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded hover:bg-blue-100">Set Now</button>
        )}
      </div>
    );
  };

  const selectChemical = (name: string) => {
    const chem = chemicals.find(c => c.name === name);
    setDoseForm(f => ({ ...f, chemicalName: name, unit: chem?.unit || 'kg' }));
  };

  useEffect(() => { if (chemicals.length > 0 && !doseForm.chemicalName) selectChemical(chemicals[0].name); }, [chemicals]);

  /* elapsed time helper: returns "+2h 15m" from T0 */
  const elapsed = (from: string | null, to: string | null) => {
    if (!from || !to) return '';
    const ms = new Date(to).getTime() - new Date(from).getTime();
    if (ms < 0) return '';
    const mins = Math.floor(ms / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `+${h}h ${m}m` : `+${m}m`;
  };

  /* Phase duration: time spent in each phase */
  const pfPhaseDuration = (batch: Batch, phase: string): string => {
    const starts: Record<string, string | null> = { SETUP: batch.setupTime, DOSING: batch.dosingEndTime ? batch.setupTime : null, LAB: batch.dosingEndTime, TRANSFER: batch.transferTime, CIP: batch.cipStartTime, DONE: batch.cipEndTime };
    const ends: Record<string, string | null> = { SETUP: batch.dosingEndTime || batch.transferTime, DOSING: batch.dosingEndTime, LAB: batch.transferTime, TRANSFER: batch.cipStartTime, CIP: batch.cipEndTime, DONE: null };
    const s = starts[phase], e = ends[phase];
    if (!s || !e) return '';
    const ms = new Date(e).getTime() - new Date(s).getTime();
    if (ms <= 0) return '';
    const mins = Math.floor(ms / 60000); const h = Math.floor(mins / 60); const m = mins % 60;
    if (h >= 24) { const d = Math.floor(h / 24); const rh = h % 24; return `${d}d ${rh}h ${m}m`; }
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  /* map phase → its recorded time */
  const phaseTime = (batch: Batch, phase: string): string | null => {
    switch (phase) {
      case 'SETUP': return batch.setupTime;
      case 'DOSING': return batch.dosingEndTime;
      case 'LAB': return batch.dosingEndTime; // lab starts when dosing ends
      case 'TRANSFER': return batch.transferTime;
      case 'CIP': return batch.cipStartTime;
      case 'DONE': return batch.cipEndTime;
      default: return null;
    }
  };

  const PhaseTimeline = ({ batch, showDurations = false }: { batch: Batch; showDurations?: boolean }) => {
    const ci = PHASES.indexOf(batch.phase as any);
    const t0 = batch.setupTime;
    return (
      <div className="my-3 px-4">
        <div className="flex items-center gap-1 flex-wrap">
          {PHASES.map((p, i) => {
            const pt = phaseTime(batch, p);
            const el = t0 && pt ? elapsed(t0, pt) : '';
            const dur = pfPhaseDuration(batch, p);
            return (
              <div key={p} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div className={`px-3 py-1 rounded-full text-xs font-medium ${i <= ci ? 'text-white' : 'text-gray-400 bg-gray-100'}`} style={i <= ci ? { backgroundColor: phaseColors[p] } : {}}>
                    {phaseLabels[p]}
                    {i === 0 && t0 && <span className="ml-1 opacity-75">T0</span>}
                    {i > 0 && el && <span className="ml-1 opacity-75 text-[10px]">{el}</span>}
                  </div>
                  {showDurations && dur && <span className="text-[10px] text-gray-500 mt-0.5">{dur}</span>}
                </div>
                {i < PHASES.length - 1 && <ArrowRight size={14} className="mx-1 text-gray-300" />}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const LabChart = ({ readings, t0 }: { readings: LabReading[]; t0?: string | null }) => {
    if (readings.length < 2) return null;
    const data = readings.map((r, i) => {
      let label = r.analysisTime || `#${i + 1}`;
      if (t0 && r.createdAt) { label = 'T0 ' + elapsed(t0, r.createdAt); }
      return { name: label, Gravity: r.spGravity, pH: r.ph, RS: r.rs, Alcohol: r.alcohol, Temp: r.temp };
    });
    return (
      <div className="bg-white rounded-lg border p-3 mt-3">
        <h4 className="text-sm font-semibold mb-2">Lab Trend (from T0)</h4>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Legend />
            <Line type="monotone" dataKey="Gravity" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="pH" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="RS" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="Alcohol" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="Temp" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  };

  const numField = (label: string, value: string, onChange: (v: string) => void, step = '0.01', placeholder = '') => (
    <div><label className="text-xs text-gray-500">{label}</label><input type="number" step={step} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="w-full border rounded px-2 py-1.5 text-sm" /></div>
  );
  const txtField = (label: string, value: string, onChange: (v: string) => void, placeholder = '') => (
    <div><label className="text-xs text-gray-500">{label}</label><input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="w-full border rounded px-2 py-1.5 text-sm" /></div>
  );

  return (
    <div className="space-y-5">
      {/* HEADER */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl p-5 text-white">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><FlaskConical size={24} /> Pre-Fermentation</h1>
            <p className="text-indigo-200 text-sm mt-1">{batches.length} batches | {batches.filter(b => b.phase !== 'DONE').length} active</p>
          </div>
          <button onClick={() => setShowNewBatch(true)} className="bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1"><Plus size={16} /> New Batch</button>
        </div>
      </div>

      {/* NEW BATCH FORM */}
      {showNewBatch && (
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-indigo-500">
          <h3 className="font-semibold mb-3">Start New PF Batch</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {numField('Batch No', nbForm.batchNo, v => setNbForm(f => ({ ...f, batchNo: v })), '1', 'e.g. 42')}
            <div>
              <label className="text-xs text-gray-500">Pre-Fermenter</label>
              <div className="flex gap-2 mt-1">
                {[1, 2].map(n => (
                  <button key={n} onClick={() => setNbForm(f => ({ ...f, fermenterNo: String(n) }))}
                    className={`px-4 py-1.5 rounded text-sm font-medium border ${nbForm.fermenterNo === String(n) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'}`}>PF{n}</button>
                ))}
              </div>
            </div>
            {numField('PF Level %', nbForm.pfLevel, v => setNbForm(f => ({ ...f, pfLevel: v })), '1', 'e.g. 80')}
            {numField('Slurry Gravity', nbForm.slurryGravity, v => setNbForm(f => ({ ...f, slurryGravity: v })), '0.001')}
            {numField('Slurry Temp °C', nbForm.slurryTemp, v => setNbForm(f => ({ ...f, slurryTemp: v })), '0.1')}
            {txtField('Remarks', nbForm.remarks, v => setNbForm(f => ({ ...f, remarks: v })))}
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={createBatch} className="bg-indigo-600 text-white px-4 py-1.5 rounded text-sm hover:bg-indigo-700">Create Batch</button>
            <button onClick={() => setShowNewBatch(false)} className="bg-gray-200 px-4 py-1.5 rounded text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* ACTIVE BATCH */}
      {activeBatch && (
        <div className="bg-white rounded-lg shadow border">
          <div className="p-4 border-b flex justify-between items-start">
            <div>
              <h2 className="text-lg font-bold">Batch #{activeBatch.batchNo} — PF{activeBatch.fermenterNo}</h2>
              <div className="text-sm text-gray-500 flex gap-3 mt-1 flex-wrap">
                {activeBatch.slurryVolume && <span>Level: {(activeBatch.slurryVolume / (PF_VOLUME_M3 * 1000) * 100).toFixed(0)}% ({(activeBatch.slurryVolume / 1000).toFixed(0)} M³)</span>}
                {activeBatch.slurryGravity && <span>SG: {activeBatch.slurryGravity}</span>}
                {activeBatch.slurryTemp && <span>Temp: {activeBatch.slurryTemp}°C</span>}
              </div>
              {/* ─── Editable phase times ─── */}
              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2">
                <TimeField label="Setup" value={activeBatch.setupTime} field="setupTime" batchId={activeBatch.id} color="indigo" />
                {activeBatch.dosingEndTime && (
                  <TimeField label="Dosing Done" value={activeBatch.dosingEndTime} field="dosingEndTime" batchId={activeBatch.id} color="amber" />
                )}
                {['TRANSFER','CIP','DONE'].includes(activeBatch.phase) && (
                  <TimeField label="Transfer" value={activeBatch.transferTime} field="transferTime" batchId={activeBatch.id} color="blue" />
                )}
                {['CIP','DONE'].includes(activeBatch.phase) && (
                  <TimeField label="CIP Start" value={activeBatch.cipStartTime} field="cipStartTime" batchId={activeBatch.id} color="purple" />
                )}
                {activeBatch.phase === 'DONE' && (
                  <TimeField label="CIP End" value={activeBatch.cipEndTime} field="cipEndTime" batchId={activeBatch.id} color="gray" />
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => {
                const b = activeBatch;
                const dosingList = b.dosings.map(d => `  ${d.chemicalName}: ${d.quantity} ${d.unit}`).join('\n');
                const lastLab = b.labReadings.length > 0 ? b.labReadings[b.labReadings.length - 1] : null;
                const t = `*PRE-FERMENTATION — Batch #${b.batchNo} PF${b.fermenterNo}*\nPhase: ${phaseLabels[b.phase]}${b.setupTime ? '\nSetup: ' + new Date(b.setupTime).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : ''}${b.slurryVolume ? `\nLevel: ${(b.slurryVolume / (PF_VOLUME_M3 * 1000) * 100).toFixed(0)}% (${(b.slurryVolume / 1000).toFixed(0)} M³)` : ''}${b.slurryGravity ? ' | SG: ' + b.slurryGravity : ''}${b.slurryTemp ? ' | Temp: ' + b.slurryTemp + '°C' : ''}${b.dosings.length > 0 ? '\n\n*Dosing* (' + b.dosings.length + ' chemicals)\n' + dosingList : ''}${lastLab ? `\n\n*Latest Lab*\nGravity: ${lastLab.spGravity ?? '—'} | pH: ${lastLab.ph ?? '—'} | RS: ${lastLab.rs ?? '—'}%\nAlcohol: ${lastLab.alcohol ?? '—'}% | Temp: ${lastLab.temp ?? '—'}°C` : ''}${b.remarks ? '\n\nRemarks: ' + b.remarks : ''}`;
                window.open(`https://wa.me/?text=${encodeURIComponent(t)}`, '_blank');
              }} className="text-white/80 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition" title="Share on WhatsApp">
                <Share2 size={18} />
              </button>
              <span className="px-3 py-1 rounded-full text-sm font-bold text-white" style={{ backgroundColor: phaseColors[activeBatch.phase] }}>{phaseLabels[activeBatch.phase]}</span>
            </div>
          </div>
          <PhaseTimeline batch={activeBatch} />
          {phaseMsg && (
            <div className="mx-4 px-3 py-2 bg-green-50 border border-green-200 rounded text-green-700 text-sm font-medium flex items-center gap-2 animate-pulse">
              {phaseMsg}
            </div>
          )}
          <div className="p-4 space-y-4">
            {/* DOSING */}
            {['SETUP', 'DOSING', 'LAB'].includes(activeBatch.phase) && (
              <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
                <h3 className="font-semibold text-amber-800 flex items-center gap-1 mb-2"><Beaker size={16} /> Chemical Dosing</h3>
                {activeBatch.dosings.length > 0 && (
                  <table className="w-full text-sm mb-3">
                    <thead><tr className="text-xs text-gray-500"><th className="text-left py-1">Chemical</th><th className="text-right">Qty</th><th className="text-right">Unit</th><th className="text-right">Time</th><th className="text-right">T0+</th><th></th></tr></thead>
                    <tbody>{activeBatch.dosings.map(d => (
                      <tr key={d.id} className="border-t">
                        <td className="py-1">{d.chemicalName}</td><td className="text-right">{d.quantity}</td><td className="text-right">{d.unit}</td>
                        <td className="text-right text-xs text-gray-400">{new Date(d.addedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}</td>
                        <td className="text-right text-xs font-medium text-indigo-600">{elapsed(activeBatch.setupTime, d.addedAt)}</td>
                        <td className="text-right"><button onClick={() => { api.delete(`/pre-fermentation/dosing/${d.id}`); load(); }} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button></td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
                <div className="space-y-2">
                  <label className="text-xs text-gray-500">Select Chemical</label>
                  <div className="flex flex-wrap gap-1.5">
                    {chemicals.map(c => (
                      <button key={c.id} onClick={() => selectChemical(c.name)}
                        className={`px-3 py-1.5 rounded text-sm border transition-colors ${doseForm.chemicalName === c.name ? 'bg-amber-500 text-white border-amber-500 font-medium' : 'bg-white text-gray-700 border-gray-300 hover:border-amber-400 hover:bg-amber-50'}`}>
                        {c.name}
                      </button>
                    ))}
                    <button onClick={() => setShowNewChem(true)} className="px-3 py-1.5 rounded text-sm border border-dashed border-amber-400 text-amber-600 hover:bg-amber-50">+ New</button>
                  </div>
                  <div className="flex gap-2 items-end flex-wrap">
                    {numField('Quantity', doseForm.quantity, v => setDoseForm(f => ({ ...f, quantity: v })), '0.1')}
                    <div>
                      <label className="text-xs text-gray-500">Unit</label>
                      <select value={doseForm.unit} onChange={e => setDoseForm(f => ({ ...f, unit: e.target.value }))} className="border rounded px-2 py-1.5 text-sm">
                        <option value="kg">kg</option><option value="ltr">ltr</option><option value="gm">gm</option><option value="ml">ml</option>
                      </select>
                    </div>
                    <button onClick={addDosing} className="bg-amber-500 text-white px-3 py-1.5 rounded text-sm hover:bg-amber-600 mb-0.5">Add</button>
                  </div>
                  {activeBatch.dosings.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-amber-200 flex items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <Clock size={14} className="text-amber-600" />
                        <input type="datetime-local" id="dosingEndInput" defaultValue={toLocal(activeBatch.dosingEndTime) || nowLocal()}
                          className="border border-amber-300 rounded px-2 py-1.5 text-sm" />
                      </div>
                      <button onClick={() => {
                        const inp = (document.getElementById('dosingEndInput') as HTMLInputElement)?.value;
                        const dt = inp ? new Date(inp).toISOString() : new Date().toISOString();
                        advancePhase(activeBatch, 'LAB', { dosingEndTime: dt });
                      }} className="bg-emerald-600 text-white px-4 py-2 rounded text-sm hover:bg-emerald-700 font-medium">Finish Dosing → Lab</button>
                    </div>
                  )}
                </div>
                {showNewChem && (
                  <div className="mt-2 flex gap-2 items-end bg-white p-2 rounded border">
                    {txtField('Chemical Name', chemForm.name, v => setChemForm(f => ({ ...f, name: v })), 'e.g. Urea')}
                    <div>
                      <label className="text-xs text-gray-500">Unit</label>
                      <select value={chemForm.unit} onChange={e => setChemForm(f => ({ ...f, unit: e.target.value }))} className="border rounded px-2 py-1.5 text-sm">
                        <option value="kg">kg</option><option value="ltr">ltr</option><option value="gm">gm</option>
                      </select>
                    </div>
                    <button onClick={addChemical} className="bg-green-600 text-white px-3 py-1.5 rounded text-sm">Save</button>
                    <button onClick={() => setShowNewChem(false)} className="bg-gray-200 px-3 py-1.5 rounded text-sm">×</button>
                  </div>
                )}
              </div>
            )}

            {/* LAB */}
            {['SETUP', 'DOSING', 'LAB'].includes(activeBatch.phase) && (
              <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-200">
                <h3 className="font-semibold text-emerald-800 flex items-center gap-1 mb-2"><FlaskConical size={16} /> Lab Readings</h3>
                {activeBatch.labReadings.length > 0 && (
                  <div className="overflow-x-auto mb-3">
                    <table className="w-full text-sm">
                      <thead><tr className="text-xs text-gray-500">{['Date/Time', 'T0+', 'Gravity', 'pH', 'RS%', 'RST%', 'Alc%', 'DS%', 'VFA', 'Temp', 'Remarks', ''].map(h => <th key={h} className="text-left py-1 px-1">{h}</th>)}</tr></thead>
                      <tbody>{activeBatch.labReadings.map(r => (
                        <tr key={r.id} className="border-t">
                          <td className="px-1 py-1 text-xs whitespace-nowrap">{r.analysisTime ? new Date(r.analysisTime).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : r.analysisTime}</td>
                          <td className="px-1 text-xs font-medium text-indigo-600">{elapsed(activeBatch.setupTime, r.analysisTime || r.createdAt)}</td>
                          <td className="px-1">{r.spGravity ?? '-'}</td><td className="px-1">{r.ph ?? '-'}</td><td className="px-1">{r.rs ?? '-'}</td><td className="px-1">{r.rst ?? '-'}</td><td className="px-1">{r.alcohol ?? '-'}</td><td className="px-1">{r.ds ?? '-'}</td><td className="px-1">{r.vfaPpa ?? '-'}</td><td className="px-1">{r.temp ?? '-'}</td><td className="px-1 text-gray-500">{r.remarks || '-'}</td>
                          <td className="px-1"><button onClick={() => { api.delete(`/pre-fermentation/lab/${r.id}`); load(); }} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
                <LabChart readings={activeBatch.labReadings} t0={activeBatch.setupTime} />
                <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-10 gap-2 mt-3">
                  <div className="col-span-2">
                    <label className="text-xs text-gray-500">Date & Time</label>
                    <div className="flex gap-1.5 items-center">
                      <input type="datetime-local" value={labForm.analysisTime} onChange={e => setLabForm(f => ({ ...f, analysisTime: e.target.value }))} className="flex-1 border rounded px-2 py-1.5 text-sm" />
                      <button onClick={setNow} className="text-xs bg-blue-50 text-blue-600 px-2 py-1.5 rounded border border-blue-200 hover:bg-blue-100 whitespace-nowrap">Now</button>
                    </div>
                  </div>
                  {numField('Gravity', labForm.spGravity, v => setLabForm(f => ({ ...f, spGravity: v })), '0.001')}
                  {numField('pH', labForm.ph, v => setLabForm(f => ({ ...f, ph: v })), '0.01')}
                  {numField('RS%', labForm.rs, v => setLabForm(f => ({ ...f, rs: v })), '0.01')}
                  {numField('RST%', labForm.rst, v => setLabForm(f => ({ ...f, rst: v })), '0.01')}
                  {numField('Alc%', labForm.alcohol, v => setLabForm(f => ({ ...f, alcohol: v })), '0.01')}
                  {numField('DS%', labForm.ds, v => setLabForm(f => ({ ...f, ds: v })), '0.01')}
                  {numField('VFA', labForm.vfaPpa, v => setLabForm(f => ({ ...f, vfaPpa: v })), '0.01')}
                  {numField('Temp°C', labForm.temp, v => setLabForm(f => ({ ...f, temp: v })), '0.1')}
                  <div><label className="text-xs text-gray-500">Remarks</label><input value={labForm.remarks} onChange={e => setLabForm(f => ({ ...f, remarks: e.target.value }))} className="w-full border rounded px-2 py-1.5 text-sm" /></div>
                </div>
                <button onClick={addLabReading} className="mt-2 bg-emerald-600 text-white px-4 py-1.5 rounded text-sm hover:bg-emerald-700">Add Reading</button>
              </div>
            )}

            {/* PHASE ACTIONS */}
            <div className="flex gap-2 flex-wrap items-center">
              {activeBatch.phase === 'LAB' && (
                <>
                  <button onClick={() => advancePhase(activeBatch, 'DOSING')} className="bg-amber-500 text-white px-4 py-2 rounded text-sm hover:bg-amber-600 flex items-center gap-1">← Back to Dosing</button>
                  <div className="flex items-center gap-1.5">
                    <Clock size={14} className="text-blue-600" />
                    <input type="datetime-local" id="transferTimeInput" defaultValue={nowLocal()} className="border border-blue-300 rounded px-2 py-1.5 text-sm" />
                  </div>
                  <button onClick={() => {
                    const inp = (document.getElementById('transferTimeInput') as HTMLInputElement)?.value;
                    advancePhase(activeBatch, 'TRANSFER', { transferTime: inp ? new Date(inp).toISOString() : new Date().toISOString() });
                  }} className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 flex items-center gap-1"><ArrowRight size={16} /> Transfer to Fermenter</button>
                </>
              )}
              {activeBatch.phase === 'TRANSFER' && (
                <>
                  <TimeField label="Transfer Time" value={activeBatch.transferTime} field="transferTime" batchId={activeBatch.id} color="blue" />
                  <div className="flex items-center gap-1.5">
                    <Clock size={14} className="text-purple-600" />
                    <input type="datetime-local" id="cipStartInput" defaultValue={nowLocal()} className="border border-purple-300 rounded px-2 py-1.5 text-sm" />
                  </div>
                  <button onClick={() => {
                    const inp = (document.getElementById('cipStartInput') as HTMLInputElement)?.value;
                    advancePhase(activeBatch, 'CIP', { cipStartTime: inp ? new Date(inp).toISOString() : new Date().toISOString() });
                  }} className="bg-purple-600 text-white px-4 py-2 rounded text-sm hover:bg-purple-700 flex items-center gap-1"><RotateCcw size={16} /> Start CIP</button>
                </>
              )}
              {activeBatch.phase === 'CIP' && (
                <>
                  <TimeField label="CIP Start" value={activeBatch.cipStartTime} field="cipStartTime" batchId={activeBatch.id} color="purple" />
                  <div className="flex items-center gap-1.5">
                    <Clock size={14} className="text-gray-600" />
                    <input type="datetime-local" id="cipEndInput" defaultValue={nowLocal()} className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
                  </div>
                  <button onClick={() => {
                    const inp = (document.getElementById('cipEndInput') as HTMLInputElement)?.value;
                    advancePhase(activeBatch, 'DONE', { cipEndTime: inp ? new Date(inp).toISOString() : new Date().toISOString() });
                  }} className="bg-gray-600 text-white px-4 py-2 rounded text-sm hover:bg-gray-700">End CIP → Done</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* BATCH HISTORY */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b"><h2 className="font-semibold">Batch History</h2></div>
        {batches.length === 0 ? (
          <p className="p-4 text-gray-400 text-sm">No batches yet. Create one above.</p>
        ) : (
          <div className="divide-y">
            {batches.map(b => (
              <div key={b.id} className={`${b.id === activeBatch?.id ? 'bg-indigo-50' : ''}`}>
                <div className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50" onClick={() => setExpandedBatch(expandedBatch === b.id ? null : b.id)}>
                  <div className="flex items-center gap-3">
                    <span className="font-bold">#{b.batchNo}</span>
                    <span className="text-sm text-gray-500">PF{b.fermenterNo}</span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium text-white" style={{ backgroundColor: phaseColors[b.phase] }}>{phaseLabels[b.phase]}</span>
                    <span className="text-xs text-gray-400">{new Date(b.createdAt).toLocaleDateString('en-IN')}</span>
                    <span className="text-xs text-gray-400">{b.dosings.length} chemicals • {b.labReadings.length} readings</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {b.phase !== 'DONE' && b.id !== activeBatch?.id && (
                      <button onClick={e => { e.stopPropagation(); setActiveBatchId(b.id); }} className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-200">Select</button>
                    )}
                    <button onClick={e => { e.stopPropagation(); deleteBatch(b.id); }} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                    {expandedBatch === b.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </div>
                {expandedBatch === b.id && (
                  <div className="px-4 pb-4 space-y-3">
                    <PhaseTimeline batch={b} showDurations={true} />
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                      <div><span className="text-gray-500">PF Level:</span> {b.slurryVolume ? `${(b.slurryVolume / (PF_VOLUME_M3 * 1000) * 100).toFixed(0)}% (${(b.slurryVolume / 1000).toFixed(0)} M³)` : '-'}</div>
                      <div><span className="text-gray-500">Gravity:</span> {b.slurryGravity ?? '-'}</div>
                      <div><span className="text-gray-500">Temp:</span> {b.slurryTemp ?? '-'}°C</div>
                      <div><span className="text-gray-500">Transfer Vol:</span> {b.transferVolume ?? '-'} L</div>
                    </div>
                    {/* Time tracking */}
                    <div className="flex flex-wrap gap-x-5 gap-y-1 mt-1">
                      <TimeField label="Setup" value={b.setupTime} field="setupTime" batchId={b.id} color="indigo" />
                      {b.dosingEndTime && <TimeField label="Dosing Done" value={b.dosingEndTime} field="dosingEndTime" batchId={b.id} color="amber" />}
                      {b.transferTime && <TimeField label="Transfer" value={b.transferTime} field="transferTime" batchId={b.id} color="blue" />}
                      {b.cipStartTime && <TimeField label="CIP Start" value={b.cipStartTime} field="cipStartTime" batchId={b.id} color="purple" />}
                      {b.cipEndTime && <TimeField label="CIP End" value={b.cipEndTime} field="cipEndTime" batchId={b.id} color="gray" />}
                    </div>
                    {b.dosings.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-gray-500 mb-1">Dosing</h4>
                        <div className="flex flex-wrap gap-2">{b.dosings.map(d => (
                          <span key={d.id} className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded">
                            {d.chemicalName}: {d.quantity} {d.unit}
                            <span className="text-amber-500 ml-1">{new Date(d.addedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                            <span className="text-indigo-500 ml-1">{elapsed(b.setupTime, d.addedAt)}</span>
                          </span>
                        ))}</div>
                      </div>
                    )}
                    {b.labReadings.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-gray-500 mb-1">Lab Readings</h4>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead><tr className="text-gray-500">{['Date/Time', 'T0+', 'SG', 'pH', 'RS%', 'RST%', 'Alc%', 'DS%', 'VFA', 'Temp'].map(h => <th key={h} className="text-left px-1 py-0.5">{h}</th>)}</tr></thead>
                            <tbody>{b.labReadings.map(r => (
                              <tr key={r.id} className="border-t">
                                <td className="px-1 py-0.5 whitespace-nowrap">{r.analysisTime ? new Date(r.analysisTime).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : r.analysisTime}</td><td className="px-1 font-medium text-indigo-600">{elapsed(b.setupTime, r.analysisTime || r.createdAt)}</td><td className="px-1">{r.spGravity ?? '-'}</td><td className="px-1">{r.ph ?? '-'}</td><td className="px-1">{r.rs ?? '-'}</td><td className="px-1">{r.rst ?? '-'}</td><td className="px-1">{r.alcohol ?? '-'}</td><td className="px-1">{r.ds ?? '-'}</td><td className="px-1">{r.vfaPpa ?? '-'}</td><td className="px-1">{r.temp ?? '-'}</td>
                              </tr>
                            ))}</tbody>
                          </table>
                        </div>
                        <LabChart readings={b.labReadings} t0={b.setupTime} />
                      </div>
                    )}
                    {b.remarks && <p className="text-sm text-gray-500">Remarks: {b.remarks}</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
