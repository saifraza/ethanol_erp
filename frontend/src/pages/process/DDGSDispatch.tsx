import { useState, useEffect, useMemo } from 'react';
import { Truck, Plus, Trash2, X, Share2, ChevronDown, ChevronUp, Clock, FileText, Receipt } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

interface DDGSTruck {
  id: string; date: string; rstNo: number | null; vehicleNo: string; partyName: string;
  partyGstin: string | null; destination: string;
  bags: number; weightPerBag: number; weightGross: number; weightTare: number; weightNet: number;
  rate: number | null; invoiceNo: string | null; invoiceAmount: number | null;
  ewayBillNo: string | null; remarks: string | null; createdAt: string; status: string;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function DDGSDispatch() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [dispatches, setDispatches] = useState<DDGSTruck[]>([]);
  const [date, setDate] = useState(() => {
    const now = new Date();
    if (now.getHours() < 9) now.setDate(now.getDate() - 1);
    return now.toISOString().split('T')[0];
  });
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<Record<string, DDGSTruck[]>>({});

  // Form state
  const [rstNo, setRstNo] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [partyName, setPartyName] = useState('');
  const [destination, setDestination] = useState('');
  const [bags, setBags] = useState('');
  const [weightPerBag, setWeightPerBag] = useState('50');
  const [weightTareKg, setWeightTareKg] = useState('');
  const [weightGrossKg, setWeightGrossKg] = useState('');
  const [remarks, setRemarks] = useState('');

  // Bill modal
  const [billTruck, setBillTruck] = useState<DDGSTruck | null>(null);
  const [billRate, setBillRate] = useState('');
  const [billInvNo, setBillInvNo] = useState('');

  useEffect(() => { loadDispatches(); }, [date]);

  async function loadDispatches() {
    try {
      const res = await api.get(`/ddgs-dispatch?date=${date}`);
      setDispatches(res.data.trucks || []);
    } catch (e) { console.error(e); }
  }

  async function loadHistory() {
    try {
      const res = await api.get('/ddgs-dispatch/history');
      setHistory(res.data.history || {});
    } catch (e) { console.error(e); }
  }

  function resetForm() {
    setRstNo(''); setVehicleNo(''); setPartyName(''); setDestination('');
    setBags(''); setWeightPerBag('50'); setWeightTareKg(''); setWeightGrossKg('');
    setRemarks(''); setShowForm(false);
  }

  // Net weight in KG — computed instantly via useMemo
  const netWeightKg = useMemo(() => {
    const g = parseFloat(weightGrossKg) || 0;
    const t = parseFloat(weightTareKg) || 0;
    return g > t && t > 0 ? g - t : 0;
  }, [weightGrossKg, weightTareKg]);

  async function handleSave() {
    if (!vehicleNo) { setMsg({ type: 'err', text: 'Vehicle No required' }); return; }
    setSaving(true); setMsg(null);
    try {
      // Convert KG to MT for storage
      const tareMT = (parseFloat(weightTareKg) || 0) / 1000;
      const grossMT = (parseFloat(weightGrossKg) || 0) / 1000;
      await api.post('/ddgs-dispatch', {
        date, rstNo: rstNo || null, vehicleNo, partyName, destination,
        bags: parseInt(bags) || 0, weightPerBag: parseFloat(weightPerBag) || 50,
        weightTare: tareMT, weightGross: grossMT,
        remarks: remarks || null,
      });
      const now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      setMsg({ type: 'ok', text: `Saved at ${now}` });
      resetForm();
      await loadDispatches();
    } catch (err: any) { setMsg({ type: 'err', text: err.response?.data?.error || 'Save failed' }); }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this dispatch?')) return;
    try { await api.delete(`/ddgs-dispatch/${id}`); await loadDispatches(); }
    catch (e) { console.error(e); }
  }

  async function handleGenerateBill() {
    if (!billTruck || !billRate) return;
    try {
      await api.post(`/ddgs-dispatch/${billTruck.id}/generate-bill`, {
        rate: parseFloat(billRate), invoiceNo: billInvNo || undefined,
      });
      setBillTruck(null); setBillRate(''); setBillInvNo('');
      await loadDispatches();
      setMsg({ type: 'ok', text: 'Bill generated' });
    } catch (err: any) { setMsg({ type: 'err', text: err.response?.data?.error || 'Bill failed' }); }
  }

  const totalNet = dispatches.reduce((s, d) => s + (d.weightNet || 0), 0);
  const totalBags = dispatches.reduce((s, d) => s + (d.bags || 0), 0);

  function shareWhatsApp() {
    const lines = dispatches.map((d, i) =>
      `${i + 1}. ${d.vehicleNo} → ${d.partyName || '-'} | ${d.bags} bags | ${(d.weightNet * 1000).toFixed(0)} KG`
    ).join('\n');
    const text = `*DDGS Dispatch Report*\n📅 ${date}\n\n${lines}\n\n*Total: ${(totalNet * 1000).toFixed(0)} KG (${totalNet.toFixed(2)} MT) | ${totalBags} bags | ${dispatches.length} trucks*`;
    if (navigator.share) {
      navigator.share({ text }).catch(() => {
        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
      });
    } else {
      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
    }
  }

