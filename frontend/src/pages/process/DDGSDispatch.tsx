import { useState, useEffect } from 'react';
import { Truck, Plus, X, Share2, Save, Loader2, Trash2, AlertTriangle } from 'lucide-react';
import ProcessPage from './ProcessPage';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

interface DDGSTruck {
  id: string; date: string; vehicleNo: string; partyName: string; destination: string;
  bags: number; weightPerBag: number; weightGross: number; weightTare: number; weightNet: number;
  remarks: string | null; createdAt: string;
}

export default function DDGSDispatch() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [date, setDate] = useState(() => {
    const now = new Date();
    if (now.getHours() < 9) now.setDate(now.getDate() - 1);
    return now.toISOString().split('T')[0];
  });
  const [trucks, setTrucks] = useState<DDGSTruck[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Form fields
  const [vehicleNo, setVehicleNo] = useState('');
  const [partyName, setPartyName] = useState('');
  const [destination, setDestination] = useState('');
  const [bags, setBags] = useState('');
  const [weightPerBag, setWeightPerBag] = useState('50');
  const [weightGross, setWeightGross] = useState('');
  const [weightTare, setWeightTare] = useState('');
  const [remarks, setRemarks] = useState('');

  const grossVal = parseFloat(weightGross) || 0;
  const tareVal = parseFloat(weightTare) || 0;
  const netWeight = grossVal > 0 && tareVal > 0 ? grossVal - tareVal : 0;
  const bagsWeight = ((parseInt(bags) || 0) * (parseFloat(weightPerBag) || 50)) / 1000; // tonnes
  // Final weight = gross-tare if available, else fallback to bags×weight
  const finalWeight = netWeight > 0 ? netWeight : bagsWeight;
  // Difference between the two methods
  const hasBothWeights = netWeight > 0 && bagsWeight > 0;
  const weightDiff = hasBothWeights ? Math.abs(netWeight - bagsWeight) : 0;
  const weightDiffPct = hasBothWeights && bagsWeight > 0 ? (weightDiff / bagsWeight) * 100 : 0;

  // FIX: use UTC date to match backend query
  const loadTrucks = () => api.get(`/ddgs-dispatch?date=${date}`).then(r => setTrucks(r.data.trucks || [])).catch(() => {});
  useEffect(() => { loadTrucks(); }, [date]);

  const totalDispatched = trucks.reduce((s, t) => s + t.weightNet, 0);
  const totalBags = trucks.reduce((s, t) => s + t.bags, 0);

  const resetForm = () => {
    setVehicleNo(''); setPartyName(''); setDestination('');
    setBags(''); setWeightPerBag('50'); setWeightGross(''); setWeightTare('');
    setRemarks(''); setShowForm(false);
  };

  async function saveTruck() {
    if (!vehicleNo.trim() && !partyName.trim()) { setMsg({ type: 'err', text: 'Vehicle or party name required' }); return; }
    setSaving(true); setMsg(null);
    try {
      await api.post('/ddgs-dispatch', {
        // FIX: send as UTC midnight so backend date query matches
        date: date + 'T00:00:00.000Z',
        vehicleNo, partyName, destination,
        bags: parseInt(bags) || 0,
        weightPerBag: parseFloat(weightPerBag) || 50,
        weightGross: grossVal,
        weightTare: tareVal,
        remarks,
      });
      setMsg({ type: 'ok', text: 'Truck added!' });
      resetForm(); loadTrucks();
    } catch { setMsg({ type: 'err', text: 'Save failed' }); }
    setSaving(false);
  }

  async function deleteTruck(id: string) {
    if (!confirm('Delete this truck?')) return;
    await api.delete(`/ddgs-dispatch/${id}`);
    loadTrucks();
  }

  const shareTruck = (t: DDGSTruck) => {
    const text = `*DDGS Dispatch*\n📅 ${new Date(t.date).toLocaleDateString('en-IN')}\n\nVehicle: ${t.vehicleNo}\nParty: ${t.partyName}\nDestination: ${t.destination}\nBags: ${t.bags} x ${t.weightPerBag}kg\nGross: ${t.weightGross}T | Tare: ${t.weightTare}T\nNet: ${t.weightNet.toFixed(2)}T${t.remarks ? '\nRemarks: ' + t.remarks : ''}`;
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

  const fmtTime = (d: string) => new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

  return (
    <ProcessPage title="DDGS Dispatch" icon={<Truck size={28} />}
      description="Log each DDGS dispatch truck as it leaves"
      flow={{ from: 'DDGS Storage', to: 'Dispatch' }} color="bg-red-600">

      {/* Date + Summary */}
      <div className="mb-4">
        <div className="mb-2">
          <label className="text-xs text-gray-500">Shift Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="input-field" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border p-2 md:p-3 bg-red-50 border-red-200">
            <div className="text-[10px] md:text-xs text-gray-500">Dispatched</div>
            <div className="text-base md:text-xl font-bold text-red-700">{totalDispatched.toFixed(2)} <span className="text-[10px] font-normal text-gray-400">T</span></div>
          </div>
          <div className="rounded-lg border p-2 md:p-3 bg-orange-50 border-orange-200">
            <div className="text-[10px] md:text-xs text-gray-500">Trucks</div>
            <div className="text-base md:text-xl font-bold">{trucks.length}</div>
          </div>
          <div className="rounded-lg border p-2 md:p-3 bg-amber-50 border-amber-200">
            <div className="text-[10px] md:text-xs text-gray-500">Total Bags</div>
            <div className="text-base md:text-xl font-bold">{totalBags}</div>
          </div>
        </div>
      </div>

      {msg && (
        <div className={`rounded-lg p-3 mb-3 text-sm ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{msg.text}</div>
      )}

      {/* Add Truck Button */}
      {!showForm && (
        <button onClick={() => setShowForm(true)}
          className="w-full border-2 border-dashed border-red-300 rounded-lg py-3 text-red-600 hover:bg-red-50 flex items-center justify-center gap-2 mb-4 font-medium text-sm">
          <Plus size={18} /> Add Dispatch Truck
        </button>
      )}

      {/* New Truck Form */}
      {showForm && (
        <div className="card mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="section-title !mb-0 flex items-center gap-2">
              <Truck size={16} className="text-red-600" /> New Dispatch Truck
            </h3>
            <button onClick={resetForm} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3 mb-3">
            <div>
              <label className="text-[10px] md:text-xs text-gray-500">Vehicle No *</label>
              <input value={vehicleNo} onChange={e => setVehicleNo(e.target.value)}
                className="input-field w-full text-xs md:text-sm" placeholder="MP 00 XX 0000" autoFocus />
            </div>
            <div>
              <label className="text-[10px] md:text-xs text-gray-500">Party Name</label>
              <input value={partyName} onChange={e => setPartyName(e.target.value)}
                className="input-field w-full text-xs md:text-sm" placeholder="Buyer name" />
            </div>
            <div className="col-span-2 md:col-span-1">
              <label className="text-[10px] md:text-xs text-gray-500">Destination</label>
              <input value={destination} onChange={e => setDestination(e.target.value)}
                className="input-field w-full text-xs md:text-sm" placeholder="City / location" />
            </div>
          </div>

          {/* Weight Section */}
          <div className="bg-gray-50 rounded-lg p-3 mb-3">
            <div className="text-xs font-semibold text-gray-600 mb-2">Weight (Final = Gross − Tare)</div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="text-[10px] text-gray-500">Gross (Ton)</label>
                <input type="number" step="0.01" value={weightGross} onChange={e => setWeightGross(e.target.value)}
                  className="input-field w-full text-xs md:text-sm font-medium" placeholder="0.00" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500">Tare (Ton)</label>
                <input type="number" step="0.01" value={weightTare} onChange={e => setWeightTare(e.target.value)}
                  className="input-field w-full text-xs md:text-sm font-medium" placeholder="0.00" />
              </div>
            </div>

            {/* Bags row */}
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="text-[10px] text-gray-500">Bags</label>
                <input type="number" value={bags} onChange={e => setBags(e.target.value)}
                  className="input-field w-full text-xs md:text-sm" placeholder="0" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500">Wt/Bag (kg)</label>
                <input type="number" value={weightPerBag} onChange={e => setWeightPerBag(e.target.value)}
                  className="input-field w-full text-xs md:text-sm" />
              </div>
            </div>

            {/* Net Weight Display */}
            <div className="bg-red-50 border border-red-200 rounded-lg p-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-gray-500">Net Weight (Final)</div>
                  <div className="text-xl font-bold text-red-700">{finalWeight.toFixed(2)} T</div>
                  <div className="text-[10px] text-gray-400">
                    {netWeight > 0 ? `Gross ${grossVal.toFixed(2)} − Tare ${tareVal.toFixed(2)}` : bagsWeight > 0 ? `${bags} bags × ${weightPerBag}kg (no weigh bridge)` : '—'}
                  </div>
                </div>
                {bagsWeight > 0 && (
                  <div className="text-right text-[10px] text-gray-400">
                    <div>Bags wt: {bagsWeight.toFixed(2)} T</div>
                    {netWeight > 0 && <div>Bridge wt: {netWeight.toFixed(2)} T</div>}
                  </div>
                )}
              </div>

              {/* Weight difference warning */}
              {hasBothWeights && weightDiff > 0.01 && (
                <div className={`mt-2 flex items-start gap-1.5 text-xs rounded p-2 ${weightDiffPct > 5 ? 'bg-red-100 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <div>
                    <b>Difference: {weightDiff.toFixed(2)} T ({weightDiffPct.toFixed(1)}%)</b>
                    <div className="text-[10px] mt-0.5">
                      Bags count says {bagsWeight.toFixed(2)} T but weigh bridge says {netWeight.toFixed(2)} T.
                      Final dispatch uses <b>weigh bridge (Gross − Tare)</b>, not bag count.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Remarks */}
          <div className="mb-3">
            <label className="text-[10px] md:text-xs text-gray-500">Remarks</label>
            <input value={remarks} onChange={e => setRemarks(e.target.value)}
              className="input-field w-full text-xs md:text-sm" placeholder="Optional" />
          </div>

          <button onClick={saveTruck} disabled={saving}
            className="w-full py-2.5 bg-red-600 text-white rounded-lg font-medium text-sm hover:bg-red-700 flex items-center justify-center gap-2 disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save Truck
          </button>
        </div>
      )}

      {/* Truck List — card style like grain unloading */}
      {trucks.length > 0 && (
        <div className="space-y-2 mb-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase">
              Today's Trucks — {trucks.length} truck{trucks.length > 1 ? 's' : ''}, {totalDispatched.toFixed(2)} T
            </span>
            <button onClick={shareAll}
              className="text-xs bg-green-600 text-white px-2.5 py-1 rounded flex items-center gap-1 font-medium">
              <Share2 size={11} /> Share All
            </button>
          </div>
          {trucks.map((t, i) => {
            const bagWt = (t.bags * t.weightPerBag) / 1000;
            const bridgeWt = t.weightGross > 0 ? t.weightGross - t.weightTare : 0;
            const diff = bridgeWt > 0 && bagWt > 0 ? Math.abs(bridgeWt - bagWt) : 0;
            return (
              <div key={t.id} className="bg-white border rounded-xl p-3 shadow-sm">
                <div className="flex items-start justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] bg-red-100 text-red-600 font-bold px-1.5 py-0.5 rounded">#{i + 1}</span>
                    <span className="font-bold text-sm">{t.vehicleNo || '—'}</span>
                    {t.destination && <span className="text-xs text-gray-400">→ {t.destination}</span>}
                  </div>
                  <span className="font-bold text-red-700 text-lg">{t.weightNet.toFixed(2)} T</span>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-gray-500 mb-1">
                  {t.partyName && <span>{t.partyName}</span>}
                  <span>{t.bags} bags × {t.weightPerBag}kg</span>
                  {t.weightGross > 0 && <span>G:{t.weightGross} T:{t.weightTare}</span>}
                </div>
                {diff > 0.01 && (
                  <div className="text-[10px] text-amber-600 flex items-center gap-1 mb-1">
                    <AlertTriangle size={10} /> Bag wt {bagWt.toFixed(2)}T vs Bridge {bridgeWt.toFixed(2)}T (diff {diff.toFixed(2)}T)
                  </div>
                )}
                <div className="flex items-center justify-between pt-1 border-t border-gray-100">
                  <span className="text-[10px] text-gray-400">{t.createdAt ? fmtTime(t.createdAt) : ''}</span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => shareTruck(t)} className="text-green-500 hover:text-green-700 p-1"><Share2 size={13} /></button>
                    {isAdmin && <button onClick={() => deleteTruck(t.id)} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={13} /></button>}
                  </div>
                </div>
                {t.remarks && <div className="text-[10px] text-gray-400 mt-1 italic">{t.remarks}</div>}
              </div>
            );
          })}
        </div>
      )}

      {trucks.length === 0 && !showForm && (
        <p className="text-center text-sm text-gray-400 py-6">No dispatch trucks for {date}</p>
      )}
    </ProcessPage>
  );
}
