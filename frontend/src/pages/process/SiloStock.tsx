import React, { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, BarChart, Bar } from 'recharts';
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

const fmtNum = (n: number, dec = 1) => n.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtDate = (iso: string) => {
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

  // Poll live tanks every 30s
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

  // Chart data — exclude today (production is incomplete until next dip)
  const todayStr = new Date().toISOString().slice(0, 10);
  const chartData = [...history].reverse()
    .filter(s => new Date(s.date).toISOString().slice(0, 10) !== todayStr)
    .map(s => ({
      date: fmtDate(s.date),
      siloStock: s.siloClosing,
      received: s.grainReceivedMT,
      consumed: s.grainConsumed,
      ethanolAL: s.ethanolAL ?? 0,
      yield: s.yieldALPerMT ?? 0,
    }));

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading silo data...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Grain Silo Stock</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Auto-computed from OPC tank levels + wash flow meter
            {opcOnline && <span className="ml-2 inline-block w-2 h-2 rounded-full bg-green-500" title="OPC Online" />}
            {!opcOnline && <span className="ml-2 inline-block w-2 h-2 rounded-full bg-red-500" title="OPC Offline" />}
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
          <p className="text-xs text-gray-500">One-time: enter the current grain in silo (MT). OPC tank levels will be auto-read.</p>
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

      {/* No data state */}
      {!snap && (
        <div className="bg-white rounded-lg p-8 text-center border border-gray-200">
          <p className="text-gray-500 text-sm">No silo snapshots yet. Set a baseline to start tracking.</p>
        </div>
      )}

      {snap && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard label="Silo Stock (Live)" value={`${fmtNum(live?.siloEstimate ?? snap.siloClosing)} MT`}
              sub={live ? `Snapshot + ${live.pendingTruckCount} pending truck${live.pendingTruckCount !== 1 ? 's' : ''}` : ''}
              color="blue" large />
            <KpiCard label="24h Grain Consumed" value={`${fmtNum(snap.grainConsumed)} MT`}
              sub={`Distilled: ${fmtNum(snap.grainDistilled)} MT`} color="amber" />
            <KpiCard label="24h Grain Received" value={`${fmtNum(snap.grainReceivedMT)} MT`}
              sub={`${snap.truckCount} truck${snap.truckCount !== 1 ? 's' : ''}`} color="green" />
            <KpiCard label="Grain In System" value={`${fmtNum(snap.grainInSystem)} MT`}
              sub={`${fmtNum(snap.totalVolumeKL)} KL @ ${Math.round(snap.grainPctUsed * 100)}%`} color="purple" />
            <KpiCard label="Ethanol Produced" value={ethanol?.productionAL ? `${fmtNum(ethanol.productionAL)} AL` : '--'}
              sub={ethanol?.productionBL ? `${fmtNum(ethanol.productionBL)} BL @ ${fmtNum(ethanol.avgStrength)}%` : 'No dip reading'} color="teal" />
            <KpiCard label="Yield (AL/MT)" value={ethanol?.yieldALPerMT ? fmtNum(ethanol.yieldALPerMT) : '--'}
              sub={ethanol?.yieldALPerMT ? `${fmtNum(ethanol.yieldProductionAL)} AL / ${fmtNum(ethanol.yieldGrainConsumed)} MT` : 'Need ethanol + grain data'} color="indigo" />
          </div>

          {/* Calculation Breakdown */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Calculation Breakdown (Latest Snapshot)</h3>
            <div className="grid md:grid-cols-2 gap-4 text-xs">
              {/* Left: Silo Balance */}
              <div className="space-y-1.5">
                <div className="font-semibold text-gray-600 uppercase text-[10px] tracking-wider mb-2">Silo Balance</div>
                <CalcRow label="Silo Opening" value={snap.siloOpening} unit="MT" />
                <CalcRow label="+ Grain Received (trucks)" value={snap.grainReceivedMT} unit="MT" color="green" />
                <CalcRow label="- Grain Consumed" value={snap.grainConsumed} unit="MT" color="red" />
                <div className="border-t border-gray-200 pt-1.5">
                  <CalcRow label="= Silo Closing" value={snap.siloClosing} unit="MT" bold />
                </div>
                {live && live.pendingTruckCount > 0 && (
                  <CalcRow label={`+ ${live.pendingTruckCount} pending truck(s)`} value={live.pendingTrucksMT} unit="MT" color="green" />
                )}
                {live && <CalcRow label="= Live Estimate" value={live.siloEstimate} unit="MT" bold />}
              </div>
              {/* Right: Grain Consumed Breakdown */}
              <div className="space-y-1.5">
                <div className="font-semibold text-gray-600 uppercase text-[10px] tracking-wider mb-2">Grain Consumed Breakdown</div>
                <CalcRow label="Wash Distilled (24h)" value={snap.washDistilledKL} unit="KL" />
                <CalcRow label={`x Grain % (${Math.round(snap.grainPctUsed * 100)}%)`} value={snap.grainDistilled} unit="MT" sub="= grain distilled" />
                <CalcRow label="Grain In System (prev)" value={snap.grainInSystem - snap.deltaGrainInSystem} unit="MT" sub="= previous snapshot" />
                <CalcRow label="Grain In System (now)" value={snap.grainInSystem} unit="MT" sub="= current tanks" />
                <CalcRow label="Delta Grain In System" value={snap.deltaGrainInSystem} unit="MT" color={snap.deltaGrainInSystem > 0 ? 'red' : 'green'} sub={`= ${fmtNum(snap.grainInSystem)} − ${fmtNum(snap.grainInSystem - snap.deltaGrainInSystem)}`} />
                {snap.flourTotal > 0 && <CalcRow label="Flour in Silos" value={snap.flourTotal} unit="MT" />}
                <div className="border-t border-gray-200 pt-1.5">
                  <CalcRow label="= Grain Consumed" value={snap.grainConsumed} unit="MT" bold />
                  <p className="text-[10px] text-gray-400 mt-1">
                    = max(0, distilled + delta_grain + delta_flour)
                  </p>
                </div>
                <div className="border-t border-gray-200 pt-1.5 mt-2">
                  <div className="font-semibold text-gray-600 uppercase text-[10px] tracking-wider mb-1">Cumulatives (Year)</div>
                  <CalcRow label="Total Received" value={snap.cumReceived} unit="MT" />
                  <CalcRow label="Total Consumed" value={snap.cumConsumed} unit="MT" />
                </div>
              </div>
            </div>
          </div>

          {/* Tank Level Gauges */}
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

          {/* Charts */}
          {chartData.length > 1 && (
            <div className="space-y-4">
              {/* Yield Trend — most important */}
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">
                  Ethanol Yield Trend (AL per MT Grain)
                </h3>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={chartData.filter(d => d.yield > 0)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: 11 }}
                      formatter={(v: number, name: string) => [v.toFixed(1), name]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="yield" name="Yield (AL/MT)" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} yAxisId="left" />
                    <Line type="monotone" dataKey="ethanolAL" name="Ethanol (AL)" stroke="#14b8a6" strokeWidth={1.5} dot={{ r: 2 }} yAxisId="right" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Silo Stock Trend</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip contentStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="siloStock" name="Silo (MT)" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Daily In vs Out</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip contentStyle={{ fontSize: 11 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="received" name="Received (MT)" fill="#22c55e" />
                      <Bar dataKey="consumed" name="Consumed (MT)" fill="#f59e0b" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* History Table */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-700">Snapshot History</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-100 text-gray-600">
                    <th className="text-left px-3 py-2 font-semibold">Date</th>
                    <th className="text-right px-3 py-2 font-semibold">Opening</th>
                    <th className="text-right px-3 py-2 font-semibold">Received</th>
                    <th className="text-right px-3 py-2 font-semibold">Consumed</th>
                    <th className="text-right px-3 py-2 font-semibold">Closing</th>
                    <th className="text-right px-3 py-2 font-semibold">Wash (KL)</th>
                    <th className="text-right px-3 py-2 font-semibold">Ethanol (AL)</th>
                    <th className="text-right px-3 py-2 font-semibold">Yield</th>
                    <th className="text-center px-3 py-2 font-semibold">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((s, i) => (
                    <tr key={s.id} className={`border-b border-gray-100 hover:bg-blue-50/40 ${i % 2 ? 'bg-gray-50/50' : ''}`}>
                      <td className="px-3 py-1.5 text-gray-800 font-medium">{fmtDate(s.date)}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{fmtNum(s.siloOpening)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-green-700">{s.grainReceivedMT > 0 ? `+${fmtNum(s.grainReceivedMT)}` : '--'}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-amber-700">{s.grainConsumed > 0 ? `-${fmtNum(s.grainConsumed)}` : '--'}</td>
                      <td className="px-3 py-1.5 text-right font-mono font-semibold text-gray-800">{fmtNum(s.siloClosing)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-gray-500">{fmtNum(s.washDistilledKL, 0)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-teal-700">{s.ethanolAL ? fmtNum(s.ethanolAL) : '--'}</td>
                      <td className="px-3 py-1.5 text-right font-mono font-semibold text-indigo-700">{s.yieldALPerMT ? fmtNum(s.yieldALPerMT) : '--'}</td>
                      <td className="px-3 py-1.5 text-center">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                          s.source === 'BASELINE' ? 'bg-blue-100 text-blue-700' :
                          s.source === 'OVERRIDE' ? 'bg-orange-100 text-orange-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>{s.source}</span>
                      </td>
                    </tr>
                  ))}
                  {history.length === 0 && (
                    <tr><td colSpan={10} className="px-3 py-6 text-center text-gray-400">No snapshots yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value, sub, color, large }: { label: string; value: string; sub?: string; color: string; large?: boolean }) {
  const colors: Record<string, string> = {
    blue: 'border-l-blue-500',
    green: 'border-l-green-500',
    amber: 'border-l-amber-500',
    purple: 'border-l-purple-500',
    teal: 'border-l-teal-500',
    indigo: 'border-l-indigo-500',
  };
  return (
    <div className={`bg-white rounded-lg border border-gray-200 border-l-4 ${colors[color] || 'border-l-gray-400'} px-4 py-3`}>
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{label}</div>
      <div className={`${large ? 'text-2xl' : 'text-lg'} font-bold text-gray-800 mt-1 font-mono tabular-nums`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function CalcRow({ label, value, unit, color, bold, sub }: {
  label: string; value: number; unit: string; color?: string; bold?: boolean; sub?: string;
}) {
  const colorClass = color === 'green' ? 'text-green-700' : color === 'red' ? 'text-red-700' : 'text-gray-700';
  return (
    <div className="flex justify-between items-baseline">
      <span className={`text-gray-600 ${bold ? 'font-semibold' : ''}`}>{label}</span>
      <div className="text-right">
        <span className={`font-mono tabular-nums ${colorClass} ${bold ? 'font-bold text-sm' : ''}`}>
          {value >= 0 && color === 'green' ? '+' : ''}{value.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} {unit}
        </span>
        {sub && <span className="text-[9px] text-gray-400 ml-1">{sub}</span>}
      </div>
    </div>
  );
}

function TankGauge({ label, pct, kl, capacityKL }: { label: string; pct: number; kl: number; capacityKL: number }) {
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
