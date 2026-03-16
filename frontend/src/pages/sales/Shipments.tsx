import { useState, useEffect } from 'react';
import { Truck, Plus, X, Share2, Save, Loader2, MessageCircle, Phone } from 'lucide-react';
import api from '../../services/api';

interface Shipment {
  id: string;
  vehicleNo: string;
  status: 'GATE_IN' | 'TARE_WEIGHED' | 'LOADING' | 'GROSS_WEIGHED' | 'RELEASED' | 'EXITED';
  customerName: string;
  productName: string;
  destination: string;
  driverName: string;
  driverMobile: string;
  transporterName: string;
  capacityTon: number;
  vehicleType: string;
  gateInTime: string;
  weightTare?: number;
  weightGross?: number;
  dispatchRequestId?: string;
  challanNo?: string;
  ewayBill?: string;
  gatePassNo?: string;
}

interface DispatchRequest {
  id: string;
  vehicleNo?: string;
  customerName: string;
}

const PRODUCTS = ['DDGS', 'ETHANOL', 'LFO', 'HFO', 'RS'];
const VEHICLE_TYPES = ['TANKER', 'TRUCK', 'TRAILER', 'WAGON'];

export default function Shipments() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [dispatchRequests, setDispatchRequests] = useState<DispatchRequest[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [weighFormOpen, setWeighFormOpen] = useState<string | null>(null);
  const [releaseFormOpen, setReleaseFormOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // New vehicle entry form
  const [vehicleNo, setVehicleNo] = useState('');
  const [product, setProduct] = useState('DDGS');
  const [customerName, setCustomerName] = useState('');
  const [destination, setDestination] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverMobile, setDriverMobile] = useState('');
  const [transporter, setTransporter] = useState('');
  const [capacityTon, setCapacityTon] = useState('');
  const [vehicleType, setVehicleType] = useState('TANKER');
  const [dispatchRequestId, setDispatchRequestId] = useState('');
  const [gateInTime, setGateInTime] = useState(() => {
    const now = new Date();
    return now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  });

  // Weigh form
  const [weighWeight, setWeighWeight] = useState('');
  const [weighType, setWeighType] = useState<'tare' | 'gross'>('tare');

  // Release form
  const [releaseChallanNo, setReleaseChallanNo] = useState('');
  const [releaseEwayBill, setReleaseEwayBill] = useState('');
  const [releaseGatePassNo, setReleaseGatePassNo] = useState('');

  // Load shipments and compute stats
  const loadShipments = () => {
    api.get('/shipments/active')
      .then(r => {
        setShipments(r.data.shipments || []);
      })
      .catch(() => setMsg({ type: 'err', text: 'Failed to load shipments' }));
  };

  // Load dispatch requests for dropdown
  const loadDispatchRequests = () => {
    api.get('/dispatch-requests/factory')
      .then(r => setDispatchRequests(Array.isArray(r.data) ? r.data : []))
      .catch(() => {});
  };

  useEffect(() => {
    loadShipments();
    loadDispatchRequests();
  }, []);

  const resetForm = () => {
    setVehicleNo('');
    setProduct('DDGS');
    setCustomerName('');
    setDestination('');
    setDriverName('');
    setDriverMobile('');
    setTransporter('');
    setCapacityTon('');
    setVehicleType('TANKER');
    setDispatchRequestId('');
    setShowForm(false);
    const now = new Date();
    setGateInTime(now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }));
  };

  async function saveNewVehicle() {
    if (!vehicleNo.trim()) {
      setMsg({ type: 'err', text: 'Vehicle No required' });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      await api.post('/shipments', {
        vehicleNo,
        productName: product,
        customerName,
        destination,
        driverName,
        driverMobile,
        transporterName: transporter,
        capacityTon: parseFloat(capacityTon) || 0,
        vehicleType,
        gateInTime,
        dispatchRequestId: dispatchRequestId || null,
      });
      setMsg({ type: 'ok', text: 'Vehicle entry recorded!' });
      resetForm();
      loadShipments();
    } catch {
      setMsg({ type: 'err', text: 'Save failed' });
    }
    setSaving(false);
  }

  async function recordWeigh(shipmentId: string) {
    if (!weighWeight.trim()) {
      setMsg({ type: 'err', text: 'Weight required' });
      return;
    }
    setSaving(true);
    try {
      const weight = parseFloat(weighWeight);
      const body = weighType === 'tare'
        ? { weightTare: weight, tareTime: new Date().toISOString() }
        : { weightGross: weight, grossTime: new Date().toISOString() };
      await api.put(`/shipments/${shipmentId}/weighbridge`, body);
      setMsg({ type: 'ok', text: `${weighType.toUpperCase()} recorded!` });
      setWeighWeight('');
      setWeighFormOpen(null);
      loadShipments();
    } catch {
      setMsg({ type: 'err', text: 'Weigh recording failed' });
    }
    setSaving(false);
  }

  async function recordRelease(shipmentId: string) {
    setSaving(true);
    try {
      await api.put(`/shipments/${shipmentId}/status`, {
        status: 'RELEASED',
        challanNo: releaseChallanNo,
        ewayBill: releaseEwayBill,
        gatePassNo: releaseGatePassNo,
        releaseTime: new Date().toISOString(),
      });
      setMsg({ type: 'ok', text: 'Vehicle released!' });
      setReleaseChallanNo('');
      setReleaseEwayBill('');
      setReleaseGatePassNo('');
      setReleaseFormOpen(null);
      loadShipments();
    } catch {
      setMsg({ type: 'err', text: 'Release failed' });
    }
    setSaving(false);
  }

  async function recordExit(shipmentId: string) {
    setSaving(true);
    try {
      await api.put(`/shipments/${shipmentId}/status`, {
        status: 'EXITED',
        exitTime: new Date().toISOString(),
      });
      setMsg({ type: 'ok', text: 'Exit recorded!' });
      loadShipments();
    } catch {
      setMsg({ type: 'err', text: 'Exit recording failed' });
    }
    setSaving(false);
  }

  const shareStatus = (s: Shipment) => {
    const netWeight = s.weightGross && s.weightTare ? (s.weightGross - s.weightTare).toFixed(2) : null;
    const text = `🚛 Vehicle: ${s.vehicleNo}\nProduct: ${s.productName}\nCustomer: ${s.customerName}\nStatus: ${s.status}\n${netWeight ? `Weight: ${netWeight} T\n` : ''}Gate In: ${s.gateInTime}`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
  };

  const statusConfig = {
    GATE_IN: { border: 'border-l-4 border-l-gray-400', bg: 'bg-gray-50', label: 'At Gate', action: 'Weigh Tare', type: 'tare' },
    TARE_WEIGHED: { border: 'border-l-4 border-l-blue-500', bg: 'bg-blue-50', label: 'Tare Done', action: 'Start Loading', type: null },
    LOADING: { border: 'border-l-4 border-l-amber-400', bg: 'bg-amber-50', label: 'Loading', action: 'Weigh Gross', type: 'gross' },
    GROSS_WEIGHED: { border: 'border-l-4 border-l-orange-500', bg: 'bg-orange-50', label: 'Loaded', action: 'Release', type: null },
    RELEASED: { border: 'border-l-4 border-l-green-500', bg: 'bg-green-50', label: 'Released', action: 'Exit', type: null },
    EXITED: { border: 'border-l-4 border-l-emerald-600', bg: 'bg-emerald-50', label: 'Exited', action: null, type: null },
  };

  const config = statusConfig[shipments[0]?.status || 'GATE_IN'];

  // Compute stats from shipments
  const computeStats = () => {
    const inside = shipments.filter(s => ['GATE_IN', 'TARE_WEIGHED', 'LOADING'].includes(s.status)).length;
    const loading = shipments.filter(s => s.status === 'LOADING').length;
    const loaded = shipments.filter(s => s.status === 'GROSS_WEIGHED').length;
    const ready = shipments.filter(s => ['RELEASED', 'EXITED'].includes(s.status)).length;
    return { inside, loading, loaded, ready };
  };

  const stats = computeStats();

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white max-w-5xl mx-auto">
      {/* Header */}
      <div className="sticky top-0 bg-white border-b border-gray-200 z-20">
        <div className="px-4 py-4 flex items-center gap-3">
          <Truck size={32} className="text-blue-600" />
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-900">Gate Register</h1>
            <p className="text-xs md:text-sm text-gray-500">Factory vehicle tracking</p>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-4 gap-2 px-4 pb-4">
          <div className="text-center bg-gray-100 rounded-lg p-2">
            <div className="text-xs text-gray-600">Inside</div>
            <div className="text-lg md:text-2xl font-bold text-gray-900">{stats.inside}</div>
          </div>
          <div className="text-center bg-amber-100 rounded-lg p-2">
            <div className="text-xs text-gray-600">Loading</div>
            <div className="text-lg md:text-2xl font-bold text-amber-700">{stats.loading}</div>
          </div>
          <div className="text-center bg-orange-100 rounded-lg p-2">
            <div className="text-xs text-gray-600">Loaded</div>
            <div className="text-lg md:text-2xl font-bold text-orange-700">{stats.loaded}</div>
          </div>
          <div className="text-center bg-green-100 rounded-lg p-2">
            <div className="text-xs text-gray-600">Ready</div>
            <div className="text-lg md:text-2xl font-bold text-green-700">{stats.ready}</div>
          </div>
        </div>
      </div>

      <div className="p-4">
        {msg && (
          <div className={`rounded-lg p-3 mb-4 text-sm ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {msg.text}
          </div>
        )}

        {/* New Vehicle Entry Button */}
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="w-full border-2 border-dashed border-blue-300 rounded-lg py-4 text-blue-600 hover:bg-blue-50 flex items-center justify-center gap-2 mb-4 font-bold text-lg touch-target"
          >
            <Plus size={24} /> New Vehicle Entry
          </button>
        )}

        {/* New Vehicle Form */}
        {showForm && (
          <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Vehicle Entry</h3>
              <button onClick={resetForm} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            {/* Vehicle No */}
            <div className="mb-3">
              <label className="block text-xs font-semibold text-gray-700 mb-1">Vehicle No *</label>
              <input
                value={vehicleNo}
                onChange={e => setVehicleNo(e.target.value)}
                placeholder="MP09HH3213"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base font-bold text-gray-900 placeholder-gray-400"
                autoFocus
              />
            </div>

            {/* Product */}
            <div className="mb-3">
              <label className="block text-xs font-semibold text-gray-700 mb-1">Product *</label>
              <select
                value={product}
                onChange={e => setProduct(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base"
              >
                {PRODUCTS.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            {/* Customer & Destination */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Customer</label>
                <input
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  placeholder="Name"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Destination</label>
                <input
                  value={destination}
                  onChange={e => setDestination(e.target.value)}
                  placeholder="City"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base"
                />
              </div>
            </div>

            {/* Driver Info */}
            <div className="mb-3">
              <label className="block text-xs font-semibold text-gray-700 mb-1">Driver Name</label>
              <input
                value={driverName}
                onChange={e => setDriverName(e.target.value)}
                placeholder="Driver name"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base mb-3"
              />
              <label className="block text-xs font-semibold text-gray-700 mb-1">Driver Mobile</label>
              <input
                value={driverMobile}
                onChange={e => setDriverMobile(e.target.value)}
                placeholder="10-digit mobile"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base"
              />
            </div>

            {/* Transporter & Capacity */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Transporter</label>
                <input
                  value={transporter}
                  onChange={e => setTransporter(e.target.value)}
                  placeholder="Name"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Capacity (Ton)</label>
                <input
                  type="number"
                  value={capacityTon}
                  onChange={e => setCapacityTon(e.target.value)}
                  placeholder="0"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base"
                />
              </div>
            </div>

            {/* Vehicle Type */}
            <div className="mb-3">
              <label className="block text-xs font-semibold text-gray-700 mb-1">Vehicle Type</label>
              <select
                value={vehicleType}
                onChange={e => setVehicleType(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base"
              >
                {VEHICLE_TYPES.map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>

            {/* Gate In Time */}
            <div className="mb-3">
              <label className="block text-xs font-semibold text-gray-700 mb-1">Gate In Time</label>
              <input
                type="time"
                value={gateInTime}
                onChange={e => setGateInTime(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base"
              />
            </div>

            {/* Dispatch Request */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-gray-700 mb-1">Dispatch Request (Optional)</label>
              <select
                value={dispatchRequestId}
                onChange={e => setDispatchRequestId(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base"
              >
                <option value="">— None —</option>
                {dispatchRequests.map(dr => (
                  <option key={dr.id} value={dr.id}>{dr.customerName}</option>
                ))}
              </select>
            </div>

            <button
              onClick={saveNewVehicle}
              disabled={saving}
              className="w-full py-3 bg-blue-600 text-white rounded-lg font-bold text-base hover:bg-blue-700 flex items-center justify-center gap-2 disabled:opacity-50 touch-target"
            >
              {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
              Save Entry
            </button>
          </div>
        )}

        {/* Shipments List */}
        <div className="space-y-3">
          {shipments.length > 0 ? (
            shipments.map(s => {
              const sConfig = statusConfig[s.status];
              const netWeight = s.weightGross && s.weightTare ? (s.weightGross - s.weightTare).toFixed(2) : null;
              return (
                <div key={s.id} className={`${sConfig.bg} ${sConfig.border} rounded-lg p-4 shadow-sm`}>
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="text-2xl md:text-3xl font-bold text-gray-900">{s.vehicleNo}</div>
                      <div className="text-sm text-gray-600 mt-1">{s.customerName}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-semibold text-gray-500 uppercase">{sConfig.label}</div>
                      {netWeight && <div className="text-2xl font-bold text-gray-900 mt-1">{netWeight} T</div>}
                    </div>
                  </div>

                  {/* Details */}
                  <div className="bg-white/60 rounded-lg p-3 mb-3 space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Product:</span>
                      <span className="font-semibold text-gray-900">{s.productName}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Destination:</span>
                      <span className="font-semibold text-gray-900">{s.destination || '—'}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Gate In:</span>
                      <span className="font-semibold text-gray-900">{s.gateInTime}</span>
                    </div>
                    {s.weightTare && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Tare:</span>
                        <span className="font-semibold text-gray-900">{s.weightTare} T</span>
                      </div>
                    )}
                    {s.weightGross && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Gross:</span>
                        <span className="font-semibold text-gray-900">{s.weightGross} T</span>
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="space-y-2">
                    {s.status === 'GATE_IN' && (
                      <button
                        onClick={() => {
                          setWeighFormOpen(s.id);
                          setWeighType('tare');
                        }}
                        className="w-full py-3 bg-gray-500 text-white rounded-lg font-bold text-base hover:bg-gray-600 touch-target"
                      >
                        📏 Weigh Tare
                      </button>
                    )}

                    {s.status === 'TARE_WEIGHED' && (
                      <button
                        onClick={async () => {
                          setSaving(true);
                          try {
                            await api.put(`/shipments/${s.id}/status`, { status: 'LOADING', loadStartTime: new Date().toISOString() });
                            setMsg({ type: 'ok', text: 'Loading started!' });
                            loadShipments();
                          } catch {
                            setMsg({ type: 'err', text: 'Failed' });
                          }
                          setSaving(false);
                        }}
                        className="w-full py-3 bg-blue-600 text-white rounded-lg font-bold text-base hover:bg-blue-700 touch-target"
                      >
                        ▶️ Start Loading
                      </button>
                    )}

                    {s.status === 'LOADING' && (
                      <button
                        onClick={() => {
                          setWeighFormOpen(s.id);
                          setWeighType('gross');
                        }}
                        className="w-full py-3 bg-amber-600 text-white rounded-lg font-bold text-base hover:bg-amber-700 touch-target"
                      >
                        📏 Weigh Gross
                      </button>
                    )}

                    {s.status === 'GROSS_WEIGHED' && (
                      <button
                        onClick={() => setReleaseFormOpen(s.id)}
                        className="w-full py-3 bg-orange-600 text-white rounded-lg font-bold text-base hover:bg-orange-700 touch-target"
                      >
                        🔓 Release
                      </button>
                    )}

                    {s.status === 'RELEASED' && (
                      <button
                        onClick={() => recordExit(s.id)}
                        className="w-full py-3 bg-green-600 text-white rounded-lg font-bold text-base hover:bg-green-700 touch-target"
                      >
                        🚗 Exit
                      </button>
                    )}

                    {/* Share & Contact */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => shareStatus(s)}
                        className="py-2 bg-green-600 text-white rounded-lg font-semibold text-sm hover:bg-green-700 flex items-center justify-center gap-1 touch-target"
                      >
                        <Share2 size={16} /> Share
                      </button>
                      {s.driverMobile && (
                        <a
                          href={`https://api.whatsapp.com/send?phone=${s.driverMobile}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="py-2 bg-green-500 text-white rounded-lg font-semibold text-sm hover:bg-green-600 flex items-center justify-center gap-1 touch-target"
                        >
                          <MessageCircle size={16} /> Chat
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Weigh Form Inline */}
                  {weighFormOpen === s.id && (
                    <div className="mt-3 bg-white rounded-lg p-3 border-2 border-blue-300">
                      <label className="block text-xs font-semibold text-gray-700 mb-2">
                        Weight ({weighType.toUpperCase()}) in Tons
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          step="0.01"
                          value={weighWeight}
                          onChange={e => setWeighWeight(e.target.value)}
                          placeholder="0.00"
                          className="flex-1 px-4 py-3 border border-gray-300 rounded-lg text-base font-bold"
                          autoFocus
                        />
                        <button
                          onClick={() => recordWeigh(s.id)}
                          disabled={saving}
                          className="px-6 py-3 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setWeighFormOpen(null)}
                          className="px-4 py-3 text-gray-600 hover:text-gray-900"
                        >
                          <X size={18} />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Release Form Inline */}
                  {releaseFormOpen === s.id && (
                    <div className="mt-3 bg-white rounded-lg p-3 border-2 border-orange-300 space-y-2">
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">Challan No</label>
                        <input
                          value={releaseChallanNo}
                          onChange={e => setReleaseChallanNo(e.target.value)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg text-base"
                          placeholder="CHN-2026-001"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">E-Way Bill</label>
                        <input
                          value={releaseEwayBill}
                          onChange={e => setReleaseEwayBill(e.target.value)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg text-base"
                          placeholder="EWB-2026-001"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">Gate Pass No</label>
                        <input
                          value={releaseGatePassNo}
                          onChange={e => setReleaseGatePassNo(e.target.value)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg text-base"
                          placeholder="GP-2026-001"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => recordRelease(s.id)}
                          disabled={saving}
                          className="flex-1 py-2 bg-orange-600 text-white rounded-lg font-bold hover:bg-orange-700 disabled:opacity-50"
                        >
                          Release Vehicle
                        </button>
                        <button
                          onClick={() => setReleaseFormOpen(null)}
                          className="px-4 py-2 text-gray-600 hover:text-gray-900"
                        >
                          <X size={18} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="text-center py-8 text-gray-500">
              <Truck size={48} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No active shipments</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
