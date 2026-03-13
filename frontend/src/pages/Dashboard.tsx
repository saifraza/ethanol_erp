import { useEffect, useState, useMemo } from 'react';
import api from '../services/api';
import {
  Wheat, Droplets, Fuel, Truck, Package, Factory, Beaker, Flame,
  TrendingUp, TrendingDown, BarChart3, Filter, RefreshCw, AlertTriangle,
  Activity, ThermometerSun, Share2
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, Legend, BarChart, Bar, PieChart, Pie, Cell
} from 'recharts';

const PERIOD_OPTIONS = [
  { label: 'Today', days: 1 },
  { label: '7 Days', days: 7 },
  { label: '15 Days', days: 15 },
  { label: '30 Days', days: 30 },
  { label: '90 Days', days: 90 },
];

const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

const phaseColors: Record<string, string> = {
  FILLING: '#6366f1', SETUP: '#f59e0b', DOSING: '#f59e0b', REACTION: '#22c55e',
  LAB: '#3b82f6', RETENTION: '#06b6d4', TRANSFER: '#3b82f6', CIP: '#a855f7', DONE: '#6b7280',
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
    <div className="bg-white rounded-lg border shadow-sm p-3">
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

const fmtNum = (n: number, d = 1) => n >= 100000 ? (n / 100000).toFixed(d) + ' L' : n >= 1000 ? (n / 1000).toFixed(d) + ' K' : n.toFixed(d);
const shortDate = (d: string) => {
  const p = d.split('-');
  return `${p[2]}/${p[1]}`;
};

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);
  const [activeTab, setActiveTab] = useState<'overview' | 'production' | 'quality' | 'dispatch'>('overview');

  const fetchData = (d: number) => {
    setLoading(true);
    api.get(`/dashboard/analytics?days=${d}`).then(r => { setData(r.data); setLoading(false); }).catch(() => setLoading(false));
  };

  useEffect(() => { fetchData(days); }, [days]);

  const handleShare = () => {
    if (!data) return;
    const k = data.kpis;
    const t = `*PLANT DASHBOARD — ${data.period.days} Day Summary*\n${data.period.from} to ${data.period.to}\n\n*Grain*\nUnloaded: ${k.grainUnloaded.toFixed(0)} T\nConsumed: ${k.grainConsumed.toFixed(0)} T\nSilo Stock: ${k.siloStock.toFixed(0)} T\n\n*Ethanol*\nProduction: ${fmtNum(k.ethanolProductionBL)} BL (${fmtNum(k.ethanolProductionAL)} AL)\nCurrent Stock: ${fmtNum(k.ethanolStock)} BL\nDispatched: ${fmtNum(k.totalDispatchBL)} BL (${k.dispatchTrucks} trucks)\nKLPD: ${k.latestKlpd.toFixed(1)}\n\n*DDGS*\nProduced: ${k.ddgsProduced.toFixed(0)} Kg\nDispatched: ${k.ddgsDispatched.toFixed(0)} Kg\n\n*Quality*\nAvg Ethanol: ${k.avgEthanolStrength.toFixed(1)}%\nRaw Moisture: ${k.avgMoisture.toFixed(1)}%\nRaw Starch: ${k.avgStarch.toFixed(1)}%`;
    if (navigator.share) { navigator.share({ text: t }).catch(() => {}); }
    else { window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(t)}`, '_blank'); }
  };

  if (loading && !data) return (
    <div className="flex items-center justify-center h-64">
      <RefreshCw className="animate-spin text-blue-500" size={24} />
    </div>
  );

  if (!data) return <div className="p-8 text-center text-gray-500">Failed to load dashboard</div>;

  const k = data.kpis;
  const t = data.trends;

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
          <button onClick={() => fetchData(days)} className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 transition" title="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={handleShare} className="p-1.5 rounded-lg bg-green-100 hover:bg-green-200 transition text-green-700" title="Share">
            <Share2 size={14} />
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 overflow-x-auto">
        {(['overview', 'production', 'quality', 'dispatch'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-md text-xs font-medium transition whitespace-nowrap ${activeTab === tab ? 'bg-white shadow text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}>
            {tab === 'overview' ? 'Overview' : tab === 'production' ? 'Production' : tab === 'quality' ? 'Quality' : 'Dispatch'}
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
            <KPI label="Ethanol Prod" value={fmtNum(k.ethanolProductionBL)} unit="BL" icon={Fuel} color="bg-blue-600" sub={`AL: ${fmtNum(k.ethanolProductionAL)}`} />
            <KPI label="Current Stock" value={fmtNum(k.ethanolStock)} unit="BL" icon={Droplets} color="bg-cyan-600" sub={`Avg: ${k.avgStrength.toFixed(1)}%`} />
            <KPI label="Dispatched" value={fmtNum(k.totalDispatchBL)} unit="BL" icon={Truck} color="bg-green-600" sub={`${k.dispatchTrucks} trucks`} />
            <KPI label="KLPD" value={k.latestKlpd.toFixed(1)} unit="" icon={TrendingUp} color="bg-indigo-600" sub="Latest flow rate" />
          </div>

          {/* Two charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Ethanol Production Trend */}
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Ethanol Production (BL)</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={t.ethanol}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" fontSize={10} tickFormatter={shortDate} />
                  <YAxis fontSize={10} />
                  <Tooltip formatter={(v: number) => v.toFixed(0)} labelFormatter={(l: string) => `Date: ${l}`} />
                  <Bar dataKey="productionBL" fill="#3b82f6" name="Production BL" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Grain Trend */}
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Grain Stock (Ton)</h3>
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
        </>
      )}

      {/* ═══ PRODUCTION TAB ═══ */}
      {activeTab === 'production' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPI label="Wash Distilled" value={k.washDistilled.toFixed(0)} unit="KL" icon={Flame} color="bg-orange-600" />
            <KPI label="Ethanol (AL)" value={fmtNum(k.ethanolProductionAL)} unit="AL" icon={Fuel} color="bg-blue-600" />
            <KPI label="Grain Consumed" value={k.grainConsumed.toFixed(0)} unit="T" icon={Wheat} color="bg-amber-600" />
            <KPI label="DDGS Produced" value={(k.ddgsProduced / 1000).toFixed(1)} unit="T" icon={Package} color="bg-green-700" sub={`Dispatched: ${(k.ddgsDispatched / 1000).toFixed(1)} T`} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Ethanol KLPD trend */}
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">KLPD Trend</h3>
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

            {/* Grain unloaded vs consumed */}
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Grain: Unloaded vs Consumed</h3>
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

            {/* DDGS trend */}
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">DDGS Production & Dispatch</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={t.ddgs}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" fontSize={10} tickFormatter={shortDate} />
                  <YAxis fontSize={10} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="produced" fill="#22c55e" name="Produced" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="dispatched" fill="#3b82f6" name="Dispatched" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Ethanol stock trend */}
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Ethanol Stock (BL)</h3>
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
            <KPI label="Avg Ethanol Strength" value={k.avgEthanolStrength.toFixed(1)} unit="%" icon={Droplets} color="bg-blue-600" />
            <KPI label="Avg Moisture" value={k.avgMoisture.toFixed(1)} unit="%" icon={Wheat} color="bg-amber-500" sub={`${data.tables.rawMaterial.length} samples`} />
            <KPI label="Avg Starch" value={k.avgStarch.toFixed(1)} unit="%" icon={Wheat} color="bg-green-600" />
            <KPI label="Avg Strength" value={k.avgStrength.toFixed(1)} unit="%" icon={Fuel} color="bg-indigo-600" sub="Weighted avg" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Distillation strength trend */}
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Distillation Strength</h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={t.distillation}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" fontSize={10} tickFormatter={shortDate} />
                  <YAxis fontSize={10} domain={['auto', 'auto']} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="ethanolStrength" stroke="#3b82f6" dot={false} strokeWidth={2} name="Ethanol %" />
                  <Line type="monotone" dataKey="rcReflexStrength" stroke="#f59e0b" dot={false} strokeWidth={2} name="RC Reflex %" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Liquefaction gravity */}
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Liquefaction Gravity</h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={t.liquefaction}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" fontSize={10} tickFormatter={shortDate} />
                  <YAxis fontSize={10} domain={['auto', 'auto']} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="iltGravity" stroke="#3b82f6" dot={false} strokeWidth={2} name="ILT" />
                  <Line type="monotone" dataKey="fltGravity" stroke="#22c55e" dot={false} strokeWidth={2} name="FLT" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Liquefaction pH */}
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Liquefaction pH</h3>
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

            {/* Milling sieve trend */}
            {t.milling.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Milling Sieve Analysis</h3>
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
                    <Line type="monotone" dataKey="sieve300" stroke="#3b82f6" dot={false} name="0.300mm" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Raw material table */}
          {data.tables.rawMaterial.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border p-4 overflow-x-auto">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Recent Raw Material</h3>
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
            {/* Dispatch by party pie */}
            {data.tables.dispatchByParty.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Dispatch by Party (BL)</h3>
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

            {/* Daily dispatch trend */}
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Daily Ethanol Dispatch (BL)</h3>
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

          {/* Dispatch table */}
          {data.tables.recentDispatches.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border p-4 overflow-x-auto">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Recent Dispatches</h3>
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

          {/* Party summary table */}
          {data.tables.dispatchByParty.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border p-4 overflow-x-auto">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Party-wise Summary</h3>
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
