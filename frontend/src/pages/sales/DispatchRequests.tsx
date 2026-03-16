import { useState, useEffect } from 'react';
import { Truck, Plus, Share2, Loader2, ChevronDown, Check, AlertCircle } from 'lucide-react';
import api from '../../services/api';

interface DispatchRequest {
  id: string;
  drNo: string;
  customerId: string;
  customerName: string;
  productName: string;
  quantity: number;
  unit: string;
  status: string;
  logisticsInfo?: {
    vehicles?: Array<{ vehicleNo: string; capacity: number }>;
    destination?: string;
    expectedDelivery?: string;
  };
  createdAt: string;
}

export default function DispatchRequests() {
  const [drs, setDrs] = useState<DispatchRequest[]>([]);
  const [factoryDrs, setFactoryDrs] = useState<DispatchRequest[]>([]);
  const [activeView, setActiveView] = useState('HQ');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadDrs = async () => {
    try {
      setLoading(true);
      const response = await api.get('/dispatch-requests');
      setDrs(response.data.dispatchRequests || response.data);
    } catch (error) {
      setMsg({ type: 'err', text: 'Failed to load dispatch requests' });
    } finally {
      setLoading(false);
    }
  };

  const loadFactoryDrs = async () => {
    try {
      setLoading(true);
      const response = await api.get('/dispatch-requests/factory');
      setFactoryDrs(response.data.dispatchRequests || response.data);
    } catch (error) {
      setMsg({ type: 'err', text: 'Failed to load factory dispatch requests' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeView === 'HQ') {
      loadDrs();
    } else {
      loadFactoryDrs();
    }
  }, [activeView]);

  const currentDrs = activeView === 'HQ' ? drs : factoryDrs;

  const getStatusColor = (status: string) => {
    const colors: { [key: string]: string } = {
      PENDING: 'bg-gray-100 text-gray-700',
      ACCEPTED: 'bg-blue-100 text-blue-700',
      VEHICLE_ASSIGNED: 'bg-purple-100 text-purple-700',
      LOADING: 'bg-amber-100 text-amber-700',
      DISPATCHED: 'bg-green-100 text-green-700',
      COMPLETED: 'bg-emerald-100 text-emerald-700',
    };
    return colors[status] || 'bg-gray-100 text-gray-700';
  };

  const shareDrOnWhatsApp = (dr: DispatchRequest) => {
    const vehicleInfo = dr.logisticsInfo?.vehicles
      ? dr.logisticsInfo.vehicles.map(v => `${v.vehicleNo}`).join(', ')
      : 'Not assigned';

    const text = `*Dispatch Request - ${dr.drNo}*\n\n` +
      `📍 Customer: ${dr.customerName}\n` +
      `📦 Product: ${dr.productName}\n` +
      `⚖️ Quantity: ${dr.quantity} ${dr.unit}\n` +
      `🚗 Vehicles: ${vehicleInfo}\n` +
      (dr.logisticsInfo?.destination ? `🗺️ Destination: ${dr.logisticsInfo.destination}\n` : '') +
      (dr.logisticsInfo?.expectedDelivery ? `📅 Expected Delivery: ${dr.logisticsInfo.expectedDelivery}\n` : '') +
      `Status: ${dr.status}`;

    if (navigator.share) {
      navigator.share({ text }).catch(() => {});
    } else {
      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
    }
  };

  async function updateDrStatus(drId: string, newStatus: string) {
    try {
      await api.put(`/dispatch-requests/${drId}`, { status: newStatus });
      setMsg({ type: 'ok', text: `Status updated to ${newStatus}` });
      if (activeView === 'HQ') {
        loadDrs();
      } else {
        loadFactoryDrs();
      }
    } catch (error) {
      setMsg({ type: 'err', text: 'Failed to update status' });
    }
  }

  const getNextActions = (status: string) => {
    const actions: { [key: string]: { label: string; nextStatus: string } | null } = {
      PENDING: { label: 'Accept', nextStatus: 'ACCEPTED' },
      ACCEPTED: { label: 'Assign Vehicles', nextStatus: 'VEHICLE_ASSIGNED' },
      VEHICLE_ASSIGNED: { label: 'Start Loading', nextStatus: 'LOADING' },
      LOADING: { label: 'Dispatched', nextStatus: 'DISPATCHED' },
      DISPATCHED: { label: 'Complete', nextStatus: 'COMPLETED' },
      COMPLETED: null,
    };
    return actions[status];
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-600 to-orange-700 text-white">
        <div className="max-w-5xl mx-auto px-4 py-4 md:py-6">
          <div className="flex items-center gap-3 mb-3">
            <Truck size={32} />
            <h1 className="text-2xl md:text-3xl font-bold">Dispatch Requests</h1>
          </div>

          {/* View Toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setActiveView('HQ')}
              className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${activeView === 'HQ'
                ? 'bg-white text-orange-600'
                : 'bg-orange-500 hover:bg-orange-600 text-white'
                }`}
            >
              HQ View
            </button>
            <button
              onClick={() => setActiveView('Factory')}
              className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${activeView === 'Factory'
                ? 'bg-white text-orange-600'
                : 'bg-orange-500 hover:bg-orange-600 text-white'
                }`}
            >
              Factory View
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-4 py-6">
        {msg && (
          <div className={`rounded-lg p-3 mb-4 text-sm ${msg.type === 'ok'
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
            {msg.text}
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="text-center py-8 text-gray-400">
            <Loader2 size={32} className="animate-spin mx-auto mb-2" />
            Loading dispatch requests...
          </div>
        )}

        {/* Dispatch Requests List */}
        {!loading && currentDrs.length > 0 && (
          <div className="space-y-3">
            {currentDrs.map(dr => {
              const nextAction = getNextActions(dr.status);
              return (
                <div
                  key={dr.id}
                  className="bg-white border rounded-lg shadow-sm hover:shadow-md transition-shadow"
                >
                  {/* DR Header */}
                  <button
                    onClick={() => setExpandedId(expandedId === dr.id ? null : dr.id)}
                    className="w-full p-4 text-left hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-bold text-sm text-gray-900">DR #{dr.drNo || dr.id.slice(-6)}</h3>
                          <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded ${getStatusColor(dr.status)}`}>
                            {dr.status}
                          </span>
                        </div>
                        <p className="text-xs text-gray-600">{dr.customerName}</p>
                      </div>
                      <ChevronDown
                        size={16}
                        className={`text-gray-400 transition-transform ${expandedId === dr.id ? 'rotate-180' : ''}`}
                      />
                    </div>

                    {/* Quick Info */}
                    <div className="flex flex-wrap gap-2 items-center text-xs text-gray-600">
                      <span className="font-medium">{dr.productName}</span>
                      <span>•</span>
                      <span className="font-semibold text-orange-600">{dr.quantity} {dr.unit}</span>
                    </div>
                  </button>

                  {/* Expanded Details */}
                  {expandedId === dr.id && (
                    <div className="px-4 pb-4 border-t pt-3 bg-gray-50">
                      <div className="space-y-3 text-sm mb-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-gray-500 text-xs">Product</p>
                            <p className="text-gray-700 font-medium">{dr.productName}</p>
                          </div>
                          <div>
                            <p className="text-gray-500 text-xs">Quantity</p>
                            <p className="text-gray-700 font-medium">{dr.quantity} {dr.unit}</p>
                          </div>
                        </div>

                        {dr.logisticsInfo?.destination && (
                          <div>
                            <p className="text-gray-500 text-xs">Destination</p>
                            <p className="text-gray-700 font-medium">{dr.logisticsInfo.destination}</p>
                          </div>
                        )}

                        {dr.logisticsInfo?.vehicles && dr.logisticsInfo.vehicles.length > 0 && (
                          <div>
                            <p className="text-gray-500 text-xs mb-1">Assigned Vehicles</p>
                            <div className="space-y-1">
                              {dr.logisticsInfo.vehicles.map((v, idx) => (
                                <div key={idx} className="bg-white rounded px-2 py-1 text-xs">
                                  <span className="font-medium">{v.vehicleNo}</span>
                                  {v.capacity && <span className="text-gray-500 ml-2">({v.capacity} MT)</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {dr.logisticsInfo?.expectedDelivery && (
                          <div>
                            <p className="text-gray-500 text-xs">Expected Delivery</p>
                            <p className="text-gray-700 font-medium">
                              {new Date(dr.logisticsInfo.expectedDelivery).toLocaleDateString('en-IN')}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Action Buttons */}
                      <div className="flex flex-wrap gap-2 pt-3 border-t">
                        {/* WhatsApp Share Button */}
                        <button
                          onClick={() => shareDrOnWhatsApp(dr)}
                          className="flex-1 min-w-[120px] py-2 text-xs font-medium text-green-600 hover:bg-green-50 rounded flex items-center justify-center gap-1"
                        >
                          <Share2 size={14} /> Share
                        </button>

                        {/* Factory View - Status Update Button */}
                        {activeView === 'Factory' && nextAction && (
                          <button
                            onClick={() => updateDrStatus(dr.id, nextAction.nextStatus)}
                            className="flex-1 min-w-[120px] py-2 text-xs font-medium text-white bg-orange-600 hover:bg-orange-700 rounded flex items-center justify-center gap-1"
                          >
                            <Check size={14} /> {nextAction.label}
                          </button>
                        )}

                        {/* HQ View - View Only */}
                        {activeView === 'HQ' && dr.status === 'COMPLETED' && (
                          <div className="flex-1 min-w-[120px] py-2 text-xs font-medium text-emerald-600 rounded flex items-center justify-center gap-1 bg-emerald-50">
                            <Check size={14} /> Completed
                          </div>
                        )}
                      </div>

                      {/* Status Timeline */}
                      <div className="mt-3 pt-3 border-t">
                        <p className="text-xs font-semibold text-gray-600 mb-2">Status Timeline</p>
                        <div className="space-y-1 text-xs">
                          {['PENDING', 'ACCEPTED', 'VEHICLE_ASSIGNED', 'LOADING', 'DISPATCHED', 'COMPLETED'].map(
                            (s, idx, arr) => {
                              const isCompleted =
                                ['PENDING', 'ACCEPTED', 'VEHICLE_ASSIGNED', 'LOADING', 'DISPATCHED', 'COMPLETED'].indexOf(
                                  dr.status
                                ) >= idx;
                              const isCurrent = s === dr.status;

                              return (
                                <div key={s} className="flex items-center gap-2">
                                  <div
                                    className={`w-2 h-2 rounded-full ${isCurrent ? 'bg-orange-600' : isCompleted ? 'bg-green-600' : 'bg-gray-300'
                                      }`}
                                  />
                                  <span className={`${isCurrent ? 'font-semibold text-orange-600' : isCompleted ? 'text-green-600' : 'text-gray-400'
                                    }`}>
                                    {s.replace(/_/g, ' ')}
                                  </span>
                                </div>
                              );
                            }
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Empty State */}
        {!loading && currentDrs.length === 0 && (
          <div className="text-center py-12">
            <Truck size={48} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500">
              {activeView === 'HQ'
                ? 'No dispatch requests created yet.'
                : 'No incoming dispatch requests for the factory.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
