import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { Droplets, Save, Loader2, Trash2, Clock, TrendingUp, Database, AlertTriangle, ChevronDown, ChevronUp, FlaskConical, Eye, X, Share2, Camera, CheckCircle, XCircle, Pencil, ZoomIn, ZoomOut, Radio, Thermometer, Gauge, Beaker } from 'lucide-react';
import api from '../../services/api';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area, BarChart, Bar, Brush
} from 'recharts';

/* ---------- types ---------- */
interface LiqEntry {
  id: string; date: string; analysisTime: string;
  jetCookerTemp: number | null; jetCookerFlow: number | null;
  iltTemp: number | null; iltSpGravity: number | null; iltPh: number | null; iltRs: number | null;
  fltTemp: number | null; fltSpGravity: number | null; fltPh: number | null; fltRs: number | null; fltRst: number | null;
  iltDs: number | null; iltTs: number | null; fltDs: number | null; fltTs: number | null;
  iltBrix: number | null; fltBrix: number | null;
  iltViscosity: number | null; fltViscosity: number | null;
  iltAcidity: number | null; fltAcidity: number | null;
  iltLevel: number | null;
  fltLevel: number | null;
  fltFlowRate: number | null;
  flourRate: number | null;
  hotWaterFlowRate: number | null;
  thinSlopRecycleFlowRate: number | null;
  slurryFlow: number | null;
  steamFlow: number | null;
  iltSteam: number | null;
  flowToFermenter: number | null;
  fltIodineTest: string | null;
  fltIodinePhotoUrl: string | null;
  remark: string | null;
}

interface FormState {
  date: string; analysisTime: string; jetCookerTemp: string; jetCookerFlow: string;
  iltTemp: string; iltSpGravity: string; iltPh: string; iltRs: string;
  fltTemp: string; fltSpGravity: string; fltPh: string; fltRs: string; fltRst: string;
  iltDs: string; iltTs: string; fltDs: string; fltTs: string;
  iltBrix: string; fltBrix: string;
  iltViscosity: string; fltViscosity: string;
  iltAcidity: string; fltAcidity: string;
  iltLevel: string; fltLevel: string; fltFlowRate: string;
  flourRate: string; hotWaterFlowRate: string; thinSlopRecycleFlowRate: string;
  slurryFlow: string; steamFlow: string;
  iltSteam: string; flowToFermenter: string;
  fltIodineTest: string;
  remark: string;
}

const emptyForm = (): FormState => ({
  date: new Date().toISOString().split('T')[0], analysisTime: '',
  jetCookerTemp: '', jetCookerFlow: '', iltTemp: '', iltSpGravity: '', iltPh: '', iltRs: '',
  fltTemp: '', fltSpGravity: '', fltPh: '', fltRs: '', fltRst: '',
  iltDs: '', iltTs: '', fltDs: '', fltTs: '',
  iltBrix: '', fltBrix: '', iltViscosity: '', fltViscosity: '',
  iltAcidity: '', fltAcidity: '',
  iltLevel: '', fltLevel: '', fltFlowRate: '',
  flourRate: '', hotWaterFlowRate: '', thinSlopRecycleFlowRate: '',
  slurryFlow: '', steamFlow: '',
  iltSteam: '', flowToFermenter: '',
  fltIodineTest: '',
  remark: ''
});

type ChartMetric = 'gravity' | 'ph' | 'rs' | 'temp';

/* ---------- helpers ---------- */
const avg = (arr: (number | null)[]) => {
  const valid = arr.filter((v): v is number => v !== null && !isNaN(v));
  return valid.length ? (valid.reduce((a, b) => a + b, 0) / valid.length) : null;
};

const fmt = (v: number | null, dec = 2) => v !== null ? v.toFixed(dec) : '—';

const fmtDate = (d: string) => {
  if (!d) return '';
  const s = d.split('T')[0];
  const [y, m, dd] = s.split('-');
  return `${dd}/${m}`;
};

