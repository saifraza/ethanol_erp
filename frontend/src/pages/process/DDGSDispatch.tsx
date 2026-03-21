import { useState, useEffect, useRef } from 'react';
import {
  Truck, Plus, X, Share2, Save, Loader2, Trash2, AlertTriangle,
  Scale, ChevronDown, Phone, MapPin, FileText, CheckCircle, Clock, MessageCircle
} from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

interface DDGSTruck {
  id: string; date: string; status: string;
  vehicleNo: string; partyName: string; partyAddress: string | null; partyGstin: string | null;
  destination: string; driverName: string | null; driverMobile: string | null; transporterName: string | null;
  bags: number; weightPerBag: number; weightGross: number; weightTare: number; weightNet: number;
  rate: number | null; invoiceNo: string | null; invoiceAmount: number | null;
  gatePassNo: string | null; ewayBillNo: string | null; hsnCode: string;
  gateInTime: string | null; tareTime: string | null; grossTime: string | null; releaseTime: string | null;
  remarks: string | null; createdAt: string;
}

const STATUS_FLOW = ['GATE_IN', 'TARE_WEIGHED', 'LOADING', 'GROSS_WEIGHED', 'BILLED', 'RELEASED'] as const;
const STATUS_CFG: Record<string, { label: string; badge: string }> = {
  GATE_IN:        { label: 'Gate In',  badge: 'bg-slate-100 text-slate-700' },
  TARE_WEIGHED:   { label: 'Tared',    badge: 'bg-blue-50 text-blue-700' },
  LOADING:        { label: 'Loading',  badge: 'bg-amber-50 text-amber-700' },
  GROSS_WEIGHED:  { label: 'Weighed',  badge: 'bg-orange-50 text-orange-700' },
  BILLED:         { label: 'Billed',   badge: 'bg-purple-50 text-purple-700' },
  RELEASED:       { label: 'Released', badge: 'bg-green-50 text-green-700' },
};

