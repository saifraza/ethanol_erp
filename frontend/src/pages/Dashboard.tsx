import { useEffect, useState } from 'react';
import api from '../services/api';
import { BarChart3, Droplets, Flame, Wheat, TrendingUp, Package, Factory, Beaker, AlertTriangle, ThermometerSun } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, AreaChart, Area, Legend } from 'recharts';

function KPI({ label, value, unit, icon: Icon, color, sub }: any) {
  return (
    <div className="bg-white rounded-lg shadow p-3 md:p-4 flex items-center gap-3 md:gap-4">
      <div className={`p-2 md:p-3 rounded-lg ${color}`}><Icon size={20} className="text-white" /></div>
      <div className="min-w-0">
        <p className="text-[11px] md:text-xs text-gray-500 truncate">{label}</p>
        <p className="text-lg md:text-xl font-bold">{value ?? '—'} <span className="text-xs md:text-sm font-normal text-gray-400">{unit}</span></p>
        {sub && <p className="text-[10px] md:text-xs text-gray-400 mt-0.5 truncate">{sub}</p>}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [ferm, setFerm] = useState<any[]>([]);
  const [liq, setLiq] = useState<any[]>([]);
  const [dist, setDist] = useState<any[]>([]);
  const [raw, setRaw] = useState<any[]>([]);
  const [anomalies, setAnomalies] = useState<any[]>([]);
  const [grain, setGrain] = useState<any>(null);

  useEffect(() => {
    api.get('/fermentation').then(r => setFerm(r.data)).catch(() => {});
    api.get('/liquefaction').then(r => setLiq(r.data)).catch(() => {});
    api.get('/distillation').then(r => setDist(r.data)).catch(() => {});
    api.get('/raw-material').then(r => setRaw(r.data)).catch(() => {});
    api.get('/grain/summary').then(r => setGrain(r.data)).catch(() => {});
    // Check anomalies for all 4 fermenters
    [1,2,3,4].forEach(f => {
      api.get(`/fermentation/anomaly/${f}`).then(r => {
        if (r.data.anomalies?.length > 0) {
          setAnomalies(prev => [...prev, ...r.data.anomalies.map((a: any) => ({ ...a, fermenter: f }))]);
        }
      }).catch(() => {});
    });
  }, []);

  // Compute KPIs
  const latestFerm = ferm.slice(0, 4);
  const avgGravity = latestFerm.filter(e => e.spGravity).length > 0
    ? (latestFerm.filter(e => e.spGravity).reduce((a, e) => a + e.spGravity, 0) / latestFerm.filter(e => e.spGravity).length).toFixed(3)
    : null;
  const avgTemp = latestFerm.filter(e => e.temp).length > 0
    ? (latestFerm.filter(e => e.temp).reduce((a, e) => a + e.temp, 0) / latestFerm.filter(e => e.temp).length).toFixed(1)
    : null;
  const latestEthanol = dist.length > 0 ? dist[0].ethanolStrength : null;
  const avgMoisture = raw.length > 0
    ? (raw.reduce((a: number, e: any) => a + e.moisture, 0) / raw.length).toFixed(1)
    : null;
  const avgStarch = raw.length > 0
    ? (raw.reduce((a: number, e: any) => a + e.starch, 0) / raw.length).toFixed(1)
    : null;

  // Chart data: fermentation gravity trend (last 50 entries grouped by fermenter)
  const fermChart = ferm.slice(0, 80).filter(e => e.spGravity).reverse().map(e => ({
    time: `${new Date(e.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} ${e.analysisTime || ''}`.trim(),
    [`F${e.fermenterNo}`]: e.spGravity,
    temp: e.temp,
  }));

  // Distillation trend
  const distChart = dist.slice(0, 30).reverse().map(e => ({
    date: new Date(e.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
    ethanol: e.ethanolStrength,
    rcReflex: e.rcReflexStrength,
  }));

  // Liquefaction trend
  const liqChart = liq.slice(0, 30).reverse().map(e => ({
    date: new Date(e.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
    iltGravity: e.iltSpGravity,
    fltGravity: e.fltSpGravity,
    iltPh: e.iltPh,
    fltPh: e.fltPh,
  }));

  const criticalAnomalies = anomalies.filter(a => a.deviation === 'CRITICAL');

  return (
    <div className="space-y-6">
      <h1 className="text-xl md:text-2xl font-bold">Dashboard</h1>

      {/* Anomaly Alerts */}
      {criticalAnomalies.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-3">
          <AlertTriangle className="text-red-500 mt-0.5" size={20} />
          <div>
            <div className="font-semibold text-red-700 text-sm">Critical Anomalies Detected</div>
            {criticalAnomalies.slice(0, 3).map((a, i) => (
              <div key={i} className="text-xs text-red-600 mt-1">
                F{a.fermenter}: {a.field} = {a.value} (expected {a.expected}) at {a.time}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPI label="Avg Gravity" value={avgGravity} unit="" icon={Beaker} color="bg-purple-500" sub="Latest fermenters" />
        <KPI label="Avg Ferm Temp" value={avgTemp} unit="°C" icon={ThermometerSun} color="bg-red-500" sub="Latest readings" />
        <KPI label="Ethanol Strength" value={latestEthanol?.toFixed(1)} unit="%" icon={Droplets} color="bg-blue-500" sub="Latest distillation" />
        <KPI label="Raw Avg Moisture" value={avgMoisture} unit="%" icon={Wheat} color="bg-amber-500" sub={`${raw.length} vehicles`} />
        <KPI label="Raw Avg Starch" value={avgStarch} unit="%" icon={Wheat} color="bg-green-600" sub={`${raw.length} vehicles`} />
        <KPI label="Grain in Silo" value={grain?.currentSiloStock?.toFixed(0)} unit="Ton" icon={Factory} color="bg-amber-700" />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-sm font-semibold mb-2">Fermentation Gravity Trend</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={fermChart}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" fontSize={10} angle={-30} textAnchor="end" height={50} />
              <YAxis fontSize={11} domain={['auto', 'auto']} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="F1" stroke="#3b82f6" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="F2" stroke="#22c55e" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="F3" stroke="#f59e0b" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="F4" stroke="#ef4444" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-sm font-semibold mb-2">Distillation Trend</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={distChart}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="ethanol" stroke="#3b82f6" name="Ethanol %" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="rcReflex" stroke="#f59e0b" name="RC Reflex %" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-sm font-semibold mb-2">Liquefaction Gravity (ILT vs FLT)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={liqChart}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip />
              <Legend />
              <Area type="monotone" dataKey="iltGravity" stroke="#3b82f6" fill="#93c5fd" fillOpacity={0.3} name="ILT Gravity" />
              <Area type="monotone" dataKey="fltGravity" stroke="#22c55e" fill="#86efac" fillOpacity={0.3} name="FLT Gravity" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {grain?.recentTrend?.length > 0 && (
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-sm font-semibold mb-2">Grain Silo Stock Trend</h3>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={grain.recentTrend.map((e: any) => ({ ...e, date: e.date.split('T')[0].slice(5) }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Area type="monotone" dataKey="siloClosingStock" stroke="#d97706" fill="#fbbf24" fillOpacity={0.3} name="Silo Stock (Ton)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Fermenter Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[1,2,3,4].map(fn => {
          const latest = ferm.find(e => e.fermenterNo === fn);
          const fermAnomalies = anomalies.filter(a => a.fermenter === fn);
          return (
            <div key={fn} className={`bg-white rounded-lg shadow p-3 border-l-4 ${fermAnomalies.length > 0 ? 'border-red-500' : 'border-green-500'}`}>
              <div className="flex justify-between items-center">
                <span className="font-semibold text-sm">Fermenter {fn}</span>
                <span className={`text-xs px-2 py-0.5 rounded ${fermAnomalies.length > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                  {fermAnomalies.length > 0 ? `${fermAnomalies.length} alerts` : 'Normal'}
                </span>
              </div>
              {latest && (
                <div className="mt-2 text-xs text-gray-600 space-y-0.5">
                  <div>Batch: <span className="font-medium">{latest.batchNo}</span> | Status: <span className="font-medium">{latest.status}</span></div>
                  <div>Gravity: <span className="font-medium">{latest.spGravity ?? '-'}</span> | Temp: <span className="font-medium">{latest.temp ?? '-'}°C</span></div>
                  <div>Alcohol: <span className="font-medium">{latest.alcohol ?? '-'}%</span> | pH: <span className="font-medium">{latest.ph ?? '-'}</span></div>
                </div>
              )}
              {!latest && <div className="mt-2 text-xs text-gray-400">No data yet</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