/* ---------- component ---------- */
export default function Liquefaction() {
  const [form, setForm] = useState<FormState>(emptyForm());
  const [entries, setEntries] = useState<LiqEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: string; text: string } | null>(null);
  const [chartMetric, setChartMetric] = useState<ChartMetric>('gravity');
  const [selectedDate, setSelectedDate] = useState<string>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showExtra, setShowExtra] = useState(false);
  const [lastSavedId, setLastSavedId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [iodinePhoto, setIodinePhoto] = useState<File | null>(null);
  const [iodinePreview, setIodinePreview] = useState<string | null>(null);
  const iodineInputRef = useRef<HTMLInputElement>(null);
  const [editEntry, setEditEntry] = useState<LiqEntry | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm());
  const [editSaving, setEditSaving] = useState(false);

  /* ── OPC Live Data ── */
  const OPC_TAG_MAP: Record<string, { field: keyof FormState; label: string }> = {
    'LT_120103': { field: 'iltLevel', label: 'ILT Level' },
    'LT_120102': { field: 'fltLevel', label: 'FLT Level' },
    'TE_120101': { field: 'iltTemp', label: 'ILT Temp' },
    'TE_120203': { field: 'fltTemp', label: 'FLT Temp' },
    'MG_120103': { field: 'hotWaterFlowRate', label: 'Hot Water Flow' },
    'MG_120104': { field: 'thinSlopRecycleFlowRate', label: 'Thin Slop Recycle Flow' },
    'MG_120301': { field: 'flowToFermenter', label: 'Flow to Fermenter' },
  };

  interface OpcFieldData { value: number; updatedAt: string; }
  const [opcData, setOpcData] = useState<Record<string, OpcFieldData>>({});
  const [opcLoading, setOpcLoading] = useState(false);

  const fetchAllOpcData = useCallback(async () => {
    try {
      const res = await api.get('/opc/live');
      const tags: { tag: string; values: Record<string, number>; updatedAt: string }[] = res.data?.tags || [];
      if (!tags.length) return;

      const result: Record<string, OpcFieldData> = {};
      for (const t of tags) {
        const mapping = OPC_TAG_MAP[t.tag];
        if (!mapping) continue;
        const val = t.values?.IO_VALUE ?? t.values?.PV;
        if (val != null) {
          result[mapping.field] = { value: Math.round(val * 100) / 100, updatedAt: t.updatedAt };
        }
      }
      setOpcData(result);
    } catch { /* OPC unavailable */ }
  }, []);

  // Auto-fill form from OPC data (only if fresh < 15 min and field is empty)
  const autoFillFromOpc = useCallback((currentForm: FormState) => {
    const updates: Partial<FormState> = {};
    let changed = false;
    for (const [, mapping] of Object.entries(OPC_TAG_MAP)) {
      const opc = opcData[mapping.field];
      if (!opc) continue;
      const ageMs = Date.now() - new Date(opc.updatedAt).getTime();
      if (ageMs < 15 * 60 * 1000 && !currentForm[mapping.field]) {
        (updates as any)[mapping.field] = String(opc.value);
        changed = true;
      }
    }
    if (changed) setForm(f => ({ ...f, ...updates }));
  }, [opcData]);

  const fmtOpcAgo = (iso?: string) => {
    if (!iso) return '';
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    return `${Math.round(s / 3600)}h ago`;
  };

  const load = () => api.get('/liquefaction').then(r => setEntries(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  // Fetch OPC on mount + refresh every 60s
  useEffect(() => {
    fetchAllOpcData();
    const iv = setInterval(fetchAllOpcData, 60000);
    return () => clearInterval(iv);
  }, [fetchAllOpcData]);

  // Auto-fill when OPC data arrives and form is empty
  useEffect(() => {
    if (Object.keys(opcData).length) autoFillFromOpc(form);
  }, [opcData]);

  /* ---- stats ---- */
  const stats = useMemo(() => {
    const iltG = avg(entries.map(e => e.iltSpGravity));
    const fltG = avg(entries.map(e => e.fltSpGravity));
    const iltP = avg(entries.map(e => e.iltPh));
    const fltP = avg(entries.map(e => e.fltPh));
    const iltR = avg(entries.map(e => e.iltRs));
    const fltR = avg(entries.map(e => e.fltRs));
    return { iltG, fltG, iltP, fltP, iltR, fltR };
  }, [entries]);

  /* ---- unique dates for filter ---- */
  const uniqueDates = useMemo(() => {
    const dates = [...new Set(entries.map(e => e.date?.split('T')[0]).filter(Boolean))];
    return dates.sort();
  }, [entries]);

  /* ---- chart data ---- */
  const chartData = useMemo(() => {
    let filtered = [...entries];
    if (selectedDate !== 'all') {
      filtered = filtered.filter(e => e.date?.split('T')[0] === selectedDate);
    }
    return filtered.reverse().map(e => ({
      label: `${fmtDate(e.date)} ${e.analysisTime || ''}`.trim(),
      iltGravity: e.iltSpGravity, fltGravity: e.fltSpGravity,
      iltPh: e.iltPh, fltPh: e.fltPh,
      iltRs: e.iltRs, fltRs: e.fltRs,
      iltTemp: e.iltTemp, fltTemp: e.fltTemp,
    }));
  }, [entries, selectedDate]);

  /* ---- daily summary for bar chart ---- */
  const dailySummary = useMemo(() => {
    const byDate: Record<string, LiqEntry[]> = {};
    entries.forEach(e => {
      const d = e.date?.split('T')[0];
      if (d) { if (!byDate[d]) byDate[d] = []; byDate[d].push(e); }
    });
    return Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, rows]) => ({
      date: fmtDate(date + 'T'),
      readings: rows.length,
      avgIltGrav: avg(rows.map(r => r.iltSpGravity)),
      avgFltGrav: avg(rows.map(r => r.fltSpGravity)),
      avgIltPh: avg(rows.map(r => r.iltPh)),
      avgFltPh: avg(rows.map(r => r.fltPh)),
    }));
  }, [entries]);

  /* ---- form ---- */
  const setNow = () => {
    const d = new Date();
    setForm(f => ({ ...f, analysisTime: `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` }));
  };
  const upd = (key: keyof FormState, val: string) => setForm(f => ({ ...f, [key]: val }));

  const buildReportText = (f: FormState) => `*LIQUEFACTION REPORT*\nDate: ${f.date} ${f.analysisTime || ''}\n${f.jetCookerTemp ? `\nJet Cooker: ${f.jetCookerTemp}°C${f.jetCookerFlow ? ' | Flow: ' + f.jetCookerFlow : ''}` : ''}${f.flowToFermenter ? '\nFlow to Fermenter: ' + f.flowToFermenter + ' M³/hr' : ''}\n\n*ILT*${f.iltLevel ? '\nLevel: ' + f.iltLevel : ''}${f.iltSteam ? ' | Steam: ' + f.iltSteam : ''}\nGravity: ${f.iltSpGravity || '—'} | pH: ${f.iltPh || '—'} | RS: ${f.iltRs || '—'}%\nTemp: ${f.iltTemp || '—'}°C\n\n*FLT*${f.fltLevel ? '\nLevel: ' + f.fltLevel : ''}${f.fltFlowRate ? ' | Flow: ' + f.fltFlowRate : ''}\nGravity: ${f.fltSpGravity || '—'} | pH: ${f.fltPh || '—'}\nRS: ${f.fltRs || '—'}% | RST: ${f.fltRst || '—'}%${f.fltTs ? ' | TS: ' + f.fltTs : ''}\nTemp: ${f.fltTemp || '—'}°C${f.fltIodineTest ? '\nIodine Test: ' + f.fltIodineTest + (f.fltIodineTest === 'NEGATIVE' ? ' ✅' : ' ❌') : ''}${f.remark ? '\n\nRemarks: ' + f.remark : ''}`;

  const handleSave = async (share = false) => {
    if (!form.date) { setMsg({ type: 'err', text: 'Date is required' }); return; }
    setSaving(true); setMsg(null);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => { if (v !== '' && v !== null) fd.append(k, v); });
      if (iodinePhoto) fd.append('iodinePhoto', iodinePhoto);
      const resp = await api.post('/liquefaction', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setLastSavedId(resp.data.id);

      // Send Telegram if "Save & Share" was clicked
      if (share) {
        try {
          const t = buildReportText(form);
          const waRes = await api.post('/telegram/send-report', { message: t, module: 'liquefaction' });
          if (waRes.data.sent > 0) {
            setMsg({ type: 'ok', text: `Saved & sent to ${waRes.data.sent} number(s)` });
          } else {
            setMsg({ type: 'ok', text: 'Saved! Telegram send failed: ' + (waRes.data.results?.[0]?.error || 'not connected') });
          }
        } catch {
          setMsg({ type: 'ok', text: 'Saved! Telegram send failed.' });
        }
      } else {
        setMsg({ type: 'ok', text: `Saved at ${new Date().toLocaleTimeString()}` });
      }

      setForm(emptyForm()); setIodinePhoto(null); setIodinePreview(null); load();
      setTimeout(() => setMsg(null), 5000);
      setTimeout(() => setLastSavedId(null), 8000);
    } catch (err: unknown) {
      setMsg({ type: 'err', text: err.response?.data?.error || 'Save failed' });
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try { await api.delete(`/liquefaction/${id}`); load(); } catch {}
    setDeletingId(null);
  };

  const startEdit = (e: LiqEntry) => {
    const v = (n: number | null) => n !== null && n !== undefined ? String(n) : '';
    setEditForm({
      date: e.date?.split('T')[0] || '', analysisTime: e.analysisTime || '',
      jetCookerTemp: v(e.jetCookerTemp), jetCookerFlow: v(e.jetCookerFlow),
      iltTemp: v(e.iltTemp), iltSpGravity: v(e.iltSpGravity), iltPh: v(e.iltPh), iltRs: v(e.iltRs),
      fltTemp: v(e.fltTemp), fltSpGravity: v(e.fltSpGravity), fltPh: v(e.fltPh), fltRs: v(e.fltRs), fltRst: v(e.fltRst),
      iltDs: v(e.iltDs), iltTs: v(e.iltTs), fltDs: v(e.fltDs), fltTs: v(e.fltTs),
      iltBrix: v(e.iltBrix), fltBrix: v(e.fltBrix),
      iltViscosity: v(e.iltViscosity), fltViscosity: v(e.fltViscosity),
      iltAcidity: v(e.iltAcidity), fltAcidity: v(e.fltAcidity),
      iltLevel: v(e.iltLevel), fltLevel: v(e.fltLevel), fltFlowRate: v(e.fltFlowRate),
      flourRate: v(e.flourRate), hotWaterFlowRate: v(e.hotWaterFlowRate),
      thinSlopRecycleFlowRate: v(e.thinSlopRecycleFlowRate),
      slurryFlow: v(e.slurryFlow), steamFlow: v(e.steamFlow),
      iltSteam: v(e.iltSteam), flowToFermenter: v(e.flowToFermenter),
      fltIodineTest: e.fltIodineTest || '', remark: e.remark || '',
    });
    setEditEntry(e);
  };

  const handleEditSave = async () => {
    if (!editEntry) return;
    setEditSaving(true);
    try {
      const payload: any = {};
      Object.entries(editForm).forEach(([k, v]) => { payload[k] = v; });
      await api.put(`/liquefaction/${editEntry.id}`, payload);
      setMsg({ type: 'ok', text: 'Entry updated' });
      setEditEntry(null); load();
      setTimeout(() => setMsg(null), 3000);
    } catch (err: unknown) {
      setMsg({ type: 'err', text: err.response?.data?.error || 'Update failed' });
    }
    setEditSaving(false);
  };

  /* ---- chart config ---- */
  const metricConfig: Record<ChartMetric, { ilt: string; flt: string; color1: string; color2: string }> = {
    gravity: { ilt: 'iltGravity', flt: 'fltGravity', color1: '#1e40af', color2: '#10b981' },
    ph:      { ilt: 'iltPh',      flt: 'fltPh',      color1: '#1e40af', color2: '#f59e0b' },
    rs:      { ilt: 'iltRs',      flt: 'fltRs',      color1: '#dc2626', color2: '#10b981' },
    temp:    { ilt: 'iltTemp',     flt: 'fltTemp',    color1: '#1e40af', color2: '#dc2626' },
  };
  const mc = metricConfig[chartMetric];

  /* ---- chart stats for current metric ---- */
  const trendStats = useMemo(() => {
    const iltKey = mc.ilt as keyof typeof chartData[0];
    const vals = chartData.map(d => d[iltKey] as number | null).filter((v): v is number => v !== null && !isNaN(Number(v)));
    if (vals.length === 0) return { mean: 0, min: 0, max: 0, range: 0, count: 0 };
    const sum = vals.reduce((a, b) => a + Number(b), 0);
    const mean = sum / vals.length;
    const mn = Math.min(...vals.map(Number));
    const mx = Math.max(...vals.map(Number));
    return { mean, min: mn, max: mx, range: mx - mn, count: vals.length };
  }, [chartData, mc.ilt]);

  const dailyBarStats = useMemo(() => {
    const vals = dailySummary.map(d => d.avgIltGrav).filter((v): v is number => v !== null && !isNaN(Number(v)));
    if (vals.length === 0) return { mean: 0, min: 0, max: 0, range: 0, count: 0 };
    const sum = vals.reduce((a, b) => a + Number(b), 0);
    const mean = sum / vals.length;
    const mn = Math.min(...vals.map(Number));
    const mx = Math.max(...vals.map(Number));
    return { mean, min: mn, max: mx, range: mx - mn, count: vals.length };
  }, [dailySummary]);

  const [trendYZoom, setTrendYZoom] = useState(0);
  const [barYZoom, setBarYZoom] = useState(0);

  /* ---- input helper (inline, stable via key) ---- */
  const opcBadge = (field: keyof FormState) => {
    const opc = opcData[field];
    if (!opc) return null;
    const ageMs = Date.now() - new Date(opc.updatedAt).getTime();
    const fresh = ageMs < 15 * 60 * 1000;
    return (
      <span className={`ml-1 text-[9px] font-bold px-1 py-0.5 ${fresh ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
        title={`OPC: ${opc.value} (${fmtOpcAgo(opc.updatedAt)})`}>
        OPC {opc.value} <span className="font-normal">{fmtOpcAgo(opc.updatedAt)}</span>
      </span>
    );
  };

  const numInput = (label: string, field: keyof FormState, step = '0.001') => (
    <div key={field}>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}{opcBadge(field)}</label>
      <input type="number" step={step} value={form[field]}
        onChange={e => upd(field, e.target.value)}
        className="w-full border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition" />
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-cyan-600 p-5 text-white">
        <div className="flex items-center gap-3">
          <Droplets size={28} />
          <div>
            <h1 className="text-2xl font-bold">Liquefaction</h1>
            <p className="text-blue-100 text-sm">ILT & FLT monitoring — Jet Cooker → ILT → FLT</p>
          </div>
          <div className="ml-auto text-right">
            <div className="text-3xl font-bold">{entries.length}</div>
            <div className="text-blue-200 text-xs">total readings</div>
          </div>
        </div>
      </div>

      {/* ═══ TANK DASHBOARD ═══ */}
      {(() => {
        const latest = entries[0]; // entries are desc, newest first
        const iltOpc = opcData['iltLevel'];
        const fltOpc = opcData['fltLevel'];
        const iltTempOpc = opcData['iltTemp'];
        const fltTempOpc = opcData['fltTemp'];

        const tanks = [
          {
            id: 'ILT', name: 'ILT', fullName: 'Initial Liquefaction Tank',
            color: 'blue', Icon: Beaker,
            opcLevel: iltOpc?.value, opcTemp: iltTempOpc?.value,
            opcUpdated: iltOpc?.updatedAt || iltTempOpc?.updatedAt,
            gravity: latest?.iltSpGravity, ph: latest?.iltPh, rs: latest?.iltRs,
            temp: latest?.iltTemp, level: latest?.iltLevel, steam: latest?.iltSteam,
            brix: latest?.iltBrix, acidity: latest?.iltAcidity,
          },
          {
            id: 'FLT', name: 'FLT', fullName: 'Final Liquefaction Tank',
            color: 'green', Icon: FlaskConical,
            opcLevel: fltOpc?.value, opcTemp: fltTempOpc?.value,
            opcUpdated: fltOpc?.updatedAt || fltTempOpc?.updatedAt,
            gravity: latest?.fltSpGravity, ph: latest?.fltPh, rs: latest?.fltRs,
            temp: latest?.fltTemp, level: latest?.fltLevel, flowRate: latest?.fltFlowRate,
            iodine: latest?.fltIodineTest, rst: latest?.fltRst,
            brix: latest?.fltBrix, acidity: latest?.fltAcidity,
          },
        ];

        return (
          <div className="grid grid-cols-2 gap-3">
            {tanks.map(t => {
              const hasOpc = t.opcLevel != null || t.opcTemp != null;
              const opcFresh = t.opcUpdated ? (Date.now() - new Date(t.opcUpdated).getTime()) < 15 * 60 * 1000 : false;
              const borderColor = t.color === 'blue' ? 'border-blue-400' : 'border-green-400';
              const bgGrad = t.color === 'blue'
                ? 'bg-gradient-to-br from-blue-50 to-blue-100/50'
                : 'bg-gradient-to-br from-green-50 to-emerald-100/50';
              const textColor = t.color === 'blue' ? 'text-blue-700' : 'text-green-700';
              const iconColor = t.color === 'blue' ? 'text-blue-500' : 'text-green-500';

              return (
                <div key={t.id} className={`${bgGrad} border-2 ${borderColor} p-3 relative`}>
                  {/* Tank Header */}
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-8 h-8 flex items-center justify-center ${t.color === 'blue' ? 'bg-blue-200' : 'bg-green-200'}`}>
                      <t.Icon size={16} className={iconColor} />
                    </div>
                    <div>
                      <div className={`text-sm font-extrabold ${textColor}`}>{t.name}</div>
                      <div className="text-[9px] text-gray-500">{t.fullName}</div>
                    </div>
                  </div>

                  {/* OPC Live Badges */}
                  {hasOpc && (
                    <div className="flex items-center gap-1.5 flex-wrap mb-2">
                      {t.opcLevel != null && (
                        <span className={`text-[11px] font-extrabold px-1.5 py-0.5 border ${opcFresh ? 'text-green-800 bg-green-100 border-green-300' : 'text-gray-500 bg-gray-100 border-gray-300'}`}>
                          Level {t.opcLevel}%
                        </span>
                      )}
                      {t.opcTemp != null && (
                        <span className={`text-[11px] font-extrabold px-1.5 py-0.5 border ${opcFresh ? 'text-orange-800 bg-orange-100 border-orange-300' : 'text-gray-500 bg-gray-100 border-gray-300'}`}>
                          {t.opcTemp}&deg;C
                        </span>
                      )}
                      {t.opcUpdated && (
                        <span className="text-[9px] text-gray-500 font-medium">{fmtOpcAgo(t.opcUpdated)}</span>
                      )}
                    </div>
                  )}

                  {/* Latest Reading Metrics */}
                  {latest ? (
                    <div className="space-y-1.5">
                      {/* Primary: Gravity large */}
                      {t.gravity != null && (
                        <div className="text-xl font-black text-gray-900 tracking-tight leading-tight">
                          {t.gravity.toFixed(3)}
                          <span className="text-[10px] font-medium text-gray-400 ml-1">SG</span>
                        </div>
                      )}

                      {/* Grid of secondary metrics */}
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                        {t.ph != null && (
                          <div className="flex justify-between">
                            <span className="text-[10px] text-gray-500">pH</span>
                            <span className="text-xs font-bold text-gray-800">{t.ph.toFixed(2)}</span>
                          </div>
                        )}
                        {t.rs != null && (
                          <div className="flex justify-between">
                            <span className="text-[10px] text-gray-500">RS</span>
                            <span className="text-xs font-bold text-gray-800">{t.rs.toFixed(2)}%</span>
                          </div>
                        )}
                        {t.temp != null && !hasOpc && (
                          <div className="flex justify-between">
                            <span className="text-[10px] text-gray-500">Temp</span>
                            <span className="text-xs font-bold text-gray-800">{t.temp}°C</span>
                          </div>
                        )}
                        {t.level != null && !hasOpc && (
                          <div className="flex justify-between">
                            <span className="text-[10px] text-gray-500">Level</span>
                            <span className="text-xs font-bold text-gray-800">{t.level}</span>
                          </div>
                        )}
                        {'rst' in t && t.rst != null && (
                          <div className="flex justify-between">
                            <span className="text-[10px] text-gray-500">RST</span>
                            <span className="text-xs font-bold text-gray-800">{t.rst.toFixed(2)}%</span>
                          </div>
                        )}
                        {'steam' in t && t.steam != null && (
                          <div className="flex justify-between">
                            <span className="text-[10px] text-gray-500">Steam</span>
                            <span className="text-xs font-bold text-gray-800">{t.steam}</span>
                          </div>
                        )}
                        {'flowRate' in t && t.flowRate != null && (
                          <div className="flex justify-between">
                            <span className="text-[10px] text-gray-500">Flow</span>
                            <span className="text-xs font-bold text-gray-800">{t.flowRate}</span>
                          </div>
                        )}
                      </div>

                      {/* Iodine Test Badge (FLT only) */}
                      {'iodine' in t && t.iodine && (
                        <div className="mt-1">
                          <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-1.5 py-0.5 ${
                            t.iodine === 'NEGATIVE' ? 'bg-green-100 text-green-700 border border-green-300' : 'bg-red-100 text-red-700 border border-red-300'
                          }`}>
                            {t.iodine === 'NEGATIVE' ? <CheckCircle size={10} /> : <XCircle size={10} />}
                            Iodine: {t.iodine}
                          </span>
                        </div>
                      )}

                      {/* Last reading time */}
                      <div className="text-[9px] text-gray-400 flex items-center gap-0.5 mt-1">
                        <Clock size={8} />
                        {latest.analysisTime || fmtDate(latest.date)} — last reading
                      </div>
                    </div>
                  ) : (
                    <div className="text-[10px] text-gray-400 italic mt-2">No readings yet</div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Flow Summary Strip */}
      {(() => {
        const latest = entries[0];
        if (!latest) return null;
        const flows = [
          { label: 'Jet Cooker', val: latest.jetCookerTemp, unit: '°C' },
          { label: 'Flour Rate', val: latest.flourRate, unit: '' },
          { label: 'Hot Water', val: opcData['hotWaterFlowRate']?.value ?? latest.hotWaterFlowRate, unit: 'M³/hr' },
          { label: 'Thin Slop', val: opcData['thinSlopRecycleFlowRate']?.value ?? latest.thinSlopRecycleFlowRate, unit: '' },
          { label: 'To Fermenter', val: opcData['flowToFermenter']?.value ?? latest.flowToFermenter, unit: 'M³/hr' },
        ].filter(f => f.val != null);
        if (!flows.length) return null;
        return (
          <div className="flex gap-2 flex-wrap">
            {flows.map(f => (
              <div key={f.label} className="bg-white border border-gray-200 px-3 py-2 text-center flex-1 min-w-[100px]">
                <div className="text-[9px] text-gray-500 font-bold uppercase tracking-wider">{f.label}</div>
                <div className="text-sm font-bold text-gray-800 mt-0.5">{typeof f.val === 'number' ? f.val.toFixed(1) : f.val} <span className="text-[9px] text-gray-400">{f.unit}</span></div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* KPI Cards */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {[
          { label: 'ILT Gravity', val: fmt(stats.iltG, 3), sub: 'avg', color: 'blue' },
          { label: 'FLT Gravity', val: fmt(stats.fltG, 3), sub: 'avg', color: 'green' },
          { label: 'ILT pH', val: fmt(stats.iltP, 2), sub: 'avg', color: 'purple' },
          { label: 'FLT pH', val: fmt(stats.fltP, 2), sub: 'avg', color: 'yellow' },
          { label: 'ILT RS%', val: fmt(stats.iltR, 2), sub: 'avg', color: 'red' },
          { label: 'FLT RS%', val: fmt(stats.fltR, 2), sub: 'avg', color: 'cyan' },
        ].map(k => (
          <div key={k.label} className="bg-white border border-gray-200 p-3 text-center">
            <div className="text-xs text-gray-500 mb-1">{k.label}</div>
            <div className="text-xl font-bold text-gray-800">{k.val}</div>
            <div className="text-[10px] text-gray-400">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* New Reading Form */}
      <div className="bg-white border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <Save size={18} className="text-blue-600" /> New Reading
          </h2>
          <button type="button" onClick={() => {
            setOpcLoading(true);
            fetchAllOpcData().then(() => {
              // Force-fill all OPC fields regardless of current value
              const updates: Partial<FormState> = {};
              for (const [, mapping] of Object.entries(OPC_TAG_MAP)) {
                const opc = opcData[mapping.field];
                if (opc) {
                  const ageMs = Date.now() - new Date(opc.updatedAt).getTime();
                  if (ageMs < 15 * 60 * 1000) (updates as any)[mapping.field] = String(opc.value);
                }
              }
              setForm(f => ({ ...f, ...updates }));
              setMsg({ type: 'ok', text: `Filled ${Object.keys(updates).length} fields from OPC` });
              setTimeout(() => setMsg(null), 3000);
            }).finally(() => setOpcLoading(false));
          }}
            disabled={opcLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 border border-green-300 text-xs font-semibold hover:bg-green-100 transition disabled:opacity-50">
            {opcLoading ? <Loader2 size={12} className="animate-spin" /> : <Radio size={12} />}
            Fill from OPC
          </button>
        </div>

        {/* Top row: Date, Time, Jet Cooker */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
            <input type="date" value={form.date} onChange={e => upd('date', e.target.value)}
              className="w-full border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Time</label>
            <div className="flex gap-1">
              <input type="time" value={form.analysisTime} onChange={e => upd('analysisTime', e.target.value)}
                className="flex-1 border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
              <button onClick={setNow} className="px-3 py-2 bg-blue-50 text-blue-600 text-xs font-semibold hover:bg-blue-100 transition flex items-center gap-1">
                <Clock size={12} /> Now
              </button>
            </div>
          </div>
          {numInput("Jet Cooker Temp °C", "jetCookerTemp", "0.1")}
          {numInput("Jet Cooker Flow", "jetCookerFlow", "0.1")}
        </div>

        {/* Flow Rates */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
          {numInput("Flour Rate", "flourRate", "0.1")}
          {numInput("Hot Water Flow Rate", "hotWaterFlowRate", "0.1")}
          {numInput("Thin Slop Recycle Flow Rate", "thinSlopRecycleFlowRate", "0.1")}
          {numInput("Flow to Fermenter (M³/hr)", "flowToFermenter", "0.1")}
        </div>

        {/* ILT Section */}
        <div className="mb-4">
          <div className="text-sm font-semibold text-blue-700 mb-2 border-b border-blue-100 pb-1">
            ILT (Initial Liquefaction Tank)
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-2">
            {numInput("Level", "iltLevel", "0.1")}
            {numInput("Temp °C", "iltTemp", "0.1")}
            {numInput("Steam", "iltSteam", "0.1")}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {numInput("Sp. Gravity", "iltSpGravity")}
            {numInput("pH", "iltPh")}
            {numInput("RS %", "iltRs")}
          </div>
        </div>

        {/* FLT Section */}
        <div className="mb-4">
          <div className="text-sm font-semibold text-green-700 mb-2 border-b border-green-100 pb-1">
            FLT (Final Liquefaction Tank)
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-2">
            {numInput("Level", "fltLevel", "0.1")}
            {numInput("Flow Rate", "fltFlowRate", "0.1")}
            {numInput("Temp °C", "fltTemp", "0.1")}
            {numInput("Sp. Gravity", "fltSpGravity")}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {numInput("pH", "fltPh")}
            {numInput("RS %", "fltRs")}
            {numInput("RST %", "fltRst")}
            {numInput("TS (Total Solids)", "fltTs")}
          </div>

          {/* Iodine Test */}
          <div className="mt-3 p-3 border border-indigo-200 bg-indigo-50/30">
            <label className="block text-xs font-semibold text-indigo-700 mb-2">Iodine Test</label>
            <div className="flex items-center gap-3 flex-wrap">
              <button type="button" onClick={() => upd('fltIodineTest', 'POSITIVE')}
                className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition border ${form.fltIodineTest === 'POSITIVE' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-red-600 border-red-300 hover:bg-red-50'}`}>
                <XCircle size={16} /> Positive
              </button>
              <button type="button" onClick={() => upd('fltIodineTest', 'NEGATIVE')}
                className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition border ${form.fltIodineTest === 'NEGATIVE' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-green-600 border-green-300 hover:bg-green-50'}`}>
                <CheckCircle size={16} /> Negative
              </button>
              <input ref={iodineInputRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) { setIodinePhoto(f); setIodinePreview(URL.createObjectURL(f)); } }} />
              <button type="button" onClick={() => iodineInputRef.current?.click()}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-white text-indigo-600 border border-indigo-300 hover:bg-indigo-50 transition">
                <Camera size={16} /> {iodinePhoto ? 'Change Photo' : 'Take Photo'}
              </button>
              {form.fltIodineTest && (
                <button type="button" onClick={() => { upd('fltIodineTest', ''); setIodinePhoto(null); setIodinePreview(null); }}
                  className="text-xs text-gray-400 hover:text-gray-600">Clear</button>
              )}
            </div>
            {iodinePreview && (
              <div className="mt-2">
                <img src={iodinePreview} alt="Iodine test" className="w-32 h-32 object-cover border" />
              </div>
            )}
          </div>
        </div>

        {/* Extra Tests Toggle */}
        <div className="mb-4">
          <button onClick={() => setShowExtra(!showExtra)}
            className="flex items-center gap-2 text-sm font-semibold text-amber-700 hover:text-amber-800 transition mb-2">
            <FlaskConical size={16} />
            Additional Tests (DS, TS, Brix, Viscosity, Acidity)
            {showExtra ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {showExtra && (
            <div className="border border-amber-200 bg-amber-50/30 p-4 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {numInput("Slurry Flow (ILT→JC)", "slurryFlow", "0.1")}
                {numInput("Steam Flow", "steamFlow", "0.1")}
              </div>
              <div className="text-xs font-semibold text-blue-600 border-b border-blue-100 pb-1">ILT Extra</div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                {numInput("DS (Dissolved Solids)", "iltDs")}
                {numInput("TS (Total Solids)", "iltTs")}
                {numInput("Brix", "iltBrix")}
                {numInput("Viscosity", "iltViscosity")}
                {numInput("Acidity", "iltAcidity")}
              </div>
              <div className="text-xs font-semibold text-green-600 border-b border-green-100 pb-1">FLT Extra</div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                {numInput("DS (Dissolved Solids)", "fltDs")}
                {numInput("TS (Total Solids)", "fltTs")}
                {numInput("Brix", "fltBrix")}
                {numInput("Viscosity", "fltViscosity")}
                {numInput("Acidity", "fltAcidity")}
              </div>
            </div>
          )}
        </div>

        {/* Remark + Save */}
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-500 mb-1">Remark</label>
            <input type="text" value={form.remark} onChange={e => upd('remark', e.target.value)}
              className="w-full border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <button onClick={() => setShowPreview(true)}
            className="flex items-center justify-center gap-2 bg-blue-600 text-white px-6 py-2.5 min-h-[44px] text-sm font-semibold hover:bg-blue-700 transition w-full sm:w-auto">
            <Eye size={16} /> Preview & Save
          </button>
        </div>
        {msg && (
          <div className={`mt-3 px-4 py-3 text-sm font-semibold flex items-center gap-2 ${msg.type === 'ok' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
            {msg.text}
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowPreview(false)}>
          <div className="bg-white shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="bg-blue-600 text-white p-4 flex items-center justify-between">
              <h3 className="font-bold text-lg">Liquefaction Report Preview</h3>
              <button onClick={() => setShowPreview(false)}><X size={20} /></button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Date</span><span className="font-medium">{form.date}</span></div>
              {form.analysisTime && <div className="flex justify-between"><span className="text-gray-500">Time</span><span className="font-medium">{form.analysisTime}</span></div>}
              {(form.jetCookerTemp || form.jetCookerFlow) && (
                <div className="border-t pt-2">
                  <h4 className="font-semibold text-gray-700 mb-1">Jet Cooker</h4>
                  <div className="grid grid-cols-2 gap-1">
                    {form.jetCookerTemp && <div>Temp: <b>{form.jetCookerTemp}°C</b></div>}
                    {form.jetCookerFlow && <div>Flow: <b>{form.jetCookerFlow}</b></div>}
                  </div>
                </div>
              )}
              {form.flowToFermenter && (
                <div className="border-t pt-2">
                  <div>Flow to Fermenter: <b>{form.flowToFermenter} M³/hr</b></div>
                </div>
              )}
              <div className="border-t pt-2">
                <h4 className="font-semibold text-blue-700 mb-1">ILT</h4>
                <div className="grid grid-cols-2 gap-1">
                  {form.iltLevel && <div>Level: <b>{form.iltLevel}</b></div>}
                  {form.iltTemp && <div>Temp: <b>{form.iltTemp}°C</b></div>}
                  {form.iltSteam && <div>Steam: <b>{form.iltSteam}</b></div>}
                  {form.iltSpGravity && <div>Sp.Gravity: <b>{form.iltSpGravity}</b></div>}
                  {form.iltPh && <div>pH: <b>{form.iltPh}</b></div>}
                  {form.iltRs && <div>RS%: <b>{form.iltRs}</b></div>}
                </div>
              </div>
              <div className="border-t pt-2">
                <h4 className="font-semibold text-green-700 mb-1">FLT</h4>
                <div className="grid grid-cols-2 gap-1">
                  {form.fltLevel && <div>Level: <b>{form.fltLevel}</b></div>}
                  {form.fltFlowRate && <div>Flow Rate: <b>{form.fltFlowRate}</b></div>}
                  {form.fltTemp && <div>Temp: <b>{form.fltTemp}°C</b></div>}
                  {form.fltSpGravity && <div>Sp.Gravity: <b>{form.fltSpGravity}</b></div>}
                  {form.fltPh && <div>pH: <b>{form.fltPh}</b></div>}
                  {form.fltRs && <div>RS%: <b>{form.fltRs}</b></div>}
                  {form.fltRst && <div>RST%: <b>{form.fltRst}</b></div>}
                  {form.fltTs && <div>TS: <b>{form.fltTs}</b></div>}
                </div>
                {form.fltIodineTest && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-gray-500">Iodine:</span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold ${form.fltIodineTest === 'NEGATIVE' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {form.fltIodineTest === 'NEGATIVE' ? <CheckCircle size={12} /> : <XCircle size={12} />} {form.fltIodineTest}
                    </span>
                  </div>
                )}
                {iodinePreview && <img src={iodinePreview} alt="Iodine" className="mt-1 w-20 h-20 object-cover border" />}
              </div>
              {form.remark && <div className="border-t pt-2"><span className="text-gray-500">Remark:</span> {form.remark}</div>}
            </div>
            <div className="p-4 border-t flex gap-2">
              <button onClick={async () => { await handleSave(false); setShowPreview(false); }} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save
              </button>
              <button onClick={async () => { await handleSave(true); setShowPreview(false); }} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white py-2.5 text-sm font-medium hover:bg-green-700 disabled:opacity-50">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />} Save & Share
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Trends Chart */}
      <div className="bg-white border border-slate-300 p-3">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">ILT vs FLT Trends</h2>
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              {([['gravity', 'Sp. Gravity'], ['ph', 'pH'], ['rs', 'RS %'], ['temp', 'Temp']] as [ChartMetric, string][]).map(([k, l]) => (
                <button key={k} onClick={() => setChartMetric(k)}
                  className={`px-3 py-1.5 text-xs font-semibold transition ${chartMetric === k ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {l}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-slate-400 uppercase tracking-widest mr-1">Y-Zoom</span>
              <button onClick={() => setTrendYZoom(z => z + 1)} className="px-1.5 py-0.5 border border-slate-300 text-slate-600 text-xs hover:bg-slate-100"><ZoomIn size={12} /></button>
              <button onClick={() => setTrendYZoom(z => Math.max(0, z - 1))} className="px-1.5 py-0.5 border border-slate-300 text-slate-600 text-xs hover:bg-slate-100"><ZoomOut size={12} /></button>
              {trendYZoom > 0 && <button onClick={() => setTrendYZoom(0)} className="px-1.5 py-0.5 text-[9px] text-blue-600 hover:underline">Reset</button>}
            </div>
          </div>
        </div>

        {/* Date filter */}
        <div className="flex items-center gap-2 mb-3">
          <label className="text-xs text-gray-500">Filter:</label>
          <select value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
            className="text-xs border border-gray-300 px-2 py-1 focus:ring-1 focus:ring-slate-400 outline-none">
            <option value="all">All Dates ({entries.length})</option>
            {uniqueDates.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        {trendStats.count > 0 && (
          <div className="grid grid-cols-3 md:grid-cols-5 gap-0 border border-slate-300 mb-2">
            {[
              { label: 'Mean', value: trendStats.mean.toFixed(2), color: 'indigo' },
              { label: 'Min', value: trendStats.min.toFixed(2), color: 'cyan' },
              { label: 'Max', value: trendStats.max.toFixed(2), color: 'red' },
              { label: 'Range', value: trendStats.range.toFixed(2), color: 'amber' },
              { label: 'Samples', value: String(trendStats.count), color: 'slate' },
            ].map(s => (
              <div key={s.label} className="px-2 py-2 border-r border-slate-200 last:border-r-0">
                <div className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{s.label}</div>
                <div className={`text-sm font-bold font-mono tabular-nums mt-0.5 text-${s.color}-600`}>{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {chartData.length > 0 ? (() => {
          const yDomain: [string | number, string | number] = trendYZoom > 0 && trendStats.count > 0
            ? [trendStats.mean - trendStats.range / (trendYZoom + 1), trendStats.mean + trendStats.range / (trendYZoom + 1)]
            : ['auto', 'auto'];
          return (
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="gradIlt" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={mc.color1} stopOpacity={0.15} />
                    <stop offset="95%" stopColor={mc.color1} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradFlt" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={mc.color2} stopOpacity={0.15} />
                    <stop offset="95%" stopColor={mc.color2} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} interval="preserveStartEnd" angle={-30} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} domain={yDomain} />
                <Tooltip contentStyle={{ fontSize: 12, border: '1px solid #94a3b8', background: '#fff', padding: '8px 12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }} labelStyle={{ fontWeight: 700, marginBottom: 4, color: '#1e293b' }} itemStyle={{ padding: '1px 0' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey={mc.ilt} name="ILT" stroke={mc.color1} strokeWidth={2} fill="url(#gradIlt)" dot={{ r: 3, fill: mc.color1 }} connectNulls />
                <Area type="monotone" dataKey={mc.flt} name="FLT" stroke={mc.color2} strokeWidth={2} fill="url(#gradFlt)" dot={{ r: 3, fill: mc.color2 }} connectNulls />
                {chartData.length > 24 && <Brush dataKey="label" height={20} stroke="#1e40af" travellerWidth={8} />}
              </AreaChart>
            </ResponsiveContainer>
          );
        })() : (
          <div className="text-center text-gray-400 py-12">No data to display</div>
        )}
      </div>

      {/* Daily Summary Bar Chart */}
      {dailySummary.length > 1 && (
        <div className="bg-white border border-slate-300 p-3">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Daily Average Gravity</h2>
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-slate-400 uppercase tracking-widest mr-1">Y-Zoom</span>
              <button onClick={() => setBarYZoom(z => z + 1)} className="px-1.5 py-0.5 border border-slate-300 text-slate-600 text-xs hover:bg-slate-100"><ZoomIn size={12} /></button>
              <button onClick={() => setBarYZoom(z => Math.max(0, z - 1))} className="px-1.5 py-0.5 border border-slate-300 text-slate-600 text-xs hover:bg-slate-100"><ZoomOut size={12} /></button>
              {barYZoom > 0 && <button onClick={() => setBarYZoom(0)} className="px-1.5 py-0.5 text-[9px] text-blue-600 hover:underline">Reset</button>}
            </div>
          </div>
          {dailyBarStats.count > 0 && (
            <div className="grid grid-cols-3 md:grid-cols-5 gap-0 border border-slate-300 mb-2">
              {[
                { label: 'Mean', value: dailyBarStats.mean.toFixed(3), color: 'indigo' },
                { label: 'Min', value: dailyBarStats.min.toFixed(3), color: 'cyan' },
                { label: 'Max', value: dailyBarStats.max.toFixed(3), color: 'red' },
                { label: 'Range', value: dailyBarStats.range.toFixed(3), color: 'amber' },
                { label: 'Days', value: String(dailyBarStats.count), color: 'slate' },
              ].map(s => (
                <div key={s.label} className="px-2 py-2 border-r border-slate-200 last:border-r-0">
                  <div className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{s.label}</div>
                  <div className={`text-sm font-bold font-mono tabular-nums mt-0.5 text-${s.color}-600`}>{s.value}</div>
                </div>
              ))}
            </div>
          )}
          {(() => {
            const yDomain: [string | number, string | number] = barYZoom > 0 && dailyBarStats.count > 0
              ? [dailyBarStats.mean - dailyBarStats.range / (barYZoom + 1), dailyBarStats.mean + dailyBarStats.range / (barYZoom + 1)]
              : ['auto', 'auto'];
            return (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={dailySummary}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
                  <YAxis tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} domain={yDomain} />
                  <Tooltip contentStyle={{ fontSize: 12, border: '1px solid #94a3b8', background: '#fff', padding: '8px 12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }} labelStyle={{ fontWeight: 700, marginBottom: 4, color: '#1e293b' }} itemStyle={{ padding: '1px 0' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="avgIltGrav" name="ILT Gravity" fill="#1e40af" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="avgFltGrav" name="FLT Gravity" fill="#10b981" radius={[2, 2, 0, 0]} />
                  {dailySummary.length > 24 && <Brush dataKey="date" height={20} stroke="#1e40af" travellerWidth={8} />}
                </BarChart>
              </ResponsiveContainer>
            );
          })()}
        </div>
      )}

      {/* Entry History Table */}
      <div className="bg-white border border-gray-200 p-5">
        <h2 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
          <Database size={18} className="text-gray-600" /> Entry History
          <span className="text-sm font-normal text-gray-400">({entries.length} entries)</span>
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-2 py-2 text-left font-semibold text-gray-600 sticky left-0 bg-gray-50 z-10">Date</th>
                <th className="px-2 py-2 text-left font-semibold text-gray-600">Time</th>
                <th className="px-2 py-2 text-right font-semibold text-gray-500">JC Temp</th>
                <th className="px-2 py-2 text-right font-semibold text-gray-500">JC Flow</th>
                <th className="px-2 py-2 text-right font-semibold text-blue-600">ILT Lvl</th>
                <th className="px-2 py-2 text-right font-semibold text-blue-600">ILT Tmp</th>
                <th className="px-2 py-2 text-right font-semibold text-blue-600">ILT Grav</th>
                <th className="px-2 py-2 text-right font-semibold text-blue-600">ILT pH</th>
                <th className="px-2 py-2 text-right font-semibold text-blue-600">ILT RS</th>
                <th className="px-2 py-2 text-right font-semibold text-green-600">FLT Lvl</th>
                <th className="px-2 py-2 text-right font-semibold text-green-600">FLT Tmp</th>
                <th className="px-2 py-2 text-right font-semibold text-green-600">FLT Grav</th>
                <th className="px-2 py-2 text-right font-semibold text-green-600">FLT pH</th>
                <th className="px-2 py-2 text-right font-semibold text-green-600">FLT RS</th>
                <th className="px-2 py-2 text-right font-semibold text-green-600">FLT RST</th>
                <th className="px-2 py-2 text-right font-semibold text-amber-600">Flour</th>
                <th className="px-2 py-2 text-right font-semibold text-amber-600">→Ferm</th>
                <th className="px-2 py-2 text-center font-semibold text-indigo-600">Iodine</th>
                <th className="px-2 py-2 text-left font-semibold text-gray-600">Remark</th>
                <th className="px-2 py-2 sticky right-0 bg-gray-50 z-10"></th>
              </tr>
            </thead>
            <tbody>
              {entries.slice(0, 100).map((e, i) => (
                <tr key={e.id} className={`border-b border-gray-100 hover:bg-blue-50/50 transition ${e.id === lastSavedId ? 'bg-green-100 ring-2 ring-green-400 ring-inset animate-pulse' : i % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}>
                  <td className="px-2 py-1.5 text-gray-700 font-medium sticky left-0 bg-inherit z-10">{fmtDate(e.date)}</td>
                  <td className="px-2 py-1.5 text-gray-600">{e.analysisTime || '—'}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-gray-600">{fmt(e.jetCookerTemp, 1)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-gray-600">{fmt(e.jetCookerFlow, 1)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-blue-600">{fmt(e.iltLevel, 1)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-blue-600">{fmt(e.iltTemp, 1)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-blue-700 font-bold">{fmt(e.iltSpGravity, 3)}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{fmt(e.iltPh)}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{fmt(e.iltRs)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-green-600">{fmt(e.fltLevel, 1)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-green-600">{fmt(e.fltTemp, 1)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-green-700 font-bold">{fmt(e.fltSpGravity, 3)}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{fmt(e.fltPh)}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{fmt(e.fltRs)}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{fmt(e.fltRst)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-amber-700">{fmt(e.flourRate, 1)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-amber-700">{fmt(e.flowToFermenter, 1)}</td>
                  <td className="px-2 py-1.5 text-center">
                    {e.fltIodineTest ? (
                      <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-bold ${e.fltIodineTest === 'NEGATIVE' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {e.fltIodineTest.slice(0, 3)}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-gray-500 max-w-[120px] truncate">{e.remark || ''}</td>
                  <td className="px-2 py-1.5 sticky right-0 bg-inherit z-10">
                    <div className="flex items-center gap-1">
                      <button onClick={() => startEdit(e)} className="text-gray-300 hover:text-blue-500 transition">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => handleDelete(e.id)} disabled={deletingId === e.id}
                        className="text-gray-300 hover:text-red-500 transition disabled:opacity-50">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {entries.length > 100 && <div className="text-xs text-gray-400 mt-2 text-center">Showing first 100 of {entries.length}</div>}
        </div>
      </div>

      {/* Edit Modal */}
      {editEntry && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEditEntry(null)}>
          <div className="bg-white shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-3 flex items-center justify-between z-10">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <Pencil size={16} className="text-blue-600" /> Edit Entry — {fmtDate(editEntry.date)} {editEntry.analysisTime || ''}
              </h3>
              <button onClick={() => setEditEntry(null)} className="p-1 hover:bg-gray-100"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              {/* Date & Time */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold text-gray-500 mb-1">Date</label>
                  <input type="date" value={editForm.date} onChange={e => setEditForm(f => ({ ...f, date: e.target.value }))}
                    className="w-full border border-gray-300 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-gray-500 mb-1">Time</label>
                  <input type="time" value={editForm.analysisTime} onChange={e => setEditForm(f => ({ ...f, analysisTime: e.target.value }))}
                    className="w-full border border-gray-300 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
                {[{ k: 'jetCookerTemp', l: 'JC Temp °C' }, { k: 'jetCookerFlow', l: 'JC Flow' }].map(f => (
                  <div key={f.k}>
                    <label className="block text-[10px] font-semibold text-gray-500 mb-1">{f.l}</label>
                    <input type="number" step="0.1" value={(editForm as any)[f.k]} onChange={e => setEditForm(ef => ({ ...ef, [f.k]: e.target.value }))}
                      className="w-full border border-gray-300 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-300" />
                  </div>
                ))}
              </div>

              {/* Flow Rates */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[{ k: 'flourRate', l: 'Flour Rate' }, { k: 'hotWaterFlowRate', l: 'Hot Water Flow' }, { k: 'thinSlopRecycleFlowRate', l: 'Thin Slop Recycle' }, { k: 'flowToFermenter', l: 'Flow → Fermenter' }].map(f => (
                  <div key={f.k}>
                    <label className="block text-[10px] font-semibold text-gray-500 mb-1">{f.l}</label>
                    <input type="number" step="0.1" value={(editForm as any)[f.k]} onChange={e => setEditForm(ef => ({ ...ef, [f.k]: e.target.value }))}
                      className="w-full border border-gray-300 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-300" />
                  </div>
                ))}
              </div>

              {/* ILT */}
              <div>
                <div className="text-xs font-bold text-blue-700 mb-2 border-b border-blue-100 pb-1">ILT (Initial Liquefaction Tank)</div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                  {[{ k: 'iltLevel', l: 'Level' }, { k: 'iltTemp', l: 'Temp' }, { k: 'iltSteam', l: 'Steam' }, { k: 'iltSpGravity', l: 'Gravity' }, { k: 'iltPh', l: 'pH' }, { k: 'iltRs', l: 'RS%' }].map(f => (
                    <div key={f.k}>
                      <label className="block text-[10px] font-semibold text-gray-500 mb-1">{f.l}</label>
                      <input type="number" step="0.001" value={(editForm as any)[f.k]} onChange={e => setEditForm(ef => ({ ...ef, [f.k]: e.target.value }))}
                        className="w-full border border-gray-300 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-300" />
                    </div>
                  ))}
                </div>
              </div>

              {/* FLT */}
              <div>
                <div className="text-xs font-bold text-green-700 mb-2 border-b border-green-100 pb-1">FLT (Final Liquefaction Tank)</div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                  {[{ k: 'fltLevel', l: 'Level' }, { k: 'fltFlowRate', l: 'Flow Rate' }, { k: 'fltTemp', l: 'Temp' }, { k: 'fltSpGravity', l: 'Gravity' }, { k: 'fltPh', l: 'pH' }, { k: 'fltRs', l: 'RS%' }, { k: 'fltRst', l: 'RST%' }, { k: 'fltTs', l: 'TS' }].map(f => (
                    <div key={f.k}>
                      <label className="block text-[10px] font-semibold text-gray-500 mb-1">{f.l}</label>
                      <input type="number" step="0.001" value={(editForm as any)[f.k]} onChange={e => setEditForm(ef => ({ ...ef, [f.k]: e.target.value }))}
                        className="w-full border border-gray-300 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-300" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Extra Tests */}
              <div>
                <div className="text-xs font-bold text-amber-700 mb-2 border-b border-amber-100 pb-1">Additional Tests</div>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                  {[{ k: 'slurryFlow', l: 'Slurry Flow' }, { k: 'steamFlow', l: 'Steam Flow' }, { k: 'iltDs', l: 'ILT DS' }, { k: 'iltTs', l: 'ILT TS' }, { k: 'iltBrix', l: 'ILT Brix' }, { k: 'iltViscosity', l: 'ILT Visc' }, { k: 'iltAcidity', l: 'ILT Acid' }, { k: 'fltDs', l: 'FLT DS' }, { k: 'fltBrix', l: 'FLT Brix' }, { k: 'fltViscosity', l: 'FLT Visc' }, { k: 'fltAcidity', l: 'FLT Acid' }].map(f => (
                    <div key={f.k}>
                      <label className="block text-[10px] font-semibold text-gray-500 mb-1">{f.l}</label>
                      <input type="number" step="0.001" value={(editForm as any)[f.k]} onChange={e => setEditForm(ef => ({ ...ef, [f.k]: e.target.value }))}
                        className="w-full border border-gray-300 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-300" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Iodine + Remark */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold text-gray-500 mb-1">Iodine Test</label>
                  <select value={editForm.fltIodineTest} onChange={e => setEditForm(f => ({ ...f, fltIodineTest: e.target.value }))}
                    className="w-full border border-gray-300 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-300">
                    <option value="">—</option>
                    <option value="POSITIVE">Positive</option>
                    <option value="NEGATIVE">Negative</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-gray-500 mb-1">Remark</label>
                  <input type="text" value={editForm.remark} onChange={e => setEditForm(f => ({ ...f, remark: e.target.value }))}
                    className="w-full border border-gray-300 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
              </div>
            </div>

            {/* Save / Cancel */}
            <div className="sticky bottom-0 bg-white border-t border-gray-200 px-5 py-3 flex gap-3">
              <button onClick={handleEditSave} disabled={editSaving}
                className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2 hover:bg-blue-700 transition">
                {editSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save Changes
              </button>
              <button onClick={() => setEditEntry(null)} className="px-6 py-2.5 bg-gray-100 text-gray-600 text-sm font-semibold hover:bg-gray-200 transition">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
