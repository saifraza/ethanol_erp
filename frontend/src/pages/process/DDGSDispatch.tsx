import { useState, useEffect } from 'react';
import { Truck, Plus, X, Share2, Save, Loader2, Trash2, ChevronDown } from 'lucide-react';
import ProcessPage from './ProcessPage';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

interface DDGSTruck {
  id: string; date: string; vehicleNo: string; partyName: string; destination: string;
  bags: number; weightPerBag: number; weightGross: number; weightTare: number; weightNet: number;
  remarks: string | null;
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
  const [showHistory, setShowHistory] = useState(false);

  // Form fields
  const [vehicleNo, setVehicleNo] = useState('');
  const [partyName, setPartyName] = useState('');
  const [destination, setDestination] = useState('');
  const [bags, setBags] = useState('');
  const [weightPerBag, setWeightPerBag] = useState('50');
  const [weightGross, setWeightGross] = useState('');
  const [weightTare, setWeightTare] = useState('');
  const [remarks, setRemarks] = useState('');

  const netWeight = (parseFloat(weightGross) || 0) - (parseFloat(weightTare) || 0);
  const bagsWeight = ((parseInt(bags) || 0) * (parseFloat(weightPerBag) || 50)) / 1000; // tonnes

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
        date: new Date(date + 'T00:00:00').toISOString(),
        vehicleNo, partyName, destination,
        bags: parseInt(bags) || 0,
        weightPerBag: parseFloat(weightPerBag) || 50,
        weightGross: parseFloat(weightGross) || 0,
        weightTare: parseFloat(weightTare) || 0,
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

  return (
    <ProcessPage title="DDGS Dispatch" icon={<Truck size={28} />}
      description="Log each DDGS dispatch truck as it leaves"
      flow={{ from: 'DDGS Storage', to: 'Dispatch' }} color="bg-red-600">

      {/* Date + Summary */}
      <div className="mb-4">
        <div className="mb-2">
          <label className="text-xs text-gray-500">Date</label>
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

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mb-3">
            <div>
              <label className="text-[10px] md:text-xs text-gray-500">Bags</label>
              <input type="number" value={bags} onChange={e => setBags(e.target.value)}
                className="input-field w-full text-xs md:text-sm" placeholder="0" />
            </div>
            <div>
              <label className="text-[10px] md:text-xs text-gray-500">Wt/Bag (kg)</label>
              <input type="number" value={weightPerBag} onChange={e => setWeightPerBag(e.target.value)}
                className="input-field w-full text-xs md:text-sm" />
            </div>
            <div>
              <label className="text-[10px] md:text-xs text-gray-500">Gross (T)</label>
              <input type="number" step="0.01" value={weightGross} onChange={e => setWeightGross(e.target.value)}
                className="input-field w-full text-xs md:text-sm" placeholder="0" />
            </div>
            <div>
              <label className="text-[10px] md:text-xs text-gray-500">Tare (T)</label>
              <input type="number" step="0.01" value={weightTare} onChange={e => setWeightTare(e.target.value)}
                className="input-field w-full text-xs md:text-sm" placeholder="0" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="bg-red-50 border border-red-200 rounded-lg p-2">
              <div className="text-[10px] text-gray-500">Net Weight</div>
              <div className="text-lg font-bold text-red-700">{netWeight > 0 ? netWeight.toFixed(2) : bagsWeight.toFixed(2)} T</div>
              {netWeight <= 0 && bagsWeight > 0 && <div className="text-[10px] text-gray-400">from bags × weight</div>}
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-500">Remarks</label>
              <input value={remarks} onChange={e => setRemarks(e.target.value)}
                className="input-field w-full" placeholder="Optional" />
            </div>
          </div>

          <button onClick={saveTruck} disabled={saving}
            className="px-5 py-2 bg-red-600 text-white rounded-lg font-medium text-sm hover:bg-red-700 flex items-center gap-2 disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save Truck
          </button>
        </div>
      )}

      {/* Today's Trucks */}
      {trucks.length > 0 && (
        <div className="card !p-0 overflow-hidden mb-4">
          <div className="px-3 md:px-4 py-2 bg-gray-50 text-xs text-gray-500 font-medium">
            Today's Dispatch — {trucks.length} truck{trucks.length > 1 ? 's' : ''}, {totalDispatched.toFixed(2)} T
          </div>
          {/* Mobile: card view */}
          <div className="md:hidden divide-y">
            {trucks.map((t, i) => (
              <div key={t.id} className="px-3 py-2">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-400">#{i + 1}</span>
                    <span className="font-medium text-xs">{t.vehicleNo || '—'}</span>
                    <span className="text-[10px] text-gray-500">{t.partyName || ''}</span>
                  </div>
                  <span className="font-bold text-red-700 text-sm">{t.weightNet.toFixed(2)} T</span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-gray-500">
                  <div className="flex gap-3">
                    <span>Bags: {t.bags}</span>
                    {t.destination && <span>→ {t.destination}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => shareTruck(t)} className="text-green-500"><Share2 size={11} /></button>
                    {isAdmin && <button onClick={() => deleteTruck(t.id)} className="text-red-400"><Trash2 size={11} /></button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {/* Desktop: table view */}
          <table className="w-full text-xs hidden md:table">
            <thead>
              <tr className="bg-gray-50 text-gray-400 border-t">
                <th className="text-left px-4 py-1.5 font-medium">#</th>
                <th className="text-left px-2 py-1.5 font-medium">Vehicle</th>
                <th className="text-left px-2 py-1.5 font-medium">Party</th>
                <th className="text-center px-2 py-1.5 font-medium">Bags</th>
                <th className="text-center px-2 py-1.5 font-medium">Gross</th>
                <th className="text-center px-2 py-1.5 font-medium">Tare</th>
                <th className="text-center px-2 py-1.5 font-medium">Net</th>
                <th className="text-right px-4 py-1.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {trucks.map((t, i) => (
                <tr key={t.id} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-400">{i + 1}</td>
                  <td className="px-2 py-2 font-medium">{t.vehicleNo || '—'}</td>
                  <td className="px-2 py-2">{t.partyName || '—'}</td>
                  <td className="text-center px-2 py-2">{t.bags}</td>
                  <td className="text-center px-2 py-2">{t.weightGross || '—'}</td>
                  <td className="text-center px-2 py-2">{t.weightTare || '—'}</td>
                  <td className="text-center px-2 py-2 font-bold text-red-700">{t.weightNet.toFixed(2)}</td>
                  <td className="text-right px-4 py-2">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => shareTruck(t)} className="text-green-500 hover:text-green-700"><Share2 size={12} /></button>
                      {isAdmin && <button onClick={() => deleteTruck(t.id)} className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {trucks.length === 0 && !showForm && (
        <p className="text-center text-sm text-gray-400 py-6">No dispatch trucks for {date}</p>
      )}
    </ProcessPage>
  );
}
