import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DoorOpen, Plus, Trash2, X, Share2, Clock, Edit2, Check, PackageCheck } from 'lucide-react';
import api from '../../services/api';
import GoodsReceipts from '../procurement/GoodsReceipts';

interface GateEntry {
  id: string;
  date: string;
  vehicleNo: string;
  capacityTon: number;
  vendor: string;
  transporterName: string;
  material: 'DDGS' | 'ETHANOL' | 'MAIZE' | 'OTHER';
  direction: 'INBOUND' | 'OUTBOUND';
  status: 'INSIDE' | 'LOADING' | 'LOADED' | 'DISPATCHED' | 'EMPTY_OUT';
  entryTime: string;
  exitTime?: string;
  driverMobile: string;
  rstNo: string;
  remarks?: string;
  grossWeight?: number;
  netWeight?: number;
  grnId?: string;
  grnNumber?: string;
  createdAt: string;
}

const statusColors: Record<string, { badge: string; bgLight: string; border: string; text: string }> = {
  INSIDE: { badge: 'bg-yellow-100 text-yellow-700', bgLight: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-600' },
  LOADING: { badge: 'bg-blue-100 text-blue-700', bgLight: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-600' },
  LOADED: { badge: 'bg-green-100 text-green-700', bgLight: 'bg-green-50', border: 'border-green-200', text: 'text-green-600' },
  DISPATCHED: { badge: 'bg-gray-100 text-gray-700', bgLight: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-600' },
  EMPTY_OUT: { badge: 'bg-red-100 text-red-700', bgLight: 'bg-red-50', border: 'border-red-200', text: 'text-red-600' },
};

const materialOptions = ['DDGS', 'ETHANOL', 'MAIZE', 'OTHER'];
const statusSequence: GateEntry['status'][] = ['INSIDE', 'LOADING', 'LOADED', 'DISPATCHED'];

export default function GateAndReceipts() {
  const [searchParams] = useSearchParams();

  // Gate register state
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [entries, setEntries] = useState<GateEntry[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState('');

  // Form fields
  const [vehicleNo, setVehicleNo] = useState('');
  const [capacityTon, setCapacityTon] = useState('');
  const [vendor, setVendor] = useState('');
  const [transporterName, setTransporterName] = useState('');
  const [material, setMaterial] = useState<GateEntry['material']>('DDGS');
  const [direction, setDirection] = useState<'INBOUND' | 'OUTBOUND'>('OUTBOUND');
  const [driverMobile, setDriverMobile] = useState('');
  const [rstNo, setRstNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [entryTime, setEntryTime] = useState(() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  });

  // Dispatch modal state
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [dispatchId, setDispatchId] = useState<string | null>(null);
  const [exitTime, setExitTime] = useState(() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  });
  const [grossWeight, setGrossWeight] = useState('');
  const [netWeight, setNetWeight] = useState('');

  const loadEntries = () => {
    api.get(`/gate-entry?date=${date}`)
      .then(r => setEntries(r.data || []))
      .catch(() => {});
  };

  useEffect(() => {
    loadEntries();
  }, [date]);

  // Count by status
  const statusCounts = {
    INSIDE: entries.filter(e => e.status === 'INSIDE').length,
    LOADING: entries.filter(e => e.status === 'LOADING').length,
    LOADED: entries.filter(e => e.status === 'LOADED').length,
    DISPATCHED: entries.filter(e => e.status === 'DISPATCHED').length,
  };

  const resetForm = () => {
    setVehicleNo('');
    setCapacityTon('');
    setVendor('');
    setTransporterName('');
    setMaterial('DDGS');
    setDirection('OUTBOUND');
    setDriverMobile('');
    setRstNo('');
    setRemarks('');
    setEntryTime(() => {
      const now = new Date();
      return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    });
    setShowForm(false);
  };

  async function saveEntry() {
    if (!vehicleNo.trim()) {
      setMsg({ type: 'err', text: 'Vehicle No is required' });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      await api.post('/gate-entry', {
        date: date + 'T00:00:00.000Z',
        vehicleNo: vehicleNo.trim(),
        capacityTon: parseFloat(capacityTon) || 0,
        vendor: vendor.trim(),
        transporterName: transporterName.trim(),
        material,
        direction,
        status: 'INSIDE',
        entryTime,
        driverMobile: driverMobile.trim(),
        rstNo: rstNo.trim(),
        remarks: remarks.trim() || undefined,
      });
      setMsg({ type: 'ok', text: 'Vehicle registered!' });
      resetForm();
      loadEntries();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      setMsg({ type: 'err', text: error.response?.data?.message || 'Save failed' });
    }
    setSaving(false);
  }

  async function updateStatus(id: string, newStatus: GateEntry['status']) {
    if (newStatus === 'DISPATCHED') {
      setDispatchId(id);
      setShowDispatchModal(true);
      return;
    }

    try {
      await api.put(`/gate-entry/${id}`, { status: newStatus });
      loadEntries();
    } catch {
      setMsg({ type: 'err', text: 'Status update failed' });
    }
  }

  async function confirmDispatch() {
    if (!dispatchId) return;
    try {
      await api.put(`/gate-entry/${dispatchId}`, {
        status: 'DISPATCHED',
        exitTime,
        grossWeight: grossWeight ? parseFloat(grossWeight) : undefined,
        netWeight: netWeight ? parseFloat(netWeight) : undefined,
      });
      setShowDispatchModal(false);
      setDispatchId(null);
      setExitTime(() => {
        const now = new Date();
        return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      });
      setGrossWeight('');
      setNetWeight('');
      loadEntries();
    } catch {
      setMsg({ type: 'err', text: 'Dispatch failed' });
    }
  }

  async function deleteEntry(id: string) {
    if (!confirm('Delete this vehicle entry?')) return;
    try {
      await api.delete(`/gate-entry/${id}`);
      loadEntries();
    } catch {
      setMsg({ type: 'err', text: 'Delete failed' });
    }
  }

  const fmtTime = (t: string) => {
    if (!t) return '--';
    try {
      return new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch {
      return t;
    }
  };

  const shareEntry = (e: GateEntry) => {
    const dir = e.direction === 'INBOUND' ? ' [IN]' : ' [OUT]';
    const text = `*Gate Entry${dir}*\n${new Date(e.date).toLocaleDateString('en-IN')}\n\nVehicle: ${e.vehicleNo}\nCapacity: ${e.capacityTon}T\nMaterial: ${e.material}\nVendor: ${e.vendor}\nTransporter: ${e.transporterName}\nEntry: ${fmtTime(e.entryTime)}\n${e.exitTime ? `Exit: ${fmtTime(e.exitTime)}\n` : ''}Driver: ${e.driverMobile}\nRST: ${e.rstNo}\nStatus: ${e.status}${e.remarks ? '\nRemarks: ' + e.remarks : ''}`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
  };

  const shareAll = () => {
    const lines = [
      `*Gate Register -- ${date}*`,
      `Total: ${entries.length} vehicles | Inside: ${statusCounts.INSIDE} | Loading: ${statusCounts.LOADING} | Loaded: ${statusCounts.LOADED} | Dispatched: ${statusCounts.DISPATCHED}`,
      '',
    ];
    entries.forEach((e, i) => {
      const dir = e.direction === 'INBOUND' ? '[IN]' : '[OUT]';
      lines.push(
        `${i + 1}. ${dir} ${e.vehicleNo} (${e.material}) | ${e.capacityTon}T | Entry: ${fmtTime(e.entryTime)} | Status: ${e.status} | ${e.vendor}`
      );
    });
    const text = lines.join('\n');
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
  };

  const nextStatus = (current: GateEntry['status']): GateEntry['status'] | null => {
    const idx = statusSequence.indexOf(current);
    if (idx === -1 || idx === statusSequence.length - 1) return null;
    return statusSequence[idx + 1];
  };

  const [showGrnSection, setShowGrnSection] = useState(false);
  const grnRef = React.useRef<HTMLDivElement>(null);

  const handleCreateGrn = () => {
    setShowGrnSection(true);
    setTimeout(() => grnRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  // Auto-show GRN section if URL has ?tab=grn
  useEffect(() => {
    if (searchParams.get('tab') === 'grn') setShowGrnSection(true);
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Gate & Receipts</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Vehicle tracking & goods receipt</span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowForm(true)} className="px-3 py-1 bg-amber-600 text-white text-[11px] font-medium hover:bg-amber-700 flex items-center gap-1">
              <Plus size={12} /> Register Vehicle
            </button>
            <button onClick={handleCreateGrn} className="px-3 py-1 bg-green-600 text-white text-[11px] font-medium hover:bg-green-700 flex items-center gap-1">
              <PackageCheck size={12} /> Create GRN
            </button>
          </div>
        </div>

        {/* Gate Log Section */}
        <div className="bg-gradient-to-br from-amber-50 to-orange-50 -mx-3 md:-mx-6 p-3 md:p-4">
            {/* Date Picker */}
            <div className="mb-4">
              <label className="text-xs text-gray-500">Shift Date</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            {/* Summary Badges */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
              {[
                { key: 'INSIDE', label: 'Inside', color: 'bg-yellow-50 border-yellow-200 text-yellow-700' },
                { key: 'LOADING', label: 'Loading', color: 'bg-blue-50 border-blue-200 text-blue-700' },
                { key: 'LOADED', label: 'Loaded', color: 'bg-green-50 border-green-200 text-green-700' },
                { key: 'DISPATCHED', label: 'Dispatched', color: 'bg-gray-50 border-gray-200 text-gray-700' },
              ].map(s => (
                <div key={s.key} className={`border rounded-lg p-2 md:p-3 ${s.color}`}>
                  <div className="text-[10px] md:text-xs text-gray-500">{s.label}</div>
                  <div className="text-lg md:text-2xl font-bold">{statusCounts[s.key as keyof typeof statusCounts]}</div>
                </div>
              ))}
            </div>

            {/* Messages */}
            {msg && (
              <div
                className={`rounded-lg p-3 mb-3 text-sm ${
                  msg.type === 'ok'
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}
              >
                {msg.text}
              </div>
            )}

            {/* Add Vehicle Form */}
            {showForm && (
              <div className="bg-white border rounded-xl p-3 md:p-4 shadow-sm mb-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-sm flex items-center gap-2">
                    <DoorOpen size={16} className="text-amber-600" /> New Vehicle Entry
                  </h3>
                  <button onClick={resetForm} className="text-gray-400 hover:text-gray-600">
                    <X size={18} />
                  </button>
                </div>

                {/* Direction Toggle */}
                <div className="mb-3">
                  <label className="text-[10px] text-gray-500">Direction</label>
                  <div className="flex gap-2 mt-1">
                    <button
                      onClick={() => setDirection('OUTBOUND')}
                      className={`flex-1 py-2 text-xs font-medium rounded-lg border ${
                        direction === 'OUTBOUND'
                          ? 'bg-amber-600 text-white border-amber-600'
                          : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      OUTBOUND
                    </button>
                    <button
                      onClick={() => setDirection('INBOUND')}
                      className={`flex-1 py-2 text-xs font-medium rounded-lg border ${
                        direction === 'INBOUND'
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      INBOUND
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div>
                    <label className="text-[10px] text-gray-500">Vehicle No *</label>
                    <input
                      value={vehicleNo}
                      onChange={e => setVehicleNo(e.target.value)}
                      className="w-full px-2 py-1.5 border rounded text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                      placeholder="MP 00 XX 0000"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500">Capacity (Ton)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={capacityTon}
                      onChange={e => setCapacityTon(e.target.value)}
                      className="w-full px-2 py-1.5 border rounded text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div>
                    <label className="text-[10px] text-gray-500">Vendor</label>
                    <input
                      value={vendor}
                      onChange={e => setVendor(e.target.value)}
                      className="w-full px-2 py-1.5 border rounded text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                      placeholder="Supplier name"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500">Transporter</label>
                    <input
                      value={transporterName}
                      onChange={e => setTransporterName(e.target.value)}
                      className="w-full px-2 py-1.5 border rounded text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                      placeholder="Transport name"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div>
                    <label className="text-[10px] text-gray-500">Material</label>
                    <select
                      value={material}
                      onChange={e => setMaterial(e.target.value as GateEntry['material'])}
                      className="w-full px-2 py-1.5 border rounded text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    >
                      {materialOptions.map(m => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500">Entry Time (HH:MM)</label>
                    <input
                      type="time"
                      value={entryTime}
                      onChange={e => setEntryTime(e.target.value)}
                      className="w-full px-2 py-1.5 border rounded text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div>
                    <label className="text-[10px] text-gray-500">Driver Mobile</label>
                    <input
                      value={driverMobile}
                      onChange={e => setDriverMobile(e.target.value)}
                      className="w-full px-2 py-1.5 border rounded text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                      placeholder="+91 XXXXX XXXXX"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500">RST No</label>
                    <input
                      value={rstNo}
                      onChange={e => setRstNo(e.target.value)}
                      className="w-full px-2 py-1.5 border rounded text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                      placeholder="RST number"
                    />
                  </div>
                </div>

                <div className="mb-3">
                  <label className="text-[10px] text-gray-500">Remarks</label>
                  <input
                    value={remarks}
                    onChange={e => setRemarks(e.target.value)}
                    className="w-full px-2 py-1.5 border rounded text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    placeholder="Optional notes"
                  />
                </div>

                <button
                  onClick={saveEntry}
                  disabled={saving}
                  className="w-full py-2.5 bg-amber-600 text-white rounded-lg font-medium text-sm hover:bg-amber-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Register Vehicle'}
                </button>
              </div>
            )}

            {/* Vehicle List */}
            {entries.length > 0 && (
              <div className="space-y-2 mb-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-500 uppercase">
                    Today's Vehicles -- {entries.length} vehicle{entries.length > 1 ? 's' : ''}
                  </span>
                  {entries.length > 0 && (
                    <button
                      onClick={shareAll}
                      className="text-xs bg-green-600 text-white px-2.5 py-1 rounded flex items-center gap-1 font-medium"
                    >
                      <Share2 size={11} /> Share All
                    </button>
                  )}
                </div>

                {entries.map((e, idx) => {
                  const colors = statusColors[e.status];
                  const next = nextStatus(e.status);
                  const isInbound = e.direction === 'INBOUND';
                  return (
                    <div key={e.id} className="bg-white border rounded-xl p-3 shadow-sm">
                      {/* Header */}
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-bold text-sm">{e.vehicleNo}</span>
                            {isInbound && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold">
                                IN
                              </span>
                            )}
                            {!isInbound && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">
                                OUT
                              </span>
                            )}
                            {e.grnId && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-semibold">
                                GRN-{e.grnNumber || e.grnId.slice(0, 6)}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${colors.badge}`}>
                              {e.status}
                            </span>
                            <span className="text-[10px] text-gray-500">{e.material}</span>
                            {e.capacityTon > 0 && <span className="text-[10px] text-gray-500">{e.capacityTon}T</span>}
                          </div>
                        </div>
                        <div className="text-right">
                          <button
                            onClick={() => deleteEntry(e.id)}
                            className="text-red-400 hover:text-red-600 p-1"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Entry/Exit Times */}
                      <div className="grid grid-cols-2 gap-2 mb-2 text-[10px]">
                        <div className="flex items-center gap-1">
                          <Clock size={12} className="text-gray-400" />
                          <span className="text-gray-500">
                            Entry: <span className="font-medium text-gray-700">{fmtTime(e.entryTime)}</span>
                          </span>
                        </div>
                        {e.exitTime && (
                          <div className="flex items-center gap-1">
                            <Clock size={12} className="text-gray-400" />
                            <span className="text-gray-500">
                              Exit: <span className="font-medium text-gray-700">{fmtTime(e.exitTime)}</span>
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Vendor/Transporter Info */}
                      <div className="grid grid-cols-2 gap-2 mb-2 text-[10px] text-gray-500">
                        {e.vendor && <div>Vendor: <span className="font-medium text-gray-700">{e.vendor}</span></div>}
                        {e.transporterName && (
                          <div>Transport: <span className="font-medium text-gray-700">{e.transporterName}</span></div>
                        )}
                      </div>

                      {/* RST/Driver */}
                      <div className="grid grid-cols-2 gap-2 mb-2 text-[10px] text-gray-500">
                        {e.rstNo && <div>RST: <span className="font-medium text-gray-700">{e.rstNo}</span></div>}
                        {e.driverMobile && (
                          <div>Driver: <span className="font-medium text-gray-700">{e.driverMobile}</span></div>
                        )}
                      </div>

                      {/* Weights (if dispatched) */}
                      {e.status === 'DISPATCHED' && (
                        <div className="grid grid-cols-2 gap-2 mb-2 text-[10px] text-gray-500 bg-gray-50 rounded p-1.5">
                          {e.grossWeight && (
                            <div>Gross: <span className="font-medium text-gray-700">{e.grossWeight}T</span></div>
                          )}
                          {e.netWeight && (
                            <div>Net: <span className="font-medium text-gray-700">{e.netWeight}T</span></div>
                          )}
                        </div>
                      )}

                      {/* Remarks */}
                      {e.remarks && <div className="text-[10px] text-gray-400 mb-2 italic">{e.remarks}</div>}

                      {/* Action Buttons */}
                      <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                        {/* Status Cycle Button */}
                        {next && (
                          <button
                            onClick={() => updateStatus(e.id, next)}
                            className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-amber-100 text-amber-700 rounded text-xs font-medium hover:bg-amber-200"
                          >
                            <Check size={13} /> {next}
                          </button>
                        )}

                        {/* Create GRN button for INBOUND entries without a GRN */}
                        {isInbound && !e.grnId && (
                          <button
                            onClick={handleCreateGrn}
                            className="flex items-center gap-1 py-1.5 px-2.5 bg-green-100 text-green-700 rounded text-xs font-medium hover:bg-green-200"
                          >
                            <PackageCheck size={13} /> Create GRN
                          </button>
                        )}

                        {/* Status Dropdown (alternative) */}
                        {editingId !== e.id && (
                          <button
                            onClick={() => {
                              setEditingId(e.id);
                              setEditStatus(e.status);
                            }}
                            className="p-1.5 text-gray-400 hover:text-gray-600"
                          >
                            <Edit2 size={13} />
                          </button>
                        )}

                        {/* Inline Status Editor */}
                        {editingId === e.id && (
                          <>
                            <select
                              value={editStatus}
                              onChange={ev => setEditStatus(ev.target.value)}
                              className="flex-1 px-2 py-1 border rounded text-xs bg-white"
                            >
                              <option value="INSIDE">INSIDE</option>
                              <option value="LOADING">LOADING</option>
                              <option value="LOADED">LOADED</option>
                              <option value="DISPATCHED">DISPATCHED</option>
                              <option value="EMPTY_OUT">EMPTY_OUT</option>
                            </select>
                            <button
                              onClick={() => {
                                updateStatus(e.id, editStatus as GateEntry['status']);
                                setEditingId(null);
                              }}
                              className="p-1.5 text-green-600 hover:text-green-700"
                            >
                              <Check size={13} />
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="p-1.5 text-gray-400 hover:text-gray-600"
                            >
                              <X size={13} />
                            </button>
                          </>
                        )}

                        {/* Share Button */}
                        <button onClick={() => shareEntry(e)} className="text-green-500 hover:text-green-700 p-1.5">
                          <Share2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Empty State */}
            {entries.length === 0 && !showForm && (
              <p className="text-center text-sm text-gray-400 py-6">No vehicles registered for {date}</p>
            )}

            {/* Dispatch Modal */}
            {showDispatchModal && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end z-50">
                <div className="w-full bg-white rounded-t-2xl p-4 md:p-6 max-h-[80vh] overflow-y-auto">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-lg">Dispatch Vehicle</h3>
                    <button
                      onClick={() => {
                        setShowDispatchModal(false);
                        setDispatchId(null);
                      }}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <X size={20} />
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="text-xs text-gray-500">Exit Time (HH:MM)</label>
                      <input
                        type="time"
                        value={exitTime}
                        onChange={e => setExitTime(e.target.value)}
                        className="w-full px-3 py-2 border rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </div>

                    <div>
                      <label className="text-xs text-gray-500">Gross Weight (Ton) - Optional</label>
                      <input
                        type="number"
                        step="0.01"
                        value={grossWeight}
                        onChange={e => setGrossWeight(e.target.value)}
                        className="w-full px-3 py-2 border rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                        placeholder="0.00"
                      />
                    </div>

                    <div>
                      <label className="text-xs text-gray-500">Net Weight (Ton) - Optional</label>
                      <input
                        type="number"
                        step="0.01"
                        value={netWeight}
                        onChange={e => setNetWeight(e.target.value)}
                        className="w-full px-3 py-2 border rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                        placeholder="0.00"
                      />
                    </div>

                    <button
                      onClick={confirmDispatch}
                      className="w-full py-3 bg-amber-600 text-white rounded-lg font-medium text-sm hover:bg-amber-700"
                    >
                      Confirm Dispatch
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

        {/* GRN Section — shown when "Create GRN" is clicked or URL has ?tab=grn */}
        {showGrnSection && (
          <div ref={grnRef}>
            <div className="bg-slate-800 text-white px-4 py-2 -mx-3 md:-mx-6 flex items-center justify-between mt-0">
              <div className="flex items-center gap-2">
                <PackageCheck size={14} />
                <span className="text-[11px] font-bold uppercase tracking-widest">Goods Receipts</span>
              </div>
              <button onClick={() => setShowGrnSection(false)} className="text-slate-400 hover:text-white">
                <X size={14} />
              </button>
            </div>
            <div className="-mx-3 md:-mx-6">
              <GoodsReceipts />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
