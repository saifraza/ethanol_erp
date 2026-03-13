import React, { useEffect, useState } from 'react';
import { Wheat, Save, Loader2, ChevronDown, ChevronUp, Trash2, Eye, X, Share2, AlertTriangle } from 'lucide-react';
import ProcessPage, { InputCard, Field } from './ProcessPage';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

// Defaults — overridden by settings API
const DEF_FERM_CAP = 2300;
const DEF_PF_CAP = 450;
const DEF_ILT_CAP = 190;
const DEF_FLT_CAP = 440;
const DEF_GRAIN_PCT = 0.31;
const DEF_PF_PCT = 0.15;

interface GrainForm {
  date: string;
  grainUnloaded: number | null;
  washConsumed: number | null;
  washConsumedAt: string;
  // Store as PERCENTAGE (0-100), convert to KL when saving
  f1Pct: number | null;
  f2Pct: number | null;
  f3Pct: number | null;
  f4Pct: number | null;
  beerWellPct: number | null;
  pf1Pct: number | null;
  pf2Pct: number | null;
  iltPct: number | null;
  fltPct: number | null;
  fermentationVolumeAt: string;
  quarantineStock: number | null;
  flourSilo1Pct: number | null;
  flourSilo2Pct: number | null;
  moisture: number | null;
  starchPercent: number | null;
  damagedPercent: number | null;
  foreignMatter: number | null;
  remarks: string;
}

function nowLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// Shift date: if before 9AM, it's yesterday's shift
function shiftDate() {
  const now = new Date();
  if (now.getHours() < 9) now.setDate(now.getDate() - 1);
  return now.toISOString().split('T')[0];
}

const emptyForm: GrainForm = {
  date: shiftDate(),
  grainUnloaded: null, washConsumed: null, washConsumedAt: nowLocal(),
  f1Pct: null, f2Pct: null, f3Pct: null, f4Pct: null, beerWellPct: null,
  pf1Pct: null, pf2Pct: null, iltPct: null, fltPct: null, fermentationVolumeAt: nowLocal(),
  quarantineStock: null,
  flourSilo1Pct: null, flourSilo2Pct: null,
  moisture: null, starchPercent: null, damagedPercent: null, foreignMatter: null,
  remarks: '',
};

// Build a proper local-timezone Date from form.date
function buildEntryDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0); // midnight local time
}

function elapsed(ms: number): string {
  if (ms <= 0) return '—';
  const hrs = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
}

