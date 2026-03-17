import { useState, useEffect, useMemo } from 'react';
import {
  Truck, X, Loader2, Share2, MessageCircle, Phone,
  Scale, CheckCircle, AlertCircle, Package, MapPin, FileText, Camera, Upload, Image
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
  const [releaseId, setReleaseId] = useState<string | null>(null);
  const [relChallan, setRelChallan] = useState('');
  const [relEway, setRelEway] = useState('');
  const [relGatePass, setRelGatePass] = useState('');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);

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
      const w = parseFloat(weighVal) * 1000; // Input in tons, store in kg
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

  const generateEwayBill = async (id: string) => {
    setSaving(true);
    try {
      const r = await api.post(`/shipments/${id}/eway-bill`);
      flash('ok', `E-Way Bill: ${r.data.ewayBillNo}`);
      setRelEway(r.data.ewayBillNo);
      loadShipments();
    } catch (e: any) {
      flash('err', e.response?.data?.error || 'E-Way Bill failed');
    }
    setSaving(false);
  };

  const doStatus = async (id: string, status: string, extra?: any) => {
    setSaving(true);
    try {
      await api.put(`/shipments/${id}/status`, { status, ...extra });
      flash('ok', status.replace(/_/g, ' '));
      if (status === 'RELEASED') { setReleaseId(null); setRelChallan(''); setRelEway(''); setRelGatePass(''); }
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
        await api.post(`/shipments/${shipmentId}/documents`, fd);
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
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Scale size={24} /> Weighbridge & Gate
            </h1>
            <span className="text-sm text-blue-200">
              {new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
            </span>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-6 gap-2">
            {[
              { label: 'At Gate', count: stats.atGate, bg: 'bg-gray-500/30' },
              { label: 'Tare Done', count: stats.tared, bg: 'bg-blue-500/30' },
              { label: 'Loading', count: stats.loading, bg: 'bg-amber-500/30' },
              { label: 'Loaded', count: stats.loaded, bg: 'bg-orange-500/30' },
              { label: 'Released', count: stats.released, bg: 'bg-green-500/30' },
              { label: 'Total', count: stats.total, bg: 'bg-white/15' },
            ].map(s => (
              <div key={s.label} className={`${s.bg} rounded-lg p-2 text-center`}>
                <div className="text-xl font-bold">{s.count}</div>
                <div className="text-[9px] text-blue-100">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-4">
        {msg && (
          <div className={`rounded-lg p-3 mb-3 text-sm flex items-center gap-2 ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {msg.type === 'ok' ? <CheckCircle size={16} /> : <AlertCircle size={16} />} {msg.text}
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
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition ${
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
          <div className="space-y-4">
            {grouped.map(([drId, group]) => {
              const dr = group.dr;
              const orderQty = dr?.quantity || 0;
              const orderUnit = dr?.unit || 'MT';
              const totalNetMT = group.shipments.reduce((sum, s) => {
                const net = s.weightNet || (s.weightGross && s.weightTare ? s.weightGross - s.weightTare : 0);
                return sum + (net ? net / 1000 : 0);
              }, 0);
              const pct = orderQty > 0 ? Math.min(100, (totalNetMT / orderQty) * 100) : 0;

              return (
                <div key={drId} className="bg-white rounded-xl border shadow-sm overflow-hidden">
                  {/* Order Header */}
                  <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border-b px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-wrap">
                        {dr?.drNo && (
                          <span className="bg-indigo-600 text-white text-xs font-bold px-2.5 py-1 rounded-lg">
                            DR #{dr.drNo}
                          </span>
                        )}
                        <span className="font-bold text-gray-800">{dr?.customerName || 'Unlinked'}</span>
                        <span className="flex items-center gap-1 text-sm text-gray-600">
                          <Package size={14} /> {dr?.productName} · <span className="font-bold text-indigo-700">{orderQty} {orderUnit}</span>
                        </span>
                      </div>
                      <div className="text-right">
                        <div className="text-sm">
                          <span className="font-bold text-green-700">{totalNetMT.toFixed(1)} MT</span>
                          <span className="text-gray-400"> / {orderQty} {orderUnit}</span>
                        </div>
                        <span className={`text-xs font-bold ${pct >= 100 ? 'text-green-600' : 'text-orange-600'}`}>
                          {pct.toFixed(0)}% dispatched
                        </span>
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div className="w-full h-2 bg-gray-200 rounded-full mt-2 overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-green-500' : 'bg-indigo-500'}`}
                        style={{ width: `${pct}%` }} />
                    </div>
                  </div>

                  {/* Vehicles */}
                  {group.shipments.map(s => {
                    const cfg = STATUS_CONFIG[s.status];
                    const net = s.weightNet || (s.weightGross && s.weightTare ? s.weightGross - s.weightTare : null);
                    const stepIdx = STATUS_FLOW.indexOf(s.status);
                    const tareTon = fmtTon(s.weightTare);
                    const grossTon = fmtTon(s.weightGross);
                    const netTon = net ? (net / 1000).toFixed(2) : null;
                    const docs = s.documents || [];
                    const docUploaded = (type: string) => docs.some(d => d.docType === type);

                    return (
                      <div key={s.id} className="border-b last:border-b-0 p-4 hover:bg-gray-50/50">
                        {/* Vehicle row */}
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-lg text-gray-900">{s.vehicleNo}</span>
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cfg.badge}`}>{cfg.label}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
                              {s.driverName && <span>{s.driverName}</span>}
                              {s.driverMobile && (
                                <a href={`tel:${s.driverMobile}`} className="text-blue-600 flex items-center gap-0.5">
                                  <Phone size={10} /> {s.driverMobile}
                                </a>
                              )}
                              {s.transporterName && <span className="text-gray-400">({s.transporterName})</span>}
                            </div>
                          </div>
                          <div className="text-right">
                            {netTon && (
                              <div className="text-xl font-bold text-green-700">{netTon} <span className="text-sm">T</span></div>
                            )}
                          </div>
                        </div>

                        {/* Weights in tons */}
                        <div className="grid grid-cols-3 gap-3 mb-3 text-sm">
                          <div className="bg-blue-50 rounded-lg p-2 text-center">
                            <div className="text-[10px] text-gray-500 mb-0.5">Tare</div>
                            <div className="font-bold text-gray-700">{tareTon ? `${tareTon} T` : '—'}</div>
                          </div>
                          <div className="bg-amber-50 rounded-lg p-2 text-center">
                            <div className="text-[10px] text-gray-500 mb-0.5">Gross</div>
                            <div className="font-bold text-gray-700">{grossTon ? `${grossTon} T` : '—'}</div>
                          </div>
                          <div className={`rounded-lg p-2 text-center ${netTon ? 'bg-green-50' : 'bg-gray-50'}`}>
                            <div className="text-[10px] text-gray-500 mb-0.5">Net</div>
                            <div className={`font-bold ${netTon ? 'text-green-700' : 'text-gray-400'}`}>
                              {netTon ? `${netTon} T` : '—'}
                            </div>
                          </div>
                        </div>

                        {/* Progress dots */}
                        <div className="flex gap-0.5 mb-3">
                          {STATUS_FLOW.map((st, i) => (
                            <div key={st} className={`h-1.5 flex-1 rounded-full ${
                              i <= stepIdx ? 'bg-green-500' : 'bg-gray-200'
                            } ${i === stepIdx && stepIdx < 5 ? 'animate-pulse' : ''}`} />
                          ))}
                        </div>

                        {/* 4 Document fields */}
                        {['GROSS_WEIGHED', 'RELEASED', 'EXITED'].includes(s.status) && (
                          <div className="grid grid-cols-2 gap-2 mb-3">
                            {DOC_TYPES.map(dt => {
                              const hasDoc = docUploaded(dt.key);
                              const fieldVal = (s as any)[dt.field] || '';
                              return (
                                <div key={dt.key} className={`rounded-lg border p-2 ${hasDoc ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-[10px] font-semibold text-gray-600">{dt.label}</span>
                                    {hasDoc && <CheckCircle size={12} className="text-green-600" />}
                                  </div>
                                  <input
                                    defaultValue={fieldVal}
                                    placeholder={`${dt.label} No.`}
                                    className="w-full px-2 py-1 text-xs border rounded bg-white mb-1"
                                    onBlur={(e) => {
                                      if (e.target.value !== fieldVal) {
                                        saveField(s.id, dt.field, e.target.value);
                                      }
                                    }}
                                  />
                                  {dt.key === 'GR_BILTY' && (
                                    <input
                                      type="date"
                                      defaultValue={s.grBiltyDate || ''}
                                      className="w-full px-2 py-1 text-xs border rounded bg-white mb-1"
                                      onBlur={(e) => {
                                        if (e.target.value !== (s.grBiltyDate || '')) {
                                          saveField(s.id, 'grBiltyDate', e.target.value);
                                        }
                                      }}
                                    />
                                  )}
                                  {/* Upload buttons */}
                                  <div className="flex gap-1">
                                    <button onClick={() => uploadDoc(s.id, dt.key, 'camera')}
                                      disabled={uploadingDoc === `${s.id}_${dt.key}`}
                                      className="flex-1 py-1 text-[9px] font-medium bg-blue-100 text-blue-700 rounded flex items-center justify-center gap-0.5 hover:bg-blue-200">
                                      {uploadingDoc === `${s.id}_${dt.key}` ? <Loader2 size={9} className="animate-spin" /> : <Camera size={9} />} Camera
                                    </button>
                                    <button onClick={() => uploadDoc(s.id, dt.key, 'gallery')}
                                      disabled={uploadingDoc === `${s.id}_${dt.key}`}
                                      className="flex-1 py-1 text-[9px] font-medium bg-purple-100 text-purple-700 rounded flex items-center justify-center gap-0.5 hover:bg-purple-200">
                                      <Image size={9} /> Gallery
                                    </button>
                                    <button onClick={() => uploadDoc(s.id, dt.key, 'file')}
                                      disabled={uploadingDoc === `${s.id}_${dt.key}`}
                                      className="flex-1 py-1 text-[9px] font-medium bg-gray-100 text-gray-700 rounded flex items-center justify-center gap-0.5 hover:bg-gray-200">
                                      <Upload size={9} /> File
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Doc badges for non-loaded states */}
                        {!['GROSS_WEIGHED', 'RELEASED', 'EXITED'].includes(s.status) && docs.length > 0 && (
                          <div className="flex gap-1 mb-2">
                            {docs.map(d => (
                              <span key={d.id} className="text-[9px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full font-medium">
                                {d.docType.replace(/_/g, ' ')}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Action buttons */}
                        <div className="flex gap-2 items-center">
                          {weighId === s.id ? (
                            <div className="flex gap-1.5 items-center flex-1">
                              <input type="number" step="0.01" value={weighVal} onChange={e => setWeighVal(e.target.value)}
                                placeholder={`${weighType === 'tare' ? 'Tare' : 'Gross'} weight (Tons)`}
                                className="input-field text-sm flex-1" autoFocus
                                onKeyDown={e => e.key === 'Enter' && doWeigh(s.id)} />
                              <button onClick={() => doWeigh(s.id)} disabled={saving}
                                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50">
                                {saving ? <Loader2 size={14} className="animate-spin" /> : 'Save'}
                              </button>
                              <button onClick={() => setWeighId(null)} className="text-gray-400 p-2"><X size={16} /></button>
                            </div>
                          ) : releaseId === s.id ? (
                            <div className="flex-1 space-y-1.5">
                              <div className="grid grid-cols-3 gap-1.5">
                                <input value={relChallan} onChange={e => setRelChallan(e.target.value)} placeholder="Challan No" className="input-field text-xs" />
                                <div className="flex gap-0.5">
                                  <input value={relEway} onChange={e => setRelEway(e.target.value)} placeholder="E-Way Bill" className="input-field text-xs flex-1" />
                                  <button onClick={() => generateEwayBill(s.id)} disabled={saving || !s.weightNet}
                                    className="px-2 py-1 bg-indigo-600 text-white text-[9px] rounded font-medium disabled:opacity-50">⚡</button>
                                </div>
                                <input value={relGatePass} onChange={e => setRelGatePass(e.target.value)} placeholder="Gate Pass" className="input-field text-xs" />
                              </div>
                              <div className="flex gap-1.5">
                                <button onClick={() => doStatus(s.id, 'RELEASED', {
                                  challanNo: relChallan, ewayBill: relEway, gatePassNo: relGatePass, releaseTime: new Date().toISOString()
                                })} className="flex-1 py-2 bg-orange-600 text-white text-sm rounded-lg font-medium">Release</button>
                                <button onClick={() => setReleaseId(null)} className="px-3 py-2 text-gray-500"><X size={16} /></button>
                              </div>
                            </div>
                          ) : (
                            <>
                              {s.status === 'GATE_IN' && (
                                <button onClick={() => { setWeighId(s.id); setWeighType('tare'); setWeighVal(''); }}
                                  className="flex-1 py-2.5 bg-gray-600 text-white rounded-lg font-medium text-sm flex items-center justify-center gap-1.5">
                                  <Scale size={14} /> Weigh Tare (Tons)
                                </button>
                              )}
                              {s.status === 'TARE_WEIGHED' && (
                                <button onClick={() => doStatus(s.id, 'LOADING', { loadStartTime: new Date().toISOString() })}
                                  disabled={saving}
                                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg font-medium text-sm">
                                  {saving ? <Loader2 size={14} className="animate-spin" /> : '▶ Start Loading'}
                                </button>
                              )}
                              {s.status === 'LOADING' && (
                                <button onClick={() => { setWeighId(s.id); setWeighType('gross'); setWeighVal(''); }}
                                  className="flex-1 py-2.5 bg-amber-600 text-white rounded-lg font-medium text-sm flex items-center justify-center gap-1.5">
                                  <Scale size={14} /> Weigh Gross (Tons)
                                </button>
                              )}
                              {s.status === 'GROSS_WEIGHED' && (
                                <button onClick={() => setReleaseId(s.id)}
                                  className="flex-1 py-2.5 bg-orange-600 text-white rounded-lg font-medium text-sm">
                                  🔓 Release
                                </button>
                              )}
                              {s.status === 'RELEASED' && (
                                <button onClick={() => doStatus(s.id, 'EXITED', { exitTime: new Date().toISOString() })}
                                  disabled={saving}
                                  className="flex-1 py-2.5 bg-green-600 text-white rounded-lg font-medium text-sm">
                                  {saving ? <Loader2 size={14} className="animate-spin" /> : '🚗 Gate Exit'}
                                </button>
                              )}
                              {s.status === 'EXITED' && (
                                <span className="text-emerald-600 text-sm font-medium">✓ Complete</span>
                              )}
                              <button onClick={() => shareStatus(s)}
                                className="px-3 py-2.5 bg-green-100 text-green-700 rounded-lg"><Share2 size={14} /></button>
                              {s.driverMobile && (
                                <a href={`https://api.whatsapp.com/send?phone=91${s.driverMobile.replace(/\D/g, '').slice(-10)}`}
                                  target="_blank" rel="noopener"
                                  className="px-3 py-2.5 bg-green-100 text-green-700 rounded-lg">
                                  <MessageCircle size={14} />
                                </a>
                              )}
                            </>
                          )}
                        </div>
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
