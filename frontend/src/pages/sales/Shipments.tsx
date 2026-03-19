import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Truck, X, Loader2, Share2, MessageCircle, Phone, ChevronDown,
  Scale, CheckCircle, AlertCircle, FileText, Camera, Upload, Image,
  Clock, MapPin, Trash2
} from 'lucide-react';
import api from '../../services/api';

interface Shipment {
  id: string; vehicleNo: string;
  status: 'GATE_IN' | 'TARE_WEIGHED' | 'LOADING' | 'GROSS_WEIGHED' | 'RELEASED' | 'EXITED';
  customerName: string; productName: string; destination: string;
  driverName: string; driverMobile: string; transporterName: string;
  capacityTon: number; vehicleType: string; gateInTime: string;
  weightTare?: number; weightGross?: number; weightNet?: number;
  dispatchRequestId?: string; challanNo?: string; ewayBill?: string; ewayBillStatus?: string; gatePassNo?: string;
  invoiceRef?: string; grBiltyNo?: string; grBiltyDate?: string;
  tareTime?: string; grossTime?: string; releaseTime?: string; exitTime?: string;
  dispatchRequest?: { drNo?: number; customerName?: string; productName?: string; quantity?: number; unit?: string };
  documents?: { id: string; docType: string; fileName: string }[];
}

const STATUS_FLOW = ['GATE_IN', 'TARE_WEIGHED', 'LOADING', 'GROSS_WEIGHED', 'RELEASED', 'EXITED'] as const;

const STATUS_CFG: Record<string, { label: string; badge: string }> = {
  GATE_IN:        { label: 'Gate In',  badge: 'bg-slate-100 text-slate-700' },
  TARE_WEIGHED:   { label: 'Tared',    badge: 'bg-blue-50 text-blue-700' },
  LOADING:        { label: 'Loading',  badge: 'bg-amber-50 text-amber-700' },
  GROSS_WEIGHED:  { label: 'Loaded',   badge: 'bg-orange-50 text-orange-700' },
  RELEASED:       { label: 'Released', badge: 'bg-emerald-50 text-emerald-700' },
  EXITED:         { label: 'Exited',   badge: 'bg-green-50 text-green-700' },
};

const DOC_TYPES = [
  { key: 'INVOICE', label: 'Bill', field: 'invoiceRef' },
  { key: 'EWAY_BILL', label: 'E-Way', field: 'ewayBill' },
  { key: 'GATE_PASS', label: 'Gate Pass', field: 'gatePassNo' },
  { key: 'GR_BILTY', label: 'Bilty', field: 'grBiltyNo' },
];

