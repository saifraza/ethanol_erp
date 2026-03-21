import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FlaskConical, Beaker, Cylinder, RefreshCw, Loader2, CheckCircle, AlertCircle,
  Plus, Trash2, Send, ChevronDown, Clock, Play, X, MessageCircle
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

/* ═══════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════ */
interface LabReading { id: string; analysisTime: string; spGravity?: number; ph?: number; rs?: number; rst?: number; alcohol?: number; ds?: number; vfaPpa?: number; temp?: number; level?: number; remarks?: string; status?: string; createdAt: string; }
interface Dosing { id: string; chemicalName: string; quantity: number; unit: string; rate?: number; level?: number; addedAt: string; }
interface PFBatch { id: string; batchNo: number; fermenterNo: number; phase: string; setupTime?: string; dosingEndTime?: string; transferTime?: string; cipStartTime?: string; cipEndTime?: string; slurryVolume?: number; slurryGravity?: number; slurryTemp?: number; remarks?: string; dosings: Dosing[]; labReadings: LabReading[]; createdAt?: string; }
interface FermBatch { id: string; batchNo: number; fermenterNo: number; phase: string; pfTransferTime?: string; fillingStartTime?: string; fillingEndTime?: string; setupEndTime?: string; reactionStartTime?: string; retentionStartTime?: string; transferTime?: string; cipStartTime?: string; cipEndTime?: string; setupTime?: string; setupDate?: string; setupGravity?: number; setupRs?: number; setupRst?: number; fermLevel?: number; volume?: number; transferVolume?: number; beerWellNo?: number; finalDate?: string; finalRsGravity?: number; totalHours?: number; finalAlcohol?: number; yeast?: string; enzyme?: string; formolin?: string; booster?: string; urea?: string; remarks?: string; dosings: Dosing[]; }
interface BeerWellReading { id: string; wellNo: number; level?: number; spGravity?: number; ph?: number; alcohol?: number; temp?: number; remarks?: string; batchNo?: number; createdAt: string; }
interface Chemical { id: string; name: string; unit: string; rate?: number; }
interface Recipe { id: string; chemicalName: string; quantity: number; unit: string; }

type VesselType = 'PF' | 'FERM' | 'BW';
interface Vessel { type: VesselType; no: number; label: string; }

const ALL_VESSELS: Vessel[] = [
  { type: 'PF', no: 1, label: 'PF-1' }, { type: 'PF', no: 2, label: 'PF-2' },
  { type: 'FERM', no: 1, label: 'F-1' }, { type: 'FERM', no: 2, label: 'F-2' },
  { type: 'FERM', no: 3, label: 'F-3' }, { type: 'FERM', no: 4, label: 'F-4' },
  { type: 'BW', no: 1, label: 'BW-1' }, { type: 'BW', no: 2, label: 'BW-2' },
];

const PHASE_CFG: Record<string, { label: string; bg: string; text: string; ring: string; dot: string }> = {
  IDLE:           { label: 'Idle',       bg: 'bg-slate-50',    text: 'text-slate-400',   ring: 'ring-slate-200',   dot: 'bg-slate-300' },
  SETUP:          { label: 'Setup',      bg: 'bg-indigo-50',   text: 'text-indigo-700',  ring: 'ring-indigo-400',  dot: 'bg-indigo-500' },
  DOSING:         { label: 'Dosing',     bg: 'bg-violet-50',   text: 'text-violet-700',  ring: 'ring-violet-400',  dot: 'bg-violet-500' },
  LAB:            { label: 'Lab',        bg: 'bg-cyan-50',     text: 'text-cyan-700',    ring: 'ring-cyan-400',    dot: 'bg-cyan-500' },
  PF_TRANSFER:    { label: 'PF Xfer',   bg: 'bg-[#FDF8F3]',     text: 'text-[#7C4A21]',    ring: 'ring-[#B87333]',    dot: 'bg-[#B87333]' },
  FILLING:        { label: 'Filling',    bg: 'bg-sky-50',      text: 'text-sky-700',     ring: 'ring-sky-400',     dot: 'bg-sky-500 animate-pulse' },
  REACTION:       { label: 'Reaction',   bg: 'bg-amber-50',    text: 'text-amber-800',   ring: 'ring-amber-400',   dot: 'bg-amber-500 animate-pulse' },
  RETENTION:      { label: 'Retention',  bg: 'bg-orange-50',   text: 'text-orange-800',  ring: 'ring-orange-400',  dot: 'bg-orange-500 animate-pulse' },
  TRANSFER:       { label: 'Transfer',   bg: 'bg-emerald-50',  text: 'text-emerald-700', ring: 'ring-emerald-400', dot: 'bg-emerald-500' },
  CIP:            { label: 'CIP',        bg: 'bg-purple-50',   text: 'text-purple-700',  ring: 'ring-purple-400',  dot: 'bg-purple-500' },
  DONE:           { label: 'Done',       bg: 'bg-[#FAFAF8]',     text: 'text-[#6B6B63]',    ring: 'ring-[#D4D4CC]',    dot: 'bg-[#9C9C94]' },
};
const phCfg = (p: string) => PHASE_CFG[p] || PHASE_CFG.IDLE;

const PF_PHASES = ['SETUP', 'DOSING', 'LAB', 'TRANSFER', 'CIP', 'DONE'];
const FERM_PHASES = ['PF_TRANSFER', 'FILLING', 'REACTION', 'RETENTION', 'TRANSFER', 'CIP', 'DONE'];

