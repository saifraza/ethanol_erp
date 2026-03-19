import { useState, useEffect, useCallback } from 'react';
import { Plus, Beaker, FlaskConical, RefreshCw, ArrowRight, Pencil, Check, X, Send, CheckCircle, AlertTriangle, ChevronDown, ChevronUp, Share2, Cylinder, Trash2 } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

/* ═══════ TYPES ═══════ */
interface PFBatch {
  id: string; batchNo: number; fermenterNo: number; phase: string;
  setupTime: string | null; slurryGravity: number | null; slurryTemp: number | null;
  slurryVolume: number | null; dosingEndTime: string | null; transferTime: string | null;
  dosings: any[]; labReadings: any[]; createdAt: string;
  lastGravity: number | null; readyToTransfer: boolean; gravityTarget: number;
}
interface FermBatch {
  id: string; batchNo: number; fermenterNo: number; phase: string;
  fermLevel: number | null; volume: number | null; setupGravity: number | null;
  dosings: any[]; createdAt: string; lastLab: any | null; labReadings: any[];
  fillingStartTime: string | null;
}

const PF_COUNT = 2;
const FERM_COUNT = 4;
const phaseColor: Record<string, string> = {
  SETUP: '#6366f1', DOSING: '#f59e0b', LAB: '#10b981', TRANSFER: '#3b82f6',
  CIP: '#8b5cf6', DONE: '#9ca3af', PF_TRANSFER: '#3b82f6', FILLING: '#6366f1',
  REACTION: '#f59e0b', RETENTION: '#ef4444',
};

const fmtTime = (s: string | null) => s ? new Date(s).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '-';
const fmtDateTime = (s: string | null) => s ? new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '-';

/* ═══════ WHATSAPP SHARE ═══════ */
function shareWhatsApp(text: string) {
  if (navigator.share) {
    navigator.share({ text }).catch(() => {
      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
    });
  } else {
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
  }
}

function buildPFShareText(batch: PFBatch): string {
  const lines = [`*PF-${batch.fermenterNo} — Batch #${batch.batchNo}*`, `Phase: ${batch.phase}`];
  if (batch.slurryGravity) lines.push(`Setup SG: ${batch.slurryGravity}`);
  if (batch.slurryTemp) lines.push(`Setup Temp: ${batch.slurryTemp}°C`);
  if (batch.dosings.length) {
    lines.push(`\n*Dosing (${batch.dosings.length}):*`);
    batch.dosings.forEach((d: any) => lines.push(`  ${d.chemicalName}: ${d.quantity} ${d.unit}`));
  }
  if (batch.labReadings.length) {
    lines.push(`\n*Lab Readings (${batch.labReadings.length}):*`);
    batch.labReadings.forEach((r: any) => {
      const parts = [fmtTime(r.analysisTime)];
      if (r.spGravity != null) parts.push(`SG:${r.spGravity}`);
      if (r.ph != null) parts.push(`pH:${r.ph}`);
      if (r.alcohol != null) parts.push(`Alc:${r.alcohol}%`);
      if (r.temp != null) parts.push(`T:${r.temp}°C`);
      lines.push(`  ${parts.join(' | ')}`);
    });
  }
  if (batch.readyToTransfer) lines.push(`\n✅ READY TO TRANSFER`);
  return lines.join('\n');
}

function buildFermShareText(batch: FermBatch): string {
  const lines = [`*F-${batch.fermenterNo} — Batch #${batch.batchNo}*`, `Phase: ${batch.phase}`];
  if (batch.fermLevel != null) lines.push(`Level: ${batch.fermLevel}%`);
  if (batch.setupGravity != null) lines.push(`Setup SG: ${batch.setupGravity}`);
  const readings = batch.labReadings || [];
  if (readings.length) {
    lines.push(`\n*Lab Readings (${readings.length}):*`);
    readings.forEach((r: any) => {
      const parts = [fmtTime(r.analysisTime)];
      if (r.level != null) parts.push(`Lvl:${r.level}%`);
      if (r.spGravity != null) parts.push(`SG:${r.spGravity}`);
      if (r.ph != null) parts.push(`pH:${r.ph}`);
      if (r.alcohol != null) parts.push(`Alc:${r.alcohol}%`);
      if (r.temp != null) parts.push(`T:${r.temp}°C`);
      if (r.status === 'FIELD') parts.push('(field)');
      lines.push(`  ${parts.join(' | ')}`);
    });
  }
  return lines.join('\n');
}

