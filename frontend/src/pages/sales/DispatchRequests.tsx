import { useState, useEffect, useCallback } from 'react';
import {
  Truck, Loader2, ChevronDown, Check, Package, MapPin, Clock, Plus, X,
  Trash2, ArrowDown, ArrowUp, Phone, Navigation, IndianRupee, Save,
  CheckCircle, AlertCircle, Share2, Route, User, MessageCircle,
  FileText, Calendar, CreditCard, Building2
} from 'lucide-react';
import api from '../../services/api';

// ── Factory location (MSPIL Agariya) ──
const FACTORY = {
  name: 'MSPIL, Agariya, Madhya Pradesh 487001',
  address: 'Agariya, Madhya Pradesh 487001',
  lat: 23.1815,  // Agariya approximate
  lng: 80.0115,
};

// ── Types ──
interface Transporter {
  id: string; name: string; contactPerson?: string; phone?: string;
  vehicleCount?: number; address?: string;
}

interface Shipment {
  id: string; vehicleNo: string; status: string; driverName?: string; driverMobile?: string;
  weightTare?: number; weightGross?: number; weightNet?: number;
  transporterName?: string; capacityTon?: number;
  gateInTime?: string; tareTime?: string; grossTime?: string; releaseTime?: string; exitTime?: string;
  documents?: { id: string; docType: string; fileName: string; mimeType?: string }[];
  ewayBillStatus?: string; ewayBill?: string; challanNo?: string;
}

interface OrderLine {
  productName: string; quantity: number; unit: string; rate: number; gstPercent: number; amount: number;
}

interface DR {
  id: string; drNo: number; status: string;
  productName: string; quantity: number; unit: string;
  customerName: string; destination?: string; deliveryDate?: string;
  logisticsBy: string; transporterName?: string; transporterId?: string;
  vehicleCount: number; freightRate?: number; distanceKm?: number;
  remarks?: string; createdAt: string;
  order?: {
    id: string; orderNo: string; logisticsBy?: string; paymentTerms?: string;
    deliveryDate?: string; freightRate?: number; grandTotal?: number;
    customer?: {
      id: string; name: string; address?: string; city?: string;
      state?: string; pincode?: string; phone?: string; contactPerson?: string;
    };
    lines?: OrderLine[];
  };
  shipments?: Shipment[];
  _count?: { shipments: number };
}

interface GrainTruck {
  id: string; vehicleNo: string; vendorName?: string; weightGross: number; weightTare: number; weightNet: number;
  createdAt: string; quarantineWeight?: number; status?: string;
}

// ── Step logic ──
type LogisticsStep = 'NEW' | 'TRANSPORTER_SET' | 'TRUCKS_ASSIGNED' | 'AT_FACTORY' | 'DISPATCHED';

function getDRStep(dr: DR): { step: LogisticsStep; label: string; action: string; stepIdx: number } {
  const shipments = dr.shipments || [];
  const hasExited = shipments.some(s => ['RELEASED', 'EXITED'].includes(s.status));
  const hasActive = shipments.some(s => ['GATE_IN', 'TARE_WEIGHED', 'LOADING', 'GROSS_WEIGHED'].includes(s.status));
  const hasTrucks = shipments.length > 0;

  if (['DISPATCHED', 'COMPLETED'].includes(dr.status) || hasExited)
    return { step: 'DISPATCHED', label: 'Dispatched', action: '', stepIdx: 4 };
  if (hasActive)
    return { step: 'AT_FACTORY', label: 'At Factory', action: 'Track weighbridge', stepIdx: 3 };
  if (hasTrucks)
    return { step: 'TRUCKS_ASSIGNED', label: 'Trucks Assigned', action: 'Waiting for arrival', stepIdx: 2 };
  if (dr.transporterName || dr.transporterId)
    return { step: 'TRANSPORTER_SET', label: 'Transporter Set', action: 'Get truck details from transporter', stepIdx: 1 };
  return { step: 'NEW', label: 'Needs Transporter', action: 'Assign transporter & rate', stepIdx: 0 };
}

const STEP_COLORS = ['bg-red-500', 'bg-orange-500', 'bg-blue-500', 'bg-amber-500', 'bg-green-500'];
const STEP_BADGES: Record<LogisticsStep, string> = {
  NEW: 'bg-red-100 text-red-700',
  TRANSPORTER_SET: 'bg-orange-100 text-orange-700',
  TRUCKS_ASSIGNED: 'bg-blue-100 text-blue-700',
  AT_FACTORY: 'bg-amber-100 text-amber-700',
  DISPATCHED: 'bg-green-100 text-green-700',
};

// ── Distance calc (OSRM + Nominatim — free, no API key) ──
async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`,
      { headers: { 'User-Agent': 'MSPIL-ERP/1.0' } }
    );
    const data = await res.json();
    if (data.length > 0) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    return null;
  } catch { return null; }
}

async function calcDistance(destAddress: string): Promise<{ distanceKm: number; durationHrs: number } | null> {
  const dest = await geocode(destAddress);
  if (!dest) return null;
  try {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${FACTORY.lng},${FACTORY.lat};${dest.lng},${dest.lat}?overview=false`
    );
    const data = await res.json();
    if (data.routes && data.routes.length > 0) {
      return {
        distanceKm: Math.round(data.routes[0].distance / 1000),
        durationHrs: Math.round(data.routes[0].duration / 3600 * 10) / 10,
      };
    }
    return null;
  } catch { return null; }
}

