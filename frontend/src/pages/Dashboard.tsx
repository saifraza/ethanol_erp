import { useEffect, useState, useMemo } from 'react';
import api from '../services/api';
import {
  Wheat, Droplets, Fuel, Truck, Package, Factory, Beaker, Flame,
  TrendingUp, TrendingDown, BarChart3, Filter, RefreshCw, AlertTriangle,
  Activity, ThermometerSun, Share2, FlaskConical, Clock, Zap, Heart,
  ArrowRight, ChevronDown, ChevronUp, Brain, Target
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, Legend, BarChart, Bar, PieChart, Pie, Cell, ComposedChart,
  ReferenceLine, ReferenceArea, Brush
} from 'recharts';

// ─── OPC-Live standard chart config ───
const CHART_GRID = { strokeDasharray: '3 3', stroke: '#e2e8f0' };
const CHART_AXIS = { fontSize: 9, fill: '#64748b' };
const CHART_AXIS_PROPS = { tick: CHART_AXIS, tickLine: false, axisLine: { stroke: '#cbd5e1' } };
const CHART_TOOLTIP = {
  contentStyle: { fontSize: 12, border: '1px solid #94a3b8', background: '#fff', padding: '8px 12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' },
  labelStyle: { fontWeight: 700, marginBottom: 4, color: '#1e293b' },
  itemStyle: { padding: '1px 0' },
};
const CHART_LEGEND = { verticalAlign: 'top' as const, height: 30, iconType: 'plainline' as const, wrapperStyle: { fontSize: 10, color: '#64748b' } };

const PERIOD_OPTIONS = [
  { label: 'Today', days: 1 },
  { label: '7 Days', days: 7 },
  { label: '15 Days', days: 15 },
  { label: '30 Days', days: 30 },
  { label: '90 Days', days: 90 },
];

const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
const FERM_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

const phaseColors: Record<string, string> = {
  FILLING: '#6366f1', SETUP: '#f59e0b', DOSING: '#f59e0b', REACTION: '#22c55e',
  LAB: '#3b82f6', RETENTION: '#06b6d4', TRANSFER: '#3b82f6', CIP: '#a855f7', DONE: '#6b7280',
  PF_TRANSFER: '#3b82f6',
};

