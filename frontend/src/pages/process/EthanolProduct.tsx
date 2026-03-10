import { useState, useEffect } from 'react';
import { Fuel, Plus, Trash2, Save, ChevronDown, ChevronUp, Eye, X, Share2, Loader2 } from 'lucide-react';
import api from '../../services/api';

const TANKS = [
  { key: 'recA', label: 'Receiver A', group: 'Receivers', color: 'blue' },
  { key: 'recB', label: 'Receiver B', group: 'Receivers', color: 'blue' },
  { key: 'recC', label: 'Receiver C', group: 'Receivers', color: 'blue' },
  { key: 'bulkA', label: 'Bulk A', group: 'Bulk Storage', color: 'orange' },
  { key: 'bulkB', label: 'Bulk B', group: 'Bulk Storage', color: 'orange' },
  { key: 'bulkC', label: 'Bulk C', group: 'Bulk Storage', color: 'orange' },
  { key: 'disp', label: 'Issue Tank', group: 'Issue Tank (Dispatch)', color: 'red' },
];

interface TruckForm { vehicleNo: string; partyName: string; destination: string; quantityBL: string; strength: string; remarks: string; }
const emptyTruck = (): TruckForm => ({ vehicleNo: '', partyName: '', destination: '', quantityBL: '', strength: '', remarks: '' });