// ── Helper: build full address from customer ──
function getCustomerAddress(customer?: DR['order']['customer']): string {
  if (!customer) return '';
  const parts = [customer.address, customer.city, customer.state, customer.pincode].filter(Boolean);
  return parts.join(', ');
}

export default function DispatchRequests() {
  const [drs, setDrs] = useState<DR[]>([]);
  const [transporters, setTransporters] = useState<Transporter[]>([]);
  const [grainTrucks, setGrainTrucks] = useState<GrainTruck[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filterStep, setFilterStep] = useState('ACTIVE');
  const [direction, setDirection] = useState<'OUTBOUND' | 'INBOUND'>('OUTBOUND');
  const [calcLoading, setCalcLoading] = useState<string | null>(null);

  // Logistics form
  const [editingDR, setEditingDR] = useState<string | null>(null);
  const [editTransporterId, setEditTransporterId] = useState('');
  const [editTransporterName, setEditTransporterName] = useState('');
  const [editFreightRate, setEditFreightRate] = useState('');
  const [editDistanceKm, setEditDistanceKm] = useState('');
  const [editDuration, setEditDuration] = useState('');
  const [editDestination, setEditDestination] = useState('');
  const [editVehicleCount, setEditVehicleCount] = useState('');

  // Truck form
  const [truckFormDR, setTruckFormDR] = useState<string | null>(null);
  const [truckVehicle, setTruckVehicle] = useState('');
  const [truckDriver, setTruckDriver] = useState('');
  const [truckMobile, setTruckMobile] = useState('');

  // Document management
  const [expandedTruck, setExpandedTruck] = useState<string | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      const [drRes, grainRes, transRes] = await Promise.all([
        api.get('/dispatch-requests/factory'),
        api.get('/grain-truck').catch(() => ({ data: { trucks: [] } })),
        api.get('/transporters'),
      ]);
      setDrs(drRes.data.dispatchRequests || drRes.data || []);
      setGrainTrucks(grainRes.data.trucks || grainRes.data || []);
      setTransporters(transRes.data.transporters || transRes.data || []);
    } catch {
      flash('err', 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const flash = (type: 'ok' | 'err', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 5000);
  };

  // ── Google Maps link ──
  const getMapUrl = (destination: string) => {
    const origin = encodeURIComponent(FACTORY.address);
    const dest = encodeURIComponent(destination);
    return `https://www.google.com/maps/dir/${origin}/${dest}`;
  };

  // ── Auto-calculate distance ──
  const autoCalcDistance = useCallback(async (drId: string, destination: string) => {
    if (!destination.trim()) { flash('err', 'Enter destination first'); return; }
    setCalcLoading(drId);
    const result = await calcDistance(destination);
    if (result) {
      setEditDistanceKm(String(result.distanceKm));
      setEditDuration(String(result.durationHrs));
      flash('ok', `Distance: ${result.distanceKm} km (~${result.durationHrs} hrs)`);
    } else {
      flash('err', 'Could not calculate distance. Check address spelling or enter manually.');
    }
    setCalcLoading(null);
  }, []);

  // ── Upload document ──
  const uploadDoc = async (shipmentId: string, docType: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setUploadingDoc(shipmentId);
      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('shipmentId', shipmentId);
        fd.append('docType', docType);
        await api.post('/shipment-documents/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        flash('ok', `${docType.replace(/_/g, ' ')} uploaded`);
        load();
      } catch (e: any) {
        flash('err', e.response?.data?.error || 'Upload failed');
      } finally {
        setUploadingDoc(null);
      }
    };
    input.click();
  };

  // ── Start editing a DR ──
  const startEditDR = (dr: DR) => {
    setEditingDR(dr.id);
    setEditTransporterId(dr.transporterId || '');
    setEditTransporterName(dr.transporterName || '');
    setEditFreightRate(dr.freightRate ? String(dr.freightRate) : '');
    setEditDistanceKm(dr.distanceKm ? String(dr.distanceKm) : '');
    setEditDuration('');
    // Pre-fill destination from customer address if not already set
    const customerAddr = getCustomerAddress(dr.order?.customer);
    setEditDestination(dr.destination || customerAddr || '');
    setEditVehicleCount(dr.vehicleCount ? String(dr.vehicleCount) : '1');
  };

  const saveLogistics = async (drId: string) => {
    setActionLoading(drId);
    try {
      const transporter = transporters.find(t => t.id === editTransporterId);
      await api.put(`/dispatch-requests/${drId}`, {
        transporterId: editTransporterId || null,
        transporterName: transporter?.name || editTransporterName || null,
        freightRate: editFreightRate ? parseFloat(editFreightRate) : null,
        distanceKm: editDistanceKm ? parseFloat(editDistanceKm) : null,
        destination: editDestination,
        vehicleCount: parseInt(editVehicleCount) || 1,
      });
      flash('ok', 'Logistics details saved');
      setEditingDR(null);
      load();
    } catch (e: any) {
      flash('err', e.response?.data?.error || 'Failed');
    } finally {
      setActionLoading(null);
    }
  };

  const assignTruck = async (drId: string) => {
    if (!truckVehicle.trim()) { flash('err', 'Enter vehicle number'); return; }
    setActionLoading(drId + '_truck');
    try {
      const dr = drs.find(d => d.id === drId);
      await api.post('/shipments', {
        dispatchRequestId: drId,
        vehicleNo: truckVehicle.trim().toUpperCase(),
        driverName: truckDriver || null,
        driverMobile: truckMobile || null,
        transporterName: dr?.transporterName || '',
        gateInTime: new Date().toISOString(),
        productName: dr?.productName || '',
        customerName: dr?.customerName || '',
        destination: dr?.destination || '',
      });
      flash('ok', `Truck ${truckVehicle} registered`);
      setTruckFormDR(null); setTruckVehicle(''); setTruckDriver(''); setTruckMobile('');
      load();
    } catch (e: any) {
      flash('err', e.response?.data?.error || 'Failed');
    } finally {
      setActionLoading(null);
    }
  };

  const shareDR = (dr: DR) => {
    const trucks = dr.shipments?.map(s => s.vehicleNo).join(', ') || 'TBD';
    const text = `*Dispatch #${dr.drNo}*\n` +
      `Customer: ${dr.customerName}\n` +
      `Product: ${dr.productName} - ${dr.quantity} ${dr.unit}\n` +
      `Destination: ${dr.destination || 'TBD'}\n` +
      `Distance: ${dr.distanceKm ? dr.distanceKm + ' km' : 'TBD'}\n` +
      `Transporter: ${dr.transporterName || 'TBD'}\n` +
      `Rate: ${dr.freightRate ? '₹' + dr.freightRate + '/MT' : 'TBD'}\n` +
      `Trucks: ${trucks}`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
  };

  // ── Filters ──
  const drSteps = drs.map(dr => ({ dr, ...getDRStep(dr) }));
  const needsAction = drSteps.filter(d => d.step === 'NEW');
  const inProgress = drSteps.filter(d => ['TRANSPORTER_SET', 'TRUCKS_ASSIGNED', 'AT_FACTORY'].includes(d.step));
  const done = drSteps.filter(d => d.step === 'DISPATCHED');
  const filtered = filterStep === 'ACTIVE' ? drSteps.filter(d => d.step !== 'DISPATCHED') :
    filterStep === 'NEEDS_ACTION' ? needsAction :
    filterStep === 'IN_PROGRESS' ? inProgress :
    filterStep === 'DONE' ? done : drSteps;

  const inboundTotalNet = grainTrucks.reduce((s, t) => s + (t.weightNet || 0), 0);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className={`bg-gradient-to-r ${direction === 'OUTBOUND' ? 'from-orange-600 to-orange-700' : 'from-teal-600 to-teal-700'} text-white`}>
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Truck size={24} /> Logistics
            </h1>
            <div className="flex bg-white/20 rounded-lg p-0.5">
              <button onClick={() => setDirection('OUTBOUND')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1 transition ${direction === 'OUTBOUND' ? 'bg-white text-orange-700' : 'text-white/80'}`}>
                <ArrowUp size={14} /> Outbound
              </button>
              <button onClick={() => setDirection('INBOUND')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1 transition ${direction === 'INBOUND' ? 'bg-white text-teal-700' : 'text-white/80'}`}>
                <ArrowDown size={14} /> Inbound
              </button>
            </div>
          </div>

          {direction === 'OUTBOUND' ? (
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-white/15 rounded-lg p-2.5 text-center">
                <div className="text-2xl font-bold">{needsAction.length}</div>
                <div className="text-[10px] text-orange-100">Need Transporter</div>
              </div>
              <div className="bg-white/15 rounded-lg p-2.5 text-center">
                <div className="text-2xl font-bold">{inProgress.length}</div>
                <div className="text-[10px] text-orange-100">In Progress</div>
              </div>
              <div className="bg-white/15 rounded-lg p-2.5 text-center">
                <div className="text-2xl font-bold">{drs.reduce((s, d) => s + (d.shipments?.length || 0), 0)}</div>
                <div className="text-[10px] text-orange-100">Total Trucks</div>
              </div>
              <div className="bg-white/15 rounded-lg p-2.5 text-center">
                <div className="text-2xl font-bold">{drs.filter(d => !['DISPATCHED','COMPLETED'].includes(d.status)).reduce((s, d) => s + d.quantity, 0).toFixed(0)}</div>
                <div className="text-[10px] text-orange-100">MT Pending</div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white/15 rounded-lg p-2.5 text-center">
                <div className="text-2xl font-bold">{grainTrucks.length}</div>
                <div className="text-[10px] text-teal-100">Trucks Today</div>
              </div>
              <div className="bg-white/15 rounded-lg p-2.5 text-center">
                <div className="text-2xl font-bold">{(inboundTotalNet / 1000).toFixed(1)}</div>
                <div className="text-[10px] text-teal-100">MT Received</div>
              </div>
              <div className="bg-white/15 rounded-lg p-2.5 text-center">
                <div className="text-2xl font-bold">{grainTrucks.filter(t => t.quarantineWeight).length}</div>
                <div className="text-[10px] text-teal-100">Quarantine</div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-4">
        {msg && (
          <div className={`rounded-lg p-3 mb-4 text-sm flex items-center gap-2 ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {msg.type === 'ok' ? <CheckCircle size={16} /> : <AlertCircle size={16} />} {msg.text}
          </div>
        )}

        {/* ── OUTBOUND ── */}
        {direction === 'OUTBOUND' && (<>
          <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
            {[
              { key: 'ACTIVE', label: `Active (${needsAction.length + inProgress.length})` },
              { key: 'NEEDS_ACTION', label: `Need Transporter (${needsAction.length})` },
              { key: 'IN_PROGRESS', label: `In Progress (${inProgress.length})` },
              { key: 'DONE', label: `Done (${done.length})` },
              { key: 'ALL', label: `All (${drs.length})` },
            ].map(tab => (
              <button key={tab.key} onClick={() => setFilterStep(tab.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition ${
                  filterStep === tab.key ? 'bg-orange-600 text-white' : 'bg-white text-gray-600 border hover:bg-gray-50'
                }`}>
                {tab.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="text-center py-12 text-gray-400">
              <Loader2 size={32} className="animate-spin mx-auto mb-2" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <Truck size={48} className="mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500 text-sm">No dispatch requests</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(({ dr, step, label, action, stepIdx }) => {
                const isExpanded = expandedId === dr.id;
                const shipments = dr.shipments || [];
                const isEditing = editingDR === dr.id;
                const order = dr.order;
                const customer = order?.customer;
                const lines = order?.lines || [];
                const customerAddr = getCustomerAddress(customer);

                return (
                  <div key={dr.id} className={`bg-white rounded-lg border shadow-sm hover:shadow-md transition ${step === 'NEW' ? 'border-l-4 border-l-red-400' : ''}`}>
                    {/* Card Header */}
                    <button onClick={() => setExpandedId(isExpanded ? null : dr.id)} className="w-full p-4 text-left">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="font-bold text-gray-900">DR #{dr.drNo}</span>
                            <span className="text-xs text-gray-400">SO #{order?.orderNo}</span>
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STEP_BADGES[step]}`}>
                              {label}
                            </span>
                            {dr.logisticsBy === 'SELLER' && (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 border border-orange-200">
                                MSPIL Transport
                              </span>
                            )}
                          </div>

                          {/* Customer & Product */}
                          <p className="text-sm text-gray-800 font-semibold">{dr.customerName}</p>
                          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                            <span className="flex items-center gap-1 font-medium text-gray-700">
                              <Package size={12} /> {dr.productName} · {dr.quantity} {dr.unit}
                            </span>
                            {lines[0]?.rate > 0 && (
                              <span>@ ₹{lines[0].rate.toLocaleString('en-IN')}/{lines[0].unit}</span>
                            )}
                            {order?.grandTotal && (
                              <span className="font-medium text-gray-700">
                                SO Value: ₹{order.grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                              </span>
                            )}
                          </div>

                          {/* Location & logistics summary */}
                          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                            {dr.destination && (
                              <span className="flex items-center gap-1">
                                <MapPin size={11} /> {dr.destination.length > 50 ? dr.destination.slice(0, 50) + '...' : dr.destination}
                              </span>
                            )}
                            {dr.distanceKm && (
                              <span className="flex items-center gap-1 text-blue-600 font-medium">
                                <Route size={11} /> {dr.distanceKm} km
                              </span>
                            )}
                            {dr.transporterName && (
                              <span className="flex items-center gap-1 text-indigo-600">
                                <Truck size={11} /> {dr.transporterName}
                              </span>
                            )}
                            {dr.freightRate && (
                              <span className="flex items-center gap-1 text-green-600 font-medium">
                                ₹{dr.freightRate}/MT
                              </span>
                            )}
                            {dr.deliveryDate && (
                              <span className="flex items-center gap-1">
                                <Calendar size={11} /> {new Date(dr.deliveryDate).toLocaleDateString('en-IN')}
                              </span>
                            )}
                          </div>

                          {/* Action hint */}
                          {action && (
                            <div className="mt-1.5 text-xs font-medium text-orange-600">
                              → {action}
                            </div>
                          )}
                        </div>
                        <div className="text-right ml-4 shrink-0">
                          <div className="text-sm font-bold text-orange-600">
                            {shipments.length} truck{shipments.length !== 1 ? 's' : ''}
                          </div>
                          <ChevronDown size={16} className={`text-gray-400 ml-auto transition ${isExpanded ? 'rotate-180' : ''}`} />
                        </div>
                      </div>

                      {/* Progress */}
                      <div className="flex gap-1 mt-2.5">
                        {['Transporter', 'Trucks', 'At Gate', 'Weigh', 'Dispatch'].map((s, i) => (
                          <div key={s} className="flex-1 flex flex-col items-center">
                            <div className={`w-full h-1.5 rounded-full ${
                              i <= stepIdx ? STEP_COLORS[stepIdx] : 'bg-gray-200'
                            } ${i === stepIdx && stepIdx < 4 ? 'animate-pulse' : ''}`} />
                            <span className={`text-[7px] mt-0.5 ${i <= stepIdx ? 'text-gray-600 font-medium' : 'text-gray-400'}`}>{s}</span>
                          </div>
                        ))}
                      </div>
                    </button>

                    {/* ── Expanded ── */}
                    {isExpanded && (
                      <div className="border-t bg-gray-50 p-4 space-y-3">

                        {/* ── Order Details Card ── */}
                        <div className="bg-white rounded-lg border p-3">
                          <div className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1">
                            <FileText size={12} /> Sale Order Details
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                            <div>
                              <span className="text-gray-400">Customer</span>
                              <p className="font-semibold text-gray-800">{customer?.name}</p>
                              {customer?.contactPerson && <p className="text-gray-500">{customer.contactPerson}</p>}
                              {customer?.phone && (
                                <a href={`tel:${customer.phone}`} className="text-blue-600 flex items-center gap-0.5 mt-0.5">
                                  <Phone size={10} /> {customer.phone}
                                </a>
                              )}
                            </div>
                            <div>
                              <span className="text-gray-400">Delivery Address</span>
                              <p className="font-medium text-gray-700">{customerAddr || '—'}</p>
                            </div>
                            <div>
                              <span className="text-gray-400">Payment</span>
                              <p className="font-medium">{order?.paymentTerms || '—'}</p>
                            </div>
                            <div>
                              <span className="text-gray-400">Delivery Date</span>
                              <p className="font-medium">{dr.deliveryDate ? new Date(dr.deliveryDate).toLocaleDateString('en-IN') : '—'}</p>
                            </div>
                            <div>
                              <span className="text-gray-400">Order Value</span>
                              <p className="font-bold text-gray-800">₹{(order?.grandTotal || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
                            </div>
                          </div>
                          {/* Line items */}
                          {lines.length > 0 && (
                            <div className="mt-2 pt-2 border-t">
                              {lines.map((line, i) => (
                                <div key={i} className="flex items-center justify-between text-xs text-gray-600">
                                  <span>{line.productName} — {line.quantity} {line.unit} @ ₹{line.rate?.toLocaleString('en-IN')}</span>
                                  <span className="font-medium">₹{(line.amount || line.quantity * line.rate).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* ── Logistics Edit Form ── */}
                        {isEditing ? (
                          <div className="bg-orange-50 rounded-lg p-3 border border-orange-200 space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-orange-800">Set Logistics Details</span>
                              <button onClick={() => setEditingDR(null)} className="text-gray-400"><X size={14} /></button>
                            </div>

                            {/* Destination + auto distance */}
                            <div>
                              <label className="text-[10px] text-gray-500 font-medium">Delivery Destination</label>
                              <div className="flex gap-1.5 mt-0.5">
                                <input value={editDestination} onChange={e => setEditDestination(e.target.value)}
                                  placeholder="Full address — city, state, pincode" className="input-field text-xs flex-1" />
                                <button onClick={() => autoCalcDistance(dr.id, editDestination)}
                                  disabled={!!calcLoading}
                                  className="px-3 py-1.5 bg-blue-600 text-white text-[10px] rounded font-medium hover:bg-blue-700 flex items-center gap-1 whitespace-nowrap disabled:opacity-50"
                                  title="Auto-calculate distance from Agariya factory">
                                  {calcLoading === dr.id ? <Loader2 size={10} className="animate-spin" /> : <Route size={10} />}
                                  Calc Distance
                                </button>
                                {editDestination && (
                                  <a href={getMapUrl(editDestination)} target="_blank" rel="noopener"
                                    className="px-2 py-1.5 bg-green-600 text-white text-[10px] rounded font-medium hover:bg-green-700 flex items-center gap-1 whitespace-nowrap">
                                    <Navigation size={10} /> Google Maps
                                  </a>
                                )}
                              </div>
                              <p className="text-[9px] text-gray-400 mt-0.5">
                                From: {FACTORY.name}
                              </p>
                            </div>

                            {/* Distance + Duration (auto-filled) */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                              <div>
                                <label className="text-[10px] text-gray-500 font-medium">Distance (km)</label>
                                <input type="number" value={editDistanceKm} onChange={e => setEditDistanceKm(e.target.value)}
                                  placeholder="Auto or manual" className="input-field text-xs w-full" />
                              </div>
                              {editDuration && (
                                <div>
                                  <label className="text-[10px] text-gray-500 font-medium">Est. Travel Time</label>
                                  <div className="input-field text-xs bg-gray-50 text-gray-600">{editDuration} hrs</div>
                                </div>
                              )}
                              <div>
                                <label className="text-[10px] text-gray-500 font-medium">Trucks Needed</label>
                                <input type="number" value={editVehicleCount} onChange={e => setEditVehicleCount(e.target.value)}
                                  placeholder="1" className="input-field text-xs w-full" />
                              </div>
                            </div>

                            {/* Transporter selection */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              <div>
                                <label className="text-[10px] text-gray-500 font-medium">Transporter</label>
                                <select value={editTransporterId} onChange={e => {
                                  setEditTransporterId(e.target.value);
                                  const t = transporters.find(t => t.id === e.target.value);
                                  if (t) setEditTransporterName(t.name);
                                }}
                                  className="input-field text-xs w-full">
                                  <option value="">Select transporter</option>
                                  {transporters.map(t => (
                                    <option key={t.id} value={t.id}>
                                      {t.name} {t.vehicleCount ? `(${t.vehicleCount} vehicles)` : ''} {t.contactPerson ? `— ${t.contactPerson}` : ''}
                                    </option>
                                  ))}
                                </select>
                                {/* Transporter contact */}
                                {editTransporterId && (() => {
                                  const t = transporters.find(tr => tr.id === editTransporterId);
                                  return t ? (
                                    <div className="flex items-center gap-2 mt-1 text-xs">
                                      {t.phone && (
                                        <>
                                          <a href={`tel:${t.phone}`} className="text-blue-600 flex items-center gap-0.5">
                                            <Phone size={10} /> {t.phone}
                                          </a>
                                          <a href={`https://api.whatsapp.com/send?phone=91${t.phone.replace(/\D/g, '').slice(-10)}`}
                                            target="_blank" rel="noopener"
                                            className="text-green-600 flex items-center gap-0.5 hover:underline">
                                            <MessageCircle size={10} /> WhatsApp
                                          </a>
                                        </>
                                      )}
                                    </div>
                                  ) : null;
                                })()}
                              </div>
                              <div>
                                <label className="text-[10px] text-gray-500 font-medium">Freight Rate (₹/MT)</label>
                                <input type="number" value={editFreightRate} onChange={e => setEditFreightRate(e.target.value)}
                                  placeholder="Negotiated rate" className="input-field text-xs w-full" />
                                {editFreightRate && dr.quantity > 0 && (
                                  <p className="text-[10px] text-green-700 font-medium mt-0.5">
                                    Total freight: ₹{(parseFloat(editFreightRate) * dr.quantity).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                                    <span className="text-gray-400"> ({dr.quantity} {dr.unit} × ₹{editFreightRate})</span>
                                  </p>
                                )}
                                {editDistanceKm && editFreightRate && (
                                  <p className="text-[10px] text-gray-400 mt-0.5">
                                    ₹{(parseFloat(editFreightRate) / parseFloat(editDistanceKm) * 1000).toFixed(1)}/MT/1000km
                                  </p>
                                )}
                              </div>
                            </div>

                            <button onClick={() => saveLogistics(dr.id)}
                              disabled={!!actionLoading}
                              className="w-full py-2 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700 disabled:opacity-50 flex items-center justify-center gap-2">
                              {actionLoading === dr.id ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                              Save Logistics Details
                            </button>
                          </div>
                        ) : (
                          /* View mode */
                          <div className="bg-white rounded-lg border p-3">
                            <div className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1">
                              <Truck size={12} /> Logistics Details
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                              <div>
                                <span className="text-gray-400">Destination</span>
                                <p className="font-medium">{dr.destination || customerAddr || '—'}</p>
                                {(dr.destination || customerAddr) && (
                                  <a href={getMapUrl(dr.destination || customerAddr)} target="_blank" rel="noopener"
                                    className="text-blue-600 text-[10px] hover:underline flex items-center gap-0.5 mt-0.5">
                                    <Navigation size={9} /> View on Maps
                                  </a>
                                )}
                              </div>
                              <div>
                                <span className="text-gray-400">Distance</span>
                                <p className="font-medium">{dr.distanceKm ? `${dr.distanceKm} km` : '—'}</p>
                              </div>
                              <div>
                                <span className="text-gray-400">Transporter</span>
                                <p className="font-medium">{dr.transporterName || '—'}</p>
                              </div>
                              <div>
                                <span className="text-gray-400">Rate</span>
                                <p className="font-medium">{dr.freightRate ? `₹${dr.freightRate}/MT` : '—'}</p>
                              </div>
                              <div>
                                <span className="text-gray-400">Total Freight</span>
                                <p className="font-bold">{dr.freightRate && dr.quantity ? `₹${(dr.freightRate * dr.quantity).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'}</p>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Edit button */}
                        {!isEditing && !['DISPATCHED', 'COMPLETED'].includes(dr.status) && (
                          <button onClick={() => startEditDR(dr)}
                            className="text-xs text-orange-600 font-medium hover:underline flex items-center gap-1">
                            ✏️ {step === 'NEW' ? 'Set logistics details' : 'Edit logistics details'}
                          </button>
                        )}

                        {/* ── Trucks ── */}
                        {shipments.length > 0 && (
                          <div>
                            <div className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1">
                              <Truck size={12} /> Trucks ({shipments.length})
                            </div>
                            <div className="space-y-2">
                              {shipments.map(s => {
                                const netKg = s.weightNet || (s.weightGross && s.weightTare ? s.weightGross - s.weightTare : null);
                                const isExpTruck = expandedTruck === s.id;
                                const docs = (s as any).documents || [];
                                const DOC_TYPES = [
                                  { key: 'GR_BILTY', label: 'GR / Bilty', icon: '📄' },
                                  { key: 'CHALLAN', label: 'Challan', icon: '📋', auto: true },
                                  { key: 'EWAY_BILL', label: 'E-Way Bill', icon: '🚛', auto: true },
                                  { key: 'INVOICE', label: 'Invoice', icon: '💰' },
                                  { key: 'INSURANCE', label: 'Insurance', icon: '🛡️' },
                                  { key: 'POD', label: 'POD', icon: '✅' },
                                  { key: 'OTHER', label: 'Other', icon: '📎' },
                                ];
                                return (
                                  <div key={s.id} className="bg-white rounded-lg border">
                                    {/* Header */}
                                    <div className="p-3 cursor-pointer" onClick={() => setExpandedTruck(isExpTruck ? null : s.id)}>
                                      <div className="flex items-center justify-between mb-1">
                                        <div className="flex items-center gap-2">
                                          <span className="font-bold text-sm">{s.vehicleNo}</span>
                                          {s.driverName && <span className="text-xs text-gray-500">{s.driverName}</span>}
                                          {s.driverMobile && (
                                            <a href={`tel:${s.driverMobile}`} onClick={e => e.stopPropagation()} className="text-blue-600"><Phone size={10} /></a>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                          {netKg && <span className="text-xs font-bold text-green-700">{(netKg / 1000).toFixed(2)} MT</span>}
                                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                            ['RELEASED', 'EXITED'].includes(s.status) ? 'bg-green-100 text-green-700' :
                                            s.status === 'LOADING' ? 'bg-amber-100 text-amber-700' :
                                            s.status === 'GROSS_WEIGHED' ? 'bg-orange-100 text-orange-700' :
                                            'bg-blue-100 text-blue-700'
                                          }`}>{s.status.replace(/_/g, ' ')}</span>
                                          <ChevronDown size={14} className={`text-gray-400 transition ${isExpTruck ? 'rotate-180' : ''}`} />
                                        </div>
                                      </div>
                                      <div className="flex gap-0.5 mt-1">
                                        {['GATE_IN', 'TARE_WEIGHED', 'LOADING', 'GROSS_WEIGHED', 'RELEASED', 'EXITED'].map((st, i) => {
                                          const idx = ['GATE_IN', 'TARE_WEIGHED', 'LOADING', 'GROSS_WEIGHED', 'RELEASED', 'EXITED'].indexOf(s.status);
                                          return <div key={st} className={`h-1 flex-1 rounded-full ${i <= idx ? 'bg-green-500' : 'bg-gray-200'}`} />;
                                        })}
                                      </div>
                                    </div>

                                    {/* Documents section (expanded) */}
                                    {isExpTruck && (
                                      <div className="border-t px-3 pb-3 pt-2">
                                        <div className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1">
                                          <FileText size={12} /> Documents & Actions
                                        </div>

                                        {/* Quick action buttons for auto-generated docs */}
                                        <div className="flex gap-2 mb-3 flex-wrap">
                                          <button onClick={(e) => { e.stopPropagation(); const token = localStorage.getItem('token'); window.open(`/api/shipments/${s.id}/challan-pdf?token=${token}`, '_blank'); }}
                                            className="px-2 py-1 text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 flex items-center gap-1">
                                            <FileText size={10} /> View Challan
                                          </button>
                                          {s.ewayBill ? (
                                            <span className="px-2 py-1 text-[11px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg">
                                              EWB: {s.ewayBill}
                                            </span>
                                          ) : (
                                            <button onClick={async (e) => {
                                                e.stopPropagation();
                                                try {
                                                  setActionLoading(s.id + '_ewb');
                                                  const r = await api.post(`/shipments/${s.id}/eway-bill`);
                                                  flash('ok', `E-Way Bill: ${r.data.ewayBillNo}`);
                                                  load();
                                                } catch (e: any) {
                                                  flash('err', e.response?.data?.error || 'E-Way Bill failed');
                                                }
                                                finally {
                                                  setActionLoading(null);
                                                }
                                              }}
                                              disabled={!!actionLoading}
                                              className="px-2 py-1 text-[11px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100 flex items-center gap-1">
                                              {actionLoading === s.id + '_ewb' ? <Loader2 size={10} className="animate-spin" /> : <Truck size={10} />} Generate E-Way Bill
                                            </button>
                                          )}
                                        </div>

                                        {/* Document list */}
                                        {docs.length > 0 && (
                                          <div className="space-y-1 mb-2">
                                            {docs.map((d: any) => (
                                              <div key={d.id} className="flex items-center justify-between bg-gray-50 rounded px-2 py-1.5">
                                                <div className="flex items-center gap-2">
                                                  <span className="text-[10px] font-semibold text-gray-500 uppercase bg-gray-200 px-1.5 py-0.5 rounded">{d.docType.replace(/_/g, ' ')}</span>
                                                  <span className="text-xs text-gray-700 truncate max-w-[150px]">{d.fileName}</span>
                                                </div>
                                                <button onClick={(e) => { e.stopPropagation(); const token = localStorage.getItem('token'); window.open(`/api/shipment-documents/file/${d.id}?token=${token}`, '_blank'); }}
                                                  className="text-blue-600 text-[10px] font-medium hover:underline">View</button>
                                              </div>
                                            ))}
                                          </div>
                                        )}

                                        {/* Upload buttons by doc type */}
                                        <div className="flex gap-1.5 flex-wrap">
                                          {DOC_TYPES.map(dt => (
                                            <button key={dt.key} onClick={(e) => { e.stopPropagation(); uploadDoc(s.id, dt.key); }}
                                              disabled={uploadingDoc === s.id}
                                              className="px-2 py-1 text-[10px] font-medium bg-gray-100 text-gray-600 rounded hover:bg-gray-200 border flex items-center gap-1">
                                              {uploadingDoc === s.id ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />} {dt.label}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Add truck */}
                        {!['DISPATCHED', 'COMPLETED', 'CANCELLED'].includes(dr.status) && (
                          truckFormDR === dr.id ? (
                            <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs font-bold text-blue-800">Add Truck Details</span>
                                <button onClick={() => setTruckFormDR(null)} className="text-gray-400"><X size={14} /></button>
                              </div>
                              <p className="text-[10px] text-gray-500 mb-2">Transporter provides vehicle/driver details ~1hr before arrival at factory</p>
                              <div className="grid grid-cols-3 gap-2 mb-2">
                                <input value={truckVehicle} onChange={e => setTruckVehicle(e.target.value)}
                                  placeholder="Vehicle No *" className="input-field text-xs" autoFocus />
                                <input value={truckDriver} onChange={e => setTruckDriver(e.target.value)}
                                  placeholder="Driver Name" className="input-field text-xs" />
                                <input value={truckMobile} onChange={e => setTruckMobile(e.target.value)}
                                  placeholder="Driver Mobile" className="input-field text-xs" />
                              </div>
                              <button onClick={() => assignTruck(dr.id)}
                                disabled={!!actionLoading}
                                className="w-full py-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1">
                                {actionLoading === dr.id + '_truck' ? <Loader2 size={12} className="animate-spin" /> : <Truck size={12} />}
                                Register for Gate Entry
                              </button>
                            </div>
                          ) : (
                            <button onClick={() => setTruckFormDR(dr.id)}
                              className="w-full py-2 border-2 border-dashed border-blue-300 rounded-lg text-blue-600 text-xs font-medium hover:bg-blue-50 flex items-center justify-center gap-1">
                              <Plus size={14} /> Add Truck (from transporter, ~1hr before arrival)
                            </button>
                          )
                        )}

                        {/* Bottom actions */}
                        <div className="flex gap-2 flex-wrap pt-2 border-t">
                          <button onClick={() => shareDR(dr)}
                            className="px-3 py-1.5 text-green-700 text-xs font-medium rounded-lg border border-green-300 hover:bg-green-50 flex items-center gap-1">
                            <Share2 size={12} /> Share
                          </button>
                          {!['DISPATCHED', 'COMPLETED'].includes(dr.status) && (
                            <button onClick={async () => {
                              if (!confirm(`Delete DR #${dr.drNo}?`)) return;
                              try {
                                await api.delete(`/dispatch-requests/${dr.id}`);
                                flash('ok', `DR #${dr.drNo} deleted`);
                                load();
                              } catch (e: any) { flash('err', e.response?.data?.error || 'Failed'); }
                            }}
                              className="px-3 py-1.5 text-red-600 text-xs font-medium rounded-lg border border-red-200 hover:bg-red-50 flex items-center gap-1 ml-auto">
                              <Trash2 size={12} /> Delete
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>)}

        {/* ── INBOUND ── */}
        {direction === 'INBOUND' && (
          <>
            {loading ? (
              <div className="text-center py-12 text-gray-400"><Loader2 size={32} className="animate-spin mx-auto mb-2" /></div>
            ) : grainTrucks.length === 0 ? (
              <div className="text-center py-12">
                <Truck size={48} className="mx-auto text-gray-300 mb-3" />
                <p className="text-gray-500 text-sm">No grain trucks today</p>
              </div>
            ) : (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Today's Grain Trucks ({grainTrucks.length})</h3>
                {grainTrucks.map(t => (
                  <div key={t.id} className="bg-white rounded-lg border p-3 hover:shadow-sm transition">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-bold text-sm">{t.vehicleNo}</span>
                        {t.vendorName && <span className="text-xs text-gray-500 ml-2">{t.vendorName}</span>}
                      </div>
                      <span className="text-sm font-bold text-teal-700">{(t.weightNet / 1000).toFixed(2)} MT</span>
                    </div>
                    <div className="flex gap-4 mt-1 text-xs text-gray-500">
                      <span>Gross: {(t.weightGross / 1000).toFixed(2)} MT</span>
                      <span>Tare: {(t.weightTare / 1000).toFixed(2)} MT</span>
                      {t.quarantineWeight ? <span className="text-red-600">Quarantine: {(t.quarantineWeight / 1000).toFixed(2)} MT</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