function KPI({ label, value, unit, icon: Icon, color, sub, trend }: any) {
  return (
    <div className="bg-white rounded-xl shadow-sm border p-3 md:p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${color}`}><Icon size={18} className="text-white" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-gray-500 truncate">{label}</p>
          <div className="flex items-baseline gap-1.5">
            <p className="text-lg md:text-xl font-bold">{value ?? '—'}</p>
            <span className="text-xs text-gray-400">{unit}</span>
            {trend !== undefined && trend !== 0 && (
              <span className={`text-[10px] flex items-center gap-0.5 ${trend > 0 ? 'text-green-600' : 'text-red-500'}`}>
                {trend > 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                {Math.abs(trend).toFixed(1)}%
              </span>
            )}
          </div>
          {sub && <p className="text-[10px] text-gray-400 mt-0.5 truncate">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ title, icon: Icon }: { title: string; icon: any }) {
  return (
    <div className="flex items-center gap-2 mt-2">
      <Icon size={16} className="text-gray-500" />
      <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
    </div>
  );
}

function FermCard({ b, type }: { b: any; type: 'F' | 'PF' }) {
  return (
    <div className="bg-white border border-slate-300 p-3">
      <div className="flex justify-between items-center mb-2">
        <span className="font-semibold text-sm">{type}{b.fermenterNo} — #{b.batchNo}</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full text-white font-bold"
          style={{ backgroundColor: phaseColors[b.phase] || '#6b7280' }}>{b.phase}</span>
      </div>
      <div className="text-xs text-gray-600 space-y-0.5">
        {b.fermLevel != null && <div>Level: <b>{b.fermLevel}%</b></div>}
        {b.slurryVolume != null && <div>Slurry: <b>{(b.slurryVolume / 1000).toFixed(0)} M³</b></div>}
        {b.setupGravity && <div>SG: <b>{b.setupGravity}</b></div>}
        {b.slurryGravity && <div>SG: <b>{b.slurryGravity}</b></div>}
        {b.finalAlcohol && <div>Alcohol: <b>{b.finalAlcohol}%</b></div>}
        {b.latestAlcohol && <div>Alcohol: <b>{b.latestAlcohol}%</b></div>}
        {b.totalHours && <div>Hours: <b>{b.totalHours}</b></div>}
      </div>
    </div>
  );
}

/* ═══ Health score bar ═══ */
function HealthBar({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-green-500' : score >= 50 ? 'bg-amber-500' : 'bg-red-500';
  const textColor = score >= 80 ? 'text-green-700' : score >= 50 ? 'text-amber-700' : 'text-red-700';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-200 rounded-full h-2.5 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className={`text-xs font-bold ${textColor}`}>{score}</span>
    </div>
  );
}

/* ═══ Pipeline step ═══ */
function PipelineStep({ label, value, unit, icon: Icon, color, isLast }: any) {
  return (
    <div className="flex items-center gap-1">
      <div className={`flex flex-col items-center p-2 rounded-lg ${color} min-w-[80px]`}>
        <Icon size={16} className="text-white mb-1" />
        <span className="text-white font-bold text-sm">{value}</span>
        <span className="text-white/80 text-[9px]">{unit}</span>
        <span className="text-white/70 text-[9px] mt-0.5">{label}</span>
      </div>
      {!isLast && <ArrowRight size={16} className="text-gray-300 mx-0.5 flex-shrink-0" />}
    </div>
  );
}

const fmtNum = (n: number, d = 1) => n >= 100000 ? (n / 100000).toFixed(d) + ' L' : n >= 1000 ? (n / 1000).toFixed(d) + ' K' : n.toFixed(d);
const shortDate = (d: string) => {
  const p = d.split('-');
  return `${p[2]}/${p[1]}`;
};

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [fermData, setFermData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [fermLoading, setFermLoading] = useState(true);
  const [days, setDays] = useState(7);
  const [activeTab, setActiveTab] = useState<'overview' | 'fermentation' | 'production' | 'quality' | 'dispatch'>('overview');

  // OPC live tank levels + feed rate + RC strength
  interface TankLevel { label: string; level: number; temp?: number; color: string; }
  const [tankLevels, setTankLevels] = useState<TankLevel[]>([]);
  const [liveFeedRate, setLiveFeedRate] = useState<number | null>(null);
  const [feedHistory, setFeedHistory] = useState<{ time: string; rate: number }[]>([]);
  const [rcStrength, setRcStrength] = useState<{ pctVV: number; density: number; temp: number } | null>(null);

  // Ethanol strength from density + temperature (OIML R-22 interpolation)
  // Density of ethanol-water at 20°C (% v/v → kg/m³)
  const DENSITY_TABLE_20C: [number, number][] = [
    [100, 789.24], [99, 790.50], [98, 792.00], [97, 793.80], [96, 795.80],
    [95, 798.10], [94, 800.60], [93, 803.40], [92, 806.30], [91, 809.50],
    [90, 812.90], [88, 820.10], [85, 831.30], [80, 848.90],
  ];
  // Reverse table: density at 20°C → strength % v/v (ascending density)
  const DENSITY_TO_STRENGTH: [number, number][] = [
    [789.24, 100], [790.50, 99], [792.00, 98], [793.80, 97], [795.80, 96],
    [798.10, 95], [800.60, 94], [803.40, 93], [806.30, 92], [809.50, 91],
    [812.90, 90], [820.10, 88], [831.30, 85], [848.90, 80],
  ];
  // Thermal expansion coeff (per °C from 20°C) by approx strength
  const ALPHA_TABLE: [number, number][] = [
    [100, 0.00108], [96, 0.00103], [93, 0.00098], [90, 0.00093], [85, 0.00087], [80, 0.00082],
  ];
  function lerp(table: [number, number][], x: number): number {
    if (x <= table[0][0]) return table[0][1];
    if (x >= table[table.length - 1][0]) return table[table.length - 1][1];
    for (let i = 0; i < table.length - 1; i++) {
      const [x0, y0] = table[i], [x1, y1] = table[i + 1];
      if ((x0 <= x && x <= x1) || (x1 <= x && x <= x0)) {
        const t = (x - x0) / (x1 - x0);
        return y0 + t * (y1 - y0);
      }
    }
    return table[0][1];
  }
  function calcRcStrength(densityKgM3: number, tempC: number): number {
    // Iterative: correct density to 20°C, look up strength
    let strength = 95;
    for (let i = 0; i < 8; i++) {
      const alpha = lerp(ALPHA_TABLE, strength);
      const rho20 = densityKgM3 / (1 - alpha * (tempC - 20));
      // Lookup strength from density at 20°C (ascending density → descending strength)
      strength = lerp(DENSITY_TO_STRENGTH, rho20);
    }
    return Math.round(strength * 100) / 100;
  }
  const OPC_TANK_MAP = [
    { tag: 'LT130201', tempTag: 'TE130201', label: 'F-1', color: '#3b82f6' },
    { tag: 'LT130202', tempTag: 'TE130202', label: 'F-2', color: '#8b5cf6' },
    { tag: 'LT130301', tempTag: 'TE130301', label: 'F-3', color: '#10b981' },
    { tag: 'LT130302', tempTag: 'TE130302', label: 'F-4', color: '#f59e0b' },
    { tag: 'LT130101', tempTag: 'TE130101', label: 'PF-1', color: '#6366f1' },
    { tag: 'LT130102', tempTag: 'TE130102', label: 'PF-2', color: '#a855f7' },
    { tag: 'LT130401', tempTag: undefined, label: 'BW', color: '#0891b2' },
  ];

  useEffect(() => {
    const fetchTanks = () => {
      api.get('/opc/live').then(r => {
        const tags: { tag: string; values: Record<string, number> }[] = r.data?.tags || [];
        const lookup: Record<string, number> = {};
        const pvLookup: Record<string, number> = {};
        for (const t of tags) {
          const v = t.values?.IO_VALUE ?? t.values?.PV;
          if (v != null) lookup[t.tag] = v;
          if (t.values?.PV != null) pvLookup[t.tag] = t.values.PV;
        }
        setTankLevels(OPC_TANK_MAP.map(m => ({
          label: m.label,
          level: Math.round((lookup[m.tag] || 0) * 100) / 100,
          temp: m.tempTag ? Math.round((lookup[m.tempTag] || 0) * 100) / 100 : undefined,
          color: m.color,
        })));
        // Live feed rate from MG_140101 PV or FCV_140101 PV (M3/hr)
        const feedPV = pvLookup['MG_140101'] ?? pvLookup['FCV_140101'] ?? null;
        setLiveFeedRate(feedPV !== null ? Math.round(feedPV * 10) / 10 : null);

        // RC strength from DM_150701 (density) + TE_140101 (temp)
        const rcDensity = lookup['DM_150701'];
        const rcTemp = lookup['TE_140101'];
        if (rcDensity && rcTemp && rcDensity > 700 && rcDensity < 900 && rcTemp > 50 && rcTemp < 100) {
          setRcStrength({ pctVV: calcRcStrength(rcDensity, rcTemp), density: Math.round(rcDensity * 100) / 100, temp: Math.round(rcTemp * 100) / 100 });
        } else {
          setRcStrength(null);
        }
      }).catch(() => {});

      // Feed rate history (last 1h, raw readings)
      api.get('/opc/history/MG_140101?hours=1&property=PV').then(r => {
        const readings: { hour: string; avg: number }[] = r.data?.readings || [];
        setFeedHistory(readings.map(pt => ({
          time: new Date(pt.hour).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
          rate: Math.round(pt.avg * 10) / 10,
        })));
      }).catch(() => {});
    };
    fetchTanks();
    const iv = setInterval(fetchTanks, 30000); // 30s for live feed rate
    return () => clearInterval(iv);
  }, []);

  const fetchData = (d: number) => {
    setLoading(true);
    api.get(`/dashboard/analytics?days=${d}`).then(r => { setData(r.data); setLoading(false); }).catch(() => setLoading(false));
  };

  const fetchFermData = (d: number) => {
    setFermLoading(true);
    api.get(`/dashboard/fermentation-deep?days=${d}`).then(r => { setFermData(r.data); setFermLoading(false); }).catch(() => setFermLoading(false));
  };

  useEffect(() => { fetchData(days); fetchFermData(days); }, [days]);

  const handleShare = () => {
    if (!data) return;
    const k = data.kpis;
    const t = `*PLANT DASHBOARD — ${data.period.days} Day Summary*\n${data.period.from} to ${data.period.to}\n\n*Grain*\nUnloaded: ${k.grainUnloaded.toFixed(0)} T\nConsumed: ${k.grainConsumed.toFixed(0)} T\nSilo Stock: ${k.siloStock.toFixed(0)} T\n\n*Ethanol*\nProduction: ${fmtNum(k.ethanolProductionBL)} BL (${fmtNum(k.ethanolProductionAL)} AL)\nCurrent Stock: ${fmtNum(k.ethanolStock)} BL\nDispatched: ${fmtNum(k.totalDispatchBL)} BL (${k.dispatchTrucks} trucks)\nKLPD: ${k.latestKlpd.toFixed(1)}\n\n*DDGS*\nProduced: ${k.ddgsProduced.toFixed(0)} Kg\nDispatched: ${k.ddgsDispatched.toFixed(0)} Kg\n\n*Quality*\nAvg Ethanol: ${k.avgEthanolStrength.toFixed(1)}%\nRaw Moisture: ${k.avgMoisture.toFixed(1)}%\nRaw Starch: ${k.avgStarch.toFixed(1)}%`;
    if (navigator.share) { navigator.share({ text: t }).catch(() => {}); }
    else { window.open(`https://t.me/share/url?text=${encodeURIComponent(t)}`, '_blank'); }
  };

  if (loading && !data) return (
    <div className="flex items-center justify-center h-64">
      <RefreshCw className="animate-spin text-blue-500" size={24} />
    </div>
  );

  if (!data) return <div className="p-8 text-center text-gray-500">Failed to load dashboard</div>;

  const k = data.kpis;
  const t = data.trends;
  // Today's ethanol production is incomplete (next dip not entered yet) — exclude from charts
  const todayStr = new Date().toISOString().slice(0, 10);
  const ethanolExToday = t.ethanol.filter((e: any) => e.date !== todayStr);
  // KLPD KPI: use yesterday's (last complete) instead of today's incomplete
  const prevKlpd = ethanolExToday.length > 0 ? ethanolExToday[ethanolExToday.length - 1].klpd : k.latestKlpd;

  return (
    <div className="space-y-4 pb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Plant Dashboard</h1>
          <p className="text-xs text-gray-400">{data.period.from} — {data.period.to}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {PERIOD_OPTIONS.map(p => (
            <button key={p.days} onClick={() => setDays(p.days)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${days === p.days ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {p.label}
            </button>
          ))}
          <button onClick={() => { fetchData(days); fetchFermData(days); }} className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 transition" title="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={handleShare} className="p-1.5 rounded-lg bg-green-100 hover:bg-green-200 transition text-green-700" title="Share">
            <Share2 size={14} />
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 overflow-x-auto">
        {(['overview', 'fermentation', 'production', 'quality', 'dispatch'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-md text-xs font-medium transition whitespace-nowrap ${activeTab === tab ? 'bg-white shadow text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}>
            {tab === 'overview' ? 'Overview' : tab === 'fermentation' ? 'Fermentation' : tab === 'production' ? 'Production' : tab === 'quality' ? 'Quality' : 'Dispatch'}
          </button>
        ))}
      </div>

      {/* ═══ OVERVIEW TAB ═══ */}
      {activeTab === 'overview' && (
        <>
          {/* KPI Grid — Row 1: Grain & Ethanol */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            <KPI label="Grain Unloaded" value={k.grainUnloaded.toFixed(0)} unit="T" icon={Wheat} color="bg-amber-600" sub={`Consumed: ${k.grainConsumed.toFixed(0)} T`} />
            <KPI label="Silo Stock" value={k.siloStock.toFixed(0)} unit="T" icon={Factory} color="bg-amber-800" sub={`Total@Plant: ${k.totalAtPlant.toFixed(0)} T`} />
            <KPI label="Ethanol Prod" value={fmtNum(k.ethanolProductionBL)} unit="BL" icon={Fuel} color="bg-blue-600" sub={`AL: ${fmtNum(k.ethanolProductionAL)}`} />
            <KPI label="Current Stock" value={fmtNum(k.ethanolStock)} unit="BL" icon={Droplets} color="bg-cyan-600" sub={`Avg: ${k.avgStrength.toFixed(1)}%`} />
            <KPI label="Dispatched" value={fmtNum(k.totalDispatchBL)} unit="BL" icon={Truck} color="bg-green-600" sub={`${k.dispatchTrucks} trucks`} />
            <KPI label="KLPD" value={prevKlpd.toFixed(1)} unit="" icon={TrendingUp} color="bg-indigo-600" sub="Last complete day" />
          </div>

          {/* KPI Grid — Row 2: Quality, DDGS, Distillation */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            <KPI label="Ethanol Strength" value={k.avgEthanolStrength.toFixed(1)} unit="%" icon={FlaskConical} color="bg-purple-600" sub="Distillation avg" />
            <KPI label="Raw Moisture" value={k.avgMoisture.toFixed(1)} unit="%" icon={Wheat} color="bg-yellow-600" sub={`${data.tables.rawMaterial.length} samples`} />
            <KPI label="DDGS Produced" value={(k.ddgsProduced / 1000).toFixed(1)} unit="T" icon={Package} color="bg-green-700" sub={`Dispatched: ${(k.ddgsDispatched / 1000).toFixed(1)} T`} />
            <KPI label="Live Feed Rate" value={liveFeedRate !== null ? liveFeedRate.toFixed(1) : '—'} unit="M³/hr" icon={Flame} color="bg-orange-600" sub={`Wash 24h: ${k.washDistilled.toFixed(0)} KL`} />
            <KPI label="RC Strength (Live)" value={rcStrength ? rcStrength.pctVV.toFixed(1) : '—'} unit="% v/v" icon={Beaker} color="bg-rose-600" sub={rcStrength ? `${rcStrength.density} kg/m³ @ ${rcStrength.temp}°C` : 'Awaiting OPC'} />
            <KPI label="Active Fermenters" value={data.live.fermenters.length + data.live.preFermenters.length} unit="" icon={Activity} color="bg-teal-600" sub={`${data.live.fermenters.length} F + ${data.live.preFermenters.length} PF`} />
          </div>

          {/* OPC Tank Levels — Animated */}
          {tankLevels.length > 0 && (
            <div className="bg-white border border-slate-300 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Live Tank Levels (OPC)</span>
                <span className="text-[9px] text-slate-400">Auto-refresh 60s</span>
              </div>
              <div className="flex gap-3 justify-center flex-wrap">
                {tankLevels.map(tank => {
                  const pct = Math.min(Math.max(tank.level, 0), 100);
                  const fillColor = pct > 80 ? '#dc2626' : pct > 60 ? tank.color : pct < 10 ? '#94a3b8' : tank.color;
                  return (
                    <div key={tank.label} className="flex flex-col items-center" style={{ width: 70 }}>
                      {/* Tank SVG */}
                      <div className="relative" style={{ width: 50, height: 80 }}>
                        <svg width="50" height="80" viewBox="0 0 50 80">
                          {/* Tank outline */}
                          <rect x="5" y="5" width="40" height="65" rx="4" fill="#f1f5f9" stroke="#cbd5e1" strokeWidth="1.5" />
                          {/* Liquid fill — animated */}
                          <rect
                            x="6" y={6 + 63 * (1 - pct / 100)} width="38"
                            height={63 * pct / 100}
                            rx="3" fill={fillColor} opacity={0.7}
                            style={{ transition: 'y 1s ease, height 1s ease' }}
                          />
                          {/* Liquid wave effect */}
                          {pct > 2 && pct < 98 && (
                            <ellipse
                              cx="25" cy={6 + 63 * (1 - pct / 100) + 2}
                              rx="18" ry="2" fill={fillColor} opacity={0.5}
                            />
                          )}
                          {/* Level text inside tank */}
                          <text x="25" y="45" textAnchor="middle" fontSize="11" fontWeight="bold"
                            fill={pct > 40 ? '#fff' : '#334155'} fontFamily="monospace">
                            {pct.toFixed(0)}%
                          </text>
                        </svg>
                      </div>
                      {/* Label */}
                      <div className="text-[10px] font-bold text-slate-700 mt-1">{tank.label}</div>
                      {tank.temp != null && tank.temp > 0 && (
                        <div className="text-[9px] text-orange-600 font-mono">{tank.temp}&deg;C</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Live Feed Rate — 1h rolling chart */}
          {feedHistory.length > 0 && (
            <div className="bg-white border border-slate-300 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Live Feed Rate (Last 1 Hour)</span>
                <span className="text-xs font-mono font-bold text-orange-600">{liveFeedRate !== null ? `${liveFeedRate} M³/hr` : '—'}</span>
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={feedHistory}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="time" {...CHART_AXIS_PROPS} />
                  <YAxis {...CHART_AXIS_PROPS} domain={['auto', 'auto']} />
                  <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => [`${v} M³/hr`, 'Feed Rate']} />
                  <Area type="monotone" dataKey="rate" stroke="#ea580c" fill="#fed7aa" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Charts — 2x2 grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-300 p-3">
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Ethanol Production (BL)</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={t.ethanol}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="date" {...CHART_AXIS_PROPS} tickFormatter={shortDate} />
                  <YAxis {...CHART_AXIS_PROPS} />
                  <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => v.toFixed(0)} labelFormatter={(l: string) => `Date: ${l}`} />
                  <Bar dataKey="productionBL" fill="#3b82f6" name="Production BL" radius={[3, 3, 0, 0]} />
                  {t.ethanol.length > 24 && <Brush dataKey="date" height={20} stroke="#1e40af" tickFormatter={shortDate} />}
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white border border-slate-300 p-3">
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">KLPD Trend</h3>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={ethanolExToday}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="date" {...CHART_AXIS_PROPS} tickFormatter={shortDate} />
                  <YAxis {...CHART_AXIS_PROPS} />
                  <Tooltip {...CHART_TOOLTIP} />
                  <Line type="monotone" dataKey="klpd" stroke="#1e40af" strokeWidth={2} dot={{ r: 3, fill: '#1e40af' }} name="KLPD" />
                  {ethanolExToday.length > 24 && <Brush dataKey="date" height={20} stroke="#1e40af" tickFormatter={shortDate} />}
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white border border-slate-300 p-3">
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Grain Stock (Ton)</h3>
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={t.grain}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="date" {...CHART_AXIS_PROPS} tickFormatter={shortDate} />
                  <YAxis {...CHART_AXIS_PROPS} />
                  <Tooltip {...CHART_TOOLTIP} />
                  <Area type="monotone" dataKey="siloStock" stroke="#1e40af" fill="#1e40af" fillOpacity={0.15} name="Silo Stock" />
                  <Area type="monotone" dataKey="consumed" stroke="#dc2626" fill="#dc2626" fillOpacity={0.1} name="Consumed" strokeDasharray="4 3" />
                  {t.grain.length > 24 && <Brush dataKey="date" height={20} stroke="#1e40af" tickFormatter={shortDate} />}
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white border border-slate-300 p-3">
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Ethanol Stock & Dispatch (BL)</h3>
              <ResponsiveContainer width="100%" height={250}>
                <ComposedChart data={t.ethanol}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="date" {...CHART_AXIS_PROPS} tickFormatter={shortDate} />
                  <YAxis {...CHART_AXIS_PROPS} />
                  <Tooltip {...CHART_TOOLTIP} />
                  <Legend {...CHART_LEGEND} />
                  <Area type="monotone" dataKey="totalStock" stroke="#0891b2" fill="#0891b2" fillOpacity={0.15} name="Stock" />
                  <Bar dataKey="dispatch" fill="#10b981" name="Dispatch" radius={[3, 3, 0, 0]} />
                  {t.ethanol.length > 24 && <Brush dataKey="date" height={20} stroke="#1e40af" tickFormatter={shortDate} />}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Recent Dispatch Table */}
          {data.tables.recentDispatches.length > 0 && (
            <>
              <SectionHeader title="Recent Dispatches" icon={Truck} />
              <div className="bg-white border border-slate-300 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600 text-xs">
                      <tr>
                        <th className="px-3 py-2 text-left">Date</th>
                        <th className="px-3 py-2 text-left">Vehicle</th>
                        <th className="px-3 py-2 text-left">Party</th>
                        <th className="px-3 py-2 text-right">Qty (BL)</th>
                        <th className="px-3 py-2 text-right">Strength</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.tables.recentDispatches.slice(0, 8).map((d: any, i: number) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-gray-600">{shortDate(d.date)}</td>
                          <td className="px-3 py-2 font-medium">{d.vehicleNo}</td>
                          <td className="px-3 py-2 text-gray-600">{d.party}</td>
                          <td className="px-3 py-2 text-right font-medium">{(d.quantityBL || 0).toLocaleString()}</td>
                          <td className="px-3 py-2 text-right">{d.strength}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* Live Fermenter Status */}
          {(data.live.fermenters.length > 0 || data.live.preFermenters.length > 0) && (
            <>
              <SectionHeader title="Live Fermenter Status" icon={Activity} />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {data.live.fermenters.map((b: any) => <FermCard key={`f-${b.batchNo}-${b.fermenterNo}`} b={b} type="F" />)}
                {data.live.preFermenters.map((b: any) => <FermCard key={`pf-${b.batchNo}-${b.fermenterNo}`} b={b} type="PF" />)}
              </div>
            </>
          )}

          {/* Fermentation Alerts (from deep endpoint) */}
          {fermData && fermData.alerts && fermData.alerts.length > 0 && (
            <>
              <SectionHeader title="Fermentation Alerts" icon={AlertTriangle} />
              <div className="space-y-2">
                {fermData.alerts.map((a: any, i: number) => (
                  <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border ${a.severity === 'critical' ? 'bg-red-50 border-red-200' : a.severity === 'warning' ? 'bg-amber-50 border-amber-200' : 'bg-blue-50 border-blue-200'}`}>
                    <AlertTriangle size={16} className={a.severity === 'critical' ? 'text-red-500' : a.severity === 'warning' ? 'text-amber-500' : 'text-blue-500'} />
                    <div>
                      <span className="text-sm font-semibold">{a.vessel}</span>
                      <span className="text-sm text-gray-600 ml-2">{a.msg}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ═══ FERMENTATION TAB ═══ */}
      {activeTab === 'fermentation' && (
        <FermentationDashboard data={fermData} loading={fermLoading} />
      )}

      {/* ═══ PRODUCTION TAB ═══ */}
      {activeTab === 'production' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KPI label="Live Feed Rate" value={liveFeedRate !== null ? liveFeedRate.toFixed(1) : '—'} unit="M³/hr" icon={Flame} color="bg-orange-600" sub={`Wash 24h: ${k.washDistilled.toFixed(0)} KL`} />
            <KPI label="RC Strength (Live)" value={rcStrength ? rcStrength.pctVV.toFixed(1) : '—'} unit="% v/v" icon={Beaker} color="bg-rose-600" sub={rcStrength ? `${rcStrength.density} kg/m³ @ ${rcStrength.temp}°C` : 'Awaiting OPC'} />
            <KPI label="Ethanol (AL)" value={fmtNum(k.ethanolProductionAL)} unit="AL" icon={Fuel} color="bg-blue-600" />
            <KPI label="Grain Consumed" value={k.grainConsumed.toFixed(0)} unit="T" icon={Wheat} color="bg-amber-600" />
            <KPI label="Silo Stock" value={k.siloStock.toFixed(0)} unit="T" icon={Factory} color="bg-amber-800" />
            <KPI label="DDGS Produced" value={(k.ddgsProduced / 1000).toFixed(1)} unit="T" icon={Package} color="bg-green-700" sub={`Dispatched: ${(k.ddgsDispatched / 1000).toFixed(1)} T`} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-300 p-3">
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">KLPD Trend</h3>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={ethanolExToday}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="date" {...CHART_AXIS_PROPS} tickFormatter={shortDate} />
                  <YAxis {...CHART_AXIS_PROPS} />
                  <Tooltip {...CHART_TOOLTIP} />
                  <Line type="monotone" dataKey="klpd" stroke="#1e40af" strokeWidth={2} dot={{ r: 3, fill: '#1e40af' }} name="KLPD" />
                  {ethanolExToday.length > 24 && <Brush dataKey="date" height={20} stroke="#1e40af" tickFormatter={shortDate} />}
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white border border-slate-300 p-3">
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Grain: Unloaded vs Consumed</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={t.grain}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="date" {...CHART_AXIS_PROPS} tickFormatter={shortDate} />
                  <YAxis {...CHART_AXIS_PROPS} />
                  <Tooltip {...CHART_TOOLTIP} />
                  <Legend {...CHART_LEGEND} />
                  <Bar dataKey="unloaded" fill="#f59e0b" name="Unloaded" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="consumed" fill="#dc2626" name="Consumed" radius={[3, 3, 0, 0]} />
                  {t.grain.length > 24 && <Brush dataKey="date" height={20} stroke="#1e40af" tickFormatter={shortDate} />}
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white border border-slate-300 p-3">
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">DDGS Production & Dispatch</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={t.ddgs}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="date" {...CHART_AXIS_PROPS} tickFormatter={shortDate} />
                  <YAxis {...CHART_AXIS_PROPS} />
                  <Tooltip {...CHART_TOOLTIP} />
                  <Legend {...CHART_LEGEND} />
                  <Bar dataKey="produced" fill="#10b981" name="Produced" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="dispatched" fill="#3b82f6" name="Dispatched" radius={[3, 3, 0, 0]} />
                  {t.ddgs.length > 24 && <Brush dataKey="date" height={20} stroke="#1e40af" tickFormatter={shortDate} />}
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white border border-slate-300 p-3">
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Ethanol Stock (BL)</h3>
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={t.ethanol}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="date" {...CHART_AXIS_PROPS} tickFormatter={shortDate} />
                  <YAxis {...CHART_AXIS_PROPS} />
                  <Tooltip {...CHART_TOOLTIP} />
                  <Area type="monotone" dataKey="totalStock" stroke="#0891b2" fill="#0891b2" fillOpacity={0.15} name="Stock BL" />
                  {t.ethanol.length > 24 && <Brush dataKey="date" height={20} stroke="#1e40af" tickFormatter={shortDate} />}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

      {/* ═══ QUALITY TAB ═══ */}
      {activeTab === 'quality' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPI label="Avg Ethanol Strength" value={k.avgEthanolStrength.toFixed(1)} unit="%" icon={Droplets} color="bg-blue-600" />
            <KPI label="Avg Moisture" value={k.avgMoisture.toFixed(1)} unit="%" icon={Wheat} color="bg-amber-500" sub={`${data.tables.rawMaterial.length} samples`} />
            <KPI label="Avg Starch" value={k.avgStarch.toFixed(1)} unit="%" icon={Wheat} color="bg-green-600" />
            <KPI label="Avg Strength" value={k.avgStrength.toFixed(1)} unit="%" icon={Fuel} color="bg-indigo-600" sub="Weighted avg" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-300 p-3">
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Distillation Strength</h3>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={t.distillation}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="date" {...CHART_AXIS_PROPS} tickFormatter={shortDate} />
                  <YAxis {...CHART_AXIS_PROPS} domain={['auto', 'auto']} />
                  <Tooltip {...CHART_TOOLTIP} />
                  <Legend {...CHART_LEGEND} />
                  <Line type="monotone" dataKey="ethanolStrength" stroke="#1e40af" strokeWidth={2} dot={{ r: 3, fill: '#1e40af' }} name="Ethanol %" />
                  <Line type="monotone" dataKey="rcReflexStrength" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: '#f59e0b' }} strokeDasharray="4 3" name="RC Reflex %" />
                  {t.distillation.length > 24 && <Brush dataKey="date" height={20} stroke="#1e40af" tickFormatter={shortDate} />}
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white border border-slate-300 p-3">
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Liquefaction Gravity</h3>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={t.liquefaction}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="date" {...CHART_AXIS_PROPS} tickFormatter={shortDate} />
                  <YAxis {...CHART_AXIS_PROPS} domain={['auto', 'auto']} />
                  <Tooltip {...CHART_TOOLTIP} />
                  <Legend {...CHART_LEGEND} />
                  <Line type="monotone" dataKey="iltGravity" stroke="#1e40af" strokeWidth={2} dot={{ r: 3, fill: '#1e40af' }} name="ILT" />
                  <Line type="monotone" dataKey="fltGravity" stroke="#10b981" strokeWidth={2} dot={{ r: 3, fill: '#10b981' }} strokeDasharray="4 3" name="FLT" />
                  {t.liquefaction.length > 24 && <Brush dataKey="date" height={20} stroke="#1e40af" tickFormatter={shortDate} />}
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white border border-slate-300 p-3">
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Liquefaction pH</h3>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={t.liquefaction}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="date" {...CHART_AXIS_PROPS} tickFormatter={shortDate} />
                  <YAxis {...CHART_AXIS_PROPS} domain={['auto', 'auto']} />
                  <Tooltip {...CHART_TOOLTIP} />
                  <Legend {...CHART_LEGEND} />
                  <Line type="monotone" dataKey="iltPh" stroke="#1e40af" strokeWidth={2} dot={{ r: 3, fill: '#1e40af' }} name="ILT pH" />
                  <Line type="monotone" dataKey="fltPh" stroke="#dc2626" strokeWidth={2} dot={{ r: 3, fill: '#dc2626' }} strokeDasharray="4 3" name="FLT pH" />
                  {t.liquefaction.length > 24 && <Brush dataKey="date" height={20} stroke="#1e40af" tickFormatter={shortDate} />}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {t.milling.length > 0 && (
              <div className="bg-white border border-slate-300 p-3">
                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Milling Sieve Analysis</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={t.milling}>
                    <CartesianGrid {...CHART_GRID} />
                    <XAxis dataKey="date" {...CHART_AXIS_PROPS} tickFormatter={shortDate} />
                    <YAxis {...CHART_AXIS_PROPS} />
                    <Tooltip {...CHART_TOOLTIP} />
                    <Legend {...CHART_LEGEND} />
                    <Line type="monotone" dataKey="sieve1mm" stroke="#dc2626" strokeWidth={2} dot={{ r: 3, fill: '#dc2626' }} name="1.00mm" />
                    <Line type="monotone" dataKey="sieve850" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: '#f59e0b' }} strokeDasharray="4 3" name="0.850mm" />
                    <Line type="monotone" dataKey="sieve600" stroke="#10b981" strokeWidth={2} dot={{ r: 3, fill: '#10b981' }} strokeDasharray="4 3" name="0.600mm" />
                    <Line type="monotone" dataKey="sieve300" stroke="#1e40af" strokeWidth={2} dot={{ r: 3, fill: '#1e40af' }} strokeDasharray="4 3" name="0.300mm" />
                    {t.milling.length > 24 && <Brush dataKey="date" height={20} stroke="#1e40af" tickFormatter={shortDate} />}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {data.tables.rawMaterial.length > 0 && (
            <div className="bg-white border border-slate-300 p-3 overflow-x-auto">
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Recent Raw Material</h3>
              <table className="w-full text-xs">
                <thead><tr className="border-b text-gray-500">
                  <th className="text-left py-2 pr-3">Date</th>
                  <th className="text-left py-2 pr-3">Vehicle</th>
                  <th className="text-left py-2 pr-3">Material</th>
                  <th className="text-right py-2 pr-3">Moisture%</th>
                  <th className="text-right py-2 pr-3">Starch%</th>
                  <th className="text-right py-2">Damaged%</th>
                </tr></thead>
                <tbody>
                  {data.tables.rawMaterial.map((r: any, i: number) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-1.5 pr-3">{shortDate(r.date)}</td>
                      <td className="py-1.5 pr-3 font-medium">{r.vehicleNo}</td>
                      <td className="py-1.5 pr-3">{r.material}</td>
                      <td className="py-1.5 pr-3 text-right">{r.moisture?.toFixed(1) ?? '—'}</td>
                      <td className="py-1.5 pr-3 text-right">{r.starch?.toFixed(1) ?? '—'}</td>
                      <td className="py-1.5 text-right">{r.damaged?.toFixed(1) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ═══ DISPATCH TAB ═══ */}
      {activeTab === 'dispatch' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPI label="Total Dispatched" value={fmtNum(k.totalDispatchBL)} unit="BL" icon={Truck} color="bg-green-600" />
            <KPI label="Trucks" value={k.dispatchTrucks} unit="" icon={Truck} color="bg-blue-600" />
            <KPI label="DDGS Dispatched" value={(k.ddgsDispatched / 1000).toFixed(1)} unit="T" icon={Package} color="bg-amber-600" />
            <KPI label="Avg Strength" value={k.avgStrength.toFixed(1)} unit="%" icon={Fuel} color="bg-indigo-600" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {data.tables.dispatchByParty.length > 0 && (
              <div className="bg-white border border-slate-300 p-3">
                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Dispatch by Party (BL)</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={data.tables.dispatchByParty.slice(0, 8)} dataKey="qty" nameKey="party" cx="50%" cy="50%"
                      outerRadius={90} label={({ party, qty }: any) => `${party.slice(0, 12)}: ${fmtNum(qty)}`}
                      labelLine={false} fontSize={10}>
                      {data.tables.dispatchByParty.slice(0, 8).map((_: any, i: number) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => `${v.toFixed(0)} BL`} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="bg-white border border-slate-300 p-3">
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Daily Ethanol Dispatch (BL)</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={t.ethanol}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="date" {...CHART_AXIS_PROPS} tickFormatter={shortDate} />
                  <YAxis {...CHART_AXIS_PROPS} />
                  <Tooltip {...CHART_TOOLTIP} />
                  <Bar dataKey="dispatch" fill="#10b981" name="Dispatch BL" radius={[3, 3, 0, 0]} />
                  {t.ethanol.length > 24 && <Brush dataKey="date" height={20} stroke="#1e40af" tickFormatter={shortDate} />}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {data.tables.recentDispatches.length > 0 && (
            <div className="bg-white border border-slate-300 p-3 overflow-x-auto">
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Recent Dispatches</h3>
              <table className="w-full text-xs">
                <thead><tr className="border-b text-gray-500">
                  <th className="text-left py-2 pr-3">Date</th>
                  <th className="text-left py-2 pr-3">Vehicle</th>
                  <th className="text-left py-2 pr-3">Party</th>
                  <th className="text-left py-2 pr-3">Destination</th>
                  <th className="text-right py-2 pr-3">Qty (BL)</th>
                  <th className="text-right py-2">Strength%</th>
                </tr></thead>
                <tbody>
                  {data.tables.recentDispatches.map((d: any, i: number) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-1.5 pr-3">{shortDate(d.date)}</td>
                      <td className="py-1.5 pr-3 font-medium">{d.vehicleNo}</td>
                      <td className="py-1.5 pr-3">{d.party}</td>
                      <td className="py-1.5 pr-3">{d.destination}</td>
                      <td className="py-1.5 pr-3 text-right font-medium">{d.quantityBL?.toFixed(0)}</td>
                      <td className="py-1.5 text-right">{d.strength?.toFixed(1) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.tables.dispatchByParty.length > 0 && (
            <div className="bg-white border border-slate-300 p-3 overflow-x-auto">
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Party-wise Summary</h3>
              <table className="w-full text-xs">
                <thead><tr className="border-b text-gray-500">
                  <th className="text-left py-2 pr-3">Party</th>
                  <th className="text-right py-2 pr-3">Trucks</th>
                  <th className="text-right py-2">Total BL</th>
                </tr></thead>
                <tbody>
                  {data.tables.dispatchByParty.map((p: any, i: number) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-1.5 pr-3 font-medium">{p.party}</td>
                      <td className="py-1.5 pr-3 text-right">{p.count}</td>
                      <td className="py-1.5 text-right font-medium">{p.qty.toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   FERMENTATION DASHBOARD — the heart of the business
   ═══════════════════════════════════════════════════════════════ */
function FermentationDashboard({ data, loading }: { data: any; loading: boolean }) {
  const [selectedCurve, setSelectedCurve] = useState<number | null>(null);

  if (loading || !data) return (
    <div className="flex items-center justify-center h-48">
      <RefreshCw className="animate-spin text-indigo-500" size={24} />
      <span className="ml-2 text-gray-500">Loading fermentation analytics...</span>
    </div>
  );

  const fk = data.fermKpis;
  const pipe = data.pipeline;

  // Build gravity chart data — overlay multiple batches + avg curve
  const gravityCurves = data.gravityCurves || [];
  const avgCurve = data.avgCurve || [];

  // Merge all curves into chart-friendly format: each point = { hour, batch_N_gravity, avg_gravity }
  const maxHour = Math.max(
    ...gravityCurves.flatMap((c: any) => c.points.map((p: any) => p.hour)),
    ...avgCurve.map((p: any) => p.hour),
    1
  );
  const hourSteps: number[] = [];
  for (let h = 0; h <= maxHour; h += 2) hourSteps.push(h);

  const gravityChartData = hourSteps.map(h => {
    const row: any = { hour: h };
    // avg curve
    const avg = avgCurve.find((p: any) => p.hour === h);
    if (avg) {
      row.avgGravity = avg.avgGravity ? Math.round(avg.avgGravity * 1000) / 1000 : null;
      row.minGravity = avg.minGravity ? Math.round(avg.minGravity * 1000) / 1000 : null;
      row.maxGravity = avg.maxGravity ? Math.round(avg.maxGravity * 1000) / 1000 : null;
    }
    // per-batch curves
    gravityCurves.forEach((c: any, i: number) => {
      const pt = c.points.find((p: any) => Math.abs(p.hour - h) < 1.5);
      if (pt) row[`b${c.batchNo}`] = Math.round(pt.gravity * 1000) / 1000;
    });
    return row;
  });

  // Alcohol build-up chart — same approach
  const alcoholChartData = hourSteps.map(h => {
    const row: any = { hour: h };
    const avg = avgCurve.find((p: any) => p.hour === h);
    if (avg?.avgAlcohol) row.avgAlcohol = Math.round(avg.avgAlcohol * 100) / 100;
    gravityCurves.forEach((c: any) => {
      const pt = c.points.find((p: any) => Math.abs(p.hour - h) < 1.5);
      if (pt?.alcohol) row[`b${c.batchNo}`] = Math.round(pt.alcohol * 100) / 100;
    });
    return row;
  });

  // Temperature chart
  const tempChartData = hourSteps.map(h => {
    const row: any = { hour: h };
    const avg = avgCurve.find((p: any) => p.hour === h);
    if (avg?.avgTemp) row.avgTemp = Math.round(avg.avgTemp * 10) / 10;
    gravityCurves.forEach((c: any) => {
      const pt = c.points.find((p: any) => Math.abs(p.hour - h) < 1.5);
      if (pt?.temp) row[`b${c.batchNo}`] = Math.round(pt.temp * 10) / 10;
    });
    return row;
  });

  return (
    <div className="space-y-4">
      {/* ─── Plant Pipeline Flow ─── */}
      <div className="bg-white border border-slate-300 p-3">
        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-2"><Zap size={14} /> Plant Pipeline</h3>
        <div className="flex items-center gap-1 overflow-x-auto pb-2">
          <PipelineStep label="Grain In" value={pipe.grainIn.toFixed(0)} unit="T" icon={Wheat} color="bg-amber-600" />
          <PipelineStep label="Consumed" value={pipe.grainConsumed.toFixed(0)} unit="T" icon={Flame} color="bg-orange-600" />
          <PipelineStep label="PF Batches" value={pipe.pfBatchesRun} unit="runs" icon={Beaker} color="bg-indigo-600" />
          <PipelineStep label="Ferm" value={pipe.fermBatchesRun} unit="batches" icon={FlaskConical} color="bg-emerald-600" />
          <PipelineStep label="Ethanol" value={fmtNum(pipe.ethanolProduced)} unit="BL" icon={Fuel} color="bg-blue-600" />
          <PipelineStep label="Dispatched" value={fmtNum(pipe.ethanolDispatched)} unit="BL" icon={Truck} color="bg-green-600" isLast />
        </div>
      </div>

      {/* ─── Fermentation KPIs ─── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Total Batches" value={fk.totalBatches} unit="" icon={FlaskConical} color="bg-indigo-600" sub={`${fk.completedCount} done, ${fk.activeFermCount} active`} />
        <KPI label="Avg Cycle Time" value={fk.avgCycleTime} unit="hrs" icon={Clock} color="bg-blue-600" sub={`PF avg: ${fk.avgPFCycleTime} hrs`} />
        <KPI label="Avg Final Alcohol" value={fk.avgFinalAlcohol} unit="%" icon={Droplets} color="bg-emerald-600" sub="Completed batches" />
        <KPI label="Gravity Target" value={fk.gravityTarget} unit="" icon={Target} color="bg-amber-600" sub="PF transfer threshold" />
      </div>

      {/* ─── AI Alerts ─── */}
      {data.alerts && data.alerts.length > 0 && (
        <div className="space-y-2">
          <SectionHeader title="Active Alerts & Insights" icon={Brain} />
          {data.alerts.map((a: any, i: number) => (
            <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border text-sm ${a.severity === 'critical' ? 'bg-red-50 border-red-200' : a.severity === 'warning' ? 'bg-amber-50 border-amber-200' : 'bg-blue-50 border-blue-200'}`}>
              {a.severity === 'critical' ? <AlertTriangle size={16} className="text-red-500 mt-0.5 flex-shrink-0" /> :
               a.severity === 'warning' ? <AlertTriangle size={16} className="text-amber-500 mt-0.5 flex-shrink-0" /> :
               <Activity size={16} className="text-blue-500 mt-0.5 flex-shrink-0" />}
              <div><span className="font-semibold">{a.vessel}:</span> {a.msg}</div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Active Batch Predictions ─── */}
      {data.predictions && data.predictions.length > 0 && (
        <>
          <SectionHeader title="Active Batch Predictions" icon={Brain} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.predictions.map((p: any) => (
              <div key={`pred-${p.batchNo}`} className="bg-white border border-slate-300 p-3">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <FlaskConical size={18} className="text-emerald-600" />
                    <span className="font-bold">F-{p.fermenterNo}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full text-white font-medium" style={{ backgroundColor: phaseColors[p.phase] || '#6b7280' }}>{p.phase}</span>
                    <span className="text-xs text-gray-500">#{p.batchNo}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                  <div>
                    <span className="text-xs text-gray-500">Current Gravity</span>
                    <p className="font-bold text-lg">{p.currentGravity.toFixed(3)}</p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Drop Rate</span>
                    <p className="font-bold text-lg">{p.gravityDropRate}/hr</p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Elapsed</span>
                    <p className="font-medium">{p.hoursElapsed} hrs</p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Est. Remaining</span>
                    <p className="font-medium">{p.hoursRemaining ? `${p.hoursRemaining} hrs` : '—'}</p>
                  </div>
                  {p.currentTemp && (
                    <div>
                      <span className="text-xs text-gray-500">Temperature</span>
                      <p className={`font-medium ${p.currentTemp > 37 ? 'text-red-600' : ''}`}>{p.currentTemp}°C</p>
                    </div>
                  )}
                  {p.currentAlcohol && (
                    <div>
                      <span className="text-xs text-gray-500">Alcohol</span>
                      <p className="font-medium">{p.currentAlcohol}%</p>
                    </div>
                  )}
                </div>
                <div>
                  <span className="text-xs text-gray-500 block mb-1">Health Score</span>
                  <HealthBar score={p.health} />
                </div>
                {p.predictedEndTime && (
                  <p className="text-xs text-gray-400 mt-2">Predicted completion: {new Date(p.predictedEndTime).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ─── Gravity Curves Chart ─── */}
      {gravityChartData.length > 0 && (
        <div className="bg-white border border-slate-300 p-3">
          <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Gravity Drop Curves (Batch Comparison)</h3>
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={gravityChartData}>
              <CartesianGrid {...CHART_GRID} />
              <XAxis dataKey="hour" {...CHART_AXIS_PROPS} label={{ value: 'Hours', position: 'insideBottom', offset: -5, fontSize: 10 }} />
              <YAxis {...CHART_AXIS_PROPS} domain={['auto', 'auto']} label={{ value: 'Gravity', angle: -90, position: 'insideLeft', fontSize: 10 }} />
              <Tooltip {...CHART_TOOLTIP} />
              <Legend {...CHART_LEGEND} />
              {/* Avg curve — thick dashed */}
              <Line type="monotone" dataKey="avgGravity" stroke="#6b7280" strokeWidth={3} strokeDasharray="8 4" dot={false} name="Avg (historical)" />
              {/* Per-batch curves */}
              {gravityCurves.map((c: any, i: number) => (
                <Line key={c.batchNo} type="monotone" dataKey={`b${c.batchNo}`}
                  stroke={FERM_COLORS[i % FERM_COLORS.length]} strokeWidth={c.phase !== 'DONE' ? 2.5 : 1.5}
                  dot={c.phase !== 'DONE' ? { r: 3, fill: FERM_COLORS[i % FERM_COLORS.length] } : false} name={`#${c.batchNo} F-${c.fermenterNo}`}
                  opacity={c.phase !== 'DONE' ? 1 : 0.5} />
              ))}
              <ReferenceLine y={1.000} stroke="#dc2626" strokeDasharray="4 4" label={{ value: 'Target', fontSize: 9 }} />
              {gravityChartData.length > 24 && <Brush dataKey="hour" height={20} stroke="#1e40af" />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ─── Alcohol Build-up Chart ─── */}
      {alcoholChartData.some((d: any) => Object.keys(d).length > 1) && (
        <div className="bg-white border border-slate-300 p-3">
          <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Alcohol Build-up Over Time</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={alcoholChartData}>
              <CartesianGrid {...CHART_GRID} />
              <XAxis dataKey="hour" {...CHART_AXIS_PROPS} />
              <YAxis {...CHART_AXIS_PROPS} label={{ value: 'Alcohol %', angle: -90, position: 'insideLeft', fontSize: 10 }} />
              <Tooltip {...CHART_TOOLTIP} />
              <Legend {...CHART_LEGEND} />
              <Line type="monotone" dataKey="avgAlcohol" stroke="#6b7280" strokeWidth={3} strokeDasharray="8 4" dot={false} name="Avg" />
              {gravityCurves.map((c: any, i: number) => (
                <Line key={c.batchNo} type="monotone" dataKey={`b${c.batchNo}`}
                  stroke={FERM_COLORS[i % FERM_COLORS.length]} strokeWidth={2} dot={{ r: 3, fill: FERM_COLORS[i % FERM_COLORS.length] }}
                  name={`#${c.batchNo}`} opacity={c.phase !== 'DONE' ? 1 : 0.6} />
              ))}
              {alcoholChartData.length > 24 && <Brush dataKey="hour" height={20} stroke="#1e40af" />}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ─── Temperature Monitoring ─── */}
      {tempChartData.some((d: any) => Object.keys(d).length > 1) && (
        <div className="bg-white border border-slate-300 p-3">
          <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Temperature Monitoring</h3>
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={tempChartData}>
              <CartesianGrid {...CHART_GRID} />
              <XAxis dataKey="hour" {...CHART_AXIS_PROPS} />
              <YAxis {...CHART_AXIS_PROPS} domain={[25, 42]} />
              <Tooltip {...CHART_TOOLTIP} />
              <Legend {...CHART_LEGEND} />
              <ReferenceArea y1={37} y2={42} fill="#fecaca" fillOpacity={0.3} />
              <ReferenceLine y={37} stroke="#dc2626" strokeDasharray="4 4" label={{ value: '37\u00b0C limit', fontSize: 9, fill: '#dc2626' }} />
              <Line type="monotone" dataKey="avgTemp" stroke="#6b7280" strokeWidth={3} strokeDasharray="8 4" dot={false} name="Avg" />
              {gravityCurves.map((c: any, i: number) => (
                <Line key={c.batchNo} type="monotone" dataKey={`b${c.batchNo}`}
                  stroke={FERM_COLORS[i % FERM_COLORS.length]} strokeWidth={2} dot={{ r: 3, fill: FERM_COLORS[i % FERM_COLORS.length] }}
                  name={`#${c.batchNo}`} />
              ))}
              {tempChartData.length > 24 && <Brush dataKey="hour" height={20} stroke="#1e40af" />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ─── Batch Comparison Table ─── */}
      {data.batchComparison && data.batchComparison.length > 0 && (
        <div className="bg-white border border-slate-300 p-3 overflow-x-auto">
          <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Batch Comparison</h3>
          <table className="w-full text-xs">
            <thead><tr className="border-b text-gray-500">
              <th className="text-left py-2 pr-2">Batch</th>
              <th className="text-left py-2 pr-2">F#</th>
              <th className="text-left py-2 pr-2">Phase</th>
              <th className="text-right py-2 pr-2">Start SG</th>
              <th className="text-right py-2 pr-2">End SG</th>
              <th className="text-right py-2 pr-2">Drop</th>
              <th className="text-right py-2 pr-2">Max Alc%</th>
              <th className="text-right py-2 pr-2">Avg T°C</th>
              <th className="text-right py-2 pr-2">Max T°C</th>
              <th className="text-right py-2 pr-2">Cycle hrs</th>
              <th className="text-right py-2">#Rdgs</th>
            </tr></thead>
            <tbody>
              {data.batchComparison.map((b: any) => (
                <tr key={`bc-${b.batchNo}-${b.fermenterNo}`} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-1.5 pr-2 font-semibold">#{b.batchNo}</td>
                  <td className="py-1.5 pr-2">F-{b.fermenterNo}</td>
                  <td className="py-1.5 pr-2">
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full text-white" style={{ backgroundColor: phaseColors[b.phase] || '#6b7280' }}>{b.phase}</span>
                  </td>
                  <td className="py-1.5 pr-2 text-right">{b.startGravity?.toFixed(3) ?? '—'}</td>
                  <td className="py-1.5 pr-2 text-right">{b.endGravity?.toFixed(3) ?? '—'}</td>
                  <td className="py-1.5 pr-2 text-right font-medium">{b.gravityDrop?.toFixed(3) ?? '—'}</td>
                  <td className="py-1.5 pr-2 text-right">{b.maxAlcohol?.toFixed(1) ?? '—'}</td>
                  <td className="py-1.5 pr-2 text-right">{b.avgTemp ?? '—'}</td>
                  <td className={`py-1.5 pr-2 text-right ${b.maxTemp && b.maxTemp > 37 ? 'text-red-600 font-bold' : ''}`}>{b.maxTemp?.toFixed(1) ?? '—'}</td>
                  <td className="py-1.5 pr-2 text-right">{b.cycleHours ?? '—'}</td>
                  <td className="py-1.5 text-right">{b.readings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Chemical Consumption ─── */}
      {data.chemicalSummary && data.chemicalSummary.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white border border-slate-300 p-3">
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Chemical Consumption</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={data.chemicalSummary.slice(0, 8)} layout="vertical">
                <CartesianGrid {...CHART_GRID} />
                <XAxis type="number" {...CHART_AXIS_PROPS} />
                <YAxis dataKey="name" type="category" {...CHART_AXIS_PROPS} width={80} />
                <Tooltip {...CHART_TOOLTIP} formatter={(v: number, name: string) => [v.toFixed(1), name === 'total' ? 'Total' : 'Avg/batch']} />
                <Bar dataKey="total" fill="#f59e0b" name="Total" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white border border-slate-300 p-3 overflow-x-auto">
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Chemical Details</h3>
            <table className="w-full text-xs">
              <thead><tr className="border-b text-gray-500">
                <th className="text-left py-2 pr-3">Chemical</th>
                <th className="text-right py-2 pr-3">Total</th>
                <th className="text-right py-2 pr-3">Avg/batch</th>
                <th className="text-right py-2">Batches</th>
              </tr></thead>
              <tbody>
                {data.chemicalSummary.map((c: any) => (
                  <tr key={c.name} className="border-b border-gray-50">
                    <td className="py-1.5 pr-3 font-medium">{c.name}</td>
                    <td className="py-1.5 pr-3 text-right">{c.total} {c.unit}</td>
                    <td className="py-1.5 pr-3 text-right">{c.avgPerBatch} {c.unit}</td>
                    <td className="py-1.5 text-right">{c.batches}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Fermentation Activity Timeline ─── */}
      {data.fermActivity && data.fermActivity.length > 0 && (
        <div className="bg-white border border-slate-300 p-3">
          <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Daily Fermentation Activity</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data.fermActivity}>
              <CartesianGrid {...CHART_GRID} />
              <XAxis dataKey="date" {...CHART_AXIS_PROPS} tickFormatter={shortDate} />
              <YAxis {...CHART_AXIS_PROPS} />
              <Tooltip {...CHART_TOOLTIP} />
              <Legend {...CHART_LEGEND} />
              <Bar dataKey="started" fill="#1e40af" name="Batches Started" radius={[3, 3, 0, 0]} />
              <Bar dataKey="completed" fill="#10b981" name="Batches Completed" radius={[3, 3, 0, 0]} />
              <Bar dataKey="readings" fill="#f59e0b" name="Lab Readings" radius={[3, 3, 0, 0]} />
              {data.fermActivity.length > 24 && <Brush dataKey="date" height={20} stroke="#1e40af" tickFormatter={shortDate} />}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ─── PF Analytics Table ─── */}
      {data.pfAnalytics && data.pfAnalytics.length > 0 && (
        <div className="bg-white border border-slate-300 p-3 overflow-x-auto">
          <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Pre-Fermenter History</h3>
          <table className="w-full text-xs">
            <thead><tr className="border-b text-gray-500">
              <th className="text-left py-2 pr-2">Batch</th>
              <th className="text-left py-2 pr-2">PF#</th>
              <th className="text-left py-2 pr-2">Phase</th>
              <th className="text-right py-2 pr-2">Setup SG</th>
              <th className="text-right py-2 pr-2">Final SG</th>
              <th className="text-right py-2 pr-2">Final Alc%</th>
              <th className="text-right py-2 pr-2">Cycle hrs</th>
              <th className="text-right py-2 pr-2">Chemicals</th>
              <th className="text-right py-2">Readings</th>
            </tr></thead>
            <tbody>
              {data.pfAnalytics.map((b: any) => (
                <tr key={`pfa-${b.batchNo}-${b.fermenterNo}`} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-1.5 pr-2 font-semibold">#{b.batchNo}</td>
                  <td className="py-1.5 pr-2">PF-{b.fermenterNo}</td>
                  <td className="py-1.5 pr-2">
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full text-white" style={{ backgroundColor: phaseColors[b.phase] || '#6b7280' }}>{b.phase}</span>
                  </td>
                  <td className="py-1.5 pr-2 text-right">{b.slurryGravity?.toFixed(3) ?? '—'}</td>
                  <td className="py-1.5 pr-2 text-right">{b.finalGravity?.toFixed(3) ?? '—'}</td>
                  <td className="py-1.5 pr-2 text-right">{b.finalAlcohol?.toFixed(1) ?? '—'}</td>
                  <td className="py-1.5 pr-2 text-right">{b.cycleHours ?? '—'}</td>
                  <td className="py-1.5 pr-2 text-right">{b.dosingCount}</td>
                  <td className="py-1.5 text-right">{b.readingsCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