export default function Shipments() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null); // track which shipment is saving
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Exit gate: doc check before exit
  const [exitConfirm, setExitConfirm] = useState<Shipment | null>(null);
  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState<Shipment | null>(null);
  // Inline weigh input — shown directly in row
  const [weighing, setWeighing] = useState<{ id: string; type: 'tare' | 'gross' } | null>(null);
  const [weighVal, setWeighVal] = useState('');
  const weighRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      setLoading(true);
      const r = await api.get('/shipments/active');
      setShipments(r.data.shipments || []);
    } catch { flash('err', 'Failed to load'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { if (weighing && weighRef.current) weighRef.current.focus(); }, [weighing]);

  const flash = (type: 'ok' | 'err', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3500);
  };

  // ── Grouped by order ──
  const grouped = useMemo(() => {
    const filtered = filterStatus === 'ALL' ? shipments : shipments.filter(s => s.status === filterStatus);
    const groups: Record<string, { dr: Shipment['dispatchRequest']; shipments: Shipment[]; drId: string }> = {};
    filtered.forEach(s => {
      const key = s.dispatchRequestId || 'unlinked';
      if (!groups[key]) groups[key] = { dr: s.dispatchRequest, shipments: [], drId: key };
      groups[key].shipments.push(s);
    });
    return Object.entries(groups);
  }, [shipments, filterStatus]);

  // ── Actions ──
  const doWeigh = async (id: string, type: 'tare' | 'gross') => {
    if (!weighVal) { flash('err', 'Enter weight'); return; }
    setSaving(id);
    try {
      const w = parseFloat(weighVal) * 1000;
      const body = type === 'tare'
        ? { weightTare: w, tareTime: new Date().toISOString() }
        : { weightGross: w, grossTime: new Date().toISOString() };
      await api.put(`/shipments/${id}/weighbridge`, body);
      flash('ok', `${type === 'tare' ? 'Tare' : 'Gross'}: ${weighVal} T ✓`);
      setWeighing(null); setWeighVal('');
      // After tare → auto start loading
      if (type === 'tare') {
        await api.put(`/shipments/${id}/status`, { status: 'LOADING', loadStartTime: new Date().toISOString() });
      }
      load();
    } catch { flash('err', 'Failed to save weight'); }
    setSaving(null);
  };

  const doStatus = async (id: string, status: string, extra?: any) => {
    setSaving(id);
    try {
      await api.put(`/shipments/${id}/status`, { status, ...extra });
      flash('ok', STATUS_CFG[status]?.label || status);
      load();
    } catch { flash('err', 'Failed'); }
    setSaving(null);
  };

  const doDelete = async (id: string) => {
    setSaving(id);
    try {
      await api.delete(`/shipments/${id}`);
      flash('ok', 'Truck removed');
      setDeleteConfirm(null);
      load();
    } catch (e: any) {
      flash('err', e?.response?.data?.error || 'Delete failed');
    }
    setSaving(null);
  };

  // Exit with doc check
  const handleExit = (s: Shipment) => {
    const docs = s.documents || [];
    const missingDocs = DOC_TYPES.filter(dt => !docs.some(d => d.docType === dt.key));
    if (missingDocs.length > 0) {
      setExitConfirm(s);
    } else {
      doStatus(s.id, 'EXITED', { exitTime: new Date().toISOString() });
    }
  };

  const uploadDoc = async (shipmentId: string, docType: string, source: 'file' | 'camera' | 'gallery') => {
    const input = document.createElement('input');
    input.type = 'file';
    if (source === 'camera') { input.accept = 'image/*'; input.setAttribute('capture', 'environment'); }
    else if (source === 'gallery') { input.accept = 'image/*'; }
    else { input.accept = 'image/*,.pdf,.doc,.docx'; }
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0]; if (!file) return;
      setUploadingDoc(`${shipmentId}_${docType}`);
      try {
        const fd = new FormData();
        fd.append('file', file); fd.append('docType', docType); fd.append('shipmentId', shipmentId);
        await api.post('/shipment-documents/upload', fd);
        flash('ok', `${docType.replace(/_/g, ' ')} uploaded`);
        load();
      } catch { flash('err', 'Upload failed'); }
      setUploadingDoc(null);
    };
    input.click();
  };

  const saveField = async (shipmentId: string, field: string, value: string) => {
    try { await api.put(`/shipments/${shipmentId}`, { [field]: value || null }); }
    catch { flash('err', 'Save failed'); }
  };

  const shareStatus = (s: Shipment) => {
    const net = s.weightNet || (s.weightGross && s.weightTare ? s.weightGross - s.weightTare : null);
    const text = `🚛 ${s.vehicleNo}\n${s.productName} → ${s.customerName}\n${s.destination}\nStatus: ${STATUS_CFG[s.status]?.label}\n${net ? `Net: ${(net / 1000).toFixed(2)} MT\n` : ''}${s.driverName ? `Driver: ${s.driverName}` : ''}`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
  };

  // ── Stats ──
  const stats = useMemo(() => ({
    total: shipments.length,
    atGate: shipments.filter(s => s.status === 'GATE_IN').length,
    tared: shipments.filter(s => s.status === 'TARE_WEIGHED').length,
    loading: shipments.filter(s => s.status === 'LOADING').length,
    loaded: shipments.filter(s => s.status === 'GROSS_WEIGHED').length,
    released: shipments.filter(s => s.status === 'RELEASED').length,
  }), [shipments]);

  const fmtTon = (kg?: number) => kg ? (kg / 1000).toFixed(2) : null;
  const timeSince = (iso?: string) => {
    if (!iso) return null;
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h${mins % 60}m`;
  };

  /* ── The single next-action for each truck (shown as primary button) ── */
  const NextAction = ({ s }: { s: Shipment }) => {
    const isSaving = saving === s.id;
    const isWeighing = weighing?.id === s.id;

    // GATE_IN → show weight input directly (1 click to open, Enter to save)
    if (s.status === 'GATE_IN') {
      if (isWeighing) return null; // input shown below
      return (
        <button onClick={() => { setWeighing({ id: s.id, type: 'tare' }); setWeighVal(''); }}
          className="px-2 py-1 bg-slate-700 text-white rounded text-[10px] font-bold flex items-center gap-1 hover:bg-slate-800 active:scale-95">
          <Scale size={10} /> Tare
        </button>
      );
    }
    // TARE_WEIGHED → shouldn't normally appear because we auto-advance to LOADING, but just in case
    if (s.status === 'TARE_WEIGHED') {
      return (
        <button onClick={() => doStatus(s.id, 'LOADING', { loadStartTime: new Date().toISOString() })}
          disabled={isSaving}
          className="px-2 py-1 bg-blue-600 text-white rounded text-[10px] font-bold hover:bg-blue-700 active:scale-95 disabled:opacity-50">
          {isSaving ? <Loader2 size={10} className="animate-spin" /> : '▶ Start Load'}
        </button>
      );
    }
    // LOADING → Gross weigh
    if (s.status === 'LOADING') {
      if (isWeighing) return null;
      return (
        <button onClick={() => { setWeighing({ id: s.id, type: 'gross' }); setWeighVal(''); }}
          className="px-2 py-1 bg-amber-600 text-white rounded text-[10px] font-bold flex items-center gap-1 hover:bg-amber-700 active:scale-95">
          <Scale size={10} /> Gross
        </button>
      );
    }
    // GROSS_WEIGHED → Release
    if (s.status === 'GROSS_WEIGHED') {
      return (
        <button onClick={() => doStatus(s.id, 'RELEASED', { releaseTime: new Date().toISOString() })}
          disabled={isSaving}
          className="px-2 py-1 bg-orange-600 text-white rounded text-[10px] font-bold hover:bg-orange-700 active:scale-95 disabled:opacity-50">
          {isSaving ? <Loader2 size={10} className="animate-spin" /> : '🔓 Release'}
        </button>
      );
    }
    // RELEASED → Exit (with doc check)
    if (s.status === 'RELEASED') {
      return (
        <button onClick={() => handleExit(s)}
          disabled={isSaving}
          className="px-2 py-1 bg-emerald-600 text-white rounded text-[10px] font-bold hover:bg-emerald-700 active:scale-95 disabled:opacity-50">
          {isSaving ? <Loader2 size={10} className="animate-spin" /> : '🚀 Gate Out'}
        </button>
      );
    }
    // EXITED
    if (s.status === 'EXITED') {
      return <span className="text-green-600 text-[10px] font-bold flex items-center gap-0.5"><CheckCircle size={10} /> Done</span>;
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Header ── */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white px-4 py-2.5">
        <div className="flex items-center justify-between mb-1.5">
          <h1 className="text-base font-bold flex items-center gap-1.5"><Scale size={16} /> Weighbridge</h1>
          <span className="text-[10px] text-slate-400">{new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          {[
            { l: 'Gate', c: stats.atGate, bg: 'bg-slate-600' },
            { l: 'Tare', c: stats.tared, bg: 'bg-blue-600' },
            { l: 'Loading', c: stats.loading, bg: 'bg-amber-600' },
            { l: 'Loaded', c: stats.loaded, bg: 'bg-orange-600' },
            { l: 'Out', c: stats.released, bg: 'bg-emerald-600' },
            { l: 'All', c: stats.total, bg: 'bg-white/10' },
          ].map(s => (
            <div key={s.l} className={`${s.bg} rounded-md px-2.5 py-1 text-center min-w-[44px]`}>
              <div className="text-sm font-bold leading-tight">{s.c}</div>
              <div className="text-[8px] text-white/70">{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-3 py-2">
        {msg && (
          <div className={`rounded-lg p-2 mb-2 text-xs flex items-center gap-1.5 ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {msg.type === 'ok' ? <CheckCircle size={12} /> : <AlertCircle size={12} />} {msg.text}
          </div>
        )}

        {/* Filter pills */}
        <div className="flex gap-1 mb-2 overflow-x-auto pb-0.5">
          {[
            { key: 'ALL', label: 'All', count: shipments.length },
            { key: 'GATE_IN', label: 'Gate', count: stats.atGate },
            { key: 'LOADING', label: 'Loading', count: stats.loading },
            { key: 'GROSS_WEIGHED', label: 'Loaded', count: stats.loaded },
            { key: 'RELEASED', label: 'Released', count: stats.released },
          ].map(tab => (
            <button key={tab.key} onClick={() => setFilterStatus(tab.key)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap transition-all ${
                filterStatus === tab.key ? 'bg-slate-800 text-white' : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
              }`}>
              {tab.label} {tab.count > 0 && `(${tab.count})`}
            </button>
          ))}
        </div>

        {/* ── Content ── */}
        {loading ? (
          <div className="text-center py-16 text-gray-400"><Loader2 size={28} className="animate-spin mx-auto mb-2" /><p className="text-xs">Loading...</p></div>
        ) : grouped.length === 0 ? (
          <div className="text-center py-16"><Truck size={40} className="mx-auto text-gray-300 mb-2" /><p className="text-gray-400 text-sm">No active vehicles</p></div>
        ) : (
          <div className="space-y-2">
            {grouped.map(([drId, group]) => {
              const dr = group.dr;
              const orderQty = dr?.quantity || 0;
              const orderUnit = dr?.unit || 'MT';
              const isUnlinked = drId === 'unlinked';
              const exitedNetMT = group.shipments.filter(s => s.status === 'EXITED').reduce((sum, s) => {
                const n = s.weightNet || (s.weightGross && s.weightTare ? s.weightGross - s.weightTare : 0);
                return sum + (n ? n / 1000 : 0);
              }, 0);
              const pct = orderQty > 0 ? Math.min(100, (exitedNetMT / orderQty) * 100) : 0;

              return (
                <div key={drId} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  {/* Order header */}
                  <div className="px-3 py-1.5 bg-gray-50/80 border-b flex items-center gap-2">
                    {dr?.drNo ? (
                      <span className="bg-indigo-600 text-white text-[9px] font-bold px-1.5 py-px rounded">#{dr.drNo}</span>
                    ) : (
                      <span className="bg-gray-400 text-white text-[9px] font-bold px-1.5 py-px rounded">—</span>
                    )}
                    <span className="font-semibold text-xs text-gray-800 truncate">{dr?.customerName || 'Unlinked Trucks'}</span>
                    {dr?.productName && <span className="text-[10px] text-gray-400 hidden sm:inline">• {dr.productName}</span>}
                    {orderQty > 0 && (
                      <div className="ml-auto flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px]">
                          <span className="font-bold text-green-700">{exitedNetMT.toFixed(1)}</span>
                          <span className="text-gray-400">/{orderQty}{orderUnit}</span>
                        </span>
                        <div className="w-10 h-1 bg-gray-200 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${pct >= 100 ? 'bg-green-500' : 'bg-indigo-500'}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className={`text-[9px] font-bold ${pct >= 100 ? 'text-green-600' : 'text-indigo-600'}`}>{pct.toFixed(0)}%</span>
                      </div>
                    )}
                  </div>

                  {/* Vehicle rows */}
                  {group.shipments.map(s => {
                    const cfg = STATUS_CFG[s.status];
                    const net = s.weightNet || (s.weightGross && s.weightTare ? s.weightGross - s.weightTare : null);
                    const stepIdx = STATUS_FLOW.indexOf(s.status);
                    const tareTon = fmtTon(s.weightTare);
                    const grossTon = fmtTon(s.weightGross);
                    const netTon = net ? (net / 1000).toFixed(2) : null;
                    const docs = s.documents || [];
                    const isExp = expandedId === s.id;
                    const isWeighingThis = weighing?.id === s.id;
                    const elapsed = timeSince(s.gateInTime);

                    return (
                      <div key={s.id} className={`border-b last:border-b-0 ${isExp ? 'bg-slate-50/40' : ''}`}>
                        {/* ── Main row ── */}
                        <div className="px-3 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => setExpandedId(isExp ? null : s.id)} className="flex items-center gap-1.5 min-w-0 flex-1 text-left">
                              <Truck size={11} className="text-gray-400 shrink-0" />
                              <span className="font-bold text-[13px] text-gray-900">{s.vehicleNo}</span>
                              <span className={`text-[8px] font-bold px-1.5 py-px rounded-full ${cfg.badge}`}>{cfg.label}</span>
                              {elapsed && <span className="text-[9px] text-gray-400 flex items-center gap-0.5"><Clock size={8} />{elapsed}</span>}
                              <ChevronDown size={10} className={`text-gray-300 shrink-0 transition-transform ${isExp ? 'rotate-180' : ''}`} />
                            </button>

                            {/* Weight chips */}
                            <div className="flex items-center gap-1 shrink-0">
                              {tareTon && <span className="text-[9px] bg-blue-50 text-blue-600 px-1 py-px rounded font-medium">T:{tareTon}</span>}
                              {grossTon && <span className="text-[9px] bg-amber-50 text-amber-600 px-1 py-px rounded font-medium">G:{grossTon}</span>}
                              {netTon && <span className="text-[9px] bg-green-50 text-green-700 px-1.5 py-px rounded font-bold ring-1 ring-green-200">{netTon}T</span>}
                            </div>

                            {/* Doc badges on main row */}
                            {docs.length > 0 && (
                              <div className="flex items-center gap-0.5 shrink-0">
                                {DOC_TYPES.map(dt => {
                                  const has = docs.some(d => d.docType === dt.key);
                                  return has ? (
                                    <span key={dt.key} className="text-[7px] font-bold px-1 py-px rounded bg-green-100 text-green-700">{dt.label.split(' ')[0]}</span>
                                  ) : null;
                                })}
                              </div>
                            )}

                            {/* Delete for unlinked */}
                            {isUnlinked && (
                              <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(s); }}
                                className="text-gray-300 hover:text-red-500 p-0.5 transition-colors shrink-0">
                                <Trash2 size={12} />
                              </button>
                            )}

                            <NextAction s={s} />
                          </div>

                          {/* Inline weigh input */}
                          {isWeighingThis && (
                            <div className="flex gap-1.5 items-center mt-1.5 bg-blue-50 rounded-lg p-1.5">
                              <Scale size={12} className="text-blue-500 shrink-0" />
                              <input ref={weighRef} type="number" step="0.01" value={weighVal} onChange={e => setWeighVal(e.target.value)}
                                placeholder={`${weighing.type === 'tare' ? 'Tare' : 'Gross'} weight (Tons)`}
                                className="flex-1 px-2 py-1 text-sm border rounded-md bg-white focus:ring-2 focus:ring-blue-300 outline-none"
                                onKeyDown={e => e.key === 'Enter' && doWeigh(s.id, weighing.type)} />
                              <button onClick={() => doWeigh(s.id, weighing.type)} disabled={saving === s.id}
                                className="px-3 py-1 bg-blue-600 text-white text-xs rounded-md font-semibold hover:bg-blue-700 disabled:opacity-50">
                                {saving === s.id ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                              </button>
                              <button onClick={() => setWeighing(null)} className="text-gray-400 hover:text-gray-600 p-0.5"><X size={14} /></button>
                            </div>
                          )}

                          {/* Progress bar */}
                          <div className="flex gap-px mt-1">
                            {STATUS_FLOW.map((st, i) => (
                              <div key={st} className={`h-[2px] flex-1 rounded-full ${
                                i <= stepIdx ? (i === stepIdx && stepIdx < 5 ? 'bg-blue-400 animate-pulse' : 'bg-green-400') : 'bg-gray-200'
                              }`} />
                            ))}
                          </div>
                        </div>

                        {/* ── Expanded panel ── */}
                        {isExp && (
                          <div className="border-t border-gray-100 px-3 py-2 bg-gray-50/50 space-y-2">
                            {/* Driver row */}
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                              {s.driverName && <span className="text-gray-700 font-medium">🧑 {s.driverName}</span>}
                              {s.driverMobile && (
                                <a href={`tel:${s.driverMobile}`} className="text-blue-600 flex items-center gap-0.5"><Phone size={10} /> {s.driverMobile}</a>
                              )}
                              {s.transporterName && <span className="text-gray-400">🚚 {s.transporterName}</span>}
                              {s.destination && <span className="text-gray-400 flex items-center gap-0.5"><MapPin size={10} /> {s.destination}</span>}
                              <div className="ml-auto flex gap-1">
                                <button onClick={() => shareStatus(s)} className="px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded text-[9px] font-medium flex items-center gap-0.5 hover:bg-gray-300">
                                  <Share2 size={9} /> Share
                                </button>
                                {s.driverMobile && (
                                  <a href={`https://api.whatsapp.com/send?phone=91${s.driverMobile.replace(/\D/g, '').slice(-10)}`}
                                    target="_blank" rel="noopener"
                                    className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[9px] font-medium flex items-center gap-0.5 hover:bg-green-200">
                                    <MessageCircle size={9} /> WA
                                  </a>
                                )}
                              </div>
                            </div>

                            {/* Weights */}
                            <div className="grid grid-cols-3 gap-1.5">
                              {[
                                { label: 'Tare', val: tareTon, time: s.tareTime, color: 'blue' },
                                { label: 'Gross', val: grossTon, time: s.grossTime, color: 'amber' },
                                { label: 'Net', val: netTon, time: null, color: netTon ? 'green' : 'gray' },
                              ].map(w => (
                                <div key={w.label} className={`bg-${w.color}-50 rounded-lg p-1.5 text-center`}>
                                  <div className={`text-[8px] text-${w.color}-400 font-bold uppercase`}>{w.label}</div>
                                  <div className={`text-xs font-bold text-${w.color}-700`}>{w.val ? `${w.val} T` : '—'}</div>
                                  {w.time && <div className={`text-[8px] text-${w.color}-300`}>{new Date(w.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>}
                                </div>
                              ))}
                            </div>

                            {/* Documents — compact inline */}
                            <div className="space-y-1">
                              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Documents</div>
                              <div className="grid grid-cols-2 gap-1.5">
                                {DOC_TYPES.map(dt => {
                                  const hasDoc = docs.some(d => d.docType === dt.key);
                                  const fieldVal = (s as any)[dt.field] || '';
                                  return (
                                    <div key={dt.key} className={`rounded-lg border p-1.5 ${hasDoc ? 'bg-green-50/60 border-green-200' : 'bg-white border-gray-200'}`}>
                                      <div className="flex items-center gap-1 mb-0.5">
                                        <span className="text-[9px] font-bold text-gray-500">{dt.label}</span>
                                        {hasDoc && <CheckCircle size={9} className="text-green-500" />}
                                        <div className="ml-auto flex gap-0.5">
                                          {([
                                            { src: 'camera' as const, icon: <Camera size={8} />, c: 'text-blue-600' },
                                            { src: 'gallery' as const, icon: <Image size={8} />, c: 'text-purple-600' },
                                            { src: 'file' as const, icon: <Upload size={8} />, c: 'text-gray-500' },
                                          ]).map(btn => (
                                            <button key={btn.src} onClick={() => uploadDoc(s.id, dt.key, btn.src)}
                                              disabled={uploadingDoc === `${s.id}_${dt.key}`}
                                              className={`p-0.5 rounded hover:bg-gray-100 ${btn.c}`}>
                                              {uploadingDoc === `${s.id}_${dt.key}` ? <Loader2 size={8} className="animate-spin" /> : btn.icon}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                      <input defaultValue={fieldVal} placeholder={`${dt.label} No.`}
                                        className="w-full px-1.5 py-0.5 text-[11px] border border-gray-200 rounded bg-white focus:ring-1 focus:ring-blue-200 outline-none"
                                        onBlur={(e) => { if (e.target.value !== fieldVal) saveField(s.id, dt.field, e.target.value); }}
                                      />
                                      {dt.key === 'GR_BILTY' && (
                                        <input type="date" defaultValue={s.grBiltyDate || ''}
                                          className="w-full px-1.5 py-0.5 text-[11px] border border-gray-200 rounded bg-white mt-0.5 focus:ring-1 focus:ring-blue-200 outline-none"
                                          onBlur={(e) => { if (e.target.value !== (s.grBiltyDate || '')) saveField(s.id, 'grBiltyDate', e.target.value); }}
                                        />
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Challan PDF */}
                            <button onClick={() => { const token = localStorage.getItem('token'); window.open(`/api/shipments/${s.id}/challan-pdf?token=${token}`, '_blank'); }}
                              className="w-full py-1.5 text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 rounded-lg flex items-center justify-center gap-1 hover:bg-blue-100">
                              <FileText size={11} /> Challan PDF
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Exit confirm modal (missing docs warning) ── */}
      {exitConfirm && (() => {
        const s = exitConfirm;
        const docs = s.documents || [];
        const missing = DOC_TYPES.filter(dt => !docs.some(d => d.docType === dt.key));
        return (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4" onClick={() => setExitConfirm(null)}>
            <div className="bg-white rounded-xl w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <AlertCircle size={20} className="text-amber-500" />
                  <h3 className="font-bold text-sm">Missing Documents</h3>
                </div>
                <p className="text-xs text-gray-600 mb-3">
                  <span className="font-bold">{s.vehicleNo}</span> is missing {missing.length} document{missing.length > 1 ? 's' : ''}:
                </p>
                <div className="flex flex-wrap gap-1 mb-4">
                  {missing.map(m => (
                    <span key={m.key} className="px-2 py-0.5 bg-red-50 text-red-600 text-[10px] font-medium rounded-full border border-red-200">
                      ✗ {m.label}
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setExitConfirm(null); setExpandedId(s.id); }}
                    className="flex-1 py-2 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                    Upload Docs
                  </button>
                  <button onClick={() => { setExitConfirm(null); doStatus(s.id, 'EXITED', { exitTime: new Date().toISOString() }); }}
                    className="flex-1 py-2 text-xs font-semibold bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
                    Exit Anyway
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Delete confirm modal ── */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-xl w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Trash2 size={20} className="text-red-500" />
                <h3 className="font-bold text-sm">Delete Truck?</h3>
              </div>
              <p className="text-xs text-gray-600 mb-4">
                Remove <span className="font-bold">{deleteConfirm.vehicleNo}</span> from the weighbridge? This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button onClick={() => setDeleteConfirm(null)}
                  className="flex-1 py-2 text-xs font-semibold bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
                  Cancel
                </button>
                <button onClick={() => doDelete(deleteConfirm.id)} disabled={saving === deleteConfirm.id}
                  className="flex-1 py-2 text-xs font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                  {saving === deleteConfirm.id ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
