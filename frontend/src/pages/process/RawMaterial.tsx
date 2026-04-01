import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { FlaskConical, Plus, X, Share2, Save, Loader2, Search, Trash2, ChevronDown, ChevronUp, Pencil } from 'lucide-react';
import ProcessPage from './ProcessPage';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

interface Entry {
  id: string; date: string; vehicleCode: string; vehicleNo: string;
  moisture: number; starch: number; fungus: number; immature: number;
  damaged: number; waterDamaged: number; tfm: number; material?: string; remark: string | null;
}

// --- Lab Testing (Weighbridge Trucks) ---
interface GrainTruck {
  id: string;
  vehicleNo: string;
  supplier: string;
  weightGross: number;
  weightTare: number;
  weightNet: number;
  moisture: number | null;
  starchPercent: number | null;
  damagedPercent: number | null;
  foreignMatter: number | null;
  quarantine: boolean;
  quarantineReason: string | null;
  quarantineWeight: number | null;
  date: string;
  remarks: string | null;
  uidRst: string;
}

const FUEL_KEYWORDS = ['coal', 'husk', 'bagasse', 'mustard', 'furnace', 'diesel', 'hsd', 'lfo', 'hfo', 'firewood', 'biomass'];
function isFuelTruck(t: GrainTruck): boolean {
  const text = (t.remarks || '').toLowerCase();
  return FUEL_KEYWORDS.some(kw => text.includes(kw));
}

interface LabStats {
  pending: number;
  passedToday: number;
  failedToday: number;
  quarantineTotal: number;
}

interface LabTestForm {
  moisture: string;
  starchPercent: string;
  damagedPercent: string;
  foreignMatter: string;
  remarks: string;
}

const emptyLabForm: LabTestForm = { moisture: '', starchPercent: '', damagedPercent: '', foreignMatter: '', remarks: '' };

const MATERIALS = ['Corn', 'Rice', 'Broken Rice', 'Sorghum', 'Other'];

function avg(arr: number[]) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function fmt(n: number) { return n ? n.toFixed(1) : '—'; }
function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function isToday(d: string) { return isoDate(new Date(d)) === isoDate(new Date()); }
function isYesterday(d: string) { const y = new Date(); y.setDate(y.getDate() - 1); return isoDate(new Date(d)) === isoDate(y); }

