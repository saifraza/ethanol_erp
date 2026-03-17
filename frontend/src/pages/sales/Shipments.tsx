import { useState, useEffect } from 'react';
import {
  Truck, Plus, X, Save, Loader2, Share2, MessageCircle, Phone,
  Scale, CheckCircle, AlertCircle, Clock, Package, MapPin, User, FileText
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
  tareTime?: string; grossTime?: string; releaseTime?: string; exitTime?: string;
  dispatchRequest?: { drNo?: number; customerName?: string; productName?: string; quantity?: number; unit?: string };
}

const STATUS_FLOW = ['GATE_IN', 'TARE_WEIGHED', 'LOADING', 'GROSS_WEIGHED', 'RELEASED', 'EXITED'] as const;

const STATUS_CONFIG: Record<string, { label: string; color: string; badge: string; short: string }> = {
  GATE_IN:        { label: 'At Gate',  color: 'gray',   badge: 'bg-gray-100 text-gray-700',     short: 'Gate' },
  TARE_WEIGHED:   { label: 'Tare OK',  color: 'blue',   badge: 'bg-blue-100 text-blue-700',     short: 'Tare' },
  LOADING:        { label: 'Loading',  color: 'amber',  badge: 'bg-amber-100 text-amber-700',   short: 'Load' },
  GROSS_WEIGHED:  { label: 'Loaded',   color: 'orange', badge: 'bg-orange-100 text-orange-700', short: 'Gross' },
  RELEASED:       { label: 'Released', color: 'green',  badge: 'bg-green-100 text-green-700',   short: 'Out' },
  EXITED:         { label: 'Exited',   color: 'emerald',badge: 'bg-emerald-100 text-emerald-700',short: 'Done' },
};

