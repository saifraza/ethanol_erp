import { useState, useEffect, useCallback } from 'react';
import { Share2, Beaker, FlaskConical, RefreshCw, Clock, ArrowDown, Droplets, Plus, CheckCircle, AlertTriangle, ArrowRight } from 'lucide-react';
import api from '../../services/api';
import PreFermentation from './PreFermentation';
import FermentationBatches from './FermentationBatches';
import FermentationLab from './FermentationLab';

/* ═══════ TYPES ═══════ */
interface PFBatch {
  id: string; batchNo: number; fermenterNo: number; phase: string;
  setupTime: string | null; slurryGravity: number | null; slurryTemp: number | null;
  slurryVolume: number | null; dosingEndTime: string | null; transferTime: string | null;
  cipStartTime: string | null; cipEndTime: string | null;
  dosings: any[]; labReadings: any[]; createdAt: string;
  lastGravity: number | null; readyToTransfer: boolean; gravityTarget: number;
}
interface FermBatch {
  id: string; batchNo: number; fermenterNo: number; phase: string;
  fillingStartTime: string | null; fillingEndTime: string | null;
  setupEndTime: string | null; reactionStartTime: string | null;
  retentionStartTime: string | null; transferTime: string | null;
  cipStartTime: string | null; cipEndTime: string | null;
  fermLevel: number | null; volume: number | null; setupGravity: number | null;
  dosings: any[]; createdAt: string; lastLab: any | null;
}

import { PF_CAPACITY_KL, BEER_WELL_CAPACITY_KL } from '../../config/constants';
const PF_CAP = PF_CAPACITY_KL;
const BEER_WELL_CAP = BEER_WELL_CAPACITY_KL;
const pfPhaseColors: Record<string, string> = { SETUP: '#6366f1', DOSING: '#f59e0b', LAB: '#10b981', TRANSFER: '#3b82f6', CIP: '#8b5cf6', DONE: '#9ca3af' };
const fermPhaseColors: Record<string, string> = { PF_TRANSFER: '#f97316', FILLING: '#3b82f6', SETUP: '#6366f1', REACTION: '#f59e0b', RETENTION: '#10b981', TRANSFER: '#06b6d4', CIP: '#8b5cf6', DONE: '#9ca3af' };
const pfPhaseLabels: Record<string, string> = { SETUP: 'Setup', DOSING: 'Dosing', LAB: 'Lab', TRANSFER: 'Transfer', CIP: 'CIP', DONE: 'Done' };
const fermPhaseLabels: Record<string, string> = { PF_TRANSFER: 'PF Transfer', FILLING: 'Filling', SETUP: 'Setup', REACTION: 'Reaction', RETENTION: 'Retention', TRANSFER: 'Transfer', CIP: 'CIP', DONE: 'Done' };

const timeSince = (iso: string | null) => {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
};

const pfPhaseStart = (b: PFBatch): string | null => {
  const map: Record<string, string | null> = {
    SETUP: b.setupTime, DOSING: b.setupTime, LAB: b.dosingEndTime,
    TRANSFER: b.transferTime, CIP: b.cipStartTime, DONE: b.cipEndTime
  };
  return map[b.phase] ?? null;
};

const fermPhaseStart = (b: FermBatch): string | null => {
  const map: Record<string, string | null> = {
    PF_TRANSFER: (b as any).pfTransferTime, FILLING: b.fillingStartTime, SETUP: b.fillingEndTime,
    REACTION: b.reactionStartTime, RETENTION: b.retentionStartTime,
    TRANSFER: b.transferTime, CIP: b.cipStartTime, DONE: b.cipEndTime
  };
  return map[b.phase] ?? null;
};

/* ═══════ TANK VISUAL ═══════ */
const Tank = ({ fillPct, color }: { fillPct: number; color: string }) => (
  <div className="relative w-14 h-24 rounded-xl border-2 overflow-hidden bg-gray-50"
    style={{ borderColor: fillPct > 0 ? color + '60' : '#e5e7eb' }}>
    {[25, 50, 75].map(mark => (
      <div key={mark} className="absolute w-full border-t border-dashed border-gray-200" style={{ bottom: `${mark}%` }} />
    ))}
    <div className="absolute bottom-0 w-full transition-all duration-700 ease-out"
      style={{ height: `${Math.min(Math.max(fillPct, 0), 100)}%`,
        background: `linear-gradient(to top, ${color}cc, ${color}66)` }} />
    {fillPct > 0 && (
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[10px] font-bold text-white drop-shadow-sm">{Math.round(fillPct)}%</span>
      </div>
    )}
  </div>
);

