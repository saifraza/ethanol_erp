import { useState, useEffect, useRef } from 'react';
import { Truck, Plus, Trash2, Camera, X, Share2, ChevronDown, ChevronUp, Image, Clock } from 'lucide-react';
import api from '../../services/api';

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function EthanolDispatch() {
  const [dispatches, setDispatches] = useState<any[]>([]);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<Record<string, any[]>>({});
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  // Active contracts for party dropdown
  const [contracts, setContracts] = useState<any[]>([]);

  // Form state
  const [batchNo, setBatchNo] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [partyName, setPartyName] = useState('');
  const [contractId, setContractId] = useState('');
  const [destination, setDestination] = useState('');
  const [quantityBL, setQuantityBL] = useState('');
  const [strength, setStrength] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [transporterName, setTransporterName] = useState('');
  const [distanceKm, setDistanceKm] = useState('');
  const [remarks, setRemarks] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadDispatches(); }, [date]);
  useEffect(() => {
    api.get('/dispatch/active-contracts').then(r => setContracts(r.data.contracts || [])).catch(() => {});
  }, []);

  async function loadDispatches() {
    try {
      const res = await api.get(`/dispatch?date=${date}`);
      setDispatches(res.data.dispatches || []);
    } catch (e) { console.error(e); }
  }

  async function loadHistory() {
    try {
      const res = await api.get('/dispatch/history');
      setHistory(res.data.history || {});
    } catch (e) { console.error(e); }
  }

  function resetForm() {
    setBatchNo(''); setVehicleNo(''); setPartyName(''); setContractId(''); setDestination('');
    setQuantityBL(''); setStrength(''); setDriverName(''); setDriverPhone('');
    setTransporterName(''); setDistanceKm(''); setRemarks('');
    setPhoto(null); setShowForm(false);
  }

  function handleContractSelect(cid: string) {
    setContractId(cid);
    if (cid) {
      const c = contracts.find(x => x.id === cid);
      if (c) setPartyName(c.buyerName);
    } else {
      setPartyName('');
    }
  }

  const selectedContract = contracts.find(c => c.id === contractId);

  async function handleSave(share = false) {
    if (!vehicleNo && !quantityBL) { setMsg({ type: 'err', text: 'Vehicle No or Quantity required' }); return; }
    setSaving(true); setMsg(null);
    try {
      const fd = new FormData();
      fd.append('date', date);
      fd.append('batchNo', batchNo);
      fd.append('vehicleNo', vehicleNo);
      fd.append('partyName', partyName);
      fd.append('destination', destination);
      fd.append('quantityBL', quantityBL);
      fd.append('strength', strength);
      fd.append('remarks', remarks);
      if (contractId) fd.append('contractId', contractId);
      if (driverName) fd.append('driverName', driverName);
      if (driverPhone) fd.append('driverPhone', driverPhone);
      if (transporterName) fd.append('transporterName', transporterName);
      if (distanceKm) fd.append('distanceKm', distanceKm);
      if (photo) fd.append('photo', photo);

      await api.post('/dispatch', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

      // Auto-send Telegram for each dispatch truck
      try {
        const msg = `🚛 *Ethanol Dispatch* — ${now}\nVehicle: ${vehicleNo}\nParty: ${partyName || '-'}\nDestination: ${destination || '-'}\nQuantity: ${quantityBL} BL${strength ? ` @ ${strength}%` : ''}\nBatch: ${batchNo || '-'}${remarks ? `\nRemarks: ${remarks}` : ''}`;
        await api.post('/telegram/send-report', { message: msg, module: 'dispatch' });
      } catch (_) { /* Telegram send is best-effort */ }

      setMsg({ type: 'ok', text: `Dispatch saved at ${now}` });
      resetForm();
      await loadDispatches();
    } catch (err: any) { setMsg({ type: 'err', text: err.response?.data?.error || 'Save failed' }); }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this dispatch?')) return;
    try {
      await api.delete(`/dispatch/${id}`);
      await loadDispatches();
    } catch (e) { console.error(e); }
  }

  function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setPhoto(file);
  }

  const totalBL = dispatches.reduce((s, d) => s + (d.quantityBL || 0), 0);

  async function shareTelegram() {
    const lines = dispatches.map((d: any, i: number) =>
      `${i+1}. ${d.batchNo ? `[${d.batchNo}] ` : ''}${d.vehicleNo} → ${d.destination || '-'} | ${d.quantityBL} BL${d.strength ? ` @ ${d.strength}%` : ''} | ${d.partyName}`
    ).join('\n');
    const text = `*Ethanol Dispatch Report*\n📅 ${date}\n\n${lines}\n\n*Total: ${totalBL.toFixed(1)} BL (${dispatches.length} trucks)*`;
    try {
      await api.post('/telegram/send-report', { message: text, module: 'dispatch' });
      setMsg({ type: 'ok', text: 'Report shared via Telegram' });
    } catch (_) {
      setMsg({ type: 'err', text: 'Telegram share failed' });
    }
  }

  const fmtDt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div className="max-w-5xl mx-auto px-3 py-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="p-2 bg-red-100 rounded-lg"><Truck size={24} className="text-red-600" /></div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Ethanol Dispatch</h1>
          <p className="text-xs text-gray-500">Log truck dispatches as they happen</p>
        </div>
      </div>

      {/* Date + Summary */}
      <div className="flex items-end gap-4 mb-5">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="border rounded-lg px-3 py-2.5 text-sm" />
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2">
          <div className="text-[10px] text-red-400 uppercase">Today's Total</div>
          <div className="text-lg font-bold text-red-700">{totalBL.toFixed(1)} BL</div>
          <div className="text-[10px] text-gray-500">{dispatches.length} truck{dispatches.length !== 1 ? 's' : ''}</div>
        </div>
      </div>

      {/* Add Dispatch Button */}
      {!showForm && (
        <button onClick={() => setShowForm(true)}
          className="w-full border-2 border-dashed border-red-300 rounded-lg py-4 text-red-600 hover:bg-red-50 flex items-center justify-center gap-2 mb-5 font-medium">
          <Plus size={20} /> Add Dispatch
        </button>
      )}

      {/* New Dispatch Form */}
      {showForm && (
        <div className="border-2 border-red-300 rounded-lg p-4 bg-white mb-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-red-700">New Dispatch</h3>
            <button onClick={resetForm} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
            <div>
              <label className="text-[10px] text-gray-400">Batch No</label>
              <input type="text" value={batchNo} onChange={e => setBatchNo(e.target.value)}
                className="border rounded px-2 py-2 w-full text-sm" placeholder="B-001" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">Vehicle No</label>
              <input type="text" value={vehicleNo} onChange={e => setVehicleNo(e.target.value)}
                className="border rounded px-2 py-2 w-full text-sm" placeholder="MH 12 AB 1234" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">Party / Contract</label>
              <select value={contractId} onChange={e => handleContractSelect(e.target.value)}
                className="border rounded px-2 py-2 w-full text-sm">
                <option value="">-- Other (no contract) --</option>
                {contracts.map(c => (
                  <option key={c.id} value={c.id}>{c.buyerName} ({c.contractType === 'JOB_WORK' ? 'JW' : c.contractType === 'OMC' ? 'OMC' : 'FP'})</option>
                ))}
              </select>
              {selectedContract && (
                <div className="text-[10px] text-blue-600 mt-0.5">
                  {selectedContract.contractNo} | Rate: {selectedContract.contractType === 'JOB_WORK' ? `₹${selectedContract.conversionRate}/BL` : `₹${selectedContract.ethanolRate}/L`}
                  {selectedContract.autoGenerateEInvoice && <span className="text-green-600 ml-1">(Auto E-Invoice ON)</span>}
                </div>
              )}
            </div>
            <div>
              <label className="text-[10px] text-gray-400">Destination</label>
              <input type="text" value={destination} onChange={e => setDestination(e.target.value)}
                className="border rounded px-2 py-2 w-full text-sm" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">Quantity (BL)</label>
              <input type="number" step="any" value={quantityBL} onChange={e => setQuantityBL(e.target.value)}
                className="border rounded px-2 py-2 w-full text-sm" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">Strength %</label>
              <input type="number" step="any" value={strength} onChange={e => setStrength(e.target.value)}
                className="border rounded px-2 py-2 w-full text-sm" />
            </div>
          </div>
          {/* Driver & Transport (for e-way bill) */}
          {contractId && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <div>
                <label className="text-[10px] text-gray-400">Driver Name</label>
                <input type="text" value={driverName} onChange={e => setDriverName(e.target.value)}
                  className="border rounded px-2 py-2 w-full text-sm" />
              </div>
              <div>
                <label className="text-[10px] text-gray-400">Driver Phone</label>
                <input type="text" value={driverPhone} onChange={e => setDriverPhone(e.target.value)}
                  className="border rounded px-2 py-2 w-full text-sm" />
              </div>
              <div>
                <label className="text-[10px] text-gray-400">Transporter</label>
                <input type="text" value={transporterName} onChange={e => setTransporterName(e.target.value)}
                  className="border rounded px-2 py-2 w-full text-sm" />
              </div>
              <div>
                <label className="text-[10px] text-gray-400">Distance (km)</label>
                <input type="number" value={distanceKm} onChange={e => setDistanceKm(e.target.value)}
                  className="border rounded px-2 py-2 w-full text-sm" placeholder="for E-Way Bill" />
              </div>
            </div>
          )}

          <div className="mb-3">
            <label className="text-[10px] text-gray-400">Remarks</label>
            <input type="text" value={remarks} onChange={e => setRemarks(e.target.value)}
              className="border rounded px-2 py-2 w-full text-sm" />
          </div>

          {/* Photo */}
          <div className="mb-3">
            <input type="file" accept="image/*" capture="environment" ref={fileRef}
              onChange={handlePhotoSelect} className="hidden" />
            {photo ? (
              <div className="flex items-center gap-3">
                <img src={URL.createObjectURL(photo)} alt="Preview"
                  className="w-20 h-20 object-cover rounded-lg border" />
                <div>
                  <p className="text-xs text-gray-500">{photo.name}</p>
                  <button onClick={() => setPhoto(null)} className="text-xs text-red-500 hover:underline">Remove</button>
                </div>
              </div>
            ) : (
              <button onClick={() => fileRef.current?.click()}
                className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 border border-blue-200 rounded-lg px-3 py-2">
                <Camera size={16} /> Take / Upload Photo
              </button>
            )}
          </div>

          {/* Save */}
          <div className="flex items-center gap-3">
            <button onClick={() => handleSave()} disabled={saving}
              className="px-6 py-2.5 bg-red-600 text-white rounded-lg font-medium text-sm hover:bg-red-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save Dispatch'}
            </button>
            {msg && <span className={`text-sm ${msg.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</span>}
          </div>
        </div>
      )}

      {/* Today's Dispatches */}
      <div className="space-y-3 mb-5">
        {dispatches.map((d, i) => (
          <div key={d.id} className="border rounded-lg p-3 bg-white">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-xs font-bold text-gray-400">#{dispatches.length - i}</span>
                  {d.contractId && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">Contract</span>}
                  {d.batchNo && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">{d.batchNo}</span>}
                  <span className="font-semibold text-sm">{d.vehicleNo}</span>
                  <span className="text-xs text-gray-400">
                    {new Date(d.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                  </span>
                </div>
                <div className="text-xs text-gray-600">
                  {d.partyName && <span>{d.partyName} • </span>}
                  {d.destination && <span>{d.destination} • </span>}
                  <span className="font-semibold text-red-600">{d.quantityBL} BL</span>
                  {d.strength && <span> @ {d.strength}%</span>}
                </div>
                {d.remarks && <div className="text-[11px] text-gray-400 mt-0.5">{d.remarks}</div>}
              </div>
              <div className="flex items-center gap-2">
                {d.photoUrl && (
                  <button onClick={() => setPhotoPreview(`${API_BASE}${d.photoUrl}`)}
                    className="text-blue-500 hover:text-blue-700"><Image size={16} /></button>
                )}
                <button onClick={() => handleDelete(d.id)}
                  className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
              </div>
            </div>
          </div>
        ))}
        {dispatches.length === 0 && !showForm && (
          <p className="text-center text-sm text-gray-400 py-8">No dispatches for {date}</p>
        )}
      </div>

      {/* Telegram share */}
      {dispatches.length > 0 && (
        <button onClick={shareTelegram}
          className="w-full flex items-center justify-center gap-2 bg-green-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-green-700 mb-5">
          <Share2 size={16} /> Share on Telegram
        </button>
      )}

      {/* Dispatch History */}
      <div className="border-t pt-4">
        <button onClick={() => { setShowHistory(!showHistory); if (!showHistory) loadHistory(); }}
          className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-800">
          {showHistory ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          <Clock size={14} /> Dispatch History
        </button>
        {showHistory && (
          <div className="mt-3 space-y-4">
            {Object.keys(history).length === 0 && <p className="text-sm text-gray-400">No past dispatches</p>}
            {Object.entries(history).map(([dateKey, items]) => {
              const dayTotal = items.reduce((s: number, d: any) => s + (d.quantityBL || 0), 0);
              return (
                <div key={dateKey} className="border rounded-lg p-3 bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-gray-700">{fmtDt(dateKey)}</span>
                    <span className="text-xs font-bold text-red-600">{dayTotal.toFixed(1)} BL — {items.length} trucks</span>
                  </div>
                  <div className="space-y-1">
                    {items.map((d: any) => (
                      <div key={d.id} className="text-xs text-gray-600 flex justify-between">
                        <span>{d.batchNo ? `[${d.batchNo}] ` : ''}{d.vehicleNo} → {d.partyName}</span>
                        <span className="font-medium">{d.quantityBL} BL</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Photo Preview Modal */}
      {photoPreview && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setPhotoPreview(null)}>
          <div className="relative max-w-2xl w-full">
            <button onClick={() => setPhotoPreview(null)}
              className="absolute -top-10 right-0 text-white"><X size={24} /></button>
            <img src={photoPreview} alt="Dispatch photo" className="w-full rounded-lg" />
          </div>
        </div>
      )}
    </div>
  );
}