export default function RawMaterial() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [entries, setEntries] = useState<Entry[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);

  const [form, setForm] = useState({
    date: isoDate(new Date()), vehicleCode: '', vehicleNo: '', material: 'Corn',
    moisture: '', starch: '', fungus: '', immature: '', damaged: '', waterDamaged: '', tfm: '', remark: ''
  });

  // --- Lab Testing State ---
  const [labPending, setLabPending] = useState<GrainTruck[]>([]);
  const [labHistory, setLabHistory] = useState<GrainTruck[]>([]);
  const [labStats, setLabStats] = useState<LabStats>({ pending: 0, passedToday: 0, failedToday: 0, quarantineTotal: 0 });
  const [labTestingId, setLabTestingId] = useState<string | null>(null);
  const [labForm, setLabForm] = useState<LabTestForm>(emptyLabForm);
  const [labSubmitting, setLabSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<'lab-analysis' | 'wb-trucks'>('wb-trucks');
  const labTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLabData = useCallback(async () => {
    try {
      const [pRes, hRes, sRes] = await Promise.all([
        api.get<GrainTruck[]>('/lab-testing/pending'),
        api.get<GrainTruck[]>('/lab-testing/history'),
        api.get<LabStats>('/lab-testing/stats'),
      ]);
      setLabPending(pRes.data);
      setLabHistory(hRes.data);
      setLabStats(sRes.data);
    } catch {
      // handled by api interceptor
    }
  }, []);

  useEffect(() => {
    fetchLabData();
    labTimerRef.current = setInterval(fetchLabData, 30000);
    return () => { if (labTimerRef.current) clearInterval(labTimerRef.current); };
  }, [fetchLabData]);

  const openLabTest = (id: string) => {
    setLabTestingId(id === labTestingId ? null : id);
    setLabForm(emptyLabForm);
  };

  const submitLabResult = async (status: 'PASS' | 'FAIL') => {
    if (!labTestingId) return;
    const moisture = parseFloat(labForm.moisture);
    if (isNaN(moisture)) return;
    setLabSubmitting(true);
    try {
      const body: Record<string, unknown> = { status, moisture };
      if (labForm.starchPercent) body.starchPercent = parseFloat(labForm.starchPercent);
      if (labForm.damagedPercent) body.damagedPercent = parseFloat(labForm.damagedPercent);
      if (labForm.foreignMatter) body.foreignMatter = parseFloat(labForm.foreignMatter);
      if (labForm.remarks) body.remarks = labForm.remarks;
      await api.put(`/lab-testing/${labTestingId}`, body);
      setLabTestingId(null);
      setLabForm(emptyLabForm);
      await fetchLabData();
    } catch {
      // handled by interceptor
    } finally {
      setLabSubmitting(false);
    }
  };

  const fmtLabDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'Asia/Kolkata' });
  const fmtLabTime = (d: string) => new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
  const fmtWt = (n: number) => n ? n.toFixed(2) : '--';

  // Total Damage = all bad params (everything except moisture & starch)
  const totalDamage = useMemo(() => {
    const vals = [form.damaged, form.tfm, form.fungus, form.immature, form.waterDamaged];
    const sum = vals.reduce((s, v) => s + (parseFloat(v) || 0), 0);
    return sum;
  }, [form.damaged, form.tfm, form.fungus, form.immature, form.waterDamaged]);

  // For entries in history
  const entryTotalDamage = (e: Entry) => (e.damaged || 0) + (e.tfm || 0) + (e.fungus || 0) + (e.immature || 0) + (e.waterDamaged || 0);

  const load = () => api.get('/raw-material').then(r => setEntries(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setForm(f => ({ ...f, vehicleCode: '', vehicleNo: '', moisture: '', starch: '', fungus: '', immature: '', damaged: '', waterDamaged: '', tfm: '', remark: '', material: 'Corn' }));
    setShowForm(false); setShowPreview(false); setEditId(null);
  };

  const save = async (share: boolean = false) => {
    if (!form.vehicleCode.trim()) { setMsg({ type: 'err', text: 'RST number required' }); return; }
    setSaving(true); setMsg(null);
    try {
      if (editId) {
        await api.put(`/raw-material/${editId}`, form);
      } else {
        await api.post('/raw-material', form);
      }
      setMsg({ type: 'ok', text: editId ? 'Updated!' : 'Saved!' }); resetForm(); load();
      if (share) {
        const text = `*Lab Analysis - ${form.material}*\nRST: ${form.vehicleCode}${form.vehicleNo ? '\nVehicle: ' + form.vehicleNo : ''}\n📅 ${form.date}\n\nMoisture: ${form.moisture || '-'}%\nStarch: ${form.starch || '-'}%\nDamaged: ${form.damaged || '-'}%\nTFM: ${form.tfm || '-'}%\nFungus: ${form.fungus || '-'}%\nImmature: ${form.immature || '-'}%\nWater Dam: ${form.waterDamaged || '-'}%\n*Total Damage: ${totalDamage.toFixed(1)}%*${form.remark ? '\n\nRemark: ' + form.remark : ''}`;
        await doShare(text);
      }
    } catch { setMsg({ type: 'err', text: 'Save failed' }); }
    setSaving(false);
  };

  const del = async (id: string) => { if (!confirm('Delete?')) return; await api.delete(`/raw-material/${id}`); load(); setSelectedEntry(null); };
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const editEntry = (e: Entry) => {
    setEditId(e.id);
    setForm({
      date: isoDate(new Date(e.date)),
      vehicleCode: e.vehicleCode,
      vehicleNo: e.vehicleNo || '',
      material: (e as any).material || 'Corn',
      moisture: String(e.moisture || ''),
      starch: String(e.starch || ''),
      fungus: String(e.fungus || ''),
      immature: String(e.immature || ''),
      damaged: String(e.damaged || ''),
      waterDamaged: String(e.waterDamaged || ''),
      tfm: String(e.tfm || ''),
      remark: e.remark || '',
    });
    setShowForm(true);
    setSelectedEntry(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // === Stats ===
  const stats = useMemo(() => {
    const todayEntries = entries.filter(e => isToday(e.date));
    const yesterdayEntries = entries.filter(e => isYesterday(e.date));
    return {
      todayCount: todayEntries.length,
      totalCount: entries.length,
      starchToday: fmt(avg(todayEntries.map(e => e.starch))),
      starchYesterday: fmt(avg(yesterdayEntries.map(e => e.starch))),
      starchTotal: fmt(avg(entries.map(e => e.starch))),
      moistureToday: fmt(avg(todayEntries.map(e => e.moisture))),
      moistureTotal: fmt(avg(entries.map(e => e.moisture))),
      tfmTotal: fmt(avg(entries.map(e => e.tfm))),
    };
  }, [entries]);

  // Filter & group — sorted by date descending, today always first
  const filtered = search.trim()
    ? entries.filter(e => e.vehicleCode.toLowerCase().includes(search.toLowerCase()))
    : entries;

  const grouped: Record<string, { entries: Entry[]; sortKey: string }> = {};
  filtered.forEach(e => {
    const d = new Date(e.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const sortKey = new Date(e.date).toISOString().slice(0, 10);
    if (!grouped[d]) grouped[d] = { entries: [], sortKey };
    grouped[d].entries.push(e);
  });

  // Sort groups: today first, then by date descending
  const sortedGroups = Object.entries(grouped).sort(([, a], [, b]) => {
    const today = isoDate(new Date());
    if (a.sortKey === today) return -1;
    if (b.sortKey === today) return 1;
    return b.sortKey.localeCompare(a.sortKey);
  });

  const doShare = async (text: string) => {
    try {
      await api.post('/telegram/send-report', { message: text, module: 'grain' });
      setMsg({ type: 'ok', text: 'Shared via Telegram!' });
    } catch {
      setMsg({ type: 'err', text: 'Failed to share' });
    }
  };

  const shareText = (e: Entry) =>
    `*Lab Analysis - ${e.material || 'Corn'}*\nRST: ${e.vehicleCode}${e.vehicleNo ? '\nVehicle: ' + e.vehicleNo : ''}\n📅 ${new Date(e.date).toLocaleDateString('en-IN')}\n\nMoisture: ${e.moisture}%\nStarch: ${e.starch}%\nDamaged: ${e.damaged}%\nTFM: ${e.tfm}%\nFungus: ${e.fungus}%\nImmature: ${e.immature}%\nWater Dam: ${e.waterDamaged}%\n*Total Damage: ${entryTotalDamage(e).toFixed(1)}%*${e.remark ? '\n\nRemark: ' + e.remark : ''}`;

  return (
    <ProcessPage title="Raw Material Analysis" icon={<FlaskConical size={28} />}
      description="Lab quality testing — enter RST number & analysis results"
      flow={{ from: 'Raw Material', to: 'Lab Report' }} color="bg-indigo-600">

      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 md:gap-3 mb-4 md:mb-5">
        {[
          { label: 'Today', value: stats.todayCount, unit: 'samples', color: 'bg-blue-50 border-blue-200' },
          { label: 'Total Samples', value: stats.totalCount, unit: '', color: 'bg-indigo-50 border-indigo-200' },
          { label: 'Starch Today', value: stats.starchToday, unit: '%', color: 'bg-green-50 border-green-200' },
          { label: 'Starch Yest.', value: stats.starchYesterday, unit: '%', color: 'bg-emerald-50 border-emerald-200' },
          { label: 'Starch Avg', value: stats.starchTotal, unit: '%', color: 'bg-amber-50 border-amber-200' },
          { label: 'TFM Avg', value: stats.tfmTotal, unit: '%', color: 'bg-orange-50 border-orange-200' },
        ].map(k => (
          <div key={k.label} className={`rounded-lg border p-2 md:p-3 ${k.color}`}>
            <div className="text-[10px] md:text-xs text-gray-500">{k.label}</div>
            <div className="text-lg md:text-xl font-bold">{k.value} <span className="text-[10px] md:text-xs font-normal text-gray-400">{k.unit}</span></div>
          </div>
        ))}
      </div>

      {/* Lab Testing KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border border-slate-300 mb-4">
        <div className="bg-white px-4 py-2 border-r border-slate-300 border-l-4 border-l-amber-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">WB Pending</div>
          <div className="text-xl font-bold text-slate-800 mt-0.5 font-mono tabular-nums">{labStats.pending}</div>
        </div>
        <div className="bg-white px-4 py-2 border-r border-slate-300 border-l-4 border-l-green-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Passed Today</div>
          <div className="text-xl font-bold text-slate-800 mt-0.5 font-mono tabular-nums">{labStats.passedToday}</div>
        </div>
        <div className="bg-white px-4 py-2 border-r border-slate-300 border-l-4 border-l-red-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Failed Today</div>
          <div className="text-xl font-bold text-slate-800 mt-0.5 font-mono tabular-nums">{labStats.failedToday}</div>
        </div>
        <div className="bg-white px-4 py-2 border-l-4 border-l-orange-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">In Quarantine</div>
          <div className="text-xl font-bold text-slate-800 mt-0.5 font-mono tabular-nums">{labStats.quarantineTotal}</div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-0 border-b border-slate-300 mb-4">
        <button
          onClick={() => setActiveTab('wb-trucks')}
          className={`px-4 py-2 text-[11px] font-bold uppercase tracking-widest ${activeTab === 'wb-trucks' ? 'border-b-2 border-blue-600 text-blue-700 bg-white' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Weighbridge Trucks ({labStats.pending} pending)
        </button>
        <button
          onClick={() => setActiveTab('lab-analysis')}
          className={`px-4 py-2 text-[11px] font-bold uppercase tracking-widest ${activeTab === 'lab-analysis' ? 'border-b-2 border-blue-600 text-blue-700 bg-white' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Lab Analysis ({stats.totalCount})
        </button>
      </div>

      {/* ========== WEIGHBRIDGE TRUCKS TAB ========== */}
      {activeTab === 'wb-trucks' && (
        <div>
          {/* Pending Section Header */}
          <div className="bg-slate-200 border border-slate-300 px-4 py-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Awaiting Lab Test ({labPending.length})</span>
          </div>

          {/* Pending Table */}
          <div className="border-x border-b border-slate-300 overflow-x-auto">
            {labPending.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">No trucks pending lab test</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vehicle</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Supplier</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Material</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Gross</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Tare</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Net</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Date</th>
                    <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Lab</th>
                    <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {labPending.map((t, i) => (
                    <React.Fragment key={t.id}>
                      <tr className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                        <td className="px-3 py-1.5 font-mono font-bold text-slate-800 border-r border-slate-100">{t.vehicleNo || '--'}</td>
                        <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{t.supplier || '--'}</td>
                        <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">
                          {isFuelTruck(t) && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-orange-300 bg-orange-50 text-orange-700 mr-1">FUEL</span>}
                          {(() => {
                            const r = t.remarks || '';
                            const parts = r.split('|').map(s => s.trim());
                            const statusPart = parts.find(p => ['GATE_ENTRY', 'FIRST_DONE', 'COMPLETE'].includes(p));
                            const lastPart = parts[parts.length - 1];
                            return statusPart && lastPart !== statusPart ? lastPart : parts.length > 3 ? parts[3] : r.substring(0, 30);
                          })()}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtWt(t.weightGross)}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtWt(t.weightTare)}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums font-bold text-slate-800 border-r border-slate-100">{fmtWt(t.weightNet)}</td>
                        <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">
                          <div>{fmtLabDate(t.date)}</div>
                          <div className="text-[10px] text-slate-400">{fmtLabTime(t.date)}</div>
                        </td>
                        <td className="px-3 py-1.5 text-center border-r border-slate-100">
                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-yellow-300 bg-yellow-50 text-yellow-700">PENDING</span>
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <button
                            onClick={() => openLabTest(t.id)}
                            className={`px-3 py-1 text-[11px] font-medium ${labTestingId === t.id ? 'bg-slate-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                          >
                            {labTestingId === t.id ? 'Cancel' : 'Test'}
                          </button>
                        </td>
                      </tr>
                      {labTestingId === t.id && (
                        <tr className={`border-b border-slate-300 ${isFuelTruck(t) ? 'bg-amber-50' : 'bg-slate-100'}`}>
                          <td colSpan={9} className="px-4 py-3">
                            {isFuelTruck(t) && (
                              <div className="text-[10px] font-bold text-orange-700 uppercase tracking-widest mb-2 flex items-center gap-2">
                                <span className="px-2 py-0.5 border border-orange-400 bg-orange-100">FUEL QUALITY CHECK</span>
                                <span className="text-slate-400 font-normal normal-case">Moisture only</span>
                              </div>
                            )}
                            <div className={`grid gap-3 ${isFuelTruck(t) ? 'grid-cols-2 md:grid-cols-3' : 'grid-cols-2 md:grid-cols-5'}`}>
                              <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Moisture % *</label>
                                <input type="number" step="0.01" value={labForm.moisture}
                                  onChange={e => setLabForm(f => ({ ...f, moisture: e.target.value }))}
                                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                                  placeholder="e.g. 14.5" />
                              </div>
                              {!isFuelTruck(t) && (
                                <>
                                  <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Starch %</label>
                                    <input type="number" step="0.01" value={labForm.starchPercent}
                                      onChange={e => setLabForm(f => ({ ...f, starchPercent: e.target.value }))}
                                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                                      placeholder="e.g. 62" />
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Damaged %</label>
                                    <input type="number" step="0.01" value={labForm.damagedPercent}
                                      onChange={e => setLabForm(f => ({ ...f, damagedPercent: e.target.value }))}
                                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                                      placeholder="e.g. 2.5" />
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Foreign Matter %</label>
                                    <input type="number" step="0.01" value={labForm.foreignMatter}
                                      onChange={e => setLabForm(f => ({ ...f, foreignMatter: e.target.value }))}
                                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                                      placeholder="e.g. 1.0" />
                                  </div>
                                </>
                              )}
                              <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Remarks</label>
                                <input type="text" value={labForm.remarks}
                                  onChange={e => setLabForm(f => ({ ...f, remarks: e.target.value }))}
                                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                                  placeholder="Optional" />
                              </div>
                            </div>
                            <div className="flex gap-2 mt-3">
                              <button onClick={() => submitLabResult('PASS')} disabled={labSubmitting || !labForm.moisture}
                                className="px-4 py-1.5 bg-green-600 text-white text-[11px] font-bold uppercase tracking-widest hover:bg-green-700 disabled:opacity-50">
                                {isFuelTruck(t) ? 'PASS (FUEL)' : 'PASS'}
                              </button>
                              <button onClick={() => submitLabResult('FAIL')} disabled={labSubmitting || !labForm.moisture}
                                className="px-4 py-1.5 bg-red-600 text-white text-[11px] font-bold uppercase tracking-widest hover:bg-red-700 disabled:opacity-50">
                                {isFuelTruck(t) ? 'FAIL (FUEL)' : 'FAIL'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* History Section Header */}
          <div className="bg-slate-200 border-x border-b border-slate-300 px-4 py-2 mt-0">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Test History (Recent {labHistory.length})</span>
          </div>

          {/* History Table */}
          <div className="border-x border-b border-slate-300 overflow-x-auto">
            {labHistory.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">No test history</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vehicle</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Supplier</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Net Wt</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Moisture</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Starch</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Damaged</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">FM</th>
                    <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Lab</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {labHistory.map((t, i) => {
                    const passed = !t.quarantine && t.moisture !== null;
                    const failed = t.quarantine;
                    return (
                      <tr key={t.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                        <td className="px-3 py-1.5 font-mono font-bold text-slate-800 border-r border-slate-100">{t.vehicleNo || '--'}</td>
                        <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{t.supplier || '--'}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtWt(t.weightNet)}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{t.moisture !== null ? t.moisture.toFixed(1) : '--'}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{t.starchPercent !== null ? t.starchPercent.toFixed(1) : '--'}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{t.damagedPercent !== null ? t.damagedPercent.toFixed(1) : '--'}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{t.foreignMatter !== null ? t.foreignMatter.toFixed(1) : '--'}</td>
                        <td className="px-3 py-1.5 text-center border-r border-slate-100">
                          {failed ? (
                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-red-300 bg-red-50 text-red-700">FAIL</span>
                          ) : passed ? (
                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-green-300 bg-green-50 text-green-700">PASS</span>
                          ) : (
                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-300 bg-slate-50 text-slate-600">--</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-slate-600">
                          <div>{fmtLabDate(t.date)}</div>
                          <div className="text-[10px] text-slate-400">{fmtLabTime(t.date)}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ========== LAB ANALYSIS TAB (original content) ========== */}
      {activeTab === 'lab-analysis' && (<>

      {/* Add Sample Button */}
      {!showForm && (
        <button onClick={() => setShowForm(true)}
          className="w-full border-2 border-dashed border-indigo-300 rounded-lg py-3 text-indigo-600 hover:bg-indigo-50 flex items-center justify-center gap-2 mb-4 font-medium text-sm">
          <Plus size={18} /> New Sample
        </button>
      )}

      {/* === New Sample Form === */}
      {showForm && (
        <div className="card mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="section-title flex items-center gap-2 !mb-0">
              <FlaskConical size={16} className="text-indigo-600" /> {editId ? '✏️ Edit Sample' : 'New Lab Sample'}
            </h3>
            <button onClick={resetForm} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 md:gap-3 mb-3">
            <div>
              <label className="text-[10px] md:text-xs text-gray-500">Date</label>
              <input type="date" value={form.date} onChange={e => set('date', e.target.value)}
                className="input-field w-full text-xs md:text-sm" />
            </div>
            <div>
              <label className="text-[10px] md:text-xs text-indigo-600 font-medium">RST Number *</label>
              <input value={form.vehicleCode} onChange={e => set('vehicleCode', e.target.value)}
                className="input-field w-full border-indigo-300 bg-indigo-50 font-medium text-xs md:text-sm"
                placeholder="RST / UID" autoFocus />
            </div>
            <div>
              <label className="text-[10px] md:text-xs text-gray-500">Vehicle No.</label>
              <input value={form.vehicleNo} onChange={e => set('vehicleNo', e.target.value)}
                className="input-field w-full text-xs md:text-sm"
                placeholder="MH-12-XX-1234" />
            </div>
            <div>
              <label className="text-[10px] md:text-xs text-gray-500">Material</label>
              <select value={form.material} onChange={e => set('material', e.target.value)}
                className="input-field w-full bg-amber-50 text-xs md:text-sm">
                {MATERIALS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          <div className="text-[10px] text-gray-400 font-medium mb-1">Quality Parameters</div>
          <div className="grid grid-cols-4 gap-1.5 md:gap-2 mb-2">
            {[
              { k: 'moisture', l: 'Moisture %' }, { k: 'starch', l: 'Starch %' },
              { k: 'damaged', l: 'Damaged %' }, { k: 'tfm', l: 'TFM %' },
              { k: 'fungus', l: 'Fungus %' }, { k: 'immature', l: 'Immature %' },
              { k: 'waterDamaged', l: 'Water Dam %' }, { k: 'remark', l: 'Remark' },
            ].map(({ k, l }) => (
              <div key={k}>
                <label className="text-[9px] md:text-[10px] text-gray-400">{l}</label>
                <input type={k === 'remark' ? 'text' : 'number'} step="0.01"
                  value={(form as any)[k]} onChange={e => set(k, e.target.value)}
                  className="input-field w-full text-xs" placeholder={k === 'remark' ? '' : '0'} />
              </div>
            ))}
          </div>
          {/* Total Damage auto-sum */}
          <div className={`rounded-lg border-2 px-3 py-1.5 mb-3 flex items-center justify-between ${totalDamage > 10 ? 'bg-red-50 border-red-300' : totalDamage > 5 ? 'bg-amber-50 border-amber-300' : 'bg-green-50 border-green-300'}`}>
            <span className="text-xs font-medium text-gray-600">Total Damage <span className="text-[9px] text-gray-400">(D + TFM + F + I + WD)</span></span>
            <span className={`text-lg font-bold ${totalDamage > 10 ? 'text-red-600' : totalDamage > 5 ? 'text-amber-600' : 'text-green-600'}`}>{totalDamage.toFixed(1)}%</span>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => setShowPreview(true)}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium text-xs md:text-sm hover:bg-indigo-700 flex items-center gap-1.5">
              <Save size={14} /> Preview & Save
            </button>
            {editId && (
              <button onClick={resetForm} className="px-4 py-2 bg-gray-200 text-gray-600 rounded-lg text-xs md:text-sm">Cancel</button>
            )}
            {msg && <span className={`text-xs ${msg.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</span>}
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowPreview(false)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <div className="bg-indigo-600 text-white p-3 rounded-t-xl flex items-center justify-between">
              <h3 className="font-bold text-sm">Lab Analysis Report</h3>
              <button onClick={() => setShowPreview(false)}><X size={18} /></button>
            </div>
            <div className="p-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Date</span><span className="font-medium">{form.date}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">RST</span><span className="font-bold text-indigo-600">{form.vehicleCode}</span></div>
              {form.vehicleNo && <div className="flex justify-between"><span className="text-gray-500">Vehicle No.</span><span className="font-medium">{form.vehicleNo}</span></div>}
              <div className="flex justify-between"><span className="text-gray-500">Material</span><span className="font-medium text-amber-700">{form.material}</span></div>
              <div className="border-t pt-2 grid grid-cols-2 gap-1.5 text-xs">
                {form.moisture && <div>Moisture: <b>{form.moisture}%</b></div>}
                {form.starch && <div>Starch: <b>{form.starch}%</b></div>}
                {form.damaged && <div>Damaged: <b>{form.damaged}%</b></div>}
                {form.tfm && <div>TFM: <b className="text-orange-600">{form.tfm}%</b></div>}
                {form.fungus && <div>Fungus: <b>{form.fungus}%</b></div>}
                {form.immature && <div>Immature: <b>{form.immature}%</b></div>}
                {form.waterDamaged && <div>Water Dam: <b>{form.waterDamaged}%</b></div>}
              </div>
              {/* Total Damage in preview */}
              <div className={`border-t pt-2 flex justify-between items-center ${totalDamage > 10 ? 'text-red-600' : totalDamage > 5 ? 'text-amber-600' : 'text-green-600'}`}>
                <span className="text-xs font-medium">Total Damage</span>
                <span className="text-base font-bold">{totalDamage.toFixed(1)}%</span>
              </div>
              {form.remark && <div className="border-t pt-1.5 text-xs text-gray-500">{form.remark}</div>}
            </div>
            <div className="p-3 border-t space-y-2">
              <button onClick={() => save(true)} disabled={saving}
                className="w-full flex items-center justify-center gap-2 bg-green-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-50">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />} Save & Share
              </button>
              <button onClick={async () => { await save(); }} disabled={saving}
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {editId ? 'Update Only' : 'Save Only'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-3">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search RST number..."
          className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm" />
      </div>

      {/* === History === */}
      <div className="space-y-2">
        {sortedGroups.length === 0 && (
          <p className="text-center text-sm text-gray-400 py-8">
            {search ? 'No samples match' : 'No samples yet'}
          </p>
        )}
        {sortedGroups.map(([dateStr, { entries: items, sortKey }]) => {
          const isTodayGroup = sortKey === isoDate(new Date());
          const isExpanded = expandedDate === dateStr || isTodayGroup;
          const dayAvgM = (items.reduce((a, e) => a + e.moisture, 0) / items.length).toFixed(1);
          const dayAvgS = (items.reduce((a, e) => a + e.starch, 0) / items.length).toFixed(1);
          return (
            <div key={dateStr} className={`card !p-0 overflow-hidden ${isTodayGroup ? 'ring-2 ring-indigo-400' : ''}`}>
              {/* Date Header */}
              <button onClick={() => setExpandedDate(isExpanded && !isTodayGroup ? null : (isExpanded ? null : dateStr))}
                className={`w-full flex items-center justify-between px-3 md:px-4 py-2.5 hover:bg-gray-50 transition ${isTodayGroup ? 'bg-indigo-50' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className="text-xs md:text-sm font-bold text-gray-800">{isTodayGroup ? '📋 Today' : dateStr}</span>
                  <span className="text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full font-medium">{items.length}</span>
                </div>
                <div className="flex items-center gap-3 text-[10px] md:text-xs text-gray-500">
                  <span>M: <b>{dayAvgM}%</b></span>
                  <span>S: <b>{dayAvgS}%</b></span>
                  {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </div>
              </button>

              {/* Collapsed: mobile-friendly card list */}
              {!isExpanded && items.length <= 8 && (
                <div className="border-t">
                  {/* Mobile: card view */}
                  <div className="md:hidden divide-y">
                    {items.map(e => (
                      <div key={e.id}
                        onClick={() => setSelectedEntry(selectedEntry === e.id ? null : e.id)}
                        className="px-3 py-2 active:bg-gray-50">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-indigo-600 text-xs">{e.vehicleCode || '—'}</span>
                            <span className="text-[10px] text-amber-700">{(e as any).material || 'Corn'}</span>
                          </div>
                          <div className="flex items-center gap-3 text-[10px] text-gray-500">
                            <span>M:{e.moisture}</span>
                            <span className="font-medium">S:{e.starch}</span>
                            <span className={`font-bold ${entryTotalDamage(e) > 10 ? 'text-red-600' : entryTotalDamage(e) > 5 ? 'text-amber-600' : 'text-green-600'}`}>TD:{entryTotalDamage(e).toFixed(1)}</span>
                          </div>
                        </div>
                        {/* Action row when tapped */}
                        {selectedEntry === e.id && (
                          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-dashed">
                            <button onClick={(ev) => { ev.stopPropagation(); editEntry(e); }}
                              className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-[10px] font-medium">
                              <Pencil size={10} /> Edit
                            </button>
                            <button onClick={(ev) => { ev.stopPropagation(); doShare(shareText(e)); }}
                              className="flex items-center gap-1 px-3 py-1.5 bg-green-50 text-green-600 rounded-lg text-[10px] font-medium">
                              <Share2 size={10} /> Share
                            </button>
                            {isAdmin && (
                              <button onClick={(ev) => { ev.stopPropagation(); del(e.id); }}
                                className="flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-[10px] font-medium">
                                <Trash2 size={10} /> Delete
                              </button>
                            )}
                            <div className="flex-1" />
                            <span className="text-[9px] text-gray-400">D:{e.damaged} F:{e.fungus} I:{e.immature}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {/* Desktop: table view */}
                  <table className="w-full text-xs hidden md:table">
                    <thead>
                      <tr className="bg-gray-50 text-gray-400">
                        <th className="text-left px-4 py-1 font-medium">RST</th>
                        <th className="text-left px-2 py-1 font-medium">Material</th>
                        <th className="text-center px-2 py-1 font-medium">M%</th>
                        <th className="text-center px-2 py-1 font-medium">S%</th>
                        <th className="text-center px-2 py-1 font-medium">D%</th>
                        <th className="text-center px-2 py-1 font-medium">TFM%</th>
                        <th className="text-center px-2 py-1 font-medium">Tot.Dam%</th>
                        <th className="text-right px-4 py-1 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(e => (
                        <tr key={e.id} className="border-t hover:bg-gray-50">
                          <td className="px-4 py-1.5 font-semibold text-indigo-600">{e.vehicleCode || '—'}</td>
                          <td className="px-2 py-1.5 text-amber-700">{(e as any).material || 'Corn'}</td>
                          <td className="text-center px-2 py-1.5">{e.moisture}</td>
                          <td className="text-center px-2 py-1.5 font-medium">{e.starch}</td>
                          <td className="text-center px-2 py-1.5">{e.damaged}</td>
                          <td className="text-center px-2 py-1.5 font-medium text-orange-600">{e.tfm}</td>
                          <td className={`text-center px-2 py-1.5 font-bold ${entryTotalDamage(e) > 10 ? 'text-red-600' : entryTotalDamage(e) > 5 ? 'text-amber-600' : 'text-green-600'}`}>{entryTotalDamage(e).toFixed(1)}</td>
                          <td className="text-right px-4 py-1.5">
                            <div className="flex items-center justify-end gap-2">
                              <button onClick={() => editEntry(e)} className="text-blue-500 hover:text-blue-700"><Pencil size={12} /></button>
                              <button onClick={() => doShare(shareText(e))} className="text-green-500 hover:text-green-700"><Share2 size={12} /></button>
                              {isAdmin && <button onClick={() => del(e.id)} className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {!isExpanded && items.length > 8 && (
                <div className="border-t px-4 py-2 text-xs text-gray-400 text-center">
                  {items.length} samples — click to expand
                </div>
              )}

              {/* Expanded: full detail */}
              {isExpanded && (
                <div className="border-t">
                  {/* Mobile expanded */}
                  <div className="md:hidden divide-y">
                    {items.map(e => (
                      <div key={e.id} className="px-3 py-2">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-indigo-600 text-xs">{e.vehicleCode || '—'}</span>
                            <span className="text-[10px] text-amber-700">{(e as any).material || 'Corn'}</span>
                          </div>
                        </div>
                        <div className="grid grid-cols-4 gap-1 text-[10px] text-gray-600 mb-1.5">
                          <span>M: <b>{e.moisture}%</b></span>
                          <span>S: <b>{e.starch}%</b></span>
                          <span>D: <b>{e.damaged}%</b></span>
                          <span>T: <b className="text-orange-600">{e.tfm}%</b></span>
                          <span>F: {e.fungus}%</span>
                          <span>I: {e.immature}%</span>
                          <span>WD: {e.waterDamaged}%</span>
                          <span className={`font-bold ${entryTotalDamage(e) > 10 ? 'text-red-600' : entryTotalDamage(e) > 5 ? 'text-amber-600' : 'text-green-600'}`}>TD: {entryTotalDamage(e).toFixed(1)}%</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => editEntry(e)}
                            className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-600 rounded text-[10px]">
                            <Pencil size={9} /> Edit
                          </button>
                          <button onClick={() => doShare(shareText(e))}
                            className="flex items-center gap-1 px-2 py-1 bg-green-50 text-green-600 rounded text-[10px]">
                            <Share2 size={9} /> Share
                          </button>
                          {isAdmin && (
                            <button onClick={() => del(e.id)}
                              className="flex items-center gap-1 px-2 py-1 bg-red-50 text-red-600 rounded text-[10px]">
                              <Trash2 size={9} /> Del
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Desktop expanded */}
                  <table className="w-full text-xs hidden md:table">
                    <thead>
                      <tr className="bg-gray-50 text-gray-400">
                        <th className="text-left px-4 py-1.5 font-medium">RST</th>
                        <th className="text-left px-2 py-1.5 font-medium">Material</th>
                        <th className="text-center px-2 py-1.5 font-medium">M%</th>
                        <th className="text-center px-2 py-1.5 font-medium">S%</th>
                        <th className="text-center px-2 py-1.5 font-medium">D%</th>
                        <th className="text-center px-2 py-1.5 font-medium">TFM%</th>
                        <th className="text-center px-2 py-1.5 font-medium">Fungus</th>
                        <th className="text-center px-2 py-1.5 font-medium">Imm</th>
                        <th className="text-center px-2 py-1.5 font-medium">WD</th>
                        <th className="text-center px-2 py-1.5 font-medium">Tot.Dam%</th>
                        <th className="text-right px-4 py-1.5 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(e => (
                        <tr key={e.id} className="border-t hover:bg-gray-50">
                          <td className="px-4 py-2 font-semibold text-indigo-600">{e.vehicleCode || '—'}</td>
                          <td className="px-2 py-2 text-amber-700">{(e as any).material || 'Corn'}</td>
                          <td className="text-center px-2 py-2">{e.moisture}</td>
                          <td className="text-center px-2 py-2 font-medium">{e.starch}</td>
                          <td className="text-center px-2 py-2">{e.damaged}</td>
                          <td className="text-center px-2 py-2 font-bold text-orange-600">{e.tfm}</td>
                          <td className="text-center px-2 py-2 text-gray-500">{e.fungus}</td>
                          <td className="text-center px-2 py-2 text-gray-500">{e.immature}</td>
                          <td className="text-center px-2 py-2 text-gray-500">{e.waterDamaged}</td>
                          <td className={`text-center px-2 py-2 font-bold ${entryTotalDamage(e) > 10 ? 'text-red-600' : entryTotalDamage(e) > 5 ? 'text-amber-600' : 'text-green-600'}`}>{entryTotalDamage(e).toFixed(1)}</td>
                          <td className="text-right px-4 py-2">
                            <div className="flex items-center justify-end gap-2">
                              <button onClick={() => editEntry(e)} className="text-blue-500 hover:text-blue-700"><Pencil size={12} /></button>
                              <button onClick={() => doShare(shareText(e))} className="text-green-500 hover:text-green-700"><Share2 size={12} /></button>
                              {isAdmin && <button onClick={() => del(e.id)} className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
      </>)}
    </ProcessPage>
  );
}
