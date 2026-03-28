import React, { useEffect, useState, useMemo } from 'react';
import { CogIcon, Save, Loader2, ChevronDown, ChevronUp, Trash2, TrendingUp, Eye, X, Share2, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import ProcessPage, { InputCard, Field } from './ProcessPage';
import api from '../../services/api';
import {
  ComposedChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ReferenceLine, Brush
} from 'recharts';

interface MillForm {
  date: string;
  analysisTime: string;
  sieve_1mm: number | null; sieve_850: number | null; sieve_600: number | null; sieve_300: number | null;
  millA_rpm: number | null; millA_load: number | null;
  millB_rpm: number | null; millB_load: number | null;
  millC_rpm: number | null; millC_load: number | null;
  remarks: string;
}

const emptyForm: MillForm = {
  date: new Date().toISOString().split('T')[0],
  analysisTime: '',
  sieve_1mm: null, sieve_850: null, sieve_600: null, sieve_300: null,
  millA_rpm: null, millA_load: null,
  millB_rpm: null, millB_load: null,
  millC_rpm: null, millC_load: null,
  remarks: '',
};

function calcTotalFine(s1mm: number | null, s850: number | null, s600: number | null, s300: number | null): number {
  return Math.round((100 - ((s1mm || 0) + (s850 || 0) + (s600 || 0) + (s300 || 0))) * 100) / 100;
}
function calcTotalCoarse(s1mm: number | null, s850: number | null): number {
  return Math.round(((s1mm || 0) + (s850 || 0)) * 100) / 100;
}

// ─── Chart ───────────────────
type ChartView = 'coarse' | 'fine' | 'sieve' | 'rpm' | 'load' | 'particle';
const CHART_VIEWS: { key: ChartView; label: string }[] = [
  { key: 'coarse', label: 'Total Coarse %' },
  { key: 'fine', label: 'Total Fine %' },
  { key: 'sieve', label: 'Sieve Breakdown' },
  { key: 'particle', label: 'Coarse & Fines' },
  { key: 'rpm', label: 'Mill RPM' },
  { key: 'load', label: 'Mill Load' },
];

// ─── Stats & Zoom Helpers ───────────────────
function calcStats(values: number[]): { mean: number; min: number; max: number; range: number; count: number } {
  const filtered = values.filter(v => v != null && !isNaN(v));
  if (filtered.length === 0) return { mean: 0, min: 0, max: 0, range: 0, count: 0 };
  const min = Math.min(...filtered);
  const max = Math.max(...filtered);
  return {
    mean: filtered.reduce((s, v) => s + v, 0) / filtered.length,
    min, max,
    range: max - min,
    count: filtered.length,
  };
}

function StatsStrip({ values }: { values: number[] }) {
  const { mean, min, max, range, count } = calcStats(values);
  const items = [
    { label: 'Mean', value: mean.toFixed(2), color: 'text-indigo-600' },
    { label: 'Min', value: min.toFixed(2), color: 'text-cyan-600' },
    { label: 'Max', value: max.toFixed(2), color: 'text-red-600' },
    { label: 'Range', value: range.toFixed(2), color: 'text-amber-600' },
    { label: 'Samples', value: String(count), color: 'text-slate-600' },
  ];
  return (
    <div className="grid grid-cols-3 md:grid-cols-5 gap-0 border border-slate-300 mb-2">
      {items.map(s => (
        <div key={s.label} className="px-2 py-2 border-r border-slate-200 last:border-r-0">
          <div className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{s.label}</div>
          <div className={`text-sm font-bold font-mono tabular-nums mt-0.5 ${s.color}`}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}

function YZoomControls({ zoom, onZoom, onReset }: { zoom: number; onZoom: (dir: 1 | -1) => void; onReset: () => void }) {
  return (
    <div className="flex items-center gap-1 justify-end mb-1">
      <span className="text-[9px] text-slate-400 uppercase tracking-widest mr-1">Y-Zoom</span>
      <button onClick={() => onZoom(1)} className="p-1 border border-slate-300 bg-white hover:bg-slate-50 text-slate-600" title="Zoom In (Y)">
        <ZoomIn size={13} />
      </button>
      <button onClick={() => onZoom(-1)} className="p-1 border border-slate-300 bg-white hover:bg-slate-50 text-slate-600" title="Zoom Out (Y)">
        <ZoomOut size={13} />
      </button>
      {zoom !== 0 && (
        <button onClick={onReset} className="p-1 border border-slate-300 bg-white hover:bg-slate-50 text-slate-600 flex items-center gap-0.5 px-1.5 text-[10px]" title="Reset Zoom">
          <RotateCcw size={11} /> Reset
        </button>
      )}
    </div>
  );
}

function useYZoom(dataMin: number, dataMax: number, zoom: number): [number, number] {
  return useMemo(() => {
    if (zoom === 0) return [dataMin, dataMax] as [number, number];
    const mid = (dataMin + dataMax) / 2;
    const halfRange = (dataMax - dataMin) / 2;
    const factor = Math.pow(0.75, zoom); // each zoom step narrows by 25%
    const newHalf = Math.max(halfRange * factor, 0.1);
    return [mid - newHalf, mid + newHalf] as [number, number];
  }, [dataMin, dataMax, zoom]);
}

function MillingChartInner({ entries }: { entries: any[] }) {
  const [view, setView] = useState<ChartView>('coarse');
  const [zoomCoarse, setZoomCoarse] = useState(0);
  const [zoomFine, setZoomFine] = useState(0);
  const [zoomSieve, setZoomSieve] = useState(0);
  const [zoomParticle, setZoomParticle] = useState(0);
  const [zoomRpm, setZoomRpm] = useState(0);
  const [zoomLoad, setZoomLoad] = useState(0);

  if (entries.length < 1) return null;

  const chartData = entries.map(e => ({
    date: e.date.split('T')[0].slice(5),
    fullDate: e.date.split('T')[0],
    time: e.analysisTime || '',
    fine: e.totalFine,
    coarse: Math.round(((e.sieve_1mm || 0) + (e.sieve_850 || 0)) * 100) / 100,
    s1mm: e.sieve_1mm, s850: e.sieve_850, s600: e.sieve_600, s300: e.sieve_300,
    aRpm: e.millA_rpm, bRpm: e.millB_rpm, cRpm: e.millC_rpm,
    aLoad: e.millA_load, bLoad: e.millB_load, cLoad: e.millC_load,
  }));

  const avgFine = entries.reduce((s: number, e: any) => s + e.totalFine, 0) / entries.length;

  // Pre-compute value arrays for stats
  const coarseVals = chartData.map(d => d.coarse);
  const fineVals = chartData.map(d => d.fine);
  const allSieveVals = chartData.flatMap(d => [d.s1mm, d.s850, d.s600, d.s300, d.fine].filter(v => v != null && !isNaN(v)));
  const allRpmVals = chartData.flatMap(d => [d.aRpm, d.bRpm, d.cRpm].filter(v => v != null && !isNaN(v)));
  const allLoadVals = chartData.flatMap(d => [d.aLoad, d.bLoad, d.cLoad].filter(v => v != null && !isNaN(v)));

  const tooltipStyle = {
    contentStyle: { fontSize: 12, border: '1px solid #94a3b8', background: '#fff', padding: '8px 12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' },
    labelStyle: { fontWeight: 700, marginBottom: 4, color: '#1e293b' },
    itemStyle: { padding: '1px 0' },
  };

  // Y-zoom domains
  const coarseStats = calcStats(coarseVals);
  const coarseDomain = useYZoom(coarseStats.min * 0.9, coarseStats.max * 1.1, zoomCoarse);
  const fineStats = calcStats(fineVals);
  const fineDomain = useYZoom(fineStats.min * 0.9, fineStats.max * 1.1, zoomFine);
  const sieveStats = calcStats(allSieveVals);
  const sieveDomain = useYZoom(Math.max(0, sieveStats.min * 0.9), sieveStats.max * 1.1, zoomSieve);
  const particleAllVals = [...coarseVals, ...fineVals];
  const particleStats = calcStats(particleAllVals);
  const particleDomain = useYZoom(0, particleStats.max * 1.1, zoomParticle);
  const rpmStats = calcStats(allRpmVals);
  const rpmDomain = useYZoom(rpmStats.min * 0.9, rpmStats.max * 1.1, zoomRpm);
  const loadStats = calcStats(allLoadVals);
  const loadDomain = useYZoom(loadStats.min * 0.9, loadStats.max * 1.1, zoomLoad);

  return (
    <div>
      <div className="flex gap-1 mb-4 bg-slate-100 border border-slate-300 p-1 w-fit">
        {CHART_VIEWS.map(v => (
          <button key={v.key} onClick={() => setView(v.key)}
            className={`px-3 py-1.5 text-[11px] font-medium transition-all ${view === v.key ? 'bg-white text-slate-800 border border-slate-300' : 'text-slate-500 hover:text-slate-700'}`}>
            {v.label}
          </button>
        ))}
      </div>

      {/* Total Coarse % trend (1mm + 0.850mm) */}
      {view === 'coarse' && (() => {
        const avgCoarse = coarseVals.reduce((s, v) => s + v, 0) / coarseVals.length;
        return (
          <>
            <StatsStrip values={coarseVals} />
            <YZoomControls zoom={zoomCoarse} onZoom={d => setZoomCoarse(z => z + d)} onReset={() => setZoomCoarse(0)} />
            <div className="bg-white border border-slate-300 p-3">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Total Coarse % Trend</div>
              <ResponsiveContainer width="100%" height={250}>
                <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
                  <YAxis tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} domain={zoomCoarse !== 0 ? coarseDomain : ['auto', 'auto']} unit="%" />
                  <Tooltip {...tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine y={avgCoarse} stroke="#6b7280" strokeDasharray="5 5" strokeOpacity={0.5} label={{ value: `avg ${avgCoarse.toFixed(1)}%`, fontSize: 10, fill: '#9ca3af' }} />
                  <Line type="monotone" dataKey="coarse" name="Total Coarse %" stroke="#1e40af" strokeWidth={2} dot={{ r: 3, fill: '#1e40af' }} activeDot={{ r: 5 }} />
                  <Line type="monotone" dataKey="s1mm" name="1.00mm" stroke="#dc2626" strokeWidth={2} dot={{ r: 3, fill: '#dc2626' }} strokeDasharray="4 3" />
                  <Line type="monotone" dataKey="s850" name="0.850mm" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: '#f59e0b' }} strokeDasharray="4 3" />
                  {chartData.length > 24 && <Brush dataKey="date" height={20} stroke="#1e40af" />}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </>
        );
      })()}

      {/* Total Fine % trend */}
      {view === 'fine' && (
        <>
          <StatsStrip values={fineVals} />
          <YZoomControls zoom={zoomFine} onZoom={d => setZoomFine(z => z + d)} onReset={() => setZoomFine(0)} />
          <div className="bg-white border border-slate-300 p-3">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Total Fine % Trend</div>
            <ResponsiveContainer width="100%" height={250}>
              <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
                <YAxis tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} domain={zoomFine !== 0 ? fineDomain : ['auto', 'auto']} unit="%" />
                <Tooltip {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={avgFine} stroke="#6b7280" strokeDasharray="5 5" strokeOpacity={0.5} label={{ value: `avg ${avgFine.toFixed(1)}%`, fontSize: 10, fill: '#9ca3af' }} />
                <Line type="monotone" dataKey="fine" name="Total Fine %" stroke="#1e40af" strokeWidth={2} dot={{ r: 3, fill: '#1e40af' }} activeDot={{ r: 5 }} />
                {chartData.length > 24 && <Brush dataKey="date" height={20} stroke="#1e40af" />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* Sieve breakdown — line chart per fraction */}
      {view === 'sieve' && (
        <>
          <StatsStrip values={chartData.map(d => d.s600).filter(v => v != null)} />
          <YZoomControls zoom={zoomSieve} onZoom={d => setZoomSieve(z => z + d)} onReset={() => setZoomSieve(0)} />
          <div className="bg-white border border-slate-300 p-3">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Sieve Breakdown (stats: 0.600mm)</div>
            <ResponsiveContainer width="100%" height={250}>
              <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
                <YAxis tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} domain={zoomSieve !== 0 ? sieveDomain : ['auto', 'auto']} unit="%" />
                <Tooltip {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="s600" name="0.600mm" stroke="#1e40af" strokeWidth={2} dot={{ r: 3, fill: '#1e40af' }} />
                <Line type="monotone" dataKey="fine" name="Fine (<0.3mm)" stroke="#0891b2" strokeWidth={2} dot={{ r: 3, fill: '#0891b2' }} />
                <Line type="monotone" dataKey="s300" name="0.300mm" stroke="#10b981" strokeWidth={2} dot={{ r: 3, fill: '#10b981' }} />
                <Line type="monotone" dataKey="s850" name="0.850mm" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: '#f59e0b' }} strokeDasharray="4 3" />
                <Line type="monotone" dataKey="s1mm" name="1.00mm" stroke="#dc2626" strokeWidth={2} dot={{ r: 3, fill: '#dc2626' }} strokeDasharray="4 3" />
                {chartData.length > 24 && <Brush dataKey="date" height={20} stroke="#1e40af" />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* Coarse & Fines — Bar histogram */}
      {view === 'particle' && (
        <>
          <StatsStrip values={coarseVals} />
          <YZoomControls zoom={zoomParticle} onZoom={d => setZoomParticle(z => z + d)} onReset={() => setZoomParticle(0)} />
          <div className="bg-white border border-slate-300 p-3">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Coarse & Fines Distribution (stats: Coarse)</div>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
                <YAxis tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} domain={zoomParticle !== 0 ? particleDomain : [0, 'auto']} unit="%" />
                <Tooltip {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="coarse" name="Coarse (>0.85mm)" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                <Bar dataKey="fine" name="Fines (<0.3mm)" fill="#0891b2" radius={[3, 3, 0, 0]} />
                {chartData.length > 24 && <Brush dataKey="date" height={20} stroke="#1e40af" />}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* RPM per mill */}
      {view === 'rpm' && (
        <>
          <StatsStrip values={allRpmVals} />
          <YZoomControls zoom={zoomRpm} onZoom={d => setZoomRpm(z => z + d)} onReset={() => setZoomRpm(0)} />
          <div className="bg-white border border-slate-300 p-3">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Mill RPM (stats: all mills)</div>
            <ResponsiveContainer width="100%" height={250}>
              <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
                <YAxis tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} domain={zoomRpm !== 0 ? rpmDomain : ['auto', 'auto']} unit=" rpm" />
                <Tooltip {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="aRpm" name="Mill A" stroke="#1e40af" strokeWidth={2} dot={{ r: 3, fill: '#1e40af' }} />
                <Line type="monotone" dataKey="bRpm" name="Mill B" stroke="#10b981" strokeWidth={2} dot={{ r: 3, fill: '#10b981' }} />
                <Line type="monotone" dataKey="cRpm" name="Mill C" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: '#f59e0b' }} />
                {chartData.length > 24 && <Brush dataKey="date" height={20} stroke="#1e40af" />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* Load per mill */}
      {view === 'load' && (
        <>
          <StatsStrip values={allLoadVals} />
          <YZoomControls zoom={zoomLoad} onZoom={d => setZoomLoad(z => z + d)} onReset={() => setZoomLoad(0)} />
          <div className="bg-white border border-slate-300 p-3">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Mill Load (stats: all mills)</div>
            <ResponsiveContainer width="100%" height={250}>
              <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
                <YAxis tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} domain={zoomLoad !== 0 ? loadDomain : ['auto', 'auto']} unit=" A" />
                <Tooltip {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="aLoad" name="Mill A" stroke="#1e40af" strokeWidth={2} dot={{ r: 3, fill: '#1e40af' }} />
                <Line type="monotone" dataKey="bLoad" name="Mill B" stroke="#10b981" strokeWidth={2} dot={{ r: 3, fill: '#10b981' }} />
                <Line type="monotone" dataKey="cLoad" name="Mill C" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: '#f59e0b' }} />
                {chartData.length > 24 && <Brush dataKey="date" height={20} stroke="#1e40af" />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────
export default function Milling() {
  const [form, setForm] = useState<MillForm>({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [entries, setEntries] = useState<any[]>([]);
  const [chartEntries, setChartEntries] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showChart, setShowChart] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const update = (n: string, v: any) => setForm(f => ({ ...f, [n]: v }));

  useEffect(() => { loadEntries(); loadChartData(); }, []);

  async function loadEntries() {
    try { const res = await api.get('/milling?limit=500'); setEntries(res.data.entries); } catch (e) { console.error(e); }
  }
  async function loadChartData() {
    try { const res = await api.get('/milling/chart?limit=500'); setChartEntries(res.data.entries); } catch (e) { console.error(e); }
  }

  function buildReportText(): string {
    return `*MILLING REPORT*\nDate: ${form.date} ${form.analysisTime || ''}\n\n*Sieve Analysis*\n1.00mm: ${form.sieve_1mm ?? '—'}%\n0.850mm: ${form.sieve_850 ?? '—'}%\n0.600mm: ${form.sieve_600 ?? '—'}%\n0.300mm: ${form.sieve_300 ?? '—'}%\nTotal Fine: ${totalFine}%\n\n*Mill RPM / Load*\nMill A: ${form.millA_rpm ?? '—'} rpm / ${form.millA_load ?? '—'} A\nMill B: ${form.millB_rpm ?? '—'} rpm / ${form.millB_load ?? '—'} A\nMill C: ${form.millC_rpm ?? '—'} rpm / ${form.millC_load ?? '—'} A${form.remarks ? '\n\nRemarks: ' + form.remarks : ''}`;
  }

  async function handleSave(share = false) {
    if (!form.date) { setMsg({ type: 'err', text: 'Date is required' }); return; }
    setSaving(true); setMsg(null);
    try {
      if (editId) { await api.put(`/milling/${editId}`, form); }
      else { await api.post('/milling', form); }
      const now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

      if (share) {
        try {
          const text = buildReportText();
          await api.post('/telegram/send-report', { message: text, module: 'milling' });
          setMsg({ type: 'ok', text: `Saved at ${now} and shared via Telegram` });
        } catch (shareErr: any) {
          const errMsg = shareErr.response?.data?.error || 'Sharing failed';
          setMsg({ type: 'err', text: `Saved at ${now}, but ${errMsg}` });
        }
      } else {
        setMsg({ type: 'ok', text: `Saved at ${now}` });
      }

      setForm({ ...emptyForm, date: form.date });
      setEditId(null);
      await loadEntries(); await loadChartData();
    } catch (err: any) {
      const isNetwork = !err.response;
      setMsg({ type: 'err', text: isNetwork ? 'Server unreachable — your data is safe in the form, try again in a moment' : (err.response?.data?.error || 'Save failed') });
    }
    setSaving(false);
  }

  function editEntry(e: any) {
    setEditId(e.id);
    setForm({
      date: e.date.split('T')[0], analysisTime: e.analysisTime || '',
      sieve_1mm: e.sieve_1mm, sieve_850: e.sieve_850, sieve_600: e.sieve_600, sieve_300: e.sieve_300,
      millA_rpm: e.millA_rpm, millA_load: e.millA_load,
      millB_rpm: e.millB_rpm, millB_load: e.millB_load,
      millC_rpm: e.millC_rpm, millC_load: e.millC_load,
      remarks: e.remarks || '',
    });
    window.scrollTo(0, 0);
  }

  async function deleteEntry(id: string) {
    if (!confirm('Delete this milling entry?')) return;
    try { await api.delete(`/milling/${id}`); await loadEntries(); await loadChartData(); setMsg({ type: 'ok', text: 'Deleted.' }); }
    catch (err: any) { setMsg({ type: 'err', text: err.response?.data?.error || 'Delete failed' }); }
  }

  function fmtTime(iso: string) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
  }

  const totalFine = calcTotalFine(form.sieve_1mm, form.sieve_850, form.sieve_600, form.sieve_300);
  const totalCoarse = calcTotalCoarse(form.sieve_1mm, form.sieve_850);

  return (
    <ProcessPage title="Milling" icon={<CogIcon size={28} />} description="Grain milling analysis — sieve distribution, RPM & load for Mill A, B, C" flow={{ from: 'Grain Silo', to: 'Slurry Tank' }} color="bg-stone-600">

      {msg && (
        <div className={`rounded-lg p-3 mb-4 text-sm ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {msg.text}
        </div>
      )}

      {/* Trend Charts */}
      {chartEntries.length > 0 && (
        <div className="card mb-6">
          <button onClick={() => setShowChart(!showChart)} className="flex items-center justify-between w-full text-left">
            <div className="flex items-center gap-2">
              <TrendingUp size={18} className="text-stone-600" />
              <h3 className="section-title mb-0">Trend Analysis</h3>
              <span className="text-xs text-gray-400">({chartEntries.length} entries)</span>
            </div>
            {showChart ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {showChart && <div className="mt-3"><MillingChartInner entries={chartEntries} /></div>}
        </div>
      )}

      <InputCard title={editId ? '✏️ Edit Entry' : '📝 New Entry'}>
        <Field label="Date" name="date" value={form.date} onChange={(_n: string, v: any) => update('date', v)} unit="" />
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 w-52 shrink-0">Analysis Time</label>
          <input type="time" value={form.analysisTime} onChange={e => update('analysisTime', e.target.value)} className="input-field flex-1" />
          <button type="button" onClick={() => { const now = new Date(); update('analysisTime', now.toTimeString().slice(0,5)); }} className="px-3 py-2 text-xs font-medium bg-stone-100 hover:bg-stone-200 text-stone-600 rounded-lg border border-stone-300 whitespace-nowrap transition-colors">Now</button>
        </div>
      </InputCard>

      {/* Single sieve analysis — mixed flour */}
      <InputCard title="Sieve Analysis — Mixed Flour">
        <Field label="1.00 mm" name="sieve_1mm" value={form.sieve_1mm} onChange={update} unit="%" placeholder="Retained on 1.00mm" />
        <Field label="0.850 mm" name="sieve_850" value={form.sieve_850} onChange={update} unit="%" placeholder="Retained on 0.850mm" />
        <Field label="0.600 mm" name="sieve_600" value={form.sieve_600} onChange={update} unit="%" placeholder="Retained on 0.600mm" />
        <Field label="0.300 mm" name="sieve_300" value={form.sieve_300} onChange={update} unit="%" placeholder="Passing 0.300mm" />
        {/* Summary row */}
        <div className="grid grid-cols-2 gap-3 mt-2 pt-3 border-t border-dashed border-gray-200">
          <div className="flex items-center justify-between bg-orange-50 border border-orange-200 rounded-lg px-4 py-2.5">
            <div>
              <p className="text-[10px] text-orange-500 font-semibold uppercase tracking-wide">Total Coarse</p>
              <p className="text-xs text-gray-400">&gt;0.85mm (1mm + 850µm)</p>
            </div>
            <p className="text-2xl font-bold text-orange-600">{totalCoarse}<span className="text-sm font-normal ml-0.5">%</span></p>
          </div>
          <div className="flex items-center justify-between bg-purple-50 border border-purple-200 rounded-lg px-4 py-2.5">
            <div>
              <p className="text-[10px] text-purple-500 font-semibold uppercase tracking-wide">Total Fine</p>
              <p className="text-xs text-gray-400">&lt;0.3mm (passing 300µm)</p>
            </div>
            <p className="text-2xl font-bold text-purple-600">{totalFine}<span className="text-sm font-normal ml-0.5">%</span></p>
          </div>
        </div>
      </InputCard>

      {/* Per-mill RPM & Load in one card */}
      <InputCard title="Mill RPM & Load">
        {/* Header row */}
        <div className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-3 mb-2 text-xs text-gray-400 font-medium">
          <div></div>
          <div className="text-center font-semibold text-blue-600 text-sm">Mill A</div>
          <div className="text-center font-semibold text-green-600 text-sm">Mill B</div>
          <div className="text-center font-semibold text-amber-600 text-sm">Mill C</div>
        </div>
        {/* RPM row */}
        <div className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-3 items-center mb-2">
          <label className="text-sm text-gray-600">RPM <span className="text-xs text-gray-400">(rpm)</span></label>
          <input type="number" value={form.millA_rpm ?? ''} onChange={e => update('millA_rpm', e.target.value === '' ? null : parseFloat(e.target.value))} className="input-field text-center" placeholder="A" />
          <input type="number" value={form.millB_rpm ?? ''} onChange={e => update('millB_rpm', e.target.value === '' ? null : parseFloat(e.target.value))} className="input-field text-center" placeholder="B" />
          <input type="number" value={form.millC_rpm ?? ''} onChange={e => update('millC_rpm', e.target.value === '' ? null : parseFloat(e.target.value))} className="input-field text-center" placeholder="C" />
        </div>
        {/* Load row */}
        <div className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-3 items-center">
          <label className="text-sm text-gray-600">Load <span className="text-xs text-gray-400">(Amp)</span></label>
          <input type="number" value={form.millA_load ?? ''} onChange={e => update('millA_load', e.target.value === '' ? null : parseFloat(e.target.value))} className="input-field text-center" placeholder="A" />
          <input type="number" value={form.millB_load ?? ''} onChange={e => update('millB_load', e.target.value === '' ? null : parseFloat(e.target.value))} className="input-field text-center" placeholder="B" />
          <input type="number" value={form.millC_load ?? ''} onChange={e => update('millC_load', e.target.value === '' ? null : parseFloat(e.target.value))} className="input-field text-center" placeholder="C" />
        </div>
      </InputCard>

      <InputCard title="Remarks (Optional)">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 w-52 shrink-0">Remarks</label>
          <input type="text" value={form.remarks} onChange={e => update('remarks', e.target.value)} className="input-field flex-1" />
        </div>
      </InputCard>

      <div className="flex flex-col md:flex-row md:justify-end gap-3 mt-4 mb-6">
        {editId && <button onClick={() => { setEditId(null); setForm({ ...emptyForm }); }} className="btn-secondary w-full md:w-auto text-center">Cancel Edit</button>}
        <button onClick={() => setShowPreview(true)} className="btn-primary w-full md:w-auto flex items-center justify-center gap-2">
          <Eye size={16} /> Preview & Save
        </button>
      </div>

      {/* Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowPreview(false)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="bg-stone-600 text-white p-4 rounded-t-xl flex items-center justify-between">
              <h3 className="font-bold text-lg">Milling Report Preview</h3>
              <button onClick={() => setShowPreview(false)}><X size={20} /></button>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex justify-between text-sm"><span className="text-gray-500">Date</span><span className="font-medium">{form.date}</span></div>
              {form.analysisTime && <div className="flex justify-between text-sm"><span className="text-gray-500">Time</span><span className="font-medium">{form.analysisTime}</span></div>}
              <div className="border-t pt-3">
                <h4 className="text-sm font-semibold text-stone-700 mb-2">Sieve Analysis</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {form.sieve_1mm != null && <div className="flex justify-between"><span className="text-gray-500">1.00mm</span><span>{form.sieve_1mm}%</span></div>}
                  {form.sieve_850 != null && <div className="flex justify-between"><span className="text-gray-500">0.850mm</span><span>{form.sieve_850}%</span></div>}
                  {form.sieve_600 != null && <div className="flex justify-between"><span className="text-gray-500">0.600mm</span><span>{form.sieve_600}%</span></div>}
                  {form.sieve_300 != null && <div className="flex justify-between"><span className="text-gray-500">0.300mm</span><span>{form.sieve_300}%</span></div>}
                  <div className="flex justify-between font-semibold text-orange-600 col-span-2 border-t pt-1"><span>Total Coarse (&gt;0.85mm)</span><span>{totalCoarse}%</span></div>
                  <div className="flex justify-between font-semibold text-purple-700 col-span-2"><span>Total Fine (&lt;0.3mm)</span><span>{totalFine}%</span></div>
                </div>
              </div>
              <div className="border-t pt-3">
                <h4 className="text-sm font-semibold text-stone-700 mb-2">Mill RPM & Load</h4>
                <div className="grid grid-cols-3 gap-2 text-sm text-center">
                  <div className="font-semibold text-blue-600">Mill A</div><div className="font-semibold text-green-600">Mill B</div><div className="font-semibold text-amber-600">Mill C</div>
                  <div>{form.millA_rpm ?? '—'} rpm</div><div>{form.millB_rpm ?? '—'} rpm</div><div>{form.millC_rpm ?? '—'} rpm</div>
                  <div>{form.millA_load ?? '—'} A</div><div>{form.millB_load ?? '—'} A</div><div>{form.millC_load ?? '—'} A</div>
                </div>
              </div>
              {form.remarks && <div className="border-t pt-3 text-sm"><span className="text-gray-500">Remarks:</span> {form.remarks}</div>}
            </div>
            <div className="p-4 border-t flex gap-2">
              <button onClick={async () => { await handleSave(true); setShowPreview(false); }} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />} Save & Share
              </button>
              <button onClick={async () => { await handleSave(false); setShowPreview(false); }} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 bg-stone-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-stone-700 disabled:opacity-50">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {editId ? 'Update' : 'Save'}
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
                  <th className="py-2 pr-3">Time</th>
                  <th className="py-2 pr-3 text-orange-600">Coarse%</th>
                  <th className="py-2 pr-3 text-purple-600">Fine%</th>
                  <th className="py-2 pr-3">0.6mm</th>
                  <th className="py-2 pr-3">A rpm</th>
                  <th className="py-2 pr-3">B rpm</th>
                  <th className="py-2 pr-3">C rpm</th>
                  <th className="py-2 pr-3">Saved</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.id} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => editEntry(e)}>
                    <td className="py-2 pr-3 font-medium">{e.date.split('T')[0]}</td>
                    <td className="py-2 pr-3">{e.analysisTime || '—'}</td>
                    <td className="py-2 pr-3 font-semibold text-orange-500">{((e.sieve_1mm || 0) + (e.sieve_850 || 0)).toFixed(2)}</td>
                    <td className="py-2 pr-3 font-semibold text-purple-600">{e.totalFine?.toFixed(2)}</td>
                    <td className="py-2 pr-3">{e.sieve_600?.toFixed(1)}</td>
                    <td className="py-2 pr-3">{e.millA_rpm}</td>
                    <td className="py-2 pr-3">{e.millB_rpm}</td>
                    <td className="py-2 pr-3">{e.millC_rpm}</td>
                    <td className="py-2 pr-3 text-gray-400 text-xs">{fmtTime(e.updatedAt)}</td>
                    <td className="py-2">
                      <button onClick={(ev) => { ev.stopPropagation(); deleteEntry(e.id); }} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
                {entries.length === 0 && <tr><td colSpan={9} className="py-4 text-center text-gray-400">No entries yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ProcessPage>
  );
}