function fmtDt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function fmtHrs(ms: number) {
  if (ms <= 0) return '';
  const h = ms / 3600000;
  return h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} hrs`;
}

// Convert KL to percentage
function klToPct(kl: number | null, cap: number): number | null {
  if (kl == null) return null;
  return Math.round((kl / cap) * 10000) / 100; // 2 decimal places
}

// Convert percentage to KL
function pctToKl(pct: number | null, cap: number): number {
  if (pct == null) return 0;
  return (pct / 100) * cap;
}

export default function GrainUnloading() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [form, setForm] = useState<GrainForm>({ ...emptyForm });
  const [defaults, setDefaults] = useState<any>({});
  const [prev, setPrev] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [entries, setEntries] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [truckSummary, setTruckSummary] = useState<{ totalNet: number; quarantineNet: number; totalReceived: number; truckCount: number }>({ totalNet: 0, quarantineNet: 0, totalReceived: 0, truckCount: 0 });
  const [truckList, setTruckList] = useState<any[]>([]);
  const [showTruckList, setShowTruckList] = useState(false);
  const [plantSettings, setPlantSettings] = useState<any>(null);

  const u = (n: string, v: any) => setForm(f => ({ ...f, [n]: v }));

  // Capacities from settings or defaults
  const FERM_CAPACITY = plantSettings?.fermenter1Cap ?? DEF_FERM_CAP;
  const PF_CAPACITY = plantSettings?.pfCap ?? DEF_PF_CAP;
  const ILT_CAPACITY = plantSettings?.iltCap ?? DEF_ILT_CAP;
  const FLT_CAPACITY = plantSettings?.fltCap ?? DEF_FLT_CAP;
  const FERM_GRAIN_PCT = (plantSettings?.grainPercent ?? DEF_GRAIN_PCT * 100) / 100;
  const PF_GRAIN_PCT = (plantSettings?.pfGrainPercent ?? DEF_PF_PCT * 100) / 100;
  const MILLING_LOSS_PCT = (plantSettings?.millingLossPercent ?? 2.5) / 100;
  const FLOUR_SILO_CAP = 140; // 140 T each

  // Convert percentages to KL for calculations
  const f1KL = pctToKl(form.f1Pct, FERM_CAPACITY);
  const f2KL = pctToKl(form.f2Pct, FERM_CAPACITY);
  const f3KL = pctToKl(form.f3Pct, FERM_CAPACITY);
  const f4KL = pctToKl(form.f4Pct, FERM_CAPACITY);
  const beerWellKL = pctToKl(form.beerWellPct, FERM_CAPACITY);
  const pf1KL = pctToKl(form.pf1Pct, PF_CAPACITY);
  const pf2KL = pctToKl(form.pf2Pct, PF_CAPACITY);
  const iltKL = pctToKl(form.iltPct, ILT_CAPACITY);
  const fltKL = pctToKl(form.fltPct, FLT_CAPACITY);

  const fermVol = f1KL + f2KL + f3KL + f4KL + beerWellKL;
  const pfVol = pf1KL + pf2KL;
  const iltFltVol = iltKL + fltKL;
  const totalFermVol = fermVol + pfVol + iltFltVol;
  // Current grain in each stage
  const grainInFerm = fermVol * FERM_GRAIN_PCT;
  const grainInPF = pfVol * PF_GRAIN_PCT;
  const grainInIltFlt = iltFltVol * FERM_GRAIN_PCT;
  const grainInProcess = grainInFerm + grainInPF + grainInIltFlt;
  const flourSilo1T = pctToKl(form.flourSilo1Pct, FLOUR_SILO_CAP);
  const flourSilo2T = pctToKl(form.flourSilo2Pct, FLOUR_SILO_CAP);
  const flourSiloTotal = flourSilo1T + flourSilo2T;

  // Previous grain in each stage
  const prevFermVol = prev ? ((prev.f1Level||0)+(prev.f2Level||0)+(prev.f3Level||0)+(prev.f4Level||0)+(prev.beerWellLevel||0)) : 0;
  const prevPfVol = prev ? ((prev.pf1Level||0)+(prev.pf2Level||0)) : 0;
  const prevIltFltVol = prev ? ((prev.iltLevel||0)+(prev.fltLevel||0)) : 0;
  const prevGrainInProcess = prev ? (prevFermVol * FERM_GRAIN_PCT + prevPfVol * PF_GRAIN_PCT + prevIltFltVol * FERM_GRAIN_PCT) : 0;
  const prevFlourTotal = prev ? ((prev.flourSilo1Level||0)+(prev.flourSilo2Level||0)) : 0;

  // Wash distilled (flow meter diff)
  const pW = prev?.washConsumed ?? 0;
  const washDiff = Math.max(0, (form.washConsumed || 0) - pW);
  const grainDistilled = washDiff * FERM_GRAIN_PCT;

  // Wash Made = new wash produced = level change + what was distilled
  const washMade = (fermVol - prevFermVol) + washDiff;

  // Mass balance: grain consumed from silo
  // = distilled + Δprocess + Δflour, clamped ≥ 0
  // Internal transfers (flour→process) cancel out naturally
  const deltaGrainInProcess = grainInProcess - prevGrainInProcess;
  const deltaFlour = flourSiloTotal - prevFlourTotal;
  // If no process levels entered yet, just use distilled * grain%
  // (avoids false-zero when fermenters appear empty but user hasn't filled levels)
  const hasProcessLevels = (form.f1Pct ?? 0) > 0 || (form.f2Pct ?? 0) > 0 || (form.f3Pct ?? 0) > 0 || (form.f4Pct ?? 0) > 0 || (form.beerWellPct ?? 0) > 0 || (form.pf1Pct ?? 0) > 0 || (form.pf2Pct ?? 0) > 0 || (form.iltPct ?? 0) > 0 || (form.fltPct ?? 0) > 0;
  const grainConsumed = hasProcessLevels
    ? Math.max(0, grainDistilled + deltaGrainInProcess + deltaFlour)
    : grainDistilled;

  const opening = defaults.siloOpeningStock || 0;
  const grainReceived = form.grainUnloaded || 0;
  const millingLoss = grainReceived * MILLING_LOSS_PCT;
  const effectiveGrain = grainReceived - millingLoss;
  const siloClosing = opening + effectiveGrain - grainConsumed;
  const totalAtPlant = grainInProcess + flourSiloTotal;

  const pGIP = prev?.grainInProcess ?? 0;

  const washElapsed = (prev?.washConsumedAt && form.washConsumedAt)
    ? new Date(form.washConsumedAt).getTime() - new Date(prev.washConsumedAt).getTime() : 0;
  const fermElapsed = (prev?.fermentationVolumeAt && form.fermentationVolumeAt)
    ? new Date(form.fermentationVolumeAt).getTime() - new Date(prev.fermentationVolumeAt).getTime() : 0;
  const prevElapsed = prev?.createdAt ? Date.now() - new Date(prev.createdAt).getTime() : 0;

  useEffect(() => { loadLatest(); loadEntries(); api.get('/settings').then(r => setPlantSettings(r.data)).catch(() => {}); }, []);
  useEffect(() => { loadTruckSummary(); }, [form.date]);

  async function loadLatest(beforeId?: string) {
    try {
      const url = beforeId ? `/grain/latest?beforeId=${beforeId}` : '/grain/latest';
      const res = await api.get(url);
      setDefaults(res.data.defaults);
      setPrev(res.data.previous);
    } catch (e) { console.error(e); }
  }

  async function loadTruckSummary() {
    try {
      const [sumRes, listRes] = await Promise.all([
        api.get(`/grain-truck/summary?date=${form.date}`),
        api.get(`/grain-truck?date=${form.date}`),
      ]);
      setTruckSummary(sumRes.data);
      setTruckList(listRes.data.trucks || []);
      // Auto-set grainUnloaded and quarantine from truck totals
      setForm(f => ({
        ...f,
        grainUnloaded: sumRes.data.totalNet || null,
        quarantineStock: sumRes.data.quarantineNet || null,
      }));
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
      // Convert percentages to KL for backend
      const payload = {
        date: buildEntryDate(form.date).toISOString(),
        grainUnloaded: form.grainUnloaded,
        washConsumed: form.washConsumed,
        washConsumedAt: form.washConsumedAt ? new Date(form.washConsumedAt).toISOString() : null,
        f1Level: f1KL, f2Level: f2KL, f3Level: f3KL, f4Level: f4KL,
        beerWellLevel: beerWellKL,
        pf1Level: pf1KL, pf2Level: pf2KL,
        iltLevel: iltKL, fltLevel: fltKL,
        quarantineStock: form.quarantineStock ?? 0,
        flourSilo1Level: flourSilo1T,
        flourSilo2Level: flourSilo2T,
        fermentationVolumeAt: form.fermentationVolumeAt ? new Date(form.fermentationVolumeAt).toISOString() : null,
        moisture: form.moisture, starchPercent: form.starchPercent,
        damagedPercent: form.damagedPercent, foreignMatter: form.foreignMatter,
        totalReceived: truckSummary.totalReceived || 0,
        trucks: truckSummary.truckCount, avgTruckWeight: truckSummary.truckCount > 0 ? (truckSummary.totalNet / truckSummary.truckCount) : null,
        supplier: null, remarks: form.remarks,
      };
      if (editId) await api.put(`/grain/${editId}`, payload);
      else await api.post('/grain', payload);
      const now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setMsg({ type: 'ok', text: `Saved at ${now}` });
      setForm({ ...emptyForm, date: form.date });
      setEditId(null);
      await loadLatest(); await loadEntries();
    } catch (err: any) { setMsg({ type: 'err', text: err.response?.data?.error || 'Save failed' }); }
    setSaving(false);
  }

  function editEntry(e: any) {
    setEditId(e.id);
    setForm({
      date: e.date.split('T')[0],
      grainUnloaded: e.grainUnloaded, washConsumed: e.washConsumed,
      washConsumedAt: e.washConsumedAt ? e.washConsumedAt.slice(0, 16) : nowLocal(),
      // Convert KL back to percentage for editing
      f1Pct: klToPct(e.f1Level, FERM_CAPACITY),
      f2Pct: klToPct(e.f2Level, FERM_CAPACITY),
      f3Pct: klToPct(e.f3Level, FERM_CAPACITY),
      f4Pct: klToPct(e.f4Level, FERM_CAPACITY),
      beerWellPct: klToPct(e.beerWellLevel, FERM_CAPACITY),
      pf1Pct: klToPct(e.pf1Level, PF_CAPACITY),
      pf2Pct: klToPct(e.pf2Level, PF_CAPACITY),
      iltPct: klToPct(e.iltLevel, ILT_CAPACITY),
      fltPct: klToPct(e.fltLevel, FLT_CAPACITY),
      fermentationVolumeAt: e.fermentationVolumeAt ? e.fermentationVolumeAt.slice(0, 16) : nowLocal(),
      quarantineStock: e.quarantineStock ?? null,
      flourSilo1Pct: klToPct(e.flourSilo1Level, FLOUR_SILO_CAP),
      flourSilo2Pct: klToPct(e.flourSilo2Level, FLOUR_SILO_CAP),
      moisture: e.moisture, starchPercent: e.starchPercent,
      damagedPercent: e.damagedPercent, foreignMatter: e.foreignMatter,
      remarks: e.remarks || '',
    });
    // Load the correct previous entry (before the one being edited)
    loadLatest(e.id);
    window.scrollTo(0, 0);
  }

  async function deleteEntry(id: string) {
    if (!confirm('Delete this entry?')) return;
    try {
      await api.delete(`/grain/${id}`);
      await loadLatest(); await loadEntries();
      setMsg({ type: 'ok', text: 'Deleted.' });
    } catch (err: any) { setMsg({ type: 'err', text: err.response?.data?.error || 'Delete failed' }); }
  }

  const DiffCell = ({ val, unit = '' }: { val: number; unit?: string }) => (
    <span className={`font-semibold ${val > 0 ? 'text-green-600' : val < 0 ? 'text-red-500' : 'text-gray-400'}`}>
      {val > 0 ? '+' : ''}{val.toFixed(1)}{unit ? ` ${unit}` : ''}
    </span>
  );

  const Bar = ({ p }: { p: number }) => (
    <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all ${p > 80 ? 'bg-red-400' : p > 50 ? 'bg-amber-400' : 'bg-green-400'}`}
        style={{ width: `${Math.min(100, p)}%` }} />
    </div>
  );

  // Helper to get prev percentage from prev KL
  const prevPct = (key: string, cap: number) => {
    const kl = (prev as any)?.[key] ?? 0;
    return kl ? Math.round((kl / cap) * 100) : 0;
  };

  return (
    <ProcessPage title="Grain Stock" icon={<Wheat size={28} />} description="Track silo balance, fermenter levels & wash — grain received auto-pulled from truck unloading" flow={{ from: 'Truck / Process', to: 'Grain Silo' }} color="bg-amber-600">
      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 md:gap-3 mb-4 md:mb-5">
        {[
          { label: 'Silo Stock', value: (form.grainUnloaded != null || form.washConsumed != null) ? siloClosing : (defaults.siloOpeningStock ?? 0), unit: 'Ton', color: 'bg-amber-50 border-amber-200' },
          { label: 'Grain@Plant', value: form.f1Pct != null ? totalAtPlant : (defaults.totalGrainAtPlant ?? 0), unit: 'Ton', color: 'bg-green-50 border-green-200' },
          { label: 'Last Unloaded', value: form.grainUnloaded ?? (defaults.lastUnloaded ?? 0), unit: 'Ton', color: 'bg-blue-50 border-blue-200' },
          { label: 'Quarantine', value: form.quarantineStock ?? (defaults.quarantineStock ?? 0), unit: 'Ton', color: 'bg-orange-50 border-orange-200' },
          { label: 'Year Received', value: (defaults.cumulativeUnloaded ?? 0) + (truckSummary.totalReceived || 0), unit: 'Ton', color: 'bg-purple-50 border-purple-200' },
        ].map(k => (
          <div key={k.label} className={`rounded-lg border p-2 md:p-3 ${k.color}`}>
            <div className="text-[10px] md:text-xs text-gray-500">{k.label}</div>
            <div className="text-lg md:text-xl font-bold">{typeof k.value === 'number' ? k.value.toFixed(1) : k.value} <span className="text-[10px] md:text-xs font-normal text-gray-400">{k.unit}</span></div>
          </div>
        ))}
      </div>

      {msg && (
        <div className={`rounded-lg p-3 mb-4 text-sm ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{msg.text}</div>
      )}

      {/* === 1. GRAIN RECEIVED (from Grain Unloading page) === */}
      <InputCard title={editId ? '✏️ Edit — Grain Stock' : 'Grain Received (from trucks)'}>
        <Field label="Date" name="date" value={form.date} onChange={(_n: string, v: any) => { u('date', v); }} unit="" />
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 mb-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-amber-600 font-medium">Auto-fetched from Grain Unloading page</span>
            <button onClick={loadTruckSummary} className="text-xs text-blue-600 hover:underline">Refresh</button>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-[10px] text-gray-500">Trucks</div>
              <div className="font-bold text-lg">{truckSummary.truckCount}</div>
            </div>
            <div>
              <div className="text-[10px] text-gray-500">To Silo</div>
              <div className="font-bold text-lg text-amber-700">{truckSummary.totalNet.toFixed(1)} T</div>
            </div>
            <div>
              <div className="text-[10px] text-gray-500 flex items-center justify-center gap-0.5"><AlertTriangle size={10} /> Quarantine</div>
              <div className="font-bold text-lg text-orange-600">{truckSummary.quarantineNet.toFixed(1)} T</div>
            </div>
          </div>
          {truckSummary.truckCount > 0 && (
            <button onClick={() => setShowTruckList(v => !v)} className="text-xs text-blue-600 hover:underline mt-2 flex items-center gap-1">
              {showTruckList ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {showTruckList ? 'Hide' : 'Show'} truck details
            </button>
          )}
          {showTruckList && truckList.length > 0 && (
            <div className="mt-2 space-y-1 border-t pt-2">
              {truckList.map((t: any) => (
                <div key={t.id} className="flex justify-between items-center text-xs text-gray-600">
                  <span>{t.vehicleNo}{t.supplier ? ` — ${t.supplier}` : ''}{t.bags > 0 ? ` (${t.bags} bags)` : ''}</span>
                  <span className="font-medium">
                    Net: {t.weightNet.toFixed(1)}T
                    {t.quarantineWeight > 0 && <span className="text-orange-500 ml-1">Q: {t.quarantineWeight.toFixed(1)}T</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-between items-center py-2 px-1">
          <span className="text-xs text-gray-500">Grain to Silo (from trucks)</span>
          <span className="font-bold text-amber-700">{grainReceived.toFixed(1)} Ton</span>
        </div>
        {grainReceived > 0 && (
          <div className="flex justify-between items-center py-1 px-1 text-xs">
            <span className="text-red-400">Milling Loss ({(MILLING_LOSS_PCT * 100).toFixed(1)}%)</span>
            <span className="text-red-500 font-medium">−{millingLoss.toFixed(1)} T → Effective: {effectiveGrain.toFixed(1)} T</span>
          </div>
        )}
        <div className="mt-2 p-3 rounded-lg bg-orange-50 border border-orange-200">
          <label className="text-xs text-orange-600 font-medium mb-1 block">Quarantine Stock (not in silo)</label>
          <div className="flex items-center gap-2">
            <input type="number" value={form.quarantineStock ?? ''} onChange={e => u('quarantineStock', e.target.value ? parseFloat(e.target.value) : null)}
              placeholder="Total quarantine tonnage" className="input-field flex-1 text-sm" step="any" />
            <span className="text-sm text-gray-500 shrink-0">Ton</span>
          </div>
          <p className="text-[10px] text-gray-400 mt-1">Grain held separately — not counted in silo stock or plant total</p>
        </div>

        {/* Flour Silos */}
        <div className="mt-3 p-3 rounded-lg bg-yellow-50 border border-yellow-200">
          <label className="text-xs text-yellow-700 font-medium mb-2 block">Flour Silos ({FLOUR_SILO_CAP} T each) — enter level %</label>
          <div className="grid grid-cols-2 gap-3">
            {([{ key: 'flourSilo1Pct' as const, label: 'Flour Silo 1', t: flourSilo1T },
              { key: 'flourSilo2Pct' as const, label: 'Flour Silo 2', t: flourSilo2T }]).map(s => (
              <div key={s.key} className="border rounded-lg p-3 bg-white border-yellow-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-yellow-700">{s.label}</span>
                  <span className="text-xs text-gray-500">{s.t.toFixed(1)} T</span>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <input type="number" value={form[s.key] ?? ''} onChange={e => u(s.key, e.target.value ? parseFloat(e.target.value) : null)}
                    placeholder="%" className="input-field w-full text-sm" min={0} max={100} step={1} />
                  <span className="text-sm text-gray-400 shrink-0">%</span>
                </div>
                <Bar p={form[s.key] || 0} />
              </div>
            ))}
          </div>
          {flourSiloTotal > 0 && (
            <div className="text-right text-xs text-yellow-700 mt-1.5">
              Total Flour: <span className="font-semibold">{flourSiloTotal.toFixed(1)} T</span>
            </div>
          )}
        </div>
      </InputCard>

      {/* === 2. WASH CONSUMED === */}
      <InputCard title={`Wash Distilled${prev ? ` — prev: ${pW.toFixed(1)} KL on ${fmtDt(prev.washConsumedAt)}` : ''}`}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Volume (KL)</label>
            <input type="number" value={form.washConsumed ?? ''} onChange={e => u('washConsumed', e.target.value ? parseFloat(e.target.value) : null)}
              placeholder="From distillation section" className="input-field w-full text-lg" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Date & Time of Reading</label>
            <input type="datetime-local" value={form.washConsumedAt} onChange={e => u('washConsumedAt', e.target.value)}
              className="input-field w-full" />
          </div>
        </div>
        {prev && form.washConsumed != null && (() => {
          const flowRateKLH = washElapsed > 0 ? washDiff / (washElapsed / 3600000) : 0;
          const flowRateTPH = flowRateKLH * FERM_GRAIN_PCT;
          return (
            <div className="mt-3 p-2.5 rounded bg-gray-50 space-y-1.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">New wash (flow diff):</span>
                <span>
                  <DiffCell val={washDiff} unit="KL" />
                  <span className="text-gray-400 mx-2">→</span>
                  <span className="font-semibold text-amber-600">{grainConsumed.toFixed(1)} T grain</span>
                  {washElapsed > 0 && <span className="text-gray-400 ml-2 text-xs">in {elapsed(washElapsed)}</span>}
                </span>
              </div>
              {flowRateKLH > 0 && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">Avg flow rate:</span>
                  <span className="font-semibold text-blue-600">{flowRateKLH.toFixed(1)} KL/hr → {flowRateTPH.toFixed(1)} TPH grain</span>
                </div>
              )}
            </div>
          );
        })()}
      </InputCard>

      {/* === 3. FERMENTER LEVELS (percentage input) === */}
      <InputCard title="Fermenter & PF Levels">
        <div className="flex items-center justify-between mb-3">
          <div>
            <label className="text-xs text-gray-500">Date & Time of Level Reading</label>
            <input type="datetime-local" value={form.fermentationVolumeAt} onChange={e => u('fermentationVolumeAt', e.target.value)}
              className="input-field mt-1" />
          </div>
          {fermElapsed > 0 && <span className="text-xs text-gray-400">Since last: {elapsed(fermElapsed)}</span>}
        </div>

        <div className="text-xs text-gray-400 font-medium mb-2 mt-1">FERMENTERS — {FERM_CAPACITY} KL each, grain = vol × {(FERM_GRAIN_PCT * 100).toFixed(0)}%</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(['f1Pct', 'f2Pct', 'f3Pct', 'f4Pct'] as const).map((key, i) => {
            const curPct = form[key] || 0;
            const curKL = pctToKl(form[key], FERM_CAPACITY);
            const prvPctVal = prevPct(`f${i + 1}Level`, FERM_CAPACITY);
            return (
              <div key={key} className="border rounded-lg p-3 bg-white">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-gray-700">F{i + 1}</span>
                  <span className="text-xs text-gray-500">{curKL.toFixed(0)} KL</span>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <input type="number" value={form[key] ?? ''} onChange={e => u(key, e.target.value ? parseFloat(e.target.value) : null)}
                    placeholder="%" className="input-field w-full text-sm" min={0} max={100} step={1} />
                  <span className="text-sm text-gray-400 shrink-0">%</span>
                </div>
                <Bar p={curPct} />
                {prev && (
                  <div className="flex justify-between text-xs text-gray-400 mt-1.5">
                    <span>Prev: {prvPctVal}%</span>
                    {(curPct - prvPctVal) !== 0 && <DiffCell val={curPct - prvPctVal} unit="%" />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {/* Beer Well - same capacity as fermenter */}
        <div className="grid grid-cols-2 gap-3 mt-3">
          {(() => {
            const curPct = form.beerWellPct || 0;
            const curKL = beerWellKL;
            const prvPctVal = prevPct('beerWellLevel', FERM_CAPACITY);
            return (
              <div className="border rounded-lg p-3 bg-white border-purple-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-purple-700">Beer Well</span>
                  <span className="text-xs text-gray-500">{curKL.toFixed(0)} KL</span>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <input type="number" value={form.beerWellPct ?? ''} onChange={e => u('beerWellPct', e.target.value ? parseFloat(e.target.value) : null)}
                    placeholder="%" className="input-field w-full text-sm" min={0} max={100} step={1} />
                  <span className="text-sm text-gray-400 shrink-0">%</span>
                </div>
                <Bar p={curPct} />
                {prev && (
                  <div className="flex justify-between text-xs text-gray-400 mt-1.5">
                    <span>Prev: {prvPctVal}%</span>
                    {(curPct - prvPctVal) !== 0 && <DiffCell val={curPct - prvPctVal} unit="%" />}
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        <div className="text-right text-sm text-gray-600 mt-2">
          Wash Made (F1-F4 + BW): <span className="font-semibold text-blue-700">{fermVol.toFixed(0)} KL</span>
          <span className="mx-1">→</span>
          Grain: <span className="font-semibold text-amber-600">{grainInFerm.toFixed(1)} T</span>
        </div>

        <div className="text-xs text-gray-400 font-medium mb-2 mt-4">PRE-FERMENTERS — {PF_CAPACITY} KL each, grain = vol × {(PF_GRAIN_PCT * 100).toFixed(0)}%</div>
        <div className="grid grid-cols-2 gap-3">
          {(['pf1Pct', 'pf2Pct'] as const).map((key, i) => {
            const curPct = form[key] || 0;
            const curKL = pctToKl(form[key], PF_CAPACITY);
            const prvPctVal = prevPct(`pf${i + 1}Level`, PF_CAPACITY);
            return (
              <div key={key} className="border rounded-lg p-3 bg-white">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-gray-700">PF{i + 1}</span>
                  <span className="text-xs text-gray-500">{curKL.toFixed(0)} KL</span>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <input type="number" value={form[key] ?? ''} onChange={e => u(key, e.target.value ? parseFloat(e.target.value) : null)}
                    placeholder="%" className="input-field w-full text-sm" min={0} max={100} step={1} />
                  <span className="text-sm text-gray-400 shrink-0">%</span>
                </div>
                <Bar p={curPct} />
                {prev && (
                  <div className="flex justify-between text-xs text-gray-400 mt-1.5">
                    <span>Prev: {prvPctVal}%</span>
                    {(curPct - prvPctVal) !== 0 && <DiffCell val={curPct - prvPctVal} unit="%" />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="text-right text-sm text-gray-600 mt-2">
          Total: <span className="font-semibold">{pfVol.toFixed(0)} KL</span>
          <span className="mx-1">→</span>
          Grain: <span className="font-semibold text-amber-600">{grainInPF.toFixed(1)} T</span>
        </div>

        <div className="text-xs text-gray-400 font-medium mb-2 mt-4">ILT & FLT — grain = vol × {(FERM_GRAIN_PCT * 100).toFixed(0)}%</div>
        <div className="grid grid-cols-2 gap-3">
          {([{ key: 'iltPct' as const, label: 'ILT', cap: ILT_CAPACITY, kl: iltKL, prevKey: 'iltLevel' },
            { key: 'fltPct' as const, label: 'FLT', cap: FLT_CAPACITY, kl: fltKL, prevKey: 'fltLevel' }]).map(t => {
            const curPct = form[t.key] || 0;
            const prvPctVal = prev ? Math.round(((prev[t.prevKey] || 0) / t.cap) * 10000) / 100 : 0;
            return (
              <div key={t.key} className="border rounded-lg p-3 bg-white border-teal-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-teal-700">{t.label}</span>
                  <span className="text-xs text-gray-500">{t.kl.toFixed(0)} KL <span className="text-gray-400">/ {t.cap}</span></span>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <input type="number" value={form[t.key] ?? ''} onChange={e => u(t.key, e.target.value ? parseFloat(e.target.value) : null)}
                    placeholder="%" className="input-field w-full text-sm" min={0} max={100} step={1} />
                  <span className="text-sm text-gray-400 shrink-0">%</span>
                </div>
                <Bar p={curPct} />
                {prev && (
                  <div className="flex justify-between text-xs text-gray-400 mt-1.5">
                    <span>Prev: {prvPctVal}%</span>
                    {(curPct - prvPctVal) !== 0 && <DiffCell val={curPct - prvPctVal} unit="%" />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="text-right text-sm text-gray-600 mt-2">
          Total: <span className="font-semibold">{iltFltVol.toFixed(0)} KL</span>
          <span className="mx-1">→</span>
          Grain: <span className="font-semibold text-amber-600">{grainInIltFlt.toFixed(1)} T</span>
        </div>

        {prev && (
          <div className="mt-4 p-2.5 rounded bg-amber-50 border border-amber-200 flex items-center justify-between text-sm">
            <span className="text-amber-800">Total grain in process:</span>
            <span>
              <span className="text-gray-500">{pGIP.toFixed(1)} T → </span>
              <span className="font-bold text-amber-700">{grainInProcess.toFixed(1)} T</span>
              <span className="ml-2"><DiffCell val={grainInProcess - pGIP} unit="T" /></span>
            </span>
          </div>
        )}
      </InputCard>

      {/* === 4. AUTO-CALCULATED === */}
      <InputCard title="Summary (Auto)">
        {(() => {
          const prevFermGrain = prev ? ((prev.f1Level||0)+(prev.f2Level||0)+(prev.f3Level||0)+(prev.f4Level||0)+(prev.beerWellLevel||0)) * FERM_GRAIN_PCT : 0;
          const fermDiff = grainInFerm - prevFermGrain;
          const prevPFGrain = prev ? ((prev.pf1Level||0)+(prev.pf2Level||0)) * PF_GRAIN_PCT : 0;
          const pfDiff = grainInPF - prevPFGrain;
          const prevIltFltGrain = prev ? ((prev.iltLevel||0)+(prev.fltLevel||0)) * FERM_GRAIN_PCT : 0;
          const iltFltDiff = grainInIltFlt - prevIltFltGrain;
          return (
          <div className="text-sm divide-y divide-gray-100">
            {/* Row helper */}
            {[
              { label: 'Wash Made', value: `${washMade.toFixed(1)} KL`, sub: 'Δ ferm vol + distilled' },
              { label: 'Wash Distilled', value: `${washDiff.toFixed(1)} KL`, sub: `meter: ${(form.washConsumed ?? 0).toFixed(1)} KL` },
              { label: 'Grain Distilled', value: `${grainDistilled.toFixed(2)} T`, sub: `wash × ${(FERM_GRAIN_PCT * 100).toFixed(0)}%` },
              { label: 'Δ Grain in Process', value: `${deltaGrainInProcess >= 0 ? '+' : ''}${deltaGrainInProcess.toFixed(2)} T`, sub: 'ferm+PF+ILT/FLT' },
              { label: 'Δ Flour Silos', value: `${deltaFlour >= 0 ? '+' : ''}${deltaFlour.toFixed(2)} T`, sub: 'after milling' },
              { label: 'Grain Consumed (Silo)', value: `${grainConsumed.toFixed(2)} T`, sub: 'max(0, distilled+Δprocess+Δflour)', highlight: true },
            ].map((r, i) => (
              <div key={i} className={`flex justify-between items-center py-2 px-1 ${(r as any).highlight ? 'bg-red-50 rounded px-2' : ''}`}>
                <span className="text-gray-600 text-xs">{r.label}{r.sub && <span className="hidden md:inline text-gray-400 ml-1">({r.sub})</span>}</span>
                <span className={`font-semibold ${(r as any).highlight ? 'text-red-700 font-bold' : ''}`}>{r.value}</span>
              </div>
            ))}

            {/* Fermenter grain with diff */}
            <div className="py-2 px-1">
              <div className="flex justify-between items-center">
                <span className="text-gray-600 text-xs">Grain in Fermenters</span>
                <span className="font-semibold">{grainInFerm.toFixed(2)} T</span>
              </div>
              {prev && <div className="flex justify-end gap-2 mt-0.5">
                <span className="text-[11px] text-gray-400">prev: {prevFermGrain.toFixed(1)} T</span>
                <span className={`text-[11px] font-semibold ${fermDiff < 0 ? 'text-red-500' : 'text-green-600'}`}>{fermDiff >= 0 ? '+' : ''}{fermDiff.toFixed(1)} T</span>
              </div>}
            </div>

            {/* PF grain with diff */}
            <div className="py-2 px-1">
              <div className="flex justify-between items-center">
                <span className="text-gray-600 text-xs">Grain in PF</span>
                <span className="font-semibold">{grainInPF.toFixed(2)} T</span>
              </div>
              {prev && <div className="flex justify-end gap-2 mt-0.5">
                <span className="text-[11px] text-gray-400">prev: {prevPFGrain.toFixed(1)} T</span>
                <span className={`text-[11px] font-semibold ${pfDiff < 0 ? 'text-red-500' : 'text-green-600'}`}>{pfDiff >= 0 ? '+' : ''}{pfDiff.toFixed(1)} T</span>
              </div>}
            </div>

            {/* ILT/FLT grain with diff */}
            <div className="py-2 px-1">
              <div className="flex justify-between items-center">
                <span className="text-gray-600 text-xs">Grain in ILT + FLT</span>
                <span className="font-semibold">{grainInIltFlt.toFixed(2)} T</span>
              </div>
              {prev && <div className="flex justify-end gap-2 mt-0.5">
                <span className="text-[11px] text-gray-400">prev: {prevIltFltGrain.toFixed(1)} T</span>
                <span className={`text-[11px] font-semibold ${iltFltDiff < 0 ? 'text-red-500' : 'text-green-600'}`}>{iltFltDiff >= 0 ? '+' : ''}{iltFltDiff.toFixed(1)} T</span>
              </div>}
            </div>

            {/* Highlighted totals */}
            <div className="flex justify-between items-center py-2 px-2 bg-amber-50 rounded">
              <span className="text-amber-800 font-medium text-xs">Grain in Process</span>
              <span className="font-bold text-amber-700">{grainInProcess.toFixed(2)} T</span>
            </div>
            <div className="flex justify-between items-center py-2 px-1">
              <span className="text-gray-600 text-xs">Ferm Volume</span>
              <span className="font-semibold">{totalFermVol.toFixed(0)} KL</span>
            </div>
            <div className="flex justify-between items-center py-2 px-1">
              <span className="text-gray-600 text-xs">Silo Opening</span>
              <span className="font-semibold">{opening.toFixed(2)} T</span>
            </div>
            {millingLoss > 0 && (
              <div className="flex justify-between items-center py-2 px-1">
                <span className="text-red-400 text-xs">Milling Loss ({(MILLING_LOSS_PCT * 100).toFixed(1)}%)</span>
                <span className="font-semibold text-red-500">−{millingLoss.toFixed(2)} T</span>
              </div>
            )}
            <div className="flex justify-between items-center py-2 px-1">
              <span className="text-gray-600 text-xs">Silo Closing</span>
              <span className="font-bold">{siloClosing.toFixed(2)} T</span>
            </div>
            <div className="flex justify-between items-center py-2 px-2 bg-green-50 rounded">
              <span className="text-green-800 font-medium text-xs">Total Grain at Plant</span>
              <span className="font-bold text-green-700">{totalAtPlant.toFixed(2)} T</span>
            </div>
            {(form.quarantineStock ?? 0) > 0 && (
              <div className="flex justify-between items-center py-2 px-2 bg-orange-50 rounded">
                <span className="text-orange-800 font-medium text-xs">Quarantine (separate)</span>
                <span className="font-bold text-orange-700">{(form.quarantineStock ?? 0).toFixed(2)} T</span>
              </div>
            )}
            {flourSiloTotal > 0 && (
              <div className="flex justify-between items-center py-2 px-2 bg-yellow-50 rounded">
                <span className="text-yellow-800 font-medium text-xs">Flour Silos (S1: {flourSilo1T.toFixed(1)}T + S2: {flourSilo2T.toFixed(1)}T)</span>
                <span className="font-bold text-yellow-700">{flourSiloTotal.toFixed(2)} T</span>
              </div>
            )}
          </div>
          );
        })()}
      </InputCard>

      {/* === 5. QUALITY & REMARKS === */}
      <InputCard title="Quality & Remarks (Optional)">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Moisture %</label>
            <input type="number" value={form.moisture ?? ''} onChange={e => u('moisture', e.target.value ? parseFloat(e.target.value) : null)} className="input-field w-full text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Starch %</label>
            <input type="number" value={form.starchPercent ?? ''} onChange={e => u('starchPercent', e.target.value ? parseFloat(e.target.value) : null)} className="input-field w-full text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Damaged %</label>
            <input type="number" value={form.damagedPercent ?? ''} onChange={e => u('damagedPercent', e.target.value ? parseFloat(e.target.value) : null)} className="input-field w-full text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Foreign Matter %</label>
            <input type="number" value={form.foreignMatter ?? ''} onChange={e => u('foreignMatter', e.target.value ? parseFloat(e.target.value) : null)} className="input-field w-full text-sm" />
          </div>
        </div>
        <div className="mt-3">
          <label className="text-xs text-gray-500 mb-1 block">Remarks</label>
          <input type="text" value={form.remarks} onChange={e => u('remarks', e.target.value)} className="input-field w-full" placeholder="Any notes..." />
        </div>
      </InputCard>

      <div className="flex flex-col md:flex-row md:justify-end gap-2 md:gap-3 mt-4 mb-6">
        {editId && <button onClick={() => { setEditId(null); setForm({ ...emptyForm }); loadLatest(); }} className="btn-secondary w-full md:w-auto">Cancel Edit</button>}
        <button onClick={() => setShowPreview(true)} className="flex items-center justify-center gap-2 bg-gray-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800 transition w-full md:w-auto">
          <Eye size={16} /> Preview & Save
        </button>
        {msg && <span className={`text-sm font-medium self-center ${msg.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</span>}
      </div>

      {showPreview && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowPreview(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-amber-600 text-white p-4 rounded-t-xl flex items-center justify-between">
              <h3 className="font-bold text-lg">Grain Stock Report</h3>
              <button onClick={() => setShowPreview(false)} className="p-1 hover:bg-amber-700 rounded"><X size={20} /></button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div className="flex justify-between text-gray-600 border-b pb-2">
                <span>Date: <strong>{form.date}</strong></span>
                {prev && prevElapsed > 0 && <span className="text-xs text-gray-400">last entry {fmtHrs(prevElapsed)} ago</span>}
              </div>
              {/* Wash diffs */}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-blue-50 rounded p-2 text-center">
                  <div className="text-xs text-gray-500">Wash Made</div>
                  <div className="font-bold text-lg">{washMade.toFixed(1)} KL</div>
                  {prev && <div className="text-[10px] text-gray-400">Δ ferm {(fermVol - prevFermVol) >= 0 ? '+' : ''}{(fermVol - prevFermVol).toFixed(1)} + distilled {washDiff.toFixed(1)}</div>}
                  {fermElapsed > 0 && <div className="text-[10px] text-blue-500">in {fmtHrs(fermElapsed)}</div>}
                </div>
                <div className="bg-purple-50 rounded p-2 text-center">
                  <div className="text-xs text-gray-500">Wash Distilled</div>
                  <div className="font-bold text-lg">{washDiff.toFixed(1)} KL</div>
                  {prev && <div className="text-[10px] text-gray-400">meter: {(form.washConsumed ?? 0).toFixed(1)} (prev {pW.toFixed(1)})</div>}
                  {washElapsed > 0 && <div className="text-[10px] text-purple-500">in {fmtHrs(washElapsed)}</div>}
                </div>
              </div>
              {/* Grain + Trucks */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-amber-50 rounded p-2 text-center">
                  <div className="text-xs text-gray-500">Grain Unloaded</div>
                  <div className="font-bold text-lg">{form.grainUnloaded ?? '—'} MT</div>
                </div>
                <div className="bg-red-50 rounded p-2 text-center">
                  <div className="text-xs text-gray-500">Grain Consumed</div>
                  <div className="font-bold text-lg">{grainConsumed.toFixed(2)} T</div>
                  <div className="text-[10px] text-gray-400">silo mass balance</div>
                </div>
                <div className="bg-green-50 rounded p-2 text-center">
                  <div className="text-xs text-gray-500">Trucks</div>
                  <div className="font-bold text-lg">{truckSummary.truckCount}</div>
                  {truckSummary.truckCount > 0 && <div className="text-[10px] text-gray-400">net {truckSummary.totalNet.toFixed(1)} T{prevElapsed > 0 ? ` in ${fmtHrs(prevElapsed)}` : ''}</div>}
                </div>
              </div>
              <div>
                <h4 className="font-semibold text-gray-700 mb-1">Fermenter Levels (%)</h4>
                <div className="grid grid-cols-5 gap-2">
                  {[{l:'F1',v:form.f1Pct},{l:'F2',v:form.f2Pct},{l:'F3',v:form.f3Pct},{l:'F4',v:form.f4Pct},{l:'BW',v:form.beerWellPct}].map(f=>
                    <div key={f.l} className="bg-blue-50 rounded p-2 text-center"><div className="text-xs text-gray-500">{f.l}</div><div className="font-semibold">{f.v ?? '—'}%</div></div>
                  )}
                </div>
              </div>
              <div>
                <h4 className="font-semibold text-gray-700 mb-1">PF Levels (%)</h4>
                <div className="grid grid-cols-2 gap-2">
                  {[{l:'PF1',v:form.pf1Pct},{l:'PF2',v:form.pf2Pct}].map(f=>
                    <div key={f.l} className="bg-green-50 rounded p-2 text-center"><div className="text-xs text-gray-500">{f.l}</div><div className="font-semibold">{f.v ?? '—'}%</div></div>
                  )}
                </div>
              </div>
              <div>
                <h4 className="font-semibold text-gray-700 mb-1">ILT & FLT (%)</h4>
                <div className="grid grid-cols-2 gap-2">
                  {[{l:'ILT',v:form.iltPct},{l:'FLT',v:form.fltPct}].map(f=>
                    <div key={f.l} className="bg-teal-50 rounded p-2 text-center"><div className="text-xs text-gray-500">{f.l}</div><div className="font-semibold">{f.v ?? '—'}%</div></div>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-gray-50 rounded p-2 text-center"><div className="text-xs text-gray-500">Moisture</div><div className="font-semibold">{form.moisture ?? '—'}%</div></div>
                <div className="bg-gray-50 rounded p-2 text-center"><div className="text-xs text-gray-500">Starch</div><div className="font-semibold">{form.starchPercent ?? '—'}%</div></div>
              </div>
              {/* truck count already shown above */}
              {(form.quarantineStock ?? 0) > 0 && <div className="text-orange-600 font-medium">Quarantine Stock: <strong>{(form.quarantineStock ?? 0).toFixed(1)} T</strong> (not in silo)</div>}
              {flourSiloTotal > 0 && (
                <div className="text-yellow-700 font-medium">Flour Silos: <strong>S1: {flourSilo1T.toFixed(1)} T ({form.flourSilo1Pct ?? 0}%) | S2: {flourSilo2T.toFixed(1)} T ({form.flourSilo2Pct ?? 0}%)</strong></div>
              )}
              {form.remarks && <div className="text-gray-600 italic">Remarks: {form.remarks}</div>}
            </div>
            <div className="sticky bottom-0 bg-gray-50 p-4 rounded-b-xl flex gap-3 border-t">
              <button onClick={() => { handleSave(); setShowPreview(false); }} disabled={saving} className="flex-1 flex items-center justify-center gap-2 bg-amber-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50 transition">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {editId ? 'Update' : 'Save'} Entry
              </button>
              <button onClick={() => {
                const t = `*GRAIN STOCK REPORT*\nDate: ${form.date}${prevElapsed > 0 ? ` (last entry ${fmtHrs(prevElapsed)} ago)` : ''}\nGrain to Silo: ${form.grainUnloaded ?? '—'} T (${truckSummary.truckCount} trucks, net ${truckSummary.totalNet.toFixed(1)} T)${(form.quarantineStock ?? 0) > 0 ? `\nQuarantine: ${(form.quarantineStock ?? 0).toFixed(1)} T (not in silo)` : ''}${flourSiloTotal > 0 ? `\nFlour Silos: S1: ${flourSilo1T.toFixed(1)} T (${form.flourSilo1Pct ?? 0}%) | S2: ${flourSilo2T.toFixed(1)} T (${form.flourSilo2Pct ?? 0}%)` : ''}\nWash Made: ${washMade.toFixed(1)} KL (Δferm ${(fermVol - prevFermVol).toFixed(1)} + distilled ${washDiff.toFixed(1)})${fermElapsed > 0 ? ' in ' + fmtHrs(fermElapsed) : ''}\nWash Distilled: ${washDiff.toFixed(1)} KL${washElapsed > 0 ? ' in ' + fmtHrs(washElapsed) : ''}\nGrain Consumed: ${grainConsumed.toFixed(2)} T (distilled ${grainDistilled.toFixed(2)} + Δprocess ${deltaGrainInProcess.toFixed(2)} + Δflour ${deltaFlour.toFixed(2)})\nF1: ${form.f1Pct ?? '—'}% | F2: ${form.f2Pct ?? '—'}% | F3: ${form.f3Pct ?? '—'}% | F4: ${form.f4Pct ?? '—'}%\nBeer Well: ${form.beerWellPct ?? '—'}%\nPF1: ${form.pf1Pct ?? '—'}% | PF2: ${form.pf2Pct ?? '—'}%\nILT: ${form.iltPct ?? '—'}% | FLT: ${form.fltPct ?? '—'}%\nSilo Closing: ${siloClosing.toFixed(1)} T | Total@Plant: ${totalAtPlant.toFixed(1)} T${form.remarks ? '\nRemarks: ' + form.remarks : ''}`;
                window.open(`https://wa.me/?text=${encodeURIComponent(t)}`, '_blank');
              }} className="flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-green-700 transition">
                <Share2 size={16} /> WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}

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
                  <th className="py-2 pr-3">Ferm Vol</th>
                  <th className="py-2 pr-3">Grain@Process</th>
                  <th className="py-2 pr-3">Silo Close</th>
                  <th className="py-2 pr-3">Total@Plant</th>
                  <th className="py-2 pr-3">Quarantine</th>
                  <th className="py-2 pr-3">Flour</th>
                  {isAdmin && <th className="py-2"></th>}
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.id} className={`border-b ${isAdmin ? 'hover:bg-gray-50 cursor-pointer' : ''}`} onClick={() => isAdmin && editEntry(e)}>
                    <td className="py-2 pr-3 font-medium">{e.date.split('T')[0]}</td>
                    <td className="py-2 pr-3">{e.grainUnloaded?.toFixed(1)}</td>
                    <td className="py-2 pr-3">{e.washConsumed?.toFixed(1)}</td>
                    <td className="py-2 pr-3">{e.fermentationVolume?.toFixed(0)}</td>
                    <td className="py-2 pr-3">{e.grainInProcess?.toFixed(1)}</td>
                    <td className="py-2 pr-3 font-semibold">{e.siloClosingStock?.toFixed(1)}</td>
                    <td className="py-2 pr-3 font-semibold">{e.totalGrainAtPlant?.toFixed(1)}</td>
                    <td className="py-2 pr-3 text-orange-600">{e.quarantineStock > 0 ? e.quarantineStock?.toFixed(1) : '—'}</td>
                    <td className="py-2 pr-3 text-yellow-700">{((e.flourSilo1Level || 0) + (e.flourSilo2Level || 0)) > 0 ? ((e.flourSilo1Level || 0) + (e.flourSilo2Level || 0)).toFixed(1) : '—'}</td>
                    {isAdmin && <td className="py-2">
                      <button onClick={(ev) => { ev.stopPropagation(); deleteEntry(e.id); }} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                    </td>}
                  </tr>
                ))}
                {entries.length === 0 && <tr><td colSpan={10} className="py-4 text-center text-gray-400">No entries yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ProcessPage>
  );
}
