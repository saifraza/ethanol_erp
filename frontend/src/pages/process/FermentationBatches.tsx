import { useState, useEffect, useCallback, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area, ReferenceLine } from 'recharts';
import { Plus, FlaskConical, Beaker, ArrowRight, RotateCcw, Trash2, ChevronDown, ChevronUp, Clock, Pencil, TrendingDown, Thermometer, Droplets, BarChart3, Share2, Camera, Beer } from 'lucide-react';
import api from '../../services/api';

/* ═══════════════════════ TYPES ═══════════════════════ */
interface Chemical { id: string; name: string; unit: string; }
interface Dosing { id: string; chemicalName: string; quantity: number; unit: string; level: number | null; addedAt: string; }
interface Batch {
  id: string; batchNo: number; fermenterNo: number; phase: string;
  pfTransferTime: string | null; fillingStartTime: string | null; fillingEndTime: string | null;
  setupEndTime: string | null; reactionStartTime: string | null; retentionStartTime: string | null;
  transferTime: string | null; cipStartTime: string | null; cipEndTime: string | null;
  setupTime: string | null; setupDate: string | null; setupGravity: number | null; setupRs: number | null; setupRst: number | null;
  fermLevel: number | null; volume: number | null; transferVolume: number | null; beerWellNo: number | null;
  finalDate: string | null; finalRsGravity: number | null; totalHours: number | null; finalAlcohol: number | null;
  yeast: string | null; enzyme: string | null; formolin: string | null; booster: string | null; urea: string | null;
  remarks: string | null; createdAt: string; dosings: Dosing[];
}
interface LabEntry {
  id: string; date: string; analysisTime: string; batchNo: number; fermenterNo: number;
  level: number | null; spGravity: number | null; ph: number | null; rs: number | null; rst: number | null;
  alcohol: number | null; ds: number | null; vfaPpa: number | null; temp: number | null;
  spentLoss: number | null; spentLossPhotoUrl: string | null;
  status: string; remarks: string | null;
}

/* helpers */
const toLocal = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};
const nowLocal = () => toLocal(new Date().toISOString());

const PHASES = ['PF_TRANSFER', 'FILLING', 'REACTION', 'RETENTION', 'TRANSFER', 'CIP', 'DONE'] as const;
const phaseColors: Record<string, string> = { PF_TRANSFER: '#f97316', FILLING: '#6366f1', REACTION: '#10b981', RETENTION: '#06b6d4', TRANSFER: '#3b82f6', CIP: '#8b5cf6', DONE: '#6b7280' };
const phaseLabels: Record<string, string> = { PF_TRANSFER: 'PF Transfer', FILLING: 'Filling', REACTION: 'Reaction', RETENTION: 'Retention', TRANSFER: 'Transfer', CIP: 'CIP', DONE: 'Done' };
const FERMENTERS = [1, 2, 3, 4, 5]; // 5 = Beer Well
const F_COLORS: Record<number, string> = { 1: '#3b82f6', 2: '#10b981', 3: '#f59e0b', 4: '#ef4444', 5: '#8b5cf6' };
const F_LABELS: Record<number, string> = { 1: 'F1', 2: 'F2', 3: 'F3', 4: 'F4', 5: 'BW' };
const FERM_CAPACITY_M3 = 2300;

/* elapsed time helper: returns "+2h 15m" from T0 */
const elapsed = (from: string | null, to: string | null) => {
  if (!from || !to) return '';
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (ms < 0) return '';
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `+${h}h ${m}m` : `+${m}m`;
};

const phaseTime = (batch: Batch, phase: string): string | null => {
  switch (phase) {
    case 'PF_TRANSFER': return batch.pfTransferTime;
    case 'FILLING': return batch.fillingStartTime;
    case 'REACTION': return batch.fillingEndTime;
    case 'RETENTION': return batch.reactionStartTime;
    case 'TRANSFER': return batch.transferTime;
    case 'CIP': return batch.cipStartTime;
    case 'DONE': return batch.cipEndTime;
    default: return null;
  }
};
const t0 = (batch: Batch) => batch.pfTransferTime || batch.fillingStartTime;

/* Phase duration: time spent in each phase */
const phaseDuration = (batch: Batch, phase: string): string => {
  const starts: Record<string, string | null> = {
    PF_TRANSFER: batch.pfTransferTime, FILLING: batch.fillingStartTime, REACTION: batch.fillingEndTime,
    RETENTION: batch.reactionStartTime, TRANSFER: batch.retentionStartTime || batch.transferTime,
    CIP: batch.cipStartTime, DONE: batch.cipEndTime,
  };
  const ends: Record<string, string | null> = {
    PF_TRANSFER: batch.fillingStartTime, FILLING: batch.fillingEndTime, REACTION: batch.reactionStartTime,
    RETENTION: batch.transferTime, TRANSFER: batch.cipStartTime,
    CIP: batch.cipEndTime, DONE: null,
  };
  const s = starts[phase], e = ends[phase];
  if (!s || !e) return '';
  const ms = new Date(e).getTime() - new Date(s).getTime();
  if (ms <= 0) return '';
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 24) { const d = Math.floor(h / 24); const rh = h % 24; return `${d}d ${rh}h ${m}m`; }
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

