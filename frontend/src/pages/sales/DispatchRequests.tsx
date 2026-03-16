import { useState, useEffect } from 'react';
import { Truck, Share2, Loader2, ChevronDown, Check, Package, MapPin, Clock, ArrowRight, Plus, X } from 'lucide-react';
import api from '../../services/api';

interface Shipment {
  id: string; vehicleNo: string; status: string; driverName?: string; driverMobile?: string;
  weightTare?: number; weightGross?: number; weightNet?: number;
  gateInTime?: string; tareTime?: string; grossTime?: string; releaseTime?: string; exitTime?: string;
  transporterName?: string; capacityTon?: number;
}

interface DR {
  id: string; drNo: number; status: string;
  productName: string; quantity: number; unit: string;
  customerName: string; destination?: string; deliveryDate?: string;
  logisticsBy: string; transporterName?: string; vehicleCount: number;
  remarks?: string; createdAt: string;
  order?: { id: string; orderNo: string; customer?: { name: string } };
  shipments?: Shipment[];
  _count?: { shipments: number };
}

export default function DispatchRequests() {
  const [drs, setDrs] = useState<DR[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState('ACTIVE');

  // Truck assignment form
  const [showTruckForm, setShowTruckForm] = useState<string | null>(null);
  const [truckVehicleNo, setTruckVehicleNo] = useState('');
  const [truckDriver, setTruckDriver] = useState('');
  const [truckDriverMobile, setTruckDriverMobile] = useState('');
  const [truckTransporter, setTruckTransporter] = useState('');

  const load = async () => {
    try {
      setLoading(true);
      const res = await api.get('/dispatch-requests/factory');
      const all = res.data.dispatchRequests || res.data || [];
      setDrs(all);
    } catch {
      setMsg({ type: 'err', text: 'Failed to load' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const flash = (type: 'ok' | 'err', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };

  // ── Stats ──
  const scheduled = drs.filter(d => ['SCHEDULED', 'PENDING', 'ACCEPTED', 'VEHICLE_ASSIGNED'].includes(d.status));
  const loadingDrs = drs.filter(d => d.status === 'LOADING');
  const dispatched = drs.filter(d => d.status === 'DISPATCHED');
  const allActive = drs.filter(d => !['COMPLETED', 'CANCELLED'].includes(d.status));

  const trucksOnWay = scheduled.reduce((s, d) => {
    const shipCount = d.shipments?.length || d._count?.shipments || 0;
    return s + Math.max(d.vehicleCount, shipCount);
  }, 0);

  const totalQtyScheduled = scheduled.reduce((s, d) => s + d.quantity, 0);

  // ── Actions ──
  const updateStatus = async (drId: string, newStatus: string) => {
    setActionLoading(drId);
    try {
      await api.put(`/dispatch-requests/${drId}/status`, { status: newStatus });
      flash('ok', `Updated to ${newStatus.replace(/_/g, ' ')}`);
      load();
    } catch (e: any) {
      flash('err', e.response?.data?.error || 'Failed');
    } finally {
      setActionLoading(null);
    }
  };

  const assignTruck = async (drId: string) => {
    if (!truckVehicleNo.trim()) { flash('err', 'Enter vehicle number'); return; }
    setActionLoading(drId + '_truck');
    try {
      await api.post('/shipments', {
        dispatchRequestId: drId,
        vehicleNo: truckVehicleNo.trim().toUpperCase(),
        driverName: truckDriver || null,
        driverMobile: truckDriverMobile || null,
        transporterName: truckTransporter || null,
        gateInTime: new Date().toISOString(),
        productName: drs.find(d => d.id === drId)?.productName || '',
        customerName: drs.find(d => d.id === drId)?.customerName || '',
        destination: drs.find(d => d.id === drId)?.destination || '',
      });
      flash('ok', `Truck ${truckVehicleNo} assigned`);
      setShowTruckForm(null);
      setTruckVehicleNo(''); setTruckDriver(''); setTruckDriverMobile(''); setTruckTransporter('');
      load();
    } catch (e: any) {
      flash('err', e.response?.data?.error || 'Failed to assign truck');
    } finally {
      setActionLoading(null);
    }
  };

  const shareDr = (dr: DR) => {
    const trucks = dr.shipments?.map(s => s.vehicleNo).join(', ') || 'TBD';
    const text = `*Dispatch #${dr.drNo}*\n` +
      `Customer: ${dr.customerName}\n` +
      `Product: ${dr.productName} - ${dr.quantity} ${dr.unit}\n` +
      `Trucks: ${trucks}\n` +
      `Status: ${dr.status.replace(/_/g, ' ')}`;
    if (navigator.share) {
      navigator.share({ text }).catch(() => {});
    } else {
      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
    }
  };

  const getStatusStyle = (s: string) => {
    const map: Record<string, string> = {
      SCHEDULED: 'bg-blue-100 text-blue-700',
      PENDING: 'bg-gray-100 text-gray-700',
      ACCEPTED: 'bg-blue-100 text-blue-700',
      VEHICLE_ASSIGNED: 'bg-purple-100 text-purple-700',
      LOADING: 'bg-amber-100 text-amber-700',
      DISPATCHED: 'bg-green-100 text-green-700',
      COMPLETED: 'bg-emerald-100 text-emerald-700',
      CANCELLED: 'bg-red-100 text-red-700',
    };
    return map[s] || 'bg-gray-100 text-gray-700';
  };

  const getShipmentBadge = (s: string) => {
    const map: Record<string, string> = {
      GATE_IN: 'bg-blue-100 text-blue-700',
      TARE_WEIGHED: 'bg-indigo-100 text-indigo-700',
      LOADING: 'bg-amber-100 text-amber-700',
      GROSS_WEIGHED: 'bg-purple-100 text-purple-700',
      RELEASED: 'bg-green-100 text-green-700',
      EXITED: 'bg-emerald-100 text-emerald-700',
    };
    return map[s] || 'bg-gray-100 text-gray-700';
  };

  const filteredDrs = filterTab === 'ACTIVE' ? allActive :
    filterTab === 'SCHEDULED' ? scheduled :
    filterTab === 'LOADING' ? loadingDrs :
    filterTab === 'DISPATCHED' ? dispatched : drs;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-600 to-orange-700 text-white">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Truck size={28} /> Logistics & Dispatch
          </h1>

          {/* Summary Cards */}
          <div className="grid grid-cols-4 gap-3 mt-3">
            <div className="bg-white/15 rounded-lg p-2.5 text-center">
              <div className="text-2xl font-bold">{scheduled.length}</div>
              <div className="text-[10px] text-orange-100">Scheduled</div>
            </div>
            <div className="bg-white/15 rounded-lg p-2.5 text-center">
              <div className="text-2xl font-bold">{trucksOnWay}</div>
              <div className="text-[10px] text-orange-100">Trucks Expected</div>
            </div>
            <div className="bg-white/15 rounded-lg p-2.5 text-center">
              <div className="text-2xl font-bold">{loadingDrs.length}</div>
              <div className="text-[10px] text-orange-100">Loading</div>
            </div>
            <div className="bg-white/15 rounded-lg p-2.5 text-center">
              <div className="text-2xl font-bold">{totalQtyScheduled}</div>
              <div className="text-[10px] text-orange-100">{scheduled[0]?.unit || 'MT'} Pending</div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-4">
        {msg && (
          <div className={`rounded-lg p-3 mb-4 text-sm flex items-center gap-2 ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {msg.type === 'ok' ? <Check size={16} /> : <X size={16} />} {msg.text}
          </div>
        )}

        {/* Filter Tabs */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          {['ACTIVE', 'SCHEDULED', 'LOADING', 'DISPATCHED', 'ALL'].map(tab => (
            <button key={tab} onClick={() => setFilterTab(tab)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition ${
                filterTab === tab ? 'bg-orange-600 text-white' : 'bg-white text-gray-600 border hover:bg-gray-50'
              }`}>
              {tab === 'ACTIVE' ? `Active (${allActive.length})` :
               tab === 'SCHEDULED' ? `Scheduled (${scheduled.length})` :
               tab === 'LOADING' ? `Loading (${loadingDrs.length})` :
               tab === 'DISPATCHED' ? `Dispatched (${dispatched.length})` :
               `All (${drs.length})`}
            </button>
          ))}
        </div>

        {/* Loading */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">
            <Loader2 size={32} className="animate-spin mx-auto mb-2" />
          </div>
        ) : filteredDrs.length === 0 ? (
          <div className="text-center py-12">
            <Truck size={48} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 text-sm">No dispatch requests</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredDrs.map(dr => {
              const isExpanded = expandedId === dr.id;
              const shipments = dr.shipments || [];
              const isScheduled = ['SCHEDULED', 'PENDING', 'ACCEPTED', 'VEHICLE_ASSIGNED'].includes(dr.status);

              return (
                <div key={dr.id} className="bg-white rounded-lg border shadow-sm hover:shadow-md transition">
                  {/* Card Header */}
                  <button onClick={() => setExpandedId(isExpanded ? null : dr.id)} className="w-full p-4 text-left">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-gray-900">DR #{dr.drNo}</span>
                          <span className="text-xs text-gray-400">SO #{dr.order?.orderNo}</span>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${getStatusStyle(dr.status)}`}>
                            {dr.status.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <p className="text-sm text-gray-700 font-medium">{dr.customerName}</p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <Package size={12} /> {dr.productName} · {dr.quantity} {dr.unit}
                          </span>
                          {dr.destination && (
                            <span className="flex items-center gap-1">
                              <MapPin size={12} /> {dr.destination.slice(0, 30)}
                            </span>
                          )}
                          {dr.deliveryDate && (
                            <span className="flex items-center gap-1">
                              <Clock size={12} /> {new Date(dr.deliveryDate).toLocaleDateString('en-IN')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right ml-4 shrink-0">
                        <div className="text-sm font-bold text-orange-600">
                          {shipments.length} truck{shipments.length !== 1 ? 's' : ''}
                        </div>
                        <ChevronDown size={16} className={`text-gray-400 ml-auto transition ${isExpanded ? 'rotate-180' : ''}`} />
                      </div>
                    </div>

                    {/* Mini Progress */}
                    <div className="flex items-center gap-1 mt-2.5">
                      <div className={`h-1.5 flex-1 rounded-full ${isScheduled ? 'bg-blue-400' : 'bg-green-500'}`} />
                      <div className={`h-1.5 flex-1 rounded-full ${dr.status === 'LOADING' ? 'bg-amber-400 animate-pulse' : ['DISPATCHED', 'COMPLETED'].includes(dr.status) ? 'bg-green-500' : 'bg-gray-200'}`} />
                      <div className={`h-1.5 flex-1 rounded-full ${['DISPATCHED', 'COMPLETED'].includes(dr.status) ? 'bg-green-500' : 'bg-gray-200'}`} />
                    </div>
                  </button>

                  {/* Expanded */}
                  {isExpanded && (
                    <div className="border-t bg-gray-50 p-4 space-y-3">
                      {/* Trucks */}
                      {shipments.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1">
                            <Truck size={12} /> Trucks ({shipments.length})
                          </div>
                          <div className="space-y-2">
                            {shipments.map(s => (
                              <div key={s.id} className="bg-white rounded-lg border p-3">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="font-bold text-sm">{s.vehicleNo}</span>
                                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${getShipmentBadge(s.status)}`}>
                                    {s.status.replace(/_/g, ' ')}
                                  </span>
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-xs text-gray-500">
                                  {s.driverName && <span>Driver: {s.driverName}</span>}
                                  {s.transporterName && <span>Transporter: {s.transporterName}</span>}
                                  {s.weightNet ? (
                                    <span className="font-medium text-green-700">Net: {(s.weightNet / 1000).toFixed(2)} MT</span>
                                  ) : s.weightTare ? (
                                    <span>Tare: {s.weightTare} kg</span>
                                  ) : null}
                                </div>
                                {/* Weighbridge progress */}
                                <div className="flex gap-1 mt-2">
                                  {['GATE_IN', 'TARE_WEIGHED', 'LOADING', 'GROSS_WEIGHED', 'RELEASED', 'EXITED'].map((step, i) => {
                                    const stepIdx = ['GATE_IN', 'TARE_WEIGHED', 'LOADING', 'GROSS_WEIGHED', 'RELEASED', 'EXITED'].indexOf(s.status);
                                    return (
                                      <div key={step} className={`h-1 flex-1 rounded-full ${i <= stepIdx ? 'bg-green-500' : 'bg-gray-200'}`} />
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Add Truck (for scheduled DRs) */}
                      {isScheduled && showTruckForm !== dr.id && (
                        <button onClick={() => setShowTruckForm(dr.id)}
                          className="w-full py-2 border-2 border-dashed border-blue-300 rounded-lg text-blue-600 text-xs font-medium hover:bg-blue-50 flex items-center justify-center gap-1">
                          <Plus size={14} /> Add Truck
                        </button>
                      )}

                      {showTruckForm === dr.id && (
                        <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-blue-700">Assign Truck</span>
                            <button onClick={() => setShowTruckForm(null)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
                          </div>
                          <div className="grid grid-cols-2 gap-2 mb-2">
                            <input value={truckVehicleNo} onChange={e => setTruckVehicleNo(e.target.value)}
                              placeholder="Vehicle No *" className="input-field text-xs" />
                            <input value={truckDriver} onChange={e => setTruckDriver(e.target.value)}
                              placeholder="Driver Name" className="input-field text-xs" />
                            <input value={truckDriverMobile} onChange={e => setTruckDriverMobile(e.target.value)}
                              placeholder="Driver Mobile" className="input-field text-xs" />
                            <input value={truckTransporter} onChange={e => setTruckTransporter(e.target.value)}
                              placeholder="Transporter" className="input-field text-xs" />
                          </div>
                          <button onClick={() => assignTruck(dr.id)}
                            disabled={actionLoading === dr.id + '_truck'}
                            className="w-full py-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1">
                            {actionLoading === dr.id + '_truck' ? <Loader2 size={14} className="animate-spin" /> : <Truck size={14} />}
                            Gate In Truck
                          </button>
                        </div>
                      )}

                      {/* Details */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        <div><span className="text-gray-500">Logistics</span><br/><span className="font-medium">{dr.logisticsBy}</span></div>
                        {dr.transporterName && <div><span className="text-gray-500">Transporter</span><br/><span className="font-medium">{dr.transporterName}</span></div>}
                        <div><span className="text-gray-500">Vehicles Expected</span><br/><span className="font-medium">{dr.vehicleCount || '-'}</span></div>
                        {dr.remarks && <div className="col-span-2"><span className="text-gray-500">Remarks</span><br/><span className="font-medium">{dr.remarks}</span></div>}
                      </div>

                      {/* Action Buttons */}
                      <div className="flex gap-2 flex-wrap pt-2 border-t">
                        {/* Start Loading */}
                        {isScheduled && shipments.length > 0 && (
                          <button onClick={() => updateStatus(dr.id, 'LOADING')}
                            disabled={!!actionLoading}
                            className="px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 flex items-center gap-2 disabled:opacity-50">
                            {actionLoading === dr.id ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                            Start Loading
                          </button>
                        )}

                        {/* Mark Dispatched */}
                        {dr.status === 'LOADING' && (
                          <button onClick={() => updateStatus(dr.id, 'DISPATCHED')}
                            disabled={!!actionLoading}
                            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 flex items-center gap-2 disabled:opacity-50">
                            {actionLoading === dr.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                            Mark Dispatched
                          </button>
                        )}

                        {/* Complete */}
                        {dr.status === 'DISPATCHED' && (
                          <button onClick={() => updateStatus(dr.id, 'COMPLETED')}
                            disabled={!!actionLoading}
                            className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 flex items-center gap-2 disabled:opacity-50">
                            {actionLoading === dr.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                            Complete
                          </button>
                        )}

                        {/* Share */}
                        <button onClick={() => shareDr(dr)}
                          className="px-3 py-2 text-green-700 text-sm font-medium rounded-lg border border-green-300 hover:bg-green-50 flex items-center gap-1">
                          <Share2 size={14} /> Share
                        </button>

                        {/* Cancel */}
                        {!['COMPLETED', 'CANCELLED', 'DISPATCHED'].includes(dr.status) && (
                          <button onClick={() => { if (confirm('Cancel this dispatch?')) updateStatus(dr.id, 'CANCELLED'); }}
                            className="px-3 py-2 text-red-600 text-sm font-medium rounded-lg border border-red-200 hover:bg-red-50 flex items-center gap-1">
                            <X size={14} /> Cancel
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
      </div>
    </div>
  );
}