export default function DDGSDispatch() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [date, setDate] = useState(() => {
    const now = new Date();
    if (now.getHours() < 9) now.setDate(now.getDate() - 1);
    return now.toISOString().split('T')[0];
  });

  const [trucks, setTrucks] = useState<DDGSTruck[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Weighing state
  const [weighing, setWeighing] = useState<{ id: string; type: 'tare' | 'gross' } | null>(null);
  const [weighVal, setWeighVal] = useState('');
  const weighRef = useRef<HTMLInputElement>(null);

  // Bill form state
  const [billTruck, setBillTruck] = useState<DDGSTruck | null>(null);
  const [billRate, setBillRate] = useState('');
  const [billSaving, setBillSaving] = useState(false);

  // Gate In form fields
  const [vehicleNo, setVehicleNo] = useState('');
  const [partyName, setPartyName] = useState('');
  const [partyAddress, setPartyAddress] = useState('');
  const [partyGstin, setPartyGstin] = useState('');
  const [destination, setDestination] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverMobile, setDriverMobile] = useState('');
  const [transporterName, setTransporterName] = useState('');
  const [bags, setBags] = useState('');
  const [weightPerBag, setWeightPerBag] = useState('50');
  const [remarks, setRemarks] = useState('');

  const loadTrucks = () => {
    setLoading(true);
    api.get(`/ddgs-dispatch?date=${date}`)
      .then(r => setTrucks(r.data.trucks || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => { loadTrucks(); }, [date]);
  useEffect(() => { if (msg) { const t = setTimeout(() => setMsg(null), 3000); return () => clearTimeout(t); } }, [msg]);
  useEffect(() => { if (weighing && weighRef.current) weighRef.current.focus(); }, [weighing]);

  const totalDispatched = trucks.reduce((s, t) => s + t.weightNet, 0);
  const totalBags = trucks.reduce((s, t) => s + t.bags, 0);
  const activeTrucks = trucks.filter(t => t.status !== 'RELEASED');
  const releasedTrucks = trucks.filter(t => t.status === 'RELEASED');

  const resetForm = () => {
    setVehicleNo(''); setPartyName(''); setPartyAddress(''); setPartyGstin('');
    setDestination(''); setDriverName(''); setDriverMobile(''); setTransporterName('');
    setBags(''); setWeightPerBag('50'); setRemarks(''); setShowForm(false);
  };

  // ── Gate In ──
  async function gateIn() {
    if (!vehicleNo.trim()) { setMsg({ type: 'err', text: 'Vehicle No required' }); return; }
    setSaving(true); setMsg(null);
    try {
      await api.post('/ddgs-dispatch', {
        date: date + 'T00:00:00.000Z',
        vehicleNo: vehicleNo.toUpperCase(), partyName, partyAddress, partyGstin,
        destination, driverName, driverMobile, transporterName,
        bags: parseInt(bags) || 0, weightPerBag: parseFloat(weightPerBag) || 50,
        remarks,
      });
      setMsg({ type: 'ok', text: 'Truck registered!' });
      resetForm(); loadTrucks();
    } catch { setMsg({ type: 'err', text: 'Save failed' }); }
    setSaving(false);
  }

  // ── Weigh ──
  async function doWeigh(id: string, type: 'tare' | 'gross') {
    const w = parseFloat(weighVal);
    if (!w) { setMsg({ type: 'err', text: 'Enter weight' }); return; }
    setSaving(true);
    try {
      await api.post(`/ddgs-dispatch/${id}/weigh`, { type, weight: w });
      setMsg({ type: 'ok', text: `${type === 'tare' ? 'Tare' : 'Gross'} weight saved` });
      setWeighing(null); setWeighVal(''); loadTrucks();
    } catch { setMsg({ type: 'err', text: 'Weigh failed' }); }
    setSaving(false);
  }

  // ── Update status ──
  async function updateStatus(id: string, status: string) {
    try {
      await api.put(`/ddgs-dispatch/${id}`, { status });
      loadTrucks();
    } catch { setMsg({ type: 'err', text: 'Update failed' }); }
  }

  // ── Update bags ──
  async function updateBags(id: string, newBags: number) {
    try {
      await api.put(`/ddgs-dispatch/${id}`, { bags: newBags });
      loadTrucks();
    } catch {}
  }

  // ── Generate Bill ──
  async function generateBill() {
    if (!billTruck || !billRate) return;
    setBillSaving(true);
    try {
      await api.post(`/ddgs-dispatch/${billTruck.id}/generate-bill`, { rate: parseFloat(billRate) });
      setMsg({ type: 'ok', text: 'Bill generated!' });
      setBillTruck(null); setBillRate(''); loadTrucks();
    } catch { setMsg({ type: 'err', text: 'Bill generation failed' }); }
    setBillSaving(false);
  }

  // ── Release ──
  async function releaseTruck(id: string) {
    try {
      await api.post(`/ddgs-dispatch/${id}/release`);
      setMsg({ type: 'ok', text: 'Truck released!' });
      loadTrucks();
    } catch { setMsg({ type: 'err', text: 'Release failed' }); }
  }

  // ── Delete ──
  async function deleteTruck(id: string) {
    if (!confirm('Delete this truck?')) return;
    try {
      await api.delete(`/ddgs-dispatch/${id}`);
      loadTrucks();
    } catch { setMsg({ type: 'err', text: 'Delete failed' }); }
  }

  // ── Share ──
  const shareTruck = (t: DDGSTruck) => {
    const text = `*DDGS Dispatch*\n📅 ${new Date(t.date).toLocaleDateString('en-IN')}\n\nVehicle: ${t.vehicleNo}\nParty: ${t.partyName}\nDestination: ${t.destination}\nBags: ${t.bags} × ${t.weightPerBag}kg\nGross: ${t.weightGross}T | Tare: ${t.weightTare}T\nNet: ${t.weightNet.toFixed(2)}T${t.invoiceNo ? '\nInvoice: ' + t.invoiceNo : ''}${t.ewayBillNo ? '\nE-Way: ' + t.ewayBillNo : ''}${t.remarks ? '\nRemarks: ' + t.remarks : ''}`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
  };

  const shareAll = () => {
    const lines = [`*DDGS Dispatch — ${date}*`, `Trucks: ${trucks.length} | Total: ${totalDispatched.toFixed(2)} T | Bags: ${totalBags}`, ''];
    trucks.forEach((t, i) => {
      lines.push(`${i + 1}. ${t.vehicleNo} → ${t.destination || '-'} | ${t.weightNet.toFixed(2)}T | ${t.bags} bags | ${t.partyName}`);
    });
    const text = lines.join('\n');
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
  };

  const timeSince = (iso: string | null) => {
    if (!iso) return '';
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h${mins % 60}m`;
  };

  const fmtTime = (d: string | null) => d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '';

  // ── Next Action Button ──
  const NextAction = ({ t }: { t: DDGSTruck }) => {
    const s = t.status;
    if (s === 'GATE_IN') return (
      <button onClick={(e) => { e.stopPropagation(); setWeighing({ id: t.id, type: 'tare' }); setWeighVal(''); setExpandedId(t.id); }}
        className="px-2 py-0.5 bg-blue-600 text-white rounded text-[10px] font-bold whitespace-nowrap">
        <Scale size={10} className="inline mr-0.5" /> Tare
      </button>
    );
    if (s === 'TARE_WEIGHED') return (
      <button onClick={(e) => { e.stopPropagation(); updateStatus(t.id, 'LOADING'); }}
        className="px-2 py-0.5 bg-amber-500 text-white rounded text-[10px] font-bold whitespace-nowrap">
        Loading
      </button>
    );
    if (s === 'LOADING') return (
      <button onClick={(e) => { e.stopPropagation(); setWeighing({ id: t.id, type: 'gross' }); setWeighVal(''); setExpandedId(t.id); }}
        className="px-2 py-0.5 bg-orange-600 text-white rounded text-[10px] font-bold whitespace-nowrap">
        <Scale size={10} className="inline mr-0.5" /> Gross
      </button>
    );
    if (s === 'GROSS_WEIGHED') return (
      <button onClick={(e) => { e.stopPropagation(); setBillTruck(t); setBillRate(t.rate?.toString() || ''); }}
        className="px-2 py-0.5 bg-purple-600 text-white rounded text-[10px] font-bold whitespace-nowrap">
        <FileText size={10} className="inline mr-0.5" /> Bill
      </button>
    );
    if (s === 'BILLED') return (
      <button onClick={(e) => { e.stopPropagation(); releaseTruck(t.id); }}
        className="px-2 py-0.5 bg-green-600 text-white rounded text-[10px] font-bold whitespace-nowrap">
        Release
      </button>
    );
    if (s === 'RELEASED') return (
      <span className="text-[10px] text-green-600 font-bold flex items-center gap-0.5"><CheckCircle size={10} /> Done</span>
    );
    return null;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-red-700 text-white px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Truck size={20} />
            <div>
              <h1 className="text-base font-bold leading-tight">DDGS Dispatch</h1>
              <p className="text-[10px] text-red-200">Gate Register + Billing</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="bg-red-800 border border-red-600 rounded px-2 py-1 text-xs text-white" />
            {trucks.length > 0 && (
              <button onClick={shareAll} className="p-1.5 bg-green-600 rounded-lg">
                <Share2 size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-2 mt-3">
          <div className="bg-red-800/60 rounded-lg p-2 text-center">
            <div className="text-[10px] text-red-300">Dispatched</div>
            <div className="text-lg font-bold">{totalDispatched.toFixed(1)} <span className="text-[10px] font-normal text-red-300">MT</span></div>
          </div>
          <div className="bg-red-800/60 rounded-lg p-2 text-center">
            <div className="text-[10px] text-red-300">Trucks</div>
            <div className="text-lg font-bold">{trucks.length}</div>
          </div>
          <div className="bg-red-800/60 rounded-lg p-2 text-center">
            <div className="text-[10px] text-red-300">Bags</div>
            <div className="text-lg font-bold">{totalBags}</div>
          </div>
        </div>
      </div>

      <div className="px-3 py-3">
        {msg && (
          <div className={`rounded-lg p-2.5 mb-3 text-xs font-medium ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {msg.text}
          </div>
        )}

        {/* Gate In Button */}
        {!showForm && (
          <button onClick={() => setShowForm(true)}
            className="w-full border-2 border-dashed border-red-300 rounded-xl py-3 text-red-600 hover:bg-red-50 flex items-center justify-center gap-2 mb-3 font-semibold text-sm">
            <Plus size={18} /> Gate In — New Truck
          </button>
        )}

        {/* ── Gate In Form ── */}
        {showForm && (
          <div className="bg-white rounded-xl border shadow-sm p-3 mb-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <Truck size={16} className="text-red-600" /> Gate In — New Truck
              </h3>
              <button onClick={resetForm} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="text-[10px] text-gray-500 font-medium">Vehicle No *</label>
                <input value={vehicleNo} onChange={e => setVehicleNo(e.target.value.toUpperCase())}
                  className="w-full px-2.5 py-1.5 text-xs border rounded-lg bg-gray-50 focus:ring-2 focus:ring-red-200 outline-none" placeholder="MP 00 XX 0000" autoFocus />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 font-medium">Party Name *</label>
                <input value={partyName} onChange={e => setPartyName(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs border rounded-lg bg-gray-50 focus:ring-2 focus:ring-red-200 outline-none" placeholder="Buyer name" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="text-[10px] text-gray-500 font-medium">Destination</label>
                <input value={destination} onChange={e => setDestination(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs border rounded-lg bg-gray-50 focus:ring-2 focus:ring-red-200 outline-none" placeholder="City" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 font-medium">Party GSTIN</label>
                <input value={partyGstin} onChange={e => setPartyGstin(e.target.value.toUpperCase())}
                  className="w-full px-2.5 py-1.5 text-xs border rounded-lg bg-gray-50 focus:ring-2 focus:ring-red-200 outline-none" placeholder="22XXXXX1234X1ZX" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-2">
              <div>
                <label className="text-[10px] text-gray-500 font-medium">Driver</label>
                <input value={driverName} onChange={e => setDriverName(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs border rounded-lg bg-gray-50 focus:ring-2 focus:ring-red-200 outline-none" placeholder="Name" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 font-medium">Mobile</label>
                <input value={driverMobile} onChange={e => setDriverMobile(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs border rounded-lg bg-gray-50 focus:ring-2 focus:ring-red-200 outline-none" placeholder="98XXXXXXXX" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 font-medium">Transporter</label>
                <input value={transporterName} onChange={e => setTransporterName(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs border rounded-lg bg-gray-50 focus:ring-2 focus:ring-red-200 outline-none" placeholder="Transport Co." />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="text-[10px] text-gray-500 font-medium">Bags (estimated)</label>
                <input type="number" value={bags} onChange={e => setBags(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs border rounded-lg bg-gray-50 focus:ring-2 focus:ring-red-200 outline-none" placeholder="0" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 font-medium">Wt/Bag (kg)</label>
                <input type="number" value={weightPerBag} onChange={e => setWeightPerBag(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs border rounded-lg bg-gray-50 focus:ring-2 focus:ring-red-200 outline-none" />
              </div>
            </div>

            <div className="mb-3">
              <label className="text-[10px] text-gray-500 font-medium">Remarks</label>
              <input value={remarks} onChange={e => setRemarks(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs border rounded-lg bg-gray-50 focus:ring-2 focus:ring-red-200 outline-none" placeholder="Optional" />
            </div>

            <button onClick={gateIn} disabled={saving}
              className="w-full py-2.5 bg-red-600 text-white rounded-lg font-semibold text-sm hover:bg-red-700 flex items-center justify-center gap-2 disabled:opacity-50">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Gate In
            </button>
          </div>
        )}

        {/* ── Active Trucks ── */}
        {activeTrucks.length > 0 && (
          <div className="mb-3">
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 px-1">
              Active — {activeTrucks.length} truck{activeTrucks.length > 1 ? 's' : ''}
            </div>
            <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
              {activeTrucks.map(t => {
                const cfg = STATUS_CFG[t.status] || STATUS_CFG.GATE_IN;
                const stepIdx = STATUS_FLOW.indexOf(t.status as any);
                const isExp = expandedId === t.id;
                const isWeighingThis = weighing?.id === t.id;
                const tareTon = t.weightTare > 0 ? t.weightTare.toFixed(2) : '';
                const grossTon = t.weightGross > 0 ? t.weightGross.toFixed(2) : '';
                const netTon = t.weightNet > 0 ? t.weightNet.toFixed(2) : '';

                return (
                  <div key={t.id} className={`border-b last:border-b-0 ${isExp ? 'bg-slate-50/40' : ''}`}>
                    {/* Main row */}
                    <div className="px-3 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => setExpandedId(isExp ? null : t.id)} className="flex items-center gap-1.5 min-w-0 flex-1 text-left">
                          <Truck size={11} className="text-gray-400 shrink-0" />
                          <span className="font-bold text-[13px] text-gray-900">{t.vehicleNo || '—'}</span>
                          <span className={`text-[8px] font-bold px-1.5 py-px rounded-full ${cfg.badge}`}>{cfg.label}</span>
                          {t.gateInTime && <span className="text-[9px] text-gray-400 flex items-center gap-0.5"><Clock size={8} />{timeSince(t.gateInTime)}</span>}
                          <ChevronDown size={10} className={`text-gray-300 shrink-0 transition-transform ${isExp ? 'rotate-180' : ''}`} />
                        </button>

                        {/* Weight chips */}
                        <div className="flex items-center gap-1 shrink-0">
                          {tareTon && <span className="text-[9px] bg-blue-50 text-blue-600 px-1 py-px rounded font-medium">T:{tareTon}</span>}
                          {grossTon && <span className="text-[9px] bg-amber-50 text-amber-600 px-1 py-px rounded font-medium">G:{grossTon}</span>}
                          {netTon && <span className="text-[9px] bg-green-50 text-green-700 px-1.5 py-px rounded font-bold ring-1 ring-green-200">{netTon}T</span>}
                        </div>

                        {/* Doc indicators */}
                        {t.invoiceNo && <span className="text-[7px] font-bold px-1 py-px rounded bg-purple-100 text-purple-700">Bill</span>}
                        {t.ewayBillNo && <span className="text-[7px] font-bold px-1 py-px rounded bg-indigo-100 text-indigo-700">EWB</span>}

                        <NextAction t={t} />
                      </div>

                      {/* Inline weigh input */}
                      {isWeighingThis && (
                        <div className="flex gap-1.5 items-center mt-1.5 bg-blue-50 rounded-lg p-1.5">
                          <Scale size={12} className="text-blue-500 shrink-0" />
                          <input ref={weighRef} type="number" step="0.01" value={weighVal} onChange={e => setWeighVal(e.target.value)}
                            placeholder={`${weighing.type === 'tare' ? 'Tare' : 'Gross'} weight (MT)`}
                            className="flex-1 px-2 py-1 text-sm border rounded-md bg-white focus:ring-2 focus:ring-blue-300 outline-none"
                            onKeyDown={e => e.key === 'Enter' && doWeigh(t.id, weighing.type)} />
                          <button onClick={() => doWeigh(t.id, weighing.type)} disabled={saving}
                            className="px-3 py-1 bg-blue-600 text-white text-xs rounded-md font-semibold hover:bg-blue-700 disabled:opacity-50">
                            {saving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                          </button>
                          <button onClick={() => setWeighing(null)} className="text-gray-400 hover:text-gray-600 p-0.5"><X size={14} /></button>
                        </div>
                      )}

                      {/* Progress bar */}
                      <div className="flex gap-px mt-1">
                        {STATUS_FLOW.map((st, i) => (
                          <div key={st} className={`h-[2px] flex-1 rounded-full ${
                            i <= stepIdx ? (i === stepIdx && stepIdx < 5 ? 'bg-red-400 animate-pulse' : 'bg-green-400') : 'bg-gray-200'
                          }`} />
                        ))}
                      </div>
                    </div>

                    {/* ── Expanded panel ── */}
                    {isExp && (
                      <div className="border-t border-gray-100 px-3 py-2 bg-gray-50/50 space-y-2">
                        {/* Party + Driver info */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          {t.partyName && <span className="text-gray-700 font-medium">{t.partyName}</span>}
                          {t.partyGstin && <span className="text-[10px] text-gray-400">GST: {t.partyGstin}</span>}
                          {t.driverName && <span className="text-gray-600">🧑 {t.driverName}</span>}
                          {t.driverMobile && (
                            <a href={`tel:${t.driverMobile}`} className="text-blue-600 flex items-center gap-0.5"><Phone size={10} /> {t.driverMobile}</a>
                          )}
                          {t.transporterName && <span className="text-gray-400">🚚 {t.transporterName}</span>}
                          {t.destination && <span className="text-gray-400 flex items-center gap-0.5"><MapPin size={10} /> {t.destination}</span>}
                          <div className="ml-auto flex gap-1">
                            <button onClick={() => shareTruck(t)} className="px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded text-[9px] font-medium flex items-center gap-0.5 hover:bg-gray-300">
                              <Share2 size={9} /> Share
                            </button>
                            {t.driverMobile && (
                              <a href={`https://api.whatsapp.com/send?phone=91${t.driverMobile.replace(/\D/g, '').slice(-10)}`}
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
                            { label: 'Tare', val: tareTon, time: t.tareTime, color: 'blue' },
                            { label: 'Gross', val: grossTon, time: t.grossTime, color: 'amber' },
                            { label: 'Net', val: netTon, time: null, color: netTon ? 'green' : 'gray' },
                          ].map(w => (
                            <div key={w.label} className={`bg-${w.color}-50 rounded-lg p-1.5 text-center`}>
                              <div className={`text-[8px] text-${w.color}-400 font-bold uppercase`}>{w.label}</div>
                              <div className={`text-xs font-bold text-${w.color}-700`}>{w.val ? `${w.val} MT` : '—'}</div>
                              {w.time && <div className={`text-[8px] text-${w.color}-300`}>{fmtTime(w.time)}</div>}
                            </div>
                          ))}
                        </div>

                        {/* Bags info */}
                        {t.bags > 0 && (
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <span>Bags: <b>{t.bags}</b> × {t.weightPerBag}kg = {((t.bags * t.weightPerBag) / 1000).toFixed(3)} MT</span>
                            {t.weightNet > 0 && Math.abs(t.weightNet - (t.bags * t.weightPerBag / 1000)) > 0.05 && (
                              <span className="text-amber-600 flex items-center gap-0.5">
                                <AlertTriangle size={10} /> Diff: {Math.abs(t.weightNet - (t.bags * t.weightPerBag / 1000)).toFixed(3)} MT
                              </span>
                            )}
                          </div>
                        )}

                        {/* Invoice info */}
                        {t.invoiceNo && (
                          <div className="bg-purple-50 rounded-lg p-2 text-xs">
                            <span className="font-bold text-purple-700">Invoice: {t.invoiceNo}</span>
                            <span className="text-gray-500 ml-2">Rate: ₹{t.rate?.toLocaleString('en-IN')}/MT</span>
                            <span className="text-gray-700 font-bold ml-2">Amount: ₹{t.invoiceAmount?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                          </div>
                        )}

                        {/* Action buttons */}
                        <div className="flex flex-wrap gap-1.5">
                          {/* Weigh buttons (when not in weighing mode) */}
                          {!isWeighingThis && t.status === 'GATE_IN' && (
                            <button onClick={() => { setWeighing({ id: t.id, type: 'tare' }); setWeighVal(''); }}
                              className="px-2 py-1 text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 rounded-lg flex items-center gap-1 hover:bg-blue-100">
                              <Scale size={11} /> Record Tare
                            </button>
                          )}
                          {!isWeighingThis && (t.status === 'LOADING' || t.status === 'TARE_WEIGHED') && (
                            <button onClick={() => { setWeighing({ id: t.id, type: 'gross' }); setWeighVal(''); }}
                              className="px-2 py-1 text-[10px] font-semibold bg-orange-50 text-orange-700 border border-orange-200 rounded-lg flex items-center gap-1 hover:bg-orange-100">
                              <Scale size={11} /> Record Gross
                            </button>
                          )}
                          {/* Bill */}
                          {t.status === 'GROSS_WEIGHED' && !t.invoiceNo && (
                            <button onClick={() => { setBillTruck(t); setBillRate(t.rate?.toString() || ''); }}
                              className="px-2 py-1 text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200 rounded-lg flex items-center gap-1 hover:bg-purple-100">
                              <FileText size={11} /> Generate Bill
                            </button>
                          )}
                          {/* PDFs */}
                          {t.invoiceNo && (
                            <button onClick={() => { const token = localStorage.getItem('token'); window.open(`/api/ddgs-dispatch/${t.id}/invoice-pdf?token=${token}`, '_blank'); }}
                              className="px-2 py-1 text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200 rounded-lg flex items-center gap-1 hover:bg-purple-100">
                              <FileText size={11} /> Invoice PDF
                            </button>
                          )}
                          {t.weightNet > 0 && (
                            <button onClick={() => { const token = localStorage.getItem('token'); window.open(`/api/ddgs-dispatch/${t.id}/gate-pass-pdf?token=${token}`, '_blank'); }}
                              className="px-2 py-1 text-[10px] font-semibold bg-teal-50 text-teal-700 border border-teal-200 rounded-lg flex items-center gap-1 hover:bg-teal-100">
                              <FileText size={11} /> Gate Pass PDF
                            </button>
                          )}
                          {/* Release */}
                          {(t.status === 'BILLED' || (t.status === 'GROSS_WEIGHED' && t.invoiceNo)) && (
                            <button onClick={() => releaseTruck(t.id)}
                              className="px-2 py-1 text-[10px] font-semibold bg-green-50 text-green-700 border border-green-200 rounded-lg flex items-center gap-1 hover:bg-green-100">
                              <CheckCircle size={11} /> Release Truck
                            </button>
                          )}
                          {/* Delete */}
                          {isAdmin && (
                            <button onClick={() => deleteTruck(t.id)}
                              className="px-2 py-1 text-[10px] font-semibold bg-red-50 text-red-600 border border-red-200 rounded-lg flex items-center gap-1 hover:bg-red-100 ml-auto">
                              <Trash2 size={11} /> Delete
                            </button>
                          )}
                        </div>

                        {/* Timestamps */}
                        <div className="flex gap-3 text-[9px] text-gray-400">
                          {t.gateInTime && <span>Gate In: {fmtTime(t.gateInTime)}</span>}
                          {t.tareTime && <span>Tare: {fmtTime(t.tareTime)}</span>}
                          {t.grossTime && <span>Gross: {fmtTime(t.grossTime)}</span>}
                          {t.releaseTime && <span>Release: {fmtTime(t.releaseTime)}</span>}
                        </div>

                        {t.remarks && <div className="text-[10px] text-gray-400 italic">{t.remarks}</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Released Trucks ── */}
        {releasedTrucks.length > 0 && (
          <div className="mb-3">
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 px-1">
              Released — {releasedTrucks.length} truck{releasedTrucks.length > 1 ? 's' : ''} | {releasedTrucks.reduce((s, t) => s + t.weightNet, 0).toFixed(2)} MT
            </div>
            <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
              {releasedTrucks.map(t => {
                const isExp = expandedId === t.id;
                return (
                  <div key={t.id} className={`border-b last:border-b-0 ${isExp ? 'bg-green-50/30' : ''}`}>
                    <div className="px-3 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => setExpandedId(isExp ? null : t.id)} className="flex items-center gap-1.5 min-w-0 flex-1 text-left">
                          <CheckCircle size={11} className="text-green-500 shrink-0" />
                          <span className="font-bold text-[13px] text-gray-700">{t.vehicleNo}</span>
                          <span className="text-[10px] text-gray-400">→ {t.partyName || t.destination}</span>
                          <ChevronDown size={10} className={`text-gray-300 shrink-0 transition-transform ${isExp ? 'rotate-180' : ''}`} />
                        </button>
                        <span className="text-[11px] font-bold text-green-700">{t.weightNet.toFixed(2)} MT</span>
                        {t.invoiceNo && <span className="text-[7px] font-bold px-1 py-px rounded bg-purple-100 text-purple-700">Bill</span>}
                        {t.ewayBillNo && <span className="text-[7px] font-bold px-1 py-px rounded bg-indigo-100 text-indigo-700">EWB</span>}
                      </div>
                    </div>
                    {isExp && (
                      <div className="border-t border-gray-100 px-3 py-2 bg-gray-50/50 space-y-1.5">
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                          <span>Bags: {t.bags} × {t.weightPerBag}kg</span>
                          <span>G:{t.weightGross} T:{t.weightTare} N:{t.weightNet.toFixed(2)}</span>
                          {t.invoiceNo && <span className="text-purple-700">Invoice: {t.invoiceNo} (₹{t.invoiceAmount?.toLocaleString('en-IN')})</span>}
                          {t.ewayBillNo && <span className="text-indigo-700">EWB: {t.ewayBillNo}</span>}
                        </div>
                        <div className="flex gap-1.5">
                          {t.invoiceNo && (
                            <button onClick={() => { const token = localStorage.getItem('token'); window.open(`/api/ddgs-dispatch/${t.id}/invoice-pdf?token=${token}`, '_blank'); }}
                              className="px-2 py-1 text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200 rounded-lg flex items-center gap-1 hover:bg-purple-100">
                              <FileText size={11} /> Invoice PDF
                            </button>
                          )}
                          <button onClick={() => { const token = localStorage.getItem('token'); window.open(`/api/ddgs-dispatch/${t.id}/gate-pass-pdf?token=${token}`, '_blank'); }}
                            className="px-2 py-1 text-[10px] font-semibold bg-teal-50 text-teal-700 border border-teal-200 rounded-lg flex items-center gap-1 hover:bg-teal-100">
                            <FileText size={11} /> Gate Pass PDF
                          </button>
                          <button onClick={() => shareTruck(t)} className="px-2 py-1 text-[10px] font-semibold bg-gray-100 text-gray-600 rounded-lg flex items-center gap-1 hover:bg-gray-200 ml-auto">
                            <Share2 size={9} /> Share
                          </button>
                        </div>
                        <div className="flex gap-3 text-[9px] text-gray-400">
                          {t.gateInTime && <span>In: {fmtTime(t.gateInTime)}</span>}
                          {t.tareTime && <span>Tare: {fmtTime(t.tareTime)}</span>}
                          {t.grossTime && <span>Gross: {fmtTime(t.grossTime)}</span>}
                          {t.releaseTime && <span>Out: {fmtTime(t.releaseTime)}</span>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {trucks.length === 0 && !showForm && !loading && (
          <p className="text-center text-sm text-gray-400 py-8">No dispatch trucks for {date}</p>
        )}
        {loading && <p className="text-center text-sm text-gray-400 py-8"><Loader2 size={16} className="animate-spin inline mr-1" /> Loading...</p>}
      </div>

      {/* ── Bill Modal ── */}
      {billTruck && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setBillTruck(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-800">Generate Bill</h3>
              <button onClick={() => setBillTruck(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>

            <div className="space-y-2 mb-3 text-xs">
              <div className="bg-gray-50 rounded-lg p-2.5">
                <div className="text-gray-500">Vehicle: <span className="font-bold text-gray-800">{billTruck.vehicleNo}</span></div>
                <div className="text-gray-500">Party: <span className="font-bold text-gray-800">{billTruck.partyName}</span></div>
                <div className="text-gray-500">Net Weight: <span className="font-bold text-gray-800">{billTruck.weightNet.toFixed(3)} MT</span></div>
                <div className="text-gray-500">Bags: <span className="font-bold text-gray-800">{billTruck.bags} × {billTruck.weightPerBag}kg</span></div>
              </div>

              <div>
                <label className="text-[10px] text-gray-500 font-medium">Rate (₹ per MT) *</label>
                <input type="number" value={billRate} onChange={e => setBillRate(e.target.value)}
                  className="w-full px-2.5 py-2 text-sm border rounded-lg bg-gray-50 focus:ring-2 focus:ring-purple-200 outline-none font-bold"
                  placeholder="Enter rate per MT" autoFocus />
              </div>

              {billRate && (
                <div className="bg-purple-50 rounded-lg p-2.5 text-center">
                  <div className="text-[10px] text-purple-400">Total Amount</div>
                  <div className="text-xl font-bold text-purple-700">
                    ₹{(billTruck.weightNet * (parseFloat(billRate) || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                  <div className="text-[10px] text-gray-400">{billTruck.weightNet.toFixed(3)} MT × ₹{parseFloat(billRate) || 0}/MT</div>
                </div>
              )}
            </div>

            <button onClick={generateBill} disabled={billSaving || !billRate}
              className="w-full py-2.5 bg-purple-600 text-white rounded-lg font-semibold text-sm hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-2">
              {billSaving ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} Generate Bill
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
