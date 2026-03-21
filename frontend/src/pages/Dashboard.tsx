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
  ReferenceLine, ReferenceArea
} from 'recharts';

const PERIOD_OPTIONS = [
  { label: 'Today', days: 1 },
  { label: '7 Days', days: 7 },
  { label: '15 Days', days: 15 },
  { label: '30 Days', days: 30 },
  { label: '90 Days', days: 90 },
];

const COLORS = ['#B87333', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
const FERM_COLORS = ['#B87333', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

const phaseColors: Record<string, string> = {
  FILLING: '#6366f1', SETUP: '#f59e0b', DOSING: '#f59e0b', REACTION: '#22c55e',
  LAB: '#B87333', RETENTION: '#06b6d4', TRANSFER: '#B87333', CIP: '#a855f7', DONE: '#6b7280',
  PF_TRANSFER: '#B87333',
};

function KPI({ label, value, unit, icon: Icon, color, sub, trend }: any) {
  return (
    <div className="bg-white rounded-xl border border-[#E8E8E0] p-3 md:p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${color}`}><Icon size={18} className="text-white" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-[#6B6B63] truncate">{label}</p>
          <div className="flex items-baseline gap-1.5">
            <p className="text-lg md:text-xl font-bold">{value ?? '—'}</p>
            <span className="text-xs text-[#9C9C94]">{unit}</span>
            {trend !== undefined && trend !== 0 && (
              <span className={`text-[10px] flex items-center gap-0.5 ${trend > 0 ? 'text-green-600' : 'text-red-500'}`}>
                {trend > 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                {Math.abs(trend).toFixed(1)}%
              </span>
            )}
          </div>
          {sub && <p className="text-[10px] text-[#9C9C94] mt-0.5 truncate">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ title, icon: Icon }: { title: string; icon: any }) {
  return (
    <div className="flex items-center gap-2 mt-2">
      <Icon size={16} className="text-[#B87333]" />
      <h3 className="text-sm font-semibold text-[#333330] font-heading">{title}</h3>
    </div>
  );
}

function FermCard({ b, type }: { b: any; type: 'F' | 'PF' }) {
  return (
    <div className="bg-white rounded-lg border shadow-sm p-3">
      <div className="flex justify-between items-center mb-2">
        <span className="font-semibold text-sm">{type}{b.fermenterNo} — #{b.batchNo}</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full text-white font-bold"
          style={{ backgroundColor: phaseColors[b.phase] || '#6b7280' }}>{b.phase}</span>
      </div>
      <div className="text-xs text-[#6B6B63] space-y-0.5">
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
      <div className="flex-1 bg-[#E8E8E0] rounded-full h-2.5 overflow-hidden">
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
    else { window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(t)}`, '_blank'); }
  };

  if (loading && !data) return (
    <div className="flex items-center justify-center h-64">
      <RefreshCw className="animate-spin text-[#B87333]" size={24} />
    </div>
  );

  if (!data) return <div className="p-8 text-center text-[#6B6B63]">Failed to load dashboard</div>;

  const k = data.kpis;
  const t = data.trends;

  return (
    <div className="space-y-4 pb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#1F1F1C] font-heading">Plant Dashboard</h1>
          <p className="text-xs text-[#9C9C94]">{data.period.from} — {data.period.to}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {PERIOD_OPTIONS.map(p => (
            <button key={p.days} onClick={() => setDays(p.days)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${days === p.days ? 'bg-[#B87333] text-white' : 'bg-[#F5F5F0] text-[#6B6B63] hover:bg-[#E8E8E0]'}`}>
              {p.label}
            </button>
          ))}
          <button onClick={() => { fetchData(days); fetchFermData(days); }} className="p-1.5 rounded-lg bg-[#F5F5F0] hover:bg-[#E8E8E0] transition" title="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={handleShare} className="p-1.5 rounded-lg bg-green-100 hover:bg-green-200 transition text-green-700" title="Share">
            <Share2 size={14} />
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-[#F5F5F0] rounded-lg p-1 overflow-x-auto">
        {(['overview', 'fermentation', 'production', 'quality', 'dispatch'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-md text-xs font-medium transition whitespace-nowrap ${activeTab === tab ? 'bg-white shadow text-[#B87333]' : 'text-[#6B6B63] hover:text-[#333330]'}`}>
            {tab === 'overview' ? 'Overview' : tab === 'fermentation' ? 'Fermentation' : tab === 'production' ? 'Production' : tab === 'quality' ? 'Quality' : 'Dispatch'}
          </button>
        ))}
      </div>

      {/* ═══ OVERVIEW TAB ═══ */}
      {activeTab === 'overview' && (
        <>
          {/* KPI Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            <KPI label="Grain Unloaded" value={k.grainUnloaded.toFixed(0)} unit="T" icon={Wheat} color="bg-amber-600" sub={`Consumed: ${k.grainConsumed.toFixed(0)} T`} />
            <KPI label="Silo Stock" value={k.siloStock.toFixed(0)} unit="T" icon={Factory} color="bg-amber-800" sub={`Total@Plant: ${k.totalAtPlant.toFixed(0)} T`} />
            <KPI label="Ethanol Prod" value={fmtNum(k.ethanolProductionBL)} unit="BL" icon={Fuel} color="bg-[#B87333]" sub={`AL: ${fmtNum(k.ethanolProductionAL)}`} />
            <KPI label="Current Stock" value={fmtNum(k.ethanolStock)} unit="BL" icon={Droplets} color="bg-cyan-600" sub={`Avg: ${k.avgStrength.toFixed(1)}%`} />
            <KPI label="Dispatched" value={fmtNum(k.totalDispatchBL)} unit="BL" icon={Truck} color="bg-green-600" sub={`${k.dispatchTrucks} trucks`} />
            <KPI label="KLPD" value={k.latestKlpd.toFixed(1)} unit="" icon={TrendingUp} color="bg-[#B87333]" sub="Latest flow rate" />
          </div>

          {/* Two charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-[#E8E8E0] p-4">
              <h3 className="text-sm font-semibold text-[#333330] mb-3 font-heading">Ethanol Production (BL)</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={t.ethanol}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" fontSize={10} tickFormatter={shortDate} />
                  <YAxis fontSize={10} />
                  <Tooltip formatter={(v: number) => v.toFixed(0)} labelFormatter={(l: string) => `Date: ${l}`} />
                  <Bar dataKey="productionBL" fill="#B87333" name="Production BL" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-xl border border-[#E8E8E0] p-4">
              <h3 className="text-sm font-semibold text-[#333330] mb-3 font-heading">Grain Stock (Ton)</h3>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={t.grain}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" fontSize={10} tickFormatter={shortDate} />
                  <YAxis fontSize={10} />
                  <Tooltip />
                  <Area type="monotone" dataKey="siloStock" stroke="#d97706" fill="#fbbf24" fillOpacity={0.3} name="Silo Stock" />
                  <Area type="monotone" dataKey="consumed" stroke="#ef4444" fill="#fca5a5" fillOpacity={0.2} name="Consumed" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

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
                    <AlertTriangle size={16} className={a.severity === 'critical' ? 'text-red-500' : a.severity === 'warning' ? 'text-amber-500' : 'text-[#B87333]'} />
                    <div>
                      <span className="text-sm font-semibold">{a.vessel}</span>
                      <span className="text-sm text-[#6B6B63] ml-2">{a.msg}</span>
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPI label="Wash Distilled" value={k.washDistilled.toFixed(0)} unit="KL" icon={Flame} color="bg-orange-600" />
            <KPI label="Ethanol (AL)" value={fmtNum(k.ethanolProductionAL)} unit="AL" icon={Fuel} color="bg-[#B87333]" />
            <KPI label="Grain Consumed" value={k.grainConsumed.toFixed(0)} unit="T" icon={Wheat} color="bg-amber-600" />
            <KPI label="DDGS Produced" value={(k.ddgsProduced / 1000).toFixed(1)} unit="T" icon={Package} color="bg-green-700" sub={`Dispatched: ${(k.ddgsDispatched / 1000).toFixed(1)} T`} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-[#E8E8E0] p-4">
              <h3 className="text-sm font-semibold text-[#333330] mb-3 font-heading">KLPD Trend</h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={t.ethanol}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" fontSize={10} tickFormatter={shortDate} />
                  <YAxis fontSize={10} />
                  <Tooltip />
                  <Line type="monotone" dataKey="klpd" stroke="#6366f1" strokeWidth={2} dot={false} name="KLPD" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-xl border border-[#E8E8E0] p-4">
              <h3 className="text-sm font-semibold text-[#333330] mb-3 font-heading">Grain: Unloaded vs Consumed</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={t.grain}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" fontSize={10} tickFormatter={shortDate} />
                  <YAxis fontSize={10} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="unloaded" fill="#f59e0b" name="Unloaded" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="consumed" fill="#ef4444" name="Consumed" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-xl border border-[#E8E8E0] p-4">
              <h3 className="text-sm font-semibold text-[#333330] mb-3 font-heading">DDGS Production & Dispatch</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={t.ddgs}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" fontSize={10} tickFormatter={shortDate} />
                  <YAxis fontSize={10} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="produced" fill="#22c55e" name="Produced" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="dispatched" fill="#B87333" name="Dispatched" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-xl border border-[#E8E8E0] p-4">
              <h3 className="text-sm font-semibold text-[#333330] mb-3 font-heading">Ethanol Stock (BL)</h3>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={t.ethanol}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" fontSize={10} tickFormatter={shortDate} />
                  <YAxis fontSize={10} />
                  <Tooltip />
                  <Area type="monotone" dataKey="totalStock" stroke="#06b6d4" fill="#67e8f9" fillOpacity={0.3} name="Stock BL" />
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
            <KPI label="Avg Ethanol Strength" value={k.avgEthanolStrength.toFixed(1)} unit="%" icon={Droplets} color="bg-[#B87333]" />
            <KPI label="Avg Moisture" value={k.avgMoisture.toFixed(1)} unit="%" icon={Wheat} color="bg-amber-500" sub={`${data.tables.rawMaterial.length} samples`} />
            <KPI label="Avg Starch" value={k.avgStarch.toFixed(1)} unit="%" icon={Wheat} color="bg-green-600" />
            <KPI label="Avg Strength" value={k.avgStrength.toFixed(1)} unit="%" icon={Fuel} color="bg-[#B87333]" sub="Weighted avg" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-[#E8E8E0] p-4">
              <h3 className="text-sm font-semibold text-[#333330] mb-3 font-heading">Distillation Strength</h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={t.distillation}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" fontSize={10} tickFormatter={shortDate} />
                  <YAxis fontSize={10} domain={['auto', 'auto']} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="ethanolStrength" stroke="#B87333" dot={false} strokeWidth={2} name="Ethanol %" />
                  <Line type="monotone" dataKey="rcReflexStrength" stroke="#f59e0b" dot={false} strokeWidth={2} name="RC Reflex %" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-xl border border-[#E8E8E0] p-4">
              <h3 className="text-sm font-semibold text-[#333330] mb-3 font-heading">Liquefaction Gravity</h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={t.liquefaction}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" fontSize={10} tickFormatter={shortDate} />
                  <YAxis fontSize={10} domain={['auto', 'auto']} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="iltGravity" stroke="#B87333" dot={false} strokeWidth={2} name="ILT" />
                  <Line type="monotone" dataKey="fltGravity" stroke="#22c55e" dot={false} strokeWidth={2} name="FLT" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-xl border border-[#E8E8E0] p-4">
              <h3 className="text-sm font-semibold text-[#333330] mb-3 font-heading">Liquefaction pH</h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={t.liquefaction}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" fontSize={10} tickFormatter={shortDate} />
                  <YAxis fontSize={10} domain={['auto', 'auto']} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="iltPh" stroke="#8b5cf6" dot={false} strokeWidth={2} name="ILT pH" />
                  <Line type="monotone" dataKey="fltPh" stroke="#ec4899" dot={false} strokeWidth={2} name="FLT pH" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {t.milling.length > 0 && (
              <div className="bg-white rounded-xl border border-[#E8E8E0] p-4">
                <h3 className="text-sm font-semibold text-[#333330] mb-3 font-heading">Milling Sieve Analysis</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={t.milling}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" fontSize={10} tickFormatter={shortDate} />
                    <YAxis fontSize={10} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="sieve1mm" stroke="#ef4444" dot={false} name="1.00mm" />
                    <Line type="monotone" dataKey="sieve850" stroke="#f59e0b" dot={false} name="0.850mm" />
                    <Line type="monotone" dataKey="sieve600" stroke="#22c55e" dot={false} name="0.600mm" />
                    <Line type="monotone" dataKey="sieve300" stroke="#B87333" dot={false} name="0.300mm" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {data.tables.rawMaterial.length > 0 && (
            <div className="bg-white rounded-xl border border-[#E8E8E0] p-4 overflow-x-auto">
              <h3 className="text-sm font-semibold text-[#333330] mb-3 font-heading">Recent Raw Material</h3>
              <table className="w-full text-xs">
                <thead><tr className="border-b text-[#6B6B63]">
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
            <KPI label="Trucks" value={k.dispatchTrucks} unit="" icon={Truck} color="bg-[#B87333]" />
            <KPI label="DDGS Dispatched" value={(k.ddgsDispatched / 1000).toFixed(1)} unit="T" icon={Package} color="bg-amber-600" />
            <KPI label="Avg Strength" value={k.avgStrength.toFixed(1)} unit="%" icon={Fuel} color="bg-[#B87333]" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {data.tables.dispatchByParty.length > 0 && (
              <div className="bg-white rounded-xl border border-[#E8E8E0] p-4">
                <h3 className="text-sm font-semibold text-[#333330] mb-3 font-heading">Dispatch by Party (BL)</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={data.tables.dispatchByParty.slice(0, 8)} dataKey="qty" nameKey="party" cx="50%" cy="50%"
                      outerRadius={90} label={({ party, qty }: any) => `${party.slice(0, 12)}: ${fmtNum(qty)}`}
                      labelLine={false} fontSize={10}>
                      {data.tables.dispatchByParty.slice(0, 8).map((_: any, i: number) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => `${v.toFixed(0)} BL`} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="bg-white rounded-xl border border-[#E8E8E0] p-4">
              <h3 className="text-sm font-semibold text-[#333330] mb-3 font-heading">Daily Ethanol Dispatch (BL)</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={t.ethanol}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" fontSize={10} tickFormatter={shortDate} />
                  <YAxis fontSize={10} />
                  <Tooltip />
                  <Bar dataKey="dispatch" fill="#22c55e" name="Dispatch BL" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {data.tables.recentDispatches.length > 0 && (
            <div className="bg-white rounded-xl border border-[#E8E8E0] p-4 overflow-x-auto">
              <h3 className="text-sm font-semibold text-[#333330] mb-3 font-heading">Recent Dispatches</h3>
              <table className="w-full text-xs">
                <thead><tr className="border-b text-[#6B6B63]">
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
            <div className="bg-white rounded-xl border border-[#E8E8E0] p-4 overflow-x-auto">
              <h3 className="text-sm font-semibold text-[#333330] mb-3 font-heading">Party-wise Summary</h3>
              <table className="w-full text-xs">
                <thead><tr className="border-b text-[#6B6B63]">
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
      <span className="ml-2 text-[#6B6B63]">Loading fermentation analytics...</span>
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
      <div className="bg-white rounded-xl border border-[#E8E8E0] p-4">
        <h3 className="text-sm font-semibold text-[#333330] mb-3 flex items-center gap-2 font-heading"><Zap size={14} className="text-[#B87333]" /> Plant Pipeline</h3>
        <div className="flex items-center gap-1 overflow-x-auto pb-2">
          <PipelineStep label="Grain In" value={pipe.grainIn.toFixed(0)} unit="T" icon={Wheat} color="bg-amber-600" />
          <PipelineStep label="Consumed" value={pipe.grainConsumed.toFixed(0)} unit="T" icon={Flame} color="bg-orange-600" />
          <PipelineStep label="PF Batches" value={pipe.pfBatchesRun} unit="runs" icon={Beaker} color="bg-[#B87333]" />
          <PipelineStep label="Ferm" value={pipe.fermBatchesRun} unit="batches" icon={FlaskConical} color="bg-emerald-600" />
          <PipelineStep label="Ethanol" value={fmtNum(pipe.ethanolProduced)} unit="BL" icon={Fuel} color="bg-[#B87333]" />
          <PipelineStep label="Dispatched" value={fmtNum(pipe.ethanolDispatched)} unit="BL" icon={Truck} color="bg-green-600" isLast />
        </div>
      </div>

      {/* ─── Fermentation KPIs ─── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Total Batches" value={fk.totalBatches} unit="" icon={FlaskConical} color="bg-[#B87333]" sub={`${fk.completedCount} done, ${fk.activeFermCount} active`} />
        <KPI label="Avg Cycle Time" value={fk.avgCycleTime} unit="hrs" icon={Clock} color="bg-[#B87333]" sub={`PF avg: ${fk.avgPFCycleTime} hrs`} />
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
               <Activity size={16} className="text-[#B87333] mt-0.5 flex-shrink-0" />}
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
              <div key={`pred-${p.batchNo}`} className="bg-white rounded-xl border shadow-sm p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <FlaskConical size={18} className="text-emerald-600" />
                    <span className="font-bold">F-{p.fermenterNo}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full text-white font-medium" style={{ backgroundColor: phaseColors[p.phase] || '#6b7280' }}>{p.phase}</span>
                    <span className="text-xs text-[#6B6B63]">#{p.batchNo}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                  <div>
                    <span className="text-xs text-[#6B6B63]">Current Gravity</span>
                    <p className="font-bold text-lg">{p.currentGravity.toFixed(3)}</p>
                  </div>
                  <div>
                    <span className="text-xs text-[#6B6B63]">Drop Rate</span>
                    <p className="font-bold text-lg">{p.gravityDropRate}/hr</p>
                  </div>
                  <div>
                    <span className="text-xs text-[#6B6B63]">Elapsed</span>
                    <p className="font-medium">{p.hoursElapsed} hrs</p>
                  </div>
                  <div>
                    <span className="text-xs text-[#6B6B63]">Est. Remaining</span>
                    <p className="font-medium">{p.hoursRemaining ? `${p.hoursRemaining} hrs` : '—'}</p>
                  </div>
                  {p.currentTemp && (
                    <div>
                      <span className="text-xs text-[#6B6B63]">Temperature</span>
                      <p className={`font-medium ${p.currentTemp > 37 ? 'text-red-600' : ''}`}>{p.currentTemp}°C</p>
                    </div>
                  )}
                  {p.currentAlcohol && (
                    <div>
                      <span className="text-xs text-[#6B6B63]">Alcohol</span>
                      <p className="font-medium">{p.currentAlcohol}%</p>
                    </div>
                  )}
                </div>
                <div>
                  <span className="text-xs text-[#6B6B63] block mb-1">Health Score</span>
                  <HealthBar score={p.health} />
                </div>
                {p.predictedEndTime && (
                  <p className="text-xs text-[#9C9C94] mt-2">Predicted completion: {new Date(p.predictedEndTime).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ─── Gravity Curves Chart ─── */}
      {gravityChartData.length > 0 && (
        <div className="bg-white rounded-xl border border-[#E8E8E0] p-4">
          <h3 className="text-sm font-semibold text-[#333330] mb-3 font-heading">Gravity Drop Curves (Batch Comparison)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={gravityChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="hour" fontSize={10} label={{ value: 'Hours', position: 'insideBottom', offset: -5, fontSize: 10 }} />
              <YAxis fontSize={10} domain={['auto', 'auto']} label={{ value: 'Gravity', angle: -90, position: 'insideLeft', fontSize: 10 }} />
              <Tooltip />
              <Legend />
              {/* Avg curve — thick dashed */}
              <Line type="monotone" dataKey="avgGravity" stroke="#6b7280" strokeWidth={3} strokeDasharray="8 4" dot={false} name="Avg (historical)" />
              {/* Per-batch curves */}
              {gravityCurves.map((c: any, i: number) => (
                <Line key={c.batchNo} type="monotone" dataKey={`b${c.batchNo}`}
                  stroke={FERM_COLORS[i % FERM_COLORS.length]} strokeWidth={c.phase !== 'DONE' ? 2.5 : 1.5}
                  dot={c.phase !== 'DONE'} name={`#${c.batchNo} F-${c.fermenterNo}`}
                  opacity={c.phase !== 'DONE' ? 1 : 0.5} />
              ))}
              <ReferenceLine y={1.000} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'Target', fontSize: 9 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ─── Alcohol Build-up Chart ─── */}
      {alcoholChartData.some((d: any) => Object.keys(d).length > 1) && (
        <div className="bg-white rounded-xl border border-[#E8E8E0] p-4">
          <h3 className="text-sm font-semibold text-[#333330] mb-3 font-heading">Alcohol Build-up Over Time</h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={alcoholChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="hour" fontSize={10} />
              <YAxis fontSize={10} label={{ value: 'Alcohol %', angle: -90, position: 'insideLeft', fontSize: 10 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="avgAlcohol" stroke="#6b7280" strokeWidth={3} strokeDasharray="8 4" dot={false} name="Avg" />
              {gravityCurves.map((c: any, i: number) => (
                <Line key={c.batchNo} type="monotone" dataKey={`b${c.batchNo}`}
                  stroke={FERM_COLORS[i % FERM_COLORS.length]} strokeWidth={1.5} dot={false}
                  name={`#${c.batchNo}`} opacity={c.phase !== 'DONE' ? 1 : 0.6} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ─── Temperature Monitoring ─── */}
      {tempChartData.some((d: any) => Object.keys(d).length > 1) && (
        <div className="bg-white rounded-xl border border-[#E8E8E0] p-4">
          <h3 className="text-sm font-semibold text-[#333330] mb-3 font-heading">Temperature Monitoring</h3>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={tempChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="hour" fontSize={10} />
              <YAxis fontSize={10} domain={[25, 42]} />
              <Tooltip />
              <Legend />
              <ReferenceArea y1={37} y2={42} fill="#fecaca" fillOpacity={0.3} />
              <ReferenceLine y={37} stroke="#ef4444" strokeDasharray="4 4" label={{ value: '37°C limit', fontSize: 9, fill: '#ef4444' }} />
              <Line type="monotone" dataKey="avgTemp" stroke="#6b7280" strokeWidth={3} strokeDasharray="8 4" dot={false} name="Avg" />
              {gravityCurves.map((c: any, i: number) => (
                <Line key={c.batchNo} type="monotone" dataKey={`b${c.batchNo}`}
                  stroke={FERM_COLORS[i % FERM_COLORS.length]} strokeWidth={1.5} dot={false}
                  name={`#${c.batchNo}`} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ─── Batch Comparison Table ─── */}
      {data.batchComparison && data.batchComparison.length > 0 && (
        <div className="bg-white rounded-xl border border-[#E8E8E0] p-4 overflow-x-auto">
          <h3 className="text-sm font-semibold text-[#333330] mb-3 font-heading">Batch Comparison</h3>
          <table className="w-full text-xs">
            <thead><tr className="border-b text-[#6B6B63]">
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
          <div className="bg-white rounded-xl border border-[#E8E8E0] p-4">
            <h3 className="text-sm font-semibold text-[#333330] mb-3 font-heading">Chemical Consumption</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.chemicalSummary.slice(0, 8)} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" fontSize={10} />
                <YAxis dataKey="name" type="category" fontSize={10} width={80} />
                <Tooltip formatter={(v: number, name: string) => [v.toFixed(1), name === 'total' ? 'Total' : 'Avg/batch']} />
                <Bar dataKey="total" fill="#f59e0b" name="Total" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white rounded-xl border border-[#E8E8E0] p-4 overflow-x-auto">
            <h3 className="text-sm font-semibold text-[#333330] mb-3 font-heading">Chemical Details</h3>
            <table className="w-full text-xs">
              <thead><tr className="border-b text-[#6B6B63]">
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
        <div className="bg-white rounded-xl border border-[#E8E8E0] p-4">
          <h3 className="text-sm font-semibold text-[#333330] mb-3 font-heading">Daily Fermentation Activity</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.fermActivity}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" fontSize={10} tickFormatter={shortDate} />
              <YAxis fontSize={10} />
              <Tooltip />
              <Legend />
              <Bar dataKey="started" fill="#6366f1" name="Batches Started" radius={[4, 4, 0, 0]} />
              <Bar dataKey="completed" fill="#22c55e" name="Batches Completed" radius={[4, 4, 0, 0]} />
              <Bar dataKey="readings" fill="#f59e0b" name="Lab Readings" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ─── PF Analytics Table ─── */}
      {data.pfAnalytics && data.pfAnalytics.length > 0 && (
        <div className="bg-white rounded-xl border border-[#E8E8E0] p-4 overflow-x-auto">
          <h3 className="text-sm font-semibold text-[#333330] mb-3 font-heading">Pre-Fermenter History</h3>
          <table className="w-full text-xs">
            <thead><tr className="border-b text-[#6B6B63]">
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
