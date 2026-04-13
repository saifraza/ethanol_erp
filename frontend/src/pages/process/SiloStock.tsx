import React, { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell, ReferenceLine } from 'recharts';
import api from '../../services/api';

interface SiloSnapshot {
  id: string;
  date: string;
  source: string;
  f1Level: number;
  f2Level: number;
  f3Level: number;
  f4Level: number;
  beerWellLevel: number;
  pf1Level: number;
  pf2Level: number;
  iltLevel: number;
  fltLevel: number;
  totalVolumeKL: number;
  flourSilo1Level: number;
  flourSilo2Level: number;
  flourTotal: number;
  washDistilledKL: number;
  grainPctUsed: number;
  grainInSystem: number;
  deltaGrainInSystem: number;
  grainDistilled: number;
  grainConsumed: number;
  grainReceivedMT: number;
  truckCount: number;
  siloOpening: number;
  siloClosing: number;
  cumReceived: number;
  cumConsumed: number;
  opcDataAge: number | null;
  remarks: string | null;
  createdAt: string;
}

interface LiveTank {
  tag: string;
  label: string;
  pct: number;
  kl: number;
  capacityKL: number;
  updatedAt: string | null;
}

interface EthanolYield {
  productionBL: number;
  productionAL: number;
  avgStrength: number;
  yieldALPerMT: number;
  yieldProductionAL: number;
  yieldGrainConsumed: number;
}

interface HistoryRow extends SiloSnapshot {
  ethanolAL?: number;
  yieldALPerMT?: number;
}

interface LatestResponse {
  snapshot: SiloSnapshot | null;
  ethanol: EthanolYield | null;
  live: {
    siloEstimate: number;
    pendingTrucksMT: number;
    pendingTruckCount: number;
    snapshotAge: string;
  } | null;
}

