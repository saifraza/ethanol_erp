import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FlaskConical, Beaker, Cylinder, RefreshCw, Loader2, CheckCircle, AlertCircle,
  Plus, Trash2, Send, ChevronDown, Clock, Play, X, MessageCircle, History, RotateCcw
} from 'lucide-react';
import { ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine, Brush } from 'recharts';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { FERM_CAPACITY_KL } from '../../config/constants';

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
  { type: 'BW', no: 1, label: 'BW-1' },
];

const PHASE_CFG: Record<string, { label: string; bg: string; text: string; ring: string; dot: string }> = {
  IDLE:           { label: 'Idle',       bg: 'bg-slate-50',    text: 'text-slate-400',   ring: 'ring-slate-200',   dot: 'bg-slate-300' },
  SETUP:          { label: 'Setup',      bg: 'bg-indigo-50',   text: 'text-indigo-700',  ring: 'ring-indigo-400',  dot: 'bg-indigo-500' },
  DOSING:         { label: 'Dosing',     bg: 'bg-violet-50',   text: 'text-violet-700',  ring: 'ring-violet-400',  dot: 'bg-violet-500' },
  LAB:            { label: 'Lab',        bg: 'bg-cyan-50',     text: 'text-cyan-700',    ring: 'ring-cyan-400',    dot: 'bg-cyan-500' },
  PF_TRANSFER:    { label: 'PF Xfer',   bg: 'bg-blue-50',     text: 'text-blue-700',    ring: 'ring-blue-400',    dot: 'bg-blue-500' },
  FILLING:        { label: 'Filling',    bg: 'bg-sky-50',      text: 'text-sky-700',     ring: 'ring-sky-400',     dot: 'bg-sky-500 animate-pulse' },
  REACTION:       { label: 'Reaction',   bg: 'bg-amber-50',    text: 'text-amber-800',   ring: 'ring-amber-400',   dot: 'bg-amber-500 animate-pulse' },
  RETENTION:      { label: 'Retention',  bg: 'bg-orange-50',   text: 'text-orange-800',  ring: 'ring-orange-400',  dot: 'bg-orange-500 animate-pulse' },
  TRANSFER:       { label: 'Transfer',   bg: 'bg-emerald-50',  text: 'text-emerald-700', ring: 'ring-emerald-400', dot: 'bg-emerald-500' },
  CIP:            { label: 'CIP',        bg: 'bg-purple-50',   text: 'text-purple-700',  ring: 'ring-purple-400',  dot: 'bg-purple-500' },
  DONE:           { label: 'Done',       bg: 'bg-gray-50',     text: 'text-gray-500',    ring: 'ring-gray-300',    dot: 'bg-gray-400' },
};
const phCfg = (p: string) => PHASE_CFG[p] || PHASE_CFG.IDLE;

const PF_PHASES = ['SETUP', 'DOSING', 'LAB', 'TRANSFER', 'CIP', 'DONE'];
const FERM_PHASES = ['PF_TRANSFER', 'FILLING', 'REACTION', 'RETENTION', 'CIP', 'DONE'];