export default function EthanolProduct() {
  const [form, setForm] = useState<any>({});
  const [trucks, setTrucks] = useState<TruckForm[]>([emptyTruck()]);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [prev, setPrev] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [entries, setEntries] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [remarks, setRemarks] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  const u = (key: string, val: any) => setForm((f: any) => ({ ...f, [key]: val }));
  const numU = (key: string, raw: string) => u(key, raw === '' ? null : parseFloat(raw));

  // Truck helpers
  const updateTruck = (idx: number, field: string, val: string) => {
    setTrucks(ts => ts.map((t, i) => i === idx ? { ...t, [field]: val } : t));
  };
  const addTruck = () => setTrucks(ts => [...ts, emptyTruck()]);
  const removeTruck = (idx: number) => setTrucks(ts => ts.length > 1 ? ts.filter((_, i) => i !== idx) : ts);

  // Calculations
  const totalStock = TANKS.reduce((s, t) => s + (form[`${t.key}Volume`] || 0), 0);
  const wSum = TANKS.reduce((s, t) => s + (form[`${t.key}Volume`] || 0) * (form[`${t.key}Strength`] || 0), 0);
  const avgStrength = totalStock > 0 ? wSum / totalStock : 0;
  const totalDispatch = trucks.reduce((s, t) => s + (parseFloat(t.quantityBL) || 0), 0);
  const prevStock = prev ? TANKS.reduce((s, t) => s + (prev[`${t.key}Volume`] || 0), 0) : 0;
  const productionBL = totalStock - prevStock + totalDispatch;
  const productionAL = productionBL * avgStrength / 100;

  useEffect(() => { loadLatest(); loadEntries(); }, []);

  async function loadLatest() {
    try {
      const res = await api.get('/ethanol-product/latest');
      setPrev(res.data.previous);
    } catch (e) { console.error(e); }
  }

  async function loadEntries() {
    try {
      const res = await api.get('/ethanol-product');
      setEntries(res.data.entries);
    } catch (e) { console.error(e); }
  }

  async function handleSave() {
    if (!date) { setMsg({ type: 'err', text: 'Date is required' }); return; }
    setSaving(true); setMsg(null);
    try {
      const payload = {
        date,
        ...form,
        remarks,
        trucks: trucks.filter(t => t.vehicleNo || parseFloat(t.quantityBL)),
      };
      if (editId) await api.put(`/ethanol-product/${editId}`, payload);
      else await api.post('/ethanol-product', payload);
      const now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setMsg({ type: 'ok', text: `Saved at ${now}` });
      setForm({}); setTrucks([emptyTruck()]); setRemarks(''); setEditId(null);
      await loadLatest(); await loadEntries();
    } catch (err: any) { setMsg({ type: 'err', text: err.response?.data?.error || 'Save failed' }); }
    setSaving(false);
  }

  function editEntry(e: any) {
    setEditId(e.id);
    const f: any = {};
    for (const t of TANKS) {
      for (const suffix of ['Dip', 'Lt', 'Strength', 'Volume']) {
        f[`${t.key}${suffix}`] = (e as any)[`${t.key}${suffix}`] ?? null;
      }
    }
    f.rsLevel = e.rsLevel; f.hfoLevel = e.hfoLevel; f.lfoLevel = e.lfoLevel;
    setForm(f);
    setRemarks(e.remarks || '');
    setTrucks(e.trucks?.length > 0
      ? e.trucks.map((t: any) => ({
          vehicleNo: t.vehicleNo || '', partyName: t.partyName || '',
          destination: t.destination || '', quantityBL: String(t.quantityBL || ''),
          strength: t.strength != null ? String(t.strength) : '', remarks: t.remarks || '',
        }))
      : [emptyTruck()]
    );
    setDate(e.date.split('T')[0]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const fmtDt = (d: string) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '';

  // Group tanks
  const groups = [
    { label: 'Receivers', tanks: TANKS.filter(t => t.group === 'Receivers'), color: 'blue' },
    { label: 'Bulk Storage', tanks: TANKS.filter(t => t.group === 'Bulk Storage'), color: 'orange' },
    { label: 'Issue Tank (Dispatch)', tanks: TANKS.filter(t => t.group === 'Issue Tank (Dispatch)'), color: 'red' },
  ];

  return (
    <div className="max-w-5xl mx-auto px-3 py-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="p-2 bg-purple-100 rounded-lg"><Fuel size={24} className="text-purple-600" /></div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Ethanol Product & Dispatch</h1>
          <p className="text-xs text-gray-500">Tank levels, truck dispatch, production calculation</p>
        </div>
      </div>

      {/* Date */}
      <div className="mb-5">
        <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="border rounded-lg px-3 py-2.5 w-full sm:w-72 text-sm" />
      </div>

      {/* Tank Readings */}
      {groups.map(g => (
        <div key={g.label} className="mb-5">
          <h3 className={`text-sm font-semibold text-${g.color}-600 mb-2 uppercase tracking-wide`}>{g.label}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {g.tanks.map(tank => {
              const prevVol = prev?.[`${tank.key}Volume`] || 0;
              const prevStr = prev?.[`${tank.key}Strength`] || 0;
              const curVol = form[`${tank.key}Volume`] || 0;
              const diff = curVol - prevVol;
              return (
                <div key={tank.key} className={`border rounded-lg p-3 bg-white border-${g.color}-200`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`font-semibold text-${g.color}-700`}>{tank.label}</span>
                    <span className="text-xs text-gray-500">{curVol.toFixed(1)} BL</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div>
                      <label className="text-[10px] text-gray-400">DIP (cm)</label>
                      <input type="number" step="any" value={form[`${tank.key}Dip`] ?? ''}
                        onChange={e => numU(`${tank.key}Dip`, e.target.value)}
                        className="border rounded px-2 py-1.5 w-full text-sm" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-400">LT %</label>
                      <input type="number" step="any" value={form[`${tank.key}Lt`] ?? ''}
                        onChange={e => numU(`${tank.key}Lt`, e.target.value)}
                        className="border rounded px-2 py-1.5 w-full text-sm" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-400">Strength %</label>
                      <input type="number" step="any" value={form[`${tank.key}Strength`] ?? ''}
                        onChange={e => numU(`${tank.key}Strength`, e.target.value)}
                        className="border rounded px-2 py-1.5 w-full text-sm" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-400">Volume (BL)</label>
                      <input type="number" step="any" value={form[`${tank.key}Volume`] ?? ''}
                        onChange={e => numU(`${tank.key}Volume`, e.target.value)}
                        className="border rounded px-2 py-1.5 w-full text-sm" />
                    </div>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-gray-400">Prev: {prevVol.toFixed(1)} BL ({prevStr.toFixed(1)}%)</span>
                    <span className={diff >= 0 ? 'text-green-600' : 'text-red-500'}>
                      {diff >= 0 ? '+' : ''}{diff.toFixed(1)} BL
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Stock Summary */}
      <div className="bg-gray-50 border rounded-lg p-4 mb-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <div>
            <div className="text-[10px] text-gray-400 uppercase">Prev Stock</div>
            <div className="text-lg font-bold text-gray-600">{prevStock.toFixed(1)}</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400 uppercase">Current Stock</div>
            <div className="text-lg font-bold text-blue-700">{totalStock.toFixed(1)}</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400 uppercase">Avg Strength</div>
            <div className="text-lg font-bold text-purple-700">{avgStrength.toFixed(2)}%</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400 uppercase">Dispatch</div>
            <div className="text-lg font-bold text-red-600">{totalDispatch.toFixed(1)}</div>
          </div>
        </div>
        <div className="border-t mt-3 pt-3 grid grid-cols-2 gap-3 text-center">
          <div>
            <div className="text-[10px] text-gray-400 uppercase">Production BL</div>
            <div className="text-xl font-bold text-green-700">{productionBL.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400 uppercase">Production AL</div>
            <div className="text-xl font-bold text-orange-600">{productionAL.toFixed(2)}</div>
          </div>
        </div>
      </div>

      {/* RS / HFO / LFO */}
      <div className="mb-5">
        <h3 className="text-sm font-semibold text-gray-600 mb-2 uppercase tracking-wide">RS / HFO / LFO Tanks (15 M3 each)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { key: 'rsLevel', label: 'RS Tank', color: 'indigo' },
            { key: 'hfoLevel', label: 'HFO Tank', color: 'amber' },
            { key: 'lfoLevel', label: 'LFO Tank', color: 'rose' },
          ].map(t => {
            const prevLvl = prev?.[t.key] || 0;
            const curLvl = form[t.key] || 0;
            const diff = curLvl - prevLvl;
            return (
              <div key={t.key} className="border rounded-lg p-3 bg-white">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-gray-700">{t.label}</span>
                  <span className="text-xs text-gray-500">{(curLvl * 15 / 100).toFixed(2)} M3</span>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <input type="number" step="any" value={form[t.key] ?? ''}
                    onChange={e => numU(t.key, e.target.value)}
                    className="border rounded px-2 py-1.5 flex-1 text-sm" placeholder="Level %" />
                  <span className="text-xs text-gray-400">%</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-gray-400">Prev: {prevLvl.toFixed(1)}%</span>
                  <span className={diff >= 0 ? 'text-green-600' : 'text-red-500'}>
                    {diff >= 0 ? '+' : ''}{diff.toFixed(1)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Truck Dispatch */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Truck Dispatch</h3>
          <button onClick={addTruck} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
            <Plus size={14} /> Add Truck
          </button>
        </div>
        <div className="space-y-3">
          {trucks.map((t, idx) => (
            <div key={idx} className="border rounded-lg p-3 bg-white relative">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-gray-500">Truck #{idx + 1}</span>
                {trucks.length > 1 && (
                  <button onClick={() => removeTruck(idx)} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <input type="text" placeholder="Vehicle No" value={t.vehicleNo}
                  onChange={e => updateTruck(idx, 'vehicleNo', e.target.value)}
                  className="border rounded px-2 py-1.5 text-sm" />
                <input type="text" placeholder="Party Name" value={t.partyName}
                  onChange={e => updateTruck(idx, 'partyName', e.target.value)}
                  className="border rounded px-2 py-1.5 text-sm" />
                <input type="text" placeholder="Destination" value={t.destination}
                  onChange={e => updateTruck(idx, 'destination', e.target.value)}
                  className="border rounded px-2 py-1.5 text-sm" />
                <div className="flex items-center gap-1">
                  <input type="number" step="any" placeholder="Qty (BL)" value={t.quantityBL}
                    onChange={e => updateTruck(idx, 'quantityBL', e.target.value)}
                    className="border rounded px-2 py-1.5 text-sm flex-1" />
                  <span className="text-xs text-gray-400">BL</span>
                </div>
                <div className="flex items-center gap-1">
                  <input type="number" step="any" placeholder="Strength %" value={t.strength}
                    onChange={e => updateTruck(idx, 'strength', e.target.value)}
                    className="border rounded px-2 py-1.5 text-sm flex-1" />
                  <span className="text-xs text-gray-400">%</span>
                </div>
                <input type="text" placeholder="Remarks" value={t.remarks}
                  onChange={e => updateTruck(idx, 'remarks', e.target.value)}
                  className="border rounded px-2 py-1.5 text-sm" />
              </div>
            </div>
          ))}
        </div>
        {totalDispatch > 0 && (
          <div className="text-right mt-2 text-sm font-semibold text-red-600">
            Total Dispatch: {totalDispatch.toFixed(2)} BL ({trucks.filter(t => parseFloat(t.quantityBL)).length} trucks)
          </div>
        )}
      </div>

      {/* Remarks */}
      <div className="mb-5">
        <label className="block text-xs font-medium text-gray-600 mb-1">Remarks</label>
        <textarea value={remarks} onChange={e => setRemarks(e.target.value)}
          className="border rounded-lg px-3 py-2 w-full text-sm" rows={2} placeholder="Any remarks..." />
      </div>

      {/* Save */}
      <div className="flex items-center justify-between mb-6">
        <div>
          {msg && <span className={`text-sm font-medium ${msg.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</span>}
        </div>
        <div className="flex gap-2">
          {editId && (
            <button onClick={() => { setEditId(null); setForm({}); setTrucks([emptyTruck()]); setRemarks(''); }}
              className="px-4 py-2 text-sm border rounded-lg text-gray-600 hover:bg-gray-50">Cancel</button>
          )}
          <button onClick={() => setShowPreview(true)}
            className="px-6 py-2.5 bg-purple-600 text-white rounded-lg font-medium text-sm hover:bg-purple-700 flex items-center gap-2">
            <Eye size={16} /> Preview & Save
          </button>
        </div>
      </div>

      {/* Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowPreview(false)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="bg-purple-600 text-white p-4 rounded-t-xl flex items-center justify-between">
              <h3 className="font-bold text-lg">Ethanol Product Report</h3>
              <button onClick={() => setShowPreview(false)}><X size={20} /></button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Date</span><span className="font-medium">{date}</span></div>
              <div className="border-t pt-2">
                <h4 className="font-semibold text-purple-700 mb-1">Stock Summary</h4>
                <div className="grid grid-cols-2 gap-1">
                  <div>Prev Stock: <b>{prevStock.toFixed(1)} BL</b></div>
                  <div>Current Stock: <b>{totalStock.toFixed(1)} BL</b></div>
                  <div>Avg Strength: <b>{avgStrength.toFixed(2)}%</b></div>
                  <div>Dispatch: <b>{totalDispatch.toFixed(1)} BL</b></div>
                </div>
              </div>
              <div className="border-t pt-2">
                <h4 className="font-semibold text-green-700 mb-1">Production</h4>
                <div className="grid grid-cols-2 gap-1">
                  <div>Production BL: <b>{productionBL.toFixed(2)}</b></div>
                  <div>Production AL: <b>{productionAL.toFixed(2)}</b></div>
                </div>
              </div>
              {trucks.some(t => t.vehicleNo || parseFloat(t.quantityBL)) && (
                <div className="border-t pt-2">
                  <h4 className="font-semibold text-red-600 mb-1">Dispatch ({trucks.filter(t => t.vehicleNo || parseFloat(t.quantityBL)).length} trucks)</h4>
                  {trucks.filter(t => t.vehicleNo || parseFloat(t.quantityBL)).map((t, i) => (
                    <div key={i} className="text-xs bg-gray-50 rounded p-1.5 mb-1">
                      {t.vehicleNo} → {t.destination || '—'} | {t.quantityBL} BL @ {t.strength || '—'}% | {t.partyName}
                    </div>
                  ))}
                </div>
              )}
              {remarks && <div className="border-t pt-2"><span className="text-gray-500">Remarks:</span> {remarks}</div>}
            </div>
            <div className="p-4 border-t flex gap-2">
              <button onClick={() => {
                const truckLines = trucks.filter(t => t.vehicleNo || parseFloat(t.quantityBL)).map((t, i) => `${i+1}. ${t.vehicleNo} → ${t.destination || '-'} | ${t.quantityBL} BL @ ${t.strength || '-'}%25`).join('%0A');
                const text = `*Ethanol Product Report*%0A📅 ${date}%0A%0AStock: ${totalStock.toFixed(1)} BL (${avgStrength.toFixed(2)}%25)%0ADispatch: ${totalDispatch.toFixed(1)} BL%0AProd BL: ${productionBL.toFixed(2)}%0AProd AL: ${productionAL.toFixed(2)}${truckLines ? '%0A%0A*Trucks*%0A' + truckLines : ''}${remarks ? '%0A%0ARemarks: ' + remarks : ''}`;
                window.open(`https://wa.me/?text=${text}`, '_blank');
              }} className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-green-700">
                <Share2 size={16} /> WhatsApp
              </button>
              <button onClick={() => { handleSave(); setShowPreview(false); }} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 bg-purple-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {editId ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History */}
      <div className="border-t pt-4">
        <button onClick={() => setShowHistory(!showHistory)}
          className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-800">
          {showHistory ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          History ({entries.length} entries)
        </button>
        {showHistory && (
          <div className="mt-3 space-y-2">
            {entries.map(e => (
              <div key={e.id} className="border rounded-lg p-3 bg-white flex items-center justify-between">
                <div className="flex-1">
                  <div className="text-sm font-medium">{fmtDt(e.date)}</div>
                  <div className="text-xs text-gray-500">
                    Stock: {e.totalStock?.toFixed(1)} BL | Dispatch: {e.totalDispatch?.toFixed(1)} BL |
                    Prod: {e.productionBL?.toFixed(1)} BL ({e.productionAL?.toFixed(1)} AL) |
                    Trucks: {e.trucks?.length || 0}
                  </div>
                </div>
                <button onClick={() => editEntry(e)} className="text-xs text-blue-600 hover:underline">Edit</button>
              </div>
            ))}
            {entries.length === 0 && <p className="text-sm text-gray-400">No entries yet</p>}
          </div>
        )}
      </div>
    </div>
  );
}