  const fmtDt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div className="max-w-5xl mx-auto px-3 py-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="p-2 bg-amber-100 rounded-lg"><Truck size={24} className="text-amber-700" /></div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">DDGS Dispatch</h1>
          <p className="text-xs text-gray-500">Log DDGS truck dispatches</p>
        </div>
      </div>

      {/* Date + Summary */}
      <div className="flex items-end gap-4 mb-5 flex-wrap">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="border rounded-lg px-3 py-2.5 text-sm" />
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
          <div className="text-[10px] text-amber-500 uppercase">Total Dispatch</div>
          <div className="text-lg font-bold text-amber-700">{(totalNet * 1000).toFixed(0)} KG <span className="text-xs font-normal text-gray-400">({totalNet.toFixed(2)} MT)</span></div>
          <div className="text-[10px] text-gray-500">{totalBags} bags · {dispatches.length} truck{dispatches.length !== 1 ? 's' : ''}</div>
        </div>
      </div>

      {/* Add Button */}
      {!showForm && (
        <button onClick={() => setShowForm(true)}
          className="w-full border-2 border-dashed border-amber-300 rounded-lg py-4 text-amber-700 hover:bg-amber-50 flex items-center justify-center gap-2 mb-5 font-medium">
          <Plus size={20} /> Add Dispatch
        </button>
      )}