const fmtTime = (iso?: string) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
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
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
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
  const [tab, setTab] = useState<'reading' | 'charts'>('reading');
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);

  const [readingForm, setReadingForm] = useState<Record<string, string>>({});
  const [dosingForm, setDosingForm] = useState({ chemicalName: '', quantity: '', unit: 'kg' });
  const [newBatchForm, setNewBatchForm] = useState({ batchNo: '', pfLevel: '', slurryGravity: '', slurryTemp: '' });
  const [showNewBatch, setShowNewBatch] = useState(false);
  const [pfHistory, setPfHistory] = useState<any[]>([]);
  const [fermHistory, setFermHistory] = useState<any[]>([]);
  const [historyTab, setHistoryTab] = useState<'ferm' | 'pf' | 'bw'>('ferm');
  const [bwHistory, setBwHistory] = useState<BeerWellReading[]>([]);
  const [opcLoading, setOpcLoading] = useState(false);
  const [expandedHist, setExpandedHist] = useState<string | null>(null);

  // Y-Zoom states for each chart
  const [yZoomGravity, setYZoomGravity] = useState(0);
  const [yZoomPhTemp, setYZoomPhTemp] = useState(0);
  const [yZoomHistGravity, setYZoomHistGravity] = useState(0);

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
          const r = await api.get(`/fermentation/batch/${fb.batchNo}?fermenterNo=${fb.fermenterNo}`);
          entries[fb.fermenterNo] = r.data || [];
        } catch { entries[fb.fermenterNo] = []; }
      }
      setFermEntries(entries);
      // Load history (non-blocking)
      api.get('/fermentation/history').then(h => {
        setPfHistory(h.data.pfHistory || []);
        setFermHistory(h.data.fermHistory || []);
      }).catch(() => {});
      api.get('/fermentation/beer-well').then(h => {
        setBwHistory(h.data.readings || []);
      }).catch(() => {});
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

  /* ── OPC Prefill helper — returns form with level+temp from live OPC if fresh ── */
  const opcPrefill = (vessel: Vessel | null): Record<string, string> => {
    if (!vessel) return {};
    const opc = opcData[vessel.label];
    if (!opc?.updatedAt) return {};
    const ageMs = Date.now() - new Date(opc.updatedAt).getTime();
    if (ageMs > 15 * 60 * 1000) return {};
    const fill: Record<string, string> = {};
    if (opc.level != null) fill.level = String(opc.level);
    if (opc.temp != null) fill.temp = String(opc.temp);
    return fill;
  };

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
        const { data: labRes } = await api.post('/fermentation/lab-reading', {
          vesselType: selected.type, vesselNo: selected.no,
          analysisTime,
          level: f.level ? +f.level : undefined, spGravity: f.spGravity ? +f.spGravity : undefined,
          ph: f.ph ? +f.ph : undefined, rs: f.rs ? +f.rs : undefined, rst: f.rst ? +f.rst : undefined,
          alcohol: f.alcohol ? +f.alcohol : undefined, ds: f.ds ? +f.ds : undefined,
          vfaPpa: f.vfaPpa ? +f.vfaPpa : undefined, temp: f.temp ? +f.temp : undefined,
          remarks: f.remarks || undefined,
        });
        // Auto-advanced FILLING → REACTION (2 consecutive same levels)
        if (labRes?.autoAdvanced) {
          flash('ok', `${selected.label} saved ✓ · Filling complete → Reaction started`);
          load(); setSaving(false); setReadingForm(opcPrefill(selected));
          return;
        }
        // PF ready to transfer hint
        if (labRes?.readyToTransfer) {
          flash('ok', `${selected.label} saved ✓ · Ready to transfer (SG ≤ ${labRes.gravityTarget})`);
          load(); setSaving(false); setReadingForm(opcPrefill(selected));
          return;
        }
      }
      // Auto-advance fermenter REACTION → RETENTION when SG ≤ 1.0
      if (selected.type === 'FERM' && f.spGravity && +f.spGravity <= 1.0) {
        const batch = getVesselBatch(selected);
        if (batch && batch.phase === 'REACTION') {
          try {
            await api.patch(`/fermentation/batches/${batch.id}`, { phase: 'RETENTION', retentionStartTime: new Date().toISOString() });
            flash('ok', `${selected.label} saved ✓ · Auto → Retention (SG ≤ 1.0)`);
          } catch { flash('ok', `${selected.label} saved ✓ (auto-retention failed)`); }
        } else {
          flash('ok', `${selected.label} saved ✓`);
        }
      } else {
        flash('ok', `${selected.label} saved ✓`);
      }
      if (andShare) {
        const batch = getVesselBatch(selected);
        const text = buildVesselReport(selected, batch, f);
        try {
          await api.post('/telegram/send-report', { message: text, module: 'fermentation' });
          flash('ok', 'Shared on Telegram');
        } catch { flash('err', 'Telegram send failed'); }
      }
      setReadingForm(opcPrefill(selected));
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
          pfLevel: pfLvl > 0 ? pfLvl : undefined,
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
      // Auto-advance any FILLING fermenters to REACTION
      const fillingBatches = fermBatches.filter(b => b.phase === 'FILLING');
      for (const fb of fillingBatches) {
        try {
          await api.patch(`/fermentation/batches/${fb.id}`, { phase: 'REACTION', reactionStartTime: new Date().toISOString(), fillingEndTime: new Date().toISOString() });
        } catch {}
      }
      if (fillingBatches.length > 0) flash('ok', `${selected.label} Batch #${bn} started · F-${fillingBatches.map(b => b.fermenterNo).join(',')} auto → Reaction`);
      else flash('ok', `${selected.label} Batch #${bn} started`);
      setShowNewBatch(false); setNewBatchForm({ batchNo: '', pfLevel: '', slurryGravity: '', slurryTemp: '' });
      load();
    } catch (e: any) { flash('err', e?.response?.data?.error || 'Failed'); }
    setSaving(false);
  };

  const transferPF = async (pfBatchId: string, fermNo: number) => {
    setSaving(true);
    try {
      // Auto-advance any FILLING fermenters to REACTION before transfer
      const fillingBatches = fermBatches.filter(b => b.phase === 'FILLING');
      for (const fb of fillingBatches) {
        try {
          await api.patch(`/fermentation/batches/${fb.id}`, { phase: 'REACTION', reactionStartTime: new Date().toISOString(), fillingEndTime: new Date().toISOString() });
        } catch {}
      }
      await api.post('/fermentation/transfer-pf', { pfBatchId, fermenterNo: fermNo });
      const autoMsg = fillingBatches.length > 0 ? ` · F-${fillingBatches.map(b => b.fermenterNo).join(',')} auto → Reaction` : '';
      flash('ok', `Transferred to F-${fermNo} ✓${autoMsg}`);
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

  const [editingDosing, setEditingDosing] = useState<string | null>(null);
  const [editDosingQty, setEditDosingQty] = useState('');
  const [dosingExpanded, setDosingExpanded] = useState(false);

  const updateDosing = async (dosingId: string) => {
    if (!selected || !editDosingQty) return;
    try {
      const url = selected.type === 'PF' ? `/pre-fermentation/dosing/${dosingId}` : `/fermentation/dosing/${dosingId}`;
      await api.patch(url, { quantity: +editDosingQty });
      setEditingDosing(null);
      flash('ok', 'Qty updated');
      load();
    } catch { flash('err', 'Update failed'); }
  };

  const deleteReading = async (readingId: string) => {
    if (!selected || !confirm('Delete this reading?')) return;
    try {
      const url = selected.type === 'PF' ? `/pre-fermentation/lab/${readingId}` : selected.type === 'BW' ? `/fermentation/beer-well/${readingId}` : `/fermentation/${readingId}`;
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
      const url = selected.type === 'PF' ? `/pre-fermentation/lab/${readingId}` : selected.type === 'BW' ? `/fermentation/beer-well/${readingId}` : `/fermentation/${readingId}`;
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

  /* ── OPC Live Data ── */
  // Maps vessel labels to OPC tags for level and temp
  const OPC_TAG_MAP: Record<string, { level?: string; temp?: string }> = {
    'PF-1': { level: 'LT130101', temp: 'TE130101' },
    'PF-2': { level: 'LT130102', temp: 'TE130102' },
    'F-1':  { level: 'LT130201', temp: 'TE130201' },
    'F-2':  { level: 'LT130202', temp: 'TE130202' },
    'F-3':  { level: 'LT130301', temp: 'TE130301' },
    'F-4':  { level: 'LT130302', temp: 'TE130302' },
    'BW-1': { level: 'LT130401' },
  };

  interface OpcVesselData { level?: number; temp?: number; updatedAt?: string; }
  const [opcData, setOpcData] = useState<Record<string, OpcVesselData>>({});

  // Wash summary (9 AM to 9 AM)
  const [washSummary, setWashSummary] = useState<{
    today: { totalWashKL: number; hoursIntoShift: number; feed?: { totalFeedKL: number; avgFlowRate: number } };
    yesterday: { totalWashKL: number; feed?: { totalFeedKL: number; avgFlowRate: number } };
  } | null>(null);
  const fetchWashSummary = useCallback(async () => {
    try {
      const res = await api.get('/opc/wash-summary');
      setWashSummary(res.data);
    } catch { /* unavailable */ }
  }, []);

  // Fermenter phase detection from OPC
  interface FermPhase { fermenterNo: number; label: string; detectedPhase: string; confidence: string; slope: number; alarmEnabled: boolean; }
  const [fermPhases, setFermPhases] = useState<Record<string, FermPhase>>({});
  const PHASE_STYLE: Record<string, { bg: string; text: string; icon: string }> = {
    EMPTY: { bg: 'bg-gray-100 border-gray-300', text: 'text-gray-500', icon: '' },
    STEAMING: { bg: 'bg-red-50 border-red-300', text: 'text-red-600', icon: '♨' },
    FILLING: { bg: 'bg-sky-50 border-sky-300', text: 'text-sky-700', icon: '↑' },
    REACTION: { bg: 'bg-amber-50 border-amber-300', text: 'text-amber-700', icon: '⚗' },
    DRAINING: { bg: 'bg-emerald-50 border-emerald-300', text: 'text-emerald-700', icon: '↓' },
    UNKNOWN: { bg: 'bg-gray-50 border-gray-200', text: 'text-gray-400', icon: '?' },
  };

  // Fetch OPC data for all vessels on page load
  const fetchAllOpcData = useCallback(async () => {
    try {
      const res = await api.get('/opc/live');
      const tags: { tag: string; values: Record<string, number>; updatedAt: string }[] = res.data?.tags || [];
      if (!tags.length) return;

      // Build tag->value lookup
      const tagValues: Record<string, { value: number; updatedAt: string }> = {};
      for (const t of tags) {
        const val = t.values?.IO_VALUE ?? t.values?.PV;
        if (val != null) tagValues[t.tag] = { value: val, updatedAt: t.updatedAt };
      }

      // Map to vessels
      const result: Record<string, OpcVesselData> = {};
      for (const [vessel, mapping] of Object.entries(OPC_TAG_MAP)) {
        const data: OpcVesselData = {};
        if (mapping.level && tagValues[mapping.level]) {
          data.level = Math.round(tagValues[mapping.level].value * 100) / 100;
          data.updatedAt = tagValues[mapping.level].updatedAt;
        }
        if (mapping.temp && tagValues[mapping.temp]) {
          data.temp = Math.round(tagValues[mapping.temp].value * 100) / 100;
          if (!data.updatedAt) data.updatedAt = tagValues[mapping.temp].updatedAt;
        }
        if (data.level != null || data.temp != null) result[vessel] = data;
      }
      setOpcData(result);
    } catch { /* OPC unavailable, no-op */ }
  }, []);

  const fetchFermPhases = useCallback(async () => {
    try {
      const res = await api.get('/opc/fermenter-phases');
      const map: Record<string, FermPhase> = {};
      for (const p of (res.data?.phases || [])) {
        map[p.label] = p;
      }
      setFermPhases(map);
    } catch { /* unavailable */ }
  }, []);

  useEffect(() => {
    fetchAllOpcData();
    fetchFermPhases();
    fetchWashSummary();
    const iv = setInterval(() => { fetchAllOpcData(); fetchFermPhases(); fetchWashSummary(); }, 60000); // Refresh every 60s
    return () => clearInterval(iv);
  }, [fetchAllOpcData]);

  // OPC History for live charts
  interface OpcHistoryPoint { hour: string; avg: number; min: number; max: number; }
  const [opcHistory, setOpcHistory] = useState<Record<string, OpcHistoryPoint[]>>({});
  const [opcHistoryLoading, setOpcHistoryLoading] = useState(false);

  const fetchOpcHistory = useCallback(async () => {
    try {
      setOpcHistoryLoading(true);
      const allHistory: Record<string, OpcHistoryPoint[]> = {};
      const tagPairs = Object.entries(OPC_TAG_MAP).filter(([, m]) => m.level);
      await Promise.all(tagPairs.map(async ([vessel, mapping]) => {
        try {
          const prop = mapping.level!.startsWith('FCV') ? 'PV' : 'IO_VALUE';
          const res = await api.get(`/opc/history/${mapping.level}?hours=24&property=${prop}`);
          const readings = res.data?.readings || (Array.isArray(res.data) ? res.data : []);
          if (readings.length > 0) {
            allHistory[vessel] = readings;
          }
        } catch { /* skip */ }
      }));
      setOpcHistory(allHistory);
    } catch { /* skip */ }
    finally { setOpcHistoryLoading(false); }
  }, []);

  useEffect(() => { fetchOpcHistory(); }, [fetchOpcHistory]);

  const fetchOpcLive = async (vesselLabel: string) => {
    const mapping = OPC_TAG_MAP[vesselLabel];
    if (!mapping?.level) { flash('err', `No OPC tag mapped for ${vesselLabel}`); return; }
    setOpcLoading(true);
    try {
      const res = await api.get(`/opc/live/${mapping.level}`);
      const val = res.data?.values?.IO_VALUE ?? res.data?.values?.PV;
      if (val != null) {
        const rounded = Math.round(val * 100) / 100;
        setReadingForm(f => ({ ...f, level: String(rounded) }));
        // Also fetch temp if mapped
        if (mapping.temp) {
          try {
            const tempRes = await api.get(`/opc/live/${mapping.temp}`);
            const tempVal = tempRes.data?.values?.IO_VALUE ?? tempRes.data?.values?.PV;
            if (tempVal != null) setReadingForm(f => ({ ...f, temp: String(Math.round(tempVal * 100) / 100) }));
          } catch { /* temp unavailable */ }
        }
        const ago = res.data?.updatedAt ? Math.round((Date.now() - new Date(res.data.updatedAt).getTime()) / 1000) : null;
        flash('ok', `Level: ${rounded}%${ago ? ` (${ago < 60 ? `${ago}s` : `${Math.round(ago / 60)}m`} ago)` : ''}`);
      } else {
        flash('err', 'No OPC reading available');
      }
    } catch { flash('err', 'OPC data unavailable'); }
    finally { setOpcLoading(false); }
  };

  const fmtOpcAgo = (iso?: string) => {
    if (!iso) return '';
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.round(s / 60)}m`;
    return `${Math.round(s / 3600)}h`;
  };

  /* ── Telegram Sharing helpers ── */
  const getLatestReading = (v: Vessel, batch: any): LabReading | null => {
    if (v.type === 'FERM') {
      const entries = fermEntries[v.no] || [];
      return entries[entries.length - 1] || null;
    }
    if (v.type === 'PF') {
      const readings = batch?.labReadings || [];
      return readings[readings.length - 1] || null;
    }
    return null;
  };

  const buildVesselReport = (v: Vessel, batch: any, formReading?: Record<string, string>): string => {
    const lines: string[] = [];

    // Beer Well — no batch object, use form reading or latest BW reading
    if (v.type === 'BW') {
      lines.push(`*Beerwell = ${String(v.no).padStart(2, '0')}*`);
      const bw = getBW(v.no);
      const lvl = formReading?.level || (bw[0]?.level != null ? String(bw[0].level) : '');
      const sg = formReading?.spGravity || (bw[0]?.spGravity != null ? String(bw[0].spGravity) : '');
      const ph = formReading?.ph || (bw[0]?.ph != null ? String(bw[0].ph) : '');
      const alc = formReading?.alcohol || (bw[0]?.alcohol != null ? String(bw[0].alcohol) : '');
      const temp = formReading?.temp || (bw[0]?.temp != null ? String(bw[0].temp) : '');
      const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
      lines.push(`Time = ${time}`);
      if (lvl) lines.push(`Level = ${lvl}%`);
      if (sg) lines.push(`Sp Gravity = ${sg}`);
      if (ph) lines.push(`pH = ${ph}`);
      if (alc) lines.push(`Alcohol = ${alc}%`);
      if (temp) lines.push(`Temp = ${temp}`);
      return lines.join('\n');
    }

    // Non-BW vessels
    const status = batch ? phCfg(batch.phase).label.toUpperCase() : 'EMPTY';
    const typeLabel = v.type === 'PF' ? 'PF' : 'Fermenter';
    lines.push(`*${typeLabel} = ${String(v.no).padStart(2, '0')} (${status})*`);

    if (!batch) return lines.join('\n');

    lines.push(`Batch = ${batch.batchNo}`);

    // Use form reading if provided, otherwise latest from state
    const r = formReading ? null : getLatestReading(v, batch);
    const val = (field: string): string => {
      if (formReading && formReading[field]) return formReading[field];
      if (r && (r as Record<string, unknown>)[field] != null) return String((r as Record<string, unknown>)[field]);
      return '';
    };
    const sg = val('spGravity');
    const ph = val('ph');
    const temp = val('temp');
    const level = val('level') || (batch.fermLevel ? String(batch.fermLevel) : '');
    const alc = val('alcohol');
    const rs = val('rs');
    const rst = val('rst');
    const ds = val('ds');
    const vfaPpa = val('vfaPpa');

    // Include reading time
    const readingTime = formReading?.analysisTime
      ? new Date(formReading.analysisTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
      : r?.analysisTime
        ? new Date(r.analysisTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
        : new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    lines.push(`Time = ${readingTime}`);

    // Only include fields that have values
    if (sg) lines.push(`Sp Gravity = ${sg}`);
    if (ph) lines.push(`pH = ${ph}`);
    if (temp) lines.push(`Temp = ${temp}`);
    if (level) lines.push(`Level = ${level}%`);
    if (alc) lines.push(`Alcohol = ${alc}%`);
    if (rs) lines.push(`RS = ${rs}%`);
    if (rst) lines.push(`RST = ${rst}%`);
    if (ds) lines.push(`DS = ${ds}%`);
    if (vfaPpa) lines.push(`VFA/PPA = ${vfaPpa}`);

    return lines.join('\n');
  };

  const shareVessel = async (v: Vessel, e?: React.MouseEvent) => {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    const batch = v.type === 'PF' ? getActivePF(v.no) : v.type === 'FERM' ? getActiveFerm(v.no) : null;
    const text = buildVesselReport(v, batch);
    try {
      await api.post('/telegram/send-report', { message: text, module: 'fermentation' });
      flash('ok', `${v.label} shared on Telegram`);
    } catch { flash('err', 'Telegram send failed'); }
  };

  const shareAllFermentation = async () => {
    const now = new Date();
    const time = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    const date = now.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const lines: string[] = [
      `*Fermentation Section Report*`,
      `*Time = ${time}*`,
      `*Date = ${date}*`,
    ];

    // Fermenters first
    for (const v of ALL_VESSELS.filter(v => v.type === 'FERM')) {
      const batch = getActiveFerm(v.no);
      const status = batch ? phCfg(batch.phase).label.toUpperCase() : 'EMPTY';
      lines.push(`*Fermenter = ${String(v.no).padStart(2, '0')} (${status})*`);
      lines.push(`Batch = ${batch?.batchNo || '—'}`);
      if (batch) {
        const r = getLatestReading(v, batch);
        const sg = r?.spGravity;
        const ph = r?.ph;
        const temp = r?.temp;
        const level = r?.level ?? batch.fermLevel;
        const alc = r?.alcohol;
        const rs = r?.rs;
        if (r?.analysisTime) {
          const rTime = new Date(r.analysisTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
          lines.push(`Reading Time = ${rTime}`);
        }
        lines.push(`Sp Gravity = ${sg ?? '—'}`);
        lines.push(`pH = ${ph ?? '—'}`);
        lines.push(`Temp = ${temp ?? '—'}`);
        lines.push(`Level = ${level ? `${level}%` : '—'}`);
        if (alc) lines.push(`Alcohol = ${alc}%`);
        if (rs) lines.push(`RS = ${rs}%`);
      } else {
        lines.push(`Sp Gravity =`);
        lines.push(`pH =`);
        lines.push(`Temp =`);
        lines.push(`Level =`);
      }
    }

    // PF vessels
    for (const v of ALL_VESSELS.filter(v => v.type === 'PF')) {
      const batch = getActivePF(v.no);
      const status = batch ? phCfg(batch.phase).label.toUpperCase() : 'EMPTY';
      lines.push(`*PF = ${String(v.no).padStart(2, '0')} (${status})*`);
      if (batch) {
        const r = getLatestReading(v, batch);
        const sg = r?.spGravity ?? batch.slurryGravity;
        lines.push(`Gravity = ${sg ?? '—'}`);
        if (r?.ph) lines.push(`pH = ${r.ph}`);
        if (r?.temp) lines.push(`Temp = ${r.temp}`);
        if (r?.level || batch.pfLevel) lines.push(`Level = ${r?.level ?? batch.pfLevel}%`);
      }
    }

    // Beerwell
    for (const v of ALL_VESSELS.filter(v => v.type === 'BW')) {
      const bw = getBW(v.no);
      lines.push(`*Beerwell Level = ${bw[0]?.level ?? '—'}${bw[0]?.level ? '%' : ''}*`);
      if (bw[0]?.alcohol) lines.push(`Beerwell Alcohol = ${bw[0].alcohol}%`);
    }

    try {
      await api.post('/telegram/send-report', { message: lines.join('\n'), module: 'fermentation' });
      flash('ok', 'Full report shared on Telegram');
    } catch { flash('err', 'Telegram send failed'); }
  };

  /* ═══ RENDER ═══ */
  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <Loader2 size={32} className="animate-spin text-indigo-500" />
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <div className="bg-gradient-to-br from-indigo-900 via-purple-900 to-violet-900 text-white px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-extrabold flex items-center gap-2 tracking-tight"><FlaskConical size={20} /> Fermentation</h1>
          <div className="flex items-center gap-3">
            <span className="text-xs text-indigo-300 font-medium">{new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
            <button onClick={shareAllFermentation} title="Share all fermentation status on Telegram"
              className="p-1.5 rounded-lg bg-green-600 hover:bg-green-500 active:bg-green-700 transition-colors">
              <MessageCircle size={16} />
            </button>
            <button onClick={() => { setLoading(true); load(); }} className="p-1.5 rounded-lg hover:bg-white/10 active:bg-white/20 transition-colors"><RefreshCw size={16} /></button>
          </div>
        </div>
      </div>

      {msg && (
        <div className={`mx-3 mt-2 rounded-lg p-2 text-xs flex items-center gap-1.5 ${msg.t === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {msg.t === 'ok' ? <CheckCircle size={12} /> : <AlertCircle size={12} />} {msg.m}
        </div>
      )}

      {/* ═══ WASH SUMMARY ═══ */}
      {(() => {
        // Check if OPC data is fresh (< 10 min)
        const anyOpc = opcData['F-1'] || opcData['F-2'] || opcData['F-3'] || opcData['F-4'];
        const opcStale = anyOpc?.updatedAt ? (Date.now() - new Date(anyOpc.updatedAt).getTime()) > 10 * 60 * 1000 : true;

        // Calculate current wash from OPC live levels
        const fermLabels = ['F-1', 'F-2', 'F-3', 'F-4'];
        let totalWashKL = 0;
        let fermCount = 0;
        const vesselWash: { label: string; level: number; washKL: number }[] = [];
        for (const label of fermLabels) {
          const opc = opcData[label];
          if (opc?.level != null) {
            const washKL = (opc.level / 100) * FERM_CAPACITY_KL;
            totalWashKL += washKL;
            fermCount++;
            vesselWash.push({ label, level: opc.level, washKL });
          }
        }
        // PF vessels
        let pfWashKL = 0;
        for (const label of ['PF-1', 'PF-2']) {
          const opc = opcData[label];
          if (opc?.level != null) pfWashKL += (opc.level / 100) * 430;
        }
        // Beer well + BW flow from FE130701
        const bwOpc = opcData['BW-1'];
        const bwWashKL = bwOpc?.level != null ? (bwOpc.level / 100) * 430 : 0;
        // Get BW flow rate from OPC live tags (FE130701)
        let bwFlowRate: number | null = null;
        // BW flow is not in opcData (only mapped for level/temp), check raw OPC tags
        // We'll show it if available from fermPhases or opcData

        const totalSystemKL = totalWashKL + pfWashKL + bwWashKL;
        const maxCapKL = 4 * FERM_CAPACITY_KL + 2 * 430 + 430; // 4 fermenters + 2 PF + BW

        if (fermCount === 0) return null;
        return (
          <div className="px-3 pt-3">
            <div className="grid grid-cols-3 gap-1.5">
              <div className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-xl p-3 col-span-1">
                <div className="text-[8px] font-bold uppercase tracking-widest opacity-70">In System</div>
                <div className="text-xl font-black mt-0.5">{Math.round(totalSystemKL)}<span className="text-[10px] font-medium ml-0.5 opacity-70">KL</span></div>
                {washSummary && (
                  <div className="mt-1.5 space-y-1">
                    <div className="text-[7px] font-bold uppercase tracking-widest opacity-50">Today (9 AM - Now, {washSummary.today.hoursIntoShift}h)</div>
                    <div className="text-[8px] flex justify-between">
                      <span className="opacity-70">Wash Made</span>
                      <span className="font-black">{washSummary.today.totalWashKL} KL</span>
                    </div>
                    <div className="text-[8px] flex justify-between">
                      <span className="opacity-70">Distilled</span>
                      <span className="font-black">{washSummary.today.feed?.totalFeedKL || 0} KL</span>
                    </div>
                    <div className="border-t border-white/20 pt-1 mt-1">
                      <div className="text-[7px] font-bold uppercase tracking-widest opacity-50">Yesterday (9 AM - 9 AM)</div>
                      <div className="text-[8px] flex justify-between mt-0.5">
                        <span className="opacity-70">Made</span>
                        <span className="font-bold">{washSummary.yesterday.totalWashKL} KL</span>
                      </div>
                      <div className="text-[8px] flex justify-between">
                        <span className="opacity-70">Distilled</span>
                        <span className="font-bold">{washSummary.yesterday.feed?.totalFeedKL || 0} KL</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-3 col-span-1">
                <div className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Fermenters</div>
                <div className="text-xl font-black text-indigo-700 mt-0.5">
                  {Math.round(totalWashKL)}<span className="text-[10px] font-medium ml-0.5 text-gray-400">KL</span>
                  {!opcStale && (() => {
                    const totalRate = fermLabels.reduce((sum, label) => {
                      const fp = fermPhases[label];
                      return sum + (fp ? Math.round(fp.slope / 100 * FERM_CAPACITY_KL) : 0);
                    }, 0);
                    if (totalRate === 0) return null;
                    return <span className={`text-[9px] font-bold ml-1 ${totalRate > 0 ? 'text-green-600' : 'text-red-500'}`}>{totalRate > 0 ? '+' : ''}{totalRate} KL/hr</span>;
                  })()}
                  {opcStale && <span className="text-[9px] font-bold ml-1 text-red-400">OFFLINE</span>}
                </div>
                <div className="flex gap-1 mt-1 flex-wrap">
                  {vesselWash.map(vw => {
                    const fp = fermPhases[vw.label];
                    const rateKL = fp ? Math.round(fp.slope / 100 * FERM_CAPACITY_KL) : 0;
                    return (
                      <span key={vw.label} className="text-[7px] font-bold text-indigo-500 bg-indigo-50 px-1 py-0.5 rounded">
                        {vw.label.replace('F-', '')}: {Math.round(vw.washKL)}
                        {!opcStale && rateKL !== 0 && <span className={rateKL > 0 ? 'text-green-600' : 'text-red-500'}> {rateKL > 0 ? '+' : ''}{rateKL}/hr</span>}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-3 col-span-1">
                <div className="text-[8px] font-bold uppercase tracking-widest text-gray-400">PF + Beer Well</div>
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span className="text-sm font-black text-sky-700">PF {Math.round(pfWashKL)}</span>
                  <span className="text-[8px] text-gray-300">|</span>
                  <span className="text-sm font-black text-amber-700">BW {Math.round(bwWashKL)}</span>
                  <span className="text-[9px] text-gray-400">KL</span>
                </div>
                <div className="text-[8px] text-gray-400 mt-0.5">BW {bwOpc?.level?.toFixed(1) || 0}%</div>
                {washSummary?.today?.feed && washSummary.today.feed.totalFeedKL > 0 && (
                  <div className="text-[8px] text-emerald-600 font-bold mt-0.5">Feed: {washSummary.today.feed.totalFeedKL} KL</div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

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
                metric1 = last?.spGravity ? last.spGravity.toFixed(3) : '';
                metric2 = last?.temp ? `${last.temp}°` : '';
                levelStr = last?.level ? `${last.level}%` : batch.fermLevel ? `${batch.fermLevel}%` : '';
                startTime = batch.pfTransferTime || batch.fillingStartTime || '';
              }
            } else {
              const bw = getBW(v.no);
              if (bw[0]) {
                metric1 = bw[0].level != null ? `${bw[0].level}%` : bw[0].spGravity != null ? `SG ${bw[0].spGravity}` : bw[0].alcohol != null ? `Alc ${bw[0].alcohol}%` : '';
                metric2 = bw[0].level != null && bw[0].alcohol != null ? `Alc ${bw[0].alcohol}%` : '';
                startTime = bw[0].createdAt || '';
              }
            }

            const cfg = phCfg(phase);
            const Icon = v.type === 'PF' ? Beaker : v.type === 'FERM' ? FlaskConical : Cylinder;
            const isIdle = phase === 'IDLE' && v.type !== 'BW';

            return (
              <button key={`${v.type}-${v.no}`}
                onClick={() => {
                  if (isSelected) { setSelected(null); return; }
                  setSelected(v); setTab('reading'); setShowNewBatch(false); setDosingExpanded(false);
                  setReadingForm(opcPrefill(v));
                }}
                className={`relative rounded-xl p-2.5 text-left transition-all duration-200 border-2 ${
                  isSelected ? `${cfg.bg} ring-2 ${cfg.ring} border-transparent shadow-lg scale-[1.03]`
                  : isIdle ? 'bg-white border-gray-100 hover:border-gray-300 hover:shadow-md'
                  : `bg-white border-gray-100 hover:shadow-md hover:border-gray-200`
                }`}>
                {/* Active dot indicator */}
                {!isIdle && v.type !== 'BW' && (
                  <div className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${cfg.dot}`} />
                )}
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon size={14} className={isIdle ? 'text-gray-300' : v.type === 'BW' ? 'text-amber-500' : cfg.text} />
                  <span className={`text-xs font-extrabold ${isIdle ? 'text-gray-400' : 'text-gray-900'}`}>{v.label}</span>
                </div>
                {batchNo > 0 && (
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-md ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
                    <span className="text-[10px] text-gray-500 font-bold">#{batchNo}</span>
                  </div>
                )}
                {metric1 && <div className="text-lg font-black text-gray-900 mt-1 tracking-tight leading-tight">{metric1}</div>}
                {(metric2 || levelStr) && (
                  <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                    {metric2 && <span className="text-xs font-bold text-gray-700">{metric2}</span>}
                    {levelStr && <span className="text-xs font-extrabold text-blue-800 bg-blue-100 px-1.5 py-0.5 rounded">{levelStr}</span>}
                  </div>
                )}
                {/* OPC Live Data on tile */}
                {opcData[v.label] && (
                  <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                    {opcData[v.label].level != null && (
                      <span className="text-[11px] font-extrabold text-green-800 bg-green-100 border border-green-300 px-1.5 py-0.5">
                        OPC {opcData[v.label].level}%
                      </span>
                    )}
                    {opcData[v.label].temp != null && (
                      <span className="text-[11px] font-extrabold text-orange-800 bg-orange-100 border border-orange-300 px-1.5 py-0.5">
                        {opcData[v.label].temp}&deg;C
                      </span>
                    )}
                    {opcData[v.label].updatedAt && (
                      <span className="text-[9px] text-gray-500 font-medium">{fmtOpcAgo(opcData[v.label].updatedAt)}</span>
                    )}
                  </div>
                )}
                {/* Detected Phase Badge */}
                {v.type === 'FERM' && fermPhases[v.label] && fermPhases[v.label].detectedPhase !== 'UNKNOWN' && (() => {
                  const fp = fermPhases[v.label];
                  const style = PHASE_STYLE[fp.detectedPhase] || PHASE_STYLE.UNKNOWN;
                  return (
                    <div className="mt-1 flex items-center gap-1">
                      <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 border ${style.bg} ${style.text}`}>
                        {style.icon} {fp.detectedPhase} {fp.slope !== 0 ? `(${fp.slope > 0 ? '+' : ''}${fp.slope}%/hr)` : ''}
                      </span>
                      {!fp.alarmEnabled && <span className="text-[7px] text-gray-400">ALARM OFF</span>}
                      {fp.confidence !== 'HIGH' && <span className="text-[7px] text-gray-400">{fp.confidence}</span>}
                    </div>
                  );
                })()}
                {isIdle && v.type !== 'BW' && !opcData[v.label] && <div className="text-[10px] text-gray-300 mt-1.5 italic">idle</div>}
                {v.type === 'BW' && !metric1 && !getBW(v.no).length && !opcData[v.label] && <div className="text-[10px] text-gray-300 mt-1.5 italic">no data</div>}
                {v.type === 'BW' && !metric1 && getBW(v.no).length > 0 && <div className="text-[10px] text-gray-400 mt-1.5">has readings</div>}
                {startTime && !isIdle && v.type !== 'BW' && (
                  <div className="text-[9px] text-gray-400 mt-1 flex items-center gap-0.5 font-medium">
                    <Clock size={8} className="text-gray-300" />{elapsed(startTime)}
                  </div>
                )}
                {v.type === 'BW' && startTime && (
                  <div className="text-[9px] text-gray-400 mt-1 flex items-center gap-0.5 font-medium">
                    <Clock size={8} className="text-gray-300" />{fmtTime(startTime)} ({elapsed(startTime)})
                  </div>
                )}
                {/* Small Telegram share icon on active vessels */}
                {!isIdle && v.type !== 'BW' && (
                  <button onClick={(e) => shareVessel(v, e)}
                    className="absolute bottom-1.5 right-1.5 p-1 rounded-full bg-green-100 text-green-700 hover:bg-green-200 active:bg-green-300 transition-colors"
                    title={`Share on Telegram`}>
                    <MessageCircle size={10} />
                  </button>
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
          <div className="mx-3 mt-3 bg-white rounded-2xl border border-gray-200 shadow-lg overflow-hidden animate-[slideUp_0.2s_ease-out]">
            <style>{`@keyframes slideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
            {/* Panel header */}
            <div className={`px-4 py-3 ${isBW ? 'bg-gradient-to-r from-amber-50 to-amber-100/50' : `bg-gradient-to-r ${cfg.bg}`} flex items-center gap-2 border-b border-gray-100`}>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isBW ? 'bg-amber-200' : cfg.bg} shadow-sm`}>
                {isPF ? <Beaker size={16} className={cfg.text} /> : isFerm ? <FlaskConical size={16} className={cfg.text} /> : <Cylinder size={16} className="text-amber-600" />}
              </div>
              <div>
                <span className={`font-extrabold text-base ${isBW ? 'text-amber-800' : 'text-gray-900'}`}>{selected.label}</span>
                <div className="flex items-center gap-1.5">
                  {batchNo > 0 && <span className="text-xs text-gray-600 font-bold">Batch #{batchNo}</span>}
                  {phase !== 'IDLE' && !isBW && <span className={`text-xs font-extrabold ${cfg.text}`}>· {cfg.label}</span>}
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="ml-auto w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"><X size={14} className="text-gray-500" /></button>
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
                      <div><label className="text-[10px] font-bold text-gray-600">Batch #</label>
                        <input type="number" value={newBatchForm.batchNo} onChange={e => setNewBatchForm(f => ({ ...f, batchNo: e.target.value }))} className="w-full px-2 py-2 border border-gray-300 rounded-lg text-base font-bold" /></div>
                      <div><label className="text-[10px] font-bold text-gray-600">Level %</label>
                        <input type="number" step="0.1" value={newBatchForm.pfLevel} onChange={e => setNewBatchForm(f => ({ ...f, pfLevel: e.target.value }))} className="w-full px-2 py-2 border border-gray-300 rounded-lg text-base font-bold" /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="text-[10px] font-bold text-gray-600">Gravity</label>
                        <input type="number" step="0.001" value={newBatchForm.slurryGravity} onChange={e => setNewBatchForm(f => ({ ...f, slurryGravity: e.target.value }))} className="w-full px-2 py-2 border border-gray-300 rounded-lg text-base font-bold" /></div>
                      {isPF && <div><label className="text-[10px] font-bold text-gray-600">Temp °C</label>
                        <input type="number" step="0.1" value={newBatchForm.slurryTemp} onChange={e => setNewBatchForm(f => ({ ...f, slurryTemp: e.target.value }))} className="w-full px-2 py-2 border border-gray-300 rounded-lg text-base font-bold" /></div>}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={startBatch} disabled={saving} className="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold disabled:opacity-50">
                        {saving ? <Loader2 size={14} className="animate-spin mx-auto" /> : '🚀 Start'}
                      </button>
                      <button onClick={() => setShowNewBatch(false)} className="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg text-xs">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Active panel — unified view */}
            {(phase !== 'IDLE' || isBW) && (
              <>
                {/* ── BATCH INFO (always visible at top) ── */}
                {!isBW && batch && (
                  <div className="px-3 py-2 bg-gray-50/50 border-b border-gray-100 space-y-2">
                    {/* Phase timeline — click to change phase */}
                    <div className="flex items-center gap-0.5">
                      {(isPF ? PF_PHASES : FERM_PHASES).map((p, i) => {
                        const pCfg = phCfg(p);
                        const phaseList = isPF ? PF_PHASES : FERM_PHASES;
                        const ci = phaseList.indexOf(phase);
                        const canClick = i !== ci && !saving && batch;
                        return (
                          <div key={p} onClick={() => {
                            if (!canClick) return;
                            if (!confirm(`Change phase to ${pCfg.label}?`)) return;
                            const now = new Date().toISOString();
                            const extra: Record<string, string> = {};
                            if (isPF) {
                              // PF phase timing
                              if (p === 'DONE') extra.cipEndTime = now;
                            } else {
                              // FERM phase timing
                              if (p === 'FILLING') { extra.fillingStartTime = now; }
                              if (p === 'REACTION') { extra.reactionStartTime = now; extra.fillingEndTime = now; }
                              if (p === 'RETENTION') { extra.retentionStartTime = now; }
                              if (p === 'CIP') { extra.transferTime = now; extra.cipStartTime = now; }
                              if (p === 'DONE') { extra.cipEndTime = now; }
                            }
                            advancePhase(isPF ? 'PF' : 'FERM', batch!.id, p, extra);
                          }} className={`flex-1 text-center py-1.5 rounded text-[9px] font-extrabold ${
                            canClick ? 'cursor-pointer hover:ring-2 hover:ring-offset-1 active:scale-95 transition-all' : ''
                          } ${
                            i < ci ? 'bg-green-100 text-green-700' : i === ci ? `${pCfg.bg} ${pCfg.text} ring-2 ${pCfg.ring}` : 'bg-gray-100 text-gray-400'
                          }`}>{pCfg.label}</div>
                        );
                      })}
                    </div>
                    {/* Setup stats */}
                    <div className="flex gap-2 flex-wrap">
                      {isPF && (batch as PFBatch).slurryVolume && <div className="bg-indigo-100 rounded px-2.5 py-1 text-[11px]"><span className="text-indigo-500 font-bold">Vol</span> <span className="font-extrabold text-indigo-800">{((batch as PFBatch).slurryVolume! / 1000).toFixed(0)} KL</span></div>}
                      {isPF && (batch as PFBatch).slurryGravity && <div className="bg-indigo-100 rounded px-2.5 py-1 text-[11px]"><span className="text-indigo-500 font-bold">SG</span> <span className="font-extrabold text-indigo-800">{(batch as PFBatch).slurryGravity!.toFixed(3)}</span></div>}
                      {isPF && (batch as PFBatch).slurryTemp && <div className="bg-indigo-100 rounded px-2.5 py-1 text-[11px]"><span className="text-indigo-500 font-bold">Temp</span> <span className="font-extrabold text-indigo-800">{(batch as PFBatch).slurryTemp}°C</span></div>}
                      {isFerm && (batch as FermBatch).fermLevel && <div className="bg-blue-100 rounded px-2.5 py-1 text-[11px]"><span className="text-blue-500 font-bold">Lvl</span> <span className="font-extrabold text-blue-800">{(batch as FermBatch).fermLevel}%</span></div>}
                      {isFerm && (batch as FermBatch).setupGravity && <div className="bg-indigo-100 rounded px-2.5 py-1 text-[11px]"><span className="text-indigo-500 font-bold">SG</span> <span className="font-extrabold text-indigo-800">{(batch as FermBatch).setupGravity!.toFixed(3)}</span></div>}
                      {isFerm && (batch as FermBatch).finalAlcohol && <div className="bg-emerald-100 rounded px-2.5 py-1 text-[11px]"><span className="text-emerald-500 font-bold">Alc</span> <span className="font-extrabold text-emerald-800">{(batch as FermBatch).finalAlcohol}%</span></div>}
                      {isFerm && (batch as FermBatch).retentionStartTime && phase === 'RETENTION' && <div className="bg-orange-100 rounded px-2.5 py-1 text-[11px]"><span className="text-orange-500 font-bold">Ret</span> <span className="font-extrabold text-orange-800">{elapsed((batch as FermBatch).retentionStartTime)}</span></div>}
                      {batch.remarks && <div className="bg-gray-100 rounded px-2.5 py-1 text-[11px] text-gray-600 truncate max-w-[200px]" title={batch.remarks}>{batch.remarks}</div>}
                    </div>
                    {/* Phase actions — compact row */}
                    <div className="flex gap-1.5 flex-wrap">
                      {isPF && (phase === 'LAB' || phase === 'TRANSFER') && freeFermenters.map(fn => (
                        <button key={fn} onClick={() => transferPF(batch!.id, fn)} disabled={saving}
                          className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold disabled:opacity-50">
                          {saving ? <Loader2 size={12} className="animate-spin" /> : `→ F-${fn}`}
                        </button>
                      ))}
                      {isPF && (phase === 'LAB' || phase === 'TRANSFER') && freeFermenters.length === 0 && <span className="text-xs text-gray-400">No free fermenters</span>}
                      {isPF && phase === 'SETUP' && <button onClick={() => advancePhase('PF', batch!.id, 'DOSING')} disabled={saving} className="px-3 py-1.5 bg-violet-600 text-white rounded-lg text-xs font-bold disabled:opacity-50">→ Dosing</button>}
                      {isPF && phase === 'DOSING' && <button onClick={() => advancePhase('PF', batch!.id, 'LAB')} disabled={saving} className="px-3 py-1.5 bg-cyan-600 text-white rounded-lg text-xs font-bold disabled:opacity-50">→ Lab</button>}
                      {isPF && phase === 'CIP' && <button onClick={() => advancePhase('PF', batch!.id, 'DONE', { cipEndTime: new Date().toISOString() })} disabled={saving} className="px-3 py-1.5 bg-gray-600 text-white rounded-lg text-xs font-bold disabled:opacity-50">→ Complete</button>}

                      {isFerm && phase === 'FILLING' && <button onClick={() => advancePhase('FERM', batch!.id, 'REACTION', { reactionStartTime: new Date().toISOString(), fillingEndTime: new Date().toISOString() })} disabled={saving} className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-bold disabled:opacity-50">→ Reaction</button>}
                      {isFerm && phase === 'REACTION' && <button onClick={() => advancePhase('FERM', batch!.id, 'RETENTION', { retentionStartTime: new Date().toISOString() })} disabled={saving} className="px-3 py-1.5 bg-orange-600 text-white rounded-lg text-xs font-bold disabled:opacity-50">→ Retention</button>}
                      {isFerm && phase === 'RETENTION' && (
                        <button onClick={async () => {
                          setSaving(true);
                          try {
                            await api.patch(`/fermentation/batches/${batch!.id}`, { phase: 'CIP', transferTime: new Date().toISOString(), cipStartTime: new Date().toISOString() });
                            flash('ok', '→ Transferred & CIP started');
                            load();
                          } catch { flash('err', 'Failed'); }
                          setSaving(false);
                        }} disabled={saving} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold disabled:opacity-50">→ Transfer & CIP</button>
                      )}
                      {isFerm && phase === 'CIP' && <button onClick={() => advancePhase('FERM', batch!.id, 'DONE', { cipEndTime: new Date().toISOString() })} disabled={saving} className="px-3 py-1.5 bg-gray-600 text-white rounded-lg text-xs font-bold disabled:opacity-50">→ Complete</button>}

                      {/* Small delete */}
                      <button onClick={deleteBatch}
                        className="ml-auto px-2 py-1 text-[10px] text-red-400 hover:text-red-600 hover:bg-red-50 rounded flex items-center gap-1">
                        <Trash2 size={10} /> Del
                      </button>
                    </div>
                  </div>
                )}

                {/* ── TABS: Reading / Charts only ── */}
                {!isBW && (
                  <div className="flex border-b bg-gray-50/30 px-1 pt-1">
                    {(['reading', 'charts'] as const).map(t => (
                      <button key={t} onClick={() => setTab(t)}
                        className={`flex-1 py-1.5 text-[11px] font-bold tracking-wide rounded-t-lg transition-all duration-150 ${
                          tab === t
                            ? 'text-indigo-700 bg-white border-b-2 border-indigo-600 shadow-sm'
                            : 'text-gray-400 hover:text-gray-600 hover:bg-white/50'
                        }`}>
                        {t === 'reading' ? 'Reading & Dosing' : 'Charts'}
                      </button>
                    ))}
                  </div>
                )}

                {/* TAB: Reading + Quick Dosing */}
                {(tab === 'reading' || isBW) && (
                  <div className="p-3 space-y-3">
                    <div className="space-y-3">
                      {!isBW && (
                        <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-1.5 border border-gray-200">
                          <Clock size={12} className="text-gray-400 shrink-0" />
                          <label className="text-[9px] font-bold text-gray-500 uppercase tracking-wider shrink-0">Time</label>
                          <input type="datetime-local" step="60"
                            value={readingForm.analysisTime || new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                            onChange={e => setReadingForm(f => ({ ...f, analysisTime: e.target.value }))}
                            className="flex-1 px-2 py-1 text-xs font-semibold text-gray-900 border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-indigo-300 outline-none" />
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2.5">
                        <div className="bg-blue-50 rounded-xl p-3 border border-blue-100">
                          <div className="flex items-center justify-between">
                            <label className="text-[9px] font-bold text-blue-600 uppercase tracking-wider">Level %</label>
                            {OPC_TAG_MAP[selected.label] && (
                              <button
                                onClick={() => fetchOpcLive(selected.label)}
                                disabled={opcLoading}
                                className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 bg-green-100 text-green-700 border border-green-300 rounded hover:bg-green-200 disabled:opacity-50"
                              >
                                {opcLoading ? '...' : 'OPC LIVE'}
                              </button>
                            )}
                          </div>
                          <input type="number" step="0.1" value={readingForm.level || ''} onChange={e => setReadingForm(f => ({ ...f, level: e.target.value }))}
                            placeholder="—" className="w-full text-2xl font-black text-blue-900 bg-transparent border-none outline-none placeholder-blue-200 mt-0.5" inputMode="decimal" />
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
                            <label className="text-[9px] font-bold text-gray-600 uppercase tracking-wider">{f.label}</label>
                            <input type="number" step={f.step} value={(readingForm as any)[f.key] || ''}
                              onChange={e => setReadingForm(rf => ({ ...rf, [f.key]: e.target.value }))}
                              className="w-full px-2 py-2 text-base font-bold text-gray-900 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition-all" inputMode="decimal" />
                          </div>
                        ))}
                      </div>
                      <input placeholder="Remarks..." value={readingForm.remarks || ''} onChange={e => setReadingForm(f => ({ ...f, remarks: e.target.value }))}
                        className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-gray-50 outline-none" />
                      <div className="flex gap-2.5">
                        <button onClick={() => saveReading(false)} disabled={saving}
                          className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-sm hover:bg-indigo-700 active:scale-[0.98] transition-all">
                          {saving ? <Loader2 size={14} className="animate-spin" /> : <><Send size={13} /> Save</>}
                        </button>
                        <button onClick={() => saveReading(true)} disabled={saving}
                          className="flex-1 py-2.5 bg-green-600 text-white rounded-xl text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-sm hover:bg-green-700 active:scale-[0.98] transition-all">
                          {saving ? <Loader2 size={14} className="animate-spin" /> : <><MessageCircle size={13} /> Save & Share</>}
                        </button>
                      </div>
                    </div>

                    {/* ── QUICK DOSING (inline, below reading) ── */}
                    {!isBW && batch && (
                      <div className="border-t border-gray-100 pt-3">
                        {dosings.length > 0 ? (
                          <>
                            {/* Collapsed summary — tap to expand */}
                            <button onClick={() => setDosingExpanded(!dosingExpanded)}
                              className="w-full flex items-center gap-2 px-2 py-1.5 bg-violet-50/60 rounded-lg mb-1 hover:bg-violet-100/60 transition-colors">
                              <ChevronDown size={12} className={`text-violet-500 transition-transform ${dosingExpanded ? 'rotate-0' : '-rotate-90'}`} />
                              <span className="text-[9px] font-bold text-gray-400 uppercase">Chemicals ({dosings.length})</span>
                              <span className="text-[10px] text-violet-600 ml-auto">{dosings.map(d => `${d.chemicalName} ${d.quantity}${d.unit}`).join(' · ')}</span>
                            </button>
                            {dosingExpanded && (
                              <div className="space-y-0.5 mb-2">
                                {dosings.map((d: Dosing) => (
                                  <div key={d.id} className="flex items-center gap-2 bg-violet-50/50 rounded px-2 py-1">
                                    <span className="text-[11px] font-medium text-gray-800 flex-1">{d.chemicalName}</span>
                                    {editingDosing === d.id ? (
                                      <div className="flex items-center gap-1">
                                        <input type="number" value={editDosingQty} onChange={e => setEditDosingQty(e.target.value)}
                                          className="w-14 px-1 py-0.5 text-[11px] border rounded" autoFocus
                                          onKeyDown={e => { if (e.key === 'Enter') updateDosing(d.id); if (e.key === 'Escape') setEditingDosing(null); }} />
                                        <span className="text-[9px] text-gray-400">{d.unit}</span>
                                        <button onClick={() => updateDosing(d.id)} className="text-green-600"><CheckCircle size={12} /></button>
                                        <button onClick={() => setEditingDosing(null)} className="text-gray-400"><X size={12} /></button>
                                      </div>
                                    ) : (
                                      <button onClick={() => { setEditingDosing(d.id); setEditDosingQty(String(d.quantity)); }}
                                        className="text-[11px] font-bold text-violet-700 hover:underline">{d.quantity} {d.unit}</button>
                                    )}
                                    <button onClick={() => deleteDosing(d.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={10} /></button>
                                  </div>
                                ))}
                                {/* Add more chemicals when expanded */}
                                <div className="flex gap-1.5 items-end pt-1">
                                  <div className="flex-1">
                                    <select value={dosingForm.chemicalName} onChange={e => setDosingForm(f => ({ ...f, chemicalName: e.target.value }))}
                                      className="w-full px-2 py-1.5 text-xs border rounded-lg bg-white">
                                      <option value="">+ Chemical...</option>
                                      {chemicals.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                                    </select>
                                  </div>
                                  <div className="w-16">
                                    <input type="number" value={dosingForm.quantity} onChange={e => setDosingForm(f => ({ ...f, quantity: e.target.value }))}
                                      placeholder="Qty" className="w-full px-2 py-1.5 text-xs border rounded-lg" />
                                  </div>
                                  <div className="w-14">
                                    <select value={dosingForm.unit} onChange={e => setDosingForm(f => ({ ...f, unit: e.target.value }))}
                                      className="w-full px-2 py-1.5 text-xs border rounded-lg bg-white">
                                      {['kg', 'ltr', 'gm', 'ml'].map(u => <option key={u} value={u}>{u}</option>)}
                                    </select>
                                  </div>
                                  <button onClick={addDosing} disabled={saving || !dosingForm.chemicalName || !dosingForm.quantity}
                                    className="px-2.5 py-1.5 bg-violet-600 text-white rounded-lg text-xs font-bold disabled:opacity-50">
                                    <Plus size={13} />
                                  </button>
                                </div>
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            {/* No dosing yet — show blinking reminder + recipe/add form */}
                            <style>{`@keyframes dosingBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
                            <div className="flex items-center gap-2 px-2 py-1.5 bg-orange-50 border border-orange-200 rounded-lg mb-2"
                              style={{ animation: 'dosingBlink 1.5s ease-in-out infinite' }}>
                              <AlertCircle size={14} className="text-orange-500" />
                              <span className="text-[11px] font-bold text-orange-700">Dosing not added!</span>
                            </div>
                            {(isPF ? recipes.PF : recipes.FERMENTER).length > 0 && (
                              <button onClick={applyRecipe} disabled={saving}
                                className="w-full py-1.5 mb-2 bg-violet-50 text-violet-700 border border-violet-200 rounded-lg text-xs font-bold hover:bg-violet-100 flex items-center justify-center gap-1">
                                <Play size={11} /> Apply Recipe ({(isPF ? recipes.PF : recipes.FERMENTER).length})
                              </button>
                            )}
                            <div className="flex gap-1.5 items-end">
                              <div className="flex-1">
                                <select value={dosingForm.chemicalName} onChange={e => setDosingForm(f => ({ ...f, chemicalName: e.target.value }))}
                                  className="w-full px-2 py-1.5 text-xs border rounded-lg bg-white">
                                  <option value="">+ Chemical...</option>
                                  {chemicals.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                                </select>
                              </div>
                              <div className="w-16">
                                <input type="number" value={dosingForm.quantity} onChange={e => setDosingForm(f => ({ ...f, quantity: e.target.value }))}
                                  placeholder="Qty" className="w-full px-2 py-1.5 text-xs border rounded-lg" />
                              </div>
                              <div className="w-14">
                                <select value={dosingForm.unit} onChange={e => setDosingForm(f => ({ ...f, unit: e.target.value }))}
                                  className="w-full px-2 py-1.5 text-xs border rounded-lg bg-white">
                                  {['kg', 'ltr', 'gm', 'ml'].map(u => <option key={u} value={u}>{u}</option>)}
                                </select>
                              </div>
                              <button onClick={addDosing} disabled={saving || !dosingForm.chemicalName || !dosingForm.quantity}
                                className="px-2.5 py-1.5 bg-violet-600 text-white rounded-lg text-xs font-bold disabled:opacity-50">
                                <Plus size={13} />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* Recent readings */}
                    {(() => {
                      const rList = isBW ? getBW(selected.no).map(r => ({ id: r.id, analysisTime: '', spGravity: r.spGravity, ph: r.ph, alcohol: r.alcohol, temp: r.temp, level: r.level, rs: undefined as number | undefined, createdAt: r.createdAt, status: '' })) : readings;
                      return rList.length > 0 && (
                        <div>
                          <div className="text-[9px] font-bold text-gray-400 uppercase mb-1">Recent Readings</div>
                          <div className="space-y-0.5 max-h-64 overflow-y-auto">
                            {(isBW ? rList.slice(0, 10) : rList.slice(-10).reverse()).map((r, i) => (
                              editingReading === r.id ? (
                                /* Inline edit row */
                                <div key={r.id} className="bg-yellow-50 rounded-lg p-2 border border-yellow-200 space-y-1.5">
                                  <div className="grid grid-cols-3 gap-1.5">
                                    {[
                                      { k: 'level', l: 'Lvl%' }, { k: 'spGravity', l: 'SG' }, { k: 'ph', l: 'pH' },
                                      { k: 'temp', l: 'Temp' }, { k: 'alcohol', l: 'Alc%' }, { k: 'rs', l: 'RS' },
                                    ].map(f => (
                                      <div key={f.k}>
                                        <label className="text-[7px] font-bold text-gray-400">{f.l}</label>
                                        <input type="number" step="0.01" value={editForm[f.k] || ''} onChange={e => setEditForm(ef => ({ ...ef, [f.k]: e.target.value }))}
                                          className="w-full px-1 py-0.5 text-[10px] border rounded" />
                                      </div>
                                    ))}
                                  </div>
                                  <div className="flex gap-1.5">
                                    <button onClick={() => saveEditReading(r.id)} className="flex-1 py-1 bg-green-600 text-white text-[10px] font-bold rounded">Save</button>
                                    <button onClick={() => setEditingReading(null)} className="flex-1 py-1 bg-gray-200 text-gray-600 text-[10px] font-bold rounded">Cancel</button>
                                  </div>
                                </div>
                              ) : (
                                /* Normal row */
                                <div key={r.id || i} className="flex items-center gap-2 px-2.5 py-2 bg-gray-50/80 rounded-lg text-xs group hover:bg-gray-100 transition-colors">
                                  <span className="text-gray-500 font-mono text-[11px] w-12 shrink-0 font-semibold">{fmtTime(r.analysisTime || r.createdAt)}</span>
                                  <div className="flex items-center gap-2 flex-1 flex-wrap">
                                    {r.level != null && <span className="text-blue-800 font-extrabold bg-blue-100 px-1.5 py-0.5 rounded">Lvl {r.level}%</span>}
                                    {r.spGravity != null && <span className="text-indigo-800 font-extrabold bg-indigo-100 px-1.5 py-0.5 rounded">SG {typeof r.spGravity === 'number' ? r.spGravity.toFixed(3) : r.spGravity}</span>}
                                    {r.ph != null && <span className="text-gray-800 font-bold">pH {r.ph}</span>}
                                    {r.temp != null && <span className={`font-extrabold px-1.5 py-0.5 rounded ${(r.temp || 0) > 37 ? 'text-red-800 bg-red-100' : 'text-orange-800 bg-orange-100'}`}>{r.temp}°C</span>}
                                    {r.alcohol != null && <span className="text-emerald-800 font-extrabold bg-emerald-100 px-1.5 py-0.5 rounded">Alc {r.alcohol}%</span>}
                                    {r.rs != null && <span className="text-amber-800 font-extrabold bg-amber-100 px-1.5 py-0.5 rounded">RS {r.rs}</span>}
                                    {r.rst != null && <span className="text-amber-700 font-bold bg-amber-100 px-1.5 py-0.5 rounded">RST {r.rst}</span>}
                                    {r.ds != null && <span className="text-purple-800 font-bold bg-purple-100 px-1.5 py-0.5 rounded">DS {r.ds}%</span>}
                                    {r.vfaPpa != null && <span className="text-rose-800 font-bold bg-rose-100 px-1.5 py-0.5 rounded">VFA {r.vfaPpa}</span>}
                                    {r.status === 'FIELD' && <span className="text-[10px] bg-yellow-200 text-yellow-900 px-1.5 py-0.5 rounded font-bold">FIELD</span>}
                                  </div>
                                  {r.id && (
                                    <div className="flex items-center gap-1 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity">
                                      <button onClick={() => startEditReading(r as any)} className="w-6 h-6 rounded-md bg-blue-50 hover:bg-blue-100 flex items-center justify-center text-blue-600 transition-colors" title="Edit">
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

                {/* TAB: Charts */}
                {tab === 'charts' && !isBW && (() => {
                  const fb = batch as FermBatch | undefined;
                  // Build chart data with proper timestamps — include date if multi-day
                  const rawChart = readings.map(r => {
                    const d = new Date(r.analysisTime || r.createdAt);
                    return { d, ts: d.getTime(), sg: r.spGravity ?? undefined, alc: r.alcohol ?? undefined, level: r.level ?? undefined, ph: r.ph ?? undefined, temp: r.temp ?? undefined };
                  }).sort((a, b) => a.ts - b.ts);
                  // Check if data spans multiple days
                  const multiDay = rawChart.length > 1 && new Date(rawChart[0].ts).toDateString() !== new Date(rawChart[rawChart.length - 1].ts).toDateString();
                  const chartData = rawChart.map(r => ({
                    ...r,
                    time: multiDay
                      ? r.d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' ' + r.d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
                      : r.d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
                  }));

                  // Phase transition timestamps for reference lines
                  const phaseMarkers: { time: string; label: string; color: string }[] = [];
                  if (isFerm && fb) {
                    if (fb.fillingStartTime) phaseMarkers.push({ time: fmtTime(fb.fillingStartTime), label: 'Filling', color: '#3b82f6' });
                    if (fb.fillingEndTime) phaseMarkers.push({ time: fmtTime(fb.fillingEndTime), label: 'Reaction', color: '#f59e0b' });
                    if (fb.retentionStartTime) phaseMarkers.push({ time: fmtTime(fb.retentionStartTime), label: 'Retention', color: '#f97316' });
                  }

                  // Compute proper Y-axis domains for gravity — tight range around actual data
                  const sgVals = chartData.map(d => d.sg).filter((v): v is number => v != null);
                  const sgMin = sgVals.length ? Math.floor((Math.min(...sgVals) - 0.005) * 1000) / 1000 : 1;
                  const sgMax = sgVals.length ? Math.ceil((Math.max(...sgVals) + 0.005) * 1000) / 1000 : 1.1;

                  return (
                  <div className="p-3 space-y-3">
                    {readings.length < 2 ? (
                      <p className="text-center text-gray-400 text-xs py-8">Need 2+ readings for charts</p>
                    ) : (
                      <>
                        {/* Gravity + Alcohol + Level */}
                        <div className="bg-white border border-slate-300 p-3">
                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Gravity, Alcohol & Level</div>
                          {/* Stats strip */}
                          {(() => {
                            const sgValsStats = chartData.map(d => d.sg).filter((v): v is number => v != null);
                            if (!sgValsStats.length) return null;
                            const min = Math.min(...sgValsStats);
                            const max = Math.max(...sgValsStats);
                            const mean = sgValsStats.reduce((s, v) => s + v, 0) / sgValsStats.length;
                            const stats = { mean, min, max, range: max - min, count: sgValsStats.length };
                            return (
                              <div className="grid grid-cols-3 md:grid-cols-5 gap-0 border border-slate-300 mb-2">
                                {[
                                  { label: 'Mean SG', value: stats.mean.toFixed(3), color: 'text-indigo-600' },
                                  { label: 'Min SG', value: stats.min.toFixed(3), color: 'text-cyan-600' },
                                  { label: 'Max SG', value: stats.max.toFixed(3), color: 'text-red-600' },
                                  { label: 'Range', value: stats.range.toFixed(3), color: 'text-amber-600' },
                                  { label: 'Samples', value: String(stats.count), color: 'text-slate-600' },
                                ].map(s => (
                                  <div key={s.label} className="px-2 py-2 border-r border-slate-200 last:border-r-0">
                                    <div className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{s.label}</div>
                                    <div className={`text-sm font-bold font-mono tabular-nums mt-0.5 ${s.color}`}>{s.value}</div>
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                          {/* Y-Zoom controls */}
                          <div className="flex items-center justify-end gap-1 mb-1">
                            <span className="text-[9px] text-slate-400 uppercase tracking-widest mr-1">Y-Zoom</span>
                            <button onClick={() => setYZoomGravity(z => Math.min(z + 1, 5))} className="w-5 h-5 flex items-center justify-center bg-slate-100 border border-slate-300 text-slate-600 text-xs font-bold hover:bg-slate-200">+</button>
                            <button onClick={() => setYZoomGravity(z => Math.max(z - 1, 0))} className="w-5 h-5 flex items-center justify-center bg-slate-100 border border-slate-300 text-slate-600 text-xs font-bold hover:bg-slate-200">-</button>
                            {yZoomGravity > 0 && <button onClick={() => setYZoomGravity(0)} className="px-1.5 h-5 flex items-center justify-center bg-slate-100 border border-slate-300 text-slate-500 text-[9px] hover:bg-slate-200">Reset</button>}
                          </div>
                          <ResponsiveContainer width="100%" height={250}>
                            <ComposedChart data={chartData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                              <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} interval="preserveStartEnd" />
                              <YAxis yAxisId="sg" domain={(() => {
                                if (!sgVals.length) return [1, 1.1];
                                if (yZoomGravity === 0) return [sgMin, sgMax];
                                const mid = (sgMin + sgMax) / 2;
                                const range = sgMax - sgMin || 0.01;
                                const factor = Math.pow(0.6, yZoomGravity);
                                return [mid - range * factor, mid + range * factor];
                              })()} tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} tickFormatter={(v: number) => v.toFixed(3)} label={{ value: 'SG', angle: -90, position: 'insideLeft', fontSize: 8, fill: '#1e40af' }} />
                              <YAxis yAxisId="alc" orientation="right" domain={(() => {
                                const alcVals = chartData.flatMap(d => [d.alc, d.level].filter((v): v is number => v != null));
                                if (!alcVals.length || yZoomGravity === 0) return [0, 'auto'] as [number, string];
                                const alcMin = Math.min(...alcVals);
                                const alcMax = Math.max(...alcVals);
                                const mid = (alcMin + alcMax) / 2;
                                const range = alcMax - alcMin || 1;
                                const factor = Math.pow(0.6, yZoomGravity);
                                return [mid - range * factor, mid + range * factor];
                              })()} tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} label={{ value: 'Alc% / Level%', angle: 90, position: 'insideRight', fontSize: 8, fill: '#10b981' }} />
                              <Tooltip contentStyle={{ fontSize: 12, border: '1px solid #94a3b8', background: '#fff', padding: '8px 12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }} labelStyle={{ fontWeight: 700, marginBottom: 4, color: '#1e293b' }} itemStyle={{ padding: '1px 0' }} formatter={(v: number, name: string) => [name === 'Gravity' ? v?.toFixed(3) : v, name]} />
                              <Legend wrapperStyle={{ fontSize: 9 }} />
                              {phaseMarkers.map((pm, i) => (
                                <ReferenceLine key={i} yAxisId="sg" x={pm.time} stroke={pm.color} strokeDasharray="4 4" strokeWidth={1.5} label={{ value: pm.label, position: 'top', fontSize: 8, fill: pm.color, fontWeight: 'bold' }} />
                              ))}
                              <Line yAxisId="sg" type="monotone" dataKey="sg" name="Gravity" stroke="#1e40af" strokeWidth={2} dot={{ r: 3, fill: '#1e40af' }} connectNulls />
                              <Line yAxisId="alc" type="monotone" dataKey="alc" name="Alcohol%" stroke="#10b981" strokeWidth={2} dot={{ r: 3, fill: '#10b981' }} connectNulls />
                              <Line yAxisId="alc" type="monotone" dataKey="level" name="Level%" stroke="#0891b2" strokeWidth={2} dot={{ r: 3, fill: '#0891b2' }} strokeDasharray="4 3" connectNulls />
                              {chartData.length > 24 && <Brush dataKey="time" height={20} stroke="#1e40af" />}
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                        {/* pH & Temperature */}
                        <div className="bg-white border border-slate-300 p-3">
                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">pH & Temperature</div>
                          {/* Stats strip */}
                          {(() => {
                            const phValsStats = chartData.map(d => d.ph).filter((v): v is number => v != null);
                            const tempValsStats = chartData.map(d => d.temp).filter((v): v is number => v != null);
                            if (!phValsStats.length && !tempValsStats.length) return null;
                            const phMean = phValsStats.length ? phValsStats.reduce((s, v) => s + v, 0) / phValsStats.length : 0;
                            const tempMean = tempValsStats.length ? tempValsStats.reduce((s, v) => s + v, 0) / tempValsStats.length : 0;
                            return (
                              <div className="grid grid-cols-3 md:grid-cols-5 gap-0 border border-slate-300 mb-2">
                                {[
                                  { label: 'Mean pH', value: phValsStats.length ? phMean.toFixed(2) : '--', color: 'text-amber-600' },
                                  { label: 'pH Range', value: phValsStats.length ? `${Math.min(...phValsStats).toFixed(2)} - ${Math.max(...phValsStats).toFixed(2)}` : '--', color: 'text-amber-600' },
                                  { label: 'Mean Temp', value: tempValsStats.length ? tempMean.toFixed(1) + '\u00b0C' : '--', color: 'text-red-600' },
                                  { label: 'Temp Range', value: tempValsStats.length ? `${Math.min(...tempValsStats).toFixed(1)} - ${Math.max(...tempValsStats).toFixed(1)}` : '--', color: 'text-red-600' },
                                  { label: 'Samples', value: String(Math.max(phValsStats.length, tempValsStats.length)), color: 'text-slate-600' },
                                ].map(s => (
                                  <div key={s.label} className="px-2 py-2 border-r border-slate-200 last:border-r-0">
                                    <div className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{s.label}</div>
                                    <div className={`text-sm font-bold font-mono tabular-nums mt-0.5 ${s.color}`}>{s.value}</div>
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                          {/* Y-Zoom controls */}
                          <div className="flex items-center justify-end gap-1 mb-1">
                            <span className="text-[9px] text-slate-400 uppercase tracking-widest mr-1">Y-Zoom</span>
                            <button onClick={() => setYZoomPhTemp(z => Math.min(z + 1, 5))} className="w-5 h-5 flex items-center justify-center bg-slate-100 border border-slate-300 text-slate-600 text-xs font-bold hover:bg-slate-200">+</button>
                            <button onClick={() => setYZoomPhTemp(z => Math.max(z - 1, 0))} className="w-5 h-5 flex items-center justify-center bg-slate-100 border border-slate-300 text-slate-600 text-xs font-bold hover:bg-slate-200">-</button>
                            {yZoomPhTemp > 0 && <button onClick={() => setYZoomPhTemp(0)} className="px-1.5 h-5 flex items-center justify-center bg-slate-100 border border-slate-300 text-slate-500 text-[9px] hover:bg-slate-200">Reset</button>}
                          </div>
                          <ResponsiveContainer width="100%" height={250}>
                            <ComposedChart data={chartData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                              <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} interval="preserveStartEnd" />
                              <YAxis yAxisId="ph" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} domain={(() => {
                                const phVals = chartData.map(d => d.ph).filter((v): v is number => v != null);
                                if (!phVals.length) return [0, 'auto'] as [number, string];
                                if (yZoomPhTemp === 0) return [0, 'auto'] as [number, string];
                                const phMin = Math.min(...phVals);
                                const phMax = Math.max(...phVals);
                                const mid = (phMin + phMax) / 2;
                                const range = phMax - phMin || 1;
                                const factor = Math.pow(0.6, yZoomPhTemp);
                                return [mid - range * factor, mid + range * factor];
                              })()} label={{ value: 'pH', angle: -90, position: 'insideLeft', fontSize: 8, fill: '#f59e0b' }} />
                              <YAxis yAxisId="temp" orientation="right" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} domain={(() => {
                                const tempVals = chartData.map(d => d.temp).filter((v): v is number => v != null);
                                if (!tempVals.length) return [0, 'auto'] as [number, string];
                                if (yZoomPhTemp === 0) return [0, 'auto'] as [number, string];
                                const tempMin = Math.min(...tempVals);
                                const tempMax = Math.max(...tempVals);
                                const mid = (tempMin + tempMax) / 2;
                                const range = tempMax - tempMin || 1;
                                const factor = Math.pow(0.6, yZoomPhTemp);
                                return [mid - range * factor, mid + range * factor];
                              })()} label={{ value: '\u00b0C', angle: 90, position: 'insideRight', fontSize: 8, fill: '#dc2626' }} />
                              <Tooltip contentStyle={{ fontSize: 12, border: '1px solid #94a3b8', background: '#fff', padding: '8px 12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }} labelStyle={{ fontWeight: 700, marginBottom: 4, color: '#1e293b' }} itemStyle={{ padding: '1px 0' }} />
                              <Legend wrapperStyle={{ fontSize: 9 }} />
                              {phaseMarkers.map((pm, i) => (
                                <ReferenceLine key={i} yAxisId="ph" x={pm.time} stroke={pm.color} strokeDasharray="4 4" strokeWidth={1.5} label={{ value: pm.label, position: 'top', fontSize: 8, fill: pm.color, fontWeight: 'bold' }} />
                              ))}
                              <Line yAxisId="ph" type="monotone" dataKey="ph" name="pH" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: '#f59e0b' }} connectNulls />
                              <Line yAxisId="temp" type="monotone" dataKey="temp" name="Temp\u00b0C" stroke="#dc2626" strokeWidth={2} dot={{ r: 3, fill: '#dc2626' }} connectNulls />
                              {chartData.length > 24 && <Brush dataKey="time" height={20} stroke="#1e40af" />}
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      </>
                    )}
                  </div>
                  );
                })()}

                {/* OPC Level & Temp History */}
                {selected && opcHistory[selected.label]?.length > 0 && (
                  <div className="mt-4">
                    <div className="bg-white border border-slate-300 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">OPC Level Trend (24h)</span>
                        {opcData[selected.label]?.level != null && <span className="text-[10px] font-bold text-green-700 bg-green-50 px-1.5 py-0.5 border border-green-200">Live: {opcData[selected.label].level}%</span>}
                      </div>
                      <ResponsiveContainer width="100%" height={200}>
                        <ComposedChart data={opcHistory[selected.label].map((d: OpcHistoryPoint) => {
                          const hr = new Date(d.hour);
                          const ist = new Date(hr.getTime() + 5.5 * 60 * 60 * 1000);
                          return { ...d, time: `${String(ist.getUTCHours() % 12 || 12).padStart(2,'0')}:${String(ist.getUTCMinutes()).padStart(2,'0')} ${ist.getUTCHours() >= 12 ? 'pm' : 'am'}` };
                        })}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis dataKey="time" tick={{ fontSize: 8, fill: '#64748b' }} tickLine={false} />
                          <YAxis tick={{ fontSize: 8, fill: '#64748b' }} tickLine={false} domain={[0, 100]} />
                          <Tooltip contentStyle={{ fontSize: 11, border: '1px solid #94a3b8', background: '#fff', padding: '6px 10px' }} />
                          <Line type="monotone" dataKey="avg" stroke="#1e40af" strokeWidth={2} dot={{ r: 2, fill: '#1e40af' }} name="Level %" connectNulls />
                          <Line type="monotone" dataKey="max" stroke="#dc2626" strokeWidth={1} dot={false} strokeDasharray="4 3" name="Max" />
                          <Line type="monotone" dataKey="min" stroke="#0891b2" strokeWidth={1} dot={false} strokeDasharray="4 3" name="Min" />
                          {opcHistory[selected.label].length > 12 && <Brush dataKey="time" height={15} stroke="#94a3b8" fill="#f8fafc" travellerWidth={6} />}
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

              </>
            )}
          </div>
        );
      })()}

      {/* ═══ OPC LIVE TRENDS ═══ */}
      {Object.keys(opcHistory).length > 0 && (
        <div className="px-3 mt-4">
          <div className="bg-white border border-slate-300 p-3">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">OPC Live Trends (24h)</span>
              <button onClick={fetchOpcHistory} disabled={opcHistoryLoading}
                className="px-2 py-0.5 text-[9px] text-slate-400 border border-slate-300 hover:bg-slate-50">
                {opcHistoryLoading ? 'Loading...' : 'Refresh'}
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {['F-1', 'F-2', 'F-3', 'F-4'].filter(v => opcHistory[v]?.length).map(vessel => {
                const data = opcHistory[vessel].map(d => {
                  const hr = new Date(d.hour);
                  const ist = new Date(hr.getTime() + 5.5 * 60 * 60 * 1000);
                  return { ...d, time: `${String(ist.getUTCHours() % 12 || 12).padStart(2,'0')}:${String(ist.getUTCMinutes()).padStart(2,'0')} ${ist.getUTCHours() >= 12 ? 'pm' : 'am'}` };
                });
                const currentLevel = opcData[vessel]?.level;
                const currentTemp = opcData[vessel]?.temp;
                return (
                  <div key={vessel} className="border border-slate-200 p-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">{vessel} Level</span>
                      <div className="flex gap-2">
                        {currentLevel != null && <span className="text-[10px] font-bold text-green-700 bg-green-50 px-1.5 py-0.5 border border-green-200">{currentLevel}%</span>}
                        {currentTemp != null && <span className="text-[10px] font-bold text-orange-600 bg-orange-50 px-1.5 py-0.5 border border-orange-200">{currentTemp}&deg;C</span>}
                      </div>
                    </div>
                    <ResponsiveContainer width="100%" height={150}>
                      <ComposedChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="time" tick={{ fontSize: 8, fill: '#64748b' }} tickLine={false} />
                        <YAxis tick={{ fontSize: 8, fill: '#64748b' }} tickLine={false} domain={[0, 100]} />
                        <Tooltip contentStyle={{ fontSize: 11, border: '1px solid #94a3b8', background: '#fff', padding: '6px 10px' }} />
                        <Line type="monotone" dataKey="avg" stroke="#1e40af" strokeWidth={2} dot={{ r: 2, fill: '#1e40af' }} name="Level %" connectNulls />
                        <Line type="monotone" dataKey="max" stroke="#dc2626" strokeWidth={1} dot={false} strokeDasharray="4 3" name="Max" />
                        <Line type="monotone" dataKey="min" stroke="#0891b2" strokeWidth={1} dot={false} strokeDasharray="4 3" name="Min" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                );
              })}
            </div>
            {/* PF + Beer Well */}
            {(opcHistory['BW-1']?.length) && (
              <div className="mt-3 border border-slate-200 p-2">
                <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Beer Well Level</span>
                {opcData['BW-1']?.level != null && <span className="ml-2 text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 border border-amber-200">{opcData['BW-1'].level}%</span>}
                <ResponsiveContainer width="100%" height={150}>
                  <ComposedChart data={opcHistory['BW-1'].map(d => {
                    const hr = new Date(d.hour);
                    const ist = new Date(hr.getTime() + 5.5 * 60 * 60 * 1000);
                    return { ...d, time: `${String(ist.getUTCHours() % 12 || 12).padStart(2,'0')}:${String(ist.getUTCMinutes()).padStart(2,'0')} ${ist.getUTCHours() >= 12 ? 'pm' : 'am'}` };
                  })}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="time" tick={{ fontSize: 8, fill: '#64748b' }} tickLine={false} />
                    <YAxis tick={{ fontSize: 8, fill: '#64748b' }} tickLine={false} domain={[0, 100]} />
                    <Tooltip contentStyle={{ fontSize: 11, border: '1px solid #94a3b8', background: '#fff', padding: '6px 10px' }} />
                    <Line type="monotone" dataKey="avg" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2, fill: '#f59e0b' }} name="Level %" connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ BATCH HISTORY ═══ */}
      <div className="px-3 mt-6">
        <div className="bg-white rounded-2xl border border-gray-200 shadow overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-bold text-gray-800 text-sm flex items-center gap-2"><Clock size={16} className="text-gray-400" /> Batch History</h2>
            <div className="flex gap-1">
              <button onClick={() => setHistoryTab('ferm')} className={`px-3 py-1 text-xs font-semibold rounded-lg ${historyTab === 'ferm' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-400 hover:text-gray-600'}`}>Fermenters</button>
              <button onClick={() => setHistoryTab('pf')} className={`px-3 py-1 text-xs font-semibold rounded-lg ${historyTab === 'pf' ? 'bg-violet-100 text-violet-700' : 'text-gray-400 hover:text-gray-600'}`}>Pre-Ferm</button>
              <button onClick={() => setHistoryTab('bw')} className={`px-3 py-1 text-xs font-semibold rounded-lg ${historyTab === 'bw' ? 'bg-amber-100 text-amber-700' : 'text-gray-400 hover:text-gray-600'}`}>Beer Well</button>
            </div>
          </div>
          <div className="overflow-x-auto">
            {historyTab === 'ferm' ? (
              fermHistory.length > 0 ? (
                <div className="divide-y divide-gray-100">
                  {/* Header row */}
                  <div className="grid grid-cols-11 gap-1 px-3 py-2 bg-gray-50 text-[10px] font-semibold text-gray-500 uppercase">
                    <div className="col-span-1">Batch</div>
                    <div className="col-span-1">F#</div>
                    <div className="col-span-1">Phase</div>
                    <div className="col-span-1">Started</div>
                    <div className="col-span-1 text-right">Setup SG</div>
                    <div className="col-span-1 text-right">Final Alc%</div>
                    <div className="col-span-1 text-right">Volume</div>
                    <div className="col-span-1 text-right">Cycle Time</div>
                    <div className="col-span-2">Transferred</div>
                    <div className="col-span-1 text-right"></div>
                  </div>
                  {fermHistory.map((b: any) => {
                    const isExp = expandedHist === b.id;
                    const phaseCfg: Record<string, { label: string; color: string }> = {
                      PF_TRANSFER: { label: 'PF Transfer', color: 'bg-blue-100 text-blue-700' },
                      FILLING: { label: 'Filling', color: 'bg-cyan-100 text-cyan-700' },
                      REACTION: { label: 'Reaction', color: 'bg-amber-100 text-amber-700' },
                      RETENTION: { label: 'Retention', color: 'bg-orange-100 text-orange-700' },
                      TRANSFER: { label: 'Transfer', color: 'bg-purple-100 text-purple-700' },
                      CIP: { label: 'CIP', color: 'bg-gray-100 text-gray-700' },
                      DONE: { label: 'Done', color: 'bg-green-100 text-green-700' },
                    };
                    const pc = phaseCfg[b.phase] || { label: b.phase, color: 'bg-gray-100 text-gray-600' };
                    const readings: any[] = b.labReadings || [];
                    const dosings: any[] = b.dosings || [];

                    // Elapsed helper
                    const elapsedStr = (from: string | null, to: string | null) => {
                      if (!from) return '';
                      const end = to ? new Date(to).getTime() : Date.now();
                      const mins = Math.floor((end - new Date(from).getTime()) / 60000);
                      if (mins < 0) return '';
                      const h = Math.floor(mins / 60); const m = mins % 60;
                      return h > 0 ? `${h}h ${m}m` : `${m}m`;
                    };

                    // Cycle time: PF transfer → BW transfer (or current)
                    const cycleStart = b.pfTransferTime || b.fillingStartTime;
                    const cycleEnd = b.transferTime;
                    const cycleTime = cycleStart ? elapsedStr(cycleStart, cycleEnd) : (b.totalHours ? `${b.totalHours}h` : '—');

                    // Volume from last level reading (fermenter ~250 M³ capacity, level is %)
                    const lastLevel = readings.filter((r: any) => r.level != null).slice(-1)[0]?.level;
                    const volM3 = lastLevel != null ? (lastLevel / 100 * FERM_CAPACITY_KL).toFixed(0) : null;

                    // Setup SG = SG at reaction start (first reading after filling ends)
                    const setupSG = b.setupGravity || (() => {
                      const fillEnd = b.fillingEndTime ? new Date(b.fillingEndTime).getTime() : null;
                      if (fillEnd) {
                        const afterFill = readings.find((r: any) => r.spGravity && new Date(r.analysisTime || r.createdAt).getTime() >= fillEnd - 60000);
                        if (afterFill) return afterFill.spGravity;
                      }
                      // Fallback: first SG reading
                      return readings.find((r: any) => r.spGravity)?.spGravity;
                    })();

                    return (
                      <div key={b.id}>
                        <div className="grid grid-cols-11 gap-1 px-3 py-2.5 text-xs hover:bg-gray-50 cursor-pointer group items-center"
                          onClick={() => setExpandedHist(isExp ? null : b.id)}>
                          <div className="col-span-1 font-bold text-gray-800">#{b.batchNo}</div>
                          <div className="col-span-1 font-medium text-indigo-600">F-{b.fermenterNo}</div>
                          <div className="col-span-1"><span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${pc.color}`}>{pc.label}</span></div>
                          <div className="col-span-1 text-gray-500">{b.pfTransferTime ? new Date(b.pfTransferTime).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}</div>
                          <div className="col-span-1 text-right font-medium">{setupSG ? Number(setupSG).toFixed(3) : '—'}</div>
                          <div className="col-span-1 text-right font-bold text-emerald-700">{b.finalAlcohol ? `${b.finalAlcohol}%` : '—'}</div>
                          <div className="col-span-1 text-right">{volM3 ? `${volM3} M³` : (b.transferVolume ? `${(b.transferVolume / 1000).toFixed(1)} KL` : '—')}</div>
                          <div className="col-span-1 text-right font-medium text-gray-700">{cycleTime}</div>
                          <div className="col-span-2 text-gray-500">{b.transferTime ? new Date(b.transferTime).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</div>
                          <div className="col-span-1 text-right flex items-center justify-end gap-1">
                            {isAdmin && b.phase === 'DONE' && <button title="Reactivate batch" onClick={async (e) => { e.stopPropagation(); if (!confirm(`Reactivate Batch #${b.batchNo} on F-${b.fermenterNo}? It will go back to REACTION phase.`)) return; try { await api.patch(`/fermentation/batches/${b.id}`, { phase: 'REACTION', cipEndTime: null, cipStartTime: null }); flash('ok', `Batch #${b.batchNo} reactivated`); load(); } catch { flash('err', 'Reactivate failed'); } }} className="opacity-0 group-hover:opacity-100 text-blue-400 hover:text-blue-600 transition-all"><RotateCcw size={13} /></button>}
                            {isAdmin && <button onClick={async (e) => { e.stopPropagation(); if (!confirm(`Delete Batch #${b.batchNo}?`)) return; try { await api.delete(`/fermentation/batches/${b.id}`); flash('ok', `Batch #${b.batchNo} deleted`); load(); } catch { flash('err', 'Delete failed'); } }} className="opacity-0 group-hover:opacity-100 text-red-300 hover:text-red-500 transition-all"><Trash2 size={13} /></button>}
                            <ChevronDown size={14} className={`text-gray-400 transition-transform ${isExp ? 'rotate-180' : ''}`} />
                          </div>
                        </div>
                        {/* Expanded detail */}
                        {isExp && (
                          <div className="px-4 pb-4 bg-gray-50/50 space-y-3 border-b border-gray-200">
                            {/* Phase timeline with elapsed times */}
                            <div className="flex flex-wrap gap-1 text-[10px]">
                              {b.pfTransferTime && <div className="bg-blue-50 rounded px-2 py-1"><span className="text-blue-400">PF→F</span> <span className="font-bold text-blue-700">{new Date(b.pfTransferTime).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}</span></div>}
                              {b.pfTransferTime && b.fillingEndTime && <div className="text-gray-300 self-center">→ {elapsedStr(b.pfTransferTime, b.fillingEndTime)}</div>}
                              {b.fillingEndTime && <div className="bg-amber-50 rounded px-2 py-1"><span className="text-amber-400">Rxn</span> <span className="font-bold text-amber-700">{new Date(b.fillingEndTime).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}</span></div>}
                              {b.fillingEndTime && b.retentionStartTime && <div className="text-gray-300 self-center">→ {elapsedStr(b.fillingEndTime, b.retentionStartTime)}</div>}
                              {b.retentionStartTime && <div className="bg-orange-50 rounded px-2 py-1"><span className="text-orange-400">Ret</span> <span className="font-bold text-orange-700">{new Date(b.retentionStartTime).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}</span></div>}
                              {b.retentionStartTime && b.transferTime && <div className="text-gray-300 self-center">→ {elapsedStr(b.retentionStartTime, b.transferTime)}</div>}
                              {b.transferTime && <div className="bg-purple-50 rounded px-2 py-1"><span className="text-purple-400">→BW</span> <span className="font-bold text-purple-700">{new Date(b.transferTime).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}</span></div>}
                              {cycleStart && <div className="bg-indigo-50 rounded px-2 py-1 ml-2"><span className="text-indigo-400">Total</span> <span className="font-bold text-indigo-700">{cycleTime}</span></div>}
                            </div>

                            {/* Setup Data — all fields from batch setup */}
                            <div className="bg-white rounded-lg border p-2.5 space-y-2">
                              <div className="text-[10px] font-bold text-gray-400 uppercase">Setup Details</div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 text-[10px]">
                                <div>
                                  <span className="text-gray-400">Setup SG: </span>
                                  <input type="number" step="0.001" defaultValue={b.setupGravity || ''} className="w-20 px-1.5 py-0.5 border rounded text-[10px] font-medium text-indigo-600"
                                    onBlur={async (e) => { const v = parseFloat(e.target.value); if (!v) return; try { await api.patch(`/fermentation/batches/${b.id}`, { setupGravity: v }); flash('ok', 'Setup SG updated'); } catch { flash('err', 'Update failed'); } }} />
                                </div>
                                <div>
                                  <span className="text-gray-400">Final Alc%: </span>
                                  <input type="number" step="0.01" defaultValue={b.finalAlcohol || ''} className="w-20 px-1.5 py-0.5 border rounded text-[10px] font-bold text-emerald-700"
                                    onBlur={async (e) => { const v = parseFloat(e.target.value); if (!v) return; try { await api.patch(`/fermentation/batches/${b.id}`, { finalAlcohol: v }); flash('ok', 'Final Alc% updated'); } catch { flash('err', 'Update failed'); } }} />
                                </div>
                                {volM3 && <div><span className="text-gray-400">Volume: </span><span className="font-bold text-gray-700">{volM3} M³</span> <span className="text-gray-400">(Level {lastLevel}%)</span></div>}
                                {b.transferVolume != null && <div><span className="text-gray-400">Transfer Vol: </span><span className="font-bold text-gray-700">{(b.transferVolume / 1000).toFixed(1)} KL</span></div>}
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-[10px]">
                                {b.setupRs != null && <div><span className="text-gray-400">Setup RS: </span><span className="font-medium">{b.setupRs}</span></div>}
                                {b.setupRst != null && <div><span className="text-gray-400">Setup RST: </span><span className="font-medium">{b.setupRst}</span></div>}
                                {b.finalRsGravity != null && <div><span className="text-gray-400">Final RS/SG: </span><span className="font-medium">{b.finalRsGravity}</span></div>}
                                {b.fermLevel != null && <div><span className="text-gray-400">Ferm Level: </span><span className="font-medium">{b.fermLevel}%</span></div>}
                                {b.beerWellNo != null && <div><span className="text-gray-400">Beer Well: </span><span className="font-medium">BW-{b.beerWellNo}</span></div>}
                                {b.setupDate && <div><span className="text-gray-400">Setup Date: </span><span className="font-medium">{new Date(b.setupDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}</span></div>}
                                {b.setupTime && <div><span className="text-gray-400">Setup Time: </span><span className="font-medium">{b.setupTime}</span></div>}
                                {b.totalHours != null && <div><span className="text-gray-400">Total Hours: </span><span className="font-medium">{b.totalHours}h</span></div>}
                              </div>
                              {/* Chemicals from setup */}
                              {(b.yeast || b.enzyme || b.formolin || b.booster || b.urea) && (
                                <div className="flex flex-wrap gap-1.5 pt-1">
                                  {b.yeast && <span className="bg-green-50 border border-green-100 rounded px-2 py-0.5 text-[10px]"><span className="font-bold text-green-800">Yeast:</span> <span className="text-green-600">{b.yeast}</span></span>}
                                  {b.enzyme && <span className="bg-blue-50 border border-blue-100 rounded px-2 py-0.5 text-[10px]"><span className="font-bold text-blue-800">Enzyme:</span> <span className="text-blue-600">{b.enzyme}</span></span>}
                                  {b.urea && <span className="bg-amber-50 border border-amber-100 rounded px-2 py-0.5 text-[10px]"><span className="font-bold text-amber-800">Urea:</span> <span className="text-amber-600">{b.urea}</span></span>}
                                  {b.formolin && <span className="bg-red-50 border border-red-100 rounded px-2 py-0.5 text-[10px]"><span className="font-bold text-red-800">Formolin:</span> <span className="text-red-600">{b.formolin}</span></span>}
                                  {b.booster && <span className="bg-purple-50 border border-purple-100 rounded px-2 py-0.5 text-[10px]"><span className="font-bold text-purple-800">Booster:</span> <span className="text-purple-600">{b.booster}</span></span>}
                                </div>
                              )}
                            </div>

                            {/* Graph toggle */}
                            {readings.length >= 2 && (() => {
                              const multiDayHist = readings.length > 1 && new Date(readings[0].analysisTime || readings[0].createdAt).toDateString() !== new Date(readings[readings.length - 1].analysisTime || readings[readings.length - 1].createdAt).toDateString();
                              const cData = readings.map((r: any) => {
                                const d = new Date(r.analysisTime || r.createdAt);
                                const timeStr = multiDayHist
                                  ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
                                  : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
                                return { time: timeStr, sg: r.spGravity ?? undefined, alc: r.alcohol ?? undefined, level: r.level ?? undefined };
                              });
                              const sgVals = cData.map(d => d.sg).filter((v): v is number => v != null);
                              const sgMin2 = sgVals.length ? Math.floor((Math.min(...sgVals) - 0.005) * 1000) / 1000 : 1;
                              const sgMax2 = sgVals.length ? Math.ceil((Math.max(...sgVals) + 0.005) * 1000) / 1000 : 1.1;
                              return (
                                <div>
                                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Gravity & Alcohol Chart</div>
                                  {/* Stats strip */}
                                  {sgVals.length > 0 && (() => {
                                    const min = Math.min(...sgVals);
                                    const max = Math.max(...sgVals);
                                    const mean = sgVals.reduce((s, v) => s + v, 0) / sgVals.length;
                                    return (
                                      <div className="grid grid-cols-3 md:grid-cols-5 gap-0 border border-slate-300 mb-2">
                                        {[
                                          { label: 'Mean SG', value: mean.toFixed(3), color: 'text-indigo-600' },
                                          { label: 'Min SG', value: min.toFixed(3), color: 'text-cyan-600' },
                                          { label: 'Max SG', value: max.toFixed(3), color: 'text-red-600' },
                                          { label: 'Range', value: (max - min).toFixed(3), color: 'text-amber-600' },
                                          { label: 'Samples', value: String(sgVals.length), color: 'text-slate-600' },
                                        ].map(s => (
                                          <div key={s.label} className="px-2 py-2 border-r border-slate-200 last:border-r-0">
                                            <div className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{s.label}</div>
                                            <div className={`text-sm font-bold font-mono tabular-nums mt-0.5 ${s.color}`}>{s.value}</div>
                                          </div>
                                        ))}
                                      </div>
                                    );
                                  })()}
                                  {/* Y-Zoom controls */}
                                  <div className="flex items-center justify-end gap-1 mb-1">
                                    <span className="text-[9px] text-slate-400 uppercase tracking-widest mr-1">Y-Zoom</span>
                                    <button onClick={() => setYZoomHistGravity(z => Math.min(z + 1, 5))} className="w-5 h-5 flex items-center justify-center bg-slate-100 border border-slate-300 text-slate-600 text-xs font-bold hover:bg-slate-200">+</button>
                                    <button onClick={() => setYZoomHistGravity(z => Math.max(z - 1, 0))} className="w-5 h-5 flex items-center justify-center bg-slate-100 border border-slate-300 text-slate-600 text-xs font-bold hover:bg-slate-200">-</button>
                                    {yZoomHistGravity > 0 && <button onClick={() => setYZoomHistGravity(0)} className="px-1.5 h-5 flex items-center justify-center bg-slate-100 border border-slate-300 text-slate-500 text-[9px] hover:bg-slate-200">Reset</button>}
                                  </div>
                                  <ResponsiveContainer width="100%" height={250}>
                                    <ComposedChart data={cData}>
                                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                      <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
                                      <YAxis yAxisId="sg" domain={(() => {
                                        if (!sgVals.length) return [1, 1.1];
                                        if (yZoomHistGravity === 0) return [sgMin2, sgMax2];
                                        const mid = (sgMin2 + sgMax2) / 2;
                                        const range = sgMax2 - sgMin2 || 0.01;
                                        const factor = Math.pow(0.6, yZoomHistGravity);
                                        return [mid - range * factor, mid + range * factor];
                                      })()} tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} tickFormatter={(v: number) => v.toFixed(3)} />
                                      <YAxis yAxisId="alc" orientation="right" domain={(() => {
                                        const alcVals = cData.flatMap(d => [d.alc, d.level].filter((v): v is number => v != null));
                                        if (!alcVals.length || yZoomHistGravity === 0) return [0, 'auto'] as [number, string];
                                        const alcMin = Math.min(...alcVals);
                                        const alcMax = Math.max(...alcVals);
                                        const mid = (alcMin + alcMax) / 2;
                                        const range = alcMax - alcMin || 1;
                                        const factor = Math.pow(0.6, yZoomHistGravity);
                                        return [mid - range * factor, mid + range * factor];
                                      })()} tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
                                      <Tooltip contentStyle={{ fontSize: 12, border: '1px solid #94a3b8', background: '#fff', padding: '8px 12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }} labelStyle={{ fontWeight: 700, marginBottom: 4, color: '#1e293b' }} itemStyle={{ padding: '1px 0' }} formatter={(v: number, name: string) => [name === 'Gravity' ? v?.toFixed(3) : v, name]} />
                                      <Legend wrapperStyle={{ fontSize: 8 }} />
                                      <Line yAxisId="sg" type="monotone" dataKey="sg" name="Gravity" stroke="#1e40af" strokeWidth={2} dot={{ r: 3, fill: '#1e40af' }} connectNulls />
                                      <Line yAxisId="alc" type="monotone" dataKey="alc" name="Alc%" stroke="#10b981" strokeWidth={2} dot={{ r: 3, fill: '#10b981' }} connectNulls />
                                      <Line yAxisId="alc" type="monotone" dataKey="level" name="Level%" stroke="#0891b2" strokeWidth={2} dot={{ r: 3, fill: '#0891b2' }} strokeDasharray="4 3" connectNulls />
                                      {cData.length > 24 && <Brush dataKey="time" height={20} stroke="#1e40af" />}
                                    </ComposedChart>
                                  </ResponsiveContainer>
                                </div>
                              );
                            })()}

                            {/* Lab readings table with edit */}
                            {readings.length > 0 && (
                              <div>
                                <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Lab Readings ({readings.length})</div>
                                <div className="bg-white rounded-lg border overflow-x-auto">
                                  <table className="w-full text-[10px]">
                                    <thead><tr className="bg-gray-50 text-gray-400">
                                      <th className="px-2 py-1 text-left">Time</th>
                                      <th className="px-2 py-1 text-left">Elapsed</th>
                                      <th className="px-2 py-1 text-right">Level%</th>
                                      <th className="px-2 py-1 text-right">Vol M³</th>
                                      <th className="px-2 py-1 text-right">SG</th>
                                      <th className="px-2 py-1 text-right">pH</th>
                                      <th className="px-2 py-1 text-right">Alc%</th>
                                      <th className="px-2 py-1 text-right">Temp</th>
                                      <th className="px-2 py-1 text-right">RS</th>
                                      <th className="px-2 py-1 text-right">RST</th>
                                    </tr></thead>
                                    <tbody>
                                      {readings.map((r: any, i: number) => {
                                        const rTime = new Date(r.analysisTime || r.createdAt);
                                        const startT = b.pfTransferTime ? new Date(b.pfTransferTime) : null;
                                        const elMins = startT ? Math.floor((rTime.getTime() - startT.getTime()) / 60000) : null;
                                        const elStr = elMins != null && elMins >= 0 ? (elMins >= 60 ? `${Math.floor(elMins / 60)}h${elMins % 60}m` : `${elMins}m`) : '';
                                        const rVol = r.level != null ? (r.level / 100 * FERM_CAPACITY_KL).toFixed(1) : null;
                                        return (
                                          <tr key={r.id || i} className="border-t border-gray-50 hover:bg-blue-50/30">
                                            <td className="px-2 py-1 text-gray-500">{rTime.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}</td>
                                            <td className="px-2 py-1 text-gray-400">{elStr}</td>
                                            <td className="px-2 py-1 text-right font-medium text-violet-600">{r.level ?? '—'}</td>
                                            <td className="px-2 py-1 text-right text-gray-500">{rVol ?? '—'}</td>
                                            <td className="px-2 py-1 text-right font-medium text-indigo-600">{r.spGravity?.toFixed(3) ?? '—'}</td>
                                            <td className="px-2 py-1 text-right">{r.ph ?? '—'}</td>
                                            <td className="px-2 py-1 text-right font-bold text-emerald-700">{r.alcohol ?? '—'}</td>
                                            <td className="px-2 py-1 text-right">{r.temp ? `${r.temp}°` : '—'}</td>
                                            <td className="px-2 py-1 text-right">{r.rs ?? '—'}</td>
                                            <td className="px-2 py-1 text-right">{r.rst ?? '—'}</td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}
                            {/* Dosings */}
                            {dosings.length > 0 && (
                              <div>
                                <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Chemicals ({dosings.length})</div>
                                <div className="flex flex-wrap gap-1.5">
                                  {dosings.map((d: any) => (
                                    <span key={d.id} className="bg-amber-50 border border-amber-100 rounded px-2 py-0.5 text-[10px]">
                                      <span className="font-bold text-amber-800">{d.chemicalName}</span> <span className="text-amber-600">{d.quantity} {d.unit}</span>
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {b.remarks && <div className="text-[10px] text-gray-500"><span className="font-bold">Remarks:</span> {b.remarks}</div>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center text-gray-400 py-8 text-sm">No completed fermentation batches yet</div>
              )
            ) : historyTab === 'pf' ? (
              pfHistory.length > 0 ? (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 border-b">
                      <th className="text-left px-3 py-2 font-semibold">Batch</th>
                      <th className="text-left px-3 py-2 font-semibold">PF#</th>
                      <th className="text-left px-3 py-2 font-semibold">Setup</th>
                      <th className="text-right px-3 py-2 font-semibold">Volume (L)</th>
                      <th className="text-right px-3 py-2 font-semibold">Gravity</th>
                      <th className="text-right px-3 py-2 font-semibold">Temp</th>
                      <th className="text-right px-3 py-2 font-semibold">Final SG</th>
                      <th className="text-left px-3 py-2 font-semibold">Transferred</th>
                      <th className="text-left px-3 py-2 font-semibold">CIP Done</th>
                      <th className="text-left px-3 py-2 font-semibold">Remarks</th>
                      {isAdmin && <th className="px-2 py-2 w-8"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {pfHistory.map((b: any) => (
                      <tr key={b.id} className="border-b border-gray-50 hover:bg-gray-50 group">
                        <td className="px-3 py-2 font-bold text-gray-800">#{b.batchNo}</td>
                        <td className="px-3 py-2 font-medium text-violet-600">PF-{b.fermenterNo}</td>
                        <td className="px-3 py-2 text-gray-500">{b.setupTime ? new Date(b.setupTime).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                        <td className="px-3 py-2 text-right font-medium">{b.slurryVolume?.toLocaleString() || '—'}</td>
                        <td className="px-3 py-2 text-right font-medium">{b.slurryGravity?.toFixed(3) || '—'}</td>
                        <td className="px-3 py-2 text-right">{b.slurryTemp ? `${b.slurryTemp}°C` : '—'}</td>
                        <td className="px-3 py-2 text-right font-medium">{b.labReadings?.[0]?.spGravity?.toFixed(3) || '—'}</td>
                        <td className="px-3 py-2 text-gray-500">{b.transferTime ? new Date(b.transferTime).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                        <td className="px-3 py-2 text-gray-500">{b.cipEndTime ? new Date(b.cipEndTime).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                        <td className="px-3 py-2 text-gray-400 max-w-[120px] truncate" title={b.remarks || ''}>{b.remarks || '—'}</td>
                        {isAdmin && <td className="px-2 py-2 flex items-center gap-1">{b.phase === 'DONE' && <button title="Reactivate batch" onClick={async () => { if (!confirm(`Reactivate PF Batch #${b.batchNo}?`)) return; try { await api.patch(`/pre-fermentation/batches/${b.id}`, { phase: 'SETUP', cipEndTime: null, cipStartTime: null }); flash('ok', `PF Batch #${b.batchNo} reactivated`); load(); } catch { flash('err', 'Reactivate failed'); } }} className="opacity-0 group-hover:opacity-100 text-blue-400 hover:text-blue-600 transition-all"><RotateCcw size={14} /></button>}<button onClick={async () => { if (!confirm(`Delete PF Batch #${b.batchNo}?`)) return; try { await api.delete(`/pre-fermentation/batches/${b.id}`); flash('ok', `PF Batch #${b.batchNo} deleted`); load(); } catch { flash('err', 'Delete failed'); } }} className="opacity-0 group-hover:opacity-100 text-red-300 hover:text-red-500 transition-all"><Trash2 size={14} /></button></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-center text-gray-400 py-8 text-sm">No completed PF batches yet</div>
              )
            ) : historyTab === 'bw' ? (
              bwHistory.length > 0 ? (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 border-b">
                      <th className="text-left px-3 py-2 font-semibold">Time</th>
                      <th className="text-left px-3 py-2 font-semibold">Well</th>
                      <th className="text-right px-3 py-2 font-semibold">Level %</th>
                      <th className="text-right px-3 py-2 font-semibold">SG</th>
                      <th className="text-right px-3 py-2 font-semibold">pH</th>
                      <th className="text-right px-3 py-2 font-semibold">Alc %</th>
                      <th className="text-right px-3 py-2 font-semibold">Temp</th>
                      <th className="text-left px-3 py-2 font-semibold">Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bwHistory.map((r: BeerWellReading) => (
                      <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-500">{new Date(r.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}</td>
                        <td className="px-3 py-2 font-medium text-amber-600">BW-{r.wellNo}</td>
                        <td className="px-3 py-2 text-right font-bold text-blue-700">{r.level != null ? `${r.level}%` : '—'}</td>
                        <td className="px-3 py-2 text-right font-medium">{r.spGravity != null ? r.spGravity.toFixed(3) : '—'}</td>
                        <td className="px-3 py-2 text-right">{r.ph ?? '—'}</td>
                        <td className="px-3 py-2 text-right font-medium text-emerald-700">{r.alcohol != null ? `${r.alcohol}%` : '—'}</td>
                        <td className="px-3 py-2 text-right">{r.temp != null ? `${r.temp}°C` : '—'}</td>
                        <td className="px-3 py-2 text-gray-400 max-w-[120px] truncate" title={r.remarks || ''}>{r.remarks || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-center text-gray-400 py-8 text-sm">No beer well readings yet</div>
              )
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