/* ═══════════════════════ BATCH HISTORY CARD ═══════════════════════ */
function BatchHistoryCard({ batch: b, isActive, isExpanded, onToggle, onDelete, TimeField }: {
  batch: Batch; isActive: boolean; isExpanded: boolean;
  onToggle: () => void; onDelete: () => void;
  TimeField: any;
}) {
  const [labData, setLabData] = useState<LabEntry[]>([]);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    if (isExpanded && labData.length === 0) {
      api.get(`/fermentation/batch/${b.batchNo}`).then(r => {
        const filtered = (r.data as LabEntry[]).filter(e => e.fermenterNo === b.fermenterNo);
        setLabData(filtered);
      }).catch(() => {});
    }
  }, [isExpanded, b.batchNo, b.fermenterNo]);

  const totalHrs = (() => {
    const start = b.fillingStartTime;
    const end = b.transferTime || b.cipEndTime || b.cipStartTime;
    if (!start || !end) return null;
    return ((new Date(end).getTime() - new Date(start).getTime()) / 3600000).toFixed(1);
  })();

  const t0v = b.fillingStartTime;
  const chartData = labData.map(r => {
    const ts = r.analysisTime || r.date;
    const hrs = t0v && ts ? ((new Date(ts).getTime() - new Date(t0v).getTime()) / 3600000) : 0;
    return { hrs: Math.round(hrs * 10) / 10, label: `${hrs.toFixed(0)}h`, Gravity: r.spGravity, pH: r.ph, RS: r.rs, Alcohol: r.alcohol, Temp: r.temp };
  }).sort((a, c) => a.hrs - c.hrs);

  // Get first and last gravity for drop calculation
  const firstSG = labData.find(r => r.spGravity != null)?.spGravity;
  const lastSG = [...labData].reverse().find(r => r.spGravity != null)?.spGravity;
  const sgDrop = firstSG && lastSG ? (firstSG - lastSG).toFixed(3) : null;

  // Peak temp
  const maxTemp = labData.reduce((mx, r) => r.temp != null && r.temp > mx ? r.temp : mx, 0);
  // Final alcohol
  const finalAlc = b.finalAlcohol ?? [...labData].reverse().find(r => r.alcohol != null)?.alcohol ?? null;

  return (
    <div className={`transition-all ${isActive ? 'bg-emerald-50/50' : ''} ${isExpanded ? 'bg-gray-50/50' : ''}`}>
      {/* Header row */}
      <div className="flex items-center justify-between p-3 px-4 cursor-pointer hover:bg-gray-50/80 transition-colors" onClick={onToggle}>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-white bg-gray-500 px-1.5 py-0.5 rounded">{F_LABELS[b.fermenterNo] || `F${b.fermenterNo}`}</span>
            <span className="text-lg font-bold text-gray-800">#{b.batchNo}</span>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold text-white shadow-sm" style={{ backgroundColor: phaseColors[b.phase] }}>{phaseLabels[b.phase]}</span>
          </div>
          <span className="text-sm text-gray-400">{b.fillingStartTime ? new Date(b.fillingStartTime).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}</span>
          {totalHrs && <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{totalHrs}h total</span>}
          {finalAlc != null && <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">{finalAlc}% alc</span>}
          {b.dosings.length > 0 && <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">{b.dosings.length} chemicals</span>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={e => { e.stopPropagation(); onDelete(); }} className="text-red-300 hover:text-red-500 transition-colors"><Trash2 size={15} /></button>
          {isExpanded ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-4 pb-5 space-y-4 animate-in">
          {/* Phase Timeline */}
          <div className="my-2 px-2">
            <div className="flex items-center gap-1 flex-wrap">
              {PHASES.map((p, i) => {
                const ci = PHASES.indexOf(b.phase as any);
                const pt = phaseTime(b, p);
                const el = t0v && pt ? elapsed(t0v, pt) : '';
                const dur = phaseDuration(b, p);
                return (
                  <div key={p} className="flex items-center">
                    <div className="flex flex-col items-center">
                      <div className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${i <= ci ? 'text-white shadow-sm' : 'text-gray-400 bg-gray-100'}`} style={i <= ci ? { backgroundColor: phaseColors[p] } : {}}>
                        {phaseLabels[p]}
                        {i === 0 && t0v && <span className="ml-1 opacity-75">T0</span>}
                        {i > 0 && el && <span className="ml-1 opacity-75 text-[10px]">{el}</span>}
                      </div>
                      {dur && <span className="text-[10px] text-gray-500 mt-0.5 font-medium">{dur}</span>}
                    </div>
                    {i < PHASES.length - 1 && <ArrowRight size={14} className="mx-1 text-gray-300" />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white rounded-lg border p-3 shadow-sm">
              <div className="flex items-center gap-2 text-gray-500 text-xs mb-1"><TrendingDown size={14} /> Gravity Drop</div>
              <div className="text-xl font-bold text-indigo-600">{sgDrop ?? '-'}</div>
              <div className="text-[10px] text-gray-400">{firstSG ?? '-'} → {lastSG ?? '-'}</div>
            </div>
            <div className="bg-white rounded-lg border p-3 shadow-sm">
              <div className="flex items-center gap-2 text-gray-500 text-xs mb-1"><Droplets size={14} /> Final Alcohol</div>
              <div className="text-xl font-bold text-red-600">{finalAlc != null ? `${finalAlc}%` : '-'}</div>
              <div className="text-[10px] text-gray-400">{labData.length} readings</div>
            </div>
            <div className="bg-white rounded-lg border p-3 shadow-sm">
              <div className="flex items-center gap-2 text-gray-500 text-xs mb-1"><Thermometer size={14} /> Peak Temp</div>
              <div className="text-xl font-bold text-orange-600">{maxTemp > 0 ? `${maxTemp}°C` : '-'}</div>
              <div className="text-[10px] text-gray-400">Max recorded</div>
            </div>
            <div className="bg-white rounded-lg border p-3 shadow-sm">
              <div className="flex items-center gap-2 text-gray-500 text-xs mb-1"><Clock size={14} /> Duration</div>
              <div className="text-xl font-bold text-emerald-600">{totalHrs ? `${totalHrs}h` : '-'}</div>
              <div className="text-[10px] text-gray-400">Filling → Transfer</div>
            </div>
          </div>

          {/* Charts */}
          {chartData.length >= 2 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Gravity & Alcohol chart */}
              <div className="bg-white rounded-lg border p-3 shadow-sm">
                <h4 className="text-xs font-semibold text-gray-600 mb-2">Gravity & Alcohol vs Time (T0+)</h4>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id={`grav-${b.id}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id={`alc-${b.id}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="hrs" type="number" tick={{ fontSize: 10 }} stroke="#9ca3af" tickFormatter={(v: number) => `${v}h`} />
                    <YAxis yAxisId="left" tick={{ fontSize: 10 }} stroke="#6366f1" domain={['auto', 'auto']} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} stroke="#ef4444" domain={[0, 'auto']} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }} labelFormatter={(v: number) => `T0+${v}h`} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Area yAxisId="left" type="monotone" dataKey="Gravity" stroke="#6366f1" strokeWidth={2} fill={`url(#grav-${b.id})`} dot={{ r: 2.5, fill: '#6366f1' }} connectNulls />
                    <Area yAxisId="right" type="monotone" dataKey="Alcohol" stroke="#ef4444" strokeWidth={2} fill={`url(#alc-${b.id})`} dot={{ r: 2.5, fill: '#ef4444' }} connectNulls />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* pH & Temp chart */}
              <div className="bg-white rounded-lg border p-3 shadow-sm">
                <h4 className="text-xs font-semibold text-gray-600 mb-2">pH & Temperature vs Time (T0+)</h4>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="hrs" type="number" tick={{ fontSize: 10 }} stroke="#9ca3af" tickFormatter={(v: number) => `${v}h`} />
                    <YAxis yAxisId="left" tick={{ fontSize: 10 }} stroke="#f59e0b" domain={['auto', 'auto']} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} stroke="#8b5cf6" domain={['auto', 'auto']} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }} labelFormatter={(v: number) => `T0+${v}h`} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceLine yAxisId="right" y={37} stroke="#ef4444" strokeDasharray="5 5" label={{ value: '37°C', position: 'right', fontSize: 9, fill: '#ef4444' }} />
                    <Line yAxisId="left" type="monotone" dataKey="pH" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2.5, fill: '#f59e0b' }} connectNulls />
                    <Line yAxisId="right" type="monotone" dataKey="Temp" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 2.5, fill: '#8b5cf6' }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Dosing chips */}
          {b.dosings.length > 0 && (
            <div className="bg-amber-50/50 rounded-lg border border-amber-200/50 p-3">
              <h4 className="text-xs font-semibold text-amber-700 mb-2 flex items-center gap-1"><Beaker size={12} /> Chemical Dosing</h4>
              <div className="flex flex-wrap gap-2">{b.dosings.map(d => (
                <span key={d.id} className="text-xs bg-white text-amber-800 px-2.5 py-1 rounded-lg border border-amber-200 shadow-sm">
                  <span className="font-semibold">{d.chemicalName}</span>: {d.quantity} {d.unit}
                  {d.level != null && <span className="text-emerald-600 ml-1">@{d.level}%</span>}
                  <span className="text-gray-400 ml-1.5">{elapsed(t0(b), d.addedAt)}</span>
                </span>
              ))}</div>
            </div>
          )}

          {/* Lab Readings Table (collapsible) */}
          {labData.length > 0 && (
            <div className="bg-white rounded-lg border shadow-sm">
              <button onClick={() => setShowTable(!showTable)} className="w-full flex items-center justify-between p-3 hover:bg-gray-50 transition-colors">
                <span className="text-sm font-semibold text-gray-700 flex items-center gap-1.5"><FlaskConical size={14} /> Lab Readings ({labData.length})</span>
                {showTable ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
              </button>
              {showTable && (
                <div className="overflow-x-auto border-t">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-gray-50 text-xs text-gray-500">{['Date/Time', 'T0+', 'SG', 'pH', 'RS%', 'RST%', 'Alc%', 'DS%', 'VFA', 'Temp', 'SpLoss', 'Phase'].map(h => <th key={h} className="text-left py-2 px-2 font-medium">{h}</th>)}</tr></thead>
                    <tbody>{labData.map((r, i) => {
                      const ts = r.analysisTime || r.date;
                      return (
                        <tr key={r.id} className={`border-t ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-blue-50/30 transition-colors`}>
                          <td className="px-2 py-1.5 text-xs whitespace-nowrap">{ts ? new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '-'}</td>
                          <td className="px-2 text-xs font-medium text-indigo-600">{elapsed(t0v, ts)}</td>
                          <td className="px-2 font-medium">{r.spGravity ?? <span className="text-gray-300">-</span>}</td>
                          <td className="px-2">{r.ph ?? <span className="text-gray-300">-</span>}</td>
                          <td className="px-2">{r.rs ?? <span className="text-gray-300">-</span>}</td>
                          <td className="px-2">{r.rst ?? <span className="text-gray-300">-</span>}</td>
                          <td className="px-2 font-medium text-red-600">{r.alcohol ?? <span className="text-gray-300">-</span>}</td>
                          <td className="px-2">{r.ds ?? <span className="text-gray-300">-</span>}</td>
                          <td className="px-2">{r.vfaPpa ?? <span className="text-gray-300">-</span>}</td>
                          <td className={`px-2 ${r.temp != null && r.temp > 37 ? 'text-red-600 font-bold' : ''}`}>{r.temp ?? <span className="text-gray-300">-</span>}</td>
                          <td className="px-2 text-orange-600">{r.spentLoss != null ? r.spentLoss : <span className="text-gray-300">-</span>}</td>
                          <td className="px-2"><span className="text-[10px] font-bold text-white px-1.5 py-0.5 rounded-full" style={{ backgroundColor: phaseColors[r.status] || '#6b7280' }}>{phaseLabels[r.status] || r.status}</span></td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Time fields row */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm bg-white rounded-lg border p-3 shadow-sm">
            <TimeField label="Filling Start" value={b.fillingStartTime} field="fillingStartTime" batchId={b.id} color="indigo" />
            {b.fillingEndTime && <TimeField label="Filling End" value={b.fillingEndTime} field="fillingEndTime" batchId={b.id} color="indigo" />}
            {b.reactionStartTime && <TimeField label="Reaction Start" value={b.reactionStartTime} field="reactionStartTime" batchId={b.id} color="emerald" />}
            {b.retentionStartTime && <TimeField label="Retention Start" value={b.retentionStartTime} field="retentionStartTime" batchId={b.id} color="cyan" />}
            {b.transferTime && <TimeField label="Transfer" value={b.transferTime} field="transferTime" batchId={b.id} color="blue" />}
            {b.cipStartTime && <TimeField label="CIP Start" value={b.cipStartTime} field="cipStartTime" batchId={b.id} color="purple" />}
            {b.cipEndTime && <TimeField label="CIP End" value={b.cipEndTime} field="cipEndTime" batchId={b.id} color="gray" />}
          </div>

          {b.remarks && <p className="text-sm text-gray-500 italic">Remarks: {b.remarks}</p>}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════ BEER WELL PANEL ═══════════════════════ */
function BeerWellPanel() {
  const [bwLevel, setBwLevel] = useState<number | null>(null);
  const [bwLoading, setBwLoading] = useState(true);
  const [bwLabEntries, setBwLabEntries] = useState<LabEntry[]>([]);
  const [showBwUpdate, setShowBwUpdate] = useState(false);
  const [bwForm, setBwForm] = useState({ level: '', spGravity: '', ph: '', rs: '', temp: '', alcohol: '' });

  const FERM_CAP = 2300;

  const loadBw = useCallback(() => {
    setBwLoading(true);
    api.get('/grain/latest').then(r => {
      setBwLevel(r.data?.previous?.beerWellLevel ?? null);
    }).catch(() => {}).finally(() => setBwLoading(false));
    api.get('/fermentation/fermenter/5').then(r => setBwLabEntries(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => { loadBw(); }, [loadBw]);

  const saveBwUpdate = async () => {
    try {
      // Update beer well level in grain entry
      if (bwForm.level) {
        await api.patch('/grain/latest-levels', { beerWellLevel: parseFloat(bwForm.level) / 100 * FERM_CAP });
      }
      // Log a lab entry for BW (fermenterNo=5)
      const fd = new FormData();
      fd.append('date', new Date().toISOString());
      fd.append('analysisTime', new Date().toISOString());
      fd.append('batchNo', '0');
      fd.append('fermenterNo', '5');
      fd.append('status', 'ACTIVE');
      if (bwForm.level) fd.append('level', bwForm.level);
      if (bwForm.spGravity) fd.append('spGravity', bwForm.spGravity);
      if (bwForm.ph) fd.append('ph', bwForm.ph);
      if (bwForm.rs) fd.append('rs', bwForm.rs);
      if (bwForm.temp) fd.append('temp', bwForm.temp);
      if (bwForm.alcohol) fd.append('alcohol', bwForm.alcohol);
      await api.post('/fermentation', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setShowBwUpdate(false);
      setBwForm({ level: '', spGravity: '', ph: '', rs: '', temp: '', alcohol: '' });
      loadBw();
    } catch {}
  };

  const bwPct = bwLevel != null ? (bwLevel / FERM_CAP * 100) : 0;

  return (
    <div className="space-y-4">
      {/* BW Status Card */}
      <div className="bg-white rounded-xl shadow border overflow-hidden">
        <div className="bg-gradient-to-r from-purple-600 to-fuchsia-600 p-4 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2"><Beer size={22} /> Beer Well</h2>
              <p className="text-purple-200 text-sm mt-0.5">Live Status</p>
            </div>
            <button onClick={() => {
              setShowBwUpdate(true);
              setBwForm(f => ({ ...f, level: bwPct > 0 ? bwPct.toFixed(1) : '' }));
            }} className="bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5">
              <Pencil size={14} /> Update
            </button>
          </div>
        </div>
        <div className="p-5">
          {bwLoading ? (
            <div className="text-gray-400 text-center py-8">Loading...</div>
          ) : (
            <div className="flex items-center gap-6">
              {/* Tank visual */}
              <div className="relative w-20 h-32 rounded-xl border-2 border-purple-300 overflow-hidden bg-gray-50 flex-shrink-0">
                <div className="absolute bottom-0 w-full transition-all duration-500 rounded-b-lg"
                  style={{ height: `${Math.min(bwPct, 100)}%`, background: 'linear-gradient(to top, #9333ea, #c084fc)' }} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-sm font-bold text-white drop-shadow">{bwPct.toFixed(0)}%</span>
                </div>
              </div>
              {/* Info */}
              <div className="flex-1">
                <div className="text-3xl font-bold text-purple-700">{bwLevel != null ? `${bwLevel.toFixed(0)} KL` : 'Empty'}</div>
                <div className="text-sm text-gray-500 mt-1">of {FERM_CAP} KL capacity</div>
                {bwLabEntries.length > 0 && (
                  <div className="flex gap-3 mt-3 flex-wrap text-sm">
                    {(() => { const last = bwLabEntries[bwLabEntries.length - 1]; return (<>
                      {last.spGravity != null && <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded">SG: {last.spGravity}</span>}
                      {last.ph != null && <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded">pH: {last.ph}</span>}
                      {last.rs != null && <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded">RS: {last.rs}%</span>}
                      {last.temp != null && <span className="bg-purple-50 text-purple-700 px-2 py-0.5 rounded">Temp: {last.temp}°C</span>}
                      {last.alcohol != null && <span className="bg-red-50 text-red-700 px-2 py-0.5 rounded">Alc: {last.alcohol}%</span>}
                      <span className="text-gray-400 text-xs">Last: {new Date(last.analysisTime || last.date).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                    </>); })()}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* BW Lab History */}
      {bwLabEntries.length > 0 && (
        <div className="bg-white rounded-xl shadow border">
          <div className="p-4 border-b">
            <h3 className="font-bold text-gray-700 flex items-center gap-2"><FlaskConical size={16} /> Lab Readings ({bwLabEntries.length})</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 text-xs text-gray-500">{['Date/Time', 'Level%', 'SG', 'pH', 'RS%', 'Alc%', 'Temp'].map(h => <th key={h} className="text-left py-2 px-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>{[...bwLabEntries].reverse().slice(0, 20).map((r, i) => (
                <tr key={r.id} className={`border-t ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                  <td className="px-2 py-1.5 text-xs whitespace-nowrap">{(r.analysisTime || r.date) ? new Date(r.analysisTime || r.date).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '-'}</td>
                  <td className="px-2 text-emerald-600 font-medium">{r.level ?? '-'}</td>
                  <td className="px-2 font-medium">{r.spGravity ?? '-'}</td>
                  <td className="px-2">{r.ph ?? '-'}</td>
                  <td className="px-2">{r.rs ?? '-'}</td>
                  <td className="px-2 text-red-600 font-medium">{r.alcohol ?? '-'}</td>
                  <td className="px-2">{r.temp ?? '-'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* BW Update Modal */}
      {showBwUpdate && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end md:items-center justify-center" onClick={() => setShowBwUpdate(false)}>
          <div className="bg-white rounded-t-2xl md:rounded-2xl w-full max-w-md p-5 shadow-2xl animate-in" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><Beer size={18} /> Update Beer Well</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 font-medium">Level %</label>
                <input type="number" step="0.1" value={bwForm.level} onChange={e => setBwForm(f => ({ ...f, level: e.target.value }))} placeholder="e.g. 67"
                  className="w-full border-2 border-gray-200 rounded-lg px-3 py-2.5 text-base focus:border-purple-400 outline-none" />
                {bwForm.level && <span className="text-xs text-purple-600">{(parseFloat(bwForm.level) / 100 * FERM_CAP).toFixed(0)} KL</span>}
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium">SG</label>
                <input type="number" step="0.001" value={bwForm.spGravity} onChange={e => setBwForm(f => ({ ...f, spGravity: e.target.value }))} placeholder="e.g. 1.000"
                  className="w-full border-2 border-gray-200 rounded-lg px-3 py-2.5 text-base focus:border-indigo-400 outline-none" />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium">pH</label>
                <input type="number" step="0.01" value={bwForm.ph} onChange={e => setBwForm(f => ({ ...f, ph: e.target.value }))} placeholder="e.g. 4.2"
                  className="w-full border-2 border-gray-200 rounded-lg px-3 py-2.5 text-base focus:border-amber-400 outline-none" />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium">RS %</label>
                <input type="number" step="0.01" value={bwForm.rs} onChange={e => setBwForm(f => ({ ...f, rs: e.target.value }))} placeholder="e.g. 0.5"
                  className="w-full border-2 border-gray-200 rounded-lg px-3 py-2.5 text-base focus:border-emerald-400 outline-none" />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium">Alcohol %</label>
                <input type="number" step="0.01" value={bwForm.alcohol} onChange={e => setBwForm(f => ({ ...f, alcohol: e.target.value }))} placeholder="e.g. 8.5"
                  className="w-full border-2 border-gray-200 rounded-lg px-3 py-2.5 text-base focus:border-red-400 outline-none" />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium">Temp °C</label>
                <input type="number" step="0.1" value={bwForm.temp} onChange={e => setBwForm(f => ({ ...f, temp: e.target.value }))} placeholder="e.g. 30"
                  className="w-full border-2 border-gray-200 rounded-lg px-3 py-2.5 text-base focus:border-purple-400 outline-none" />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={saveBwUpdate} className="flex-1 bg-purple-600 text-white py-3 rounded-xl text-base font-semibold hover:bg-purple-700 shadow-sm">Save</button>
              <button onClick={() => setShowBwUpdate(false)} className="px-6 py-3 bg-gray-100 text-gray-600 rounded-xl text-base font-medium hover:bg-gray-200">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════ MAIN COMPONENT ═══════════════════════ */
export default function Fermentation() {
  const [tab, setTab] = useState(1);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [chemicals, setChemicals] = useState<Chemical[]>([]);
  const [labEntries, setLabEntries] = useState<LabEntry[]>([]);
  const [showNewBatch, setShowNewBatch] = useState(false);
  const [showNewChem, setShowNewChem] = useState(false);
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);
  const [phaseMsg, setPhaseMsg] = useState<string | null>(null);

  const [nbForm, setNbForm] = useState({ batchNo: '', fermLevel: '', setupGravity: '', remarks: '' });
  const [doseForm, setDoseForm] = useState({ chemicalName: '', quantity: '', unit: 'kg' });
  const [labForm, setLabForm] = useState({ analysisTime: '', level: '', spGravity: '', ph: '', rs: '', rst: '', alcohol: '', ds: '', vfaPpa: '', temp: '', spentLoss: '', status: 'U/F', remarks: '' });
  const [slPhoto, setSlPhoto] = useState<File | null>(null);
  const [slPreview, setSlPreview] = useState<string | null>(null);
  const slInputRef = useRef<HTMLInputElement>(null);
  const [chemForm, setChemForm] = useState({ name: '', unit: 'kg' });

  const load = useCallback(() => {
    api.get('/fermentation/batches').then(r => setBatches(r.data)).catch(() => {});
    api.get('/fermentation/chemicals').then(r => setChemicals(r.data)).catch(() => {});
  }, []);

  const loadLab = useCallback(() => {
    api.get(`/fermentation/fermenter/${tab}`).then(r => setLabEntries(r.data)).catch(() => {});
  }, [tab]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadLab(); }, [loadLab, tab]);

  const fermBatches = batches.filter(b => b.fermenterNo === tab);
  const activeBatch = fermBatches.find(b => b.phase !== 'DONE') || null;
  const batchLab = activeBatch ? labEntries.filter(e => e.batchNo === activeBatch.batchNo) : [];

  /* Auto-fill level from last SETUP value when entering REACTION or RETENTION */
  useEffect(() => {
    if (activeBatch && ['REACTION', 'RETENTION'].includes(activeBatch.phase) && activeBatch.fermLevel != null) {
      setLabForm(f => ({ ...f, level: f.level || String(activeBatch.fermLevel) }));
    }
  }, [activeBatch?.phase, activeBatch?.fermLevel]);

  const createBatch = async () => {
    try {
      await api.post('/fermentation/batches', { ...nbForm, fermenterNo: tab, pfTransferTime: new Date().toISOString() });
      setShowNewBatch(false);
      setNbForm({ batchNo: '', fermLevel: '', setupGravity: '', remarks: '' });
      load();
    } catch {}
  };

  const addDosing = async () => {
    if (!activeBatch) return;
    try {
      await api.post(`/fermentation/batches/${activeBatch.id}/dosing`, { ...doseForm, level: activeBatch.fermLevel });
      setDoseForm(f => ({ ...f, quantity: '' }));
      load();
    } catch {}
  };

  const addLabReading = async () => {
    if (!activeBatch) return;
    try {
      const analysisTimeISO = labForm.analysisTime ? new Date(labForm.analysisTime).toISOString() : new Date().toISOString();
      const fd = new FormData();
      const payload = { ...labForm, analysisTime: analysisTimeISO, status: activeBatch.phase, date: analysisTimeISO, batchNo: String(activeBatch.batchNo), fermenterNo: String(tab) };
      Object.entries(payload).forEach(([k, v]) => { if (v !== '' && v != null) fd.append(k, v); });
      if (slPhoto) fd.append('spentLossPhoto', slPhoto);
      await api.post('/fermentation', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      // update batch fermLevel if level was entered
      if (labForm.level) {
        await api.patch(`/fermentation/batches/${activeBatch.id}`, { fermLevel: labForm.level });
      }
      // Auto-advance: SG ≤ 1.000 during REACTION → move to RETENTION
      const sg = labForm.spGravity ? parseFloat(labForm.spGravity) : null;
      if (sg != null && sg <= 1.0 && activeBatch.phase === 'REACTION') {
        await api.patch(`/fermentation/batches/${activeBatch.id}`, {
          phase: 'RETENTION',
          retentionStartTime: analysisTimeISO,
          setupGravity: sg
        });
        setPhaseMsg('✓ SG reached 1.000 — auto-moved to Retention');
        setTimeout(() => setPhaseMsg(null), 3000);
      }
      setLabForm({ analysisTime: '', level: '', spGravity: '', ph: '', rs: '', rst: '', alcohol: '', ds: '', vfaPpa: '', temp: '', spentLoss: '', status: 'U/F', remarks: '' });
      setSlPhoto(null); setSlPreview(null);
      load(); loadLab();
    } catch {}
  };

  const advancePhase = async (batch: Batch, toPhase: string, extra?: any) => {
    try {
      setPhaseMsg(`✓ Saved — moving to ${phaseLabels[toPhase]}...`);
      await api.patch(`/fermentation/batches/${batch.id}`, { phase: toPhase, ...extra });
      load(); loadLab();
      setTimeout(() => setPhaseMsg(null), 2000);
    } catch { setPhaseMsg(null); }
  };

  const deleteBatch = async (id: string) => {
    if (!confirm('Delete this batch and all its data?')) return;
    await api.delete(`/fermentation/batches/${id}`);
    load();
  };

  const addChemical = async () => {
    if (!chemForm.name.trim()) return alert('Enter chemical name');
    try {
      await api.post('/pre-fermentation/chemicals', { name: chemForm.name.trim(), unit: chemForm.unit });
      setChemForm({ name: '', unit: 'kg' });
      setShowNewChem(false);
      load();
    } catch (e: any) { alert(e?.response?.data?.error || 'Failed'); }
  };

  const setNow = () => setLabForm(f => ({ ...f, analysisTime: nowLocal() }));

  const updateBatchField = async (batchId: string, field: string, value: any) => {
    try { await api.patch(`/fermentation/batches/${batchId}`, { [field]: value }); load(); } catch {}
  };
  const updateBatchTime = async (batchId: string, field: string, value: string) => {
    try { await api.patch(`/fermentation/batches/${batchId}`, { [field]: value ? new Date(value).toISOString() : null }); load(); } catch {}
  };

  const selectChemical = (name: string) => {
    const chem = chemicals.find(c => c.name === name);
    setDoseForm(f => ({ ...f, chemicalName: name, unit: chem?.unit || 'kg' }));
  };
  useEffect(() => { if (chemicals.length > 0 && !doseForm.chemicalName) selectChemical(chemicals[0].name); }, [chemicals]);

  /* ─── Inline editable datetime ─── */
  const TimeField = ({ label, value, field, batchId, color = 'gray' }: { label: string; value: string | null; field: string; batchId: string; color?: string }) => {
    const [editing, setEditing] = useState(false);
    const [val, setVal] = useState(toLocal(value));
    useEffect(() => { setVal(toLocal(value)); }, [value]);
    return (
      <div className="flex items-center gap-1.5 text-sm">
        <Clock size={13} className={`text-${color}-500`} />
        <span className="text-gray-500">{label}:</span>
        {editing ? (
          <span className="flex items-center gap-1">
            <input type="datetime-local" value={val} onChange={e => setVal(e.target.value)} className="border rounded px-1.5 py-0.5 text-sm" />
            <button onClick={() => { updateBatchTime(batchId, field, val); setEditing(false); }} className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">✓</button>
            <button onClick={() => { setVal(toLocal(value)); setEditing(false); }} className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">✕</button>
          </span>
        ) : (
          <span className="flex items-center gap-1 cursor-pointer" onClick={() => setEditing(true)}>
            {value ? new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : <span className="text-gray-300 italic">not set</span>}
            <Pencil size={12} className="text-gray-400 hover:text-gray-600" />
          </span>
        )}
        {!value && !editing && (
          <button onClick={() => { const n = nowLocal(); setVal(n); updateBatchTime(batchId, field, n); }}
            className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded hover:bg-blue-100">Set Now</button>
        )}
      </div>
    );
  };

  const PhaseTimeline = ({ batch, showDurations = false }: { batch: Batch; showDurations?: boolean }) => {
    const ci = PHASES.indexOf(batch.phase as any);
    const t0v = t0(batch);
    return (
      <div className="my-3 px-4">
        <div className="flex items-center gap-1 flex-wrap">
          {PHASES.map((p, i) => {
            const pt = phaseTime(batch, p);
            const el = t0v && pt ? elapsed(t0v, pt) : '';
            const dur = phaseDuration(batch, p);
            return (
              <div key={p} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div className={`px-3 py-1 rounded-full text-xs font-medium ${i <= ci ? 'text-white' : 'text-gray-400 bg-gray-100'}`} style={i <= ci ? { backgroundColor: phaseColors[p] } : {}}>
                    {phaseLabels[p]}
                    {i === 0 && t0v && <span className="ml-1 opacity-75">T0</span>}
                    {i > 0 && el && <span className="ml-1 opacity-75 text-[10px]">{el}</span>}
                  </div>
                  {showDurations && dur && <span className="text-[10px] text-gray-500 mt-0.5">{dur}</span>}
                </div>
                {i < PHASES.length - 1 && <ArrowRight size={14} className="mx-1 text-gray-300" />}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const LabChart = ({ readings, t0v }: { readings: LabEntry[]; t0v?: string | null }) => {
    if (readings.length < 2) return null;
    const data = readings.map((r, i) => {
      let label = `#${i + 1}`;
      const ts = r.analysisTime || r.date;
      if (t0v && ts) { label = 'T0 ' + elapsed(t0v, ts); }
      return { name: label, Gravity: r.spGravity, pH: r.ph, RS: r.rs, Alcohol: r.alcohol, Temp: r.temp };
    });
    return (
      <div className="bg-white rounded-lg border p-3 mt-3">
        <h4 className="text-sm font-semibold mb-2">Lab Trend (from T0)</h4>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Legend />
            <Line type="monotone" dataKey="Gravity" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="pH" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="RS" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="Alcohol" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="Temp" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  };

  const numField = (label: string, value: string, onChange: (v: string) => void, step = '0.01', placeholder = '') => (
    <div><label className="text-xs text-gray-500">{label}</label><input type="number" step={step} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="w-full border rounded px-2 py-1.5 text-sm" /></div>
  );
  const txtField = (label: string, value: string, onChange: (v: string) => void, placeholder = '') => (
    <div><label className="text-xs text-gray-500">{label}</label><input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="w-full border rounded px-2 py-1.5 text-sm" /></div>
  );

  /* can dose in these phases */
  const canDose = activeBatch && ['FILLING', 'REACTION', 'RETENTION'].includes(activeBatch.phase);
  /* can add lab readings in ANY active phase */
  const canLab = activeBatch && activeBatch.phase !== 'DONE';
  /* quick update modal */
  const [showQuickUpdate, setShowQuickUpdate] = useState(false);
  const [quForm, setQuForm] = useState({ fermLevel: '', spGravity: '', ph: '', rs: '', temp: '' });
  const openQuickUpdate = () => {
    if (!activeBatch) return;
    setQuForm({
      fermLevel: activeBatch.fermLevel != null ? String(activeBatch.fermLevel) : '',
      spGravity: activeBatch.setupGravity != null ? String(activeBatch.setupGravity) : '',
      ph: '', rs: activeBatch.setupRs != null ? String(activeBatch.setupRs) : '', temp: ''
    });
    setShowQuickUpdate(true);
  };
  const saveQuickUpdate = async () => {
    if (!activeBatch) return;
    try {
      // Update batch fields (level, SG, RS)
      const batchData: any = {};
      if (quForm.fermLevel) batchData.fermLevel = quForm.fermLevel;
      if (quForm.spGravity) batchData.setupGravity = quForm.spGravity;
      if (quForm.rs) batchData.setupRs = quForm.rs;
      if (Object.keys(batchData).length > 0) {
        await api.patch(`/fermentation/batches/${activeBatch.id}`, batchData);
      }
      // Also log a lab entry with all values
      const fd = new FormData();
      fd.append('date', new Date().toISOString());
      fd.append('analysisTime', new Date().toISOString());
      fd.append('batchNo', String(activeBatch.batchNo));
      fd.append('fermenterNo', String(activeBatch.fermenterNo));
      fd.append('status', activeBatch.phase);
      if (quForm.fermLevel) fd.append('level', quForm.fermLevel);
      if (quForm.spGravity) fd.append('spGravity', quForm.spGravity);
      if (quForm.ph) fd.append('ph', quForm.ph);
      if (quForm.rs) fd.append('rs', quForm.rs);
      if (quForm.temp) fd.append('temp', quForm.temp);
      await api.post('/fermentation', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      // Auto-advance: SG ≤ 1.000 during REACTION → move to RETENTION
      const sg = quForm.spGravity ? parseFloat(quForm.spGravity) : null;
      if (sg != null && sg <= 1.0 && activeBatch.phase === 'REACTION') {
        await api.patch(`/fermentation/batches/${activeBatch.id}`, {
          phase: 'RETENTION',
          retentionStartTime: new Date().toISOString(),
          setupGravity: sg
        });
        setPhaseMsg('✓ SG reached 1.000 — auto-moved to Retention');
        setTimeout(() => setPhaseMsg(null), 3000);
      }
      setShowQuickUpdate(false);
      load(); loadLab();
    } catch {}
  };

  return (
    <div className="space-y-5">
      {/* HEADER */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 rounded-xl p-5 text-white">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><FlaskConical size={24} /> Fermentation</h1>
            <p className="text-emerald-200 text-sm mt-1">{batches.length} batches | {batches.filter(b => b.phase !== 'DONE').length} active</p>
          </div>
          {tab !== 5 && <button onClick={() => setShowNewBatch(true)} className="bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1"><Plus size={16} /> New Batch</button>}
        </div>
      </div>

      {/* FERMENTER TABS */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        {FERMENTERS.map(n => {
          const active = batches.find(b => b.fermenterNo === n && b.phase !== 'DONE');
          return (
            <button key={n} onClick={() => setTab(n)}
              className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-medium transition-all ${tab === n ? 'bg-white shadow text-emerald-700' : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'}`}>
              <div className="flex items-center justify-center gap-2">
                <span className="font-bold" style={{ color: F_COLORS[n] }}>{F_LABELS[n]}</span>
                {active && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: phaseColors[active.phase] }}>
                    #{active.batchNo}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* ═══════ BEER WELL (tab 5) — live status, no batches ═══════ */}
      {tab === 5 ? (
        <BeerWellPanel />
      ) : (
      <>
      {/* NEW BATCH FORM */}
      {showNewBatch && (
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-emerald-500">
          <h3 className="font-semibold mb-3">Start New Batch — {F_LABELS[tab]}</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {numField('Batch No', nbForm.batchNo, v => setNbForm(f => ({ ...f, batchNo: v })), '1', 'e.g. 42')}
            <div>
              <label className="text-xs text-gray-500">Ferm Level %</label>
              <input type="number" step="1" value={nbForm.fermLevel} onChange={e => setNbForm(f => ({ ...f, fermLevel: e.target.value }))}
                placeholder="e.g. 80" className="w-full border rounded px-2 py-1.5 text-sm" />
              {nbForm.fermLevel && (
                <span className="text-xs text-emerald-600 mt-0.5 block">
                  = {(parseFloat(nbForm.fermLevel) / 100 * FERM_CAPACITY_M3).toFixed(0)} M³ ({(parseFloat(nbForm.fermLevel) / 100 * FERM_CAPACITY_M3 * 1000).toFixed(0)} L)
                </span>
              )}
            </div>
            {numField('Setup Gravity', nbForm.setupGravity, v => setNbForm(f => ({ ...f, setupGravity: v })), '0.001')}
            {txtField('Remarks', nbForm.remarks, v => setNbForm(f => ({ ...f, remarks: v })))}
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={createBatch} className="bg-emerald-600 text-white px-4 py-1.5 rounded text-sm hover:bg-emerald-700">Create Batch</button>
            <button onClick={() => setShowNewBatch(false)} className="bg-gray-200 px-4 py-1.5 rounded text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* ACTIVE BATCH */}
      {activeBatch ? (
        <div className="bg-white rounded-lg shadow border">
          <div className="p-4 border-b flex justify-between items-start">
            <div>
              <h2 className="text-lg font-bold">Batch #{activeBatch.batchNo} — {F_LABELS[activeBatch.fermenterNo]}</h2>
              <div className="text-sm text-gray-500 flex gap-3 mt-1 flex-wrap">
                {activeBatch.fermLevel != null && (
                  <span>Level: {activeBatch.fermLevel}% ({(activeBatch.fermLevel / 100 * FERM_CAPACITY_M3).toFixed(0)} M³)</span>
                )}
                {activeBatch.setupGravity && <span>SG: {activeBatch.setupGravity}</span>}
                {activeBatch.beerWellNo && <span>→ Beer Well #{activeBatch.beerWellNo}</span>}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2">
                {activeBatch.pfTransferTime && <TimeField label="PF Transfer" value={activeBatch.pfTransferTime} field="pfTransferTime" batchId={activeBatch.id} color="orange" />}
                {activeBatch.fillingStartTime && <TimeField label="Filling Start" value={activeBatch.fillingStartTime} field="fillingStartTime" batchId={activeBatch.id} color="indigo" />}
                {activeBatch.fillingEndTime && <TimeField label="Filling End" value={activeBatch.fillingEndTime} field="fillingEndTime" batchId={activeBatch.id} color="indigo" />}
                {activeBatch.reactionStartTime && <TimeField label="Reaction Start" value={activeBatch.reactionStartTime} field="reactionStartTime" batchId={activeBatch.id} color="emerald" />}
                {activeBatch.retentionStartTime && <TimeField label="Retention Start" value={activeBatch.retentionStartTime} field="retentionStartTime" batchId={activeBatch.id} color="cyan" />}
                {['TRANSFER','CIP','DONE'].includes(activeBatch.phase) && <TimeField label="Transfer" value={activeBatch.transferTime} field="transferTime" batchId={activeBatch.id} color="blue" />}
                {['CIP','DONE'].includes(activeBatch.phase) && <TimeField label="CIP Start" value={activeBatch.cipStartTime} field="cipStartTime" batchId={activeBatch.id} color="purple" />}
                {activeBatch.phase === 'DONE' && <TimeField label="CIP End" value={activeBatch.cipEndTime} field="cipEndTime" batchId={activeBatch.id} color="gray" />}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => {
                const b = activeBatch;
                const dosingList = b.dosings.map(d => `  ${d.chemicalName}: ${d.quantity} ${d.unit}`).join('\n');
                const t = `*FERMENTATION — Batch #${b.batchNo} ${F_LABELS[b.fermenterNo] || 'F' + b.fermenterNo}*\nPhase: ${phaseLabels[b.phase]}${b.fillingStartTime ? '\nFilling: ' + new Date(b.fillingStartTime).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : ''}${b.fermLevel != null ? `\nLevel: ${b.fermLevel}% (${(b.fermLevel / 100 * FERM_CAPACITY_M3).toFixed(0)} M³)` : ''}${b.setupGravity ? ' | SG: ' + b.setupGravity : ''}${b.setupRs ? ' | RS: ' + b.setupRs + '%' : ''}${b.dosings.length > 0 ? '\n\n*Dosing* (' + b.dosings.length + ')\n' + dosingList : ''}${b.finalAlcohol ? '\n\n*Final*\nAlcohol: ' + b.finalAlcohol + '%' : ''}${b.totalHours ? ' | Hours: ' + b.totalHours : ''}${b.remarks ? '\n\nRemarks: ' + b.remarks : ''}`;
                if (navigator.share) { navigator.share({ text: t }).catch(() => { window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(t)}`, '_blank'); }); } else { window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(t)}`, '_blank'); }
              }} className="text-white/80 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition" title="Share on WhatsApp">
                <Share2 size={18} />
              </button>
              <span className="px-3 py-1 rounded-full text-sm font-bold text-white" style={{ backgroundColor: phaseColors[activeBatch.phase] }}>{phaseLabels[activeBatch.phase]}</span>
            </div>
          </div>
          <PhaseTimeline batch={activeBatch} />
          {phaseMsg && (
            <div className="mx-4 px-3 py-2 bg-green-50 border border-green-200 rounded text-green-700 text-sm font-medium flex items-center gap-2 animate-pulse">{phaseMsg}</div>
          )}
          <div className="p-4 space-y-4">

            {/* ═══ QUICK UPDATE — always available ═══ */}
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-3 border border-blue-200">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-semibold text-blue-800 flex items-center gap-1"><Pencil size={14} /> Quick Update</h3>
                <button onClick={openQuickUpdate} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-1.5 shadow-sm">
                  <Pencil size={14} /> Update Readings
                </button>
              </div>
              <div className="flex gap-4 flex-wrap text-sm text-gray-600 mt-1">
                {activeBatch.fermLevel != null && <span>Level: <b className="text-blue-700">{activeBatch.fermLevel}%</b> ({(activeBatch.fermLevel / 100 * FERM_CAPACITY_M3).toFixed(0)} M³)</span>}
                {activeBatch.setupGravity != null && <span>SG: <b className="text-indigo-700">{activeBatch.setupGravity}</b></span>}
                {activeBatch.setupRs != null && <span>RS: <b className="text-emerald-700">{activeBatch.setupRs}%</b></span>}
                {activeBatch.setupRst != null && <span>RST: <b className="text-teal-700">{activeBatch.setupRst}%</b></span>}
              </div>
            </div>
            {/* Quick Update Modal */}
            {showQuickUpdate && (
              <div className="fixed inset-0 bg-black/40 z-50 flex items-end md:items-center justify-center" onClick={() => setShowQuickUpdate(false)}>
                <div className="bg-white rounded-t-2xl md:rounded-2xl w-full max-w-md p-5 shadow-2xl animate-in" onClick={e => e.stopPropagation()}>
                  <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><Pencil size={18} /> Update Readings — Batch #{activeBatch.batchNo}</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-500 font-medium">Level %</label>
                      <input type="number" step="0.1" value={quForm.fermLevel} onChange={e => setQuForm(f => ({ ...f, fermLevel: e.target.value }))} placeholder="e.g. 80" className="w-full border-2 border-gray-200 rounded-lg px-3 py-2.5 text-base focus:border-blue-400 outline-none" />
                      {quForm.fermLevel && <span className="text-xs text-blue-600">{(parseFloat(quForm.fermLevel) / 100 * FERM_CAPACITY_M3).toFixed(0)} M³</span>}
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 font-medium">SG (Gravity)</label>
                      <input type="number" step="0.001" value={quForm.spGravity} onChange={e => setQuForm(f => ({ ...f, spGravity: e.target.value }))} placeholder="e.g. 1.044" className="w-full border-2 border-gray-200 rounded-lg px-3 py-2.5 text-base focus:border-indigo-400 outline-none" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 font-medium">pH</label>
                      <input type="number" step="0.01" value={quForm.ph} onChange={e => setQuForm(f => ({ ...f, ph: e.target.value }))} placeholder="e.g. 4.5" className="w-full border-2 border-gray-200 rounded-lg px-3 py-2.5 text-base focus:border-amber-400 outline-none" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 font-medium">RS %</label>
                      <input type="number" step="0.01" value={quForm.rs} onChange={e => setQuForm(f => ({ ...f, rs: e.target.value }))} placeholder="e.g. 2.5" className="w-full border-2 border-gray-200 rounded-lg px-3 py-2.5 text-base focus:border-emerald-400 outline-none" />
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs text-gray-500 font-medium">Temp °C</label>
                      <input type="number" step="0.1" value={quForm.temp} onChange={e => setQuForm(f => ({ ...f, temp: e.target.value }))} placeholder="e.g. 32" className="w-full border-2 border-gray-200 rounded-lg px-3 py-2.5 text-base focus:border-purple-400 outline-none" />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-4">
                    <button onClick={saveQuickUpdate} className="flex-1 bg-blue-600 text-white py-3 rounded-xl text-base font-semibold hover:bg-blue-700 shadow-sm">Save & Log</button>
                    <button onClick={() => setShowQuickUpdate(false)} className="px-6 py-3 bg-gray-100 text-gray-600 rounded-xl text-base font-medium hover:bg-gray-200">Cancel</button>
                  </div>
                  <p className="text-xs text-gray-400 mt-2 text-center">Updates batch + logs a lab reading</p>
                </div>
              </div>
            )}

            {/* ═══ DOSING (available in FILLING, REACTION, RETENTION) ═══ */}
            {canDose && (
              <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
                <h3 className="font-semibold text-amber-800 flex items-center gap-1 mb-2"><Beaker size={16} /> Chemical Dosing</h3>
                {activeBatch.dosings.length > 0 && (
                  <table className="w-full text-sm mb-3">
                    <thead><tr className="text-xs text-gray-500"><th className="text-left py-1">Chemical</th><th className="text-right">Qty</th><th className="text-right">Unit</th><th className="text-right">Level%</th><th className="text-right">Time</th><th className="text-right">T0+</th><th></th></tr></thead>
                    <tbody>{activeBatch.dosings.map(d => (
                      <tr key={d.id} className="border-t">
                        <td className="py-1">{d.chemicalName}</td><td className="text-right">{d.quantity}</td><td className="text-right">{d.unit}</td>
                        <td className="text-right text-xs text-emerald-600">{d.level != null ? `${d.level}%` : '-'}</td>
                        <td className="text-right text-xs text-gray-400">{new Date(d.addedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}</td>
                        <td className="text-right text-xs font-medium text-indigo-600">{elapsed(t0(activeBatch), d.addedAt)}</td>
                        <td className="text-right"><button onClick={() => { api.delete(`/fermentation/dosing/${d.id}`); load(); }} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button></td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
                <div className="space-y-2">
                  <label className="text-xs text-gray-500">Select Chemical</label>
                  <div className="flex flex-wrap gap-1.5">
                    {chemicals.map(c => (
                      <button key={c.id} onClick={() => selectChemical(c.name)}
                        className={`px-3 py-1.5 rounded text-sm border transition-colors ${doseForm.chemicalName === c.name ? 'bg-amber-500 text-white border-amber-500 font-medium' : 'bg-white text-gray-700 border-gray-300 hover:border-amber-400 hover:bg-amber-50'}`}>
                        {c.name}
                      </button>
                    ))}
                    <button onClick={() => setShowNewChem(true)} className="px-3 py-1.5 rounded text-sm border border-dashed border-amber-400 text-amber-600 hover:bg-amber-50">+ New</button>
                  </div>
                  <div className="flex gap-2 items-end flex-wrap">
                    {numField('Quantity', doseForm.quantity, v => setDoseForm(f => ({ ...f, quantity: v })), '0.1')}
                    <div>
                      <label className="text-xs text-gray-500">Unit</label>
                      <select value={doseForm.unit} onChange={e => setDoseForm(f => ({ ...f, unit: e.target.value }))} className="border rounded px-2 py-1.5 text-sm">
                        <option value="kg">kg</option><option value="ltr">ltr</option><option value="gm">gm</option><option value="ml">ml</option>
                        <option value="ppm">ppm</option><option value="kg/ton">kg/ton starch</option><option value="LPH">LPH</option>
                      </select>
                    </div>
                    <button onClick={addDosing} className="bg-amber-500 text-white px-3 py-1.5 rounded text-sm hover:bg-amber-600 mb-0.5">Add</button>
                  </div>
                </div>
                {showNewChem && (
                  <div className="mt-2 flex gap-2 items-end bg-white p-2 rounded border">
                    {txtField('Chemical Name', chemForm.name, v => setChemForm(f => ({ ...f, name: v })), 'e.g. Yeast')}
                    <div>
                      <label className="text-xs text-gray-500">Unit</label>
                      <select value={chemForm.unit} onChange={e => setChemForm(f => ({ ...f, unit: e.target.value }))} className="border rounded px-2 py-1.5 text-sm">
                        <option value="kg">kg</option><option value="ltr">ltr</option><option value="gm">gm</option>
                      </select>
                    </div>
                    <button onClick={addChemical} className="bg-green-600 text-white px-3 py-1.5 rounded text-sm">Save</button>
                    <button onClick={() => setShowNewChem(false)} className="bg-gray-200 px-3 py-1.5 rounded text-sm">×</button>
                  </div>
                )}
              </div>
            )}

            {/* ═══ LAB READINGS (FILLING through RETENTION) ═══ */}
            {canLab && (
              <div className="bg-teal-50 rounded-lg p-3 border border-teal-200">
                <h3 className="font-semibold text-teal-800 flex items-center gap-1 mb-2">
                  <FlaskConical size={16} /> Lab Readings — Batch #{activeBatch.batchNo}
                  {activeBatch.fermLevel != null && (
                    <span className="ml-3 text-sm font-normal text-teal-600 bg-teal-100 px-2 py-0.5 rounded">
                      Current Level: {activeBatch.fermLevel}% ({(activeBatch.fermLevel / 100 * FERM_CAPACITY_M3).toFixed(0)} M³)
                    </span>
                  )}
                </h3>
                {batchLab.length > 0 && (
                  <div className="overflow-x-auto mb-3">
                    <table className="w-full text-sm">
                      <thead><tr className="text-xs text-gray-500">{['Date/Time', 'T0+', 'Level%', 'Gravity', 'pH', 'RS%', 'RST%', 'Alc%', 'DS%', 'VFA', 'Temp', 'SpLoss', 'Phase', ''].map(h => <th key={h} className="text-left py-1 px-1">{h}</th>)}</tr></thead>
                      <tbody>{batchLab.map(r => (
                        <tr key={r.id} className="border-t">
                          <td className="px-1 py-1 text-xs whitespace-nowrap">{r.analysisTime ? new Date(r.analysisTime).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : r.analysisTime}</td>
                          <td className="px-1 text-xs font-medium text-indigo-600">{elapsed(t0(activeBatch), r.analysisTime || r.date)}</td>
                          <td className="px-1 text-xs text-emerald-600 font-medium">{r.level != null ? `${r.level}%` : '-'}</td>
                          <td className="px-1">{r.spGravity ?? '-'}</td><td className="px-1">{r.ph ?? '-'}</td><td className="px-1">{r.rs ?? '-'}</td><td className="px-1">{r.rst ?? '-'}</td><td className="px-1">{r.alcohol ?? '-'}</td><td className="px-1">{r.ds ?? '-'}</td><td className="px-1">{r.vfaPpa ?? '-'}</td><td className="px-1">{r.temp ?? '-'}</td>
                          <td className="px-1 text-orange-600 font-medium">{r.spentLoss != null ? r.spentLoss : '-'}{r.spentLossPhotoUrl && <span title="Has photo">📷</span>}</td>
                          <td className="px-1"><span className="text-[10px] font-bold text-white px-1.5 py-0.5 rounded" style={{ backgroundColor: phaseColors[r.status] || '#6b7280' }}>{phaseLabels[r.status] || r.status}</span></td>
                          <td className="px-1"><button onClick={() => { api.delete(`/fermentation/${r.id}`); loadLab(); }} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
                <LabChart readings={batchLab} t0v={t0(activeBatch)} />
                <div className="grid grid-cols-2 md:grid-cols-6 lg:grid-cols-12 gap-2 mt-3">
                  <div className="col-span-3">
                    <label className="text-xs text-gray-500">Date & Time</label>
                    <div className="flex gap-1.5 items-center">
                      <input type="datetime-local" value={labForm.analysisTime} onChange={e => setLabForm(f => ({ ...f, analysisTime: e.target.value }))} className="flex-1 border rounded px-2 py-1.5 text-sm" />
                      <button onClick={setNow} className="text-xs bg-blue-50 text-blue-600 px-2 py-1.5 rounded border border-blue-200 hover:bg-blue-100 whitespace-nowrap">Now</button>
                    </div>
                  </div>
                  {numField('Level%', labForm.level, v => setLabForm(f => ({ ...f, level: v })), '1')}
                  {numField('Gravity', labForm.spGravity, v => setLabForm(f => ({ ...f, spGravity: v })), '0.001')}
                  {numField('pH', labForm.ph, v => setLabForm(f => ({ ...f, ph: v })), '0.01')}
                  {numField('RS%', labForm.rs, v => setLabForm(f => ({ ...f, rs: v })), '0.01')}
                  {numField('RST%', labForm.rst, v => setLabForm(f => ({ ...f, rst: v })), '0.01')}
                  {numField('Alc%', labForm.alcohol, v => setLabForm(f => ({ ...f, alcohol: v })), '0.01')}
                  {numField('DS%', labForm.ds, v => setLabForm(f => ({ ...f, ds: v })), '0.01')}
                  {numField('VFA', labForm.vfaPpa, v => setLabForm(f => ({ ...f, vfaPpa: v })), '0.01')}
                  {numField('Temp°C', labForm.temp, v => setLabForm(f => ({ ...f, temp: v })), '0.1')}
                  <div>
                    <label className="text-xs text-gray-500">Phase</label>
                    <div className="px-3 py-1.5 rounded text-sm font-bold text-white text-center" style={{ backgroundColor: phaseColors[activeBatch.phase] }}>
                      {phaseLabels[activeBatch.phase]}
                    </div>
                  </div>
                  <div><label className="text-xs text-gray-500">Remarks</label><input value={labForm.remarks} onChange={e => setLabForm(f => ({ ...f, remarks: e.target.value }))} className="w-full border rounded px-2 py-1.5 text-sm" /></div>
                </div>
                {/* Spent Loss */}
                <div className="mt-3 p-3 border border-orange-200 rounded-lg bg-orange-50/30">
                  <label className="block text-xs font-semibold text-orange-700 mb-2">Spent Loss</label>
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="w-32">
                      <input type="number" step="0.01" placeholder="Loss %" value={labForm.spentLoss}
                        onChange={e => setLabForm(f => ({ ...f, spentLoss: e.target.value }))}
                        className="w-full border border-orange-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-orange-400 outline-none" />
                    </div>
                    <input ref={slInputRef} type="file" accept="image/*" capture="environment" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) { setSlPhoto(f); setSlPreview(URL.createObjectURL(f)); } }} />
                    <button type="button" onClick={() => slInputRef.current?.click()}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-white text-orange-600 border border-orange-300 hover:bg-orange-50 transition">
                      <Camera size={16} /> {slPhoto ? 'Change Photo' : 'Take Photo'}
                    </button>
                    {slPreview && <img src={slPreview} alt="Spent loss" className="w-16 h-16 object-cover rounded border" />}
                  </div>
                </div>
                <button onClick={addLabReading} className="mt-2 bg-teal-600 text-white px-4 py-1.5 rounded text-sm hover:bg-teal-700">Add Reading</button>
              </div>
            )}

            {/* ═══ PHASE ACTIONS ═══ */}
            <div className="flex gap-2 flex-wrap items-center">
              {activeBatch.phase === 'PF_TRANSFER' && (
                <>
                  <div className="flex items-center gap-1.5">
                    <Clock size={14} className="text-orange-600" />
                    <input type="datetime-local" id="pfFillInput" defaultValue={nowLocal()} className="border border-orange-300 rounded px-2 py-1.5 text-sm" />
                  </div>
                  <button onClick={() => {
                    const inp = (document.getElementById('pfFillInput') as HTMLInputElement)?.value;
                    const dt = inp ? new Date(inp).toISOString() : new Date().toISOString();
                    advancePhase(activeBatch, 'FILLING', { fillingStartTime: dt });
                  }} className="bg-orange-600 text-white px-4 py-2 rounded text-sm hover:bg-orange-700 font-medium">PF Transfer Done → Start Filling</button>
                </>
              )}
              {activeBatch.phase === 'FILLING' && (
                <>
                  <div className="flex items-center gap-1.5">
                    <Clock size={14} className="text-emerald-600" />
                    <input type="datetime-local" id="fillingEndInput" defaultValue={nowLocal()} className="border border-emerald-300 rounded px-2 py-1.5 text-sm" />
                  </div>
                  <button onClick={() => {
                    const inp = (document.getElementById('fillingEndInput') as HTMLInputElement)?.value;
                    const dt = inp ? new Date(inp).toISOString() : new Date().toISOString();
                    advancePhase(activeBatch, 'REACTION', { fillingEndTime: dt });
                  }} className="bg-emerald-600 text-white px-4 py-2 rounded text-sm hover:bg-emerald-700 font-medium">Finish Filling → Reaction</button>
                </>
              )}
              {activeBatch.phase === 'REACTION' && (
                <>
                  <div className="flex items-center gap-1.5">
                    <Clock size={14} className="text-cyan-600" />
                    <input type="datetime-local" id="reactionEndInput" defaultValue={nowLocal()} className="border border-cyan-300 rounded px-2 py-1.5 text-sm" />
                  </div>
                  <button onClick={() => {
                    const inp = (document.getElementById('reactionEndInput') as HTMLInputElement)?.value;
                    const dt = inp ? new Date(inp).toISOString() : new Date().toISOString();
                    advancePhase(activeBatch, 'RETENTION', { retentionStartTime: dt });
                  }} className="bg-cyan-600 text-white px-4 py-2 rounded text-sm hover:bg-cyan-700 font-medium">Finish Reaction → Retention</button>
                </>
              )}
              {activeBatch.phase === 'RETENTION' && (
                <>
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-gray-500">Beer Well #</label>
                    <input type="number" min="1" value={activeBatch.beerWellNo || ''} onChange={e => updateBatchField(activeBatch.id, 'beerWellNo', e.target.value)}
                      className="w-16 border rounded px-2 py-1.5 text-sm" placeholder="#" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock size={14} className="text-blue-600" />
                    <input type="datetime-local" id="transferTimeInput" defaultValue={nowLocal()} className="border border-blue-300 rounded px-2 py-1.5 text-sm" />
                  </div>
                  <button onClick={() => {
                    const inp = (document.getElementById('transferTimeInput') as HTMLInputElement)?.value;
                    advancePhase(activeBatch, 'TRANSFER', { transferTime: inp ? new Date(inp).toISOString() : new Date().toISOString() });
                  }} className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 flex items-center gap-1"><ArrowRight size={16} /> Transfer to Beer Well</button>
                </>
              )}
              {activeBatch.phase === 'TRANSFER' && (
                <>
                  <TimeField label="Transfer" value={activeBatch.transferTime} field="transferTime" batchId={activeBatch.id} color="blue" />
                  <div className="flex items-center gap-1.5">
                    <Clock size={14} className="text-purple-600" />
                    <input type="datetime-local" id="cipStartInput" defaultValue={nowLocal()} className="border border-purple-300 rounded px-2 py-1.5 text-sm" />
                  </div>
                  <button onClick={() => {
                    const inp = (document.getElementById('cipStartInput') as HTMLInputElement)?.value;
                    advancePhase(activeBatch, 'CIP', { cipStartTime: inp ? new Date(inp).toISOString() : new Date().toISOString() });
                  }} className="bg-purple-600 text-white px-4 py-2 rounded text-sm hover:bg-purple-700 flex items-center gap-1"><RotateCcw size={16} /> Start CIP</button>
                </>
              )}
              {activeBatch.phase === 'CIP' && (
                <>
                  <TimeField label="CIP Start" value={activeBatch.cipStartTime} field="cipStartTime" batchId={activeBatch.id} color="purple" />
                  <div className="flex items-center gap-1.5">
                    <Clock size={14} className="text-gray-600" />
                    <input type="datetime-local" id="cipEndInput" defaultValue={nowLocal()} className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
                  </div>
                  <button onClick={() => {
                    const inp = (document.getElementById('cipEndInput') as HTMLInputElement)?.value;
                    advancePhase(activeBatch, 'DONE', { cipEndTime: inp ? new Date(inp).toISOString() : new Date().toISOString() });
                  }} className="bg-gray-600 text-white px-4 py-2 rounded text-sm hover:bg-gray-700">End CIP → Done</button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-400">
          <FlaskConical size={48} className="mx-auto mb-3 opacity-30" />
          <p>No active batch on {F_LABELS[tab]}</p>
          <button onClick={() => setShowNewBatch(true)} className="mt-3 bg-emerald-600 text-white px-4 py-2 rounded text-sm hover:bg-emerald-700">Start New Batch</button>
        </div>
      )}

      {/* BATCH HISTORY — all fermenters */}
      <div className="bg-white rounded-xl shadow-sm border">
        <div className="p-4 border-b bg-gradient-to-r from-gray-50 to-white flex items-center justify-between">
          <h2 className="font-bold text-lg flex items-center gap-2"><BarChart3 size={18} className="text-emerald-600" /> Batch History</h2>
          <span className="text-sm text-gray-400">{batches.filter(b => b.phase === 'DONE').length} completed batches</span>
        </div>
        {batches.length === 0 ? (
          <p className="p-8 text-gray-400 text-sm text-center">No batches yet.</p>
        ) : (
          <div className="divide-y">
            {[...batches].sort((a, c) => new Date(c.fillingStartTime || c.createdAt).getTime() - new Date(a.fillingStartTime || a.createdAt).getTime()).map(b => (
              <BatchHistoryCard key={b.id} batch={b} isActive={b.id === activeBatch?.id} isExpanded={expandedBatch === b.id}
                onToggle={() => setExpandedBatch(expandedBatch === b.id ? null : b.id)}
                onDelete={() => deleteBatch(b.id)} TimeField={TimeField} />
            ))}
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}