/* ═══════ MAIN HUB ═══════ */
export default function Fermentation() {
  const [tab, setTab] = useState<'overview' | 'pf' | 'ferm' | 'lab'>('overview');
  const [pfBatches, setPfBatches] = useState<PFBatch[]>([]);
  const [fermBatches, setFermBatches] = useState<FermBatch[]>([]);
  const [beerWellLevel, setBeerWellLevel] = useState<number | null>(null);
  const [gravityTarget, setGravityTarget] = useState(1.024);
  const [freeFerm, setFreeFerm] = useState<number[]>([]);
  const [transferPF, setTransferPF] = useState<PFBatch | null>(null);
  const [transferFermNo, setTransferFermNo] = useState('');
  const [transferring, setTransferring] = useState(false);

  const load = useCallback(() => {
    api.get('/fermentation/overview').then(r => {
      setPfBatches(r.data.pfBatches || []);
      setFermBatches(r.data.fermBatches || []);
      setGravityTarget(r.data.gravityTarget || 1.024);
    }).catch(() => {
      // Fallback to old endpoints
      api.get('/pre-fermentation/batches').then(r => setPfBatches(r.data)).catch(() => {});
      api.get('/fermentation/batches').then(r => setFermBatches(r.data)).catch(() => {});
    });
    api.get('/grain/latest').then(r => {
      setBeerWellLevel(r.data?.previous?.beerWellLevel ?? null);
    }).catch(() => {});
    api.get('/fermentation/free-vessels').then(r => {
      setFreeFerm(r.data.freeFerm || []);
    }).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (tab !== 'overview') return;
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [tab, load]);

  const getActivePF = (n: number) => pfBatches.find(b => b.fermenterNo === n && b.phase !== 'DONE');
  const getActiveFerm = (n: number) => fermBatches.find(b => b.fermenterNo === n && b.phase !== 'DONE');

  /* Transfer PF → Fermenter */
  const handleTransfer = async () => {
    if (!transferPF || !transferFermNo) return;
    setTransferring(true);
    try {
      await api.post('/fermentation/transfer-pf', {
        pfBatchId: transferPF.id,
        fermenterNo: parseInt(transferFermNo),
      });
      setTransferPF(null);
      setTransferFermNo('');
      load();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Transfer failed');
    }
    setTransferring(false);
  };

  /* Share overview */
  const shareOverview = () => {
    let t = `*FERMENTATION STATUS*\n${new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}\n\n`;
    t += `*── Pre-Fermenters ──*\n`;
    for (const n of [1, 2]) {
      const b = getActivePF(n);
      if (b) {
        t += `PF${n}: #${b.batchNo} — ${pfPhaseLabels[b.phase]}`;
        if (b.lastGravity) t += ` | SG: ${b.lastGravity}`;
        if (b.readyToTransfer) t += ` ✅ READY`;
        t += ` (${timeSince(pfPhaseStart(b))})\n`;
      } else t += `PF${n}: Empty\n`;
    }
    t += `\n*── Fermenters ──*\n`;
    for (const n of [1, 2, 3, 4]) {
      const b = getActiveFerm(n);
      if (b) {
        t += `F${n}: #${b.batchNo} — ${fermPhaseLabels[b.phase]}`;
        if (b.fermLevel) t += ` | ${b.fermLevel}%`;
        if (b.lastLab?.spGravity) t += ` | SG: ${b.lastLab.spGravity}`;
        if (b.lastLab?.alcohol) t += ` | Alc: ${b.lastLab.alcohol}%`;
        t += ` (${timeSince(fermPhaseStart(b))})\n`;
      } else t += `F${n}: Empty\n`;
    }
    t += `\n*Beer Well:* ${beerWellLevel && beerWellLevel > 0 ? `${beerWellLevel.toFixed(0)} KL` : 'Empty'}`;
    if (navigator.share) {
      navigator.share({ text: t }).catch(() => {
        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(t)}`, '_blank');
      });
    } else {
      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(t)}`, '_blank');
    }
  };

  /* ═══════ PF CARD ═══════ */
  const PFCard = ({ pfNo }: { pfNo: number }) => {
    const batch = getActivePF(pfNo);
    const fillPct = batch?.slurryVolume ? (batch.slurryVolume / (PF_CAP * 1000) * 100) : 0;
    const phaseColor = batch ? pfPhaseColors[batch.phase] : '#d1d5db';
    const phaseTime = batch ? pfPhaseStart(batch) : null;
    const ready = batch?.readyToTransfer;

    return (
      <div className={`bg-white rounded-xl shadow-sm border-2 p-4 transition-all ${
        ready ? 'border-green-400 ring-2 ring-green-200 animate-pulse' :
        batch ? 'border-indigo-200' : 'border-gray-100'
      }`}>
        {/* Ready to transfer banner */}
        {ready && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-2 mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle size={16} className="text-green-600" />
              <span className="text-xs font-bold text-green-700">SG {batch!.lastGravity} ≤ {gravityTarget} — Ready to Transfer!</span>
            </div>
            <button onClick={(e) => { e.stopPropagation(); setTransferPF(batch!); setTransferFermNo(freeFerm[0]?.toString() || ''); }}
              className="bg-green-600 text-white px-3 py-1 rounded-lg text-xs font-bold hover:bg-green-700 flex items-center gap-1">
              <ArrowRight size={12} /> Transfer
            </button>
          </div>
        )}
        <div className="flex items-start gap-3">
          <Tank fillPct={fillPct} color={phaseColor} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-gray-800">PF-{pfNo}</h3>
              {batch ? (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold text-white shadow-sm"
                  style={{ backgroundColor: phaseColor }}>{pfPhaseLabels[batch.phase]}</span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-400">Empty</span>
              )}
            </div>
            {batch ? (
              <>
                <p className="text-sm text-gray-500 mt-0.5">Batch <b className="text-gray-700">#{batch.batchNo}</b></p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-2 text-xs">
                  {batch.slurryGravity != null && <span className="text-gray-500">Setup SG: <b className="text-gray-800">{batch.slurryGravity}</b></span>}
                  {batch.lastGravity != null && (
                    <span className="text-gray-500">Latest SG: <b className={batch.readyToTransfer ? 'text-green-700' : 'text-gray-800'}>{batch.lastGravity}</b></span>
                  )}
                  {batch.slurryTemp != null && <span className="text-gray-500">Temp: <b className="text-gray-800">{batch.slurryTemp}°C</b></span>}
                </div>
                {/* Gravity progress bar */}
                {batch.slurryGravity && batch.lastGravity && (
                  <div className="mt-2">
                    <div className="flex justify-between text-[9px] text-gray-400 mb-0.5">
                      <span>Start: {batch.slurryGravity}</span>
                      <span>Target: {gravityTarget}</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${batch.readyToTransfer ? 'bg-green-500' : 'bg-amber-400'}`}
                        style={{ width: `${Math.min(100, Math.max(0, (batch.slurryGravity - batch.lastGravity) / (batch.slurryGravity - gravityTarget) * 100))}%` }} />
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-1 mt-2 text-[11px] text-gray-400">
                  <Clock size={10} />
                  <span>{timeSince(phaseTime)}</span>
                  <span className="mx-0.5">|</span>
                  <span>{batch.dosings?.length || 0} dose</span>
                  <span className="mx-0.5">|</span>
                  <span>{batch.labReadings?.length || 0} lab</span>
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-300 mt-2 italic">No active batch</p>
            )}
          </div>
        </div>
      </div>
    );
  };

  /* ═══════ FERM CARD ═══════ */
  const FermCard = ({ fNo }: { fNo: number }) => {
    const batch = getActiveFerm(fNo);
    const fillPct = batch?.fermLevel || 0;
    const phaseColor = batch ? fermPhaseColors[batch.phase] : '#d1d5db';
    const phaseTime = batch ? fermPhaseStart(batch) : null;
    const lab = batch?.lastLab;

    return (
      <div className={`bg-white rounded-xl shadow-sm border-2 p-4 transition-all ${
        batch ? 'border-emerald-200' : 'border-gray-100'
      }`}>
        <div className="flex items-start gap-3">
          <Tank fillPct={fillPct} color={phaseColor} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-gray-800">F-{fNo}</h3>
              {batch ? (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold text-white shadow-sm"
                  style={{ backgroundColor: phaseColor }}>{fermPhaseLabels[batch.phase]}</span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-400">Empty</span>
              )}
            </div>
            {batch ? (
              <>
                <p className="text-sm text-gray-500 mt-0.5">Batch <b className="text-gray-700">#{batch.batchNo}</b></p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-2 text-xs">
                  {batch.fermLevel != null && <span className="text-gray-500">Level: <b className="text-gray-800">{batch.fermLevel}%</b></span>}
                  {batch.volume != null && <span className="text-gray-500">Vol: <b className="text-gray-800">{(batch.volume / 1000).toFixed(0)} M³</b></span>}
                  {batch.setupGravity != null && <span className="text-gray-500">Setup SG: <b className="text-gray-800">{batch.setupGravity}</b></span>}
                  {lab?.spGravity != null && <span className="text-gray-500">SG: <b className="text-gray-800">{lab.spGravity}</b></span>}
                  {lab?.alcohol != null && <span className="text-gray-500">Alc: <b className="text-gray-800">{lab.alcohol}%</b></span>}
                  {lab?.temp != null && <span className="text-gray-500">Temp: <b className={lab.temp > 37 ? 'text-red-600' : 'text-gray-800'}>{lab.temp}°C</b></span>}
                </div>
                <div className="flex items-center gap-1 mt-2 text-[11px] text-gray-400">
                  <Clock size={10} />
                  <span>{timeSince(phaseTime)}</span>
                  <span className="mx-0.5">|</span>
                  <span>{batch.dosings?.length || 0} chemicals</span>
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-300 mt-2 italic">No active batch</p>
            )}
          </div>
        </div>
      </div>
    );
  };

  const activePFs = [1, 2].filter(n => getActivePF(n)).length;
  const activeFerms = [1, 2, 3, 4].filter(n => getActiveFerm(n)).length;
  const inReaction = fermBatches.filter(b => b.phase === 'REACTION').length;
  const readyCount = pfBatches.filter(b => b.readyToTransfer).length;

  return (
    <div className="space-y-4">
      {/* HEADER */}
      <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 rounded-xl p-5 text-white">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Beaker size={24} /> Fermentation</h1>
            <p className="text-emerald-200 text-sm mt-1">
              {activePFs}/2 PF · {activeFerms}/4 Fermenters
              {readyCount > 0 && <span className="ml-2 bg-green-400/30 px-2 py-0.5 rounded text-green-100 font-bold">{readyCount} ready to transfer</span>}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={shareOverview}
              className="bg-white/20 hover:bg-white/30 px-3 py-2 rounded-lg text-sm flex items-center gap-1.5 transition">
              <Share2 size={16} /> Share
            </button>
            <button onClick={load} className="bg-white/20 hover:bg-white/30 p-2 rounded-lg transition">
              <RefreshCw size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* TAB BAR */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        {([
          { key: 'overview' as const, label: 'Overview', icon: '👁' },
          { key: 'pf' as const, label: 'PF (Field)', icon: '🏭' },
          { key: 'ferm' as const, label: 'Ferm (Field)', icon: '⚗️' },
          { key: 'lab' as const, label: 'Lab', icon: '🔬' },
        ]).map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); if (t.key === 'overview') load(); }}
            className={`flex-1 py-2.5 rounded-md text-sm font-medium transition-all
              ${tab === t.key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            <span className="mr-1">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* ═══════ TRANSFER MODAL ═══════ */}
      {transferPF && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setTransferPF(null)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-1">Transfer PF-{transferPF.fermenterNo} → Fermenter</h3>
            <p className="text-sm text-gray-500 mb-4">Batch #{transferPF.batchNo} · SG: {transferPF.lastGravity}</p>
            <label className="block text-sm font-medium text-gray-700 mb-2">Select Fermenter</label>
            <div className="grid grid-cols-4 gap-2 mb-4">
              {[1, 2, 3, 4].map(n => {
                const isFree = freeFerm.includes(n);
                return (
                  <button key={n} onClick={() => isFree && setTransferFermNo(String(n))}
                    disabled={!isFree}
                    className={`py-3 rounded-lg text-lg font-bold transition ${
                      transferFermNo === String(n) ? 'bg-green-600 text-white' :
                      isFree ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' :
                      'bg-gray-50 text-gray-300 cursor-not-allowed'
                    }`}>
                    F-{n}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setTransferPF(null)} className="flex-1 py-2.5 border rounded-lg text-gray-600">Cancel</button>
              <button onClick={handleTransfer} disabled={!transferFermNo || transferring}
                className="flex-1 py-2.5 bg-green-600 text-white rounded-lg font-bold hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {transferring ? 'Transferring...' : <><ArrowRight size={16} /> Transfer</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ OVERVIEW TAB ═══════ */}
      {tab === 'overview' && (
        <div className="space-y-4">
          {/* Pre-Fermenters */}
          <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl p-4 border border-indigo-100">
            <h2 className="text-sm font-bold text-indigo-700 mb-3 flex items-center gap-1.5 uppercase tracking-wide">
              <FlaskConical size={14} /> Pre-Fermenters
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <PFCard pfNo={1} />
              <PFCard pfNo={2} />
            </div>
          </div>

          <div className="flex justify-center py-1">
            <div className="flex flex-col items-center gap-0.5 text-gray-300">
              <ArrowDown size={22} strokeWidth={2.5} />
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Transfer</span>
            </div>
          </div>

          {/* Fermenters */}
          <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl p-4 border border-emerald-100">
            <h2 className="text-sm font-bold text-emerald-700 mb-3 flex items-center gap-1.5 uppercase tracking-wide">
              <Beaker size={14} /> Fermenters
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <FermCard fNo={1} />
              <FermCard fNo={2} />
              <FermCard fNo={3} />
              <FermCard fNo={4} />
            </div>
          </div>

          <div className="flex justify-center py-1">
            <div className="flex flex-col items-center gap-0.5 text-gray-300">
              <ArrowDown size={22} strokeWidth={2.5} />
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Transfer</span>
            </div>
          </div>

          {/* Beer Well */}
          <div className="bg-gradient-to-br from-purple-50 to-fuchsia-50 rounded-xl p-4 border border-purple-100">
            <h2 className="text-sm font-bold text-purple-700 mb-3 flex items-center gap-1.5 uppercase tracking-wide">
              <Droplets size={14} /> Beer Well
            </h2>
            <div className="bg-white rounded-xl shadow-sm border-2 border-purple-200 p-4">
              <div className="flex items-start gap-3">
                <Tank fillPct={beerWellLevel ? (beerWellLevel / BEER_WELL_CAP * 100) : 0} color="#a855f7" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-lg text-gray-800">Beer Well</h3>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${beerWellLevel && beerWellLevel > 0 ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-400'}`}>
                      {beerWellLevel && beerWellLevel > 0 ? `${beerWellLevel.toFixed(0)} KL` : 'Empty'}
                    </span>
                  </div>
                  {(() => {
                    const xferring = fermBatches.filter(b => b.phase === 'TRANSFER');
                    return xferring.length > 0 ? (
                      <div className="mt-2 text-xs text-amber-600 font-medium">
                        Receiving from: {xferring.map(b => `F-${b.fermenterNo}`).join(', ')}
                      </div>
                    ) : null;
                  })()}
                </div>
              </div>
            </div>
          </div>

          {/* Quick stats */}
          <div className="grid grid-cols-4 gap-2">
            <div className="bg-indigo-50 rounded-lg p-3 border border-indigo-100 text-center">
              <p className="text-[11px] text-indigo-500 font-medium">PF Active</p>
              <p className="text-xl font-bold text-indigo-700">{activePFs}</p>
            </div>
            <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-100 text-center">
              <p className="text-[11px] text-emerald-500 font-medium">Ferm Active</p>
              <p className="text-xl font-bold text-emerald-700">{activeFerms}</p>
            </div>
            <div className="bg-amber-50 rounded-lg p-3 border border-amber-100 text-center">
              <p className="text-[11px] text-amber-500 font-medium">In Reaction</p>
              <p className="text-xl font-bold text-amber-700">{inReaction}</p>
            </div>
            <div className={`rounded-lg p-3 border text-center ${readyCount > 0 ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-100'}`}>
              <p className={`text-[11px] font-medium ${readyCount > 0 ? 'text-green-600' : 'text-gray-400'}`}>Ready</p>
              <p className={`text-xl font-bold ${readyCount > 0 ? 'text-green-700' : 'text-gray-300'}`}>{readyCount}</p>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ PF TAB (Field) ═══════ */}
      {tab === 'pf' && <PreFermentation />}

      {/* ═══════ FERMENTER TAB (Field) ═══════ */}
      {tab === 'ferm' && <FermentationBatches />}

      {/* ═══════ LAB TAB ═══════ */}
      {tab === 'lab' && <FermentationLab onRefresh={load} />}
    </div>
  );
}
