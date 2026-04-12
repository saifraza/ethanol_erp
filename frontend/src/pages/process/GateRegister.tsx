import { useState, useEffect } from 'react';
import { DoorOpen, Plus, Trash2, X, Share2, ChevronDown, ChevronUp, Clock, Edit2, Check } from 'lucide-react';
import api from '../../services/api';

interface GateEntry {
  id: string;
  date: string;
  vehicleNo: string;
  capacityTon: number;
  vendor: string;
  transporterName: string;
  material: 'DDGS' | 'ETHANOL' | 'MAIZE' | 'OTHER';
  status: 'INSIDE' | 'LOADING' | 'LOADED' | 'DISPATCHED' | 'EMPTY_OUT';
  entryTime: string;
  exitTime?: string;
  driverMobile: string;
  rstNo: string;
  remarks?: string;
  grossWeight?: number;
  netWeight?: number;
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

export default function GateRegister() {
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [entries, setEntries] = useState<GateEntry[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState('');

  // Form fields
  const [vehicleNo, setVehicleNo] = useState('');
  const [capacityTon, setCapacityTon] = useState('');
  const [vendor, setVendor] = useState('');
  const [transporterName, setTransporterName] = useState('');
  const [material, setMaterial] = useState<GateEntry['material']>('DDGS');
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
        status: 'INSIDE',
        entryTime,
        driverMobile: driverMobile.trim(),
        rstNo: rstNo.trim(),
        remarks: remarks.trim() || undefined,
      });
      setMsg({ type: 'ok', text: 'Vehicle registered!' });
      resetForm();
      loadEntries();
    } catch (err: any) {
      setMsg({ type: 'err', text: err.response?.data?.message || 'Save failed' });
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
    if (!t) return '—';
    try {
      return new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch {
      return t;
    }
  };

  const shareEntry = (e: GateEntry) => {
    const text = `*Gate Entry*\n📅 ${new Date(e.date).toLocaleDateString('en-IN')}\n\nVehicle: ${e.vehicleNo}\nCapacity: ${e.capacityTon}T\nMaterial: ${e.material}\nVendor: ${e.vendor}\nTransporter: ${e.transporterName}\nEntry: ${fmtTime(e.entryTime)}\n${e.exitTime ? `Exit: ${fmtTime(e.exitTime)}\n` : ''}Driver: ${e.driverMobile}\nRST: ${e.rstNo}\nStatus: ${e.status}${e.remarks ? '\nRemarks: ' + e.remarks : ''}`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else window.open(`https://t.me/share/url?text=${encodeURIComponent(text)}`, '_blank');
  };

  const shareAll = () => {
    const lines = [
      `*Gate Register — ${date}*`,
      `Total: ${entries.length} vehicles | Inside: ${statusCounts.INSIDE} | Loading: ${statusCounts.LOADING} | Loaded: ${statusCounts.LOADED} | Dispatched: ${statusCounts.DISPATCHED}`,
      '',
    ];
    entries.forEach((e, i) => {
      lines.push(
        `${i + 1}. ${e.vehicleNo} (${e.material}) | ${e.capacityTon}T | Entry: ${fmtTime(e.entryTime)} | Status: ${e.status} | ${e.vendor}`
      );
    });
    const text = lines.join('\n');
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else window.open(`https://t.me/share/url?text=${encodeURIComponent(text)}`, '_blank');
  };

  const nextStatus = (current: GateEntry['status']): GateEntry['status'] | null => {
    const idx = statusSequence.indexOf(current);
    if (idx === -1 || idx === statusSequence.length - 1) return null;
    return statusSequence[idx + 1];
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 p-3 md:p-4">
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="p-2 bg-amber-600">
            <DoorOpen size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-800">Gate Register</h1>
            <p className="text-xs text-gray-500">Track vehicles inside the plant</p>
          </div>
        </div>
      </div>

      {/* Date Picker */}
      <div className="mb-4">
        <label className="text-xs text-gray-500">Shift Date</label>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="w-full px-3 py-2 border text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
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
          <div key={s.key} className={`border p-2 md:p-3 ${s.color}`}>
            <div className="text-[10px] md:text-xs text-gray-500">{s.label}</div>
            <div className="text-lg md:text-2xl font-bold">{statusCounts[s.key as keyof typeof statusCounts]}</div>
          </div>
        ))}
      </div>

      {/* Messages */}
      {msg && (
        <div
          className={`p-3 mb-3 text-sm ${
            msg.type === 'ok'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* Add Vehicle Button */}
      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="w-full border-2 border-dashed border-amber-300 py-3 text-amber-600 hover:bg-amber-50 flex items-center justify-center gap-2 mb-4 font-medium text-sm"
        >
          <Plus size={18} /> Add Vehicle
        </button>
      )}

      {/* Add Vehicle Form */}
      {showForm && (
        <div className="bg-white border p-3 md:p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <DoorOpen size={16} className="text-amber-600" /> New Vehicle Entry
            </h3>
            <button onClick={resetForm} className="text-gray-400 hover:text-gray-600">
              <X size={18} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <label className="text-[10px] text-gray-500">Vehicle No *</label>
              <input
                value={vehicleNo}
                onChange={e => setVehicleNo(e.target.value)}
                className="w-full px-2 py-1.5 bordertext-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
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
                className="w-full px-2 py-1.5 bordertext-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
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
                className="w-full px-2 py-1.5 bordertext-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                placeholder="Supplier name"
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-500">Transporter</label>
              <input
                value={transporterName}
                onChange={e => setTransporterName(e.target.value)}
                className="w-full px-2 py-1.5 bordertext-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
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
                className="w-full px-2 py-1.5 bordertext-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
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
                className="w-full px-2 py-1.5 bordertext-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <label className="text-[10px] text-gray-500">Driver Mobile</label>
              <input
                value={driverMobile}
                onChange={e => setDriverMobile(e.target.value)}
                className="w-full px-2 py-1.5 bordertext-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                placeholder="+91 XXXXX XXXXX"
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-500">RST No</label>
              <input
                value={rstNo}
                onChange={e => setRstNo(e.target.value)}
                className="w-full px-2 py-1.5 bordertext-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                placeholder="RST number"
              />
            </div>
          </div>

          <div className="mb-3">
            <label className="text-[10px] text-gray-500">Remarks</label>
            <input
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              className="w-full px-2 py-1.5 bordertext-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              placeholder="Optional notes"
            />
          </div>

          <button
            onClick={saveEntry}
            disabled={saving}
            className="w-full py-2.5 bg-amber-600 text-white font-medium text-sm hover:bg-amber-700 disabled:opacity-50"
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
              Today's Vehicles — {entries.length} vehicle{entries.length > 1 ? 's' : ''}
            </span>
            {entries.length > 0 && (
              <button
                onClick={shareAll}
                className="text-xs bg-green-600 text-white px-2.5 py-1flex items-center gap-1 font-medium"
              >
                <Share2 size={11} /> Share All
              </button>
            )}
          </div>

          {entries.map(e => {
            const colors = statusColors[e.status];
            const next = nextStatus(e.status);
            return (
              <div key={e.id} className="bg-white border p-3">
                {/* Header */}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="font-bold text-sm mb-1">{e.vehicleNo}</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] px-2 py-0.5font-medium ${colors.badge}`}>
                        {e.status}
                      </span>
                      <span className="text-[10px] text-gray-500">{e.material}</span>
                      {e.capacityTon && <span className="text-[10px] text-gray-500">{e.capacityTon}T</span>}
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
                  <div className="grid grid-cols-2 gap-2 mb-2 text-[10px] text-gray-500 bg-gray-50p-1.5">
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
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-amber-100 text-amber-700text-xs font-medium hover:bg-amber-200"
                    >
                      <ChevronDown size={13} /> {next}
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
                        onChange={e => setEditStatus(e.target.value)}
                        className="flex-1 px-2 py-1 bordertext-xs bg-white"
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
          <div className="w-full bg-white p-4 md:p-6 max-h-[80vh] overflow-y-auto">
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
                  className="w-full px-3 py-2 bordertext-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="text-xs text-gray-500">Gross Weight (Ton) - Optional</label>
                <input
                  type="number"
                  step="0.01"
                  value={grossWeight}
                  onChange={e => setGrossWeight(e.target.value)}
                  className="w-full px-3 py-2 bordertext-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
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
                  className="w-full px-3 py-2 bordertext-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  placeholder="0.00"
                />
              </div>

              <button
                onClick={confirmDispatch}
                className="w-full py-3 bg-amber-600 text-white font-medium text-sm hover:bg-amber-700"
              >
                Confirm Dispatch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
