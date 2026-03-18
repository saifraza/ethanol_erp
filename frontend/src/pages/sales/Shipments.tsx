import { useState, useEffect, useMemo } from 'react';
import {
  Truck, X, Loader2, Share2, MessageCircle, Phone, ChevronDown,
  Scale, CheckCircle, AlertCircle, Package, FileText, Camera, Upload, Image,
  Clock, MapPin
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

const STATUS_CONFIG: Record<string, { label: string; badge: string; icon: string; color: string }> = {
  GATE_IN:        { label: 'Gate In',   badge: 'bg-slate-100 text-slate-700 ring-slate-200',     icon: '🚪', color: 'slate' },
  TARE_WEIGHED:   { label: 'Tared',     badge: 'bg-blue-50 text-blue-700 ring-blue-200',         icon: '⚖️', color: 'blue' },
  LOADING:        { label: 'Loading',   badge: 'bg-amber-50 text-amber-700 ring-amber-200',     icon: '📦', color: 'amber' },
  GROSS_WEIGHED:  { label: 'Loaded',    badge: 'bg-orange-50 text-orange-700 ring-orange-200',   icon: '⚖️', color: 'orange' },
  RELEASED:       { label: 'Released',  badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200',icon: '✅', color: 'emerald' },
  EXITED:         { label: 'Exited',    badge: 'bg-green-50 text-green-700 ring-green-200',      icon: '🏁', color: 'green' },
};

const DOC_TYPES = [
  { key: 'INVOICE', label: 'Bill', field: 'invoiceRef' },
  { key: 'EWAY_BILL', label: 'E-Way', field: 'ewayBill' },
  { key: 'GATE_PASS', label: 'Gate Pass', field: 'gatePassNo' },
  { key: 'GR_BILTY', label: 'Bilty', field: 'grBiltyNo' },
];

// Tab types for expanded view
type ExpandTab = 'docs' | 'details';

export default function Shipments() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [weighId, setWeighId] = useState<string | null>(null);
  const [weighVal, setWeighVal] = useState('');
  const [weighType, setWeighType] = useState<'tare' | 'gross'>('tare');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandTab, setExpandTab] = useState<ExpandTab>('docs');

  const loadShipments = async () => {
    try {
      setLoading(true);
      const r = await api.get('/shipments/active');
      setShipments(r.data.shipments || []);
    } catch {
      flash('err', 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadShipments(); }, []);

  const flash = (type: 'ok' | 'err', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };

  // ── Group by order ──
  const grouped = useMemo(() => {
    const filtered = filterStatus === 'ALL' ? shipments : shipments.filter(s => s.status === filterStatus);
    const groups: Record<string, { dr: Shipment['dispatchRequest']; shipments: Shipment[] }> = {};
    filtered.forEach(s => {
      const key = s.dispatchRequestId || 'unlinked';
      if (!groups[key]) {
        groups[key] = { dr: s.dispatchRequest, shipments: [] };
      }
      groups[key].shipments.push(s);
    });
    return Object.entries(groups);
  }, [shipments, filterStatus]);

  // ── Actions ──
  const doWeigh = async (id: string) => {
    if (!weighVal) { flash('err', 'Enter weight'); return; }
    setSaving(true);
    try {
      const w = parseFloat(weighVal) * 1000;
      const body = weighType === 'tare'
        ? { weightTare: w, tareTime: new Date().toISOString() }
        : { weightGross: w, grossTime: new Date().toISOString() };
      await api.put(`/shipments/${id}/weighbridge`, body);
      flash('ok', `${weighType === 'tare' ? 'Tare' : 'Gross'} recorded: ${weighVal} T`);
      setWeighId(null); setWeighVal('');
      loadShipments();
    } catch { flash('err', 'Failed'); }
    setSaving(false);
  };

  const doStatus = async (id: string, status: string, extra?: any) => {
    setSaving(true);
    try {
      await api.put(`/shipments/${id}/status`, { status, ...extra });
      flash('ok', status.replace(/_/g, ' '));
      loadShipments();
    } catch { flash('err', 'Failed'); }
    setSaving(false);
  };

  const uploadDoc = async (shipmentId: string, docType: string, source: 'file' | 'camera' | 'gallery') => {
    const input = document.createElement('input');
    input.type = 'file';
    if (source === 'camera') {
      input.accept = 'image/*';
      input.setAttribute('capture', 'environment');
    } else if (source === 'gallery') {
      input.accept = 'image/*';
    } else {
      input.accept = 'image/*,.pdf,.doc,.docx';
    }
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setUploadingDoc(`${shipmentId}_${docType}`);
      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('docType', docType);
        fd.append('shipmentId', shipmentId);
        await api.post('/shipment-documents/upload', fd);
        flash('ok', `${docType} uploaded`);
        loadShipments();
      } catch { flash('err', 'Upload failed'); }
      setUploadingDoc(null);
    };
    input.click();
  };

  const saveField = async (shipmentId: string, field: string, value: string) => {
    try {
      await api.put(`/shipments/${shipmentId}`, { [field]: value || null });
    } catch { flash('err', 'Save failed'); }
  };

  const shareStatus = (s: Shipment) => {
    const net = s.weightNet || (s.weightGross && s.weightTare ? s.weightGross - s.weightTare : null);
    const text = `🚛 ${s.vehicleNo}\n${s.productName} → ${s.customerName}\n${s.destination}\nStatus: ${STATUS_CONFIG[s.status]?.label}\n${net ? `Net: ${(net / 1000).toFixed(2)} MT\n` : ''}${s.driverName ? `Driver: ${s.driverName}` : ''}`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
  };

  // ── Stats ──
  const stats = {
    total: shipments.length,
    atGate: shipments.filter(s => s.status === 'GATE_IN').length,
    tared: shipments.filter(s => s.status === 'TARE_WEIGHED').length,
    loading: shipments.filter(s => s.status === 'LOADING').length,
    loaded: shipments.filter(s => s.status === 'GROSS_WEIGHED').length,
    released: shipments.filter(s => s.status === 'RELEASED').length,
  };

  const fmtTon = (kg?: number) => kg ? (kg / 1000).toFixed(2) : null;

  const timeSince = (iso?: string) => {
    if (!iso) return null;
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m`;
  };

  // Action button for each status
  const ActionBtn = ({ s }: { s: Shipment }) => {
    if (weighId === s.id) return null;
    switch (s.status) {
      case 'GATE_IN':
        return (
          <button onClick={() => { setWeighId(s.id); setWeighType('tare'); setWeighVal(''); }}
            className="px-2 py-1 bg-slate-700 text-white rounded font-semibold text-[10px] flex items-center gap-1 hover:bg-slate-800 active:scale-95 transition-all">
            <Scale size={10} /> Tare
          </button>
        );
      case 'TARE_WEIGHED':
        return (
          <button onClick={() => doStatus(s.id, 'LOADING', { loadStartTime: new Date().toISOString() })}
            disabled={saving}
            className="px-2 py-1 bg-blue-600 text-white rounded font-semibold text-[10px] hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-50">
            {saving ? <Loader2 size={10} className="animate-spin" /> : '▶ Load'}
          </button>
        );
      case 'LOADING':
        return (
          <button onClick={() => { setWeighId(s.id); setWeighType('gross'); setWeighVal(''); }}
            className="px-2 py-1 bg-amber-600 text-white rounded font-semibold text-[10px] flex items-center gap-1 hover:bg-amber-700 active:scale-95 transition-all">
            <Scale size={10} /> Gross
          </button>
        );
      case 'GROSS_WEIGHED':
        return (
          <button onClick={() => doStatus(s.id, 'RELEASED', { releaseTime: new Date().toISOString() })}
            disabled={saving}
            className="px-2 py-1 bg-orange-600 text-white rounded font-semibold text-[10px] hover:bg-orange-700 active:scale-95 transition-all disabled:opacity-50">
            {saving ? <Loader2 size={10} className="animate-spin" /> : '🔓 Release'}
          </button>
        );
      case 'RELEASED':
        return (
          <button onClick={() => doStatus(s.id, 'EXITED', { exitTime: new Date().toISOString() })}
            disabled={saving}
            className="px-2 py-1 bg-emerald-600 text-white rounded font-semibold text-[10px] hover:bg-emerald-700 active:scale-95 transition-all disabled:opacity-50">
            {saving ? <Loader2 size={10} className="animate-spin" /> : '🚀 Exit'}
          </button>
        );
      case 'EXITED':
        return <span className="text-green-600 text-[10px] font-bold flex items-center gap-0.5"><CheckCircle size={10} /> Done</span>;
      default: return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Header ── */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-base font-bold flex items-center gap-1.5">
            <Scale size={16} /> Weighbridge
          </h1>
          <span className="text-[10px] text-slate-400">
            {new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
          </span>
        </div>
        {/* Stats — pill row */}
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {[
            { label: 'Gate', count: stats.atGate, color: 'bg-slate-600' },
            { label: 'Tare', count: stats.tared, color: 'bg-blue-600' },
            { label: 'Loading', count: stats.loading, color: 'bg-amber-600' },
            { label: 'Loaded', count: stats.loaded, color: 'bg-orange-600' },
            { label: 'Out', count: stats.released, color: 'bg-emerald-600' },
            { label: 'All', count: stats.total, color: 'bg-white/10' },
          ].map(s => (
            <div key={s.label} className={`${s.color} rounded-md px-2.5 py-1 text-center min-w-[48px]`}>
              <div className="text-sm font-bold leading-tight">{s.count}</div>
              <div className="text-[8px] text-white/70">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-3 py-2.5">
        {/* Toast */}
        {msg && (
          <div className={`rounded-lg p-2 mb-2 text-xs flex items-center gap-1.5 ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {msg.type === 'ok' ? <CheckCircle size={12} /> : <AlertCircle size={12} />} {msg.text}
          </div>
        )}

        {/* Filter pills */}
        <div className="flex gap-1 mb-2.5 overflow-x-auto pb-0.5">
          {[
            { key: 'ALL', label: 'All', count: shipments.length },
            { key: 'GATE_IN', label: 'Gate', count: stats.atGate },
            { key: 'TARE_WEIGHED', label: 'Tare', count: stats.tared },
            { key: 'LOADING', label: 'Loading', count: stats.loading },
            { key: 'GROSS_WEIGHED', label: 'Loaded', count: stats.loaded },
            { key: 'RELEASED', label: 'Released', count: stats.released },
          ].map(tab => (
            <button key={tab.key} onClick={() => setFilterStatus(tab.key)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap transition-all ${
                filterStatus === tab.key
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
              }`}>
              {tab.label} {tab.count > 0 && <span className="opacity-70">({tab.count})</span>}
            </button>
          ))}
        </div>

        {/* ── Content ── */}
        {loading ? (
          <div className="text-center py-16 text-gray-400">
            <Loader2 size={28} className="animate-spin mx-auto mb-2" />
            <p className="text-xs">Loading vehicles...</p>
          </div>
        ) : grouped.length === 0 ? (
          <div className="text-center py-16">
            <Truck size={40} className="mx-auto text-gray-300 mb-2" />
            <p className="text-gray-400 text-sm">No active vehicles</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {grouped.map(([drId, group]) => {
              const dr = group.dr;
              const orderQty = dr?.quantity || 0;
              const orderUnit = dr?.unit || 'MT';
              const exitedNetMT = group.shipments
                .filter(s => s.status === 'EXITED')
                .reduce((sum, s) => {
                  const net = s.weightNet || (s.weightGross && s.weightTare ? s.weightGross - s.weightTare : 0);
                  return sum + (net ? net / 1000 : 0);
                }, 0);
              const pct = orderQty > 0 ? Math.min(100, (exitedNetMT / orderQty) * 100) : 0;

              return (
                <div key={drId} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  {/* ── Order header ── */}
                  <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-100 flex items-center gap-2 min-h-[32px]">
                    {dr?.drNo ? (
                      <span className="bg-indigo-600 text-white text-[9px] font-bold px-1.5 py-px rounded">#{dr.drNo}</span>
                    ) : (
                      <span className="bg-gray-400 text-white text-[9px] font-bold px-1.5 py-px rounded">—</span>
                    )}
                    <span className="font-semibold text-xs text-gray-800 truncate">{dr?.customerName || 'Unlinked'}</span>
                    {dr?.productName && <span className="text-[10px] text-gray-400 truncate hidden sm:inline">• {dr.productName}</span>}
                    {orderQty > 0 && (
                      <div className="ml-auto flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px]">
                          <span className="font-bold text-green-700">{exitedNetMT.toFixed(1)}</span>
                          <span className="text-gray-400">/{orderQty}{orderUnit}</span>
                        </span>
                        <div className="w-12 h-1 bg-gray-200 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${pct >= 100 ? 'bg-green-500' : 'bg-indigo-500'}`}
                            style={{ width: `${pct}%` }} />
                        </div>
                        <span className={`text-[9px] font-bold ${pct >= 100 ? 'text-green-600' : 'text-indigo-600'}`}>{pct.toFixed(0)}%</span>
                      </div>
                    )}
                  </div>

                  {/* ── Vehicle rows ── */}
                  {group.shipments.map(s => {
                    const cfg = STATUS_CONFIG[s.status];
                    const net = s.weightNet || (s.weightGross && s.weightTare ? s.weightGross - s.weightTare : null);
                    const stepIdx = STATUS_FLOW.indexOf(s.status);
                    const tareTon = fmtTon(s.weightTare);
                    const grossTon = fmtTon(s.weightGross);
                    const netTon = net ? (net / 1000).toFixed(2) : null;
                    const docs = s.documents || [];
                    const docUploaded = (type: string) => docs.some(d => d.docType === type);
                    const isExpanded = expandedId === s.id;
                    const elapsed = timeSince(s.gateInTime);

                    return (
                      <div key={s.id} className={`border-b last:border-b-0 ${isExpanded ? 'bg-slate-50/50' : ''}`}>
                        {/* ── Main row ── */}
                        <div className="px-3 py-1.5">
                          <div className="flex items-center gap-1.5">
                            {/* Vehicle number + expand toggle */}
                            <button
                              onClick={() => { setExpandedId(isExpanded ? null : s.id); setExpandTab('docs'); }}
                              className="flex items-center gap-1.5 min-w-0 flex-1 text-left group"
                            >
                              <Truck size={12} className="text-gray-400 shrink-0" />
                              <span className="font-bold text-[13px] text-gray-900 tracking-tight">{s.vehicleNo}</span>
                              <span className={`text-[8px] font-bold px-1.5 py-px rounded-full ring-1 ${cfg.badge}`}>{cfg.label}</span>
                              {elapsed && (
                                <span className="text-[9px] text-gray-400 flex items-center gap-0.5">
                                  <Clock size={8} />{elapsed}
                                </span>
                              )}
                              <ChevronDown size={10} className={`text-gray-300 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                            </button>

                            {/* Weights — compact inline chips */}
                            <div className="flex items-center gap-1 shrink-0">
                              {tareTon && (
                                <span className="text-[9px] bg-blue-50 text-blue-600 px-1 py-px rounded font-medium">T:{tareTon}</span>
                              )}
                              {grossTon && (
                                <span className="text-[9px] bg-amber-50 text-amber-600 px-1 py-px rounded font-medium">G:{grossTon}</span>
                              )}
                              {netTon && (
                                <span className="text-[9px] bg-green-50 text-green-700 px-1.5 py-px rounded font-bold ring-1 ring-green-200">
                                  {netTon}T
                                </span>
                              )}
                            </div>

                            {/* Action */}
                            <ActionBtn s={s} />
                          </div>

                          {/* Progress bar — ultra thin */}
                          <div className="flex gap-px mt-1">
                            {STATUS_FLOW.map((st, i) => (
                              <div key={st} className={`h-[2px] flex-1 rounded-full transition-all ${
                                i <= stepIdx ? (i === stepIdx && stepIdx < 5 ? 'bg-blue-400 animate-pulse' : 'bg-green-400') : 'bg-gray-200'
                              }`} />
                            ))}
                          </div>

                          {/* Weigh input — inline when active */}
                          {weighId === s.id && (
                            <div className="flex gap-1.5 items-center mt-1.5 bg-blue-50 rounded-lg p-1.5">
                              <Scale size={12} className="text-blue-500 shrink-0" />
                              <input type="number" step="0.01" value={weighVal} onChange={e => setWeighVal(e.target.value)}
                                placeholder={`${weighType === 'tare' ? 'Tare' : 'Gross'} (Tons)`}
                                className="flex-1 px-2 py-1 text-sm border rounded-md bg-white focus:ring-2 focus:ring-blue-300 outline-none"
                                autoFocus
                                onKeyDown={e => e.key === 'Enter' && doWeigh(s.id)} />
                              <button onClick={() => doWeigh(s.id)} disabled={saving}
                                className="px-3 py-1 bg-blue-600 text-white text-xs rounded-md font-semibold hover:bg-blue-700 disabled:opacity-50">
                                {saving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                              </button>
                              <button onClick={() => setWeighId(null)} className="text-gray-400 hover:text-gray-600 p-0.5"><X size={14} /></button>
                            </div>
                          )}
                        </div>

                        {/* ── Expanded panel with tabs ── */}
                        {isExpanded && (
                          <div className="border-t border-gray-100">
                            {/* Mini tab bar */}
                            <div className="flex bg-gray-100/80 border-b border-gray-100">
                              {([
                                { key: 'docs' as ExpandTab, label: 'Docs & Upload', icon: <FileText size={10} /> },
                                { key: 'details' as ExpandTab, label: 'Details', icon: <Truck size={10} /> },
                              ]).map(t => (
                                <button key={t.key} onClick={() => setExpandTab(t.key)}
                                  className={`flex-1 py-1.5 text-[10px] font-medium flex items-center justify-center gap-1 transition-all ${
                                    expandTab === t.key
                                      ? 'bg-white text-slate-800 border-b-2 border-slate-700 shadow-sm'
                                      : 'text-gray-400 hover:text-gray-600'
                                  }`}>
                                  {t.icon} {t.label}
                                </button>
                              ))}
                            </div>

                            {/* Tab content */}
                            <div className="px-3 py-2">
                              {expandTab === 'docs' && (
                                <div className="space-y-1.5">
                                  {/* Doc fields — compact grid */}
                                  <div className="grid grid-cols-2 gap-1.5">
                                    {DOC_TYPES.map(dt => {
                                      const hasDoc = docUploaded(dt.key);
                                      const fieldVal = (s as any)[dt.field] || '';
                                      return (
                                        <div key={dt.key} className={`rounded-lg border p-1.5 ${hasDoc ? 'bg-green-50/50 border-green-200' : 'bg-white border-gray-200'}`}>
                                          <div className="flex items-center justify-between mb-0.5">
                                            <span className="text-[9px] font-bold text-gray-500 uppercase tracking-wide">{dt.label}</span>
                                            {hasDoc && <CheckCircle size={9} className="text-green-500" />}
                                          </div>
                                          <input
                                            defaultValue={fieldVal}
                                            placeholder={`${dt.label} No.`}
                                            className="w-full px-1.5 py-0.5 text-[11px] border border-gray-200 rounded bg-white focus:ring-1 focus:ring-blue-200 outline-none"
                                            onBlur={(e) => {
                                              if (e.target.value !== fieldVal) saveField(s.id, dt.field, e.target.value);
                                            }}
                                          />
                                          {dt.key === 'GR_BILTY' && (
                                            <input type="date" defaultValue={s.grBiltyDate || ''}
                                              className="w-full px-1.5 py-0.5 text-[11px] border border-gray-200 rounded bg-white mt-0.5 focus:ring-1 focus:ring-blue-200 outline-none"
                                              onBlur={(e) => {
                                                if (e.target.value !== (s.grBiltyDate || '')) saveField(s.id, 'grBiltyDate', e.target.value);
                                              }}
                                            />
                                          )}
                                          {/* Upload buttons — single row */}
                                          <div className="flex gap-0.5 mt-1">
                                            {([
                                              { src: 'camera' as const, icon: <Camera size={8} />, label: 'Cam', color: 'bg-blue-50 text-blue-600 hover:bg-blue-100' },
                                              { src: 'gallery' as const, icon: <Image size={8} />, label: 'Pic', color: 'bg-purple-50 text-purple-600 hover:bg-purple-100' },
                                              { src: 'file' as const, icon: <Upload size={8} />, label: 'File', color: 'bg-gray-50 text-gray-600 hover:bg-gray-100' },
                                            ]).map(btn => (
                                              <button key={btn.src} onClick={() => uploadDoc(s.id, dt.key, btn.src)}
                                                disabled={uploadingDoc === `${s.id}_${dt.key}`}
                                                className={`flex-1 py-0.5 text-[8px] font-medium rounded flex items-center justify-center gap-0.5 transition-colors ${btn.color}`}>
                                                {uploadingDoc === `${s.id}_${dt.key}` ? <Loader2 size={8} className="animate-spin" /> : btn.icon} {btn.label}
                                              </button>
                                            ))}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>

                                  {/* Challan PDF button */}
                                  <button onClick={() => { const token = localStorage.getItem('token'); window.open(`/api/shipments/${s.id}/challan-pdf?token=${token}`, '_blank'); }}
                                    className="w-full py-1.5 text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 rounded-lg flex items-center justify-center gap-1 hover:bg-blue-100 transition-colors">
                                    <FileText size={11} /> Download Challan PDF
                                  </button>
                                </div>
                              )}

                              {expandTab === 'details' && (
                                <div className="space-y-2">
                                  {/* Driver & transporter */}
                                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                                    {s.driverName && (
                                      <span className="text-gray-700 font-medium">🧑 {s.driverName}</span>
                                    )}
                                    {s.driverMobile && (
                                      <a href={`tel:${s.driverMobile}`} className="text-blue-600 flex items-center gap-0.5 hover:underline">
                                        <Phone size={10} /> {s.driverMobile}
                                      </a>
                                    )}
                                    {s.transporterName && (
                                      <span className="text-gray-400">🚚 {s.transporterName}</span>
                                    )}
                                    {s.destination && (
                                      <span className="text-gray-400 flex items-center gap-0.5">
                                        <MapPin size={10} /> {s.destination}
                                      </span>
                                    )}
                                  </div>

                                  {/* Weights detail */}
                                  <div className="grid grid-cols-3 gap-1.5">
                                    <div className="bg-blue-50 rounded-lg p-1.5 text-center">
                                      <div className="text-[8px] text-blue-400 font-bold uppercase">Tare</div>
                                      <div className="text-xs font-bold text-blue-700">{tareTon ? `${tareTon} T` : '—'}</div>
                                      {s.tareTime && <div className="text-[8px] text-blue-300">{new Date(s.tareTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>}
                                    </div>
                                    <div className="bg-amber-50 rounded-lg p-1.5 text-center">
                                      <div className="text-[8px] text-amber-400 font-bold uppercase">Gross</div>
                                      <div className="text-xs font-bold text-amber-700">{grossTon ? `${grossTon} T` : '—'}</div>
                                      {s.grossTime && <div className="text-[8px] text-amber-300">{new Date(s.grossTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>}
                                    </div>
                                    <div className={`rounded-lg p-1.5 text-center ${netTon ? 'bg-green-50' : 'bg-gray-50'}`}>
                                      <div className={`text-[8px] font-bold uppercase ${netTon ? 'text-green-400' : 'text-gray-300'}`}>Net</div>
                                      <div className={`text-xs font-bold ${netTon ? 'text-green-700' : 'text-gray-400'}`}>{netTon ? `${netTon} T` : '—'}</div>
                                    </div>
                                  </div>

                                  {/* Share/WhatsApp row */}
                                  <div className="flex gap-1.5">
                                    <button onClick={() => shareStatus(s)}
                                      className="flex-1 py-1.5 text-[10px] font-medium bg-gray-100 text-gray-600 rounded-lg flex items-center justify-center gap-1 hover:bg-gray-200 transition-colors">
                                      <Share2 size={10} /> Share Status
                                    </button>
                                    {s.driverMobile && (
                                      <a href={`https://api.whatsapp.com/send?phone=91${s.driverMobile.replace(/\D/g, '').slice(-10)}`}
                                        target="_blank" rel="noopener"
                                        className="flex-1 py-1.5 text-[10px] font-medium bg-green-100 text-green-700 rounded-lg flex items-center justify-center gap-1 hover:bg-green-200 transition-colors">
                                        <MessageCircle size={10} /> WhatsApp Driver
                                      </a>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
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
    </div>
  );
}