export default function Fermentation() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [tab, setTab] = useState<'field' | 'lab'>('field');
  const [pfBatches, setPfBatches] = useState<PFBatch[]>([]);
  const [fermBatches, setFermBatches] = useState<FermBatch[]>([]);
  const [chemicals, setChemicals] = useState<any[]>([]);
  const [pfRecipes, setPfRecipes] = useState<any[]>([]);
  const [beerWell, setBeerWell] = useState<any>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const [loading, setLoading] = useState(true);

  const flash = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    try {
      const [ov, ch, rec] = await Promise.all([
        api.get('/fermentation/overview'),
        api.get('/pre-fermentation/chemicals'),
        api.get('/dosing-recipes/PF'),
      ]);
      setPfBatches(ov.data.pfBatches || []);
      setFermBatches(ov.data.fermBatches || []);
      setBeerWell(ov.data.beerWell || null);
      setChemicals(ch.data || []);
      setPfRecipes(rec.data || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const pfFor = (no: number) => pfBatches.find(b => b.fermenterNo === no);
  const fermFor = (no: number) => fermBatches.find(b => b.fermenterNo === no);

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-lg shadow-lg text-white text-sm flex items-center gap-2 ${toast.type === 'ok' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.type === 'ok' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
          {toast.msg}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">Fermentation</h1>
        <button onClick={() => { setLoading(true); load(); }} className="text-gray-400 hover:text-gray-600 p-2">
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex bg-gray-100 rounded-lg p-1">
        <button onClick={() => setTab('field')} className={`flex-1 py-2.5 rounded-md text-sm font-medium transition ${tab === 'field' ? 'bg-white shadow text-gray-800' : 'text-gray-500'}`}>
          Field
        </button>
        <button onClick={() => setTab('lab')} className={`flex-1 py-2.5 rounded-md text-sm font-medium transition ${tab === 'lab' ? 'bg-white shadow text-gray-800' : 'text-gray-500'}`}>
          Lab
        </button>
      </div>

      {tab === 'field' && <FieldTab pfBatches={pfBatches} fermBatches={fermBatches} chemicals={chemicals} pfRecipes={pfRecipes} isAdmin={isAdmin} onRefresh={load} flash={flash} pfFor={pfFor} fermFor={fermFor} beerWell={beerWell} />}
      {tab === 'lab' && <LabTab pfBatches={pfBatches} fermBatches={fermBatches} onRefresh={load} flash={flash} pfFor={pfFor} fermFor={fermFor} beerWell={beerWell} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   FIELD TAB
   ═══════════════════════════════════════════════════════ */
function FieldTab({ pfBatches, fermBatches, chemicals, pfRecipes, isAdmin, onRefresh, flash, pfFor, fermFor, beerWell }: any) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dosingOpen, setDosingOpen] = useState(false);
  const [showNewPF, setShowNewPF] = useState<number | null>(null);
  const [nbForm, setNbForm] = useState({ batchNo: '', pfLevel: '', slurryGravity: '', slurryTemp: '', remarks: '' });
  const [doseForm, setDoseForm] = useState({ chemicalName: '', quantity: '', unit: 'kg' });
  const [editDoseId, setEditDoseId] = useState<string | null>(null);
  const [editDoseQty, setEditDoseQty] = useState('');
  const [transferModal, setTransferModal] = useState<PFBatch | null>(null);
  const [transferFermNo, setTransferFermNo] = useState('1');
  const [transferring, setTransferring] = useState(false);

  // Fermenter field input
  const [fermFieldForm, setFermFieldForm] = useState<Record<string, string>>({});
  const [fermFieldSaving, setFermFieldSaving] = useState(false);

  // Beer well field input
  const [bwForm, setBwForm] = useState<Record<string, string>>({});
  const [bwSaving, setBwSaving] = useState(false);
  const [bwExpanded, setBwExpanded] = useState(false);

  const submitBeerWell = async () => {
    const hasVal = bwForm.level?.trim() || bwForm.temp?.trim() || bwForm.spGravity?.trim() || bwForm.alcohol?.trim();
    if (!hasVal) { flash('Enter at least one value', 'err'); return; }
    setBwSaving(true);
    try {
      await api.post('/fermentation/beer-well', bwForm);
      flash('Beer Well reading saved');
      setBwForm({});
      onRefresh();
    } catch (e: any) { flash(e?.response?.data?.error || 'Failed', 'err'); }
    finally { setBwSaving(false); }
  };

  useEffect(() => {
    if (showNewPF) {
      api.get('/fermentation/next-batch').then(r => setNbForm(f => ({ ...f, batchNo: String(r.data.nextBatchNo) }))).catch(() => {});
    }
  }, [showNewPF]);

  const createBatch = async (pfNo: number) => {
    try {
      const lvl = parseFloat(nbForm.pfLevel);
      const slurryVolume = nbForm.pfLevel && !isNaN(lvl) ? (lvl / 100 * 450 * 1000).toFixed(0) : '';
      await api.post('/pre-fermentation/batches', {
        batchNo: nbForm.batchNo, fermenterNo: String(pfNo), pfLevel: nbForm.pfLevel,
        slurryGravity: nbForm.slurryGravity, slurryTemp: nbForm.slurryTemp,
        slurryVolume, setupTime: new Date().toISOString(), remarks: nbForm.remarks,
      });
      setShowNewPF(null);
      setNbForm({ batchNo: '', pfLevel: '', slurryGravity: '', slurryTemp: '', remarks: '' });
      flash('Batch created!');
      onRefresh();
    } catch (e: any) { flash(e?.response?.data?.error || 'Failed', 'err'); }
  };

  const addDosing = async (batchId: string) => {
    if (!doseForm.chemicalName || !doseForm.quantity) return;
    try {
      await api.post(`/pre-fermentation/batches/${batchId}/dosing`, doseForm);
      setDoseForm(f => ({ ...f, quantity: '' }));
      onRefresh();
    } catch {}
  };

  const applyRecipe = async (batchId: string) => {
    try {
      for (const r of pfRecipes) {
        await api.post(`/pre-fermentation/batches/${batchId}/dosing`, {
          chemicalName: r.chemicalName, quantity: String(r.quantity), unit: r.unit
        });
      }
      flash('Recipe applied!');
      onRefresh();
    } catch {}
  };

  const saveDoseQty = async (id: string) => {
    if (!editDoseQty.trim()) return;
    try {
      await api.patch(`/pre-fermentation/dosing/${id}`, { quantity: editDoseQty });
      setEditDoseId(null);
      onRefresh();
    } catch {}
  };

  const doTransfer = async () => {
    if (!transferModal || transferring) return;
    setTransferring(true);
    try {
      await api.post('/fermentation/transfer-pf', { pfBatchId: transferModal.id, fermenterNo: parseInt(transferFermNo) });
      setTransferModal(null);
      flash(`Transferred PF-${transferModal.fermenterNo} → F-${transferFermNo}!`);
      await onRefresh();
    } catch (e: any) { flash(e?.response?.data?.error || 'Transfer failed', 'err'); }
    finally { setTransferring(false); }
  };

  const advancePF = async (batch: PFBatch, phase: string, extra?: any) => {
    try {
      await api.patch(`/pre-fermentation/batches/${batch.id}`, { phase, ...extra });
      onRefresh();
    } catch {}
  };

  const advanceFerm = async (batch: FermBatch, phase: string, extra?: any) => {
    try {
      await api.patch(`/fermentation/batches/${batch.id}`, { phase, ...extra });
      onRefresh();
    } catch {}
  };

  const deletePFBatch = async (batch: PFBatch) => {
    if (!confirm(`Delete PF-${batch.fermenterNo} Batch #${batch.batchNo}?`)) return;
    try {
      await api.delete(`/pre-fermentation/batches/${batch.id}`);
      flash(`PF Batch #${batch.batchNo} deleted`);
      onRefresh();
    } catch (e: any) { flash(e?.response?.data?.error || 'Delete failed', 'err'); }
  };

  const deleteFermBatch = async (batch: FermBatch) => {
    if (!confirm(`Delete F-${batch.fermenterNo} Batch #${batch.batchNo}?`)) return;
    try {
      await api.delete(`/fermentation/batches/${batch.id}`);
      flash(`Ferm Batch #${batch.batchNo} deleted`);
      onRefresh();
    } catch (e: any) { flash(e?.response?.data?.error || 'Delete failed', 'err'); }
  };

  const submitFermField = async (fermNo: number) => {
    const hasVal = fermFieldForm.level?.trim() || fermFieldForm.temp?.trim() || fermFieldForm.spGravity?.trim();
    if (!hasVal) { flash('Enter at least one value', 'err'); return; }
    setFermFieldSaving(true);
    try {
      await api.post('/fermentation/field-reading', { fermenterNo: fermNo, ...fermFieldForm });
      flash(`Saved field reading for F-${fermNo}`);
      setFermFieldForm({});
      onRefresh();
    } catch (e: any) { flash(e?.response?.data?.error || 'Failed', 'err'); }
    finally { setFermFieldSaving(false); }
  };

  const toggle = (key: string) => {
    setExpanded(expanded === key ? null : key);
    setDosingOpen(false);
    setFermFieldForm({});
  };

  /* ─── Delete helpers ─── */
  const deleteLabReading = async (id: string, type: 'ferm' | 'pf') => {
    if (!confirm('Delete this reading?')) return;
    try {
      const url = type === 'pf' ? `/pre-fermentation/lab/${id}` : `/fermentation/${id}`;
      await api.delete(url);
      flash('Reading deleted');
      onRefresh();
    } catch (e: any) { flash(e?.response?.data?.error || 'Delete failed', 'err'); }
  };

  const deleteDosing = async (id: string, type: 'ferm' | 'pf') => {
    if (!confirm('Delete this dosing?')) return;
    try {
      const url = type === 'pf' ? `/pre-fermentation/dosing/${id}` : `/fermentation/dosing/${id}`;
      await api.delete(url);
      flash('Dosing deleted');
      onRefresh();
    } catch (e: any) { flash(e?.response?.data?.error || 'Delete failed', 'err'); }
  };

  /* ─── Edit lab reading ─── */
  const [editReadingId, setEditReadingId] = useState<string | null>(null);
  const [editReadingData, setEditReadingData] = useState<any>({});

  const startEditReading = (r: any) => {
    setEditReadingId(r.id);
    setEditReadingData({ level: r.level ?? '', spGravity: r.spGravity ?? '', ph: r.ph ?? '', alcohol: r.alcohol ?? '', temp: r.temp ?? '', rs: r.rs ?? '' });
  };

  const saveEditReading = async (id: string, type: 'ferm' | 'pf') => {
    try {
      const url = type === 'pf' ? `/pre-fermentation/lab/${id}` : `/fermentation/${id}`;
      await api.put(url, editReadingData);
      flash('Reading updated');
      setEditReadingId(null);
      onRefresh();
    } catch (e: any) { flash(e?.response?.data?.error || 'Update failed', 'err'); }
  };

  /* ─── Lab readings table (shared) ─── */
  const LabTable = ({ readings, showLevel, type }: { readings: any[]; showLevel?: boolean; type: 'ferm' | 'pf' }) => {
    if (!readings.length) return <p className="text-xs text-gray-400 italic">No lab readings yet</p>;
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-gray-500">
            <th className="text-left py-1 px-1">Time</th>
            {showLevel && <th className="text-left py-1 px-1">Lvl</th>}
            <th className="text-left py-1 px-1">SG</th>
            <th className="text-left py-1 px-1">pH</th>
            <th className="text-left py-1 px-1">Alc%</th>
            <th className="text-left py-1 px-1">T°C</th>
            <th className="text-left py-1 px-1">RS</th>
            <th className="text-right py-1 px-1">Actions</th>
          </tr></thead>
          <tbody>{readings.map((r: any, i: number) => (
            editReadingId === r.id ? (
              /* ── Inline edit row ── */
              <tr key={r.id} className="border-t bg-yellow-50">
                <td className="px-1 py-1 whitespace-nowrap text-gray-400">{fmtTime(r.analysisTime)}</td>
                {showLevel && <td className="px-1"><input type="number" step="0.1" value={editReadingData.level} onChange={e => setEditReadingData((d: any) => ({ ...d, level: e.target.value }))} className="w-12 border rounded px-1 py-0.5 text-xs text-center" /></td>}
                <td className="px-1"><input type="number" step="0.001" value={editReadingData.spGravity} onChange={e => setEditReadingData((d: any) => ({ ...d, spGravity: e.target.value }))} className="w-14 border rounded px-1 py-0.5 text-xs text-center" /></td>
                <td className="px-1"><input type="number" step="0.1" value={editReadingData.ph} onChange={e => setEditReadingData((d: any) => ({ ...d, ph: e.target.value }))} className="w-12 border rounded px-1 py-0.5 text-xs text-center" /></td>
                <td className="px-1"><input type="number" step="0.1" value={editReadingData.alcohol} onChange={e => setEditReadingData((d: any) => ({ ...d, alcohol: e.target.value }))} className="w-12 border rounded px-1 py-0.5 text-xs text-center" /></td>
                <td className="px-1"><input type="number" step="0.1" value={editReadingData.temp} onChange={e => setEditReadingData((d: any) => ({ ...d, temp: e.target.value }))} className="w-12 border rounded px-1 py-0.5 text-xs text-center" /></td>
                <td className="px-1"><input type="number" step="0.1" value={editReadingData.rs} onChange={e => setEditReadingData((d: any) => ({ ...d, rs: e.target.value }))} className="w-12 border rounded px-1 py-0.5 text-xs text-center" /></td>
                <td className="px-1 text-right whitespace-nowrap">
                  <button onClick={() => saveEditReading(r.id, type)} className="text-green-600 hover:text-green-800 p-1"><Check size={14} /></button>
                  <button onClick={() => setEditReadingId(null)} className="text-gray-400 hover:text-gray-600 p-1"><X size={14} /></button>
                </td>
              </tr>
            ) : (
              /* ── Normal row ── */
              <tr key={r.id || i} className="border-t">
                <td className="px-1 py-1 whitespace-nowrap">{fmtTime(r.analysisTime)}{r.status === 'FIELD' ? <span className="text-[9px] text-blue-500 ml-0.5">F</span> : ''}</td>
                {showLevel && <td className="px-1">{r.level ?? '-'}</td>}
                <td className="px-1">{r.spGravity ?? '-'}</td>
                <td className="px-1">{r.ph ?? '-'}</td>
                <td className="px-1">{r.alcohol ?? '-'}</td>
                <td className="px-1">{r.temp ?? '-'}</td>
                <td className="px-1">{r.rs ?? '-'}</td>
                <td className="px-1 text-right whitespace-nowrap">
                  {r.id && (
                    <>
                      <button onClick={() => startEditReading(r)} className="text-blue-400 hover:text-blue-600 p-1" title="Edit"><Pencil size={12} /></button>
                      <button onClick={() => deleteLabReading(r.id, type)} className="text-red-400 hover:text-red-600 p-1" title="Delete"><Trash2 size={12} /></button>
                    </>
                  )}
                </td>
              </tr>
            )
          ))}</tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* ─── PF VESSELS ─── */}
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Pre-Fermenters</h2>
      {Array.from({ length: PF_COUNT }, (_, i) => i + 1).map(no => {
        const batch = pfFor(no);
        const key = `pf-${no}`;
        const isOpen = expanded === key;
        return (
          <div key={key} className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="flex items-center justify-between p-3 cursor-pointer" onClick={() => batch && toggle(key)}>
              <div className="flex items-center gap-2">
                <Beaker size={18} className="text-indigo-600" />
                <span className="font-bold">PF-{no}</span>
                {batch ? (
                  <>
                    <span className="text-xs px-2 py-0.5 rounded-full text-white font-medium" style={{ backgroundColor: phaseColor[batch.phase] }}>{batch.phase}</span>
                    <span className="text-xs text-gray-500">#{batch.batchNo}</span>
                  </>
                ) : <span className="text-xs text-gray-400">Idle</span>}
              </div>
              <div className="flex items-center gap-2">
                {batch?.readyToTransfer && <span className="text-xs bg-green-500 text-white px-2 py-0.5 rounded font-medium animate-pulse">Ready!</span>}
                {batch ? (isOpen ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />) : (
                  <button onClick={(e) => { e.stopPropagation(); setShowNewPF(no); }} className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-medium"><Plus size={12} className="inline -mt-0.5" /> Start</button>
                )}
              </div>
            </div>

            {/* Collapsed summary */}
            {batch && !isOpen && (
              <div className="px-3 pb-2 flex gap-3 text-xs text-gray-500">
                {batch.lastGravity != null && <span>SG: <b className="text-gray-700">{batch.lastGravity}</b></span>}
                {batch.slurryTemp != null && <span>Temp: <b className="text-gray-700">{batch.slurryTemp}°C</b></span>}
                <span>{batch.dosings.length} chem</span>
                <span>{batch.labReadings.length} readings</span>
              </div>
            )}

            {/* Expanded */}
            {batch && isOpen && (
              <div className="border-t p-3 space-y-3">
                <div className="flex gap-4 text-sm text-gray-600 flex-wrap">
                  {batch.slurryVolume && <span>Level: {(batch.slurryVolume / (450 * 1000) * 100).toFixed(0)}%</span>}
                  {batch.slurryGravity && <span>SG: {batch.slurryGravity}</span>}
                  {batch.slurryTemp && <span>Temp: {batch.slurryTemp}°C</span>}
                </div>

                {/* Dosing — collapsible */}
                {['SETUP', 'DOSING', 'LAB'].includes(batch.phase) && (
                  <div className="bg-amber-50 rounded-lg overflow-hidden">
                    <button className="w-full flex items-center justify-between p-2.5 text-sm font-semibold text-amber-800" onClick={() => setDosingOpen(!dosingOpen)}>
                      <span>Dosing · {batch.dosings.length} chemicals</span>
                      {dosingOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    {dosingOpen && (
                      <div className="px-2.5 pb-2.5 space-y-2">
                        {batch.dosings.length === 0 && pfRecipes.length > 0 && (
                          <button onClick={() => applyRecipe(batch.id)} className="text-xs bg-amber-500 text-white px-3 py-1.5 rounded">Apply Recipe</button>
                        )}
                        {batch.dosings.length > 0 && (
                          <div className="space-y-1">
                            {batch.dosings.map((d: any) => (
                              <div key={d.id} className="flex items-center justify-between text-sm">
                                <span className="text-gray-700">{d.chemicalName}</span>
                                {editDoseId === d.id ? (
                                  <span className="flex items-center gap-1">
                                    <input type="number" step="0.1" value={editDoseQty} onChange={e => setEditDoseQty(e.target.value)}
                                      className="w-16 border rounded px-1.5 py-0.5 text-sm text-right" autoFocus
                                      onKeyDown={e => { if (e.key === 'Enter') saveDoseQty(d.id); if (e.key === 'Escape') setEditDoseId(null); }} />
                                    <span className="text-xs text-gray-400">{d.unit}</span>
                                    <button onClick={() => saveDoseQty(d.id)} className="text-green-600"><Check size={14} /></button>
                                    <button onClick={() => setEditDoseId(null)} className="text-gray-400"><X size={14} /></button>
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1.5">
                                    <span className="flex items-center gap-1 cursor-pointer" onClick={() => { setEditDoseId(d.id); setEditDoseQty(String(d.quantity)); }}>
                                      <b className="text-amber-700">{d.quantity}</b> <span className="text-xs text-gray-400">{d.unit}</span>
                                      <Pencil size={10} className="text-amber-400" />
                                    </span>
                                    <button onClick={() => deleteDosing(d.id, 'pf')} className="text-red-300 hover:text-red-600"><Trash2 size={11} /></button>
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="flex gap-1.5 flex-wrap">
                          <select value={doseForm.chemicalName} onChange={e => setDoseForm(f => ({ ...f, chemicalName: e.target.value }))} className="border rounded px-2 py-1.5 text-xs flex-1 min-w-0">
                            <option value="">Chemical...</option>
                            {chemicals.map((c: any) => <option key={c.id} value={c.name}>{c.name}</option>)}
                          </select>
                          <input type="number" step="0.1" placeholder="Qty" value={doseForm.quantity} onChange={e => setDoseForm(f => ({ ...f, quantity: e.target.value }))}
                            className="border rounded px-2 py-1.5 text-xs w-16" inputMode="decimal" />
                          <select value={doseForm.unit} onChange={e => setDoseForm(f => ({ ...f, unit: e.target.value }))} className="border rounded px-1 py-1.5 text-xs w-14">
                            <option value="kg">kg</option><option value="ltr">ltr</option><option value="gm">gm</option>
                          </select>
                          <button onClick={() => addDosing(batch.id)} className="bg-amber-500 text-white px-3 py-1.5 rounded text-xs font-medium">Add</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Lab readings — all readings */}
                <div className="bg-emerald-50 rounded-lg p-2.5">
                  <h4 className="text-xs font-semibold text-emerald-800 mb-1.5">Lab Readings ({batch.labReadings.length})</h4>
                  <LabTable readings={batch.labReadings} type="pf" />
                </div>

                {/* Actions + Share */}
                <div className="flex gap-2 flex-wrap">
                  {batch.phase === 'DOSING' && batch.dosings.length > 0 && (
                    <button onClick={() => advancePF(batch, 'LAB', { dosingEndTime: new Date().toISOString() })}
                      className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium">Done Dosing</button>
                  )}
                  {['SETUP', 'DOSING', 'LAB'].includes(batch.phase) && (batch.phase === 'LAB' || batch.readyToTransfer) && (
                    <button onClick={() => { setTransferModal(batch); setTransferFermNo('1'); }}
                      className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1">
                      <ArrowRight size={16} /> Transfer
                    </button>
                  )}
                  {(batch.phase === 'TRANSFER' || batch.phase === 'CIP') && (
                    <button onClick={() => advancePF(batch, 'DONE', { cipStartTime: new Date().toISOString(), cipEndTime: new Date().toISOString() })}
                      className="bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium">CIP Done</button>
                  )}
                  <button onClick={() => shareWhatsApp(buildPFShareText(batch))}
                    className="bg-green-600 text-white px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1 ml-auto">
                    <Share2 size={14} /> Share
                  </button>
                  <button onClick={() => deletePFBatch(batch)}
                    className="bg-red-100 text-red-600 px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1 hover:bg-red-200">
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* ─── FERMENTER VESSELS ─── */}
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mt-4">Fermenters</h2>
      {Array.from({ length: FERM_COUNT }, (_, i) => i + 1).map(no => {
        const batch = fermFor(no);
        const key = `ferm-${no}`;
        const isOpen = expanded === key;
        const lab = batch?.lastLab;
        const readings = batch?.labReadings || [];
        return (
          <div key={key} className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="flex items-center justify-between p-3 cursor-pointer" onClick={() => batch && toggle(key)}>
              <div className="flex items-center gap-2">
                <FlaskConical size={18} className="text-emerald-600" />
                <span className="font-bold">F-{no}</span>
                {batch ? (
                  <>
                    <span className="text-xs px-2 py-0.5 rounded-full text-white font-medium" style={{ backgroundColor: phaseColor[batch.phase] }}>{batch.phase}</span>
                    <span className="text-xs text-gray-500">#{batch.batchNo}</span>
                  </>
                ) : <span className="text-xs text-gray-400">Idle</span>}
              </div>
              {batch && (isOpen ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />)}
            </div>

            {/* Collapsed summary */}
            {batch && !isOpen && (
              <div className="px-3 pb-2 flex gap-3 text-xs text-gray-500">
                {batch.fermLevel != null && <span>Level: <b className="text-gray-700">{batch.fermLevel}%</b></span>}
                {lab?.spGravity != null && <span>SG: <b className="text-gray-700">{lab.spGravity}</b></span>}
                {lab?.alcohol != null && <span>Alc: <b className="text-gray-700">{lab.alcohol}%</b></span>}
                {lab?.temp != null && <span className={lab.temp > 37 ? 'text-red-600 font-bold' : ''}>T: <b>{lab.temp}°C</b></span>}
              </div>
            )}

            {/* Expanded */}
            {batch && isOpen && (
              <div className="border-t p-3 space-y-3">
                <div className="flex gap-4 text-sm text-gray-600 flex-wrap">
                  {batch.fermLevel != null && <span>Level: {batch.fermLevel}%</span>}
                  {batch.setupGravity != null && <span>Setup SG: {batch.setupGravity}</span>}
                  {batch.fillingStartTime && <span>Started: {fmtDateTime(batch.fillingStartTime)}</span>}
                </div>

                {/* Field input — level, temp, gravity */}
                {['FILLING', 'REACTION', 'RETENTION'].includes(batch.phase) && (
                  <div className="bg-blue-50 rounded-lg p-2.5">
                    <h4 className="text-xs font-semibold text-blue-700 mb-2">Field Reading</h4>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[10px] text-blue-600 block">Level %</label>
                        <input type="number" step="0.1" placeholder="80" value={fermFieldForm.level || ''}
                          onChange={e => setFermFieldForm(f => ({ ...f, level: e.target.value }))}
                          className="w-full border border-blue-200 rounded px-2 py-1.5 text-sm bg-white" inputMode="decimal" />
                      </div>
                      <div>
                        <label className="text-[10px] text-orange-600 block">Temp °C</label>
                        <input type="number" step="0.1" placeholder="32" value={fermFieldForm.temp || ''}
                          onChange={e => setFermFieldForm(f => ({ ...f, temp: e.target.value }))}
                          className="w-full border border-orange-200 rounded px-2 py-1.5 text-sm bg-white" inputMode="decimal" />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-600 block">Gravity</label>
                        <input type="number" step="0.001" placeholder="1.02" value={fermFieldForm.spGravity || ''}
                          onChange={e => setFermFieldForm(f => ({ ...f, spGravity: e.target.value }))}
                          className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm bg-white" inputMode="decimal" />
                      </div>
                    </div>
                    <button onClick={() => submitFermField(no)} disabled={fermFieldSaving}
                      className="mt-2 w-full bg-blue-600 text-white py-2 rounded-lg text-xs font-medium disabled:opacity-50">
                      {fermFieldSaving ? 'Saving...' : 'Save Field Reading'}
                    </button>
                  </div>
                )}

                {/* Lab readings — all */}
                <div className="bg-emerald-50 rounded-lg p-2.5">
                  <h4 className="text-xs font-semibold text-emerald-800 mb-1.5">Lab Readings ({readings.length})</h4>
                  <LabTable readings={readings} showLevel type="ferm" />
                </div>

                {/* Phase controls + Share */}
                <div className="flex gap-2 flex-wrap">
                  {batch.phase === 'FILLING' && (
                    <button onClick={() => advanceFerm(batch, 'REACTION', { fillingEndTime: new Date().toISOString(), reactionStartTime: new Date().toISOString() })}
                      className="bg-amber-500 text-white px-4 py-2 rounded-lg text-sm font-medium">Start Reaction</button>
                  )}
                  {batch.phase === 'REACTION' && (
                    <button onClick={() => advanceFerm(batch, 'RETENTION', { retentionStartTime: new Date().toISOString() })}
                      className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-medium">Start Retention</button>
                  )}
                  {batch.phase === 'RETENTION' && (
                    <button onClick={() => advanceFerm(batch, 'TRANSFER', { transferTime: new Date().toISOString() })}
                      className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1">
                      <ArrowRight size={16} /> Transfer to BW
                    </button>
                  )}
                  {(batch.phase === 'TRANSFER' || batch.phase === 'CIP') && (
                    <button onClick={() => advanceFerm(batch, 'DONE', { cipStartTime: new Date().toISOString(), cipEndTime: new Date().toISOString() })}
                      className="bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium">CIP Done</button>
                  )}
                  <button onClick={() => shareWhatsApp(buildFermShareText(batch))}
                    className="bg-green-600 text-white px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1 ml-auto">
                    <Share2 size={14} /> Share
                  </button>
                  <button onClick={() => deleteFermBatch(batch)}
                    className="bg-red-100 text-red-600 px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1 hover:bg-red-200">
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* ─── BEER WELL ─── */}
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mt-4">Beer Well</h2>
      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="flex items-center justify-between p-3 cursor-pointer" onClick={() => setBwExpanded(!bwExpanded)}>
          <div className="flex items-center gap-2">
            <Cylinder size={18} className="text-amber-600" />
            <span className="font-bold">Beer Well</span>
            {beerWell?.latest && (
              <span className="text-xs text-gray-500">
                Level: <b className="text-amber-700">{beerWell.latest.level ?? '-'}%</b>
                {beerWell.latest.alcohol != null && <> | Alc: <b className="text-amber-700">{beerWell.latest.alcohol}%</b></>}
              </span>
            )}
          </div>
          {bwExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
        </div>

        {/* Collapsed summary */}
        {!bwExpanded && beerWell?.recentBatches?.length > 0 && (
          <div className="px-3 pb-2 flex gap-3 text-xs text-gray-500">
            {beerWell.recentBatches.slice(0, 3).map((b: any) => (
              <span key={b.batchNo}>F-{b.fermenterNo} #{b.batchNo} {b.finalAlcohol ? `(${b.finalAlcohol}%)` : ''}</span>
            ))}
          </div>
        )}

        {/* Expanded */}
        {bwExpanded && (
          <div className="border-t p-3 space-y-3">
            {/* Field input */}
            <div className="bg-amber-50 rounded-lg p-2.5">
              <h4 className="text-xs font-semibold text-amber-700 mb-2">New Reading</h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <label className="text-[10px] text-amber-600 block">Level %</label>
                  <input type="number" step="0.1" placeholder="80" value={bwForm.level || ''}
                    onChange={e => setBwForm(f => ({ ...f, level: e.target.value }))}
                    className="w-full border border-amber-200 rounded px-2 py-1.5 text-sm bg-white" inputMode="decimal" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-600 block">Gravity</label>
                  <input type="number" step="0.001" placeholder="1.02" value={bwForm.spGravity || ''}
                    onChange={e => setBwForm(f => ({ ...f, spGravity: e.target.value }))}
                    className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm bg-white" inputMode="decimal" />
                </div>
                <div>
                  <label className="text-[10px] text-green-600 block">Alc%</label>
                  <input type="number" step="0.1" placeholder="8.5" value={bwForm.alcohol || ''}
                    onChange={e => setBwForm(f => ({ ...f, alcohol: e.target.value }))}
                    className="w-full border border-green-200 rounded px-2 py-1.5 text-sm bg-white" inputMode="decimal" />
                </div>
                <div>
                  <label className="text-[10px] text-orange-600 block">Temp °C</label>
                  <input type="number" step="0.1" placeholder="32" value={bwForm.temp || ''}
                    onChange={e => setBwForm(f => ({ ...f, temp: e.target.value }))}
                    className="w-full border border-orange-200 rounded px-2 py-1.5 text-sm bg-white" inputMode="decimal" />
                </div>
              </div>
              <button onClick={submitBeerWell} disabled={bwSaving}
                className="mt-2 w-full bg-amber-600 text-white py-2 rounded-lg text-xs font-medium disabled:opacity-50 hover:bg-amber-700">
                {bwSaving ? 'Saving...' : 'Save Reading'}
              </button>
            </div>

            {/* Recent readings */}
            {beerWell?.readings?.length > 0 && (
              <div className="bg-gray-50 rounded-lg p-2.5">
                <h4 className="text-xs font-semibold text-gray-600 mb-1.5">Recent Readings</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-gray-500">
                      <th className="text-left py-1 px-1">Time</th>
                      <th className="text-left py-1 px-1">Lvl%</th>
                      <th className="text-left py-1 px-1">SG</th>
                      <th className="text-left py-1 px-1">Alc%</th>
                      <th className="text-left py-1 px-1">T°C</th>
                    </tr></thead>
                    <tbody>{beerWell.readings.slice(0, 10).map((r: any) => (
                      <tr key={r.id} className="border-t">
                        <td className="px-1 py-1 whitespace-nowrap">{fmtDateTime(r.createdAt)}</td>
                        <td className="px-1">{r.level ?? '-'}</td>
                        <td className="px-1">{r.spGravity ?? '-'}</td>
                        <td className="px-1">{r.alcohol ?? '-'}</td>
                        <td className="px-1">{r.temp ?? '-'}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Recent batches transferred */}
            {beerWell?.recentBatches?.length > 0 && (
              <div className="bg-blue-50 rounded-lg p-2.5">
                <h4 className="text-xs font-semibold text-blue-700 mb-1.5">Recent Transfers</h4>
                <div className="space-y-1">
                  {beerWell.recentBatches.map((b: any) => (
                    <div key={b.batchNo} className="flex justify-between text-xs">
                      <span>F-{b.fermenterNo} → BW#{b.beerWellNo} <b>Batch #{b.batchNo}</b></span>
                      <span className="text-gray-500">
                        {b.finalAlcohol ? `${b.finalAlcohol}%` : ''} {b.transferTime ? fmtDateTime(b.transferTime) : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── NEW BATCH MODAL ─── */}
      {showNewPF && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={() => setShowNewPF(null)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-3">New Batch — PF-{showNewPF}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-gray-500">Batch #</label><input type="number" value={nbForm.batchNo} onChange={e => setNbForm(f => ({ ...f, batchNo: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="text-xs text-gray-500">Level %</label><input type="number" step="1" placeholder="80" value={nbForm.pfLevel} onChange={e => setNbForm(f => ({ ...f, pfLevel: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" inputMode="decimal" /></div>
              <div><label className="text-xs text-gray-500">Gravity</label><input type="number" step="0.001" value={nbForm.slurryGravity} onChange={e => setNbForm(f => ({ ...f, slurryGravity: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" inputMode="decimal" /></div>
              <div><label className="text-xs text-gray-500">Temp °C</label><input type="number" step="0.1" value={nbForm.slurryTemp} onChange={e => setNbForm(f => ({ ...f, slurryTemp: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" inputMode="decimal" /></div>
            </div>
            <div className="mt-3"><label className="text-xs text-gray-500">Remarks</label><input value={nbForm.remarks} onChange={e => setNbForm(f => ({ ...f, remarks: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => createBatch(showNewPF)} className="flex-1 bg-indigo-600 text-white py-2.5 rounded-xl font-medium">Create</button>
              <button onClick={() => setShowNewPF(null)} className="px-6 py-2.5 bg-gray-100 rounded-xl font-medium text-gray-600">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── TRANSFER MODAL ─── */}
      {transferModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={() => setTransferModal(null)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1">Transfer PF-{transferModal.fermenterNo}</h3>
            <p className="text-sm text-gray-500 mb-4">Batch #{transferModal.batchNo} → Select fermenter</p>
            <div className="grid grid-cols-4 gap-2 mb-4">
              {[1, 2, 3, 4].map(n => {
                const occupied = fermBatches.some((b: FermBatch) => b.fermenterNo === n);
                return (
                  <button key={n} onClick={() => !occupied && setTransferFermNo(String(n))} disabled={occupied}
                    className={`py-3 rounded-xl text-lg font-bold border-2 transition ${occupied ? 'bg-gray-100 text-gray-300 border-gray-200 cursor-not-allowed' : transferFermNo === String(n) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-200'}`}>
                    F-{n}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <button onClick={doTransfer} disabled={transferring} className="flex-1 bg-blue-600 text-white py-2.5 rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-50">
                <ArrowRight size={18} /> {transferring ? 'Transferring...' : 'Transfer'}
              </button>
              <button onClick={() => setTransferModal(null)} className="px-6 py-2.5 bg-gray-100 rounded-xl font-medium text-gray-600">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   LAB TAB
   ═══════════════════════════════════════════════════════ */
function LabTab({ pfBatches, fermBatches, onRefresh, flash, pfFor, fermFor, beerWell }: any) {
  const [selected, setSelected] = useState<{ type: 'PF' | 'FERM'; no: number; batchNo: number } | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const resetForm = () => setForm({ spGravity: '', ph: '', rs: '', rst: '', alcohol: '', ds: '', vfaPpa: '', temp: '', level: '', remarks: '' });

  const LAB_FIELDS = [
    { key: 'spGravity', label: 'Gravity', placeholder: '1.024', step: '0.001' },
    { key: 'ph', label: 'pH', placeholder: '4.5', step: '0.1' },
    { key: 'rs', label: 'RS%', placeholder: '', step: '0.01' },
    { key: 'rst', label: 'RST%', placeholder: '', step: '0.01' },
    { key: 'alcohol', label: 'Alc%', placeholder: '8.5', step: '0.1' },
    { key: 'ds', label: 'DS%', placeholder: '', step: '0.01' },
    { key: 'vfaPpa', label: 'VFA', placeholder: '', step: '0.01' },
  ];

  const submit = async () => {
    if (!selected) return;
    const hasVal = LAB_FIELDS.some(f => form[f.key]?.trim()) || form.temp?.trim() || form.level?.trim();
    if (!hasVal) { flash('Enter at least one reading', 'err'); return; }

    setSaving(true);
    try {
      const payload: any = { vesselType: selected.type, vesselNo: selected.no, remarks: form.remarks || '' };
      LAB_FIELDS.forEach(f => { if (form[f.key]?.trim()) payload[f.key] = form[f.key]; });
      if (form.temp?.trim()) payload.temp = form.temp;
      if (form.level?.trim()) payload.level = form.level;

      const { data } = await api.post('/fermentation/lab-reading', payload);
      const hint = data.readyToTransfer ? ' — READY TO TRANSFER!' : '';
      flash(`Saved for Batch #${data.batchNo || selected.batchNo}${hint}`);
      setSelected(null);
      resetForm();
      onRefresh();
    } catch (err: any) { flash(err.response?.data?.error || 'Failed', 'err'); }
    finally { setSaving(false); }
  };

  // Build share text for current vessel
  const getShareText = (v: any) => {
    if (v.type === 'PF') {
      const batch = pfFor(v.no);
      return batch ? buildPFShareText(batch) : '';
    } else {
      const batch = fermFor(v.no);
      return batch ? buildFermShareText(batch) : '';
    }
  };

  // Beer well lab form
  const [bwLabForm, setBwLabForm] = useState<Record<string, string>>({});
  const [bwLabSaving, setBwLabSaving] = useState(false);
  const [showBwLab, setShowBwLab] = useState(false);

  const submitBwLab = async () => {
    const hasVal = bwLabForm.level?.trim() || bwLabForm.spGravity?.trim() || bwLabForm.alcohol?.trim() || bwLabForm.temp?.trim() || bwLabForm.ph?.trim();
    if (!hasVal) { flash('Enter at least one value', 'err'); return; }
    setBwLabSaving(true);
    try {
      await api.post('/fermentation/beer-well', bwLabForm);
      flash('Beer Well reading saved');
      setBwLabForm({});
      setShowBwLab(false);
      onRefresh();
    } catch (e: any) { flash(e?.response?.data?.error || 'Failed', 'err'); }
    finally { setBwLabSaving(false); }
  };

  const vessels: { type: 'PF' | 'FERM'; no: number; label: string; batchNo: number | null; phase: string | null; lastSG: number | null; lastTemp: number | null; lastAlc: number | null; ready: boolean }[] = [];
  for (let i = 1; i <= PF_COUNT; i++) {
    const b = pfFor(i);
    vessels.push({ type: 'PF', no: i, label: `PF-${i}`, batchNo: b?.batchNo ?? null, phase: b?.phase ?? null, lastSG: b?.lastGravity ?? null, lastTemp: b?.labReadings?.length ? b.labReadings[b.labReadings.length - 1]?.temp : null, lastAlc: b?.labReadings?.length ? b.labReadings[b.labReadings.length - 1]?.alcohol : null, ready: b?.readyToTransfer ?? false });
  }
  for (let i = 1; i <= FERM_COUNT; i++) {
    const b = fermFor(i);
    vessels.push({ type: 'FERM', no: i, label: `F-${i}`, batchNo: b?.batchNo ?? null, phase: b?.phase ?? null, lastSG: b?.lastLab?.spGravity ?? null, lastTemp: b?.lastLab?.temp ?? null, lastAlc: b?.lastLab?.alcohol ?? null, ready: false });
  }

  if (selected) {
    return (
      <div className="bg-white rounded-xl border shadow-sm p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {selected.type === 'PF' ? <Beaker size={20} className="text-indigo-600" /> : <FlaskConical size={20} className="text-emerald-600" />}
            <span className="text-lg font-bold">{selected.type === 'PF' ? `PF-${selected.no}` : `F-${selected.no}`}</span>
            <span className="text-sm text-gray-500 bg-gray-100 px-2 py-0.5 rounded">#{selected.batchNo}</span>
          </div>
          <button onClick={() => { setSelected(null); resetForm(); }} className="p-1 hover:bg-gray-100 rounded"><X size={20} className="text-gray-400" /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {selected.type === 'FERM' && (
            <div>
              <label className="text-xs font-medium text-blue-600 block mb-1">Level %</label>
              <input type="number" step="0.1" placeholder="e.g. 80" value={form.level || ''}
                onChange={e => setForm(p => ({ ...p, level: e.target.value }))}
                className="w-full border-2 border-blue-200 rounded-lg px-3 py-2.5 text-sm bg-blue-50" inputMode="decimal" />
            </div>
          )}
          <div className={selected.type === 'PF' ? 'col-span-2' : ''}>
            <label className="text-xs font-medium text-orange-600 block mb-1">Temp °C</label>
            <input type="number" step="0.1" placeholder="32" value={form.temp || ''}
              onChange={e => setForm(p => ({ ...p, temp: e.target.value }))}
              className="w-full border-2 border-orange-200 rounded-lg px-3 py-2.5 text-sm bg-orange-50" inputMode="decimal" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {LAB_FIELDS.map(f => (
            <div key={f.key}>
              <label className="text-xs text-gray-500 block mb-1">{f.label}</label>
              <input type="number" step={f.step} placeholder={f.placeholder} value={form[f.key] || ''}
                onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" inputMode="decimal" />
            </div>
          ))}
          <div>
            <label className="text-xs text-gray-500 block mb-1">Remarks</label>
            <input value={form.remarks || ''} onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))}
              placeholder="Optional..." className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>

        <button onClick={submit} disabled={saving}
          className="w-full bg-emerald-600 text-white py-3 rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-50">
          <Send size={16} /> {saving ? 'Saving...' : 'Save Reading'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">Tap vessel to enter readings</p>
      <div className="grid grid-cols-2 gap-3">
        {vessels.map(v => {
          const active = !!v.batchNo;
          const isPF = v.type === 'PF';
          return (
            <div key={v.label} className="relative">
              <button onClick={() => { if (active) { resetForm(); setSelected({ type: v.type, no: v.no, batchNo: v.batchNo! }); } }} disabled={!active}
                className={`w-full rounded-xl p-3 text-left border-2 transition ${active ? 'bg-white hover:shadow-md cursor-pointer' : 'bg-gray-50 border-gray-200 opacity-50 cursor-not-allowed'} ${active && isPF ? 'border-indigo-200' : active ? 'border-emerald-200' : ''}`}>
                <div className="flex items-center gap-1.5 mb-1">
                  {isPF ? <Beaker size={16} className="text-indigo-600" /> : <FlaskConical size={16} className="text-emerald-600" />}
                  <span className="font-bold text-sm">{v.label}</span>
                  {v.ready && <span className="text-[10px] bg-green-500 text-white px-1 py-0.5 rounded">READY</span>}
                </div>
                {active ? (
                  <div className="text-xs space-y-0.5">
                    <div className="text-gray-500">#{v.batchNo} · {v.phase}</div>
                    <div className="flex gap-2 text-gray-700">
                      {v.lastSG != null && <span>SG:{v.lastSG}</span>}
                      {v.lastAlc != null && <span>A:{v.lastAlc}%</span>}
                      {v.lastTemp != null && <span className={v.lastTemp > 37 ? 'text-red-600 font-bold' : ''}>T:{v.lastTemp}°</span>}
                    </div>
                    {!v.lastSG && !v.lastAlc && <div className="text-amber-600 font-medium">No readings</div>}
                  </div>
                ) : <div className="text-xs text-gray-400">Idle</div>}
              </button>
              {active && (
                <button onClick={() => shareWhatsApp(getShareText(v))}
                  className="absolute top-2 right-2 bg-green-600 text-white p-1.5 rounded-lg shadow-sm" title="Share">
                  <Share2 size={12} />
                </button>
              )}
            </div>
          );
        })}
        {/* Beer Well entry */}
        <div className="relative">
          <button onClick={() => { setBwLabForm({}); setShowBwLab(true); }}
            className="w-full rounded-xl p-3 text-left border-2 bg-white hover:shadow-md cursor-pointer border-amber-200 transition">
            <div className="flex items-center gap-1.5 mb-1">
              <Cylinder size={16} className="text-amber-600" />
              <span className="font-bold text-sm">Beer Well</span>
            </div>
            <div className="text-xs space-y-0.5">
              {beerWell?.latest ? (
                <div className="flex gap-2 text-gray-700">
                  {beerWell.latest.level != null && <span>L:{beerWell.latest.level}%</span>}
                  {beerWell.latest.spGravity != null && <span>SG:{beerWell.latest.spGravity}</span>}
                  {beerWell.latest.alcohol != null && <span>A:{beerWell.latest.alcohol}%</span>}
                  {beerWell.latest.temp != null && <span>T:{beerWell.latest.temp}°</span>}
                </div>
              ) : <div className="text-amber-600 font-medium">No readings</div>}
            </div>
          </button>
        </div>
      </div>

      {/* Beer Well lab form overlay */}
      {showBwLab && (
        <div className="bg-white rounded-xl border shadow-sm p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cylinder size={20} className="text-amber-600" />
              <span className="text-lg font-bold">Beer Well</span>
            </div>
            <button onClick={() => setShowBwLab(false)} className="p-1 hover:bg-gray-100 rounded"><X size={20} className="text-gray-400" /></button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-blue-600 block mb-1">Level %</label>
              <input type="number" step="0.1" placeholder="80" value={bwLabForm.level || ''}
                onChange={e => setBwLabForm(p => ({ ...p, level: e.target.value }))}
                className="w-full border-2 border-blue-200 rounded-lg px-3 py-2.5 text-sm bg-blue-50" inputMode="decimal" />
            </div>
            <div>
              <label className="text-xs font-medium text-orange-600 block mb-1">Temp °C</label>
              <input type="number" step="0.1" placeholder="32" value={bwLabForm.temp || ''}
                onChange={e => setBwLabForm(p => ({ ...p, temp: e.target.value }))}
                className="w-full border-2 border-orange-200 rounded-lg px-3 py-2.5 text-sm bg-orange-50" inputMode="decimal" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Gravity</label>
              <input type="number" step="0.001" placeholder="1.02" value={bwLabForm.spGravity || ''}
                onChange={e => setBwLabForm(p => ({ ...p, spGravity: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" inputMode="decimal" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">pH</label>
              <input type="number" step="0.1" placeholder="4.5" value={bwLabForm.ph || ''}
                onChange={e => setBwLabForm(p => ({ ...p, ph: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" inputMode="decimal" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Alc%</label>
              <input type="number" step="0.1" placeholder="8.5" value={bwLabForm.alcohol || ''}
                onChange={e => setBwLabForm(p => ({ ...p, alcohol: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" inputMode="decimal" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Remarks</label>
              <input value={bwLabForm.remarks || ''} onChange={e => setBwLabForm(p => ({ ...p, remarks: e.target.value }))}
                placeholder="Optional..." className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <button onClick={submitBwLab} disabled={bwLabSaving}
            className="w-full bg-amber-600 text-white py-3 rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-amber-700">
            <Send size={16} /> {bwLabSaving ? 'Saving...' : 'Save Reading'}
          </button>
        </div>
      )}
    </div>
  );
}