export default function Shipments() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Inline action states (keyed by shipment id)
  const [weighId, setWeighId] = useState<string | null>(null);
  const [weighVal, setWeighVal] = useState('');
  const [weighType, setWeighType] = useState<'tare' | 'gross'>('tare');
  const [releaseId, setReleaseId] = useState<string | null>(null);
  const [relChallan, setRelChallan] = useState('');
  const [relEway, setRelEway] = useState('');
  const [relGatePass, setRelGatePass] = useState('');
  const [filterStatus, setFilterStatus] = useState('ALL');

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

  // ── Actions ──
  const doWeigh = async (id: string) => {
    if (!weighVal) { flash('err', 'Enter weight'); return; }
    setSaving(true);
    try {
      const w = parseFloat(weighVal);
      const body = weighType === 'tare'
        ? { weightTare: w, tareTime: new Date().toISOString() }
        : { weightGross: w, grossTime: new Date().toISOString() };
      await api.put(`/shipments/${id}/weighbridge`, body);
      flash('ok', `${weighType === 'tare' ? 'Tare' : 'Gross'} recorded: ${w} kg`);
      setWeighId(null); setWeighVal('');
      loadShipments();
    } catch { flash('err', 'Failed'); }
    setSaving(false);
  };

  const generateEwayBill = async (id: string) => {
    setSaving(true);
    try {
      const r = await api.post(`/shipments/${id}/eway-bill`);
      const ewbNo = r.data.ewayBillNo;
      flash('ok', `E-Way Bill generated: ${ewbNo}`);
      setRelEway(ewbNo); // auto-fill in release form
      loadShipments();
    } catch (e: any) {
      flash('err', e.response?.data?.error || 'E-Way Bill generation failed');
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

  const filtered = filterStatus === 'ALL' ? shipments : shipments.filter(s => s.status === filterStatus);

  // ── Next action for each shipment ──
  const getNextAction = (s: Shipment) => {
    switch (s.status) {
      case 'GATE_IN': return { label: 'Weigh Tare', type: 'weigh-tare' as const };
      case 'TARE_WEIGHED': return { label: 'Start Loading', type: 'loading' as const };
      case 'LOADING': return { label: 'Weigh Gross', type: 'weigh-gross' as const };
      case 'GROSS_WEIGHED': return { label: 'Release', type: 'release' as const };
      case 'RELEASED': return { label: 'Gate Exit', type: 'exit' as const };
      default: return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-700 to-blue-800 text-white">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Scale size={24} /> Gate Register
            </h1>
            <span className="text-sm text-blue-200">
              {new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
            </span>
          </div>

          {/* Stats row */}
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

        {/* ── TABLE VIEW ── */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">
            <Loader2 size={32} className="animate-spin mx-auto mb-2" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <Scale size={48} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 text-sm">No active vehicles</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
            {/* Table header */}
            <div className="hidden md:grid grid-cols-12 gap-2 px-4 py-2 bg-gray-50 border-b text-[10px] font-semibold text-gray-500 uppercase">
              <div className="col-span-2">Vehicle</div>
              <div className="col-span-1">Status</div>
              <div className="col-span-2">Customer / Product</div>
              <div className="col-span-1">Tare</div>
              <div className="col-span-1">Gross</div>
              <div className="col-span-1">Net</div>
              <div className="col-span-1">Time</div>
              <div className="col-span-3">Action</div>
            </div>

            {/* Rows */}
            {filtered.map(s => {
              const cfg = STATUS_CONFIG[s.status];
              const net = s.weightNet || (s.weightGross && s.weightTare ? s.weightGross - s.weightTare : null);
              const nextAction = getNextAction(s);
              const stepIdx = STATUS_FLOW.indexOf(s.status);

              return (
                <div key={s.id} className="border-b last:border-b-0 hover:bg-gray-50/50 transition">
                  {/* ── Desktop row ── */}
                  <div className="hidden md:grid grid-cols-12 gap-2 px-4 py-3 items-center">
                    {/* Vehicle */}
                    <div className="col-span-2">
                      <div className="font-bold text-sm text-gray-900">{s.vehicleNo}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {s.driverName && <span className="text-[10px] text-gray-500">{s.driverName}</span>}
                        {s.driverMobile && (
                          <a href={`tel:${s.driverMobile}`} className="text-blue-600"><Phone size={9} /></a>
                        )}
                        {s.transporterName && <span className="text-[10px] text-gray-400">({s.transporterName})</span>}
                      </div>
                    </div>

                    {/* Status */}
                    <div className="col-span-1">
                      <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${cfg.badge}`}>
                        {cfg.label}
                      </span>
                      {/* Mini progress */}
                      <div className="flex gap-0.5 mt-1.5">
                        {STATUS_FLOW.map((st, i) => (
                          <div key={st} className={`h-1 flex-1 rounded-full ${
                            i <= stepIdx ? 'bg-green-500' : 'bg-gray-200'
                          } ${i === stepIdx && stepIdx < 5 ? 'animate-pulse' : ''}`} />
                        ))}
                      </div>
                    </div>

                    {/* Customer / Product */}
                    <div className="col-span-2">
                      <div className="text-xs font-medium text-gray-800 truncate">{s.customerName || '—'}</div>
                      <div className="text-[10px] text-gray-500 flex items-center gap-1">
                        <Package size={9} /> {s.productName}
                        {s.destination && <span className="ml-1 truncate">→ {s.destination}</span>}
                      </div>
                    </div>

                    {/* Tare */}
                    <div className="col-span-1">
                      {s.weightTare ? (
                        <span className="text-xs font-medium text-gray-700">{s.weightTare.toLocaleString()} kg</span>
                      ) : (
                        <span className="text-[10px] text-gray-400">—</span>
                      )}
                    </div>

                    {/* Gross */}
                    <div className="col-span-1">
                      {s.weightGross ? (
                        <span className="text-xs font-medium text-gray-700">{s.weightGross.toLocaleString()} kg</span>
                      ) : (
                        <span className="text-[10px] text-gray-400">—</span>
                      )}
                    </div>

                    {/* Net */}
                    <div className="col-span-1">
                      {net ? (
                        <div>
                          <span className="text-sm font-bold text-green-700">{(net / 1000).toFixed(2)}</span>
                          <span className="text-[10px] text-gray-500 ml-0.5">MT</span>
                        </div>
                      ) : (
                        <span className="text-[10px] text-gray-400">—</span>
                      )}
                    </div>

                    {/* Time / Docs */}
                    <div className="col-span-1 text-[10px] text-gray-500">
                      {s.ewayBill ? (
                        <div className="text-indigo-600 font-medium" title="E-Way Bill">EWB: {s.ewayBill}</div>
                      ) : s.gateInTime ? (
                        <div>In: {typeof s.gateInTime === 'string' && s.gateInTime.includes('T')
                          ? new Date(s.gateInTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                          : s.gateInTime
                        }</div>
                      ) : null}
                    </div>

                    {/* Action */}
                    <div className="col-span-3 flex items-center gap-1.5">
                      {/* Inline weigh form */}
                      {weighId === s.id ? (
                        <div className="flex gap-1 items-center flex-1">
                          <input type="number" value={weighVal} onChange={e => setWeighVal(e.target.value)}
                            placeholder={`${weighType === 'tare' ? 'Tare' : 'Gross'} weight (kg)`}
                            className="input-field text-xs w-28" autoFocus
                            onKeyDown={e => e.key === 'Enter' && doWeigh(s.id)} />
                          <button onClick={() => doWeigh(s.id)} disabled={saving}
                            className="px-2 py-1.5 bg-blue-600 text-white text-[10px] rounded font-medium hover:bg-blue-700 disabled:opacity-50">
                            {saving ? <Loader2 size={10} className="animate-spin" /> : 'Save'}
                          </button>
                          <button onClick={() => setWeighId(null)} className="text-gray-400"><X size={12} /></button>
                        </div>
                      ) : releaseId === s.id ? (
                        <div className="flex gap-1 items-center flex-1 flex-wrap">
                          <input value={relChallan} onChange={e => setRelChallan(e.target.value)}
                            placeholder="Challan" className="input-field text-xs w-20" autoFocus />
                          <div className="flex gap-0.5 items-center">
                            <input value={relEway} onChange={e => setRelEway(e.target.value)}
                              placeholder="E-Way Bill" className="input-field text-xs w-24" />
                            <button onClick={() => generateEwayBill(s.id)} disabled={saving || !s.weightNet}
                              className="px-1.5 py-1.5 bg-indigo-600 text-white text-[9px] rounded font-medium hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
                              title={!s.weightNet ? 'Complete weighbridge first' : 'Auto-generate e-way bill'}>
                              {saving ? <Loader2 size={10} className="animate-spin" /> : '⚡ Auto'}
                            </button>
                          </div>
                          <input value={relGatePass} onChange={e => setRelGatePass(e.target.value)}
                            placeholder="Gate Pass" className="input-field text-xs w-20" />
                          <button onClick={() => doStatus(s.id, 'RELEASED', {
                            challanNo: relChallan, ewayBill: relEway, gatePassNo: relGatePass, releaseTime: new Date().toISOString()
                          })} disabled={saving}
                            className="px-2 py-1.5 bg-orange-600 text-white text-[10px] rounded font-medium hover:bg-orange-700 disabled:opacity-50">
                            {saving ? <Loader2 size={10} className="animate-spin" /> : 'Release'}
                          </button>
                          <button onClick={() => setReleaseId(null)} className="text-gray-400"><X size={12} /></button>
                        </div>
                      ) : nextAction ? (
                        <>
                          {nextAction.type === 'weigh-tare' && (
                            <button onClick={() => { setWeighId(s.id); setWeighType('tare'); setWeighVal(''); }}
                              className="px-3 py-1.5 bg-gray-600 text-white text-xs rounded font-medium hover:bg-gray-700 flex items-center gap-1">
                              <Scale size={12} /> Weigh Tare
                            </button>
                          )}
                          {nextAction.type === 'loading' && (
                            <button onClick={() => doStatus(s.id, 'LOADING', { loadStartTime: new Date().toISOString() })}
                              disabled={saving}
                              className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded font-medium hover:bg-blue-700 flex items-center gap-1">
                              {saving ? <Loader2 size={12} className="animate-spin" /> : <>▶ Start Loading</>}
                            </button>
                          )}
                          {nextAction.type === 'weigh-gross' && (
                            <button onClick={() => { setWeighId(s.id); setWeighType('gross'); setWeighVal(''); }}
                              className="px-3 py-1.5 bg-amber-600 text-white text-xs rounded font-medium hover:bg-amber-700 flex items-center gap-1">
                              <Scale size={12} /> Weigh Gross
                            </button>
                          )}
                          {nextAction.type === 'release' && (
                            <button onClick={() => setReleaseId(s.id)}
                              className="px-3 py-1.5 bg-orange-600 text-white text-xs rounded font-medium hover:bg-orange-700 flex items-center gap-1">
                              🔓 Release
                            </button>
                          )}
                          {nextAction.type === 'exit' && (
                            <button onClick={() => doStatus(s.id, 'EXITED', { exitTime: new Date().toISOString() })}
                              disabled={saving}
                              className="px-3 py-1.5 bg-green-600 text-white text-xs rounded font-medium hover:bg-green-700 flex items-center gap-1">
                              {saving ? <Loader2 size={12} className="animate-spin" /> : <>🚗 Gate Exit</>}
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="text-[10px] text-emerald-600 font-medium">✓ Complete</span>
                      )}

                      {/* Quick share */}
                      <button onClick={() => shareStatus(s)}
                        className="p-1.5 text-green-600 hover:bg-green-50 rounded" title="Share">
                        <Share2 size={12} />
                      </button>
                      {s.driverMobile && (
                        <a href={`https://api.whatsapp.com/send?phone=91${s.driverMobile.replace(/\D/g, '').slice(-10)}`}
                          target="_blank" rel="noopener"
                          className="p-1.5 text-green-600 hover:bg-green-50 rounded" title="WhatsApp Driver">
                          <MessageCircle size={12} />
                        </a>
                      )}
                    </div>
                  </div>

                  {/* ── Mobile card ── */}
                  <div className="md:hidden p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="font-bold text-lg text-gray-900">{s.vehicleNo}</span>
                        <span className={`ml-2 text-[10px] font-semibold px-2 py-0.5 rounded-full ${cfg.badge}`}>{cfg.label}</span>
                      </div>
                      {net && <span className="text-lg font-bold text-green-700">{(net / 1000).toFixed(2)} MT</span>}
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs text-gray-600 mb-2">
                      <div><span className="text-gray-400">Customer</span><br/><span className="font-medium">{s.customerName || '—'}</span></div>
                      <div><span className="text-gray-400">Product</span><br/><span className="font-medium">{s.productName}</span></div>
                      <div><span className="text-gray-400">Driver</span><br/><span className="font-medium">{s.driverName || '—'}</span></div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                      <div><span className="text-gray-400">Tare</span><br/><span className="font-medium">{s.weightTare ? `${s.weightTare.toLocaleString()} kg` : '—'}</span></div>
                      <div><span className="text-gray-400">Gross</span><br/><span className="font-medium">{s.weightGross ? `${s.weightGross.toLocaleString()} kg` : '—'}</span></div>
                      <div><span className="text-gray-400">Destination</span><br/><span className="font-medium truncate">{s.destination || '—'}</span></div>
                    </div>

                    {/* Progress */}
                    <div className="flex gap-0.5 mb-2">
                      {STATUS_FLOW.map((st, i) => (
                        <div key={st} className={`h-1.5 flex-1 rounded-full ${
                          i <= stepIdx ? 'bg-green-500' : 'bg-gray-200'
                        } ${i === stepIdx && stepIdx < 5 ? 'animate-pulse' : ''}`} />
                      ))}
                    </div>

                    {/* Mobile action */}
                    {weighId === s.id ? (
                      <div className="flex gap-1.5 items-center">
                        <input type="number" value={weighVal} onChange={e => setWeighVal(e.target.value)}
                          placeholder={`${weighType === 'tare' ? 'Tare' : 'Gross'} (kg)`}
                          className="input-field text-sm flex-1" autoFocus
                          onKeyDown={e => e.key === 'Enter' && doWeigh(s.id)} />
                        <button onClick={() => doWeigh(s.id)} disabled={saving}
                          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg font-medium">
                          {saving ? <Loader2 size={14} className="animate-spin" /> : 'Save'}
                        </button>
                        <button onClick={() => setWeighId(null)} className="text-gray-400 p-2"><X size={16} /></button>
                      </div>
                    ) : releaseId === s.id ? (
                      <div className="space-y-1.5">
                        <div className="grid grid-cols-3 gap-1.5">
                          <input value={relChallan} onChange={e => setRelChallan(e.target.value)} placeholder="Challan" className="input-field text-xs" />
                          <div className="flex gap-0.5">
                            <input value={relEway} onChange={e => setRelEway(e.target.value)} placeholder="E-Way" className="input-field text-xs flex-1" />
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
                    ) : nextAction ? (
                      <div className="flex gap-2">
                        {nextAction.type === 'weigh-tare' && (
                          <button onClick={() => { setWeighId(s.id); setWeighType('tare'); setWeighVal(''); }}
                            className="flex-1 py-2.5 bg-gray-600 text-white rounded-lg font-medium text-sm">⚖️ Weigh Tare</button>
                        )}
                        {nextAction.type === 'loading' && (
                          <button onClick={() => doStatus(s.id, 'LOADING', { loadStartTime: new Date().toISOString() })}
                            className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg font-medium text-sm">▶ Start Loading</button>
                        )}
                        {nextAction.type === 'weigh-gross' && (
                          <button onClick={() => { setWeighId(s.id); setWeighType('gross'); setWeighVal(''); }}
                            className="flex-1 py-2.5 bg-amber-600 text-white rounded-lg font-medium text-sm">⚖️ Weigh Gross</button>
                        )}
                        {nextAction.type === 'release' && (
                          <button onClick={() => setReleaseId(s.id)}
                            className="flex-1 py-2.5 bg-orange-600 text-white rounded-lg font-medium text-sm">🔓 Release</button>
                        )}
                        {nextAction.type === 'exit' && (
                          <button onClick={() => doStatus(s.id, 'EXITED', { exitTime: new Date().toISOString() })}
                            className="flex-1 py-2.5 bg-green-600 text-white rounded-lg font-medium text-sm">🚗 Gate Exit</button>
                        )}
                        <button onClick={() => shareStatus(s)}
                          className="px-3 py-2.5 bg-green-100 text-green-700 rounded-lg"><Share2 size={14} /></button>
                      </div>
                    ) : (
                      <div className="text-center text-emerald-600 text-sm font-medium py-2">✓ Complete</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
