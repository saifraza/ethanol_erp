import { useState, useEffect, useRef } from 'react';
import { Wheat, Plus, Trash2, Camera, X, Share2, ChevronDown, ChevronUp, Image, Clock, AlertTriangle } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Shift date: if before 9AM, it's yesterday's shift
function shiftDate() {
  const now = new Date();
  if (now.getHours() < 9) now.setDate(now.getDate() - 1);
  return now.toISOString().split('T')[0];
}

function parseNumberInput(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

export default function GrainUnloadingTrucks() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  const [trucks, setTrucks] = useState<any[]>([]);
  const [date, setDate] = useState(shiftDate());
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<Record<string, any[]>>({});
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  // Form state
  const [uidRst, setUidRst] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [supplier, setSupplier] = useState('');
  const [weightGross, setWeightGross] = useState('');
  const [weightTare, setWeightTare] = useState('');
  const [quarantineWeight, setQuarantineWeight] = useState('');
  const [moisture, setMoisture] = useState('');
  const [starchPercent, setStarchPercent] = useState('');
  const [damagedPercent, setDamagedPercent] = useState('');
  const [foreignMatter, setForeignMatter] = useState('');
  const [quarantineReason, setQuarantineReason] = useState('');
  const [bags, setBags] = useState('');
  const [remarks, setRemarks] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [labData, setLabData] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadTrucks(); }, [date]);

  async function loadTrucks() {
    try {
      const res = await api.get(`/grain-truck?date=${date}`);
      setTrucks(res.data.trucks || []);
    } catch (e) { console.error(e); }
  }

  async function loadHistory() {
    try {
      const res = await api.get('/grain-truck/history');
      setHistory(res.data.history || {});
    } catch (e) { console.error(e); }
  }

  function resetForm() {
    setUidRst(''); setVehicleNo(''); setSupplier(''); setWeightGross(''); setWeightTare('');
    setQuarantineWeight(''); setMoisture(''); setStarchPercent(''); setDamagedPercent('');
    setForeignMatter(''); setQuarantineReason(''); setBags(''); setRemarks('');
    setPhoto(null); setLabData(null); setShowForm(false);
  }

  async function fetchLabData(rst: string) {
    if (!rst.trim()) { setLabData(null); return; }
    try {
      const res = await api.get(`/raw-material/by-code/${rst.trim()}`);
      const d = res.data;
      setLabData(d);
      // Auto-fill quality fields from raw material analysis
      if (d.moisture) setMoisture(String(d.moisture));
      if (d.starch) setStarchPercent(String(d.starch));
      if (d.damaged) setDamagedPercent(String(d.damaged));
      if (d.tfm) setForeignMatter(String(d.tfm));
    } catch {
      setLabData(null);
    }
  }

  async function handleSave() {
    if (!vehicleNo && !weightGross) { setMsg({ type: 'err', text: 'Vehicle No or Gross Weight required' }); return; }
    if (validationError) { setMsg({ type: 'err', text: validationError }); return; }
    setSaving(true); setMsg(null);
    try {
      const fd = new FormData();
      // Send full ISO datetime from browser's local timezone
      const [y, m, d] = date.split('-').map(Number);
      const localDate = new Date(y, m - 1, d, new Date().getHours(), new Date().getMinutes());
      fd.append('date', localDate.toISOString());
      fd.append('uidRst', uidRst);
      fd.append('vehicleNo', vehicleNo);
      fd.append('supplier', supplier);
      fd.append('weightGross', weightGross);
      fd.append('weightTare', weightTare);
      fd.append('quarantineWeight', quarantineWeight);
      fd.append('moisture', moisture);
      fd.append('starchPercent', starchPercent);
      fd.append('damagedPercent', damagedPercent);
      fd.append('foreignMatter', foreignMatter);
      fd.append('quarantine', String((qWeightValue ?? 0) > 0));
      fd.append('quarantineReason', quarantineReason);
      fd.append('bags', bags);
      fd.append('remarks', remarks);
      if (photo) fd.append('photo', photo);

      await api.post('/grain-truck', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

      // Auto-send Telegram notification for each truck unload
      const netWt = ((parseNumberInput(weightGross) ?? 0) - (parseNumberInput(weightTare) ?? 0)).toFixed(2);
      const qw = parseNumberInput(quarantineWeight) ?? 0;
      const toSiloWt = (parseFloat(netWt) - qw).toFixed(2);
      const updatedTrucks = await api.get(`/grain-truck?date=${date}`);
      const truckList = updatedTrucks.data.trucks || [];
      const totalNetToday = truckList.reduce((s: number, t: any) => s + (t.weightNet - (t.quarantineWeight || 0)), 0);

      const waLines = [
        `🚛 *Truck Unloaded* — ${now}`,
        `Vehicle: ${vehicleNo || '—'}`,
        supplier ? `Supplier: ${supplier}` : '',
        `Gross: ${weightGross} Ton · Tare: ${weightTare} Ton`,
        `Net: ${netWt} Ton${qw > 0 ? ` · Quarantine: ${qw} Ton` : ''}`,
        `To Silo: ${toSiloWt} Ton`,
        moisture ? `Moisture: ${moisture}%` : '',
        starchPercent ? `Starch: ${starchPercent}%` : '',
        damagedPercent ? `Damaged: ${damagedPercent}%` : '',
        foreignMatter ? `Foreign Matter: ${foreignMatter}%` : '',
        bags ? `Bags: ${bags}` : '',
        remarks ? `Remarks: ${remarks}` : '',
        '',
        `📊 Today: ${truckList.length} trucks · ${totalNetToday.toFixed(2)} Ton to silo`,
      ].filter(Boolean).join('\n');

      api.post('/telegram/send-report', { message: waLines, module: 'grain' }).catch(() => {});

      setMsg({ type: 'ok', text: `Truck saved at ${now}` });
      resetForm();
      setTrucks(truckList);
    } catch (err: any) { setMsg({ type: 'err', text: err.response?.data?.error || 'Save failed' }); }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this truck entry?')) return;
    try {
      await api.delete(`/grain-truck/${id}`);
      await loadTrucks();
      if (showHistory) loadHistory();
    } catch (e) { console.error(e); }
  }

  function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setPhoto(file);
  }

  const grossValue = parseNumberInput(weightGross);
  const tareValue = parseNumberInput(weightTare);
  const qWeightValue = parseNumberInput(quarantineWeight);
  const moistureValue = parseNumberInput(moisture);
  const starchValue = parseNumberInput(starchPercent);
  const damagedValue = parseNumberInput(damagedPercent);
  const foreignMatterValue = parseNumberInput(foreignMatter);
  const bagsValue = parseNumberInput(bags);

  const net = (grossValue != null && !Number.isNaN(grossValue) ? grossValue : 0) - (tareValue != null && !Number.isNaN(tareValue) ? tareValue : 0);
  const qw = qWeightValue != null && !Number.isNaN(qWeightValue) ? qWeightValue : 0;
  const toSilo = net - qw;
  const totalNet = trucks.reduce((s, t) => s + (t.weightNet - (t.quarantineWeight || 0)), 0);
  const quarantineTotal = trucks.reduce((s, t) => s + (t.quarantineWeight || 0), 0);
  const truckCount = trucks.length;

  const validationError = (() => {
    const numericFields = [
      ['Gross weight', grossValue],
      ['Tare weight', tareValue],
      ['Quarantine weight', qWeightValue],
      ['Moisture', moistureValue],
      ['Starch', starchValue],
      ['Damaged', damagedValue],
      ['Foreign matter', foreignMatterValue],
      ['Bags', bagsValue],
    ] as const;

    for (const [label, value] of numericFields) {
      if (value != null && Number.isNaN(value)) return `${label} must be a valid number`;
      if (value != null && value < 0) return `${label} cannot be negative`;
    }

    const percentageFields = [
      ['Moisture', moistureValue],
      ['Starch', starchValue],
      ['Damaged', damagedValue],
      ['Foreign matter', foreignMatterValue],
    ] as const;

    for (const [label, value] of percentageFields) {
      if (value != null && value > 100) return `${label} must be between 0 and 100`;
    }

    if (net < 0) return 'Gross weight cannot be less than tare weight';
    if (qw > net) return 'Quarantine weight cannot be greater than net weight';

    return null;
  })();

  function shareTelegram() {
    const lines = trucks.map((t, i) => {
      const tSilo = t.weightNet - (t.quarantineWeight || 0);
      return `${i+1}. ${t.uidRst ? `[${t.uidRst}] ` : ''}${t.vehicleNo} | ${t.supplier || '-'} | Net: ${t.weightNet.toFixed(1)} Ton → Silo: ${tSilo.toFixed(1)} Ton${t.quarantineWeight > 0 ? ` | Q: ${t.quarantineWeight.toFixed(1)} Ton` : ''}`;
    }).join('\n');
    const text = `*Grain Unloading Report*\n📅 ${date}\n\n${lines}\n\n*To Silo: ${totalNet.toFixed(1)} Ton (${truckCount} trucks)*${quarantineTotal > 0 ? `\n⚠️ Quarantine: ${quarantineTotal.toFixed(1)} Ton` : ''}`;

    api.post('/telegram/send-report', { message: text, module: 'grain' }).catch(() => {});
  }

  const fmtDt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div className="max-w-5xl mx-auto px-3 py-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="p-2 bg-amber-100 rounded-lg"><Wheat size={24} className="text-amber-600" /></div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Grain Unloading</h1>
          <p className="text-xs text-gray-500">Log each truck as it arrives — real time</p>
        </div>
      </div>

      {/* Date + Summary */}
      <div className="flex items-end gap-3 mb-5 flex-wrap">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="border rounded-lg px-3 py-2.5 text-sm" />
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
          <div className="text-[10px] text-amber-400 uppercase">To Silo</div>
          <div className="text-lg font-bold text-amber-700">{totalNet.toFixed(1)} Ton</div>
          <div className="text-[10px] text-gray-500">{truckCount} truck{truckCount !== 1 ? 's' : ''}</div>
        </div>
        {quarantineTotal > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded-lg px-4 py-2">
            <div className="text-[10px] text-orange-400 uppercase flex items-center gap-1"><AlertTriangle size={10} /> Quarantine</div>
            <div className="text-lg font-bold text-orange-700">{quarantineTotal.toFixed(1)} Ton</div>
          </div>
        )}
      </div>

      {/* Add Truck Button */}
      {!showForm && (
        <button onClick={() => setShowForm(true)}
          className="w-full border-2 border-dashed border-amber-300 rounded-lg py-4 text-amber-600 hover:bg-amber-50 flex items-center justify-center gap-2 mb-5 font-medium">
          <Plus size={20} /> Add Truck
        </button>
      )}

      {/* New Truck Form */}
      {showForm && (
        <div className="border-2 border-amber-300 rounded-lg p-4 bg-white mb-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-amber-700">New Truck</h3>
            <button onClick={resetForm} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
            <div>
              <label className="text-[10px] text-gray-400">UID/RST No</label>
              <input type="text" value={uidRst} onChange={e => setUidRst(e.target.value)}
                onBlur={() => fetchLabData(uidRst)}
                className="border rounded px-2 py-2 w-full text-sm" placeholder="Tracking number" />
              {labData && (
                <div className="text-[10px] text-indigo-600 mt-0.5 flex items-center gap-1">
                  ✓ Lab data loaded
                </div>
              )}
            </div>
            <div>
              <label className="text-[10px] text-gray-400">Vehicle No</label>
              <input type="text" value={vehicleNo} onChange={e => setVehicleNo(e.target.value)}
                className="border rounded px-2 py-2 w-full text-sm" placeholder="MH 12 AB 1234" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">Supplier</label>
              <input type="text" value={supplier} onChange={e => setSupplier(e.target.value)}
                className="border rounded px-2 py-2 w-full text-sm" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">Gross Weight (Ton)</label>
              <input type="number" step="any" min="0" value={weightGross} onChange={e => setWeightGross(e.target.value)}
                className="border rounded px-2 py-2 w-full text-sm" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">Tare Weight (Ton)</label>
              <input type="number" step="any" min="0" value={weightTare} onChange={e => setWeightTare(e.target.value)}
                className="border rounded px-2 py-2 w-full text-sm" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">Net Weight (Ton)</label>
              <div className="border rounded px-2 py-2 w-full text-sm bg-gray-50 font-semibold text-amber-700">
                {net > 0 ? net.toFixed(2) : '—'}
              </div>
            </div>
          </div>

          {/* Bags */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
            <div>
              <label className="text-[10px] text-gray-400">No. of Bags</label>
              <input type="number" step="1" min="0" value={bags} onChange={e => setBags(e.target.value)}
                className="border rounded px-2 py-2 w-full text-sm" placeholder="0" />
            </div>
          </div>

          {/* Quarantine (partial) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
            <div>
              <label className="text-[10px] text-orange-500 font-medium flex items-center gap-1"><AlertTriangle size={10} /> Rejected/Quarantine (Ton)</label>
              <input type="number" step="any" min="0" value={quarantineWeight} onChange={e => setQuarantineWeight(e.target.value)}
                className="border border-orange-200 rounded px-2 py-2 w-full text-sm bg-orange-50" placeholder="0 = none" />
              {validationError && (
                <div className="text-[10px] text-red-600 mt-1">{validationError}</div>
              )}
            </div>
            <div>
              <label className="text-[10px] text-green-600 font-medium">To Silo (Ton)</label>
              <div className="border rounded px-2 py-2 w-full text-sm bg-green-50 font-semibold text-green-700">
                {toSilo > 0 ? toSilo.toFixed(2) : '—'}
              </div>
            </div>
            {qw > 0 && (
              <div>
                <label className="text-[10px] text-gray-400">Quarantine Reason</label>
                <input type="text" value={quarantineReason} onChange={e => setQuarantineReason(e.target.value)}
                  className="border rounded px-2 py-2 w-full text-sm" placeholder="e.g. High moisture" />
              </div>
            )}
          </div>

          {/* Quality */}
          <div className="text-[10px] text-gray-400 font-medium mb-1 mt-2">
            QUALITY {labData ? <span className="text-indigo-500">(auto-filled from lab)</span> : '(optional)'}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <div>
              <label className="text-[10px] text-gray-400">Moisture %</label>
              <input type="number" step="any" min="0" max="100" value={moisture} onChange={e => setMoisture(e.target.value)}
                className={`border rounded px-2 py-2 w-full text-sm ${labData?.moisture ? 'bg-indigo-50 border-indigo-200' : ''}`} />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">Starch %</label>
              <input type="number" step="any" min="0" max="100" value={starchPercent} onChange={e => setStarchPercent(e.target.value)}
                className={`border rounded px-2 py-2 w-full text-sm ${labData?.starch ? 'bg-indigo-50 border-indigo-200' : ''}`} />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">Damaged %</label>
              <input type="number" step="any" min="0" max="100" value={damagedPercent} onChange={e => setDamagedPercent(e.target.value)}
                className={`border rounded px-2 py-2 w-full text-sm ${labData?.damaged ? 'bg-indigo-50 border-indigo-200' : ''}`} />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">Foreign Matter %</label>
              <input type="number" step="any" min="0" max="100" value={foreignMatter} onChange={e => setForeignMatter(e.target.value)}
                className={`border rounded px-2 py-2 w-full text-sm ${labData?.tfm ? 'bg-indigo-50 border-indigo-200' : ''}`} />
            </div>
          </div>

          {/* Remarks */}
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
            <button onClick={handleSave} disabled={saving}
              className="px-6 py-2.5 bg-amber-600 text-white rounded-lg font-medium text-sm hover:bg-amber-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save Truck'}
            </button>
            {msg && <span className={`text-sm ${msg.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</span>}
          </div>
        </div>
      )}

      {/* Today's Trucks */}
      <div className="space-y-3 mb-5">
        {trucks.map((t, i) => {
          const tToSilo = t.weightNet - (t.quarantineWeight || 0);
          return (
          <div key={t.id} className={`border rounded-lg p-3 bg-white ${t.quarantineWeight > 0 ? 'border-orange-300 bg-orange-50/50' : ''}`}>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-xs font-bold text-gray-400">#{trucks.length - i}</span>
                  {t.uidRst && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">{t.uidRst}</span>}
                  <span className="font-semibold text-sm">{t.vehicleNo}</span>
                  {t.quarantineWeight > 0 && (
                    <span className="text-[10px] bg-orange-200 text-orange-700 px-1.5 py-0.5 rounded font-medium flex items-center gap-0.5">
                      <AlertTriangle size={10} /> Q: {t.quarantineWeight.toFixed(1)}T
                    </span>
                  )}
                  <span className="text-xs text-gray-400">
                    {new Date(t.date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                  </span>
                </div>
                <div className="text-xs text-gray-600">
                  {t.supplier && <span>{t.supplier} • </span>}
                  <span>Gross: {t.weightGross} Ton • Tare: {t.weightTare} Ton • Net: {t.weightNet.toFixed(1)} Ton</span>
                  {t.bags > 0 && <span> • {t.bags} bags</span>}
                  {t.quarantineWeight > 0 && <span className="text-orange-600"> • Q: {t.quarantineWeight.toFixed(1)} Ton</span>}
                  <span className="font-semibold text-green-700"> → Silo: {tToSilo.toFixed(1)} Ton</span>
                </div>
                {t.moisture != null && (
                  <div className="text-[11px] text-gray-400 mt-0.5">
                    M: {t.moisture}% {t.starchPercent != null && `| S: ${t.starchPercent}%`} {t.damagedPercent != null && `| D: ${t.damagedPercent}%`} {t.foreignMatter != null && `| FM: ${t.foreignMatter}%`}
                  </div>
                )}
                {t.quarantineReason && <div className="text-[11px] text-orange-600 mt-0.5">Reason: {t.quarantineReason}</div>}
                {t.remarks && <div className="text-[11px] text-gray-400 mt-0.5">{t.remarks}</div>}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => {
                  const tSilo = t.weightNet - (t.quarantineWeight || 0);
                  const text = `*Grain Truck*\n${t.uidRst ? `UID/RST: ${t.uidRst}\n` : ''}Vehicle: ${t.vehicleNo}\n${t.supplier ? `Supplier: ${t.supplier}\n` : ''}Gross: ${t.weightGross} Ton | Tare: ${t.weightTare} Ton | Net: ${t.weightNet.toFixed(1)} Ton${t.bags > 0 ? ` | Bags: ${t.bags}` : ''}\nTo Silo: ${tSilo.toFixed(1)} Ton${t.quarantineWeight > 0 ? ` | Quarantine: ${t.quarantineWeight.toFixed(1)} Ton` : ''}${t.moisture != null ? `\nM: ${t.moisture}%` : ''}${t.starchPercent != null ? ` | S: ${t.starchPercent}%` : ''}${t.damagedPercent != null ? ` | D: ${t.damagedPercent}%` : ''}${t.foreignMatter != null ? ` | FM: ${t.foreignMatter}%` : ''}${t.quarantineReason ? `\nReason: ${t.quarantineReason}` : ''}${t.remarks ? `\nRemarks: ${t.remarks}` : ''}`;
                  api.post('/telegram/send-report', { message: text, module: 'grain' }).catch(() => {});
                }} className="text-green-500 hover:text-green-700"><Share2 size={14} /></button>
                {t.photoUrl && (
                  <button onClick={() => setPhotoPreview(`${API_BASE}${t.photoUrl}`)}
                    className="text-blue-500 hover:text-blue-700"><Image size={16} /></button>
                )}
                {isAdmin && <button onClick={() => handleDelete(t.id)}
                  className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>}
              </div>
            </div>
          </div>
          );
        })}
        {trucks.length === 0 && !showForm && (
          <p className="text-center text-sm text-gray-400 py-8">No trucks for {date}</p>
        )}
      </div>

      {/* Telegram share */}
      {trucks.length > 0 && (
        <button onClick={shareTelegram}
          className="w-full flex items-center justify-center gap-2 bg-green-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-green-700 mb-5">
          <Share2 size={16} /> Share on Telegram
        </button>
      )}

      {/* History */}
      <div className="border-t pt-4">
        <button onClick={() => { setShowHistory(!showHistory); if (!showHistory) loadHistory(); }}
          className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-800">
          {showHistory ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          <Clock size={14} /> Unloading History
        </button>
        {showHistory && (
          <div className="mt-3 space-y-4">
            {Object.keys(history).length === 0 && <p className="text-sm text-gray-400">No past records</p>}
            {Object.entries(history).map(([dateKey, items]) => {
              const dayTotal = items.reduce((s: number, t: any) => s + (t.weightNet - (t.quarantineWeight || 0)), 0);
              const dayQ = items.reduce((s: number, t: any) => s + (t.quarantineWeight || 0), 0);
              return (
                <div key={dateKey} className="border rounded-lg p-3 bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-gray-700">{fmtDt(dateKey)}</span>
                    <span className="text-xs font-bold text-amber-600">
                      {dayTotal.toFixed(1)} Ton — {items.length} trucks
                      {dayQ > 0 && <span className="text-orange-500 ml-2">Q: {dayQ.toFixed(1)} Ton</span>}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {items.map((t: any) => (
                      <div key={t.id} className="text-xs text-gray-600 flex justify-between items-center">
                        <span>{t.vehicleNo} → {t.supplier || '-'}{t.quarantine ? ' ⚠️' : ''}</span>
                        <span className="flex items-center gap-2">
                          <span className="font-medium">{t.weightNet.toFixed(1)} Ton</span>
                          {isAdmin && <button onClick={() => handleDelete(t.id)}
                            className="text-red-300 hover:text-red-600"><Trash2 size={12} /></button>}
                        </span>
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
            <img src={photoPreview} alt="Truck photo" className="w-full rounded-lg" />
          </div>
        </div>
      )}
    </div>
  );
}