const fmt = (n: number, dec = 1) => n.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};
const fmtDateFull = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function SiloStock() {
  const [latest, setLatest] = useState<LatestResponse | null>(null);
  const [tanks, setTanks] = useState<LiveTank[]>([]);
  const [opcOnline, setOpcOnline] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBaseline, setShowBaseline] = useState(false);
  const [baselineVal, setBaselineVal] = useState('');
  const [baselineRemarks, setBaselineRemarks] = useState('');
  const [saving, setSaving] = useState(false);
  const [triggering, setTriggering] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [latestRes, tanksRes, histRes] = await Promise.all([
        api.get<LatestResponse>('/silo-stock/latest'),
        api.get<{ tanks: LiveTank[]; opcOnline: boolean }>('/silo-stock/live-tanks'),
        api.get<{ items: HistoryRow[]; total: number }>('/silo-stock?limit=30'),
      ]);
      setLatest(latestRes.data);
      setTanks(tanksRes.data.tanks);
      setOpcOnline(tanksRes.data.opcOnline);
      setHistory(histRes.data.items);
    } catch (err) {
      console.error('Failed to fetch silo data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await api.get<{ tanks: LiveTank[]; opcOnline: boolean }>('/silo-stock/live-tanks');
        setTanks(res.data.tanks);
        setOpcOnline(res.data.opcOnline);
      } catch { /* ignore */ }
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleBaseline = async () => {
    const val = parseFloat(baselineVal);
    if (isNaN(val) || val < 0) return;
    setSaving(true);
    try {
      await api.post('/silo-stock/baseline', { siloClosingMT: val, remarks: baselineRemarks || undefined });
      setShowBaseline(false);
      setBaselineVal('');
      setBaselineRemarks('');
      fetchAll();
    } catch (err) {
      console.error('Baseline save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      await api.post('/silo-stock/trigger');
      fetchAll();
    } catch (err) {
      console.error('Trigger failed:', err);
    } finally {
      setTriggering(false);
    }
  };

  const snap = latest?.snapshot;
  const live = latest?.live;
  const ethanol = latest?.ethanol;

  // 7-day history for ledger (newest first, but show oldest→newest in table)
  const last7 = [...history].slice(0, 7).reverse();

  // Totals for 7-day period (excluding baseline rows)
  const autoRows = last7.filter(s => s.source !== 'BASELINE');
  const totalReceived = autoRows.reduce((s, r) => s + r.grainReceivedMT, 0);
  const totalConsumed = autoRows.reduce((s, r) => s + r.grainConsumed, 0);
  const totalWash = autoRows.reduce((s, r) => s + r.washDistilledKL, 0);
  const totalTrucks = autoRows.reduce((s, r) => s + r.truckCount, 0);
  const totalEthanol = autoRows.reduce((s, r) => s + (r.ethanolAL ?? 0), 0);

  // Chart data for bar chart
  const chartData = last7.filter(s => s.source !== 'BASELINE').map(s => ({
    date: fmtDate(s.date),
    received: s.grainReceivedMT,
    consumed: -s.grainConsumed, // negative so it goes below axis
    closing: s.siloClosing,
  }));

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading silo data...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Grain Silo Stock</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Auto-computed from OPC tank levels + wash flow meter
            <span className={`ml-2 inline-block w-2 h-2 rounded-full ${opcOnline ? 'bg-green-500' : 'bg-red-500'}`} />
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowBaseline(!showBaseline)} className="px-3 py-1.5 text-xs bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            Set Baseline
          </button>
          <button onClick={handleTrigger} disabled={triggering} className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {triggering ? 'Computing...' : 'Compute Now'}
          </button>
        </div>
      </div>

      {/* Baseline form */}
      {showBaseline && (
        <div className="bg-white border border-blue-200 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Set Baseline Silo Stock</h3>
          <p className="text-xs text-gray-500">Enter the current grain in silo (MT). OPC tank levels will be auto-read.</p>
          <div className="flex gap-3 items-end">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Silo Stock (MT)</label>
              <input type="number" value={baselineVal} onChange={e => setBaselineVal(e.target.value)}
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-40" placeholder="e.g. 2000" />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500 block mb-1">Remarks</label>
              <input type="text" value={baselineRemarks} onChange={e => setBaselineRemarks(e.target.value)}
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full" placeholder="Optional" />
            </div>
            <button onClick={handleBaseline} disabled={saving || !baselineVal}
              className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save Baseline'}
            </button>
          </div>
        </div>
      )}

      {!snap && (
        <div className="bg-white rounded-lg p-8 text-center border border-gray-200">
          <p className="text-gray-500 text-sm">No silo snapshots yet. Set a baseline to start tracking.</p>
        </div>
      )}

      {snap && (
        <>
          {/* Live Status Strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white rounded-lg border border-gray-200 border-l-4 border-l-blue-600 px-4 py-3">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Current Silo Stock</div>
              <div className="text-2xl font-bold text-gray-800 mt-1 font-mono tabular-nums">
                {fmt(live?.siloEstimate ?? snap.siloClosing, 0)} <span className="text-sm font-normal text-gray-400">MT</span>
              </div>
              {live && live.pendingTruckCount > 0 && (
                <div className="text-[10px] text-blue-600 mt-0.5">{snap.siloClosing > 0 ? fmt(snap.siloClosing, 0) : '--'} closing + {live.pendingTruckCount} pending truck(s)</div>
              )}
            </div>
            <div className="bg-white rounded-lg border border-gray-200 border-l-4 border-l-green-500 px-4 py-3">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Today Received</div>
              <div className="text-2xl font-bold text-green-700 mt-1 font-mono tabular-nums">
                +{fmt(snap.grainReceivedMT, 0)} <span className="text-sm font-normal text-gray-400">MT</span>
              </div>
              <div className="text-[10px] text-gray-400 mt-0.5">{snap.truckCount} truck{snap.truckCount !== 1 ? 's' : ''}</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 border-l-4 border-l-amber-500 px-4 py-3">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Today Consumed</div>
              <div className="text-2xl font-bold text-amber-700 mt-1 font-mono tabular-nums">
                -{fmt(snap.grainConsumed, 0)} <span className="text-sm font-normal text-gray-400">MT</span>
              </div>
              <div className="text-[10px] text-gray-400 mt-0.5">{fmt(snap.washDistilledKL, 0)} KL wash x {Math.round(snap.grainPctUsed * 100)}%</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 border-l-4 border-l-purple-500 px-4 py-3">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Grain In Tanks</div>
              <div className="text-2xl font-bold text-gray-800 mt-1 font-mono tabular-nums">
                {fmt(snap.grainInSystem, 0)} <span className="text-sm font-normal text-gray-400">MT</span>
              </div>
              <div className="text-[10px] text-gray-400 mt-0.5">{fmt(snap.totalVolumeKL, 0)} KL @ {Math.round(snap.grainPctUsed * 100)}%</div>
            </div>
          </div>

          {/* 7-Day Grain Ledger — THE MAIN VIEW */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 bg-gray-800 text-white flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold tracking-wide">Daily Grain Ledger</h3>
                <p className="text-[10px] text-gray-400 mt-0.5">Opening + Received - Consumed = Closing (per 9 AM shift)</p>
              </div>
              {last7.length > 0 && (
                <div className="text-right text-[10px] text-gray-400">
                  {fmtDateFull(last7[0].date)} to {fmtDateFull(last7[last7.length - 1].date)}
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-100 text-gray-500 text-[10px] uppercase tracking-wider">
                    <th className="text-left px-4 py-2.5 font-bold">Date</th>
                    <th className="text-right px-3 py-2.5 font-bold">Opening</th>
                    <th className="text-right px-3 py-2.5 font-bold">
                      <span className="text-green-600">+ Received</span>
                    </th>
                    <th className="text-center px-1 py-2.5 font-bold text-gray-300">Trucks</th>
                    <th className="text-right px-3 py-2.5 font-bold">Wash (KL)</th>
                    <th className="text-right px-3 py-2.5 font-bold">Grain %</th>
                    <th className="text-right px-3 py-2.5 font-bold">
                      <span className="text-amber-600 cursor-help" title="Grain consumed in production = Wash Distilled (KL) × Grain %. This is the grain equivalent of fermented wash that was distilled through the column.">- Consumed</span>
                    </th>
                    <th className="text-right px-4 py-2.5 font-bold bg-gray-200 text-gray-700">= Closing</th>
                    <th className="text-right px-3 py-2.5 font-bold text-teal-600">Ethanol (AL)</th>
                    <th className="text-right px-3 py-2.5 font-bold text-indigo-600">Yield</th>
                  </tr>
                </thead>
                <tbody>
                  {last7.map((s, i) => {
                    const isBaseline = s.source === 'BASELINE';
                    const isToday = i === last7.length - 1;
                    return (
                      <tr key={s.id} className={`border-b border-gray-100 hover:bg-blue-50/40 ${isToday ? 'bg-blue-50/30' : i % 2 ? 'bg-gray-50/50' : ''}`}>
                        <td className="px-4 py-2 text-gray-800 font-medium whitespace-nowrap">
                          {fmtDate(s.date)}
                          {isBaseline && <span className="ml-1.5 text-[8px] font-bold uppercase px-1 py-0.5 rounded bg-blue-100 text-blue-700">Baseline</span>}
                          {isToday && !isBaseline && <span className="ml-1.5 text-[8px] font-bold uppercase px-1 py-0.5 rounded bg-green-100 text-green-700">Today</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-600">
                          {isBaseline ? '--' : fmt(s.siloOpening, 1)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-green-700 font-medium">
                          {isBaseline ? '--' : s.grainReceivedMT > 0 ? `+${fmt(s.grainReceivedMT, 1)}` : '0.0'}
                        </td>
                        <td className="px-1 py-2 text-center text-gray-400 text-[10px]">
                          {isBaseline ? '' : s.truckCount > 0 ? `(${s.truckCount})` : ''}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-500">
                          {isBaseline ? '--' : fmt(s.washDistilledKL, 0)}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-400 text-[10px]">
                          {isBaseline ? '--' : `${Math.round(s.grainPctUsed * 100)}%`}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-amber-700 font-medium">
                          {isBaseline ? '--' : s.grainConsumed > 0 ? `-${fmt(s.grainConsumed, 1)}` : '0.0'}
                        </td>
                        <td className={`px-4 py-2 text-right font-mono tabular-nums font-bold bg-gray-50 ${s.siloClosing < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                          {fmt(s.siloClosing, 1)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-teal-700">
                          {s.ethanolAL ? fmt(s.ethanolAL, 0) : '--'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums font-semibold text-indigo-700">
                          {s.yieldALPerMT ? fmt(s.yieldALPerMT, 1) : '--'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {/* Totals row */}
                {autoRows.length > 0 && (
                  <tfoot>
                    <tr className="bg-gray-800 text-white font-semibold">
                      <td className="px-4 py-2.5 text-[10px] uppercase tracking-wider">{autoRows.length}-Day Total</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-gray-400">
                        {last7.length > 0 ? fmt(last7[0].siloOpening || last7[0].siloClosing, 0) : '--'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-green-400">
                        +{fmt(totalReceived, 0)}
                      </td>
                      <td className="px-1 py-2.5 text-center text-gray-400 text-[10px]">({totalTrucks})</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-gray-400">
                        {fmt(totalWash, 0)}
                      </td>
                      <td className="px-3 py-2.5"></td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-amber-400">
                        -{fmt(totalConsumed, 0)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums font-bold text-white bg-gray-700">
                        {last7.length > 0 ? fmt(last7[last7.length - 1].siloClosing, 0) : '--'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-teal-400">
                        {totalEthanol > 0 ? fmt(totalEthanol, 0) : '--'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-indigo-400">
                        {totalConsumed > 0 && totalEthanol > 0 ? fmt(totalEthanol / totalConsumed, 1) : '--'}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* How the Math Works — collapsible explainer */}
          <details className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <summary className="px-4 py-3 cursor-pointer hover:bg-gray-50 text-sm font-semibold text-gray-700 select-none">
              How is this calculated?
            </summary>
            <div className="px-4 py-3 border-t border-gray-200 text-xs text-gray-600 space-y-3">
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <div className="font-bold text-gray-700 mb-2 uppercase text-[10px] tracking-wider">Consumed (Grain Used in Production)</div>
                  <div className="bg-gray-50 rounded-lg p-3 font-mono text-[11px] space-y-2">
                    <div className="text-amber-700 font-bold">Consumed = Wash Distilled (KL) x Grain %</div>
                    <div className="text-gray-500 font-sans text-[10px] leading-relaxed">
                      Fermented wash (mash) is distilled through the column. The flow meter (MG_140101) measures how many KL of wash were distilled in the 9 AM-to-9 AM shift. Multiplying by grain % gives the MT of grain equivalent that was consumed in production.
                    </div>
                  </div>
                  <div className="font-bold text-gray-700 mb-2 mt-3 uppercase text-[10px] tracking-wider">Silo Closing Balance</div>
                  <div className="bg-gray-50 rounded-lg p-3 font-mono text-[11px] space-y-1">
                    <div>Silo Closing = Opening + Received - Silo Outflow</div>
                    <div className="mt-2 text-gray-400">Where:</div>
                    <div className="pl-3">Opening = Previous day's Closing</div>
                    <div className="pl-3 text-green-700">Received = Grain trucks weighed (net MT)</div>
                    <div className="pl-3 text-amber-700">Silo Outflow = max(0, Consumed + Tank Delta + Flour Delta)</div>
                    <div className="text-gray-500 font-sans text-[10px] mt-1.5 leading-relaxed">
                      Silo outflow accounts for grain entering fermenters. If fermenters filled up (tank delta positive), more grain left silos than was distilled. If fermenters drained (tank delta negative), distillation used grain already in tanks — so less came from silos.
                    </div>
                  </div>
                </div>
                <div>
                  <div className="font-bold text-gray-700 mb-2 uppercase text-[10px] tracking-wider">Data Sources</div>
                  <div className="space-y-1.5 text-[11px]">
                    <div className="flex items-start gap-2">
                      <span className="w-2 h-2 mt-1 rounded-full bg-green-500 shrink-0" />
                      <span><b>Grain Received:</b> Weighbridge net weight (automatic)</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="w-2 h-2 mt-1 rounded-full bg-amber-500 shrink-0" />
                      <span><b>Wash Distilled:</b> OPC flow meter MG_140101 (DCS totalizer, 24h sum)</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="w-2 h-2 mt-1 rounded-full bg-purple-500 shrink-0" />
                      <span><b>Grain %:</b> Configured in Settings (currently {snap ? Math.round(snap.grainPctUsed * 100) : 32}%)</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="w-2 h-2 mt-1 rounded-full bg-blue-500 shrink-0" />
                      <span><b>Shift:</b> 9:00 AM to 9:00 AM IST (auto-snapshot daily)</span>
                    </div>
                  </div>
                </div>
              </div>
              {snap && (
                <div className="border-t border-gray-200 pt-3 mt-3">
                  <div className="font-bold text-gray-700 mb-2 uppercase text-[10px] tracking-wider">Today's Breakdown</div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-[11px]">
                    <CalcItem label="Silo Opening" value={`${fmt(snap.siloOpening)} MT`} />
                    <CalcItem label="+ Grain Received" value={`+${fmt(snap.grainReceivedMT)} MT`} sub={`${snap.truckCount} trucks`} color="green" />
                    <CalcItem label="Consumed (Distilled)" value={`${fmt(snap.grainConsumed)} MT`} sub={`${fmt(snap.washDistilledKL)} KL x ${Math.round(snap.grainPctUsed * 100)}%`} color="amber" />
                    <CalcItem label="Tank Delta" value={`${snap.deltaGrainInSystem >= 0 ? '+' : ''}${fmt(snap.deltaGrainInSystem)} MT`} sub={`${fmt(snap.grainInSystem)} in tanks now`} color={snap.deltaGrainInSystem >= 0 ? 'blue' : 'gray'} />
                    <CalcItem label="= Silo Closing" value={`${fmt(snap.siloClosing)} MT`} bold />
                  </div>
                </div>
              )}
            </div>
          </details>

          {/* Chart: Daily In vs Out (waterfall-style) */}
          {chartData.length > 1 && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Daily Grain In vs Out</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} stackOffset="sign">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: number, name: string) => [Math.abs(v).toFixed(1) + ' MT', name]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={0} stroke="#334155" />
                  <Bar dataKey="received" name="Received" stackId="a" fill="#22c55e" />
                  <Bar dataKey="consumed" name="Consumed" stackId="a" fill="#f59e0b" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Live Tank Levels */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Live Tank Levels</h3>
            <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-3">
              {tanks.map(t => (
                <TankGauge key={t.tag} label={t.label} pct={t.pct} kl={t.kl} capacityKL={t.capacityKL} />
              ))}
            </div>
            {snap.opcDataAge != null && (
              <p className="text-[10px] text-gray-400 mt-2">
                OPC data age: {snap.opcDataAge < 120 ? `${snap.opcDataAge}s` : `${Math.round(snap.opcDataAge / 60)}m`}
                {live && <span className="ml-3">Snapshot: {live.snapshotAge} ago</span>}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CalcItem({ label, value, sub, color, bold }: {
  label: string; value: string; sub?: string; color?: string; bold?: boolean;
}) {
  const textColor = color === 'green' ? 'text-green-700' : color === 'amber' ? 'text-amber-700' : color === 'blue' ? 'text-blue-700' : 'text-gray-800';
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2">
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{label}</div>
      <div className={`font-mono tabular-nums mt-0.5 ${bold ? 'font-bold text-base' : 'text-sm'} ${textColor}`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function TankGauge({ label, pct, kl }: { label: string; pct: number; kl: number; capacityKL: number }) {
  const fillColor = pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : pct > 10 ? 'bg-blue-500' : 'bg-gray-300';
  return (
    <div className="text-center">
      <div className="text-[10px] font-semibold text-gray-500 mb-1">{label}</div>
      <div className="relative w-full h-24 bg-gray-100 rounded border border-gray-200 overflow-hidden">
        <div className={`absolute bottom-0 left-0 right-0 ${fillColor} transition-all duration-500`}
          style={{ height: `${Math.min(100, Math.max(0, pct))}%` }} />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-sm font-bold text-gray-800 drop-shadow-sm">{pct.toFixed(0)}%</span>
          <span className="text-[9px] text-gray-600">{kl.toFixed(0)} KL</span>
        </div>
      </div>
    </div>
  );
}
