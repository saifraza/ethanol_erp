import { useState, useEffect, useMemo } from 'react';
import {
  Truck, X, Loader2, Share2, MessageCircle, Phone, ChevronDown,
  Scale, CheckCircle, AlertCircle, Package, FileText, Camera, Upload, Image
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

const STATUS_CONFIG: Record<string, { label: string; badge: string; short: string }> = {
  GATE_IN:        { label: 'At Gate',  badge: 'bg-gray-100 text-gray-700',     short: 'Gate' },
  TARE_WEIGHED:   { label: 'Tare OK',  badge: 'bg-blue-100 text-blue-700',     short: 'Tare' },
  LOADING:        { label: 'Loading',  badge: 'bg-amber-100 text-amber-700',   short: 'Load' },
  GROSS_WEIGHED:  { label: 'Loaded',   badge: 'bg-orange-100 text-orange-700', short: 'Gross' },
  RELEASED:       { label: 'Released', badge: 'bg-green-100 text-green-700',   short: 'Out' },
  EXITED:         { label: 'Exited',   badge: 'bg-emerald-100 text-emerald-700',short: 'Done' },
};

const DOC_TYPES = [
  { key: 'INVOICE', label: 'Bill', field: 'invoiceRef' },
  { key: 'EWAY_BILL', label: 'E-Way Bill', field: 'ewayBill' },
  { key: 'GATE_PASS', label: 'Gate Pass', field: 'gatePassNo' },
  { key: 'GR_BILTY', label: 'Bilty', field: 'grBiltyNo' },
];

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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-700 to-blue-800 text-white">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-lg font-bold flex items-center gap-2">
              <Scale size={20} /> Weighbridge & Gate
            </h1>
            <span className="text-xs text-blue-200">
              {new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
            </span>
          </div>
          {/* Stats — compact */}
          <div className="grid grid-cols-6 gap-1.5">
            {[
              { label: 'Gate', count: stats.atGate, bg: 'bg-gray-500/30' },
              { label: 'Tare', count: stats.tared, bg: 'bg-blue-500/30' },
              { label: 'Loading', count: stats.loading, bg: 'bg-amber-500/30' },
              { label: 'Loaded', count: stats.loaded, bg: 'bg-orange-500/30' },
              { label: 'Released', count: stats.released, bg: 'bg-green-500/30' },
              { label: 'Total', count: stats.total, bg: 'bg-white/15' },
            ].map(s => (
              <div key={s.label} className={`${s.bg} rounded-lg px-2 py-1.5 text-center`}>
                <div className="text-lg font-bold leading-tight">{s.count}</div>
                <div className="text-[8px] text-blue-100">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-3">
        {msg && (
          <div className={`rounded-lg p-2.5 mb-3 text-sm flex items-center gap-2 ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {msg.type === 'ok' ? <CheckCircle size={14} /> : <AlertCircle size={14} />} {msg.text}
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
          {[
            { key: 'ALL', label: `All (${shipments.length})` },
            { key: 'GATE_IN', label: `Gate (${stats.atGate})` },
            { key: 'TARE_WEIGHED', label: `Tare (${stats.tared})` },
            { key: 'LOADING', label: `Loading (${stats.loading})` },
            { key: 'GROSS_WEIGHED', label: `Loaded (${stats.loaded})` },
            { key: 'RELEASED', label: `Released (${stats.released})` },
          ].map(tab => (
            <button key={tab.key} onClick={() => setFilterStatus(tab.key)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition ${
                filterStatus === tab.key ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border hover:bg-gray-50'
              }`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">
            <Loader2 size={32} className="animate-spin mx-auto mb-2" />
          </div>
        ) : grouped.length === 0 ? (
          <div className="text-center py-12">
            <Scale size={48} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 text-sm">No active vehicles</p>
          </div>
        ) : (
          <div className="space-y-3">
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
              const totalNetMT = group.shipments.reduce((sum, s) => {
                const net = s.weightNet || (s.weightGross && s.weightTare ? s.weightGross - s.weightTare : 0);
                return sum + (net ? net / 1000 : 0);
              }, 0);
              const pct = orderQty > 0 ? Math.min(100, (exitedNetMT / orderQty) * 100) : 0;

              return (
                <div key={drId} className="bg-white rounded-lg border shadow-sm overflow-hidden">
                  {/* Order Header — compact */}
                  <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border-b px-3 py-2">
                    <div className="flex items-center gap-2 text-sm">
                      {dr?.drNo && (
                        <span className="bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded">DR #{dr.drNo}</span>
                      )}
                      <span className="font-semibold text-gray-800 truncate">{dr?.customerName || 'Unlinked'}</span>
                      <span className="text-xs text-gray-500">{dr?.productName}</span>
                      <span className="ml-auto text-xs shrink-0">
                        <span className="font-bold text-green-700">{exitedNetMT.toFixed(1)}</span>
                        <span className="text-gray-400">/{orderQty} {orderUnit}</span>
                        <span className={`ml-1 font-bold ${pct >= 100 ? 'text-green-600' : 'text-orange-600'}`}>{pct.toFixed(0)}%</span>
                      </span>
                    </div>
                    <div className="w-full h-1 bg-gray-200 rounded-full mt-1.5 overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-green-500' : 'bg-indigo-500'}`}
                        style={{ width: `${pct}%` }} />
                    </div>
                  </div>

                  {/* Vehicles — compact rows */}
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
                    const docCount = docs.length;

                    return (
                      <div key={s.id} className="border-b last:border-b-0">
                        {/* ── Compact row: vehicle, status, weights, action ── */}
                        <div className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {/* Vehicle + status */}
                            <button onClick={() => setExpandedId(isExpanded ? null : s.id)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
                              <span className="font-bold text-sm text-gray-900">{s.vehicleNo}</span>
                              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${cfg.badge}`}>{cfg.label}</span>
                              {s.driverName && <span className="text-[11px] text-gray-400 truncate hidden sm:inline">{s.driverName}</span>}
                              {docCount > 0 && (
                                <span className="text-[9px] text-green-600 font-medium shrink-0">{docCount} doc{docCount > 1 ? 's' : ''}</span>
                              )}
                              <ChevronDown size={12} className={`text-gray-400 shrink-0 transition ${isExpanded ? 'rotate-180' : ''}`} />
                            </button>

                            {/* Weights inline */}
                            <div className="flex items-center gap-2 text-xs shrink-0">
                              {tareTon && <span className="text-gray-500">T:{tareTon}</span>}
                              {grossTon && <span className="text-gray-500">G:{grossTon}</span>}
                              {netTon && <span className="font-bold text-green-700">N:{netTon}T</span>}
                            </div>

                            {/* Inline action button */}
                            {weighId === s.id ? null : (
                              <div className="shrink-0">
                                {s.status === 'GATE_IN' && (
                                  <button onClick={() => { setWeighId(s.id); setWeighType('tare'); setWeighVal(''); }}
                                    className="px-2.5 py-1.5 bg-gray-600 text-white rounded-lg font-medium text-[11px] flex items-center gap-1">
                                    <Scale size={12} /> Tare
                                  </button>
                                )}
                                {s.status === 'TARE_WEIGHED' && (
                                  <button onClick={() => doStatus(s.id, 'LOADING', { loadStartTime: new Date().toISOString() })}
                                    disabled={saving}
                                    className="px-2.5 py-1.5 bg-blue-600 text-white rounded-lg font-medium text-[11px]">
                                    {saving ? <Loader2 size={12} className="animate-spin" /> : 'Load'}
                                  </button>
                                )}
                                {s.status === 'LOADING' && (
                                  <button onClick={() => { setWeighId(s.id); setWeighType('gross'); setWeighVal(''); }}
                                    className="px-2.5 py-1.5 bg-amber-600 text-white rounded-lg font-medium text-[11px] flex items-center gap-1">
                                    <Scale size={12} /> Gross
                                  </button>
                                )}
                                {s.status === 'GROSS_WEIGHED' && (
                                  <button onClick={() => doStatus(s.id, 'RELEASED', { releaseTime: new Date().toISOString() })}
                                    disabled={saving}
                                    className="px-2.5 py-1.5 bg-orange-600 text-white rounded-lg font-medium text-[11px]">
                                    {saving ? <Loader2 size={12} className="animate-spin" /> : 'Release'}
                                  </button>
                                )}
                                {s.status === 'RELEASED' && (
                                  <button onClick={() => doStatus(s.id, 'EXITED', { exitTime: new Date().toISOString() })}
                                    disabled={saving}
                                    className="px-2.5 py-1.5 bg-green-600 text-white rounded-lg font-medium text-[11px]">
                                    {saving ? <Loader2 size={12} className="animate-spin" /> : 'Exit'}
                                  </button>
                                )}
                                {s.status === 'EXITED' && (
                                  <span className="text-emerald-600 text-[11px] font-medium flex items-center gap-0.5"><CheckCircle size={12} /> Done</span>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Weigh input — inline when active */}
                          {weighId === s.id && (
                            <div className="flex gap-1.5 items-center mt-2">
                              <input type="number" step="0.01" value={weighVal} onChange={e => setWeighVal(e.target.value)}
                                placeholder={`${weighType === 'tare' ? 'Tare' : 'Gross'} weight (Tons)`}
                                className="input-field text-sm flex-1" autoFocus
                                onKeyDown={e => e.key === 'Enter' && doWeigh(s.id)} />
                              <button onClick={() => doWeigh(s.id)} disabled={saving}
                                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50">
                                {saving ? <Loader2 size={14} className="animate-spin" /> : 'Save'}
                              </button>
                              <button onClick={() => setWeighId(null)} className="text-gray-400 p-1"><X size={16} /></button>
                            </div>
                          )}

                          {/* Progress dots — thin */}
                          <div className="flex gap-0.5 mt-1.5">
                            {STATUS_FLOW.map((st, i) => (
                              <div key={st} className={`h-0.5 flex-1 rounded-full ${
                                i <= stepIdx ? 'bg-green-500' : 'bg-gray-200'
                              } ${i === stepIdx && stepIdx < 5 ? 'animate-pulse' : ''}`} />
                            ))}
                          </div>
                        </div>

                        {/* ── Expanded: docs, driver, share ── */}
                        {isExpanded && (
                          <div className="bg-gray-50 border-t px-3 py-2.5 space-y-2.5">
                            {/* Driver info & share */}
                            <div className="flex items-center gap-3 text-xs text-gray-600">
                              {s.driverName && <span className="font-medium">{s.driverName}</span>}
                              {s.driverMobile && (
                                <a href={`tel:${s.driverMobile}`} className="text-blue-600 flex items-center gap-0.5">
                                  <Phone size={10} /> {s.driverMobile}
                                </a>
                              )}
                              {s.transporterName && <span className="text-gray-400">{s.transporterName}</span>}
                              <div className="ml-auto flex gap-1.5">
                                <button onClick={() => shareStatus(s)}
                                  className="px-2 py-1 bg-green-100 text-green-700 rounded text-[10px] font-medium flex items-center gap-0.5">
                                  <Share2 size={10} /> Share
                                </button>
                                {s.driverMobile && (
                                  <a href={`https://api.whatsapp.com/send?phone=91${s.driverMobile.replace(/\D/g, '').slice(-10)}`}
                                    target="_blank" rel="noopener"
                                    className="px-2 py-1 bg-green-100 text-green-700 rounded text-[10px] font-medium flex items-center gap-0.5">
                                    <MessageCircle size={10} /> WA
                                  </a>
                                )}
                              </div>
                            </div>

                            {/* Weights detail row */}
                            <div className="flex gap-3 text-xs">
                              <div className="bg-blue-50 rounded px-2 py-1">
                                <span className="text-gray-400">Tare:</span> <span className="font-bold">{tareTon ? `${tareTon} T` : '—'}</span>
                              </div>
                              <div className="bg-amber-50 rounded px-2 py-1">
                                <span className="text-gray-400">Gross:</span> <span className="font-bold">{grossTon ? `${grossTon} T` : '—'}</span>
                              </div>
                              <div className={`rounded px-2 py-1 ${netTon ? 'bg-green-50' : 'bg-gray-50'}`}>
                                <span className="text-gray-400">Net:</span> <span className={`font-bold ${netTon ? 'text-green-700' : ''}`}>{netTon ? `${netTon} T` : '—'}</span>
                              </div>
                            </div>

                            {/* Document fields — compact 2x2 grid */}
                            {['TARE_WEIGHED', 'LOADING', 'GROSS_WEIGHED', 'RELEASED', 'EXITED'].includes(s.status) && (
                              <div className="grid grid-cols-2 gap-1.5">
                                {DOC_TYPES.map(dt => {
                                  const hasDoc = docUploaded(dt.key);
                                  const fieldVal = (s as any)[dt.field] || '';
                                  return (
                                    <div key={dt.key} className={`rounded border p-1.5 ${hasDoc ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}>
                                      <div className="flex items-center justify-between mb-0.5">
                                        <span className="text-[9px] font-semibold text-gray-600">{dt.label}</span>
                                        {hasDoc && <CheckCircle size={10} className="text-green-600" />}
                                      </div>
                                      <input
                                        defaultValue={fieldVal}
                                        placeholder={`${dt.label} No.`}
                                        className="w-full px-1.5 py-0.5 text-[11px] border rounded bg-white mb-0.5"
                                        onBlur={(e) => {
                                          if (e.target.value !== fieldVal) saveField(s.id, dt.field, e.target.value);
                                        }}
                                      />
                                      {dt.key === 'GR_BILTY' && (
                                        <input type="date" defaultValue={s.grBiltyDate || ''}
                                          className="w-full px-1.5 py-0.5 text-[11px] border rounded bg-white mb-0.5"
                                          onBlur={(e) => {
                                            if (e.target.value !== (s.grBiltyDate || '')) saveField(s.id, 'grBiltyDate', e.target.value);
                                          }}
                                        />
                                      )}
                                      <div className="flex gap-0.5">
                                        <button onClick={() => uploadDoc(s.id, dt.key, 'camera')}
                                          disabled={uploadingDoc === `${s.id}_${dt.key}`}
                                          className="flex-1 py-0.5 text-[8px] font-medium bg-blue-100 text-blue-700 rounded flex items-center justify-center gap-0.5">
                                          {uploadingDoc === `${s.id}_${dt.key}` ? <Loader2 size={8} className="animate-spin" /> : <Camera size={8} />} Cam
                                        </button>
                                        <button onClick={() => uploadDoc(s.id, dt.key, 'gallery')}
                                          disabled={uploadingDoc === `${s.id}_${dt.key}`}
                                          className="flex-1 py-0.5 text-[8px] font-medium bg-purple-100 text-purple-700 rounded flex items-center justify-center gap-0.5">
                                          <Image size={8} /> Pic
                                        </button>
                                        <button onClick={() => uploadDoc(s.id, dt.key, 'file')}
                                          disabled={uploadingDoc === `${s.id}_${dt.key}`}
                                          className="flex-1 py-0.5 text-[8px] font-medium bg-gray-100 text-gray-700 rounded flex items-center justify-center gap-0.5">
                                          <Upload size={8} /> File
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* Doc badges for early states */}
                            {!['TARE_WEIGHED', 'LOADING', 'GROSS_WEIGHED', 'RELEASED', 'EXITED'].includes(s.status) && docs.length > 0 && (
                              <div className="flex gap-1">
                                {docs.map(d => (
                                  <span key={d.id} className="text-[9px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full font-medium">
                                    {d.docType.replace(/_/g, ' ')}
                                  </span>
                                ))}
                              </div>
                            )}

                            {/* Challan PDF */}
                            <div className="flex gap-1.5">
                              <button onClick={() => { const token = localStorage.getItem('token'); window.open(`/api/shipments/${s.id}/challan-pdf?token=${token}`, '_blank'); }}
                                className="px-2 py-1 text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded flex items-center gap-0.5">
                                <FileText size={10} /> Challan PDF
                              </button>
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
