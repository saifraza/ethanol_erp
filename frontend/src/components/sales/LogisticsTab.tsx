import { useState, useEffect } from 'react';
import { Truck, Plus, X, Loader2, MapPin, Save } from 'lucide-react';
import api from '../../services/api';
import type { SalesOrder, DR, Transporter } from './types';

interface Props {
  order: SalesOrder;
  drs: DR[];
  flash: (type: 'ok' | 'err', text: string) => void;
  onRefresh: () => void;
}

// Factory coordinates (MSPIL, Narsinghpur)
const FACTORY = { lat: 22.9453, lng: 79.1903 };

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
    if (data.routes?.length > 0) {
      return {
        distanceKm: Math.round(data.routes[0].distance / 1000),
        durationHrs: Math.round(data.routes[0].duration / 3600 * 10) / 10,
      };
    }
    return null;
  } catch { return null; }
}

const inputCls = 'border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400';

export default function LogisticsTab({ order, drs, flash, onRefresh }: Props) {
  const [transporters, setTransporters] = useState<Transporter[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Logistics edit state
  const [editingDR, setEditingDR] = useState<string | null>(null);
  const [editTransporterId, setEditTransporterId] = useState('');
  const [editFreightRate, setEditFreightRate] = useState('');
  const [editDistanceKm, setEditDistanceKm] = useState('');
  const [editDestination, setEditDestination] = useState('');
  const [editVehicleCount, setEditVehicleCount] = useState('1');
  const [calcLoading, setCalcLoading] = useState(false);

  // Truck assignment state
  const [truckFormDR, setTruckFormDR] = useState<string | null>(null);
  const [truckRows, setTruckRows] = useState<{ vehicle: string; driver: string; mobile: string }[]>([{ vehicle: '', driver: '', mobile: '' }]);
  const [truckEtaDays, setTruckEtaDays] = useState('0');

  useEffect(() => {
    api.get('/transporters').then(res => setTransporters(res.data.transporters || res.data || [])).catch(() => {});
  }, []);

  const isSeller = order.logisticsBy === 'SELLER';
  const activeDR = drs.find(d => !['CANCELLED', 'COMPLETED'].includes(d.status));

  const startEdit = (dr: DR) => {
    setEditingDR(dr.id);
    setEditTransporterId(dr.transporterId || '');
    setEditFreightRate(dr.freightRate ? String(dr.freightRate) : '');
    setEditDistanceKm(dr.distanceKm ? String(dr.distanceKm) : '');
    setEditDestination(dr.destination || order.deliveryAddress || '');
    setEditVehicleCount(dr.vehicleCount ? String(dr.vehicleCount) : '1');
  };

  const saveLogistics = async (drId: string) => {
    setActionLoading(drId);
    try {
      const transporter = transporters.find(t => t.id === editTransporterId);
      await api.put(`/dispatch-requests/${drId}`, {
        transporterId: editTransporterId || null,
        transporterName: transporter?.name || null,
        freightRate: editFreightRate ? parseFloat(editFreightRate) : null,
        distanceKm: editDistanceKm ? parseFloat(editDistanceKm) : null,
        destination: editDestination,
        vehicleCount: parseInt(editVehicleCount) || 1,
      });
      flash('ok', 'Logistics details saved');
      setEditingDR(null);
      onRefresh();
    } catch (e: any) { flash('err', e.response?.data?.error || 'Failed'); }
    finally { setActionLoading(null); }
  };

  const handleCalcDistance = async () => {
    if (!editDestination) { flash('err', 'Enter destination first'); return; }
    setCalcLoading(true);
    const result = await calcDistance(editDestination);
    if (result) {
      setEditDistanceKm(String(result.distanceKm));
      flash('ok', `Distance: ${result.distanceKm} km (~${result.durationHrs} hrs)`);
    } else {
      flash('err', 'Could not calculate distance. Check address spelling.');
    }
    setCalcLoading(false);
  };

  const assignTruck = async (drId: string) => {
    const validRows = truckRows.filter(r => r.vehicle.trim());
    if (validRows.length === 0) { flash('err', 'Enter at least one vehicle number'); return; }
    setActionLoading(drId + '_truck');
    try {
      const dr = drs.find(d => d.id === drId);
      const etaLabel = truckEtaDays === '0' ? 'Same day' : truckEtaDays === '4' ? '4+ days' : `${truckEtaDays} day${truckEtaDays === '1' ? '' : 's'}`;
      for (const row of validRows) {
        const vehicles = row.vehicle.split(',').map(v => v.trim().toUpperCase()).filter(Boolean);
        for (const veh of vehicles) {
          await api.post('/shipments', {
            dispatchRequestId: drId, vehicleNo: veh, driverName: row.driver || null,
            driverMobile: row.mobile || null, transporterName: dr?.transporterName || '',
            gateInTime: new Date().toISOString(), productName: dr?.quantity ? 'DDGS' : '',
            customerName: order.customerName, destination: dr?.destination || order.deliveryAddress || '',
            remarks: `ETA: ${etaLabel}`,
          });
        }
      }
      const totalVehicles = validRows.reduce((sum, r) => sum + r.vehicle.split(',').filter(v => v.trim()).length, 0);
      flash('ok', `${totalVehicles} truck${totalVehicles > 1 ? 's' : ''} registered`);
      setTruckFormDR(null);
      setTruckRows([{ vehicle: '', driver: '', mobile: '' }]);
      setTruckEtaDays('0');
      onRefresh();
    } catch (e: any) { flash('err', e.response?.data?.error || 'Failed'); }
    finally { setActionLoading(null); }
  };

  // No DR yet — show "send to logistics" button
  if (drs.length === 0) {
    return (
      <div className="bg-slate-50 border border-slate-200 p-6 text-center">
        <p className="text-xs text-slate-500 mb-3">No dispatch request created yet</p>
        <button onClick={async () => {
            setActionLoading('send');
            try {
              const line = order.lineItems?.[0] || (order as any).lines?.[0];
              await api.post('/dispatch-requests', {
                orderId: order.id, customerId: order.customerId,
                productName: line?.productName || 'DDGS',
                quantity: line?.quantity || 0, unit: line?.unit || 'MT',
                logisticsBy: order.logisticsBy, deliveryDate: order.deliveryDate,
                destination: order.deliveryAddress || '', remarks: order.remarks || '',
              });
              flash('ok', 'Sent to logistics');
              onRefresh();
            } catch (e: any) { flash('err', e.response?.data?.error || 'Failed'); }
            finally { setActionLoading(null); }
          }}
          disabled={!!actionLoading}
          className="px-4 py-2 bg-blue-600 text-white text-[11px] font-bold hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1.5">
          {actionLoading === 'send' ? <Loader2 size={12} className="animate-spin" /> : <Truck size={12} />}
          Send to Logistics
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {drs.map(dr => {
        const isEditing = editingDR === dr.id;
        const drShipments = dr.shipments || [];

        return (
          <div key={dr.id} className="bg-white border border-slate-200">
            {/* DR Header */}
            <div className="bg-slate-100 px-3 py-2 flex items-center justify-between border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold">DR #{dr.drNo}</span>
                <span className="text-[10px] text-slate-500">{dr.quantity} {dr.unit || 'MT'}</span>
                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                  ['COMPLETED', 'DISPATCHED'].includes(dr.status) ? 'bg-green-100 text-green-700 border-green-300' :
                  dr.status === 'CANCELLED' ? 'bg-red-100 text-red-700 border-red-300' :
                  'bg-blue-100 text-blue-700 border-blue-300'
                }`}>{dr.status.replace(/_/g, ' ')}</span>
              </div>
              {!isEditing && !['COMPLETED', 'CANCELLED'].includes(dr.status) && isSeller && (
                <button onClick={() => startEdit(dr)}
                  className="text-[11px] text-blue-600 font-medium hover:text-blue-700">
                  Edit Logistics
                </button>
              )}
            </div>

            <div className="p-3 space-y-3">
              {/* SELLER logistics editing */}
              {isSeller && isEditing && (
                <div className="bg-orange-50 border border-orange-200 p-3 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Transporter</label>
                      <select value={editTransporterId} onChange={e => setEditTransporterId(e.target.value)} className={inputCls}>
                        <option value="">-- Select --</option>
                        {transporters.map(t => <option key={t.id} value={t.id}>{t.name} {t.phone ? `(${t.phone})` : ''}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Freight Rate (/MT)</label>
                      <input type="number" value={editFreightRate} onChange={e => setEditFreightRate(e.target.value)}
                        placeholder="e.g. 1500" className={inputCls} />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Vehicles Needed</label>
                      <input type="number" value={editVehicleCount} onChange={e => setEditVehicleCount(e.target.value)}
                        className={inputCls} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_100px] gap-2">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Destination</label>
                      <input value={editDestination} onChange={e => setEditDestination(e.target.value)}
                        placeholder="Full delivery address" className={inputCls} />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Distance</label>
                      <div className="flex gap-1">
                        <input value={editDistanceKm} onChange={e => setEditDistanceKm(e.target.value)}
                          placeholder="km" className={inputCls} />
                        <button onClick={handleCalcDistance} disabled={calcLoading}
                          className="px-2 bg-slate-100 border border-slate-300 text-slate-600 hover:bg-slate-200 shrink-0 disabled:opacity-50"
                          title="Auto-calculate distance">
                          {calcLoading ? <Loader2 size={12} className="animate-spin" /> : <MapPin size={12} />}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => saveLogistics(dr.id)} disabled={!!actionLoading}
                      className="px-3 py-1.5 bg-blue-600 text-white text-[11px] font-bold hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1">
                      {actionLoading === dr.id ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                      Save
                    </button>
                    <button onClick={() => setEditingDR(null)}
                      className="px-3 py-1.5 border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Current logistics info (read-only when not editing) */}
              {isSeller && !isEditing && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Transporter</span>
                    <p className="font-medium mt-0.5">{dr.transporterName || <span className="text-orange-500">Not set</span>}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Freight Rate</span>
                    <p className="font-medium font-mono mt-0.5">{dr.freightRate ? `\u20B9${dr.freightRate}/MT` : <span className="text-orange-500">Not set</span>}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Distance</span>
                    <p className="font-medium mt-0.5">{dr.distanceKm ? `${dr.distanceKm} km` : '—'}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Vehicles</span>
                    <p className="font-medium mt-0.5">{dr.vehicleCount || '—'}</p>
                  </div>
                </div>
              )}

              {/* Truck assignment form */}
              {!['DISPATCHED', 'COMPLETED', 'CANCELLED'].includes(dr.status) && (
                <div className="bg-blue-50 border border-blue-200 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-bold text-blue-800 uppercase tracking-widest flex items-center gap-1.5">
                      <Plus size={11} /> Add Trucks
                    </p>
                    <button onClick={() => {
                      setTruckFormDR(dr.id);
                      setTruckRows(prev => [...prev, { vehicle: '', driver: '', mobile: '' }]);
                    }}
                      className="text-[11px] text-blue-600 font-semibold hover:text-blue-700 flex items-center gap-0.5">
                      <Plus size={11} /> Add Row
                    </button>
                  </div>

                  <div className="grid grid-cols-[1fr_1fr_1fr_28px] gap-2 mb-1">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Vehicle No *</span>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Driver Name</span>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Driver Mobile</span>
                    <span></span>
                  </div>

                  {(truckFormDR === dr.id ? truckRows : [{ vehicle: '', driver: '', mobile: '' }]).map((row, idx) => (
                    <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_28px] gap-2 mb-1.5">
                      <input value={row.vehicle}
                        onChange={e => { setTruckFormDR(dr.id); setTruckRows(prev => { const n = [...prev]; n[idx] = { ...n[idx], vehicle: e.target.value }; return n; }); }}
                        onFocus={() => setTruckFormDR(dr.id)}
                        placeholder="MP09XX1234" className={inputCls} />
                      <input value={row.driver}
                        onChange={e => { setTruckFormDR(dr.id); setTruckRows(prev => { const n = [...prev]; n[idx] = { ...n[idx], driver: e.target.value }; return n; }); }}
                        onFocus={() => setTruckFormDR(dr.id)}
                        placeholder="Driver" className={inputCls} />
                      <input value={row.mobile}
                        onChange={e => { setTruckFormDR(dr.id); setTruckRows(prev => { const n = [...prev]; n[idx] = { ...n[idx], mobile: e.target.value }; return n; }); }}
                        onFocus={() => setTruckFormDR(dr.id)}
                        placeholder="Mobile" className={inputCls} />
                      {truckRows.length > 1 && (
                        <button onClick={() => setTruckRows(prev => prev.filter((_, i) => i !== idx))}
                          className="text-red-400 hover:text-red-600 flex items-center justify-center"><X size={14} /></button>
                      )}
                    </div>
                  ))}

                  {/* ETA selector */}
                  <div className="flex items-center gap-2 mb-2 mt-2">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">ETA:</span>
                    {['0', '1', '2', '3', '4'].map(d => (
                      <button key={d} onClick={() => { setTruckFormDR(dr.id); setTruckEtaDays(d); }}
                        className={`px-2.5 py-1 text-[10px] font-medium border ${
                          truckFormDR === dr.id && truckEtaDays === d
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                        }`}>
                        {d === '0' ? 'Today' : d === '4' ? '4+' : `${d}d`}
                      </button>
                    ))}
                  </div>

                  <button onClick={() => assignTruck(dr.id)}
                    disabled={!!actionLoading || truckRows.every(r => !r.vehicle.trim()) || truckFormDR !== dr.id}
                    className="w-full py-2 bg-blue-600 text-white text-[11px] font-bold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2">
                    {actionLoading === dr.id + '_truck' ? <Loader2 size={14} className="animate-spin" /> : <Truck size={14} />}
                    Register {truckRows.filter(r => r.vehicle.trim()).length > 1 ? `${truckRows.filter(r => r.vehicle.trim()).length} Trucks` : 'Truck'} for Gate Entry
                  </button>
                </div>
              )}

              {/* Existing trucks summary */}
              {drShipments.length > 0 && (
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">
                    Assigned Trucks ({drShipments.length})
                  </span>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-1">
                    {drShipments.map((s: any) => (
                      <div key={s.id} className={`text-[10px] px-2 py-1 border font-medium ${
                        ['RELEASED', 'EXITED'].includes(s.status) ? 'bg-green-50 border-green-200 text-green-700' :
                        'bg-slate-50 border-slate-200 text-slate-600'
                      }`}>
                        {s.vehicleNo} <span className="text-[9px] opacity-70">{s.status.replace(/_/g, ' ')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