const fmtTime = (iso?: string) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
};
const elapsed = (iso?: string) => {
  if (!iso) return '';
  const hrs = (Date.now() - new Date(iso).getTime()) / 3600000;
  return hrs < 1 ? `${Math.floor(hrs * 60)}m` : `${hrs.toFixed(1)}h`;
};

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════ */
export default function Fermentation() {
  const { user } = useAuth();
  const [pfBatches, setPfBatches] = useState<PFBatch[]>([]);
  const [fermBatches, setFermBatches] = useState<FermBatch[]>([]);
  const [fermEntries, setFermEntries] = useState<Record<number, LabReading[]>>({});
  const [bwReadings, setBwReadings] = useState<BeerWellReading[]>([]);
  const [chemicals, setChemicals] = useState<Chemical[]>([]);
  const [recipes, setRecipes] = useState<{ PF: Recipe[]; FERMENTER: Recipe[] }>({ PF: [], FERMENTER: [] });
  const [settings, setSettings] = useState<any>({});

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Vessel | null>(null);
  const [tab, setTab] = useState<'reading' | 'dosing' | 'charts' | 'batch'>('reading');
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);

  const [readingForm, setReadingForm] = useState<Record<string, string>>({});
  const [dosingForm, setDosingForm] = useState({ chemicalName: '', quantity: '', unit: 'kg' });
  const [newBatchForm, setNewBatchForm] = useState({ batchNo: '', pfLevel: '', slurryGravity: '', slurryTemp: '' });
  const [showNewBatch, setShowNewBatch] = useState(false);

  const flash = (t: 'ok' | 'err', m: string) => { setMsg({ t, m }); setTimeout(() => setMsg(null), 3000); };

  const load = useCallback(async () => {
    try {
      const [ov, chem, pfR, fR, sett] = await Promise.all([
        api.get('/fermentation/overview'),
        api.get('/fermentation/chemicals'),
        api.get('/dosing-recipes/PF').catch(() => ({ data: [] })),
        api.get('/dosing-recipes/FERMENTER').catch(() => ({ data: [] })),
        api.get('/fermentation/settings').catch(() => ({ data: {} })),
      ]);
      const d = ov.data;
      setPfBatches(d.pfBatches || []);
      setFermBatches(d.fermBatches || []);
      setBwReadings(d.beerWell?.readings || []);
      setChemicals(chem.data || []);
      setRecipes({ PF: pfR.data || [], FERMENTER: fR.data || [] });
      setSettings(sett.data || {});
      const entries: Record<number, LabReading[]> = {};
      for (const fb of (d.fermBatches || [])) {
        try {
          const r = await api.get(`/fermentation/batch/${fb.batchNo}`);
          entries[fb.fermenterNo] = r.data || [];
        } catch { entries[fb.fermenterNo] = []; }
      }
      setFermEntries(entries);
    } catch { flash('err', 'Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const iv = setInterval(load, 30000); return () => clearInterval(iv); }, [load]);

  const getActivePF = (no: number) => pfBatches.find(b => b.fermenterNo === no && b.phase !== 'DONE');
  const getActiveFerm = (no: number) => fermBatches.find(b => b.fermenterNo === no && b.phase !== 'DONE');
  const getBW = (no: number) => bwReadings.filter(r => r.wellNo === no);

  const getVesselBatch = (v: Vessel): any => v.type === 'PF' ? getActivePF(v.no) : v.type === 'FERM' ? getActiveFerm(v.no) : null;
  const getVesselReadings = (v: Vessel): LabReading[] => {
    if (v.type === 'PF') return getActivePF(v.no)?.labReadings || [];
    if (v.type === 'FERM') return fermEntries[v.no] || [];
    return [];
  };

  const nextBatchNo = useMemo(() => {
    const all = [...pfBatches.map(b => b.batchNo), ...fermBatches.map(b => b.batchNo)];
    return all.length > 0 ? Math.max(...all) + 1 : 1;
  }, [pfBatches, fermBatches]);

  const freeFermenters = useMemo(() => {
    const active = new Set(fermBatches.filter(b => b.phase !== 'DONE').map(b => b.fermenterNo));
    return [1, 2, 3, 4].filter(n => !active.has(n));
  }, [fermBatches]);

  /* ── ACTIONS ── */
  const saveReading = async (andShare = false) => {
    if (!selected) return;
    setSaving(true);
    const f = readingForm;
    try {
      if (selected.type === 'BW') {
        await api.post('/fermentation/beer-well', {
          wellNo: selected.no,
          level: f.level ? +f.level : undefined, spGravity: f.spGravity ? +f.spGravity : undefined,
          ph: f.ph ? +f.ph : undefined, alcohol: f.alcohol ? +f.alcohol : undefined,
          temp: f.temp ? +f.temp : undefined, remarks: f.remarks || undefined,
        });
      } else {
        const analysisTime = f.analysisTime ? new Date(f.analysisTime).toISOString() : new Date().toISOString();
        await api.post('/fermentation/lab-reading', {
          vesselType: selected.type, vesselNo: selected.no,
          analysisTime,
          level: f.level ? +f.level : undefined, spGravity: f.spGravity ? +f.spGravity : undefined,
          ph: f.ph ? +f.ph : undefined, rs: f.rs ? +f.rs : undefined, rst: f.rst ? +f.rst : undefined,
          alcohol: f.alcohol ? +f.alcohol : undefined, ds: f.ds ? +f.ds : undefined,
          vfaPpa: f.vfaPpa ? +f.vfaPpa : undefined, temp: f.temp ? +f.temp : undefined,
          remarks: f.remarks || undefined,
        });
      }
      flash('ok', `${selected.label} saved ✓`);
      if (andShare) {
        const batch = getVesselBatch(selected);
        const lines = [
          `🧪 ${selected.label}${batch ? ` B#${batch.batchNo}` : ''}`,
          f.level ? `Level: ${f.level}%` : '', f.spGravity ? `SG: ${f.spGravity}` : '',
          f.ph ? `pH: ${f.ph}` : '', f.temp ? `Temp: ${f.temp}°C` : '',
          f.alcohol ? `Alc: ${f.alcohol}%` : '', f.rs ? `RS: ${f.rs}%` : '',
          f.rst ? `RST: ${f.rst}%` : '', f.remarks ? `Note: ${f.remarks}` : '',
        ].filter(Boolean).join('\n');
        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(lines)}`, '_blank');
      }
      setReadingForm({});
      load();
    } catch { flash('err', 'Save failed'); }
    setSaving(false);
  };

  const startBatch = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const f = newBatchForm;
      const bn = parseInt(f.batchNo) || nextBatchNo;
      if (selected.type === 'PF') {
        const pfLvl = parseFloat(f.pfLevel) || 0;
        await api.post('/pre-fermentation/batches', {
          batchNo: bn, fermenterNo: selected.no, setupTime: new Date().toISOString(),
          slurryVolume: pfLvl > 0 ? (pfLvl / 100) * 450 * 1000 : undefined,
          slurryGravity: f.slurryGravity ? +f.slurryGravity : undefined,
          slurryTemp: f.slurryTemp ? +f.slurryTemp : undefined,
          userId: user?.id || '',
        });
      } else {
        const lvl = parseFloat(f.pfLevel) || 0;
        await api.post('/fermentation/batches', {
          batchNo: bn, fermenterNo: selected.no, phase: 'FILLING',
          fillingStartTime: new Date().toISOString(),
          fermLevel: lvl || undefined,
          volume: lvl > 0 ? (lvl / 100) * 2300 * 1000 : undefined,
          setupGravity: f.slurryGravity ? +f.slurryGravity : undefined,
          userId: user?.id || '',
        });
      }
      flash('ok', `${selected.label} Batch #${bn} started`);
      setShowNewBatch(false); setNewBatchForm({ batchNo: '', pfLevel: '', slurryGravity: '', slurryTemp: '' });
      load();
    } catch (e: any) { flash('err', e?.response?.data?.error || 'Failed'); }
    setSaving(false);
  };

  const transferPF = async (pfBatchId: string, fermNo: number) => {
    setSaving(true);
    try {
      await api.post('/fermentation/transfer-pf', { pfBatchId, fermenterNo: fermNo });
      flash('ok', `Transferred to F-${fermNo} ✓`);
      load();
    } catch (e: any) { flash('err', e?.response?.data?.error || 'Transfer failed'); }
    setSaving(false);
  };

  const advancePhase = async (batchType: 'PF' | 'FERM', batchId: string, nextPhase: string, extra?: any) => {
    setSaving(true);
    try {
      const url = batchType === 'PF' ? `/pre-fermentation/batches/${batchId}` : `/fermentation/batches/${batchId}`;
      await api.patch(url, { phase: nextPhase, ...extra });
      flash('ok', `→ ${phCfg(nextPhase).label}`);
      load();
    } catch { flash('err', 'Phase change failed'); }
    setSaving(false);
  };

  const addDosing = async () => {
    if (!selected) return;
    const batch = getVesselBatch(selected);
    if (!batch) return;
    setSaving(true);
    try {
      const url = selected.type === 'PF' ? `/pre-fermentation/batches/${batch.id}/dosing` : `/fermentation/batches/${batch.id}/dosing`;
      await api.post(url, { chemicalName: dosingForm.chemicalName, quantity: +dosingForm.quantity, unit: dosingForm.unit });
      flash('ok', `${dosingForm.chemicalName} added`);
      setDosingForm({ chemicalName: '', quantity: '', unit: 'kg' });
      load();
    } catch { flash('err', 'Dosing failed'); }
    setSaving(false);
  };

  const applyRecipe = async () => {
    if (!selected) return;
    const batch = getVesselBatch(selected);
    if (!batch) return;
    const recs = selected.type === 'PF' ? recipes.PF : recipes.FERMENTER;
    setSaving(true);
    try {
      for (const r of recs) {
        const url = selected.type === 'PF' ? `/pre-fermentation/batches/${batch.id}/dosing` : `/fermentation/batches/${batch.id}/dosing`;
        await api.post(url, { chemicalName: r.chemicalName, quantity: r.quantity, unit: r.unit });
      }
      flash('ok', `${recs.length} chemicals added`);
      load();
    } catch { flash('err', 'Recipe failed'); }
    setSaving(false);
  };

  const deleteDosing = async (dosingId: string) => {
    if (!selected) return;
    try {
      await api.delete(selected.type === 'PF' ? `/pre-fermentation/dosing/${dosingId}` : `/fermentation/dosing/${dosingId}`);
      load();
    } catch { flash('err', 'Delete failed'); }
  };

  const deleteReading = async (readingId: string) => {
    if (!selected || !confirm('Delete this reading?')) return;
    try {
      const url = selected.type === 'PF' ? `/pre-fermentation/lab/${readingId}` : `/fermentation/${readingId}`;
      await api.delete(url);
      flash('ok', 'Deleted');
      load();
    } catch { flash('err', 'Delete failed'); }
  };

  const [editingReading, setEditingReading] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});

  const startEditReading = (r: LabReading) => {
    setEditingReading(r.id);
    setEditForm({
      level: r.level != null ? String(r.level) : '',
      spGravity: r.spGravity != null ? String(r.spGravity) : '',
      ph: r.ph != null ? String(r.ph) : '',
      alcohol: r.alcohol != null ? String(r.alcohol) : '',
      temp: r.temp != null ? String(r.temp) : '',
      rs: r.rs != null ? String(r.rs) : '',
    });
  };

  const saveEditReading = async (readingId: string) => {
    if (!selected) return;
    try {
      const url = selected.type === 'PF' ? `/pre-fermentation/lab/${readingId}` : `/fermentation/${readingId}`;
      await api.put(url, {
        level: editForm.level ? +editForm.level : null,
        spGravity: editForm.spGravity ? +editForm.spGravity : null,
        ph: editForm.ph ? +editForm.ph : null,
        alcohol: editForm.alcohol ? +editForm.alcohol : null,
        temp: editForm.temp ? +editForm.temp : null,
        rs: editForm.rs ? +editForm.rs : null,
      });
      flash('ok', 'Updated');
      setEditingReading(null);
      load();
    } catch { flash('err', 'Update failed'); }
  };

  const deleteBatch = async () => {
    if (!selected) return;
    const batch = getVesselBatch(selected);
    if (!batch || !confirm(`Delete ${selected.label} Batch #${batch.batchNo}?`)) return;
    try {
      const url = selected.type === 'PF' ? `/pre-fermentation/batches/${batch.id}` : `/fermentation/batches/${batch.id}`;
      await api.delete(url);
      flash('ok', `Batch #${batch.batchNo} deleted`);
      setSelected(null);
      load();
    } catch (e: any) { flash('err', e?.response?.data?.error || 'Delete failed'); }
  };

  /* ═══ RENDER ═══ */
  if (loading) return (
    <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center">
      <Loader2 size={32} className="animate-spin text-indigo-500" />
    </div>
  );

  return (
    <div className="min-h-screen bg-[#FAFAF8] pb-20">
      {/* Header */}
      <div className="bg-gradient-to-br from-indigo-900 via-purple-900 to-violet-900 text-white px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-extrabold font-heading flex items-center gap-2 tracking-tight"><FlaskConical size={20} /> Fermentation</h1>
          <div className="flex items-center gap-3">
            <span className="text-xs text-indigo-300 font-medium">{new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
            <button onClick={() => { setLoading(true); load(); }} className="p-1.5 rounded-lg hover:bg-white/10 active:bg-white/20 transition-colors"><RefreshCw size={16} /></button>
          </div>
        </div>
      </div>

      {msg && (
        <div className={`mx-3 mt-2 rounded-lg p-2 text-xs flex items-center gap-1.5 ${msg.t === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {msg.t === 'ok' ? <CheckCircle size={12} /> : <AlertCircle size={12} />} {msg.m}
        </div>
      )}

      {/* ═══ VESSEL GRID ═══ */}
      <div className="px-3 pt-3">
        <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
          {ALL_VESSELS.map(v => {
            const isSelected = selected?.type === v.type && selected?.no === v.no;
            let batch: any = null;
            let phase = 'IDLE'; let metric1 = ''; let metric2 = ''; let levelStr = ''; let batchNo = 0; let startTime = '';

            if (v.type === 'PF') {
              batch = getActivePF(v.no);
              if (batch) {
                phase = batch.phase; batchNo = batch.batchNo;
                const last = batch.labReadings?.[batch.labReadings.length - 1];
                metric1 = last?.spGravity ? last.spGravity.toFixed(3) : batch.slurryGravity ? batch.slurryGravity.toFixed(3) : '';
                metric2 = last?.temp ? `${last.temp}°` : '';
                levelStr = last?.level ? `${last.level}%` : '';
                startTime = batch.setupTime || batch.createdAt || '';
              }
            } else if (v.type === 'FERM') {
              batch = getActiveFerm(v.no);
              if (batch) {
                phase = batch.phase; batchNo = batch.batchNo;
                const entries = fermEntries[v.no] || [];
                const last = entries[entries.length - 1];
                metric1 = last?.spGravity ? last.spGravity.toFixed(3) : batch.setupGravity ? batch.setupGravity.toFixed(3) : '';
                metric2 = last?.temp ? `${last.temp}°` : '';
                levelStr = last?.level ? `${last.level}%` : batch.fermLevel ? `${batch.fermLevel}%` : '';
                startTime = batch.pfTransferTime || batch.fillingStartTime || '';
              }
            } else {
              const bw = getBW(v.no);
              if (bw[0]) { metric1 = bw[0].level ? `${bw[0].level}%` : ''; metric2 = bw[0].alcohol ? `${bw[0].alcohol}%` : ''; }
            }

            const cfg = phCfg(phase);
            const Icon = v.type === 'PF' ? Beaker : v.type === 'FERM' ? FlaskConical : Cylinder;
            const isIdle = phase === 'IDLE' && v.type !== 'BW';

            return (
              <button key={`${v.type}-${v.no}`}
                onClick={() => { setSelected(isSelected ? null : v); setTab('reading'); setReadingForm({}); setShowNewBatch(false); }}
                className={`relative rounded-xl p-2.5 text-left transition-all duration-200 border-2 ${
                  isSelected ? `${cfg.bg} ring-2 ${cfg.ring} border-transparent scale-[1.03]`
                  : isIdle ? 'bg-white border-[#F5F5F0] hover:border-[#D4D4CC] '
                  : `bg-white border-[#F5F5F0]  hover:border-[#E8E8E0]`
                }`}>
                {/* Active dot indicator */}
                {!isIdle && v.type !== 'BW' && (
                  <div className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${cfg.dot}`} />
                )}
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon size={14} className={isIdle ? 'text-[#C8C8BE]' : v.type === 'BW' ? 'text-amber-500' : cfg.text} />
                  <span className={`text-xs font-extrabold ${isIdle ? 'text-[#9C9C94]' : 'text-[#333330]'}`}>{v.label}</span>
                </div>
                {batchNo > 0 && (
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
                    <span className="text-[9px] text-[#9C9C94] font-semibold">#{batchNo}</span>
                  </div>
                )}
                {metric1 && <div className="text-sm font-black text-[#333330] mt-1 tracking-tight">{metric1}</div>}
                {(metric2 || levelStr) && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {metric2 && <span className="text-[10px] font-semibold text-[#6B6B63]">{metric2}</span>}
                    {levelStr && <span className="text-[10px] font-bold text-[#B87333] bg-[#FDF8F3] px-1 py-0.5 rounded">{levelStr}</span>}
                  </div>
                )}
                {isIdle && v.type !== 'BW' && <div className="text-[10px] text-[#C8C8BE] mt-1.5 italic">idle</div>}
                {v.type === 'BW' && !metric1 && <div className="text-[10px] text-[#C8C8BE] mt-1.5 italic">no data</div>}
                {startTime && !isIdle && (
                  <div className="text-[9px] text-[#9C9C94] mt-1 flex items-center gap-0.5 font-medium">
                    <Clock size={8} className="text-[#C8C8BE]" />{elapsed(startTime)}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ═══ SELECTED VESSEL PANEL ═══ */}
      {selected && (() => {
        const batch = getVesselBatch(selected);
        const readings = getVesselReadings(selected);
        const phase = batch ? batch.phase : 'IDLE';
        const cfg = phCfg(phase);
        const isPF = selected.type === 'PF';
        const isFerm = selected.type === 'FERM';
        const isBW = selected.type === 'BW';
        const batchNo = batch?.batchNo || 0;
        const dosings: Dosing[] = batch?.dosings || [];

        return (
          <div className="mx-3 mt-3 bg-white rounded-2xl border border-[#E8E8E0] overflow-hidden animate-[slideUp_0.2s_ease-out]">
            <style>{`@keyframes slideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
            {/* Panel header */}
            <div className={`px-4 py-3 ${isBW ? 'bg-gradient-to-r from-amber-50 to-amber-100/50' : `bg-gradient-to-r ${cfg.bg}`} flex items-center gap-2 border-b border-[#F5F5F0]`}>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isBW ? 'bg-amber-200' : cfg.bg}`}>
                {isPF ? <Beaker size={16} className={cfg.text} /> : isFerm ? <FlaskConical size={16} className={cfg.text} /> : <Cylinder size={16} className="text-amber-600" />}
              </div>
              <div>
                <span className={`font-extrabold text-base ${isBW ? 'text-amber-800' : 'text-[#333330]'}`}>{selected.label}</span>
                <div className="flex items-center gap-1.5">
                  {batchNo > 0 && <span className="text-[10px] text-[#6B6B63] font-semibold">Batch #{batchNo}</span>}
                  {phase !== 'IDLE' && !isBW && <span className={`text-[10px] font-bold ${cfg.text}`}>· {cfg.label}</span>}
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="ml-auto w-7 h-7 rounded-full bg-[#F5F5F0] hover:bg-[#E8E8E0] flex items-center justify-center transition-colors"><X size={14} className="text-[#6B6B63]" /></button>
            </div>

            {/* IDLE — Start batch */}
            {phase === 'IDLE' && !isBW && (
              <div className="p-4">
                {!showNewBatch ? (
                  <button onClick={() => { setShowNewBatch(true); setNewBatchForm(f => ({ ...f, batchNo: String(nextBatchNo) })); }}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 flex items-center gap-1.5 mx-auto">
                    <Plus size={14} /> Start New Batch
                  </button>
                ) : (
                  <div className="space-y-2 max-w-xs mx-auto">
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="text-[10px] font-bold text-[#6B6B63]">Batch #</label>
                        <input type="number" value={newBatchForm.batchNo} onChange={e => setNewBatchForm(f => ({ ...f, batchNo: e.target.value }))} className="w-full px-2 py-1.5 border rounded-lg text-sm" /></div>
                      <div><label className="text-[10px] font-bold text-[#6B6B63]">Level %</label>
                        <input type="number" step="0.1" value={newBatchForm.pfLevel} onChange={e => setNewBatchForm(f => ({ ...f, pfLevel: e.target.value }))} className="w-full px-2 py-1.5 border rounded-lg text-sm" /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="text-[10px] font-bold text-[#6B6B63]">Gravity</label>
                        <input type="number" step="0.001" value={newBatchForm.slurryGravity} onChange={e => setNewBatchForm(f => ({ ...f, slurryGravity: e.target.value }))} className="w-full px-2 py-1.5 border rounded-lg text-sm" /></div>
                      {isPF && <div><label className="text-[10px] font-bold text-[#6B6B63]">Temp °C</label>
                        <input type="number" step="0.1" value={newBatchForm.slurryTemp} onChange={e => setNewBatchForm(f => ({ ...f, slurryTemp: e.target.value }))} className="w-full px-2 py-1.5 border rounded-lg text-sm" /></div>}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={startBatch} disabled={saving} className="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold disabled:opacity-50">
                        {saving ? <Loader2 size={14} className="animate-spin mx-auto" /> : '🚀 Start'}
                      </button>
                      <button onClick={() => setShowNewBatch(false)} className="px-3 py-2 bg-[#F5F5F0] text-[#4A4A44] rounded-lg text-xs">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Active tabs */}
            {(phase !== 'IDLE' || isBW) && (
              <>
                {!isBW && (
                  <div className="flex border-b bg-[#FAFAF8]/30 px-1 pt-1">
                    {(['reading', 'dosing', 'charts', 'batch'] as const).map(t => (
                      <button key={t} onClick={() => setTab(t)}
                        className={`flex-1 py-2 text-[11px] font-bold tracking-wide rounded-t-lg transition-all duration-150 ${
                          tab === t
                            ? 'text-indigo-700 bg-white border-b-2 border-indigo-600'
                            : 'text-[#9C9C94] hover:text-[#4A4A44] hover:bg-white/50'
                        }`}>
                        {t === 'reading' ? 'Reading' : t === 'dosing' ? 'Dosing' : t === 'charts' ? 'Charts' : 'Batch'}
                      </button>
                    ))}
                  </div>
                )}

                {/* TAB: Reading */}
                {(tab === 'reading' || isBW) && (
                  <div className="p-3 space-y-3">
                    <div className="space-y-3">
                      {!isBW && (
                        <div className="flex items-center gap-2 bg-[#FAFAF8] rounded-lg px-3 py-1.5 border border-[#E8E8E0]">
                          <Clock size={12} className="text-[#9C9C94] shrink-0" />
                          <label className="text-[9px] font-bold text-[#6B6B63] uppercase tracking-wider shrink-0">Time</label>
                          <input type="datetime-local" step="60"
                            value={readingForm.analysisTime || new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                            onChange={e => setReadingForm(f => ({ ...f, analysisTime: e.target.value }))}
                            className="flex-1 px-2 py-1 text-xs font-semibold text-[#333330] border border-[#E8E8E0] rounded-lg bg-white focus:ring-2 focus:ring-[#B87333] outline-none" />
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2.5">
                        <div className="bg-[#FDF8F3] rounded-xl p-3 border border-[#F5E6D3]">
                          <label className="text-[9px] font-bold text-[#B87333] uppercase tracking-wider">Level %</label>
                          <input type="number" step="0.1" value={readingForm.level || ''} onChange={e => setReadingForm(f => ({ ...f, level: e.target.value }))}
                            placeholder="—" className="w-full text-2xl font-black text-[#5C3317] bg-transparent border-none outline-none placeholder-[#E8D5C4] mt-0.5" inputMode="decimal" />
                        </div>
                        <div className="bg-orange-50 rounded-xl p-3 border border-orange-100">
                          <label className="text-[9px] font-bold text-orange-600 uppercase tracking-wider">Temp °C</label>
                          <input type="number" step="0.1" value={readingForm.temp || ''} onChange={e => setReadingForm(f => ({ ...f, temp: e.target.value }))}
                            placeholder="—" className="w-full text-2xl font-black text-orange-900 bg-transparent border-none outline-none placeholder-orange-200 mt-0.5" inputMode="decimal" />
                        </div>
                      </div>
                      <div className={`grid ${isBW ? 'grid-cols-3' : 'grid-cols-4'} gap-1.5`}>
                        {[
                          { key: 'spGravity', label: 'Gravity', step: '0.001' },
                          { key: 'ph', label: 'pH', step: '0.1' },
                          ...(!isBW ? [{ key: 'rs', label: 'RS%', step: '0.01' }, { key: 'rst', label: 'RST%', step: '0.01' }] : []),
                          { key: 'alcohol', label: 'Alc%', step: '0.1' },
                          ...(!isBW ? [{ key: 'ds', label: 'DS%', step: '0.01' }, { key: 'vfaPpa', label: 'VFA', step: '0.01' }] : []),
                        ].map(f => (
                          <div key={f.key}>
                            <label className="text-[8px] font-bold text-[#6B6B63] uppercase tracking-wider">{f.label}</label>
                            <input type="number" step={f.step} value={(readingForm as any)[f.key] || ''}
                              onChange={e => setReadingForm(rf => ({ ...rf, [f.key]: e.target.value }))}
                              className="w-full px-2 py-1.5 text-sm font-semibold text-[#333330] border border-[#E8E8E0] rounded-lg bg-[#FAFAF8] focus:ring-2 focus:ring-[#B87333] focus:border-[#B87333] focus:bg-white outline-none transition-all" inputMode="decimal" />
                          </div>
                        ))}
                      </div>
                      <input placeholder="Remarks..." value={readingForm.remarks || ''} onChange={e => setReadingForm(f => ({ ...f, remarks: e.target.value }))}
                        className="w-full px-2 py-1.5 text-xs border border-[#E8E8E0] rounded-lg bg-[#FAFAF8] outline-none" />
                      <div className="flex gap-2.5">
                        <button onClick={() => saveReading(false)} disabled={saving}
                          className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-1.5 hover:bg-indigo-700 active:scale-[0.98] transition-all">
                          {saving ? <Loader2 size={14} className="animate-spin" /> : <><Send size={13} /> Save</>}
                        </button>
                        <button onClick={() => saveReading(true)} disabled={saving}
                          className="flex-1 py-2.5 bg-green-600 text-white rounded-xl text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-1.5 hover:bg-green-700 active:scale-[0.98] transition-all">
                          {saving ? <Loader2 size={14} className="animate-spin" /> : <><MessageCircle size={13} /> Save & Share</>}
                        </button>
                      </div>
                    </div>
                    {/* Recent readings */}
                    {(() => {
                      const rList = isBW ? getBW(selected.no).map(r => ({ id: r.id, analysisTime: '', spGravity: r.spGravity, ph: r.ph, alcohol: r.alcohol, temp: r.temp, level: r.level, rs: undefined as number | undefined, createdAt: r.createdAt, status: '' })) : readings;
                      return rList.length > 0 && (
                        <div>
                          <div className="text-[9px] font-bold text-[#9C9C94] uppercase mb-1">Recent Readings</div>
                          <div className="space-y-0.5 max-h-64 overflow-y-auto">
                            {rList.slice(-10).reverse().map((r, i) => (
                              editingReading === r.id ? (
                                /* Inline edit row */
                                <div key={r.id} className="bg-yellow-50 rounded-lg p-2 border border-yellow-200 space-y-1.5">
                                  <div className="grid grid-cols-3 gap-1.5">
                                    {[
                                      { k: 'level', l: 'Lvl%' }, { k: 'spGravity', l: 'SG' }, { k: 'ph', l: 'pH' },
                                      { k: 'temp', l: 'Temp' }, { k: 'alcohol', l: 'Alc%' }, { k: 'rs', l: 'RS' },
                                    ].map(f => (
                                      <div key={f.k}>
                                        <label className="text-[7px] font-bold text-[#9C9C94]">{f.l}</label>
                                        <input type="number" step="0.01" value={editForm[f.k] || ''} onChange={e => setEditForm(ef => ({ ...ef, [f.k]: e.target.value }))}
                                          className="w-full px-1 py-0.5 text-[10px] border rounded" />
                                      </div>
                                    ))}
                                  </div>
                                  <div className="flex gap-1.5">
                                    <button onClick={() => saveEditReading(r.id)} className="flex-1 py-1 bg-green-600 text-white text-[10px] font-bold rounded">Save</button>
                                    <button onClick={() => setEditingReading(null)} className="flex-1 py-1 bg-[#E8E8E0] text-[#4A4A44] text-[10px] font-bold rounded">Cancel</button>
                                  </div>
                                </div>
                              ) : (
                                /* Normal row */
                                <div key={r.id || i} className="flex items-center gap-2 px-2.5 py-2 bg-[#FAFAF8]/80 rounded-lg text-[11px] group hover:bg-[#F5F5F0] transition-colors">
                                  <span className="text-[#9C9C94] font-mono text-[10px] w-11 shrink-0">{fmtTime(r.analysisTime || r.createdAt)}</span>
                                  <div className="flex items-center gap-2 flex-1 flex-wrap">
                                    {r.level && <span className="text-[#7C4A21] font-bold bg-[#FDF8F3] px-1.5 py-0.5 rounded">Lvl {r.level}%</span>}
                                    {r.spGravity && <span className="text-indigo-700 font-bold bg-indigo-50 px-1.5 py-0.5 rounded">SG {typeof r.spGravity === 'number' ? r.spGravity.toFixed(3) : r.spGravity}</span>}
                                    {r.ph && <span className="text-[#333330] font-semibold">pH {r.ph}</span>}
                                    {r.temp && <span className={`font-bold px-1.5 py-0.5 rounded ${(r.temp || 0) > 37 ? 'text-red-700 bg-red-50' : 'text-orange-700 bg-orange-50'}`}>{r.temp}°C</span>}
                                    {r.alcohol && <span className="text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.5 rounded">{r.alcohol}%</span>}
                                    {r.status === 'FIELD' && <span className="text-[9px] bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded font-bold">FIELD</span>}
                                  </div>
                                  {r.id && !isBW && (
                                    <div className="flex items-center gap-1 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity">
                                      <button onClick={() => startEditReading(r as any)} className="w-6 h-6 rounded-md bg-[#FDF8F3] hover:bg-[#F5E6D3] flex items-center justify-center text-[#B87333] transition-colors" title="Edit">
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                                      </button>
                                      <button onClick={() => deleteReading(r.id)} className="w-6 h-6 rounded-md bg-red-50 hover:bg-red-100 flex items-center justify-center text-red-500 transition-colors" title="Delete">
                                        <Trash2 size={11} />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* TAB: Dosing */}
                {tab === 'dosing' && !isBW && (
                  <div className="p-3 space-y-3">
                    {(isPF ? recipes.PF : recipes.FERMENTER).length > 0 && dosings.length === 0 && (
                      <button onClick={applyRecipe} disabled={saving}
                        className="w-full py-2 bg-violet-50 text-violet-700 border border-violet-200 rounded-lg text-xs font-bold hover:bg-violet-100 flex items-center justify-center gap-1">
                        <Play size={11} /> Apply Recipe ({(isPF ? recipes.PF : recipes.FERMENTER).length} chemicals)
                      </button>
                    )}
                    {dosings.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-[9px] font-bold text-[#9C9C94] uppercase">Added Chemicals</div>
                        {dosings.map((d: Dosing) => (
                          <div key={d.id} className="flex items-center gap-2 bg-violet-50/50 rounded-lg px-2 py-1.5">
                            <span className="text-xs font-medium text-[#4A4A44] flex-1">{d.chemicalName}</span>
                            <span className="text-xs font-bold text-violet-700">{d.quantity} {d.unit}</span>
                            <button onClick={() => deleteDosing(d.id)} className="text-[#C8C8BE] hover:text-red-500"><Trash2 size={11} /></button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-1.5 items-end">
                      <div className="flex-1">
                        <label className="text-[8px] font-bold text-[#9C9C94]">Chemical</label>
                        <select value={dosingForm.chemicalName} onChange={e => setDosingForm(f => ({ ...f, chemicalName: e.target.value }))}
                          className="w-full px-2 py-1.5 text-xs border rounded-lg bg-white">
                          <option value="">Select...</option>
                          {chemicals.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                        </select>
                      </div>
                      <div className="w-16">
                        <label className="text-[8px] font-bold text-[#9C9C94]">Qty</label>
                        <input type="number" value={dosingForm.quantity} onChange={e => setDosingForm(f => ({ ...f, quantity: e.target.value }))}
                          className="w-full px-2 py-1.5 text-xs border rounded-lg" />
                      </div>
                      <div className="w-14">
                        <label className="text-[8px] font-bold text-[#9C9C94]">Unit</label>
                        <select value={dosingForm.unit} onChange={e => setDosingForm(f => ({ ...f, unit: e.target.value }))}
                          className="w-full px-2 py-1.5 text-xs border rounded-lg bg-white">
                          {['kg', 'ltr', 'gm', 'ml'].map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </div>
                      <button onClick={addDosing} disabled={saving || !dosingForm.chemicalName || !dosingForm.quantity}
                        className="px-3 py-1.5 bg-violet-600 text-white rounded-lg text-xs font-bold disabled:opacity-50">
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>
                )}

                {/* TAB: Charts */}
                {tab === 'charts' && !isBW && (
                  <div className="p-3 space-y-3">
                    {readings.length < 2 ? (
                      <p className="text-center text-[#9C9C94] text-xs py-8">Need 2+ readings for charts</p>
                    ) : (
                      <>
                        <div>
                          <div className="text-[9px] font-bold text-[#9C9C94] uppercase mb-1">Gravity & Alcohol</div>
                          <ResponsiveContainer width="100%" height={180}>
                            <LineChart data={readings.map(r => ({ time: fmtTime(r.analysisTime || r.createdAt), sg: r.spGravity, alc: r.alcohol }))}>
                              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                              <XAxis dataKey="time" tick={{ fontSize: 9 }} />
                              <YAxis yAxisId="sg" tick={{ fontSize: 9 }} />
                              <YAxis yAxisId="alc" orientation="right" tick={{ fontSize: 9 }} />
                              <Tooltip contentStyle={{ fontSize: 10 }} />
                              <Legend wrapperStyle={{ fontSize: 9 }} />
                              <Line yAxisId="sg" dataKey="sg" name="Gravity" stroke="#6366f1" strokeWidth={2} dot={{ r: 2 }} />
                              <Line yAxisId="alc" dataKey="alc" name="Alcohol%" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                        <div>
                          <div className="text-[9px] font-bold text-[#9C9C94] uppercase mb-1">pH & Temperature</div>
                          <ResponsiveContainer width="100%" height={150}>
                            <LineChart data={readings.map(r => ({ time: fmtTime(r.analysisTime || r.createdAt), ph: r.ph, temp: r.temp }))}>
                              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                              <XAxis dataKey="time" tick={{ fontSize: 9 }} />
                              <YAxis yAxisId="ph" tick={{ fontSize: 9 }} />
                              <YAxis yAxisId="temp" orientation="right" tick={{ fontSize: 9 }} />
                              <Tooltip contentStyle={{ fontSize: 10 }} />
                              <Legend wrapperStyle={{ fontSize: 9 }} />
                              <Line yAxisId="ph" dataKey="ph" name="pH" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} />
                              <Line yAxisId="temp" dataKey="temp" name="Temp°C" stroke="#ef4444" strokeWidth={2} dot={{ r: 2 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* TAB: Batch */}
                {tab === 'batch' && !isBW && batch && (
                  <div className="p-3 space-y-3">
                    {/* Phase timeline */}
                    <div>
                      <div className="text-[9px] font-bold text-[#9C9C94] uppercase mb-1.5">Phase Timeline</div>
                      <div className="flex items-center gap-0.5">
                        {(isPF ? PF_PHASES : FERM_PHASES).map((p, i) => {
                          const pCfg = phCfg(p);
                          const phaseList = isPF ? PF_PHASES : FERM_PHASES;
                          const ci = phaseList.indexOf(phase);
                          return (
                            <div key={p} className={`flex-1 text-center py-1 rounded text-[7px] font-bold ${
                              i < ci ? 'bg-green-100 text-green-600' : i === ci ? `${pCfg.bg} ${pCfg.text} ring-1 ${pCfg.ring}` : 'bg-[#FAFAF8] text-[#C8C8BE]'
                            }`}>{pCfg.label}</div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Setup info */}
                    {isPF && (batch as PFBatch).slurryVolume && (
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="bg-indigo-50 rounded-lg p-1.5"><div className="text-[8px] text-indigo-400 font-bold">Volume</div><div className="text-xs font-bold text-indigo-700">{((batch as PFBatch).slurryVolume! / 1000).toFixed(0)} KL</div></div>
                        {(batch as PFBatch).slurryGravity && <div className="bg-indigo-50 rounded-lg p-1.5"><div className="text-[8px] text-indigo-400 font-bold">Gravity</div><div className="text-xs font-bold text-indigo-700">{(batch as PFBatch).slurryGravity!.toFixed(3)}</div></div>}
                        {(batch as PFBatch).slurryTemp && <div className="bg-indigo-50 rounded-lg p-1.5"><div className="text-[8px] text-indigo-400 font-bold">Temp</div><div className="text-xs font-bold text-indigo-700">{(batch as PFBatch).slurryTemp}°C</div></div>}
                      </div>
                    )}
                    {isFerm && (
                      <div className="grid grid-cols-3 gap-2 text-center">
                        {(batch as FermBatch).fermLevel && <div className="bg-[#FDF8F3] rounded-lg p-1.5"><div className="text-[8px] text-[#D4A574] font-bold">Level</div><div className="text-xs font-bold text-[#7C4A21]">{(batch as FermBatch).fermLevel}%</div></div>}
                        {(batch as FermBatch).setupGravity && <div className="bg-indigo-50 rounded-lg p-1.5"><div className="text-[8px] text-indigo-400 font-bold">Setup SG</div><div className="text-xs font-bold text-indigo-700">{(batch as FermBatch).setupGravity!.toFixed(3)}</div></div>}
                        {(batch as FermBatch).finalAlcohol && <div className="bg-emerald-50 rounded-lg p-1.5"><div className="text-[8px] text-emerald-400 font-bold">Final Alc</div><div className="text-xs font-bold text-emerald-700">{(batch as FermBatch).finalAlcohol}%</div></div>}
                      </div>
                    )}

                    {/* Phase actions */}
                    <div className="space-y-1.5">
                      <div className="text-[9px] font-bold text-[#9C9C94] uppercase">Actions</div>
                      {isPF && (phase === 'LAB' || phase === 'TRANSFER') && (
                        <div>
                          <div className="text-[10px] text-[#4A4A44] mb-1">Transfer to Fermenter:</div>
                          <div className="flex gap-1.5 flex-wrap">
                            {freeFermenters.map(fn => (
                              <button key={fn} onClick={() => transferPF(batch!.id, fn)} disabled={saving}
                                className="px-3 py-1.5 bg-[#B87333] text-white rounded-lg text-xs font-bold disabled:opacity-50">
                                {saving ? <Loader2 size={12} className="animate-spin" /> : `→ F-${fn}`}
                              </button>
                            ))}
                            {freeFermenters.length === 0 && <span className="text-xs text-[#9C9C94]">No free fermenters</span>}
                          </div>
                        </div>
                      )}
                      {isPF && phase === 'SETUP' && <button onClick={() => advancePhase('PF', batch!.id, 'DOSING')} disabled={saving} className="w-full py-2 bg-violet-600 text-white rounded-lg text-xs font-bold disabled:opacity-50">→ Start Dosing</button>}
                      {isPF && phase === 'DOSING' && <button onClick={() => advancePhase('PF', batch!.id, 'LAB')} disabled={saving} className="w-full py-2 bg-cyan-600 text-white rounded-lg text-xs font-bold disabled:opacity-50">→ Lab Monitoring</button>}
                      {isPF && phase === 'TRANSFER' && <button onClick={() => advancePhase('PF', batch!.id, 'CIP', { cipStartTime: new Date().toISOString() })} disabled={saving} className="w-full py-2 bg-purple-600 text-white rounded-lg text-xs font-bold disabled:opacity-50">→ Start CIP</button>}
                      {isPF && phase === 'CIP' && <button onClick={() => advancePhase('PF', batch!.id, 'DONE', { cipEndTime: new Date().toISOString() })} disabled={saving} className="w-full py-2 bg-[#7C4A21] text-white rounded-lg text-xs font-bold disabled:opacity-50">→ Complete</button>}

                      {isFerm && phase === 'FILLING' && <button onClick={() => advancePhase('FERM', batch!.id, 'REACTION', { reactionStartTime: new Date().toISOString(), fillingEndTime: new Date().toISOString() })} disabled={saving} className="w-full py-2 bg-amber-600 text-white rounded-lg text-xs font-bold disabled:opacity-50">→ Start Reaction</button>}
                      {isFerm && phase === 'REACTION' && <button onClick={() => advancePhase('FERM', batch!.id, 'RETENTION', { retentionStartTime: new Date().toISOString() })} disabled={saving} className="w-full py-2 bg-orange-600 text-white rounded-lg text-xs font-bold disabled:opacity-50">→ Start Retention</button>}
                      {isFerm && phase === 'RETENTION' && (
                        <>
                          {(batch as FermBatch).retentionStartTime && <div className="text-[10px] text-[#6B6B63]">Retention: {elapsed((batch as FermBatch).retentionStartTime)} elapsed{settings.fermRetentionHours ? ` / ${settings.fermRetentionHours}h target` : ''}</div>}
                          <button onClick={() => advancePhase('FERM', batch!.id, 'TRANSFER', { transferTime: new Date().toISOString() })} disabled={saving} className="w-full py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold disabled:opacity-50">→ Transfer to Beer Well</button>
                        </>
                      )}
                      {isFerm && phase === 'TRANSFER' && <button onClick={() => advancePhase('FERM', batch!.id, 'CIP', { cipStartTime: new Date().toISOString() })} disabled={saving} className="w-full py-2 bg-purple-600 text-white rounded-lg text-xs font-bold disabled:opacity-50">→ Start CIP</button>}
                      {isFerm && phase === 'CIP' && <button onClick={() => advancePhase('FERM', batch!.id, 'DONE', { cipEndTime: new Date().toISOString() })} disabled={saving} className="w-full py-2 bg-[#7C4A21] text-white rounded-lg text-xs font-bold disabled:opacity-50">→ Complete</button>}
                    </div>
                    {/* Delete batch */}
                    <button onClick={deleteBatch} className="w-full py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-semibold hover:bg-red-100 flex items-center justify-center gap-1.5 mt-2">
                      <Trash2 size={12} /> Delete Batch #{batchNo}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}