      {/* New Dispatch Form */}
      {showForm && (
        <div className="border-2 border-amber-300 rounded-lg p-4 bg-white mb-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-amber-700">New DDGS Dispatch</h3>
            <button onClick={resetForm} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
            <div>
              <label className="text-[10px] text-gray-400">RST No *</label>
              <input type="number" value={rstNo} onChange={e => setRstNo(e.target.value)}
                className="border rounded px-2 py-2 w-full text-sm" placeholder="Unique RST number" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">Vehicle No *</label>
              <input type="text" value={vehicleNo} onChange={e => setVehicleNo(e.target.value)}
                className="border rounded px-2 py-2 w-full text-sm" placeholder="MP 20 AB 1234" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">Party Name</label>
              <input type="text" value={partyName} onChange={e => setPartyName(e.target.value)}
                className="border rounded px-2 py-2 w-full text-sm" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">Destination</label>
              <input type="text" value={destination} onChange={e => setDestination(e.target.value)}
                className="border rounded px-2 py-2 w-full text-sm" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">Bags</label>
              <input type="number" value={bags} onChange={e => setBags(e.target.value)}
                className="border rounded px-2 py-2 w-full text-sm" placeholder="0" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">Wt/Bag (kg)</label>
              <input type="number" step="any" value={weightPerBag} onChange={e => setWeightPerBag(e.target.value)}
                className="border rounded px-2 py-2 w-full text-sm" />
            </div>
          </div>

          {/* Weights in KG */}
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="text-[10px] text-gray-400">Tare Wt (KG)</label>
              <input type="number" step="any" value={weightTareKg} onChange={e => setWeightTareKg(e.target.value)}
                className="border rounded px-2 py-2 w-full text-sm" placeholder="e.g. 12500" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">Gross Wt (KG)</label>
              <input type="number" step="any" value={weightGrossKg} onChange={e => setWeightGrossKg(e.target.value)}
                className="border rounded px-2 py-2 w-full text-sm" placeholder="e.g. 38000" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">Net Wt (KG)</label>
              <div className="border rounded px-2 py-2 w-full text-sm bg-gray-50 font-semibold text-amber-700">
                {netWeightKg > 0 ? `${netWeightKg.toFixed(0)} KG (${(netWeightKg / 1000).toFixed(2)} MT)` : '—'}
              </div>
            </div>
          </div>

          <div className="mb-3">
            <label className="text-[10px] text-gray-400">Remarks</label>
            <input type="text" value={remarks} onChange={e => setRemarks(e.target.value)}
              className="border rounded px-2 py-2 w-full text-sm" />
          </div>

          {/* Save */}
          <div className="flex items-center gap-3">
            <button onClick={handleSave} disabled={saving}
              className="px-6 py-2.5 bg-amber-600 text-white rounded-lg font-medium text-sm hover:bg-amber-700 disabled:opacity-50">
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
                  {d.rstNo && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">RST {d.rstNo}</span>}
                  <span className="font-semibold text-sm">{d.vehicleNo}</span>
                  <span className="text-xs text-gray-400">
                    {new Date(d.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {d.invoiceNo && (
                    <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium">
                      {d.invoiceNo}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-600">
                  {d.partyName && <span>{d.partyName} • </span>}
                  {d.destination && <span>{d.destination} • </span>}
                  <span className="font-semibold text-amber-700">{(d.weightNet * 1000).toFixed(0)} KG</span>
                  <span className="text-gray-400"> ({d.weightNet.toFixed(2)} MT)</span>
                  {d.bags > 0 && <span className="text-gray-400"> · {d.bags} bags</span>}
                  {d.invoiceAmount && <span className="font-semibold text-green-700"> = ₹{d.invoiceAmount.toLocaleString('en-IN')}</span>}
                </div>
                {d.remarks && <div className="text-[11px] text-gray-400 mt-0.5">{d.remarks}</div>}
              </div>
              <div className="flex items-center gap-1.5">
                {!d.invoiceNo && d.weightNet > 0 && (
                  <button onClick={() => { setBillTruck(d); setBillRate(d.rate?.toString() || ''); }}
                    title="Generate Bill"
                    className="text-purple-500 hover:text-purple-700 p-1"><Receipt size={15} /></button>
                )}
                {d.invoiceNo && (
                  <a href={`${API_BASE}/api/ddgs-dispatch/${d.id}/invoice-pdf`} target="_blank" rel="noreferrer"
                    title="Invoice PDF"
                    className="text-blue-500 hover:text-blue-700 p-1"><FileText size={15} /></a>
                )}
                {d.weightNet > 0 && (
                  <a href={`${API_BASE}/api/ddgs-dispatch/${d.id}/gate-pass-pdf`} target="_blank" rel="noreferrer"
                    title="Gate Pass"
                    className="text-green-500 hover:text-green-700 p-1"><FileText size={15} /></a>
                )}
                {isAdmin && (
                  <button onClick={() => handleDelete(d.id)}
                    className="text-red-400 hover:text-red-600 p-1"><Trash2 size={14} /></button>
                )}
              </div>
            </div>
          </div>
        ))}
        {dispatches.length === 0 && !showForm && (
          <p className="text-center text-sm text-gray-400 py-8">No dispatches for {date}</p>
        )}
      </div>

      {/* WhatsApp share */}
      {dispatches.length > 0 && (
        <button onClick={shareWhatsApp}
          className="w-full flex items-center justify-center gap-2 bg-green-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-green-700 mb-5">
          <Share2 size={16} /> Share on WhatsApp
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
              const dayNet = items.reduce((s: number, d: DDGSTruck) => s + (d.weightNet || 0), 0);
              const dayBags = items.reduce((s: number, d: DDGSTruck) => s + (d.bags || 0), 0);
              return (
                <div key={dateKey} className="border rounded-lg p-3 bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-gray-700">{fmtDt(dateKey)}</span>
                    <span className="text-xs font-bold text-amber-600">{(dayNet * 1000).toFixed(0)} KG — {dayBags} bags — {items.length} trucks</span>
                  </div>
                  <div className="space-y-1">
                    {items.map((d: DDGSTruck) => (
                      <div key={d.id} className="text-xs text-gray-600 flex justify-between">
                        <span>{d.rstNo ? `[${d.rstNo}] ` : ''}{d.vehicleNo} → {d.partyName || '-'}</span>
                        <span className="font-medium">{(d.weightNet * 1000).toFixed(0)} KG</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bill Generation Modal */}
      {billTruck && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setBillTruck(null)}>
          <div className="bg-white rounded-xl p-5 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-gray-800 mb-3">Generate Bill</h3>
            <div className="text-xs text-gray-500 mb-3">
              {billTruck.vehicleNo} · {billTruck.partyName} · Net: {(billTruck.weightNet * 1000).toFixed(0)} KG ({billTruck.weightNet.toFixed(2)} MT)
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-gray-400">Rate (₹/MT) *</label>
                <input type="number" step="any" value={billRate} onChange={e => setBillRate(e.target.value)}
                  className="border rounded px-2 py-2 w-full text-sm" autoFocus />
              </div>
              {parseFloat(billRate) > 0 && (
                <div className="text-sm text-gray-700 bg-gray-50 rounded p-2">
                  Taxable: ₹{(billTruck.weightNet * parseFloat(billRate)).toFixed(2)} + 5% GST
                  = <span className="font-bold text-green-700">
                    ₹{((billTruck.weightNet * parseFloat(billRate)) * 1.05).toFixed(2)}
                  </span>
                </div>
              )}
              <div>
                <label className="text-[10px] text-gray-400">Invoice No (auto if blank)</label>
                <input type="text" value={billInvNo} onChange={e => setBillInvNo(e.target.value)}
                  className="border rounded px-2 py-2 w-full text-sm" placeholder="GST/25-26/..." />
              </div>
              <div className="flex gap-2">
                <button onClick={handleGenerateBill} disabled={!billRate}
                  className="flex-1 bg-purple-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50">
                  Generate Bill
                </button>
                <button onClick={() => setBillTruck(null)}
                  className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
